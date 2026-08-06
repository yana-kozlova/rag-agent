"use client";

import { useCalendar } from "@/app/components/providers/CalendarContext";
import { isInRange } from "@/app/components/utils/calendar-utils";
import { MeetingLink } from "@/app/components/utils/linkify";
import { tagColor } from "@/app/components/utils/tag-color";
import type { CalendarEvent } from "@/types/calendar";

export default function CalendarSummary() {
  const { events, loading, error, refresh } = useCalendar();

  const todayEvents = events
    .filter((ev: CalendarEvent) => isInRange(ev, 'day'))
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  return (
    <section className="w-full">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-[15px] font-semibold text-base-content">Today</h2>
          <span className="rounded-full bg-base-200 px-1.5 py-0.5 font-mono text-[11px] text-base-content/60">
            {todayEvents.length}
          </span>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="text-[13px] font-medium text-base-content/50 transition-colors hover:text-primary disabled:opacity-50"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error ? (
        <p className="text-sm text-error">{error}</p>
      ) : todayEvents.length === 0 ? (
        <p className="text-sm text-base-content/50">No events today.</p>
      ) : (
        <ul className="flex flex-col">
          {todayEvents.map((ev) => {
            const dot = tagColor(ev.calendarId);
            const start = new Date(ev.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const end = new Date(ev.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            return (
              <li
                key={ev.id}
                className="-mx-2 grid grid-cols-[46px_1fr] items-start gap-3 rounded-md px-2 py-2 transition-colors hover:bg-base-200/60"
              >
                <time className="pt-0.5 font-mono text-xs text-base-content/50">{start}</time>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-base-content">{ev.title}</div>
                  <div className="mt-0.5 flex min-w-0 items-center gap-1.5 font-mono text-xs text-base-content/50">
                    {dot && (
                      <span
                        className="h-[7px] w-[7px] shrink-0 rounded-full"
                        style={{ backgroundColor: dot }}
                      />
                    )}
                    <span className="truncate">
                      {start} – {end}{ev.location ? ` · ${ev.location}` : ''}
                    </span>
                    {ev.meetingLink ? (
                      <>
                        <span className="shrink-0 opacity-50">·</span>
                        <MeetingLink value={ev.meetingLink} />
                      </>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
