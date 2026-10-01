'use client';

import dynamic from 'next/dynamic';

const panelSkeleton = (
  <div className="rounded-box border border-base-300 bg-base-100 p-4">
    <div className="mb-4 h-5 w-28 rounded bg-base-200" />
    <div className="space-y-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-9 rounded bg-base-200" />
      ))}
    </div>
  </div>
);

const DashboardHeader = dynamic(() => import('@/app/components/dashboard/DashboardHeader'), {
  ssr: false,
  loading: () => (
    <header className="mb-5">
      <div className="h-8 w-56 rounded bg-base-200 animate-pulse" />
      <div className="mt-2 h-4 w-44 rounded bg-base-200 animate-pulse" />
    </header>
  ),
});

// Directly under the greeting, as a bare row: these are pressed, not read, and
// a row of buttons you have to scroll to is a row of buttons you stop using.
const QuickActions = dynamic(
  () => import('@/app/components/quick-actions/QuickActionsBar').then((m) => m.QuickActionsPanel),
  {
    ssr: false,
    loading: () => (
      <div className="flex gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-9 w-28 animate-pulse rounded-full bg-base-200" />
        ))}
      </div>
    ),
  }
);

const Today = dynamic(() => import('@/app/components/widgets/today'), {
  ssr: false,
  loading: () => panelSkeleton,
});
const WeekDigest = dynamic(() => import('@/app/components/widgets/week-digest'), {
  ssr: false,
  loading: () => panelSkeleton,
});
const UpcomingDates = dynamic(() => import('@/app/components/widgets/upcoming-dates'), {
  ssr: false,
  loading: () => panelSkeleton,
});
const RecentlySaved = dynamic(() => import('@/app/components/widgets/recently-saved'), {
  ssr: false,
  loading: () => panelSkeleton,
});
const Browse = dynamic(() => import('@/app/components/widgets/browse'), {
  ssr: false,
  loading: () => panelSkeleton,
});

function Panel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-box border border-base-300 bg-base-100 p-4 ${className}`}>{children}</div>
  );
}

/**
 * Three tiers, by how soon each thing matters: the day (what to do now), the
 * week beside it (what is coming), and underneath, the ways into everything
 * else. The earlier grid gave all of these equal cards, so a list of tables sat
 * level with the day's schedule.
 */
export default function DashboardPage() {
  return (
    <div className="pt-1">
      <DashboardHeader />

      <div className="mb-5">
        <QuickActions />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <Today />
        </Panel>
        <div className="flex flex-col gap-4">
          <Panel>
            <WeekDigest />
          </Panel>
          <Panel>
            <UpcomingDates />
          </Panel>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <Panel>
          <RecentlySaved />
        </Panel>
        <Panel>
          <Browse />
        </Panel>
      </div>
    </div>
  );
}
