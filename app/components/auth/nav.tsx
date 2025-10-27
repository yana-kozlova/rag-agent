'use client';

import { signOut, useSession } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { useState } from 'react';
import { useCalendar } from '../providers/calendar-context';

export function Nav() {
  const { data: session } = useSession();
  const [syncing, setSyncing] = useState(false);
  const { refresh } = useCalendar();

  const handleLogout = async () => {
    try {
      await signOut({ 
        callbackUrl: '/signin',
        redirect: true
      });
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  const handleSync = async () => {
    try {
      setSyncing(true);
      // For live display, just refresh context. DB sync is optional and can be separate.
      await refresh();
    } catch (error) {
      console.error('Error syncing calendar:', error);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <nav className="navbar bg-base-100 border-b">
      <div className="flex-1">
        <Link href="/" className="btn btn-ghost text-xl">AI SDK RAG</Link>
      </div>
      <div className="flex-none flex items-center gap-2">
        <Button asChild variant="ghost">
          <Link href="/chat">Chat</Link>
        </Button>
        {session ? (
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">
              {session.user?.name || session.user?.email}
            </span>
            <button className="btn btn-outline btn-sm" onClick={handleSync} disabled={syncing}>
              {syncing ? 'Syncing…' : 'Sync now'}
            </button>
            <button className="btn btn-outline btn-sm" onClick={handleLogout}>
              Sign Out
            </button>
          </div>
        ) : (
          <Link href="/signin" className="btn btn-ghost btn-sm">Sign In</Link>
        )}
      </div>
    </nav>
  );
}