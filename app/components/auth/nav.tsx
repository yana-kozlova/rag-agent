'use client';

import { signOut, useSession } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

export function Nav() {
  const { data: session } = useSession();

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

  return (
    <nav className="flex items-center justify-between p-4 border-b">
      <Link href="/" className="text-xl font-bold">
        AI SDK RAG
      </Link>
      <div className="flex items-center gap-4">
        {session ? (
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">
              {session.user?.name || session.user?.email}
            </span>
            <Button 
              variant="outline" 
              onClick={handleLogout}
              className="hover:bg-gray-100"
            >
              Sign Out
            </Button>
          </div>
        ) : (
          <Button asChild variant="ghost">
            <Link href="/signin">Sign In</Link>
          </Button>
        )}
      </div>
    </nav>
  );
}