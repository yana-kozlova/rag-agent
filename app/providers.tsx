'use client';

import { Session } from 'next-auth';
import { SessionProvider as NextAuthProvider } from 'next-auth/react';
import { CalendarProvider } from './components/providers/calendar-context';

export function Providers({
  children,
  session,
}: {
  children: React.ReactNode;
  session: Session | null;
}) {
  return (
    <NextAuthProvider session={session}>
      <CalendarProvider>
        {children}
      </CalendarProvider>
    </NextAuthProvider>
  );
}
