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

export const TABLE_COLUMN_TYPES = [
  'text',
  'number',
  'date',
  'boolean',
  'email',
  'url',
  'file',
] as const;

/** What each type is called in a picker. Here so the list stays one list. */
export const TABLE_COLUMN_TYPE_LABELS: Record<TableColumnType, string> = {
  text: 'Text',
  number: 'Number',
  date: 'Date',
  boolean: 'Boolean',
  email: 'Email',
  url: 'URL',
  file: 'File',
};

export type TableColumnType = (typeof TABLE_COLUMN_TYPES)[number];

/**
 * What a `file` cell holds: a resource, by id, plus the name to print.
 *
 * The cell is a *resource*, not a blob URL, and that is the whole design. An
 * upload already becomes a resource — extracted to text by `unpdf`/`mammoth`,
 * described by a vision model when it is a photo, chunked and embedded — so a
 * file attached to a row is findable by `getInformation` the same day, and the
 * bytes are stored by exactly one path in this app. Storing a bare URL in the
 * cell instead would give a file that nothing can search, which is the mistake
 * "images are stored as text" exists to prevent.
 *
 * The name is kept beside the id rather than looked up: a table renders without
 * a join, `convertRowToText` embeds "аналіз крові.pdf" rather than an id that
 * means nothing to a search, and a resource later deleted from the Knowledge
 * Base leaves a cell that still says what was attached instead of an empty one.
 */
export type TableFile = {
  resourceId: string;
  name: string;
};

export function isTableFile(value: unknown): value is TableFile {
  if (typeof value !== 'object' || value === null) return false;
  const file = value as Partial<TableFile>;
  return typeof file.resourceId === 'string' && file.resourceId !== '' && typeof file.name === 'string';
}

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
    // Only an actual attachment. Everything else that writes a row — the
    // model through `addTableRows`, a quick action, the add-row form — arrives
    // as text, and text is not a file: a string here would render as a link to
    // a resource that does not exist. Rejecting it is what makes a `file`
    // column safe to expose to `createTable` at all, since a model can describe
    // an attachment and can never make one.
    case 'file':
      return isTableFile(value) ? { resourceId: value.resourceId, name: value.name } : null;

    default:
      return String(value);
  }
}

/**
 * A stored date value, read back into the input that can edit it losslessly.
 *
 * A date column holds three different shapes, all of them written on purpose:
 * a bare `YYYY-MM-DD` (what `today` stamps and what `coerceValue` preserves),
 * a wall-clock stamp `YYYY-MM-DD HH:MM` (what `now` stamps — deliberately not
 * an instant, so a Kyiv user reading back when they took a pill is not shown
 * three hours of confusion), and a genuine zoned ISO instant.
 *
 * Editing all three through one `<input type="date">` is the quiet way to lose
 * data: the hour on a medication stamp disappears on the first cell edit and
 * nothing anywhere says it was there. So the shape decides the input, and
 * `fromDateInput` writes back into the same shape it read.
 *
 * A value that is not a date at all falls through to `text` rather than to an
 * empty date picker, because an empty picker beside a non-empty cell is one
 * committed keystroke away from erasing whatever was actually written there.
 */
export type DateInputShape = {
  type: 'date' | 'datetime-local' | 'text';
  value: string;
  /** The stored value carried a zone, so it must be written back as an instant. */
  zoned?: boolean;
};

const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const WALL_CLOCK = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/;
const ZONED = /(?:Z|[+-]\d{2}:?\d{2})$/;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** `YYYY-MM-DDTHH:MM` as the browser's own clock reads the instant. */
function localInputValue(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function toDateInput(value: unknown): DateInputShape {
  if (value === null || value === undefined) return { type: 'date', value: '' };

  const raw = value instanceof Date ? value.toISOString() : String(value).trim();
  if (raw === '') return { type: 'date', value: '' };
  if (BARE_DATE.test(raw)) return { type: 'date', value: raw };

  if (ZONED.test(raw)) {
    const d = new Date(raw);
    if (!isNaN(d.getTime())) return { type: 'datetime-local', value: localInputValue(d), zoned: true };
  }

  const wall = WALL_CLOCK.exec(raw);
  if (wall) return { type: 'datetime-local', value: `${wall[1]}T${wall[2]}` };

  return { type: 'text', value: raw };
}

/**
 * What the date input holds, written back in the shape the cell came in.
 *
 * The `T` becomes a space again for a wall-clock stamp so the value keeps
 * matching what `resolveQuickActionRow` writes: one column, one shape, however
 * the row was made.
 */
export function fromDateInput(shape: DateInputShape['type'], written: string, zoned = false): unknown {
  const raw = written.trim();
  if (raw === '') return null;

  if (shape === 'date') return BARE_DATE.test(raw) ? raw : coerceValue(raw, 'date');

  if (shape === 'datetime-local') {
    if (!zoned) return raw.replace('T', ' ');
    const d = new Date(raw);
    return isNaN(d.getTime()) ? raw : d.toISOString();
  }

  return coerceValue(raw, 'date');
}

/**
 * What a cell shows when it is not being edited.
 *
 * An empty string means the cell is empty and the caller renders its own
 * placeholder — the distinction matters, because a cell holding nothing still
 * has to be a click target the same size as one holding a word.
 */
export function formatCellValue(value: unknown, type: TableColumnType): string {
  if (value === null || value === undefined || value === '') return '';

  if (type === 'boolean') {
    const read = coerceValue(value, 'boolean');
    return read === null ? String(value) : read ? 'Yes' : 'No';
  }

  // The name, which is the part worth reading — and the part worth embedding:
  // `convertRowToText` runs through here, so a row with an attachment is found
  // by its file name rather than by an id nobody will ever search for.
  if (type === 'file') {
    return isTableFile(value) ? value.name : '';
  }

  if (type === 'date') {
    const shape = toDateInput(value);
    if (shape.type === 'datetime-local') return shape.value.replace('T', ' ');
    if (shape.type === 'date') return shape.value;
    return shape.value;
  }

  return String(value);
}
