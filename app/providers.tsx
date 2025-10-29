'use client';

import { Session } from 'next-auth';
import { SessionProvider as NextAuthProvider } from 'next-auth/react';
import { CalendarProvider } from './components/providers/CalendarContext';

export function Providers({
  children,
  session,
}: {
  children: React.ReactNode;
  session: Session | null;
}) {
  return (
    <NextAuthProvider session={session} refetchOnWindowFocus={false} refetchInterval={0}>
      <CalendarProvider>
        {children}
      </CalendarProvider>
    </NextAuthProvider>
  );
}
