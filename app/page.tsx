// import Link from 'next/link';
import dynamic from 'next/dynamic';
// import UpcomingEvents from '@/app/components/widgets/upcoming-events';

const ChatSection = dynamic(() => import('@/app/components/chat/ChatSection'), { 
  ssr: false, 
  loading: () => (
    <div className="flex flex-col w-full max-w-3xl mx-auto px-4 md:px-0">
      <div className="space-y-3 rounded-lg bg-base-100 p-3 h-[480px] sm:h-[560px] md:h-[800px] flex items-center justify-center">
        <div className="text-sm opacity-70">Loading chat…</div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <div className="input input-bordered w-full h-12 animate-pulse bg-base-200" />
        <div className="btn btn-primary h-12 w-20 animate-pulse bg-base-200" />
      </div>
    </div>
  )
});
const CalendarSummary = dynamic(() => import('@/app/components/widgets/calendar-summary'), { 
  ssr: false, 
  loading: () => (
    <div className="min-w-[280px] w-full max-w-md">
      <div className="h-8 w-32 bg-base-200 rounded animate-pulse mb-4" />
      <div className="space-y-2">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-16 bg-base-200 rounded animate-pulse" />
        ))}
      </div>
    </div>
  )
});
const EventsQuickPanel = dynamic(() => import('@/app/components/widgets/events-quick-panel'), { 
  ssr: false, 
  loading: () => (
    <div className="card bg-base-100 card-bordered border-base-300 card-compact overflow-hidden shadow rounded-box min-h-[300px]">
      <div className="card-body gap-4 p-4">
        <div className="grid grid-cols-7 gap-2">
          {[1, 2, 3, 4, 5, 6, 7].map(i => (
            <div key={i} className="h-12 bg-base-200 rounded animate-pulse" />
          ))}
        </div>
      </div>
    </div>
  )
});

export default function DashboardPage() {
  return (
    <div className="container mx-auto p-0 md:p-6 space-y-8">
      <div className="grid gap-4 grid-cols-1 md:grid-cols-3">
        {/* Reserve min-height to prevent CLS */}
        <div className="flex flex-col gap-4 w-full md:col-span-1 order-2 md:order-1 min-h-[400px]">
          <div className="card bg-base-100 shadow">
            <div className="card-body p-4 md:p-6">
              <CalendarSummary />
            </div>
          </div>
          <div className="min-h-[300px]">
            <EventsQuickPanel />
          </div>
        </div>
        <div className="card bg-base-100 shadow w-full md:col-span-2 order-1 md:order-2">
          <div className="card-body p-2 md:p-4">
            <ChatSection />
          </div>
        </div>
      </div>
    </div>
  );
}