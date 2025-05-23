'use client';

import SimpleButton from '@/app/ui/SimpleButton';

export default function EventNewButton() {
  return (
    <SimpleButton
      href="/events/new"
      className="my-4 mx-4"
      title="New Event"
    >
      New Event
    </SimpleButton>
  );
}
