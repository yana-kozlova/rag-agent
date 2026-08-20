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
    <header className="mb-6">
      <div className="h-8 w-56 rounded bg-base-200 animate-pulse" />
      <div className="mt-2 h-4 w-44 rounded bg-base-200 animate-pulse" />
    </header>
  ),
});

// Above the grid, full width: these are pressed, not read, and a row of
// buttons you have to scroll to is a row of buttons you stop using.
const QuickActions = dynamic(
  () => import('@/app/components/quick-actions/QuickActionsBar').then((m) => m.QuickActionsPanel),
  { ssr: false, loading: () => panelSkeleton }
);

const CalendarSummary = dynamic(() => import('@/app/components/widgets/calendar-summary'), {
  ssr: false,
  loading: () => panelSkeleton,
});
const WeekDigest = dynamic(() => import('@/app/components/widgets/week-digest'), {
  ssr: false,
  loading: () => panelSkeleton,
});
const People = dynamic(() => import('@/app/components/widgets/people'), {
  ssr: false,
  loading: () => panelSkeleton,
});
const RecentlySaved = dynamic(() => import('@/app/components/widgets/recently-saved'), {
  ssr: false,
  loading: () => panelSkeleton,
});
const TablesWidget = dynamic(() => import('@/app/components/widgets/tables-widget'), {
  ssr: false,
  loading: () => panelSkeleton,
});
const Wellbeing = dynamic(() => import('@/app/components/widgets/wellbeing'), {
  ssr: false,
  loading: () => panelSkeleton,
});
const Tasks = dynamic(() => import('@/app/components/widgets/tasks'), {
  ssr: false,
  loading: () => panelSkeleton,
});

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="rounded-box border border-base-300 bg-base-100 p-4">{children}</div>;
}

export default function DashboardPage() {
  return (
    <div className="pt-1">
      <DashboardHeader />

      <div className="mb-4">
        <Panel><QuickActions /></Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Panel><Tasks /></Panel>
        <Panel><CalendarSummary /></Panel>
        <Panel><WeekDigest /></Panel>
        <Panel><Wellbeing /></Panel>
        <Panel><People /></Panel>
        <Panel><RecentlySaved /></Panel>
        <Panel><TablesWidget /></Panel>
      </div>
    </div>
  );
}
