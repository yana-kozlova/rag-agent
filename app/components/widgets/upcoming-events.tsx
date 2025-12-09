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
          <button onClick={() => { setRange('week'); refresh(); }} className={`btn btn-xs ${range === 'week' ? 'btn-primary' : 'btn-outline'}`}>7 days</button>
        </div>
      </div>
      {error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-muted-foreground">{range === 'week' ? 'No events for next 7 days' : 'No events for today.'}</p>
      ) : (
        <div className="">
          {orderedGroupKeys.map((key) => {
            const dayEvents = groups[key].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
            const labelDate = new Date(dayEvents[0].start);
            const label = labelDate.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
            return (
              <section key={key}>
                <ul className="list py-2">
                  <li className="pb-2 text-md opacity-80 tracking-wide font-bold">{label}</li>
                  {dayEvents.map((ev) => {
                    const paletteBadge = ['badge-primary','badge-secondary','badge-accent','badge-info','badge-success','badge-warning','badge-error'];
                    const paletteBg = ['bg-primary text-primary-content','bg-secondary text-secondary-content','bg-accent text-accent-content','bg-info text-info-content','bg-success text-success-content','bg-warning text-warning-content','bg-error text-error-content'];
                    const k = (ev.calendarId || '').toLowerCase();
                    let idx = 0;
                    for (let i = 0; i < k.length; i++) idx = (idx * 31 + k.charCodeAt(i)) % paletteBadge.length;
                    const badgeClass = paletteBadge[idx];
                    const bgClass = paletteBg[idx];
                    const start = new Date(ev.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    const end = new Date(ev.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    return (
                      <li key={ev.id} className="list-row pb-1 border-l-2 pl-2">
                        <div className="flex items-center gap-2">
                          <div className="bg-warning rounded-box text-base-content flex flex-col p-2 min-w-16 text-center text-lg">
                            {start}
                          </div>
                          <div>
                            <div className="min-w-0 flex items-center gap-2">
                              <div className="font-bold text-sm md:text-md flex-1 min-w-0">{ev.title}</div>
                              {ev.calendarId !== 'primary' && <div className={`badge badge-ghost badge-xs mr-1 ${badgeClass}`}>{ev.calendarId}</div>}
                            </div>
                            <div className="text-[11px] uppercase font-semibold opacity-60 truncate">
                              {start} – {end}{ev.location ? ` · ${ev.location}` : ''}
                            </div>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}