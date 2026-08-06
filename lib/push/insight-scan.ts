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
import type { NotificationAction, NotificationPayload } from './utils';
import { copyFor, type NotificationCopy } from './copy';

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
  payload: NotificationPayload;
};

/** HH:mm on the user's wall clock, in every language — see `formatEventTime`. */
function clock(date: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
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
  note: string | null,
  copy: NotificationCopy
): NotificationPayload {
  // A nudge is an interruption, so both ways of ending it are always offered:
  // push it to a better moment, or say it has served its purpose.
  const base = { actions: ['snooze', 'dismiss'] satisfies NotificationAction[] };

  switch (insight.kind) {
    case 'conflict':
      return {
        ...base,
        title: copy.insight.conflictTitle,
        body: copy.insight.conflictBody(
          clock(new Date(insight.b.start), tz),
          insight.a.title,
          insight.b.title,
          copy.duration(insight.overlapMinutes)
        ),
        snoozeMinutes: 30,
        data: {
          type: 'insight-conflict',
          eventId: insight.b.id,
          calendarId: insight.b.calendarId,
        },
      };

    case 'no-break':
      return {
        ...base,
        title: copy.insight.noBreakTitle,
        body: copy.insight.noBreakBody(
          copy.duration(insight.totalMinutes),
          clock(insight.start, tz),
          insight.events.length
        ),
        snoozeMinutes: 15,
        data: { type: 'insight-no-break' },
      };

    case 'person-context':
      return {
        ...base,
        title: copy.insight.personTitle(
          insight.person.name,
          clock(new Date(insight.event.start), tz)
        ),
        // The note is the entire reason to interrupt, so it gets the body.
        body: note ? note.slice(0, 160) : insight.event.title,
        snoozeMinutes: 10,
        data: {
          type: 'insight-person',
          eventId: insight.event.id,
          calendarId: insight.event.calendarId,
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
  locale?: string | null;
}): ScheduledInsight[] {
  const { events, notes, now, tz, quietHours } = params;
  const copy = copyFor(params.locale);

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
        : null,
      copy
    ),
  }));
}
