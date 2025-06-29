import { PrismaClient, User } from '.prisma/client';
import { hashPassword, verifyPassword } from '@/utils/passwordUtility.js';
import {
  generateAuthToken,
  generateTokenId,
  TOKEN_TYPE,
  verifyResetToken,
} from '@raffle-tracker/auth';
import {
  AuthenticatedUser,
  LoginResponse,
  ResetUserRequest,
  ROLE,
  Role,
  User as UserDTO,
} from '@raffle-tracker/dto';
import { BaseService } from './BaseService.js';

export class UserService extends BaseService<User, UserDTO> {
  constructor(prisma: PrismaClient) {
    super(prisma, 'user');
  }

  public static toDTO(user: User): UserDTO {
    return {
      id: user.id,
      username: user.username,
      password: user.password ?? undefined,
      email: user.email,
      verified: user.verified ? 1 : 0,
      verificationTokenId: user.verificationTokenId ?? undefined,
    };
  }

  protected static toPrisma(user: UserDTO): User {
    return {
      id: user.id,
      username: user.username,
      password: user.password ?? null,
      email: user.email,
      verified: user.verified === 1,
      verificationTokenId: user.verificationTokenId ?? null,
    };
  }

  public static toAuthenticatedUser(user: UserDTO): AuthenticatedUser {
    return {
      id: user.id,
      username: user.username,
      roles: user.roles,
    };
  }

  private async checkUserExists(
    tx: PrismaClient,
    username: string,
    email: string
  ): Promise<boolean> {
    let existingUser = await tx.user.findUnique({
      where: { username },
    });
    if (existingUser) {
      return true;
    }
    existingUser = await tx.user.findUnique({
      where: { email },
    });
    if (existingUser) {
      return true;
    }
    return false;
  }

  private isValidEmail(email: string): boolean {
    return /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(
      email
    );
  }

  public async createUser(email: string, username: string): Promise<UserDTO> {
    if (!username || !email) {
      throw new Error('Username and email are required');
    }

    if (await this.checkUserExists(this.prisma, username, email)) {
      throw new Error('Username or email already in use');
    }

    if (username.length < 5 || username.length > 20) {
      throw new Error('Username must be between 5 and 20 characters long');
    }

    if (!this.isValidEmail(email)) {
      throw new Error('Invalid email format');
    }

    const createdUser = await this.prisma.$transaction(async tx => {
      let user = await tx.user.create({
        data: {
          username,
          email,
          verified: false,
          roles: {
            connect: [
              {
                name: ROLE.VIEWER,
              },
            ],
          },
        },
      });

      const verificationTokenId = await generateTokenId();
      user = await tx.user.update({
        where: { id: user.id },
        data: { verificationTokenId },
      });

      return user;
    });

    return UserService.toDTO(createdUser);
  }

  public async fetchUserWithRoles(userId: number): Promise<UserDTO> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { roles: true },
    });
    if (!user) throw new Error('User not found');
    return {
      ...UserService.toDTO(user),
      roles: (user.roles.map(role => role.name) as Role[]) ?? [],
    };
  }

  public async login(
    username: string,
    password: string
  ): Promise<LoginResponse> {
    const user = await this.prisma.user.findUnique({
      where: { username },
    });
    if (!user) throw new Error('User not found');
    if (!user.password) throw new Error('User password needs reset.');
    if (!user.verified) throw new Error('User not verified');

    // TODO: not sure of the cleanest way to handle bad credentials.
    // May need custom error type.
    const isPasswordValid = await verifyPassword(password, user.password);
    if (!isPasswordValid) throw new Error('Invalid password');

    // Get user data and convert to authenticated user
    const authenticatedUser = UserService.toAuthenticatedUser(
      await this.fetchUserWithRoles(user.id)
    );

    // Generate auth token with user data
    const authToken = await generateAuthToken(
      authenticatedUser,
      TOKEN_TYPE.AUTH
    );

    return {
      accessToken: authToken,
    };
  }

  public async resetPassword(
    token: string,
    password: string
  ): Promise<UserDTO> {
    const decoded = (await verifyResetToken(token)) as ResetUserRequest;
    const userId = decoded.userId;
    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        verificationTokenId: decoded.token,
      },
    });

    if (!user) throw new Error('User not found');
    if (user.verified)
      // TODO: Logging
      throw new Error('Please request a new password reset.');

    const hashedPassword = await hashPassword(password);
    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: {
        password: hashedPassword,
        verified: true,
        verificationTokenId: null,
      },
    });

    return UserService.toDTO(updatedUser);
  }
}
