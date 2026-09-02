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

/**
 * The length past which a repeating value is prose rather than a name.
 *
 * The values that repeat are not equally worth putting on a button. "апоквель"
 * and "вранці" say which routine this is; "у відповідності з призначенням" is a
 * notes column that happens to hold the same sentence every day — it separates
 * this routine from nothing, and it is what pushed the face past its width and
 * had it cut to "вранці — апоквель — у відповідності з пр", which is the name
 * of nothing at all.
 */
const NAME_LENGTH = 16;

/** How many values one face carries. Three is already a mouthful to read. */
const MAX_LABEL_PARTS = 3;

/** What joins them. Wider than a comma, because the parts are not a list. */
const LABEL_SEPARATOR = ' — ';

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
 * Whether a button already records this routine.
 *
 * Not equality, and not a comparison of labels — the user renames a button, and
 * since the offer became editable they also reword its values and drop the
 * columns they did not want written. A button compared field for field against
 * the rows it was built from stops matching the moment they do either, and the
 * page goes back to offering a routine that has had a button on it since
 * Tuesday. What a button has to cover is what it *writes*: every field it fills
 * matches the routine's, and the columns it leaves out are the ones the user
 * chose not to keep.
 *
 * A fixed value matches loosely — case, spacing, and either value containing
 * the other once both are long enough for that to mean anything — because
 * "апоквель" reworded on the face as "апоквель 10мг" is the same medicine.
 * "вранці" and "ввечері" contain nothing of each other, so a table recording a
 * morning routine and an evening one still gets two offers.
 *
 * A button with no fixed value of its own covers nothing: a date stamp and a
 * question describe every routine in the table equally well.
 */
export function covers(button: QuickField[], routine: QuickField[]): boolean {
  if (!button.some((field) => field.kind === 'fixed')) return false;

  const byColumn = new Map(routine.map((field) => [field.columnId, field]));
  return button.every((field) => {
    const repeated = byColumn.get(field.columnId);
    if (!repeated || repeated.kind !== field.kind) return false;
    return field.kind !== 'fixed' || sameValue(field.value, repeated.value);
  });
}

/** Shortest containment worth trusting — under it, "1" is inside "10 мг". */
const MIN_CONTAINED_LENGTH = 3;

function sameValue(written: unknown, repeated: unknown): boolean {
  const a = normalizeValue(written);
  const b = normalizeValue(repeated);
  if (a === b) return true;
  if (a.length < MIN_CONTAINED_LENGTH || b.length < MIN_CONTAINED_LENGTH) return false;
  return a.includes(b) || b.includes(a);
}

function normalizeValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * The name to put on the button, built from what repeats.
 *
 * Two rules, both learned from one offer. Only the values that read as names
 * are used, because a routine's identity is "вранці", "апоквель" and not the
 * standing instruction sitting in the notes column; and what still does not fit
 * is dropped whole rather than cut, because a face ending mid-word is not a
 * shorter name, it is a broken one.
 *
 * The face is also the identity — `UNIQUE (user_id, lower(btrim(label)))` — so
 * a shorter name is likelier to land on one already saved. That is refused with
 * the reason said out loud rather than silently, and it is the other half of
 * why the offer lets the name be edited before it is accepted.
 */
export function labelFor(values: string[]): string {
  const clean = values.map(sanitizeLabel).filter(Boolean);
  if (clean.length === 0) return '';

  const names = clean.filter((value) => value.length <= NAME_LENGTH);
  const parts = (names.length > 0 ? names : [clean[0]]).slice(0, MAX_LABEL_PARTS);

  // Dropped from the end: column order runs from what the row is about towards
  // how it went, so the last part is the one least missed.
  while (parts.length > 1 && parts.join(LABEL_SEPARATOR).length > MAX_LABEL_LENGTH) parts.pop();

  return clipWords(parts.join(LABEL_SEPARATOR), MAX_LABEL_LENGTH);
}

/** `text` at no more than `max` characters, cut where a word ends. */
function clipWords(text: string, max: number): string {
  if (text.length <= max) return text;

  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  // A word boundary so early that nothing readable survives is worse than a
  // hard cut, so it is only taken in the back half of what fits.
  const kept = space > max / 2 ? cut.slice(0, space) : cut;
  return `${kept.replace(/[\s—-]+$/, '')}…`;
}

/**
 * The routine a table is recording that has no button yet.
 *
 * `buttons` is the fields of every quick action already on this table, and they
 * are passed *in* rather than used to filter the answer afterwards, because the
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
  buttons: QuickField[][] = []
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

  for (const group of [...groups.values()].sort((a, b) => b.length - a.length)) {
    if (group.length < MIN_OCCURRENCES) continue;
    const template = templateFor(columns, dateIds, varying, group);
    if (template && !buttons.some((button) => covers(button, template.fields))) return template;
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
    // An attachment is never part of a routine. A button writes without asking
    // and a Telegram reply is text, so the best a file column could do here is
    // become a question nobody can answer or a literal repeating one scan on
    // every press. Skipped rather than refused: the rest of the row is still a
    // routine worth one tap.
    if (column.type === 'file') continue;

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

  return {
    fields,
    label: labelFor(values),
    values,
    occurrences: group.length,
    days: days.size,
  };
}
