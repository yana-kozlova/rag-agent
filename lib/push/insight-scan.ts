import { getLocalHour } from './timezone';
import { isQuietHour, type QuietHours } from './quiet-hours';
import {
  DAILY_INSIGHT_CAP,
  buildPersonInsight,
  findConflicts,
  findNoBreakRuns,
  rankInsights,
  type DayEvent,
  type Insight,
  type PersonRef,
} from './insights';
import type { DayNote } from './day-notes';
import type { PushPayload } from './utils';

/**
 * Turns a day's calendar into the handful of notifications worth sending.
 *
 * Deliberately free of network calls. Detection is arithmetic over events the
 * morning pass already fetched, note matching is string work over notes it
 * already retrieved, and the copy is templated rather than generated — so the
 * entire proactive feature costs zero additional model calls per user per day.
 * An LLM would write nicer sentences; it would not find anything this misses,
 * and it would put a token cost on every scan that produces nothing.
 */

export type ScheduledInsight = {
  kind: string;
  dedupeKey: string;
  notifyAt: Date;
  payload: PushPayload;
};

/** HH:mm on the user's wall clock. */
function clock(date: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

/** "3h", "3h 30m", "45m" — durations as a person would say them. */
function humanDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/**
 * A saved note that mentions this person.
 *
 * Substring matching rather than a per-person vector search: the notes are
 * already in hand, and one embedding call per attendee would make a day with
 * six meetings cost six retrievals to answer a question plain text answers.
 * Tokens shorter than three characters are skipped — initials match everything.
 */
export function findNoteFor(notes: DayNote[], person: PersonRef): string | null {
  const needles = [person.name, ...person.name.split(/\s+/)]
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length >= 3);

  if (needles.length === 0) return null;

  for (const note of notes) {
    const haystack = note.text.toLowerCase();
    if (needles.some((n) => haystack.includes(n))) return note.text;
  }

  return null;
}

/** Non-self, non-resource attendees of one event. */
function peopleOn(event: DayEvent): PersonRef[] {
  const out: PersonRef[] = [];

  for (const attendee of event.attendees ?? []) {
    if (attendee.self) continue;
    if (attendee.email?.includes('resource.calendar.google.com')) continue;

    const email = attendee.email?.trim().toLowerCase() || undefined;
    const name = attendee.displayName?.trim() || attendee.email?.trim();
    if (!name) continue;

    out.push({ key: email ?? name.toLowerCase(), name, email });
  }

  return out;
}

function renderPayload(
  insight: Insight,
  tz: string,
  note: string | null
): PushPayload {
  const base = {
    icon: '/avatars/bot.svg',
    badge: '/avatars/bot.svg',
    actions: [
      { action: 'snooze', title: 'Later' },
      { action: 'dismiss', title: 'Dismiss' },
    ],
  };

  switch (insight.kind) {
    case 'conflict':
      return {
        ...base,
        title: '⚠️ Double-booked',
        body: `${clock(new Date(insight.b.start), tz)} — "${insight.a.title}" and "${insight.b.title}" overlap by ${humanDuration(insight.overlapMinutes)}`,
        tag: `insight-conflict-${insight.a.id}`,
        data: {
          url: '/',
          type: 'insight-conflict',
          eventId: insight.b.id,
          calendarId: insight.b.calendarId,
          snoozeMinutes: 30,
        },
      };

    case 'no-break':
      return {
        ...base,
        title: '🌀 No gaps ahead',
        body: `${humanDuration(insight.totalMinutes)} back-to-back from ${clock(insight.start, tz)} — ${insight.events.length} meetings, no break`,
        tag: `insight-nobreak-${insight.start.toISOString()}`,
        data: { url: '/', type: 'insight-no-break', snoozeMinutes: 15 },
      };

    case 'person-context':
      return {
        ...base,
        title: `📝 ${insight.person.name} at ${clock(new Date(insight.event.start), tz)}`,
        // The note is the entire reason to interrupt, so it gets the body.
        body: note ? note.slice(0, 160) : insight.event.title,
        tag: `insight-person-${insight.event.id}`,
        data: {
          url: '/',
          type: 'insight-person',
          eventId: insight.event.id,
          calendarId: insight.event.calendarId,
          snoozeMinutes: 10,
        },
      };
  }
}

/**
 * Everything worth telling the user about today, ready to enqueue.
 *
 * Insights whose delivery time lands inside quiet hours are dropped rather than
 * shifted: a "starting in 10 minutes" nudge moved to 08:00 is no longer true.
 */
export function scanDay(params: {
  events: DayEvent[];
  notes: DayNote[];
  now: Date;
  tz: string;
  quietHours: QuietHours;
  cap?: number;
}): ScheduledInsight[] {
  const { events, notes, now, tz, quietHours } = params;

  const insights: Insight[] = [
    ...findConflicts(events, now, tz),
    ...findNoBreakRuns(events, now, tz),
  ];

  // Notes are matched per person, but each person is only worth one insight —
  // their earliest meeting, since that is when the context is first useful.
  const noteByPerson = new Map<string, string>();
  const seenPeople = new Set<string>();

  for (const event of events) {
    for (const person of peopleOn(event)) {
      if (seenPeople.has(person.key)) continue;

      const note = findNoteFor(notes, person);
      if (!note) continue;

      const insight = buildPersonInsight(event, person, now, tz);
      if (!insight) continue;

      seenPeople.add(person.key);
      noteByPerson.set(person.key, note);
      insights.push(insight);
    }
  }

  const deliverable = insights.filter(
    (i) =>
      !isQuietHour(
        getLocalHour(i.notifyAt, tz),
        quietHours.quietHoursStart,
        quietHours.quietHoursEnd
      )
  );

  return rankInsights(deliverable, params.cap ?? DAILY_INSIGHT_CAP).map((insight) => ({
    kind: `insight-${insight.kind}`,
    dedupeKey: insight.dedupeKey,
    notifyAt: insight.notifyAt,
    payload: renderPayload(
      insight,
      tz,
      insight.kind === 'person-context'
        ? noteByPerson.get(insight.person.key) ?? null
        : null
    ),
  }));
}
