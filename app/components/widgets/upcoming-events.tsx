"use client";

import { useCalendar } from "@/app/components/providers/calendar-context";

export default function UpcomingEvents() {
  const { events, loading, error, range, setRange, refresh } = useCalendar();
  const filtered = events.filter((ev) => {
    const now = new Date();
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const start = new Date(ev.start);
    const end = new Date(ev.end);
    if (range === 'week') {
      const endOfWeek = new Date();
      endOfWeek.setDate(endOfWeek.getDate() + 7);
      endOfWeek.setHours(23, 59, 59, 999);
      return end.getTime() >= now.getTime() && start.getTime() <= endOfWeek.getTime();
    }
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);
    return end.getTime() >= now.getTime() && start.getTime() <= endOfDay.getTime() && end.getTime() >= startOfDay.getTime();
  }).sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xl font-semibold">Upcoming</h2>
        <div className="flex gap-2">
          <button
            onClick={() => { setRange('day'); refresh(); }}
            className={`px-2 py-1 text-xs rounded border ${range === 'day' ? 'bg-gray-900 text-white' : 'hover:bg-gray-50'}`}
          >
            Day
          </button>
          <button
            onClick={() => { setRange('week'); refresh(); }}
            className={`px-2 py-1 text-xs rounded border ${range === 'week' ? 'bg-gray-900 text-white' : 'hover:bg-gray-50'}`}
          >
            Week
          </button>
        </div>
      </div>
      {error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-muted-foreground">{range === 'week' ? 'No events this week.' : 'No events for today.'}</p>
      ) : (
        <ul className="space-y-3">
          {filtered.map((ev) => (
            <li key={ev.id} className="border rounded-lg p-4">
              <div className="font-medium">{ev.title}</div>
              <div className="text-sm text-muted-foreground">
                {new Date(ev.start).toLocaleString()} – {new Date(ev.end).toLocaleString()}
              </div>
              {ev.location && (
                <div className="text-sm text-muted-foreground">{ev.location}</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}