'use client';

import { CalendarDays, MapPin } from 'lucide-react';
import type { ToolCalendarEvent } from '@/types/calendar';
import { formatDay, formatTime } from './formatting';

type EventsOutput = { events?: ToolCalendarEvent[]; count?: number };

const BADGES = ['badge-primary', 'badge-secondary', 'badge-accent', 'badge-info', 'badge-success', 'badge-warning', 'badge-error'];

// Same hashing the dashboard widgets use, so a given calendar keeps its colour.
function badgeFor(calendarId: string): string {
  const k = calendarId.toLowerCase();
  let idx = 0;
  for (let i = 0; i < k.length; i++) idx = (idx * 31 + k.charCodeAt(i)) % BADGES.length;
  return BADGES[idx];
}

/** local YYYY-MM-DD key for grouping, tolerant of all-day date strings. */
function dayKey(iso?: string): string {
  if (!iso) return 'unknown';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso.slice(0, 10) : d.toDateString();
}

function EventRow({ event }: { event: ToolCalendarEvent }) {
  const badge = event.calendarId && event.calendarId !== 'primary' ? badgeFor(event.calendarId) : null;
  return (
    <div className="flex items-start gap-2 py-1">
      <div className="font-mono text-xs bg-base-200 rounded-btn px-1.5 py-1 min-w-14 text-center shrink-0">
        {event.allDay ? 'all‑day' : formatTime(event.start) || '—'}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-sm font-medium truncate">{event.title}</span>
          {badge && <span className={`badge badge-ghost badge-xs shrink-0 ${badge}`}>{event.calendarId}</span>}
        </div>
        {(!event.allDay && event.end) || event.location ? (
          <div className="text-[11px] uppercase font-semibold opacity-55 truncate font-mono flex items-center gap-1">
            {!event.allDay && event.end && (
              <span>{formatTime(event.start)} – {formatTime(event.end)}</span>
            )}
            {event.location && (
              <span className="inline-flex items-center gap-0.5 min-w-0">
                <MapPin className="h-3 w-3 shrink-0" />
                <span className="truncate">{event.location}</span>
              </span>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function EventsCard({ output }: { output: EventsOutput }) {
  const events = Array.isArray(output?.events) ? output.events : [];

  if (events.length === 0) {
    return (
      <div className="not-prose flex items-center gap-2 text-xs opacity-60">
        <CalendarDays className="h-3.5 w-3.5" />
        No events in that range
      </div>
    );
  }

  // Group into day sections, preserving the chronological order from the tool.
  const groups: { key: string; label: string; items: ToolCalendarEvent[] }[] = [];
  for (const ev of events) {
    const key = dayKey(ev.start);
    let group = groups.find((g) => g.key === key);
    if (!group) {
      group = { key, label: formatDay(ev.start) || 'Undated', items: [] };
      groups.push(group);
    }
    group.items.push(ev);
  }

  return (
    <div className="not-prose max-w-sm rounded-box border border-base-300 bg-base-100 p-3">
      <div className="flex items-center gap-1.5 text-[11px] uppercase font-semibold opacity-50 tracking-wide mb-1.5">
        <CalendarDays className="h-3 w-3" />
        {events.length} {events.length === 1 ? 'event' : 'events'}
      </div>
      <div className="space-y-2">
        {groups.map((g) => (
          <div key={g.key}>
            <div className="text-xs font-semibold font-mono opacity-70 border-b border-dashed border-base-300 pb-0.5 mb-0.5">
              {g.label}
            </div>
            {g.items.map((ev, i) => (
              <EventRow key={ev.id || `${g.key}-${i}`} event={ev} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
