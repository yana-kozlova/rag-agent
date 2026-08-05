'use client';

import { useMemo } from 'react';
import { useCalendar } from '@/app/components/providers/CalendarContext';
import { MeetingLink } from '@/app/components/utils/linkify';
import type { CalendarEvent } from '@/types/calendar';

/**
 * The week at a glance.
 *
 * Replaces a day-picker that asked you to click through seven days to learn
 * anything. A dashboard tile is read, not operated: this answers "how heavy is
 * my week and what is next" in one look, and leaves browsing to the calendar.
 */

const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

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

/** "today" / "tomorrow" / "Thu" — a weekday alone is ambiguous this close in. */
function relativeDay(date: Date, today: Date): string {
  const days = Math.round(
    (new Date(date).setHours(0, 0, 0, 0) - new Date(today).setHours(0, 0, 0, 0)) / 86_400_000
  );
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return DAY_NAMES[(date.getDay() + 6) % 7];
}

export default function WeekDigest() {
  const { events, loading, error } = useCalendar();

  const digest = useMemo(() => {
    const now = new Date();
    const weekStart = startOfWeek(now);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);

    const inWeek = events.filter((ev) => {
      if (!ev.start || isAllDay(ev)) return false;
      const start = new Date(ev.start);
      return start >= weekStart && start < weekEnd;
    });

    // Monday-indexed buckets, so the bars line up with the labels below them.
    const perDay = Array.from({ length: 7 }, () => ({ count: 0, minutes: 0 }));
    for (const ev of inWeek) {
      const index = (new Date(ev.start).getDay() + 6) % 7;
      perDay[index].count += 1;
      perDay[index].minutes += durationMinutes(ev);
    }

    const totalMinutes = perDay.reduce((sum, d) => sum + d.minutes, 0);
    const peakMinutes = Math.max(...perDay.map((d) => d.minutes), 0);
    const busiestIndex = peakMinutes > 0 ? perDay.findIndex((d) => d.minutes === peakMinutes) : -1;

    // Only days still ahead can be "clear" — a quiet Monday is not a promise.
    const todayIndex = (now.getDay() + 6) % 7;
    const clearAhead = perDay.filter((d, i) => i >= todayIndex && d.count === 0).length;

    const next = inWeek
      .filter((ev) => new Date(ev.start).getTime() >= now.getTime())
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())[0];

    return {
      weekStart,
      weekEnd: new Date(weekEnd.getTime() - 86_400_000),
      count: inWeek.length,
      totalMinutes,
      perDay,
      peakMinutes,
      busiestIndex,
      todayIndex,
      clearAhead,
      next,
      now,
    };
  }, [events]);

  return (
    <section className="w-full">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-base-content">Week ahead</h2>
        <span className="font-mono text-[11px] text-base-content/50">
          {formatDay(digest.weekStart)} – {formatDay(digest.weekEnd)}
        </span>
      </div>

      {error ? (
        <p className="text-sm text-error">{error}</p>
      ) : loading && digest.count === 0 ? (
        <div className="h-24 animate-pulse rounded-md bg-base-200" />
      ) : digest.count === 0 ? (
        <p className="text-sm text-base-content/50">Nothing scheduled this week.</p>
      ) : (
        <>
          <p className="mb-4 text-sm text-base-content">
            <span className="font-medium">{digest.count}</span>
            {digest.count === 1 ? ' meeting' : ' meetings'}
            <span className="text-base-content/40"> · </span>
            <span className="font-medium">{formatHours(digest.totalMinutes)}</span>
            {digest.busiestIndex >= 0 && (
              <>
                <span className="text-base-content/40"> · busiest </span>
                <span className="font-medium">{DAY_NAMES[digest.busiestIndex]}</span>
              </>
            )}
          </p>

          {/* Load per day. Heights are relative to the heaviest day, so the
              shape reads as "where the week is dense", not as absolute hours. */}
          <div className="mb-4 grid grid-cols-7 items-end gap-1" style={{ height: '52px' }}>
            {digest.perDay.map((day, i) => {
              const ratio = digest.peakMinutes > 0 ? day.minutes / digest.peakMinutes : 0;
              const isToday = i === digest.todayIndex;
              const isPast = i < digest.todayIndex;
              return (
                <div key={i} className="flex h-full flex-col items-center justify-end gap-1">
                  <div
                    className={`w-full rounded-sm ${
                      isToday ? 'bg-primary' : isPast ? 'bg-base-300' : 'bg-primary/30'
                    }`}
                    style={{ height: `${Math.max(ratio * 34, day.count > 0 ? 3 : 1)}px` }}
                    title={`${DAY_NAMES[i]}: ${day.count} · ${formatHours(day.minutes)}`}
                  />
                  <span
                    className={`font-mono text-[10px] ${
                      isToday ? 'font-medium text-primary' : 'text-base-content/40'
                    }`}
                  >
                    {DAY_LABELS[i]}
                  </span>
                </div>
              );
            })}
          </div>

          {digest.next ? (
            <div className="min-w-0 border-t border-base-200 pt-3">
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
            <p className="border-t border-base-200 pt-3 text-xs text-base-content/50">
              {digest.clearAhead > 0
                ? `Nothing left this week — ${digest.clearAhead} clear ${digest.clearAhead === 1 ? 'day' : 'days'} ahead.`
                : 'Nothing left this week.'}
            </p>
          )}
        </>
      )}
    </section>
  );
}
