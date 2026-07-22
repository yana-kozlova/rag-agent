import dynamic from 'next/dynamic';

const DashboardHeader = dynamic(() => import('@/app/components/dashboard/DashboardHeader'), {
  ssr: false,
  loading: () => (
    <header className="mb-6">
      <div className="h-8 w-56 rounded bg-base-200 animate-pulse" />
      <div className="mt-2 h-4 w-44 rounded bg-base-200 animate-pulse" />
    </header>
  )
});

const ChatSection = dynamic(() => import('@/app/components/chat/ChatSection'), {
  ssr: false,
  loading: () => (
    <div className="flex flex-col w-full max-w-3xl mx-auto">
      <div className="h-[480px] sm:h-[560px] md:h-[760px] flex items-center justify-center">
        <div className="text-sm text-base-content/50">Loading chat…</div>
      </div>
    </div>
  )
});
const CalendarSummary = dynamic(() => import('@/app/components/widgets/calendar-summary'), {
  ssr: false,
  loading: () => (
    <div className="w-full">
      <div className="h-6 w-32 bg-base-200 rounded animate-pulse mb-4" />
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-10 bg-base-200 rounded animate-pulse" />
        ))}
      </div>
    </div>
  )
});
const EventsQuickPanel = dynamic(() => import('@/app/components/widgets/events-quick-panel'), {
  ssr: false,
  loading: () => (
    <div className="w-full min-h-[220px]">
      <div className="h-6 w-24 bg-base-200 rounded animate-pulse mb-4" />
      <div className="grid grid-cols-7 gap-2">
        {[1, 2, 3, 4, 5, 6, 7].map(i => (
          <div key={i} className="h-12 bg-base-200 rounded animate-pulse" />
        ))}
      </div>
    </div>
  )
});

export default function DashboardPage() {
  return (
    <div className="pt-1">
      <DashboardHeader />

      <div className="grid grid-cols-1 md:grid-cols-[minmax(320px,370px)_1fr]">
        {/* Calendar column — flat sections split by a hairline */}
        <aside className="order-2 md:order-1 flex flex-col gap-6 md:pr-8 pt-6 md:pt-0">
          <CalendarSummary />
          <div className="h-px bg-base-300" />
          <EventsQuickPanel />
        </aside>

        {/* Chat column — separated from the calendar by a vertical hairline */}
        <section className="order-1 md:order-2 md:border-l border-base-300 md:pl-8 min-w-0 flex flex-col">
          <ChatSection />
        </section>
      </div>
    </div>
  );
}
