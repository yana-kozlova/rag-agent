import { normalizeSymptoms } from './scale';

/**
 * Check-ins → one point per day, which is what a chart can draw.
 *
 * Pure and DB-free: the aggregation rules below are opinions, not facts, and
 * they need to be readable and testable without a database standing behind
 * them.
 */

export type EntryLike = {
  recordedAt: Date | string;
  localDate: string;
  mood: number | null;
  energy: number | null;
  sleepMinutes: number | null;
  symptoms: string[] | null;
};

export type DayPoint = {
  date: string;
  /** Mean of the day's check-ins, one decimal. Null when none mentioned it. */
  mood: number | null;
  energy: number | null;
  /** Last value reported for that day, not a mean — see `foldDay`. */
  sleepMinutes: number | null;
  symptoms: string[];
  entryCount: number;
};

/** Inclusive, ascending, in YYYY-MM-DD. Built on Date.UTC so no zone leaks in. */
export function enumerateDates(from: string, to: string): string[] {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return [];

  const out: string[] = [];
  const DAY = 86_400_000;

  // A guard rather than a feature: an unbounded range would be a memory bug
  // reachable from a query string.
  for (let t = start; t <= end && out.length < 1000; t += DAY) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }

  return out;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return Math.round((sum / values.length) * 10) / 10;
}

function toMillis(value: Date | string): number {
  return value instanceof Date ? value.getTime() : Date.parse(value);
}

/**
 * One day's check-ins, folded into one point.
 *
 * Mood and energy are averaged: they were genuinely different at different
 * hours, and the day as a whole was the middle of that.
 *
 * Sleep is not. It describes a single night — the one before this day — so two
 * values for it are a correction, not two measurements, and the later one wins.
 * Averaging "6" and a corrected "6.5" would produce 6.25, a night nobody slept.
 */
function foldDay(date: string, entries: EntryLike[]): DayPoint {
  const ordered = [...entries].sort((a, b) => toMillis(a.recordedAt) - toMillis(b.recordedAt));

  const moods = ordered.map((e) => e.mood).filter((v): v is number => typeof v === 'number');
  const energies = ordered.map((e) => e.energy).filter((v): v is number => typeof v === 'number');

  const sleeps = ordered
    .map((e) => e.sleepMinutes)
    .filter((v): v is number => typeof v === 'number');

  return {
    date,
    mood: mean(moods),
    energy: mean(energies),
    sleepMinutes: sleeps.length > 0 ? sleeps[sleeps.length - 1] : null,
    symptoms: normalizeSymptoms(ordered.flatMap((e) => e.symptoms ?? [])),
    entryCount: ordered.length,
  };
}

/**
 * A continuous series over [from, to], with days that hold no check-in present
 * but empty.
 *
 * The gaps are the point. A line drawn straight from the 3rd to the 19th claims
 * a fortnight of steady mood that was never measured; an empty day renders as a
 * break instead, and "I stopped logging when things got bad" stays visible.
 */
export function buildDailySeries(
  entries: EntryLike[],
  from: string,
  to: string
): DayPoint[] {
  const byDate = new Map<string, EntryLike[]>();

  for (const entry of entries) {
    if (entry.localDate < from || entry.localDate > to) continue;
    const list = byDate.get(entry.localDate) ?? [];
    list.push(entry);
    byDate.set(entry.localDate, list);
  }

  return enumerateDates(from, to).map((date) => {
    const forDay = byDate.get(date);
    return forDay
      ? foldDay(date, forDay)
      : { date, mood: null, energy: null, sleepMinutes: null, symptoms: [], entryCount: 0 };
  });
}

export type SymptomCount = { symptom: string; days: number };

/**
 * How many *days* each symptom showed up on — not how many check-ins mentioned
 * it. Saying "болить голова" three times in one afternoon is one bad day, and
 * counting it as three would rank whichever symptom the user complains about
 * most volubly, rather than the one that persists.
 */
export function symptomDayCounts(days: DayPoint[]): SymptomCount[] {
  const counts = new Map<string, number>();

  for (const day of days) {
    for (const symptom of day.symptoms) {
      counts.set(symptom, (counts.get(symptom) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([symptom, count]) => ({ symptom, days: count }))
    .sort((a, b) => b.days - a.days || a.symptom.localeCompare(b.symptom));
}

export type RangeSummary = {
  daysLogged: number;
  entryCount: number;
  avgMood: number | null;
  avgEnergy: number | null;
  avgSleepMinutes: number | null;
  bestDay: DayPoint | null;
  worstDay: DayPoint | null;
};

/** Headline numbers for the range. Averages skip unlogged days rather than treating them as zero. */
export function summarizeRange(days: DayPoint[]): RangeSummary {
  const logged = days.filter((d) => d.entryCount > 0);
  const rated = logged.filter((d): d is DayPoint & { mood: number } => d.mood !== null);

  const sorted = [...rated].sort((a, b) => a.mood - b.mood);

  return {
    daysLogged: logged.length,
    entryCount: logged.reduce((sum, d) => sum + d.entryCount, 0),
    avgMood: mean(rated.map((d) => d.mood)),
    avgEnergy: mean(
      logged.map((d) => d.energy).filter((v): v is number => typeof v === 'number')
    ),
    avgSleepMinutes: mean(
      logged.map((d) => d.sleepMinutes).filter((v): v is number => typeof v === 'number')
    ),
    bestDay: sorted.length > 0 ? sorted[sorted.length - 1] : null,
    worstDay: sorted.length > 0 ? sorted[0] : null,
  };
}

/** Below this the two averages are noise, and printing them invites a conclusion the data cannot carry. */
const MIN_DAYS_PER_BUCKET = 5;

export type SleepMoodSplit = {
  thresholdMinutes: number;
  shortNights: { days: number; avgMood: number };
  longNights: { days: number; avgMood: number };
};

/**
 * Average mood on days following a short night versus a long one.
 *
 * Sleep is paired with the day it is logged for, because a night is reported by
 * the morning after it — the sleep that shaped that day.
 *
 * Returns null unless both buckets hold enough days. This is the whole reason
 * the function exists rather than the caller doing it inline: a split computed
 * from two nights reads exactly like a finding, and there is nothing here to
 * stop someone acting on it.
 */
export function sleepMoodSplit(
  days: DayPoint[],
  thresholdMinutes = 7 * 60
): SleepMoodSplit | null {
  const paired = days.filter(
    (d): d is DayPoint & { mood: number; sleepMinutes: number } =>
      d.mood !== null && d.sleepMinutes !== null
  );

  const short = paired.filter((d) => d.sleepMinutes < thresholdMinutes);
  const long = paired.filter((d) => d.sleepMinutes >= thresholdMinutes);

  if (short.length < MIN_DAYS_PER_BUCKET || long.length < MIN_DAYS_PER_BUCKET) return null;

  const shortAvg = mean(short.map((d) => d.mood));
  const longAvg = mean(long.map((d) => d.mood));
  if (shortAvg === null || longAvg === null) return null;

  return {
    thresholdMinutes,
    shortNights: { days: short.length, avgMood: shortAvg },
    longNights: { days: long.length, avgMood: longAvg },
  };
}
