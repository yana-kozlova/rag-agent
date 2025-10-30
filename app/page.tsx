import Link from 'next/link';
import ChatSection from '@/app/components/chat/ChatSection';
import UpcomingEvents from '@/app/components/widgets/upcoming-events';
import CalendarSummary from '@/app/components/widgets/calendar-summary';

export default function DashboardPage() {
  return (
    <div className="container mx-auto p-0 md:p-6 space-y-8">
      <div className="grid gap-4 grid-cols-1 md:grid-cols-3">
        <div className="flex flex-col gap-4 w-full md:col-span-1 order-2 md:order-1">
          <div className="card bg-base-100 shadow">
            <div className="card-body p-4 md:p-6">
              <CalendarSummary />
            </div>
          </div>
          <div className="card shadow bg-base-200 rounded-box">
            <div className="card-body p-4 md:p-6">
              <UpcomingEvents />
            </div>
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