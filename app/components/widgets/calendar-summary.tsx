"use client";

import { useCalendar } from "@/app/components/providers/calendar-context";

export default function CalendarSummary() {
  const { events, loading, error, refresh } = useCalendar();

  const now = new Date();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  const overlapsTodayAndUpcoming = (start: Date, end: Date) => {
    return end.getTime() >= now.getTime() && start.getTime() <= endOfDay.getTime() && end.getTime() >= startOfDay.getTime();
  };

  const todayEvents = events
    .filter(ev => {
      const start = new Date(ev.start);
      const end = new Date(ev.end);
      return overlapsTodayAndUpcoming(start, end);
    })
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  const todayCount = todayEvents.length;

  return (
    <section className="min-w-[280px] w-full max-w-md border rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-semibold">Today</h2>
        <button
          onClick={refresh}
          className="px-2 py-1 text-xs border rounded hover:bg-gray-50"
          disabled={loading}
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      {error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : (
        <>
          <div className="text-2xl font-bold">{todayCount}</div>
          <div className="mt-4">
            {todayEvents.length === 0 ? (
              <p className="text-sm text-muted-foreground">No upcoming events.</p>
            ) : (
              <ul className="space-y-3">
                {todayEvents.slice(0, 5).map(ev => (
                  <li key={ev.id} className="border rounded p-3">
                    <div className="font-medium">{ev.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(ev.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} – {new Date(ev.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                    {ev.location && (
                      <div className="text-xs text-muted-foreground">{ev.location}</div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}


