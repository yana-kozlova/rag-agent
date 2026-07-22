'use client';

import { CalendarDays, MapPin, Video } from 'lucide-react';
import type { ToolCalendarEvent } from '@/types/calendar';
import { MeetingLink, isUrl } from '@/app/components/utils/linkify';
import { tagColor } from '@/app/components/utils/tag-color';
import { formatDay, formatTime } from './formatting';

type EventsOutput = { events?: ToolCalendarEvent[]; count?: number };

/** local YYYY-MM-DD key for grouping, tolerant of all-day date strings. */
function dayKey(iso?: string): string {
  if (!iso) return 'unknown';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso.slice(0, 10) : d.toDateString();
}

function EventRow({ event }: { event: ToolCalendarEvent }) {
  const dot = event.calendarId ? tagColor(event.calendarId) : null;
  // A physical place is the location unless it's just a URL; the join link is
  // the explicit meetingLink, or a URL that was dropped into location.
  const placeText = event.location && !isUrl(event.location) ? event.location : undefined;
  const joinLink =
    event.meetingLink || (event.location && isUrl(event.location) ? event.location : undefined);
  const hasMeta = (!event.allDay && event.end) || placeText || joinLink;
  return (
    <div className="grid grid-cols-[44px_1fr] items-start gap-2.5 py-1">
      <span className="pt-0.5 font-mono text-[11px] text-base-content/50">
        {event.allDay ? 'all‑day' : formatTime(event.start) || '—'}
      </span>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[13px] font-medium text-base-content">{event.title}</span>
          {dot && (
            <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ backgroundColor: dot }} />
          )}
        </div>
        {hasMeta ? (
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-base-content/50">
            {!event.allDay && event.end && (
              <span className="shrink-0">{formatTime(event.start)} – {formatTime(event.end)}</span>
            )}
            {placeText && (
              <span className="inline-flex min-w-0 items-center gap-0.5">
                <MapPin className="h-3 w-3 shrink-0" />
                <span className="truncate">{placeText}</span>
              </span>
            )}
            {joinLink && (
              <span className="inline-flex shrink-0 items-center gap-0.5">
                <Video className="h-3 w-3 shrink-0" />
                <MeetingLink value={joinLink} />
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
      <div className="not-prose flex items-center gap-2 text-xs text-base-content/50">
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
    <div className="not-prose max-w-sm border-l-2 border-primary pl-3.5">
      <div className="mb-1.5 flex items-center gap-1.5 font-mono text-[11px] text-base-content/50">
        <CalendarDays className="h-3.5 w-3.5" />
        {events.length} {events.length === 1 ? 'event' : 'events'}
      </div>
      <div className="space-y-1.5">
        {groups.map((g) => (
          <div key={g.key}>
            <div className="mb-1 border-b border-base-300 pb-1 font-mono text-xs font-medium text-base-content/60">
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
