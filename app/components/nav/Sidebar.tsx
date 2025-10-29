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
      </ul>
    </aside>
  );
}


