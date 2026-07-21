import type { ToolCalendarEvent } from '@/types/calendar';

export type GetEventsOutput = { events: ToolCalendarEvent[]; count: number };

/**
 * The exact text line the model has always received for one event. Kept in a
 * dependency-free module so the "model sees identical text" invariant can be
 * unit-tested without pulling in the db/calendar/session stack.
 */
export function toLlmLine(e: ToolCalendarEvent): string {
  return [
    `[Event] ${e.title}`,
    e.start && e.end ? `When: ${e.start} - ${e.end}` : undefined,
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
