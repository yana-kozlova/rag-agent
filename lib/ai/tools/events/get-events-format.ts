import type { ToolCalendarEvent } from '@/types/calendar';

export type GetEventsOutput = { events: ToolCalendarEvent[]; count: number };

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

/**
 * The weekday an event falls on, worked out here rather than by the model.
 *
 * The line used to carry a bare ISO timestamp, so naming the day was left to
 * arithmetic the model had to do in its head — and it listed a whole week two
 * days out, calling Tuesday the 18th a Thursday and shifting every day after
 * it. This is the same rule the briefing already follows: anything derived from
 * a date is computed by the application, because a model asked to restate one
 * eventually restates it wrong, and a schedule that names the wrong day is
 * worse than one that names none.
 *
 * Read off the first ten characters rather than through `Date`: that prefix is
 * already the local date in the event's own offset, while parsing the whole
 * string and asking for a weekday answers in the server's zone — UTC on
 * Vercel — which lands on the day before for anything before 03:00 in Kyiv.
 */
export function weekdayOf(startOrDate: string): string | undefined {
  const m = startOrDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return undefined;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (isNaN(d.getTime())) return undefined;
  return WEEKDAYS[d.getUTCDay()];
}

/**
 * The exact text line the model has always received for one event. Kept in a
 * dependency-free module so the "model sees identical text" invariant can be
 * unit-tested without pulling in the db/calendar/session stack.
 */
export function toLlmLine(e: ToolCalendarEvent): string {
  const weekday = e.start ? weekdayOf(e.start) : undefined;
  return [
    `[Event] ${e.title}`,
    e.start && e.end ? `When: ${e.start} - ${e.end}` : undefined,
    weekday ? `Day: ${weekday}` : undefined,
    // Named so the model can present it as the standing block it is instead of
    // repeating it as a commitment on every day of the week.
    e.timeBlock ? 'Note: marked Free — a standing block, not a commitment' : undefined,
    e.location ? `Location: ${e.location}` : undefined,
    e.description ? `Description: ${e.description}` : undefined,
  ].filter(Boolean).join('. ');
}

/**
 * What the LLM receives: the legacy JSON array of text lines, byte-identical to
 * the pre-refactor string[] return. The rich `events` payload is UI-only.
 */
export function eventsToModelOutput(output: GetEventsOutput) {
  return { type: 'json' as const, value: output.events.map(toLlmLine) };
}
