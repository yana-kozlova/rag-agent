import { getLocalDateKey, getLocalParts } from '@/lib/push/timezone';
import { coerceValue, type ColumnLike } from '@/lib/utils/table-columns';

/**
 * A saved row template with a button on it.
 *
 * The knowledge base already had two ways to write a table row and both go
 * through the model: `addTableRows` reads a sentence, `extractToTable` reads a
 * note. That is the right shape for a fact stated once, and the wrong shape for
 * a thing done every day — "Арчі прийняв ліки" costs a chat completion, a tool
 * round-trip and about four seconds to record six characters that never vary.
 *
 * So a quick action is the row *minus what the model was being asked to infer*:
 * the columns that never change are stored as literals, the date is stamped at
 * press time, and anything genuinely new is asked for. Pressing it calls no
 * model at all.
 *
 * What it is deliberately not is a schedule. Nothing here knows that Арчі takes
 * medicine daily, nothing nags, nothing back-fills a missed day — the user said
 * their routines are not predetermined ("today Арчі, tomorrow me, the day after
 * a child's temperature"), and a button that assumes otherwise starts lying the
 * first week it is wrong. It records a press, and only a press.
 *
 * Dependency-free apart from formatting helpers, so the dashboard widget can
 * import the types and the resolver without pulling drizzle into the browser.
 */

/**
 * How many buttons a person can have.
 *
 * The same reasoning as `MAX_DIRECTIVES`: past a dozen this stops being a row
 * of buttons you press without reading and becomes a list you have to search,
 * at which point typing the sentence was faster. Hitting the cap is reported
 * rather than resolved by evicting the oldest — the user made each of these.
 */
export const MAX_QUICK_ACTIONS = 12;

/** A button's face. Longer than this and the label wraps to nothing readable. */
export const MAX_LABEL_LENGTH = 40;

/**
 * How many values one press may ask for.
 *
 * Three is where a "quick" record stops being quicker than the table's own add
 * row form. It is also the ceiling on the Telegram flow, which asks for all of
 * them in one comma-separated reply.
 */
export const MAX_ASK_FIELDS = 3;

/** A typed answer is a reading or a short note, never a paragraph. */
export const MAX_ANSWER_LENGTH = 200;

/**
 * A label is a button face, so the characters that survive a Markdown stripper
 * as something *other than themselves* are taken out of it when it is saved.
 *
 * Not cosmetics. `sendMessage` strips Markdown on the way to Telegram, and a
 * quick action that asks for a value is found again by the label quoted in the
 * prompt it sent — so a label written "Арчі *ліки*" would go out as "Арчі
 * ліки" and match nothing on the way back. Sanitising once, on write, is what
 * makes that round-trip safe by construction; the alternative is every reader
 * remembering to normalise, which is how `isDeclined` ended up guarding one
 * caller out of three.
 *
 * Only what can actually fire, though. The label is printed mid-line — inside
 * guillemets, after an emoji — so `stripMarkdown`'s line-anchored rules
 * (headings, blockquotes, fences, rules) cannot reach it, and `#`, `>`, `|`
 * and parentheses come through as themselves. Removing those too cost
 * "Арчі — ліки (вечір)" its parentheses for no reason at all. What is left is
 * the paired emphasis marks and the brackets, and the brackets only because
 * `flattenMarkdownLinks` rewrites `[label](href)` — dropping `[` and `]` makes
 * that pattern unformable without touching the round half of it.
 */
export function sanitizeLabel(label: string): string {
  return label
    .replace(/[*_`~[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * What one column of the template is.
 *
 * - `fixed` — the same value every time. "Арчі", "ліки", "так".
 * - `today` — the local calendar day at press time, `YYYY-MM-DD`.
 * - `now`   — the local day and wall-clock time, `YYYY-MM-DD HH:MM`.
 * - `ask`   — the reason this is not a one-tap button: a temperature, a dose,
 *             a note. Prompted for at press time and never guessed.
 *
 * The two time kinds are separate rather than one kind read off the column's
 * type, for the reason the timeline's `precision` column exists: how much of a
 * date is meant is a decision, not something to infer. A daily medication log
 * wants the day (two presses on one day are the same day); a temperature
 * reading is worthless without the hour.
 */
export type QuickFieldKind = 'fixed' | 'today' | 'now' | 'ask';

export type QuickField = {
  /** The column this fills, by id — not by name, which the user can rename. */
  columnId: string;
  kind: QuickFieldKind;
  /** `fixed` only. */
  value?: string | number | boolean | null;
  /** `ask` only — what to call the value when asking for it. Defaults to the column name. */
  prompt?: string;
};

export type QuickAction = {
  id: string;
  tableId: string;
  tableTitle: string;
  label: string;
  /** One emoji, for finding the right button without reading. Optional. */
  icon: string | null;
  fields: QuickField[];
  lastUsedAt: string | null;
  useCount: number;
};

/** The `ask` fields, in the order they will be asked for. */
export function askFields(fields: QuickField[]): QuickField[] {
  return fields.filter((f) => f.kind === 'ask');
}

/** What to call an `ask` field when prompting for it. */
export function promptFor(field: QuickField, columns: ColumnLike[]): string {
  const trimmed = field.prompt?.trim();
  if (trimmed) return trimmed;
  return columns.find((c) => c.id === field.columnId)?.name ?? field.columnId;
}

export type ResolveContext = {
  /** The instant the button was pressed. */
  now: Date;
  /** The zone that instant is a date in — the user's, never the server's. */
  timeZone: string;
  columns: ColumnLike[];
  /** columnId → what the user typed for an `ask` field. */
  answers?: Record<string, unknown>;
};

export type ResolvedRow = {
  rowData: Record<string, unknown>;
  /**
   * `ask` fields left blank, by their prompt. A press with these outstanding
   * writes nothing: an empty column reads as "measured and found nothing"
   * rather than as "not answered", and there is no way back from that.
   */
  missing: string[];
};

/**
 * The template, filled in.
 *
 * Pure — the press path's only decision, testable without a database, a clock
 * or a session. A field naming a column the table no longer has is skipped
 * rather than written under a dead key: columns can be renamed and deleted
 * from the table editor, and the alternative is a row whose data is invisible
 * in every view of it.
 */
export function resolveQuickActionRow(
  fields: QuickField[],
  { now, timeZone, columns, answers = {} }: ResolveContext
): ResolvedRow {
  const byId = new Map(columns.map((c) => [c.id, c]));
  const rowData: Record<string, unknown> = {};
  const missing: string[] = [];

  for (const field of fields) {
    const column = byId.get(field.columnId);
    if (!column) continue;

    switch (field.kind) {
      case 'today':
        // Already a bare calendar date in the user's own zone; running it
        // through `coerceValue` would only risk turning it back into an
        // instant.
        rowData[column.id] = getLocalDateKey(now, timeZone);
        break;

      case 'now':
        rowData[column.id] = formatLocalStamp(now, timeZone);
        break;

      case 'ask': {
        const answer = answers[field.columnId];
        const written = answer === null || answer === undefined ? '' : String(answer).trim();
        if (!written) {
          missing.push(promptFor(field, columns));
          break;
        }
        rowData[column.id] = coerceValue(written.slice(0, MAX_ANSWER_LENGTH), column.type);
        break;
      }

      default:
        rowData[column.id] = coerceValue(field.value ?? null, column.type);
    }
  }

  return { rowData, missing };
}

/**
 * `YYYY-MM-DD HH:MM` as the user's clock reads it.
 *
 * Not an ISO instant: the table shows this string as itself, and a `Z` on the
 * end of a value nobody will ever parse is three hours of confusion for a Kyiv
 * user reading back when they took a pill.
 */
function formatLocalStamp(date: Date, timeZone: string): string {
  const { year, month, day, hour, minute } = getLocalParts(date, timeZone);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)}`;
}

/**
 * What was written, in one line, for the toast and for the bot's reply.
 *
 * A press produces no visible confirmation otherwise — the row lands on a page
 * the user is probably not looking at. Naming the values back is the same
 * reasoning that makes the Telegram media handler quote the OCR: the moment to
 * notice a button is wired to the wrong column is now.
 */
export function describeRow(rowData: Record<string, unknown>, columns: ColumnLike[]): string {
  return columns
    .filter((c) => rowData[c.id] !== undefined && rowData[c.id] !== null && rowData[c.id] !== '')
    .map((c) => `${c.name}: ${formatValue(rowData[c.id])}`)
    .join(' · ');
}

function formatValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'так' : 'ні';
  return String(value);
}

/**
 * Was this pressed today, in the user's zone?
 *
 * The one piece of state a daily button owes its user, and the question they
 * actually have in front of it: *did I already give him the pill?* Cheaper and
 * more honest than a streak — it reads the last press, and says nothing about
 * the days before it.
 */
export function usedToday(
  lastUsedAt: string | Date | null | undefined,
  now: Date,
  timeZone: string
): boolean {
  if (!lastUsedAt) return false;
  const last = lastUsedAt instanceof Date ? lastUsedAt : new Date(lastUsedAt);
  if (isNaN(last.getTime())) return false;
  return getLocalDateKey(last, timeZone) === getLocalDateKey(now, timeZone);
}
