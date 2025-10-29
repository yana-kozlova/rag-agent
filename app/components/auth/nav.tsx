'use client';

import { signOut, useSession } from 'next-auth/react';
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
    <nav className="navbar bg-base-100 shadow-sm">
      <div className="flex-none">
        <label htmlFor="app-drawer" className="btn btn-square btn-ghost drawer-button" aria-label="Toggle menu">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" className="inline-block h-5 w-5 stroke-current"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16"></path></svg>
        </label>
      </div>
      <div className="flex-1 flex justify-center">
        <Link href="/" className="btn btn-ghost text-xl">AI SDK RAG</Link>
      </div>
      <div className="flex-none flex items-center gap-2">
        {session ? (
          <>
            <div className="dropdown dropdown-end">
              <div tabIndex={0} role="button" className="btn btn-ghost btn-circle avatar">
                <div className="w-8 rounded-full">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={session.user?.image ?? ''} alt={session.user?.name ?? 'User'} />
                </div>
              </div>
              <ul tabIndex={0} className="menu menu-sm dropdown-content mt-3 z-[1] p-2 shadow bg-base-100 rounded-box w-52">
                <li>
                  <Link href="/profile">Profile</Link>
                </li>
                <li>
                  <Link href="/settings">Settings</Link>
                </li>
                <li>
                  <button onClick={handleLogout} className="justify-between">
                    Sign out
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" className="h-4 w-4 stroke-current"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6A2.25 2.25 0 005.25 5.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l3 3m0 0l-3 3m3-3H3"/></svg>
                  </button>
                </li>
              </ul>
            </div>
          </>
        ) : (
          <Link href="/signin" className="btn btn-ghost btn-sm">Sign In</Link>
        )}
      </div>
    </nav>
  );
}