import { and, eq, ilike } from 'drizzle-orm';
import { z } from 'zod';

import { createQuickAction } from '@/lib/actions/quick-actions';
import { db } from '@/lib/db';
import { userTables, type TableColumn } from '@/lib/db/schema';
import { MAX_ASK_FIELDS, type QuickField } from '@/lib/quick-actions/quick-actions';
import { getSessionOrNull } from '@/lib/utils/auth';

/**
 * Turn a described routine into a button.
 *
 * This is the one tool in the tables group whose purpose is to stop being
 * called: everything it saves is a row the model would otherwise be asked to
 * write again tomorrow, and the day after. So it is worth being generous about
 * recognising the ask ("додай кнопку", "я щодня це роблю", "хочу швидко
 * записувати") and strict about what it stores — a wrong literal is a wrong
 * value in every row from now on, silently.
 */
export const createQuickActionTool = {
  description: `Create a one-tap button that writes a preset row into one of the user's tables, with no model call at all.

    Use it when a record repeats: "Арчі щодня приймає ліки — зроби кнопку", "хочу швидко відмічати температуру дитині", "додай швидкий запис для цього". addTableRows reports any routine it finds in the table itself (NOTICED: ...) — when it does, offer that and pass its fields through unchanged rather than working them out again.

    THE BUTTON REMEMBERS THE ROW — IT DOES NOT ASK FOR IT. Aim for zero questions: one tap, row written, no typing. Take the values from what the user just said, or from the row you have just written into this table — that row IS the template. If you are missing a value, ask for it in the conversation NOW and store the answer as "fixed". A question baked into the button is one the user answers again every single day.

    Each field maps ONE column and is one of:
    - fixed — the same value every press ("Арчі", "ліки", "10 мг"). Give "value". This is the default; most columns are this.
    - today — the local calendar date at press time (YYYY-MM-DD). For daily logs.
    - now   — local date and time at press time (YYYY-MM-DD HH:MM). For readings where the hour matters.
    - ask   — prompted at press time. Give "prompt" (a short noun phrase, in the user's language). ONLY for a value that genuinely differs press to press: a temperature, a weight, today's note. Never for something you could find out now. At most ${MAX_ASK_FIELDS}, and never more asks than the button already knows — a button that asks for most of the row is the table's add-row form with an extra tap.

    Do NOT create a table just to hang a button on it if a suitable one exists; call listTables first, which also shows the quick actions each table already has.`,
  inputSchema: z.object({
    tableId: z.string().optional().describe('Target table ID (preferred if known)'),
    tableTitle: z.string().optional().describe('Target table title, if the ID is not known'),
    label: z
      .string()
      .min(1)
      .describe('The button face, in the user\'s language. Short and specific: "Арчі — ліки"'),
    icon: z.string().optional().describe('One emoji for the button, e.g. "💊". Optional.'),
    fields: z
      .array(
        z.object({
          column: z.string().min(1).describe('Column name or ID in the target table'),
          kind: z
            .enum(['fixed', 'today', 'now', 'ask'])
            .describe(
              'How this column is filled. "fixed" is the default — use "ask" only for a value that changes every press'
            ),
          value: z
            .union([z.string(), z.number(), z.boolean()])
            .optional()
            .describe('For kind="fixed": the literal written every press'),
          prompt: z
            .string()
            .optional()
            .describe('For kind="ask": what to call the value when asking, in the user\'s language'),
        })
      )
      .min(1)
      .describe('One entry per column the button fills. Columns left out stay empty.'),
  }),
  execute: async ({
    tableId,
    tableTitle,
    label,
    icon,
    fields,
  }: {
    tableId?: string;
    tableTitle?: string;
    label: string;
    icon?: string;
    fields: Array<{
      column: string;
      kind: 'fixed' | 'today' | 'now' | 'ask';
      value?: string | number | boolean;
      prompt?: string;
    }>;
  }) => {
    const session = await getSessionOrNull();
    if (!session?.user?.id) throw new Error('Unauthorized');

    if (!tableId && !tableTitle) {
      return { success: false, message: 'Either tableId or tableTitle must be provided.' };
    }

    const table = await findTable(session.user.id, tableId, tableTitle);
    if (!table) {
      return {
        success: false,
        message: `Table not found. ${tableTitle ? `Searched for: "${tableTitle}".` : `ID: "${tableId}".`} Use listTables to see what exists, or createTable first.`,
      };
    }

    const columns = (table.columns as TableColumn[]) ?? [];
    const byId = new Map(columns.map((c) => [c.id, c]));
    const byName = new Map(columns.map((c) => [c.name.toLowerCase(), c]));

    const resolved: QuickField[] = [];
    const unresolved: string[] = [];

    for (const field of fields) {
      const column = byId.get(field.column) ?? byName.get(field.column.trim().toLowerCase());
      if (!column) {
        unresolved.push(field.column);
        continue;
      }
      resolved.push({
        columnId: column.id,
        kind: field.kind,
        // Only carried for the kind that uses it: a stray `value` on a `today`
        // field would sit in the JSON looking like a default that never
        // applies, which is the sort of thing that gets debugged twice.
        ...(field.kind === 'fixed' ? { value: field.value ?? null } : {}),
        ...(field.kind === 'ask' ? { prompt: field.prompt?.trim() || column.name } : {}),
      });
    }

    if (unresolved.length > 0) {
      return {
        success: false,
        message: `No such column(s) in "${table.title}": ${unresolved.join(', ')}. Available: ${columns
          .map((c) => `${c.name} (${c.type})`)
          .join(', ')}.`,
      };
    }

    const result = await createQuickAction({
      tableId: table.id,
      label: label.trim(),
      icon: icon?.trim() || null,
      fields: resolved,
    });

    if (!result.ok) return { success: false, message: result.error };

    const asks = resolved.filter((f) => f.kind === 'ask');

    return {
      success: true,
      message:
        asks.length === 0
          ? `Quick action "${result.label}" created — one tap writes a row into "${result.tableTitle}".`
          : `Quick action "${result.label}" created — pressing it asks for ${asks
              .map((f) => f.prompt)
              .join(', ')} and writes a row into "${result.tableTitle}".`,
      quickActionId: result.id,
      label: result.label,
      tableTitle: result.tableTitle,
      asksFor: asks.map((f) => f.prompt),
    };
  },
} as const;

async function findTable(userId: string, tableId?: string, tableTitle?: string) {
  if (tableId) {
    const [found] = await db
      .select()
      .from(userTables)
      .where(and(eq(userTables.id, tableId), eq(userTables.userId, userId)))
      .limit(1);
    if (found) return found;
  }

  if (!tableTitle) return undefined;

  const matches = await db
    .select()
    .from(userTables)
    .where(and(eq(userTables.userId, userId), ilike(userTables.title, `%${tableTitle.trim()}%`)))
    .limit(5);

  const lower = tableTitle.trim().toLowerCase();
  return (
    matches.find((m) => m.title.toLowerCase() === lower) ??
    matches.find((m) => m.title.toLowerCase().startsWith(lower)) ??
    matches[0]
  );
}
