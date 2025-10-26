import { EventListView } from '../components/calendar/CalendarView';

export default function CalendarPage() {
  return (
    <div className="container mx-auto p-4">
      <h1 className="text-3xl font-bold mb-6">My Calendar</h1>
      <EventListView />
    </div>
  );
}
