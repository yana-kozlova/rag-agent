'use client';

import { useEffect, useState } from 'react';
import { useSidebar } from './SidebarContext';
import { AppSidebar } from './AppSidebar';
import { MobileNav } from './MobileNav';

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    setMatches(mq.matches);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [query]);
  return matches;
}

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const { collapsed } = useSidebar();
  const isDesktop = useMediaQuery('(min-width: 768px)');

  const marginLeft = isDesktop ? (collapsed ? '4rem' : '15rem') : '0';

  return (
    <>
      <AppSidebar />
      <div
        className="min-h-screen transition-[margin-left] duration-200 pb-16 md:pb-0"
        style={{ marginLeft }}
      >
        <main className="container mx-auto p-4">
          {children}
        </main>
      </div>
      <MobileNav />
    </>
  );
}
