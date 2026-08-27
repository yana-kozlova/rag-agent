import type { ColumnLike } from '@/lib/utils/table-columns';
import {
  MAX_LABEL_LENGTH,
  asksMoreThanItKnows,
  sanitizeLabel,
  type QuickField,
} from './quick-actions';

/**
 * The routine a table is already recording, read out of the rows themselves.
 *
 * A quick action was only ever created when someone thought to ask for one, and
 * the model had to infer the template from the conversation in front of it —
 * which is how "Арчі — ліки" came out as three questions about values that had
 * been sitting in the table, identical, for a fortnight. The repetition is not
 * something to remember or guess at: it is *in the data*, and the only thing
 * missing was something that looks.
 *
 * So this reads the recent rows and answers one question — is the user writing
 * the same row over and over, and if so, which parts of it never change? The
 * answer is a ready-made template: literals for what repeats, a date stamp for
 * the day, and a question only for a column that genuinely differs every time
 * and is genuinely filled. It is the same shape `createQuickAction` takes, so
 * an offer accepted needs no second act of inference.
 *
 * Deliberately pure — rows in, template out. The table page already holds the
 * rows it needs, and `addTableRows` can afford one query to fetch them; neither
 * wants a detector that talks to a database, and a rule about the user's own
 * data is a rule that has to be testable without one.
 */

/** How far back to look. A routine that stopped in spring is not a routine. */
const MAX_ROWS_SCANNED = 60;

/**
 * How many identical rows make a habit.
 *
 * Three, on three different days. Two is a coincidence and a same-day pair is
 * one event recorded twice — the thing being detected is "every day", so the
 * days are counted rather than the rows.
 */
const MIN_OCCURRENCES = 3;
const MIN_DISTINCT_DAYS = 3;

/**
 * Above this share of distinct values, a column is one that *varies* and is
 * therefore no part of the template's identity — a temperature, a weight, the
 * note about how it went. Below it, the column is what makes this row that
 * routine rather than another one.
 */
const VARYING_RATIO = 0.5;

/**
 * A varying column becomes a question only if it is usually filled in. One that
 * is mostly blank is a column the routine does not use, and asking for it every
 * press would be inventing work the user never did.
 */
const FILLED_RATIO = 0.6;

/**
 * How many questions an *offered* routine may carry.
 *
 * One, and only for a measurement. This is stricter than
 * `asksMoreThanItKnows`, which governs a button the user asked for: here the
 * app is interrupting unprompted, so the offer has to be a button worth
 * pressing without reading it. "Хочеш кнопку, яка питатиме хто і що?" is noise —
 * and it is also what a table of genuinely different rows looks like from the
 * inside, which is precisely the case this must decline rather than dress up.
 */
const MAX_SUGGESTED_ASKS = 1;

/**
 * How much of the group has to date a row to the day it was written before that
 * column is read as "when this happened" rather than as data.
 *
 * Without the check, a table with an expiry date or a due date would have that
 * column stamped with today's date on every press — silently wrong in a way
 * nobody would look for.
 */
const STAMP_RATIO = 0.6;

/** One stored row, as both callers already have it. */
export type ScannedRow = {
  rowData: Record<string, unknown>;
  createdAt: Date | string;
};

export type RepeatingRow = {
  /** Ready for `createQuickAction` — same shape, same meanings. */
  fields: QuickField[];
  /** A button face built from the values that repeat: "Арчі — ліки". */
  label: string;
  /** The repeating values, in column order, for saying what was noticed. */
  values: string[];
  /** Rows matching the template. */
  occurrences: number;
  /** Distinct days those rows fall on — what makes it a routine. */
  days: number;
  /**
   * Stable identity of this routine. Two detections of the same habit produce
   * the same string, and a habit whose values change produces a different one —
   * which is what lets a dismissal be remembered without silencing the next,
   * genuinely different, suggestion.
   */
  signature: string;
};

function isEmpty(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === 'string' && value.trim() === '')
  );
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : String(value);
}

/** The UTC day a row was written. Only ever compared against another day. */
function dayOf(when: Date | string): string | null {
  const date = when instanceof Date ? when : new Date(when);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

/**
 * Whether a stored date sits on or beside the day the row was written.
 *
 * A day either side is close enough: the stored value is a local calendar date
 * and `created_at` is a UTC instant, so a row written at 01:00 in Kyiv carries
 * a date one ahead of its own timestamp. Being wrong about that would cost the
 * date stamp on exactly the late-night entries this is meant to serve.
 */
function datesTheSameDay(stored: unknown, createdAt: Date | string): boolean {
  if (isEmpty(stored)) return false;
  const written = dayOf(createdAt);
  const value = asText(stored).slice(0, 10);
  if (!written || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const gap = Math.abs(Date.parse(`${value}T00:00:00Z`) - Date.parse(`${written}T00:00:00Z`));
  return gap <= 24 * 60 * 60 * 1000;
}

/**
 * Whether a date column records *when this happened* rather than holding data.
 *
 * Two ways to earn it, because there are two ways the same routine gets
 * written. Logged as it happens, the value sits on the day the row was created.
 * Filled in afterwards — "я всі ці дні давала Арчі ліки" — every row is created
 * this afternoon and the dates are the user's own account of the fortnight; what
 * gives it away then is that they are nearly all different, where an expiry or a
 * due date repeats across the routine it belongs to.
 */
function isDayStamp(columnId: string, group: ScannedRow[]): boolean {
  const written = group.filter((row) => datesTheSameDay(row.rowData[columnId], row.createdAt));
  if (written.length >= group.length * STAMP_RATIO) return true;

  const distinct = new Set(
    group
      .map((row) => asText(row.rowData[columnId]).slice(0, 10))
      .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
  );
  return distinct.size >= group.length * STAMP_RATIO;
}

/**
 * The identity of a template: which columns it fills, how, and with what.
 *
 * Shared with the callers so "this routine already has a button" is decided by
 * the same string on both sides. Comparing labels would not do it — the user
 * renames a button — and comparing field arrays by hand is how two callers end
 * up disagreeing about whether a `null` value equals a missing one.
 */
export function signatureOf(fields: QuickField[]): string {
  return JSON.stringify(
    [...fields]
      .sort((a, b) => a.columnId.localeCompare(b.columnId))
      .map((f) => [f.columnId, f.kind, f.kind === 'fixed' ? (f.value ?? null) : null])
  );
}

/**
 * The routine a table is recording that has no button yet.
 *
 * `taken` is the signature of every quick action already on this table, and it
 * is passed *in* rather than used to filter the answer afterwards, because the
 * two are not the same thing. A table records more than one routine — the
 * morning dose and the evening one, the dog's medicine and the user's vitamins
 * — and the busiest group is the busiest group every day from now on. Answering
 * with it and letting the caller discard it as covered meant accepting one
 * offer silenced the page for good, with the second routine sitting there in
 * the rows being written by hand. So the groups are walked in size order and
 * the first uncovered one is the answer.
 */
export function detectRepeatingRow(
  columns: ColumnLike[],
  rows: ScannedRow[],
  taken: Iterable<string> = []
): RepeatingRow | null {
  const scanned = [...rows]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, MAX_ROWS_SCANNED);

  if (scanned.length < MIN_OCCURRENCES) return null;

  const dateIds = new Set(columns.filter((c) => c.type === 'date').map((c) => c.id));
  const rest = columns.filter((c) => !dateIds.has(c.id));

  // A column with a value for nearly every row is data; one that keeps saying
  // the same thing is identity. The split decides what the rows are grouped on.
  const varying = new Set<string>();
  for (const column of rest) {
    const distinct = new Set(
      scanned.map((row) => row.rowData[column.id]).filter((v) => !isEmpty(v)).map(asText)
    );
    if (distinct.size > Math.max(2, scanned.length * VARYING_RATIO)) varying.add(column.id);
  }

  const keyColumns = rest.filter((c) => !varying.has(c.id));
  if (keyColumns.length === 0) return null;

  const groups = new Map<string, ScannedRow[]>();
  for (const row of scanned) {
    const key = JSON.stringify(
      keyColumns.map((c) => (isEmpty(row.rowData[c.id]) ? '' : asText(row.rowData[c.id])))
    );
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  const covered = new Set(taken);

  for (const group of [...groups.values()].sort((a, b) => b.length - a.length)) {
    if (group.length < MIN_OCCURRENCES) continue;
    const template = templateFor(columns, dateIds, varying, group);
    if (template && !covered.has(template.signature)) return template;
  }

  return null;
}

/** One group of identical rows, as a template — or null if it is not a routine. */
function templateFor(
  columns: ColumnLike[],
  dateIds: Set<string>,
  varying: Set<string>,
  group: ScannedRow[]
): RepeatingRow | null {
  const sample = group[0].rowData;
  const fields: QuickField[] = [];
  const values: string[] = [];
  /** Days named by a stamp column, which outrank the days rows were written. */
  let statedDays: Set<string> | null = null;

  for (const column of columns) {
    if (dateIds.has(column.id)) {
      if (!isDayStamp(column.id, group)) continue;
      fields.push({ columnId: column.id, kind: 'today' });
      statedDays ??= new Set(
        group
          .map((row) => asText(row.rowData[column.id]).slice(0, 10))
          .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
      );
      continue;
    }

    if (varying.has(column.id)) {
      const filled = group.filter((row) => !isEmpty(row.rowData[column.id])).length;
      if (filled >= group.length * FILLED_RATIO) {
        fields.push({ columnId: column.id, kind: 'ask', prompt: column.name });
      }
      continue;
    }

    if (isEmpty(sample[column.id])) continue;

    const value = sample[column.id] as string | number | boolean;
    fields.push({ columnId: column.id, kind: 'fixed', value });
    values.push(asText(value));
  }

  // How many days this happened on. The row's own date column is the better
  // witness where there is one: filling a fortnight's log in one sitting writes
  // every row today, and counting `created_at` would read a fortnight of
  // medicine as a single afternoon and decline to notice it.
  const days = statedDays?.size
    ? statedDays
    : new Set(group.map((row) => dayOf(row.createdAt)).filter(Boolean));
  if (days.size < MIN_DISTINCT_DAYS) return null;

  // Nothing repeated is nothing to remember: a template of a date stamp and two
  // questions is the add-row form, which is what `asksMoreThanItKnows` says in
  // the general case and what this says about the specific one.
  const asks = fields.filter((f) => f.kind === 'ask');
  if (values.length === 0) return null;
  if (asks.length > MAX_SUGGESTED_ASKS || asks.length > values.length) return null;
  if (asksMoreThanItKnows(fields)) return null;

  const label = sanitizeLabel(values.join(' — ')).slice(0, MAX_LABEL_LENGTH).trim();

  return {
    fields,
    label,
    values,
    occurrences: group.length,
    days: days.size,
    signature: signatureOf(fields),
  };
}
