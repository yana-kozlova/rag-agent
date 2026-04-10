'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { getUserInitials } from '@/lib/utils';
import { Home, BookOpen, Table2, Settings, LogOut } from 'lucide-react';
import { useRef } from 'react';

const TABS = [
  { href: '/', label: 'Home', icon: Home, match: (p: string) => p === '/' },
  { href: '/resources', label: 'Knowledge', icon: BookOpen, match: (p: string) => p.startsWith('/resources') },
  { href: '/tables', label: 'Tables', icon: Table2, match: (p: string) => p.startsWith('/tables') },
  { href: '/settings', label: 'Settings', icon: Settings, match: (p: string) => p.startsWith('/settings') },
];

export function MobileNav() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const detailsRef = useRef<HTMLDetailsElement>(null);

  const handleLogout = async () => {
    if (detailsRef.current) detailsRef.current.open = false;
    try {
      await signOut({ callbackUrl: '/signin', redirect: true });
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-base-200 border-t border-base-300 md:hidden">
      <div className="flex items-center justify-around h-14">
        {TABS.map(({ href, label, icon: Icon, match }) => {
          const active = match(pathname);
          return (
            <Link
              key={href}
              href={href}
              className={`flex flex-col items-center justify-center gap-0.5 flex-1 h-full text-xs transition-colors ${
                active ? 'text-primary' : 'text-base-content/60'
              }`}
            >
              <Icon className="h-5 w-5" />
              <span>{label}</span>
            </Link>
          );
        })}

        {/* User tab */}
        <div className="flex flex-col items-center justify-center flex-1 h-full relative">
          <details className="dropdown dropdown-top dropdown-end" ref={detailsRef}>
            <summary className="flex flex-col items-center gap-0.5 cursor-pointer list-none text-xs text-base-content/60">
              {session?.user?.image ? (
                <div className="w-6 h-6 rounded-full overflow-hidden">
                  <Image
                    src={session.user.image}
                    alt={session.user?.name ?? 'User'}
                    referrerPolicy="no-referrer"
                    width={24}
                    height={24}
                    sizes="24px"
                    className="w-full h-full object-cover"
                  />
                </div>
              ) : (
                <div className="avatar placeholder">
                  <div className="bg-neutral text-neutral-content w-6 h-6 rounded-full">
                    <span className="text-[10px]">{getUserInitials(session?.user?.name)}</span>
                  </div>
                </div>
              )}
              <span>Me</span>
            </summary>
            <ul className="menu menu-sm dropdown-content mb-2 z-50 p-2 shadow bg-base-100 rounded-box w-48 right-0">
              <li>
                <Link href="/settings" onClick={() => { if (detailsRef.current) detailsRef.current.open = false; }}>
                  Profile & Settings
                </Link>
              </li>
              {session && (
                <li>
                  <button onClick={handleLogout}>
                    <LogOut className="h-4 w-4" />
                    Sign out
                  </button>
                </li>
              )}
              {!session && (
                <li>
                  <Link href="/signin" onClick={() => { if (detailsRef.current) detailsRef.current.open = false; }}>
                    Sign In
                  </Link>
                </li>
              )}
            </ul>
          </details>
        </div>
      </div>
    </nav>
  );
}
