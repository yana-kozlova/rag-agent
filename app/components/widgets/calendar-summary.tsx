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
  const labelDate = new Date(todayEvents[0]?.start || new Date());
  const label = labelDate.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

  return (
    <section className="min-w-[280px] w-full max-w-md">
      {error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : (
        <>
          {todayEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No upcoming events.</p>
          ) : (
            <section>
              <div className="flex items-center justify-between">
                <div className="pb-2 text-md tracking-wide font-bold">{`Today, ${label} (${todayCount})`}</div>
                  <div className="pb-2 text-md opacity-80 tracking-wide font-bold">
                    <button onClick={refresh} className="btn btn-xs btn-outline" disabled={loading}>
                      {loading ? 'Refreshing…' : 'Refresh'}
                    </button>
                  </div>
              </div>
              <ul className="list">
                {todayEvents.map((ev) => {
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
          )}
        </>
      )}
    </section>
  );
}


