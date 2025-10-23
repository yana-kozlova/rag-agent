'use client';

import { signOut, useSession } from 'next-auth/react';
import { Button } from '@/components/ui/button';

export function Nav() {
  const { data: session } = useSession();

  return (
    <nav className="flex items-center justify-between p-4 border-b">
      <div className="text-xl font-bold">AI SDK RAG</div>
      <div className="flex items-center space-x-4">
        {session ? (
          <Button onClick={() => signOut({ callbackUrl: '/auth/signin' })}>
            Sign Out
          </Button>
        ) : (
          <Button asChild>
            <a href="/auth/signin">Sign In</a>
          </Button>
        )}
      </div>
    </nav>
  );
}
