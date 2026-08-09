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

export type DayNote = {
  text: string;
  /**
   * When the note was written, ISO date. Optional because the proactive scan
   * matches on text alone and has no use for it; null when retrieval returned
   * no usable date.
   */
  writtenOn?: string | null;
};

/**
 * How close a note must sit to the day before it counts as being about it.
 *
 * `findRelevantContent` returns its top *k* by construction: ask it about a day
 * whose only event is one person's name and it answers with the six nearest
 * notes in the base, because six is what it was asked for — not because any of
 * them concerns today. Handed on under the heading "notes that may be relevant"
 * those become the model's raw material, and it duly works one in.
 *
 * The floor is higher than `getInformation`'s, and deliberately: there a
 * marginal hit answers a question the user asked and can be ignored on sight,
 * here it becomes an unprompted assertion about their morning. Nobody asked, so
 * the bar to say anything at all is higher.
 *
 * Unlike `getInformation` this does not wave lexical-only hits through. That
 * rule exists so a surname or an invoice number stays reachable, and it is
 * sound when the query is a question. This query is a calendar title: "День
 * народження: Ельвіра" reduces to `ден:*`, which matches most of a Ukrainian
 * knowledge base on a word carrying no meaning here at all.
 */
const MIN_SIMILARITY = 0.55;

/**
 * A wellbeing check-in, which is never briefing material.
 *
 * `syncDayNote` files each day's check-ins as an ordinary resource so retrieval
 * can reach them — that is the whole point of storing state twice. But a
 * check-in records one moment and is stale by design; that is why there is a
 * row per check-in and not per day. Retrieved days later and repeated in the
 * present tense, "mood was poor, coffee helped" becomes a claim about a morning
 * it was never about.
 *
 * Genre, not staleness, is the reason to drop it: a check-in from today is no
 * better here. The tracker records and does not assess, and a briefing that
 * opens by narrating the user's mood back at them has crossed into assessing —
 * unasked, at breakfast, on the most sensitive content in the base.
 *
 * Resource chunks are inserted without metadata of their own, so the `metadata`
 * retrieval returns for one is the resource's — where `syncDayNote` puts the
 * category. Tags are checked too, since they are what the older rows carry.
 */
function isCheckIn(result: any): boolean {
  const metadata = result?.metadata;
  if (!metadata || typeof metadata !== 'object') return false;
  if (metadata.category === 'wellbeing') return true;

  const tags = metadata.tags;
  return Array.isArray(tags) && tags.some((t: unknown) => t === 'wellbeing' || t === 'check-in');
}

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

/** The ISO date a note was written, or null if retrieval returned no usable one. */
function writtenOn(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

/**
 * One retrieval for the whole day. Returns an empty list rather than throwing:
 * notes are enrichment, and losing them must not cost the user their briefing.
 *
 * Returning nothing is an ordinary outcome, not a failure. Most days hold
 * nothing written down about them, and the briefing is better for saying less.
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
      .filter((r: any) => !isCheckIn(r))
      .filter((r: any) => (typeof r.similarity === 'number' ? r.similarity : 0) >= MIN_SIMILARITY)
      .slice(0, limit)
      .map((r: any) => ({
        text: String(r.content ?? '').trim(),
        writtenOn: writtenOn(r.createdAt),
      }))
      .filter((n) => n.text.length > 0);
  } catch (error) {
    console.error('[push/day-notes] Retrieval failed:', error);
    return [];
  }
}
