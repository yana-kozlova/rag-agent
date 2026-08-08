/**
 * What a date on the timeline is, independent of the database that stores it.
 *
 * Two things have to be recorded separately, and conflating them is what makes
 * every naive "events table" wrong within a week:
 *
 *  - **How much of the date is actually known.** "Ми переїхали у 2022" is a
 *    year. "Артем народився 12 березня 2019" is a day. A column that keeps only
 *    a `date` turns the first into 1 January 2022 and then prints it back as if
 *    someone had said so. `precision` says which components of `occurredOn` are
 *    real; nothing may print a component the note never carried.
 *  - **Whether it comes round again.** A birthday is one event with a date and
 *    an endless series of anniversaries. `recurrence` is that, and it is not a
 *    kind of precision — a wedding on a known day recurs, a known-to-the-day
 *    hospital visit does not.
 *
 * The fourth precision, `day-month`, is the case that forces the split: "у
 * Андрія день народження 14 березня" gives a real day and month and no year at
 * all. The year stored alongside it is `PLACEHOLDER_YEAR` and is never shown,
 * and such a date is never placed on the historical axis — it has no origin
 * point to place, only occurrences ahead of it.
 *
 * Lives in `lib/timeline` rather than beside the column it constrains because
 * the timeline page and widget are client components, and importing from
 * `lib/db/schema/timeline.ts` would drag drizzle and every table definition into
 * the browser (same reason as `lib/wellbeing/scale.ts`).
 */

export const DATE_PRECISIONS = ['day', 'month', 'year', 'day-month'] as const;

export type DatePrecision = (typeof DATE_PRECISIONS)[number];

export const RECURRENCES = ['none', 'annual'] as const;

export type Recurrence = (typeof RECURRENCES)[number];

/**
 * The year written into `occurredOn` when only the day and month are known.
 *
 * A leap year on purpose: `--02-29` is a real birthday and has to survive being
 * stored. 1900, the other obvious choice, is not a leap year and would reject it.
 */
export const PLACEHOLDER_YEAR = 2000;

/**
 * Sanity bounds on a year. Not an opinion about history — a guard against a
 * model answering `0000` or `9999`, which sorts to one end of the axis and drags
 * the whole rendering with it.
 */
const MIN_YEAR = 1000;
const MAX_YEAR = 2200;

/** A title is a label on an axis, not a paragraph. */
export const MAX_TIMELINE_TITLE = 120;

/** Room for the one sentence of detail that makes a date worth keeping. */
export const MAX_TIMELINE_NOTE = 500;

/** How far ahead the "Coming up" surfaces look by default. */
export const UPCOMING_HORIZON_DAYS = 60;

/**
 * How far ahead the morning briefing looks. Much shorter than the page's
 * horizon: a briefing is about today, and an anniversary six weeks out
 * mentioned every morning for six weeks stops being read at all.
 */
export const BRIEFING_HORIZON_DAYS = 7;

/**
 * A rough vocabulary for what kind of date this is, used for the glyph and for
 * grouping. Deliberately *not* a closed enum in the database: the entity `type`
 * taxonomy in this codebase had to be opened for exactly this reason — a value
 * outside the list failed the whole extraction, and a date the model could not
 * classify is still a date. An unknown kind gets the fallback glyph.
 */
export const TIMELINE_KINDS = [
  'birth',
  'anniversary',
  'move',
  'trip',
  'work',
  'education',
  'health',
  'milestone',
  'loss',
  'purchase',
  'other',
] as const;

export type TimelineKind = (typeof TIMELINE_KINDS)[number];

export const TIMELINE_KIND_ICON: Record<TimelineKind, string> = {
  birth: '🎂',
  anniversary: '💞',
  move: '📦',
  trip: '✈️',
  work: '💼',
  education: '🎓',
  health: '🩺',
  milestone: '🏁',
  loss: '🕯️',
  purchase: '🛒',
  other: '📌',
};

/** Takes a plain string for the same reason `resourceTypeIcon` does: `kind` is free-form. */
export function timelineKindIcon(kind: string): string {
  return TIMELINE_KIND_ICON[kind as TimelineKind] ?? TIMELINE_KIND_ICON.other;
}

export function timelineKindLabel(kind: string): string {
  if (!kind) return 'Other';
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

/**
 * Whether this date has anything to come round *on*.
 *
 * Recurrence needs a real month and a real day. "Ми одружились у 2015" is stored
 * as `2015-01-01` because the column is a `date` and something has to go in the
 * other two components — the 1 January is padding, not a day anyone named. Left
 * alone, `recurring: true` on such a date makes `nextAnnualOccurrence` project
 * an anniversary onto New Year's Day and print "turns 11" beside it: a date the
 * note never carried, announced with the same confidence as one it did.
 *
 * `precision` already records which components are real; this is the second
 * place that has to read it. Nothing is lost by refusing — a year-only date
 * still sits on the axis under its year, which is the whole of what it meant.
 *
 * Read on both sides deliberately. The write side stops new rows being created
 * this way; the read side makes the rows already saved harmless without a
 * migration that would have to guess what the user meant.
 */
export function canRecurAnnually(precision: DatePrecision): boolean {
  return precision === 'day' || precision === 'day-month';
}

/** The parts of a stored row this module needs to do anything. */
export type DatedEvent = {
  occurredOn: string;
  precision: DatePrecision;
  recurrence: Recurrence;
};

export type DateSpec = {
  /** Always a real calendar date, so the column can be a `date` and sorting is free. */
  occurredOn: string;
  precision: DatePrecision;
};

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

/** True for `YYYY-MM-DD` that names a day that exists — 30 February does not. */
export function isValidDateKey(value: string): boolean {
  const match = DATE_KEY.exec(value);
  if (!match) return false;

  const [, y, m, d] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);

  if (year < MIN_YEAR || year > MAX_YEAR) return false;
  if (month < 1 || month > 12) return false;
  return day >= 1 && day <= daysInMonth(year, month);
}

/**
 * A date as the model or a form may write it, turned into a stored date plus the
 * honest statement of how much of it was said.
 *
 *   2019-03-12  → day        12 March 2019
 *   2022-06     → month      June 2022
 *   1985        → year       1985
 *   --03-14     → day-month  14 March, year unknown
 *
 * The `--MM-DD` form is vCard's, which is where partial birthdays have lived for
 * thirty years; there is no reason to invent a second spelling for it.
 *
 * Returns null on anything else, including dates that do not exist. A refused
 * date costs one row; a fabricated one is on the timeline forever, indexed and
 * looking exactly as trustworthy as the rest.
 */
export function parseDateSpec(input: string): DateSpec | null {
  const value = input.trim();

  const dayMonth = /^--(\d{2})-(\d{2})$/.exec(value);
  if (dayMonth) {
    const occurredOn = `${PLACEHOLDER_YEAR}-${dayMonth[1]}-${dayMonth[2]}`;
    return isValidDateKey(occurredOn) ? { occurredOn, precision: 'day-month' } : null;
  }

  if (DATE_KEY.test(value)) {
    return isValidDateKey(value) ? { occurredOn: value, precision: 'day' } : null;
  }

  const month = /^(\d{4})-(\d{2})$/.exec(value);
  if (month) {
    const occurredOn = `${month[1]}-${month[2]}-01`;
    return isValidDateKey(occurredOn) ? { occurredOn, precision: 'month' } : null;
  }

  const year = /^(\d{4})$/.exec(value);
  if (year) {
    const occurredOn = `${year[1]}-01-01`;
    return isValidDateKey(occurredOn) ? { occurredOn, precision: 'year' } : null;
  }

  return null;
}

/** The stored date written back in the notation it came in as. */
export function formatDateSpec(occurredOn: string, precision: DatePrecision): string {
  const [y, m, d] = occurredOn.split('-');
  switch (precision) {
    case 'day-month':
      return `--${m}-${d}`;
    case 'year':
      return y;
    case 'month':
      return `${y}-${m}`;
    default:
      return occurredOn;
  }
}

/**
 * The date as a person reads it, showing only the components that are real.
 *
 * Formatted in UTC deliberately. `occurredOn` is a calendar date, not an
 * instant: parsing "2019-03-12" yields UTC midnight, and rendering that in any
 * zone west of Greenwich prints the 11th — a birthday off by one day, in the one
 * place a user would notice immediately and trust nothing after.
 *
 * The locale tag is a parameter rather than a constant because the web UI is
 * English and notifications are written in `users.locale`; the same date has to
 * come out as "12 Mar 2019" in one and "12 бер 2019 р." in the other.
 */
export function formatTimelineDate(
  occurredOn: string,
  precision: DatePrecision,
  localeTag = 'en-GB'
): string {
  if (precision === 'year') return occurredOn.slice(0, 4);

  const date = new Date(`${occurredOn}T00:00:00Z`);
  const options: Intl.DateTimeFormatOptions =
    precision === 'month'
      ? { month: 'long', year: 'numeric' }
      : precision === 'day-month'
        ? { day: 'numeric', month: 'short' }
        : { day: 'numeric', month: 'short', year: 'numeric' };

  return new Intl.DateTimeFormat(localeTag, { ...options, timeZone: 'UTC' }).format(date);
}

/** Whole days from one calendar date to another. Negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/**
 * The same month and day in the given year.
 *
 * 29 February falls back to the 28th rather than forward to 1 March: an
 * anniversary belongs to the month it was named in, and a reminder that arrives
 * in March for a February date reads as a bug three years out of four.
 */
function sameDayInYear(year: number, month: number, day: number): string {
  const clamped = Math.min(day, daysInMonth(year, month));
  return `${pad(year, 4)}-${pad(month)}-${pad(clamped)}`;
}

/**
 * The next time this date comes round, on or after `today`.
 *
 * On-or-after, not strictly after: the whole point of the day itself is to be
 * told about it on the day.
 */
export function nextAnnualOccurrence(occurredOn: string, today: string): string {
  const [, month, day] = occurredOn.split('-').map(Number);
  const thisYear = Number(today.slice(0, 4));

  const candidate = sameDayInYear(thisYear, month, day);
  return candidate >= today ? candidate : sameDayInYear(thisYear + 1, month, day);
}

export type TimelineOccurrence<T> = {
  event: T;
  /** The day it lands on — a projection for annual dates, the date itself otherwise. */
  date: string;
  daysAway: number;
  /**
   * How many years are completed that day, when the original year is known.
   * Null for `day-month` dates, where there is nothing to count from: the point
   * of that precision is that nobody said which year it started.
   */
  years: number | null;
};

/**
 * What is coming, soonest first: annual dates projected forward, one-off dates
 * that have not happened yet.
 *
 * Past one-off dates are absent by construction — they belong to the axis, and a
 * "coming up" list that includes last year's move is not a list of anything.
 */
export function upcomingOccurrences<T extends DatedEvent>(
  events: T[],
  today: string,
  horizonDays = UPCOMING_HORIZON_DAYS
): TimelineOccurrence<T>[] {
  const occurrences: TimelineOccurrence<T>[] = [];

  for (const event of events) {
    // Not `recurrence === 'annual'` alone: a row saved as annual on a year- or
    // month-precision date cannot be projected without inventing the day it
    // lands on. Such a row is read as the one-off it really is.
    const recurs = event.recurrence === 'annual' && canRecurAnnually(event.precision);

    const date = recurs ? nextAnnualOccurrence(event.occurredOn, today) : event.occurredOn;

    const daysAway = daysBetween(today, date);
    if (daysAway < 0 || daysAway > horizonDays) continue;

    const years =
      recurs && event.precision !== 'day-month'
        ? Number(date.slice(0, 4)) - Number(event.occurredOn.slice(0, 4))
        : null;

    occurrences.push({ event, date, daysAway, years });
  }

  return occurrences.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * The historical axis, grouped into years, most recent first.
 *
 * `day-month` dates are dropped rather than sorted: their year is a placeholder,
 * so placing them would file every undated birthday under the year 2000 next to
 * whatever really happened then.
 */
export function groupByYear<T extends { occurredOn: string; precision: DatePrecision }>(
  events: T[]
): { year: string; items: T[] }[] {
  const groups = new Map<string, T[]>();

  for (const event of events) {
    if (event.precision === 'day-month') continue;
    const year = event.occurredOn.slice(0, 4);
    const bucket = groups.get(year);
    if (bucket) bucket.push(event);
    else groups.set(year, [event]);
  }

  return [...groups.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([year, items]) => ({
      year,
      items: items.sort((a, b) => b.occurredOn.localeCompare(a.occurredOn)),
    }));
}

/**
 * How a date is keyed for "have I already got this one?".
 *
 * Same day, same subject, same kind is the same event however it was worded —
 * this is the analogue of `(user_id, normalized_name, type)` on entities, and it
 * exists for the same reason: two notes mentioning that Artem was born on the
 * same day must not put two births on the axis.
 */
export function subjectKey(subject: string | null | undefined): string {
  return (subject ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Whether a date in a note's `metadata.dates` is the row that was just deleted.
 *
 * Compared by parsed date rather than by the string as written: the note may
 * hold `1985` where the row holds `1985-01-01`, and those are one date said at
 * two precisions. An entry whose spec no longer parses is kept — it was never
 * on the axis to be deleted, and dropping it here would quietly edit the note.
 */
export function isSameStoredDate(
  entry: ExtractedDate,
  target: { occurredOn: string; title: string }
): boolean {
  const spec = entry?.date ? parseDateSpec(String(entry.date)) : null;
  if (!spec || spec.occurredOn !== target.occurredOn) return false;

  return (entry.title ?? '').trim().toLowerCase() === target.title.trim().toLowerCase();
}

/**
 * The most dates one note may contribute.
 *
 * A note about a life produces two or three. A document about a war produces
 * forty, none of which are the user's — and forty rows from one import would be
 * most of the axis. The cap is a guard against a note like that being the loudest
 * thing on the page, not a claim that no note has more to say.
 */
export const MAX_DATES_PER_NOTE = 12;

/** A date as extraction hands it over, before anything has been checked. */
export type ExtractedDate = {
  date?: string | null;
  title?: string | null;
  kind?: string | null;
  subject?: string | null;
  note?: string | null;
  recurring?: boolean | null;
};

/** A date that has survived checking, in the shape the row is written from. */
export type TimelineCandidate = {
  occurredOn: string;
  precision: DatePrecision;
  recurrence: Recurrence;
  title: string;
  kind: string;
  note: string | null;
  subject: string | null;
  subjectKey: string;
};

/**
 * Everything between what extraction returned and what becomes a row on the
 * axis: unparseable dates dropped, titles capped, duplicates within one note
 * collapsed. Pure, so the rules can be tested without a database — the same
 * arrangement as `toGraphCandidates`.
 *
 * A `day-month` date is forced to annual regardless of what the model said. It
 * has no year to have happened in, so the only thing it can mean is a date that
 * comes round; the database says so too, and disagreeing with it here would
 * simply raise.
 */
export function toTimelineCandidates(dates: ExtractedDate[]): TimelineCandidate[] {
  const unique = new Map<string, TimelineCandidate>();

  for (const raw of dates ?? []) {
    const title = (raw?.title ?? '').trim().slice(0, MAX_TIMELINE_TITLE);
    if (!title || !raw?.date) continue;

    const spec = parseDateSpec(String(raw.date));
    if (!spec) continue;

    const subject = raw.subject?.trim() || null;
    const kind = (raw.kind ?? '').trim().toLowerCase() || 'other';
    const note = raw.note?.trim().slice(0, MAX_TIMELINE_NOTE) || null;

    const candidate: TimelineCandidate = {
      occurredOn: spec.occurredOn,
      precision: spec.precision,
      // `day-month` is forced annual (it can mean nothing else); anything the
      // model marked recurring is honoured only when the date has a month and a
      // day to recur on — see `canRecurAnnually`.
      recurrence:
        canRecurAnnually(spec.precision) &&
        (spec.precision === 'day-month' || raw.recurring === true)
          ? 'annual'
          : 'none',
      title,
      kind,
      note,
      subject,
      subjectKey: subjectKey(subject),
    };

    unique.set(
      `${candidate.occurredOn}::${candidate.kind}::${candidate.subjectKey}::${title.toLowerCase()}`,
      candidate
    );
  }

  return [...unique.values()].slice(0, MAX_DATES_PER_NOTE);
}
