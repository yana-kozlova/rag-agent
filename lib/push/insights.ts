import { getLocalDateKey } from './timezone';

/**
 * Deterministic detection of things worth interrupting the user about.
 *
 * Everything here is pure: events in, ranked insights out. Detection never
 * calls an LLM and never touches the network — the model's only job downstream
 * is turning an insight into a sentence. That split is what keeps a proactive
 * assistant cheap enough to run daily and honest enough to unit test.
 */

export type EventAttendee = {
  email?: string | null;
  displayName?: string | null;
  self?: boolean | null;
  organizer?: boolean | null;
  responseStatus?: string | null;
};

export type DayEvent = {
  id: string;
  calendarId: string;
  title: string;
  /** RFC-3339 instant, or a bare date for all-day events. */
  start: string;
  end?: string;
  allDay: boolean;
  location?: string;
  attendees?: EventAttendee[];
};

export type InsightKind = 'conflict' | 'no-break' | 'person-context';

type BaseInsight = {
  kind: InsightKind;
  /** Higher wins when the daily cap forces a choice. */
  score: number;
  /** When the push should land. */
  notifyAt: Date;
  /** Stable across re-scans of the same day, so a retry can't double-send. */
  dedupeKey: string;
};

export type ConflictInsight = BaseInsight & {
  kind: 'conflict';
  a: DayEvent;
  b: DayEvent;
  overlapMinutes: number;
};

export type NoBreakInsight = BaseInsight & {
  kind: 'no-break';
  events: DayEvent[];
  start: Date;
  end: Date;
  totalMinutes: number;
};

export type PersonContextInsight = BaseInsight & {
  kind: 'person-context';
  event: DayEvent;
  person: PersonRef;
};

export type Insight = ConflictInsight | NoBreakInsight | PersonContextInsight;

export type PersonRef = {
  /** Identity for dedupe — email when we have one, else the lowercased name. */
  key: string;
  /** What to show a human, and what to search the notes for. */
  name: string;
  email?: string;
};

/**
 * Lead times, in minutes before the thing happens.
 *
 * Conflicts are the exception: they fire at scan time rather than just before,
 * because resolving one means moving a meeting and possibly telling someone —
 * a warning ten minutes out is too late to act on.
 */
export const LEAD_MINUTES = {
  'no-break': 10,
  'person-context': 30,
} as const;

export const SCORES: Record<InsightKind, number> = {
  conflict: 100,
  'person-context': 60,
  'no-break': 40,
};

/** Default cap on proactive pushes per local day. */
export const DAILY_INSIGHT_CAP = 3;

function toDate(value?: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * An event's span as instants. Returns null for all-day events and anything
 * unparseable — both are noise for every detector here.
 */
function span(event: DayEvent): { start: Date; end: Date } | null {
  if (event.allDay) return null;
  const start = toDate(event.start);
  if (!start) return null;
  // A missing end is treated as a point in time rather than dropped, so a
  // zero-length event still anchors a back-to-back run correctly.
  const end = toDate(event.end) ?? start;
  if (end < start) return null;
  return { start, end };
}

/** Events the user said no to should not generate conflicts or crowd a run. */
export function isDeclined(event: DayEvent): boolean {
  return (event.attendees ?? []).some(
    (a) => a.self === true && a.responseStatus === 'declined'
  );
}

/** Timed, accepted events sorted by start — the input every detector wants. */
function schedulable(events: DayEvent[]): Array<DayEvent & { _span: { start: Date; end: Date } }> {
  return events
    .filter((e) => !isDeclined(e))
    .flatMap((e) => {
      const s = span(e);
      return s ? [{ ...e, _span: s }] : [];
    })
    .sort((a, b) => a._span.start.getTime() - b._span.start.getTime());
}

function minutesBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 60_000);
}

/**
 * Double-booked events.
 *
 * Pairwise over one day's events rather than a Calendar query per event: a
 * scan already holds the whole day in memory, and 20 events is 190 cheap
 * comparisons against 20 network round trips.
 */
export function findConflicts(
  events: DayEvent[],
  now: Date,
  tz: string
): ConflictInsight[] {
  const list = schedulable(events);
  const out: ConflictInsight[] = [];
  const dayKey = getLocalDateKey(now, tz);

  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];

      // Sorted by start, so once b begins after a ends nothing later can overlap a.
      if (b._span.start >= a._span.end) break;

      // Same event synced across two followed calendars is not a clash.
      if (a.id === b.id) continue;

      const overlapEnd = a._span.end < b._span.end ? a._span.end : b._span.end;
      const overlapMinutes = minutesBetween(b._span.start, overlapEnd);
      if (overlapMinutes <= 0) continue;

      const ids = [a.id, b.id].sort();
      out.push({
        kind: 'conflict',
        score: SCORES.conflict,
        notifyAt: now,
        dedupeKey: `conflict:${dayKey}:${ids[0]}:${ids[1]}`,
        a: stripSpan(a),
        b: stripSpan(b),
        overlapMinutes,
      });
    }
  }

  return out;
}

function stripSpan<T extends { _span: unknown }>(e: T): Omit<T, '_span'> {
  const { _span, ...rest } = e;
  return rest;
}

/**
 * Stretches of back-to-back commitments with no room to breathe.
 *
 * Events chain into a run while each gap stays under `gapToleranceMinutes`;
 * a run is worth flagging once it spans `minRunMinutes` and holds at least two
 * events. The two-event floor is deliberate — one long block is a workshop the
 * user already knows about, whereas five meetings stacked back to back is the
 * thing that quietly eats a day.
 */
export function findNoBreakRuns(
  events: DayEvent[],
  now: Date,
  tz: string,
  opts: { gapToleranceMinutes?: number; minRunMinutes?: number } = {}
): NoBreakInsight[] {
  const gapTolerance = opts.gapToleranceMinutes ?? 15;
  const minRun = opts.minRunMinutes ?? 180;

  const list = schedulable(events);
  if (list.length === 0) return [];

  const dayKey = getLocalDateKey(now, tz);
  const out: NoBreakInsight[] = [];

  let run = [list[0]];
  let runStart = list[0]._span.start;
  let runEnd = list[0]._span.end;

  const flush = () => {
    const totalMinutes = minutesBetween(runStart, runEnd);
    if (run.length < 2 || totalMinutes < minRun) return;

    const notifyAt = new Date(runStart.getTime() - LEAD_MINUTES['no-break'] * 60_000);

    out.push({
      kind: 'no-break',
      score: SCORES['no-break'],
      // A run already underway is still worth a nudge; just don't schedule it
      // into the past, where the drain would fire it instantly on next tick.
      notifyAt: notifyAt > now ? notifyAt : now,
      dedupeKey: `nobreak:${dayKey}:${runStart.toISOString()}`,
      events: run.map(stripSpan),
      start: runStart,
      end: runEnd,
      totalMinutes,
    });
  };

  for (const event of list.slice(1)) {
    // Overlapping and nested events count as continuous, hence the clamp at 0.
    const gap = Math.max(0, minutesBetween(runEnd, event._span.start));

    if (gap <= gapTolerance) {
      run.push(event);
      if (event._span.end > runEnd) runEnd = event._span.end;
      continue;
    }

    flush();
    run = [event];
    runStart = event._span.start;
    runEnd = event._span.end;
  }

  flush();
  return out;
}

/**
 * Other humans on today's calendar, deduped across events.
 *
 * The caller pairs each person with a notes lookup; only those with something
 * saved become insights, which is what keeps this from firing on every meeting.
 */
export function collectPeople(events: DayEvent[]): Map<string, PersonRef> {
  const people = new Map<string, PersonRef>();

  for (const event of schedulable(events)) {
    for (const attendee of event.attendees ?? []) {
      if (attendee.self) continue;
      // Rooms and equipment are attendees too, and nobody has notes on them.
      if (attendee.email?.includes('resource.calendar.google.com')) continue;

      const email = attendee.email?.trim().toLowerCase() || undefined;
      const name = attendee.displayName?.trim() || attendee.email?.trim();
      if (!name) continue;

      const key = email ?? name.toLowerCase();
      if (!people.has(key)) people.set(key, { key, name, email });
    }
  }

  return people;
}

/** Pairs a meeting with someone the user has saved notes about. */
export function buildPersonInsight(
  event: DayEvent,
  person: PersonRef,
  now: Date,
  tz: string
): PersonContextInsight | null {
  const s = span(event);
  if (!s) return null;

  const notifyAt = new Date(
    s.start.getTime() - LEAD_MINUTES['person-context'] * 60_000
  );
  // Past its useful moment — the meeting is already close or over.
  if (s.start <= now) return null;

  return {
    kind: 'person-context',
    score: SCORES['person-context'],
    notifyAt: notifyAt > now ? notifyAt : now,
    dedupeKey: `person:${getLocalDateKey(now, tz)}:${event.id}:${person.key}`,
    event,
    person,
  };
}

/**
 * Pick what actually gets sent.
 *
 * Ranked by score, then by how soon it fires, then capped. The cap is the
 * feature's whole credibility: three well-chosen pushes read as an assistant
 * paying attention, eight read as a broken app the user turns off.
 */
export function rankInsights(insights: Insight[], cap = DAILY_INSIGHT_CAP): Insight[] {
  return [...insights]
    .sort(
      (a, b) =>
        b.score - a.score || a.notifyAt.getTime() - b.notifyAt.getTime()
    )
    .slice(0, cap);
}
