import Link from 'next/link';
import ChatSection from '@/app/components/chat/chat-section';
import UpcomingEvents from '@/app/components/widgets/upcoming-events';

export default function DashboardPage() {
  return (
    <div className="container mx-auto p-6 space-y-8">
      <header className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <div className="flex gap-3">
          <Link href="/chat" className="px-4 py-2 rounded-md border hover:bg-accent">Go to Chat</Link>
        </div>
      </header>
      <div className="flex gap-4">
        <UpcomingEvents />
        <ChatSection />
      </div>
    </div>
  );
}