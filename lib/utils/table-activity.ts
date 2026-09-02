/**
 * When a table was last touched by either hand.
 *
 * `updatedAt` on the table row moves only when the *definition* changes — a
 * title edited, a column added — because that is the only thing
 * `updateUserTable` writes. Sorting a list by it puts a table renamed in April
 * above one filled this morning, which is the opposite of the order someone
 * scanning their tables wants. Rows carry the other half, and neither alone is
 * the answer: a table created five minutes ago has no rows at all and still
 * belongs at the top.
 */
export type TableActivity = {
  updatedAt: string | Date;
  lastEntryAt: string | Date | null;
};

export function lastActivityOf(table: TableActivity): number {
  const updated = new Date(table.updatedAt).getTime();
  const entry = table.lastEntryAt ? new Date(table.lastEntryAt).getTime() : NaN;

  // A date that will not parse is not an ordering: it falls back to the other
  // one rather than sending the row to the bottom as `NaN` comparisons would.
  const times = [updated, entry].filter((t) => !Number.isNaN(t));
  return times.length > 0 ? Math.max(...times) : 0;
}

/** Most recently touched first. */
export function byActivity(a: TableActivity, b: TableActivity): number {
  return lastActivityOf(b) - lastActivityOf(a);
}
