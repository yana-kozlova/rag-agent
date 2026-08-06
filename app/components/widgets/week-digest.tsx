'use client';

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCalendar } from '@/app/components/providers/CalendarContext';
import { MeetingLink } from '@/app/components/utils/linkify';
import { tagColor } from '@/app/components/utils/tag-color';
import type { CalendarEvent } from '@/types/calendar';

/**
 * The week at a glance, with a way in.
 *
 * The summary answers "how heavy is this week and what is next" without a
 * click; the bars are the control — press one to open that day, press it again
 * to close. Weeks step forward but not back, because the calendar feed only
 * carries the next 30 days and a back arrow onto guaranteed emptiness is worse
 * than no arrow at all.
 */

const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** What `/api/calendar/live-events` fetches ahead, and so how far we can look. */
const FEED_DAYS = 30;

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() + ((day === 0 ? -6 : 1) - day));
  d.setHours(0, 0, 0, 0);
  return d;
}

/** All-day entries carry a date without a time, and would skew every total. */
function isAllDay(ev: CalendarEvent): boolean {
  const start = ev.start as string | undefined;
  return !!start && !start.includes('T');
}

function durationMinutes(ev: CalendarEvent): number {
  if (!ev.start || !ev.end) return 0;
  const ms = new Date(ev.end).getTime() - new Date(ev.start).getTime();
  return ms > 0 ? Math.round(ms / 60000) : 0;
}

function formatHours(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function formatDay(date: Date): string {
  return date.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

function formatTime(iso?: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function relativeDay(date: Date, today: Date): string {
  const days = Math.round(
    (new Date(date).setHours(0, 0, 0, 0) - new Date(today).setHours(0, 0, 0, 0)) / 86_400_000
  );
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return DAY_NAMES[(date.getDay() + 6) % 7];
}

function EventRow({ event }: { event: CalendarEvent }) {
  const dot = tagColor(event.calendarId as string | undefined);
  const allDay = isAllDay(event);

  return (
    <li className="-mx-2 grid grid-cols-[42px_1fr] items-start gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-base-200/60">
      <time className="pt-0.5 font-mono text-[11px] text-base-content/50">
        {allDay ? 'all-day' : formatTime(event.start)}
      </time>
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-base-content">{event.title}</div>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-base-content/50">
          {dot && <span className="h-[6px] w-[6px] shrink-0 rounded-full" style={{ backgroundColor: dot }} />}
          {!allDay && <span className="truncate">{formatTime(event.start)} – {formatTime(event.end)}</span>}
          {event.location && <span className="truncate">· {event.location}</span>}
          {event.meetingLink && (
            <>
              <span className="shrink-0 opacity-50">·</span>
              <MeetingLink value={event.meetingLink} />
            </>
          )}
        </div>
      </div>
    </li>
  );
}

export default function WeekDigest() {
  const { events, loading, error } = useCalendar();
  const [weekOffset, setWeekOffset] = useState(0);
  const [openDay, setOpenDay] = useState<number | null>(null);

  const digest = useMemo(() => {
    const now = new Date();
    const currentWeekStart = startOfWeek(now);
    const weekStart = new Date(currentWeekStart);
    weekStart.setDate(currentWeekStart.getDate() + weekOffset * 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);

    // The last week the feed can say anything about.
    const horizon = new Date(now);
    horizon.setDate(now.getDate() + FEED_DAYS);
    const maxOffset = Math.floor(
      (startOfWeek(horizon).getTime() - currentWeekStart.getTime()) / (7 * 86_400_000)
    );

    const inWeek = events.filter((ev) => {
      if (!ev.start) return false;
      const start = new Date(ev.start);
      return start >= weekStart && start < weekEnd;
    });

    // Monday-indexed buckets, so the bars line up with the labels below them.
    const perDay = Array.from({ length: 7 }, () => ({
      timed: [] as CalendarEvent[],
      allDay: [] as CalendarEvent[],
      minutes: 0,
    }));

    for (const ev of inWeek) {
      const index = (new Date(ev.start).getDay() + 6) % 7;
      if (isAllDay(ev)) {
        perDay[index].allDay.push(ev);
      } else {
        perDay[index].timed.push(ev);
        perDay[index].minutes += durationMinutes(ev);
      }
    }

    for (const day of perDay) {
      day.timed.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
    }

    const timedCount = perDay.reduce((sum, d) => sum + d.timed.length, 0);
    const totalMinutes = perDay.reduce((sum, d) => sum + d.minutes, 0);
    const peakMinutes = Math.max(...perDay.map((d) => d.minutes), 0);
    const busiestIndex = peakMinutes > 0 ? perDay.findIndex((d) => d.minutes === peakMinutes) : -1;

    // Only meaningful on the current week; a future week has no "today".
    const todayIndex = weekOffset === 0 ? (now.getDay() + 6) % 7 : -1;

    const next = inWeek
      .filter((ev) => !isAllDay(ev) && new Date(ev.start).getTime() >= now.getTime())
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())[0];

    return {
      weekStart,
      weekEndDisplay: new Date(weekEnd.getTime() - 86_400_000),
      maxOffset,
      timedCount,
      totalMinutes,
      perDay,
      peakMinutes,
      busiestIndex,
      todayIndex,
      next,
      now,
      isEmpty: inWeek.length === 0,
    };
  }, [events, weekOffset]);

  const goToWeek = (offset: number) => {
    setWeekOffset(offset);
    // A day index means nothing once the week under it changes.
    setOpenDay(null);
  };

  const selected = openDay !== null ? digest.perDay[openDay] : null;
  const selectedDate = useMemo(() => {
    if (openDay === null) return null;
    const d = new Date(digest.weekStart);
    d.setDate(digest.weekStart.getDate() + openDay);
    return d;
  }, [openDay, digest.weekStart]);

  return (
    <section className="w-full">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-base-content">
          {weekOffset === 0 ? 'Week ahead' : 'Week'}
        </h2>

        <div className="flex items-center gap-1">
          {weekOffset !== 0 && (
            <button
              type="button"
              onClick={() => goToWeek(0)}
              className="mr-1 font-mono text-[11px] font-medium text-primary transition-colors hover:underline"
            >
              Today
            </button>
          )}
          <button
            type="button"
            onClick={() => goToWeek(weekOffset - 1)}
            disabled={weekOffset <= 0}
            aria-label="Previous week"
            className="rounded p-0.5 text-base-content/50 transition-colors hover:bg-base-200 hover:text-base-content disabled:pointer-events-none disabled:opacity-25"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="font-mono text-[11px] tabular-nums text-base-content/50">
            {formatDay(digest.weekStart)} – {formatDay(digest.weekEndDisplay)}
          </span>
          <button
            type="button"
            onClick={() => goToWeek(weekOffset + 1)}
            disabled={weekOffset >= digest.maxOffset}
            aria-label="Next week"
            className="rounded p-0.5 text-base-content/50 transition-colors hover:bg-base-200 hover:text-base-content disabled:pointer-events-none disabled:opacity-25"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {error ? (
        <p className="text-sm text-error">{error}</p>
      ) : loading && digest.isEmpty ? (
        <div className="h-24 animate-pulse rounded-md bg-base-200" />
      ) : (
        <>
          <p className="mb-4 text-sm text-base-content">
            {digest.timedCount === 0 ? (
              <span className="text-base-content/50">Nothing scheduled.</span>
            ) : (
              <>
                <span className="font-medium">{digest.timedCount}</span>
                {digest.timedCount === 1 ? ' meeting' : ' meetings'}
                <span className="text-base-content/40"> · </span>
                <span className="font-medium">{formatHours(digest.totalMinutes)}</span>
                {digest.busiestIndex >= 0 && (
                  <>
                    <span className="text-base-content/40"> · busiest </span>
                    <span className="font-medium">{DAY_NAMES[digest.busiestIndex]}</span>
                  </>
                )}
              </>
            )}
          </p>

          {/* Load per day, and the way into a day. Heights are relative to the
              heaviest day, so the shape reads as "where the week is dense". */}
          <div className="mb-4 grid grid-cols-7 items-end gap-1" style={{ height: '58px' }}>
            {digest.perDay.map((day, i) => {
              const ratio = digest.peakMinutes > 0 ? day.minutes / digest.peakMinutes : 0;
              const isToday = i === digest.todayIndex;
              const isPast = digest.todayIndex >= 0 && i < digest.todayIndex;
              const isOpen = openDay === i;
              const count = day.timed.length + day.allDay.length;

              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setOpenDay(isOpen ? null : i)}
                  disabled={count === 0}
                  aria-pressed={isOpen}
                  aria-label={`${DAY_NAMES[i]}: ${count} ${count === 1 ? 'event' : 'events'}`}
                  title={`${DAY_NAMES[i]} · ${count} ${count === 1 ? 'event' : 'events'} · ${formatHours(day.minutes)}`}
                  className={`flex h-full flex-col items-center justify-end gap-1 rounded-sm pb-0.5 transition-colors ${
                    isOpen ? 'bg-primary/10' : count > 0 ? 'hover:bg-base-200/60' : 'cursor-default'
                  }`}
                >
                  <span
                    className={`w-full rounded-sm transition-colors ${
                      isOpen ? 'bg-primary' : isToday ? 'bg-primary/70' : isPast ? 'bg-base-300' : 'bg-primary/30'
                    }`}
                    style={{ height: `${Math.max(ratio * 32, count > 0 ? 3 : 1)}px` }}
                  />
                  <span
                    className={`font-mono text-[10px] ${
                      isOpen || isToday ? 'font-medium text-primary' : 'text-base-content/40'
                    }`}
                  >
                    {DAY_LABELS[i]}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="border-t border-base-200 pt-3">
            {selected && selectedDate ? (
              <>
                <div className="mb-1 flex items-baseline justify-between">
                  <span className="font-mono text-[10px] uppercase tracking-wide text-primary">
                    {DAY_NAMES[openDay!]} {formatDay(selectedDate)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setOpenDay(null)}
                    className="font-mono text-[10px] text-base-content/40 transition-colors hover:text-base-content"
                  >
                    close
                  </button>
                </div>
                <ul className="flex flex-col">
                  {[...selected.allDay, ...selected.timed].map((ev) => (
                    <EventRow key={ev.id} event={ev} />
                  ))}
                </ul>
              </>
            ) : digest.next ? (
              <div className="min-w-0">
                <div className="mb-0.5 font-mono text-[10px] uppercase tracking-wide text-base-content/40">
                  Next
                </div>
                <div className="truncate text-sm font-medium text-base-content">
                  {digest.next.title}
                </div>
                <div className="mt-0.5 flex min-w-0 items-center gap-1.5 font-mono text-xs text-base-content/50">
                  <span className="truncate">
                    {relativeDay(new Date(digest.next.start), digest.now)} {formatTime(digest.next.start)}
                    {digest.next.location ? ` · ${digest.next.location}` : ''}
                  </span>
                  {digest.next.meetingLink ? (
                    <>
                      <span className="shrink-0 opacity-50">·</span>
                      <MeetingLink value={digest.next.meetingLink} />
                    </>
                  ) : null}
                </div>
              </div>
            ) : (
              <p className="text-xs text-base-content/50">
                {digest.isEmpty ? 'Nothing this week.' : 'Nothing left this week.'}
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
