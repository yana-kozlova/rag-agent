'use client';

import { useSession } from 'next-auth/react';

function greeting(hour: number) {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/**
 * Greeting and date only. The day's count used to be here too, one line above
 * the "Today" card that states it again with the entries under it.
 */
export default function DashboardHeader() {
  const { data: session } = useSession();

  const now = new Date();
  const firstName = (session?.user?.name || '').trim().split(/\s+/)[0];
  const dateLabel = now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <header className="mb-5">
      <h1 className="text-2xl font-semibold tracking-tight text-base-content">
        {greeting(now.getHours())}{firstName ? `, ${firstName}` : ''}
      </h1>
      <p className="mt-1 text-sm text-base-content/60">{dateLabel}</p>
    </header>
  );
}
