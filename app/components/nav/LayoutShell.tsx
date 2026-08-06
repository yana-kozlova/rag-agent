'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useSidebar } from './SidebarContext';
import { AppSidebar } from './AppSidebar';
import { MobileNav } from './MobileNav';
import { ChatRail } from '../chat/ChatRail';
import { useRailWidth } from '../chat/use-rail-width';

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
  const { data: session } = useSession();
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const isLarge = useMediaQuery('(min-width: 1024px)');
  const { width, setWidth, persistWidth } = useRailWidth();
  const [dragging, setDragging] = useState(false);

  // The companion rail requires an authenticated session (it hosts the chat),
  // which also keeps it off /signin.
  const showRail = !!session;

  const marginLeft = isDesktop ? (collapsed ? '4rem' : '15rem') : '0';
  // Only the docked (lg+) rail reserves layout space; below lg it's an overlay drawer.
  const marginRight = isLarge && showRail ? `${width}px` : '0';

  return (
    <>
      <AppSidebar />
      <div
        // The margin animates when the layout changes, but must not lag behind
        // the pointer while dragging — a transition there feels like rubber.
        className={`min-h-screen pb-16 md:pb-0 ${dragging ? '' : 'transition-[margin] duration-200'}`}
        style={{ marginLeft, marginRight }}
      >
        <main className="container mx-auto p-4">
          {children}
        </main>
      </div>
      <MobileNav />
      {showRail && (
        <ChatRail
          width={width}
          onResize={setWidth}
          onResizeEnd={persistWidth}
          onDraggingChange={setDragging}
          resizable={isLarge}
        />
      )}
    </>
  );
}
