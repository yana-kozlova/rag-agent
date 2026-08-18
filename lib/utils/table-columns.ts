/**
 * What a table column can hold, and how a written value is read into it.
 *
 * One list. The enum had two hand-maintained copies — `tableColumnSchema`'s
 * `z.enum` and `create-table`'s `COLUMN_TYPES` — which is the exact shape of
 * drift `metadata.type` already went through, where a filter offered types
 * nothing carried while omitting types half the base was classified as.
 *
 * It lives in `lib/utils` rather than beside the column it describes because
 * the quick-action bar is a client component and importing from
 * `lib/db/schema` would drag drizzle and every table definition into the
 * browser bundle — same reason as `lib/utils/uploadable.ts` and
 * `lib/wellbeing/scale.ts`. Nothing here imports anything.
 */

export const TABLE_COLUMN_TYPES = ['text', 'number', 'date', 'boolean', 'email', 'url'] as const;

export type TableColumnType = (typeof TABLE_COLUMN_TYPES)[number];

/**
 * The part of a column definition anything outside the editor needs: which
 * key it is stored under, what to call it, and how to read a value into it.
 * `TableColumn` in the schema is this plus presentation (`width`, `required`).
 */
export type ColumnLike = {
  id: string;
  name: string;
  type: TableColumnType;
};

/**
 * Read a written value into the column's type.
 *
 * Everything arrives as text — from a model's JSON, from an input box, from a
 * Telegram reply — and the column says what it was meant to be. A value that
 * cannot be read becomes null rather than a string that looks like a number
 * until something tries to add it up.
 *
 * Booleans accept the Ukrainian words too: this is answered by hand, in the
 * language the rest of the app is used in.
 */
export function coerceValue(value: unknown, type: TableColumnType): unknown {
  if (value === null || value === undefined || value === '') return null;

  switch (type) {
    case 'number': {
      const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
      return Number.isFinite(n) ? n : null;
    }
    case 'boolean': {
      if (typeof value === 'boolean') return value;
      const s = String(value).toLowerCase().trim();
      if (['true', 'yes', 'y', '1', 'так', 'да'].includes(s)) return true;
      if (['false', 'no', 'n', '0', 'ні', 'нет'].includes(s)) return false;
      return null;
    }
    case 'date': {
      if (value instanceof Date) return value.toISOString();
      // A bare calendar date stays a bare calendar date. Parsing it through
      // `Date` would make it UTC midnight, which prints as the day before
      // anywhere west of Greenwich — the mistake the timeline formats around.
      const raw = String(value).trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
      const d = new Date(raw);
      return isNaN(d.getTime()) ? raw : d.toISOString();
    }
    default:
      return String(value);
  }
}
