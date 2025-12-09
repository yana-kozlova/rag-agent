'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-80 min-h-full bg-base-200 text-base-content border-r">
      <div className="px-4 py-3 border-b flex items-center justify-between">
        <div>
          <div className="text-sm text-base-content/70">Menu</div>
          <div className="text-lg font-semibold">Navigation</div>
        </div>
        <label htmlFor="app-drawer" className="btn btn-ghost btn-square" aria-label="Close menu">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" className="h-5 w-5 stroke-current"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"/></svg>
        </label>
      </div>
      <ul className="menu p-4 gap-1">
        <li className={pathname === '/' ? 'active' : ''}>
          <label htmlFor="app-drawer">
            <Link href="/" className="flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" className="h-5 w-5 stroke-current"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0h6"/></svg>
              Dashboard
            </Link>
          </label>
        </li>
        <li className={pathname?.startsWith('/resources') ? 'active' : ''}>
          <label htmlFor="app-drawer">
            <Link href="/resources" className="flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" className="h-5 w-5 stroke-current"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/></svg>
              Knowledge Base
            </Link>
          </label>
        </li>
        <li className={pathname?.startsWith('/settings') ? 'active' : ''}>
          <label htmlFor="app-drawer">
            <Link href="/settings" className="flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" className="h-5 w-5 stroke-current"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11.983 5.5a2.5 2.5 0 10.034 5 2.5 2.5 0 00-.034-5zM4 12a8 8 0 1116 0 8 8 0 01-16 0z"/></svg>
              Profile & Settings
            </Link>
          </label>
        </li>
      </ul>
    </aside>
  );
}


