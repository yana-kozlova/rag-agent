'use client';

import { useSession } from 'next-auth/react';
import { useCalendar } from '@/app/components/providers/CalendarContext';
import { isInRange } from '@/app/components/utils/calendar-utils';
import type { CalendarEvent } from '@/types/calendar';

function greeting(hour: number) {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function DashboardHeader() {
  const { data: session } = useSession();
  const { events } = useCalendar();

  const now = new Date();
  const firstName = (session?.user?.name || '').trim().split(/\s+/)[0];
  const count = events.filter((ev: CalendarEvent) => isInRange(ev, 'day')).length;
  const dateLabel = now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <header className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight text-base-content">
        {greeting(now.getHours())}{firstName ? `, ${firstName}` : ''}
      </h1>
      <p className="mt-1 text-sm text-base-content/60">
        {dateLabel}
        {count > 0 ? ` · ${count} ${count === 1 ? 'event' : 'events'} today` : ' · no events today'}
      </p>
    </header>
  );
}
