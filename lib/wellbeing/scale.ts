/**
 * The vocabulary of the tracker: what a number on the scale means, and what
 * counts as the same symptom.
 *
 * Dependency-free on purpose, and the reason the bounds are defined here rather
 * than beside the column they constrain: the charts need them, the charts are
 * client components, and importing them from the schema would drag drizzle and
 * every table definition into the browser bundle. The schema imports these
 * instead — same single definition, pointing the other way.
 */

/** Both scales run 1 (worst) to 5 (best). Fixed, so an axis means the same thing in March and in October. */
export const WELLBEING_SCALE_MIN = 1;
export const WELLBEING_SCALE_MAX = 5;

/**
 * Anchors for the 1–5 scale, handed to the model in the tool description.
 *
 * Without them "нормально" lands on 3 one week and 4 the next, and a trend line
 * over a moving scale measures nothing. These are the anchors, not an
 * exhaustive mapping — the model still has to judge.
 */
export const SCALE_ANCHORS: Record<number, string> = {
  1: 'very bad — barely functional',
  2: 'bad — pushing through',
  3: 'okay — neither good nor bad',
  4: 'good',
  5: 'very good — energised',
};

export const SCALE_LABELS: Record<number, string> = {
  1: 'Very bad',
  2: 'Bad',
  3: 'Okay',
  4: 'Good',
  5: 'Very good',
};

/**
 * The same five points as a face, for the log and the summary cards.
 *
 * Beside the labels for the reason everything else here is: the page renders on
 * the server and the log is a client component, so the tracker's vocabulary has
 * to be one list either way. Decoration only — nothing is stored, matched or
 * charted from a face, and it always sits next to the number it restates.
 */
export const SCALE_FACES: Record<number, string> = {
  1: '😞',
  2: '🙁',
  3: '😐',
  4: '🙂',
  5: '😄',
};

/**
 * The face for a value that may be an average, or missing.
 *
 * Returns '' rather than a fallback face for anything off the scale: no face is
 * obviously nothing, where a wrong one reads as a rating nobody gave.
 */
export function faceFor(value: number | null | undefined): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '';
  return SCALE_FACES[Math.round(value)] ?? '';
}

export function isOnScale(value: number): boolean {
  return (
    Number.isInteger(value) && value >= WELLBEING_SCALE_MIN && value <= WELLBEING_SCALE_MAX
  );
}

/**
 * The key two spellings of one symptom share.
 *
 * "Головний біль", "головний  біль" and "головний біль." are one thing to a
 * person and three bars on a chart to a computer. Case, surrounding whitespace,
 * inner runs of whitespace and trailing punctuation are all noise here.
 * Anything beyond that — stemming, synonyms, uk/en pairs — is deliberately not
 * attempted: merging "втома" and "виснаження" is a judgement call, and getting
 * it wrong silently destroys a distinction the user drew on purpose.
 */
export function normalizeSymptom(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.,;!?]+$/u, '')
    .trim();
}

/** Normalised, de-duplicated, order-preserving. Empty strings drop out. */
export function normalizeSymptoms(raw: string[] | undefined | null): string[] {
  if (!raw?.length) return [];

  const seen = new Set<string>();
  const out: string[] = [];

  for (const item of raw) {
    const normalized = normalizeSymptom(item);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }

  return out;
}

/** Hours as spoken → minutes as stored. Rounds to the nearest minute. */
export function hoursToMinutes(hours: number): number {
  return Math.round(hours * 60);
}

export function minutesToHours(minutes: number): number {
  return minutes / 60;
}

/** "7h 20m" / "7h" — for chart labels and the tool's confirmation line. */
export function formatSleep(minutes: number): string {
  const whole = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${whole}h` : `${whole}h ${rest}m`;
}
