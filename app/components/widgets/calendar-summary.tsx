"use client";

import { useCalendar } from "@/app/components/providers/CalendarContext";
import { isInRange } from "@/app/components/utils/calendar-utils";
import type { CalendarEvent } from "@/types/calendar";

export default function CalendarSummary() {
  const { events, loading, error, refresh } = useCalendar();

  const todayEvents = events
    .filter((ev: CalendarEvent) => isInRange(ev, 'day'))
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  const todayCount = todayEvents.length;

  return (
    <section className="min-w-[280px] w-full max-w-md">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">Today</h2>
          <div className="text-2xl font-bold">{todayCount}</div>
        </div>
        <button onClick={refresh} className="btn btn-xs btn-outline" disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      {error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : (
        <>
          <div className="mt-4">
            {todayEvents.length === 0 ? (
              <p className="text-sm text-muted-foreground">No upcoming events.</p>
            ) : (
              <ul className="list bg-base-200 rounded-box shadow-sm">
                {todayEvents.slice(0, 5).map(ev => {
                  const paletteBadge = ['badge-primary','badge-secondary','badge-accent','badge-info','badge-success','badge-warning','badge-error'];
                  const paletteBg = ['bg-primary text-primary-content','bg-secondary text-secondary-content','bg-accent text-accent-content','bg-info text-info-content','bg-success text-success-content','bg-warning text-warning-content','bg-error text-error-content'];
                  const key = (ev.calendarId || '').toLowerCase();
                  let idx = 0;
                  for (let i = 0; i < key.length; i++) idx = (idx * 31 + key.charCodeAt(i)) % paletteBadge.length;
                  const badgeClass = paletteBadge[idx];
                  const bgClass = paletteBg[idx];
                  const start = new Date(ev.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                  const end = new Date(ev.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                  return (
                    <li key={ev.id} className="list-row pb-1">
                      <div className="flex items-center gap-2">
                        <div className="bg-neutral rounded-box text-neutral-content flex flex-col p-2 min-w-16 text-center text-lg">
                          {start}
                        </div>
                        <div>
                          <div className="min-w-0 flex items-center gap-2">
                            <div className="truncate text-md font-bold truncate">{ev.title}</div>
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
            )}
          </div>
        </>
      )}
    </section>
  );
}


