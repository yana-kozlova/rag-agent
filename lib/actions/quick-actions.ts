import { and, asc, eq, sql } from 'drizzle-orm';

import { getUser } from '@/lib/auth/context';
import { db } from '@/lib/db';
import {
  createQuickActionSchema,
  quickActions,
  userTables,
  userTablesData,
  type CreateQuickActionInput,
  type TableColumn,
} from '@/lib/db/schema';
import {
  MAX_ASK_FIELDS,
  MAX_QUICK_ACTIONS,
  askFields,
  asksMoreThanItKnows,
  describeRow,
  resolveQuickActionRow,
  sanitizeLabel,
  type QuickAction,
  type QuickField,
} from '@/lib/quick-actions/quick-actions';
import { timezoneFor } from '@/lib/actions/user-timezone';
import { createTableRow, deleteTableRow } from '@/lib/actions/user-tables';
import type { ColumnLike } from '@/lib/utils/table-columns';

/**
 * The press path — everything a quick action does between a thumb and a row.
 *
 * Not a server-action module: the button lives in three places (the dashboard
 * widget, the table page, a Telegram inline keyboard) and only two of them are
 * React. These are plain functions, called from API routes and from the bot.
 */

export type QuickActionWithColumns = QuickAction & { columns: ColumnLike[] };

/** Every button this user has, with the columns needed to render and fill it. */
export async function listQuickActions(): Promise<QuickActionWithColumns[]> {
  const user = await getUser();
  if (!user) return [];

  const rows = await db
    .select({
      id: quickActions.id,
      tableId: quickActions.tableId,
      label: quickActions.label,
      icon: quickActions.icon,
      fields: quickActions.fields,
      lastUsedAt: quickActions.lastUsedAt,
      useCount: quickActions.useCount,
      tableTitle: userTables.title,
      columns: userTables.columns,
    })
    .from(quickActions)
    .innerJoin(userTables, eq(quickActions.tableId, userTables.id))
    .where(eq(quickActions.userId, user.id))
    .orderBy(asc(quickActions.createdAt));

  return rows.map((r) => ({
    id: r.id,
    tableId: r.tableId,
    tableTitle: r.tableTitle,
    label: r.label,
    icon: r.icon,
    fields: (r.fields as QuickField[]) ?? [],
    lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
    useCount: r.useCount,
    columns: toColumnLike(r.columns),
  }));
}

export type CreateResult =
  | { ok: true; id: string; label: string; tableTitle: string }
  | { ok: false; error: string };

/**
 * Save a button.
 *
 * Validated against the table's real columns rather than trusted: the caller
 * is usually a model, which will cheerfully name a column that does not exist,
 * and a field pointing nowhere is a button that silently writes a narrower row
 * than the user described — the kind of failure nobody notices until the chart
 * built on that column is wrong.
 */
export async function createQuickAction(input: CreateQuickActionInput): Promise<CreateResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: 'Unauthorized. Please sign in.' };

  const parsed = createQuickActionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid quick action.' };
  }
  const { tableId, icon, fields } = parsed.data;

  const label = sanitizeLabel(parsed.data.label);
  if (!label) {
    return { ok: false, error: 'A quick action needs a label with something readable in it.' };
  }

  const [table] = await db
    .select({ id: userTables.id, title: userTables.title, columns: userTables.columns })
    .from(userTables)
    .where(and(eq(userTables.id, tableId), eq(userTables.userId, user.id)))
    .limit(1);

  if (!table) return { ok: false, error: 'Table not found.' };

  const columns = toColumnLike(table.columns);
  const known = new Set(columns.map((c) => c.id));

  const unknown = fields.filter((f) => !known.has(f.columnId)).map((f) => f.columnId);
  if (unknown.length > 0) {
    return {
      ok: false,
      error: `No such column(s) in "${table.title}": ${unknown.join(', ')}. Available: ${columns
        .map((c) => `${c.id} (${c.name}, ${c.type})`)
        .join(', ')}.`,
    };
  }

  // One column, one value. Two fields writing the same key means the second
  // silently wins, which reads as a button that ignores half of what it was
  // told — better refused at the point the mistake was made.
  const seen = new Set<string>();
  const duplicate = fields.find((f) => (seen.has(f.columnId) ? true : (seen.add(f.columnId), false)));
  if (duplicate) {
    return { ok: false, error: `Column "${duplicate.columnId}" is filled twice.` };
  }

  const asks = askFields(fields);
  if (asks.length > MAX_ASK_FIELDS) {
    return {
      ok: false,
      error: `A quick action may ask for at most ${MAX_ASK_FIELDS} value(s); this one asks for ${asks.length}. Store the rest as literals (kind "fixed"), or let the user add the row from the table page.`,
    };
  }

  if (asksMoreThanItKnows(fields)) {
    return {
      ok: false,
      error:
        `This button asks for ${asks.length} of the ${fields.length} column(s) it fills, which is not a quick ` +
        `action — it is the table's add-row form with an extra tap. A quick action is the row the user writes ` +
        `over and over, remembered: put what never changes in as kind "fixed" (the medicine, the dose, whose it ` +
        `is), stamp the date with "today" or "now", and ask only for what genuinely differs each press, like a ` +
        `reading. If you do not know a value, ask the user for it in the conversation now and save their answer ` +
        `as a literal — never turn a question you could ask once into one the button asks forever.`,
    };
  }

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(quickActions)
    .where(eq(quickActions.userId, user.id));

  // Reported, never resolved by evicting the oldest: the user made each of
  // these, and the one this would drop is as likely as not the daily one.
  if (count >= MAX_QUICK_ACTIONS) {
    return {
      ok: false,
      error: `You already have ${count} quick actions, which is the limit (${MAX_QUICK_ACTIONS}). Delete one you no longer press and try again.`,
    };
  }

  try {
    const [row] = await db
      .insert(quickActions)
      .values({
        userId: user.id,
        tableId: table.id,
        label,
        icon: icon?.trim() || null,
        fields,
      })
      .returning({ id: quickActions.id });

    return { ok: true, id: row.id, label, tableTitle: table.title };
  } catch (error) {
    // The unique index on (user_id, lower(btrim(label))) is the only thing
    // that can realistically fail here, and it is not an error worth a stack
    // trace: the button already exists, which is what the caller wanted.
    if (isUniqueViolation(error)) {
      return { ok: false, error: `A quick action called "${label}" already exists.` };
    }
    console.error('[quick-actions] create failed:', error);
    return { ok: false, error: 'Could not save the quick action.' };
  }
}

export async function deleteQuickAction(
  id: string
): Promise<{ ok: true; label: string } | { ok: false; error: string }> {
  const user = await getUser();
  if (!user) return { ok: false, error: 'Unauthorized. Please sign in.' };

  const [deleted] = await db
    .delete(quickActions)
    .where(and(eq(quickActions.id, id), eq(quickActions.userId, user.id)))
    .returning({ label: quickActions.label });

  if (!deleted) return { ok: false, error: 'Quick action not found.' };
  return { ok: true, label: deleted.label };
}

/** Resolve one by the name on its face — how a Telegram reply finds its way back. */
export async function findQuickActionByLabel(
  label: string
): Promise<QuickActionWithColumns | null> {
  const wanted = label.trim().toLowerCase();
  if (!wanted) return null;

  const all = await listQuickActions();
  return all.find((a) => a.label.trim().toLowerCase() === wanted) ?? null;
}

export type RunResult =
  | { ok: true; rowId: string; tableId: string; tableTitle: string; label: string; summary: string }
  | { ok: false; error: string; missing?: string[] };

/**
 * Press it.
 *
 * No model is called. The whole point of the feature is that this path costs
 * one INSERT and one embedding — the embedding stays because a row nothing can
 * find is not saved in any sense this app means, and it is three orders of
 * magnitude cheaper than the chat completion it replaces.
 *
 * The usage stamp is written only after the row is, and never in the same
 * breath as a failure: a button that claims "✓ сьогодні" over a row that was
 * never written is worse than one that claims nothing.
 */
export async function runQuickAction(
  id: string,
  answers: Record<string, unknown> = {}
): Promise<RunResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: 'Unauthorized. Please sign in.' };

  const [action] = await db
    .select({
      id: quickActions.id,
      label: quickActions.label,
      fields: quickActions.fields,
      tableId: userTables.id,
      tableTitle: userTables.title,
      columns: userTables.columns,
    })
    .from(quickActions)
    .innerJoin(userTables, eq(quickActions.tableId, userTables.id))
    .where(and(eq(quickActions.id, id), eq(quickActions.userId, user.id)))
    .limit(1);

  if (!action) return { ok: false, error: 'Quick action not found.' };

  const columns = toColumnLike(action.columns);
  const timeZone = await timezoneFor(user.id);

  const { rowData, missing } = resolveQuickActionRow((action.fields as QuickField[]) ?? [], {
    now: new Date(),
    timeZone,
    columns,
    answers,
  });

  // A blank column reads as "measured and found nothing", not as "not
  // answered", and no later view can tell the two apart — so an unanswered
  // question stops the write rather than being stored as an absence.
  if (missing.length > 0) {
    return { ok: false, error: `Missing: ${missing.join(', ')}.`, missing };
  }

  if (Object.keys(rowData).length === 0) {
    return {
      ok: false,
      error: 'This quick action no longer matches any column in its table. Edit or delete it.',
    };
  }

  const created = await createTableRow({
    userTableId: action.tableId,
    rowData,
    // Which button wrote this row. Read back by `undoQuickActionRun` to
    // recompute the usage stamp — without it an undo leaves the button
    // claiming a press whose row is gone.
    metadata: { quickActionId: action.id },
  });

  if (!created.success || !created.id) {
    return { ok: false, error: created.message || 'Could not add the row.' };
  }

  await db
    .update(quickActions)
    .set({
      lastUsedAt: new Date(),
      useCount: sql`${quickActions.useCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(quickActions.id, action.id));

  return {
    ok: true,
    rowId: created.id,
    tableId: action.tableId,
    tableTitle: action.tableTitle,
    label: action.label,
    summary: describeRow(rowData, columns),
  };
}

/**
 * Undo a press.
 *
 * Deletes only a row this button wrote — the row id comes from the client, and
 * "undo" must not be a way to delete an arbitrary row by guessing an id, even
 * one of your own.
 *
 * The usage stamp is then recomputed from the rows that remain rather than
 * decremented, because decrementing gets `lastUsedAt` wrong: undoing this
 * morning's press should leave the button showing yesterday's, and only the
 * rows know when that was.
 */
export async function undoQuickActionRun(
  id: string,
  rowId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getUser();
  if (!user) return { ok: false, error: 'Unauthorized. Please sign in.' };

  const [action] = await db
    .select({ id: quickActions.id, tableId: quickActions.tableId })
    .from(quickActions)
    .where(and(eq(quickActions.id, id), eq(quickActions.userId, user.id)))
    .limit(1);

  if (!action) return { ok: false, error: 'Quick action not found.' };

  const [row] = await db
    .select({ id: userTablesData.id, metadata: userTablesData.metadata })
    .from(userTablesData)
    .where(and(eq(userTablesData.id, rowId), eq(userTablesData.userTableId, action.tableId)))
    .limit(1);

  if (!row || (row.metadata as { quickActionId?: string } | null)?.quickActionId !== action.id) {
    return { ok: false, error: 'That row was not written by this quick action.' };
  }

  // Ownership is re-checked in there; it also clears the embeddings and the
  // retrieval cache, which is the part that must not be skipped.
  const deleted = await deleteTableRow(rowId);
  if (!deleted.success) return { ok: false, error: deleted.message };

  const [remaining] = await db
    .select({
      count: sql<number>`count(*)::int`,
      last: sql<Date | null>`max(${userTablesData.createdAt})`,
    })
    .from(userTablesData)
    .where(
      and(
        eq(userTablesData.userTableId, action.tableId),
        sql`${userTablesData.metadata}->>'quickActionId' = ${action.id}`
      )
    );

  await db
    .update(quickActions)
    .set({
      useCount: remaining?.count ?? 0,
      lastUsedAt: remaining?.last ? new Date(remaining.last) : null,
      updatedAt: new Date(),
    })
    .where(eq(quickActions.id, action.id));

  return { ok: true };
}

function toColumnLike(columns: unknown): ColumnLike[] {
  return ((columns as TableColumn[]) ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    type: c.type,
  }));
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '23505';
}
