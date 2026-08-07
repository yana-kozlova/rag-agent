import { formatSleep } from './scale';

/**
 * A day's check-ins rendered as one note for the knowledge base.
 *
 * The day is the unit because that is what questions are about. One note per
 * check-in meant four rows all titled "Check-in · 2026-08-07" — four fragments
 * of one answer — and retrieval surfacing the 03:45 one alone would report that
 * the user slept badly while omitting that by evening they were fine.
 *
 * Pure, and here rather than beside the DB writes, so it can be read and tested
 * without a database or a session behind it.
 */

export type DayNoteEntry = {
  recordedAt: Date | string;
  localDate: string;
  mood: number | null;
  energy: number | null;
  sleepMinutes: number | null;
  symptoms: string[] | null;
  note: string | null;
};

function statsLine(entry: DayNoteEntry): string {
  const stats: string[] = [];
  if (entry.mood !== null) stats.push(`mood ${entry.mood}/5`);
  if (entry.energy !== null) stats.push(`energy ${entry.energy}/5`);
  if (entry.sleepMinutes !== null) stats.push(`sleep ${formatSleep(entry.sleepMinutes)}`);
  if (entry.symptoms?.length) stats.push(entry.symptoms.join(', '));

  return stats.join(' · ');
}

/**
 * Rebuilt from every entry of the day, never appended to.
 *
 * Regenerating is possible here — and appending is not good enough — because
 * the caller owns all the source rows. So there is no reason to ask a model to
 * merge prose the way `mergeNoteContent` must: no LLM call, no drift, and a
 * deleted check-in actually disappears from the note instead of lingering in
 * text nobody can edit.
 */
export function dayNoteContent(entries: DayNoteEntry[], tz: string): string {
  if (entries.length === 0) return '';

  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });

  const blocks = entries.map((entry) => {
    const stats = statsLine(entry);
    const at = time.format(new Date(entry.recordedAt));
    // The user's own words go under the heading, because they are what
    // retrieval actually matches on.
    return [[at, stats].filter(Boolean).join(' · '), entry.note?.trim()]
      .filter(Boolean)
      .join('\n');
  });

  return [`[${entries[0].localDate}]`, ...blocks].join('\n\n');
}
