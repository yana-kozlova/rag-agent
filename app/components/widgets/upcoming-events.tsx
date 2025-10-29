"use client";

import { useCalendar } from "@/app/components/providers/CalendarContext";
import { groupEventsByDay, isInRange } from '@/app/components/utils/calendar-utils';

export default function UpcomingEvents() {
  const { events, loading, error, range, setRange, refresh } = useCalendar();
  const filtered = events
    .filter((ev) => isInRange(ev, range))
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  const groups = groupEventsByDay(filtered) as Record<string, typeof filtered>;

  const orderedGroupKeys = Object.keys(groups).sort((a, b) => {
    const da = new Date(a.replace(/-/g, '/')).getTime();
    const db = new Date(b.replace(/-/g, '/')).getTime();
    return da - db;
  });

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xl font-semibold">Upcoming</h2>
        <div className="flex gap-2">
          <button onClick={() => { setRange('day'); refresh(); }} className={`btn btn-xs ${range === 'day' ? 'btn-primary' : 'btn-outline'}`}>Day</button>
          <button onClick={() => { setRange('week'); refresh(); }} className={`btn btn-xs ${range === 'week' ? 'btn-primary' : 'btn-outline'}`}>Week</button>
        </div>
      </div>
      {error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-muted-foreground">{range === 'week' ? 'No events this week.' : 'No events for today.'}</p>
      ) : (
        <div className="space-y-5">
          {orderedGroupKeys.map((key) => {
            const dayEvents = groups[key].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
            const labelDate = new Date(dayEvents[0].start);
            const label = labelDate.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
            return (
              <section key={key}>
                <div className="text-sm font-semibold text-gray-700 mb-2">{label}</div>
                <ul className="space-y-3">
                  {dayEvents.map((ev) => (
                    <li key={ev.id} className="border rounded-lg p-4">
                      <div className="font-medium">{ev.title}</div>
                      <div className="text-sm text-muted-foreground">
                        {new Date(ev.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} – {new Date(ev.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                      {ev.location && (
                        <div className="text-sm text-muted-foreground">{ev.location}</div>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}