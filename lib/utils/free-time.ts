import { isTimeBlock } from '@/lib/utils/calendars';

/**
 * The gaps between commitments, computed rather than subtracted in the reply.
 *
 * "Скільки в мене завтра вільного часу" had no tool behind it: `getEvents`
 * returned a list and the model worked out the gaps itself. That is arithmetic
 * wearing the clothes of a judgement, and it is the third time the same shape
 * has gone wrong here — the weekday was derived and came back two days out, the
 * night guard was measured on the server's clock. Subtracting five pairs of
 * times and summing the remainder is strictly harder than either.
 *
 * Dependency-free for the usual reason: the tool layer and any client view can
 * both import it without pulling `googleapis` along.
 */

export type FreeTimeEvent = {
  start?: string;
  end?: string;
  allDay: boolean;
  transparency?: string | null;
  eventType?: string | null;
  attendees?: Array<{ self?: boolean | null; responseStatus?: string | null }>;
};

export type FreeWindow = {
  /** Local wall clock, HH:mm. */
  from: string;
  to: string;
  minutes: number;
};

export type FreeDay = {
  /** YYYY-MM-DD, the local date these windows belong to. */
  date: string;
  windows: FreeWindow[];
  totalMinutes: number;
};

/** Waking hours. Free time at 04:00 is not free time anyone can use. */
export const DAY_START_HOUR = 8;
export const DAY_END_HOUR = 22;

/** Anything shorter is a turnaround between two things, not a gap. */
export const MIN_WINDOW_MINUTES = 15;

/** Minutes since local midnight, read out of the offset the event carries. */
function minutesOf(iso: string): number | null {
  const m = iso.match(/T(\d{2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function dateOf(iso: string): string | null {
  return iso.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
}

function hhmm(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Whether an event takes a bite out of the day.
 *
 * The same three exemptions the conflict check and the notification path use,
 * because a day is not fuller for a birthday sitting on it, and a block marked
 * Free says in as many words that the time is not spoken for.
 */
function occupies(e: FreeTimeEvent): boolean {
  if (e.allDay) return false;
  if (isTimeBlock(e)) return false;
  if ((e.attendees ?? []).some((a) => a.self === true && a.responseStatus === 'declined')) return false;
  return Boolean(e.start && e.end);
}

/**
 * Free windows per local day, from events already fetched for that range.
 *
 * Overlapping and back-to-back events are merged before the gaps are taken, or
 * two meetings sharing a minute would manufacture a window nobody has.
 */
export function freeTimeByDay(events: FreeTimeEvent[]): FreeDay[] {
  const byDate = new Map<string, Array<{ from: number; to: number }>>();

  // Every date present in the range gets an entry, even when nothing on it
  // occupies time. A day holding only a birthday and a declined invitation is
  // an entirely free day, and saying nothing about it is indistinguishable
  // from the day not having been asked about.
  for (const e of events) {
    const date = e.start ? dateOf(e.start) : null;
    if (date && !byDate.has(date)) byDate.set(date, []);
  }

  for (const e of events) {
    if (!occupies(e)) continue;
    const date = dateOf(e.start!);
    const from = minutesOf(e.start!);
    const to = minutesOf(e.end!);
    if (!date || from === null || to === null) continue;
    // An event running past midnight is clipped at the day's edge: the part
    // after it belongs to a day this range may not even cover.
    const clipped = { from, to: to <= from ? DAY_END_HOUR * 60 : to };
    byDate.get(date)!.push(clipped);
  }

  const open = DAY_START_HOUR * 60;
  const close = DAY_END_HOUR * 60;

  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, raw]) => {
      const busy = [...raw].sort((a, b) => a.from - b.from);

      const merged: Array<{ from: number; to: number }> = [];
      for (const span of busy) {
        const last = merged[merged.length - 1];
        if (last && span.from <= last.to) last.to = Math.max(last.to, span.to);
        else merged.push({ ...span });
      }

      const windows: FreeWindow[] = [];
      let cursor = open;
      for (const span of merged) {
        if (span.to <= open || span.from >= close) continue;
        if (span.from > cursor) {
          const minutes = Math.min(span.from, close) - cursor;
          if (minutes >= MIN_WINDOW_MINUTES) {
            windows.push({ from: hhmm(cursor), to: hhmm(Math.min(span.from, close)), minutes });
          }
        }
        cursor = Math.max(cursor, span.to);
      }
      if (cursor < close && close - cursor >= MIN_WINDOW_MINUTES) {
        windows.push({ from: hhmm(cursor), to: hhmm(close), minutes: close - cursor });
      }

      return {
        date,
        windows,
        totalMinutes: windows.reduce((sum, w) => sum + w.minutes, 0),
      };
    });
}

/** "3 год 45 хв" as the reply would say it, so the model never does the division. */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} хв`;
  if (m === 0) return `${h} год`;
  return `${h} год ${m} хв`;
}
