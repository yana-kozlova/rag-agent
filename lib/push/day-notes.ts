import { findRelevantContent } from '@/lib/ai/embedding';
import type { CalendarEvent } from './calendar-window';

/**
 * The user's saved notes that relate to a given day.
 *
 * Hoisted out of the briefing so the morning pass performs exactly one
 * retrieval. The briefing and the proactive scan both want "what did I write
 * down about today", and each running its own search would double the embedding
 * cost to answer the same question twice.
 */

export type DayNote = { text: string };

/** Attendee names widen the query so notes filed under a person are reachable. */
function queryFor(events: CalendarEvent[]): string {
  const titles = events.map((e) => e.title);

  const names = new Set<string>();
  for (const event of events) {
    for (const attendee of event.attendees ?? []) {
      if (attendee.self) continue;
      const name = attendee.displayName?.trim();
      if (name) names.add(name);
    }
  }

  return [...titles, ...names].join(', ');
}

/**
 * One retrieval for the whole day. Returns an empty list rather than throwing:
 * notes are enrichment, and losing them must not cost the user their briefing.
 */
export async function fetchDayNotes(
  userId: string,
  events: CalendarEvent[],
  limit = 6
): Promise<DayNote[]> {
  if (events.length === 0) return [];

  try {
    const relevant = await findRelevantContent(queryFor(events), userId, {
      caller: 'push/day-notes',
    });

    if (!Array.isArray(relevant)) return [];

    return relevant
      .slice(0, limit)
      .map((r: any) => ({ text: String(r.name ?? r.content ?? '').trim() }))
      .filter((n) => n.text.length > 0);
  } catch (error) {
    console.error('[push/day-notes] Retrieval failed:', error);
    return [];
  }
}
