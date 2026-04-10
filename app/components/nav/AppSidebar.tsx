'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { useSidebar } from './SidebarContext';
import { ThemeSwitcher } from '../theme/ThemeSwitcher';
import { getUserInitials } from '@/lib/utils';
import {
  Home,
  BookOpen,
  Table2,
  Settings,
  PanelLeftClose,
  PanelLeft,
  LogOut,
} from 'lucide-react';

const NAV_ITEMS = [
  { href: '/', label: 'Dashboard', icon: Home, match: (p: string) => p === '/' },
  { href: '/resources', label: 'Knowledge Base', icon: BookOpen, match: (p: string) => p.startsWith('/resources') },
  { href: '/tables', label: 'Tables', icon: Table2, match: (p: string) => p.startsWith('/tables') },
  { href: '/settings', label: 'Settings', icon: Settings, match: (p: string) => p.startsWith('/settings') },
];

export function AppSidebar() {
  const { collapsed, toggle } = useSidebar();
  const pathname = usePathname();
  const { data: session } = useSession();

  const handleLogout = async () => {
    try {
      await signOut({ callbackUrl: '/signin', redirect: true });
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  return (
    <aside
      className={`fixed left-0 top-0 h-screen bg-base-200 border-r border-base-300 z-40 hidden md:flex flex-col transition-all duration-200 ${
        collapsed ? 'w-16' : 'w-60'
      }`}
    >
      {/* Top: Logo + Toggle */}
      <div className="flex items-center justify-between px-3 h-16 border-b border-base-300 shrink-0">
        {!collapsed && (
          <Link href="/" className="text-lg font-bold truncate">
            AI SDK RAG
          </Link>
        )}
        <button
          onClick={toggle}
          className={`btn btn-ghost btn-sm btn-square ${collapsed ? 'mx-auto' : ''}`}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <PanelLeft className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
        </button>
      </div>

      {/* Middle: Nav links */}
      <nav className="flex-1 overflow-y-auto py-2">
        <ul className="menu gap-1 px-2">
          {NAV_ITEMS.map(({ href, label, icon: Icon, match }) => {
            const active = match(pathname);
            return (
              <li key={href}>
                <Link
                  href={href}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 transition-colors ${
                    active ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-base-300'
                  } ${collapsed ? 'justify-center px-0' : ''}`}
                  title={collapsed ? label : undefined}
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  {!collapsed && <span className="truncate">{label}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Bottom: Theme + User */}
      <div className="border-t border-base-300 p-2 space-y-2 shrink-0">
        <ThemeSwitcher compact={collapsed} />

        {session ? (
          <div className={`flex items-center gap-2 ${collapsed ? 'justify-center' : ''}`}>
            <div className="dropdown dropdown-top w-full">
              <div
                tabIndex={0}
                role="button"
                className={`btn btn-ghost w-full ${collapsed ? 'btn-square' : 'justify-start'}`}
              >
                {session.user?.image ? (
                  <div className="w-8 h-8 rounded-full overflow-hidden shrink-0">
                    <Image
                      src={session.user.image}
                      alt={session.user?.name ?? 'User'}
                      referrerPolicy="no-referrer"
                      width={32}
                      height={32}
                      sizes="32px"
                      className="w-full h-full object-cover"
                    />
                  </div>
                ) : (
                  <div className="avatar placeholder">
                    <div className="bg-neutral text-neutral-content w-8 h-8 rounded-full">
                      <span className="text-xs">{getUserInitials(session.user?.name)}</span>
                    </div>
                  </div>
                )}
                {!collapsed && (
                  <span className="truncate text-sm">{session.user?.name ?? 'User'}</span>
                )}
              </div>
              <ul
                tabIndex={0}
                className="menu menu-sm dropdown-content mb-2 z-50 p-2 shadow bg-base-100 rounded-box w-48 border border-base-300"
              >
                <li>
                  <Link href="/settings">Profile & Settings</Link>
                </li>
                <li>
                  <button onClick={handleLogout}>
                    <LogOut className="h-4 w-4" />
                    Sign out
                  </button>
                </li>
              </ul>
            </div>
          </div>
        ) : (
          <Link
            href="/signin"
            className={`btn btn-ghost btn-sm w-full ${collapsed ? 'btn-square' : ''}`}
          >
            {collapsed ? '→' : 'Sign In'}
          </Link>
        )}
      </div>
    </aside>
  );
}
