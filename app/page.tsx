import Link from 'next/link';
import ChatSection from '@/app/components/chat/chat-section';
import UpcomingEvents from '@/app/components/widgets/upcoming-events';
import CalendarSummary from '@/app/components/widgets/calendar-summary';

export default function DashboardPage() {
  return (
    <div className="container mx-auto p-6 space-y-8">
      <header className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <div className="flex gap-3">
          <Link href="/chat" className="btn btn-primary">Go to Chat</Link>
        </div>
      </header>
      <div className="flex gap-4">
        <div className="flex flex-col gap-4 w-full max-w-md">
          <div className="card bg-base-100 shadow">
            <div className="card-body">
              <CalendarSummary />
            </div>
          </div>
          <div className="card bg-base-100 shadow">
            <div className="card-body">
              <UpcomingEvents />
            </div>
          </div>
        </div>
        <div className="card bg-base-100 shadow w-full">
          <div className="card-body">
            <ChatSection />
          </div>
        </div>
      </div>
    </div>
  );
}