import { z } from 'zod';
import { getSessionOrNull } from '@/lib/utils/auth';
import { createUserTable } from '@/lib/actions/user-tables';

const COLUMN_TYPES = ['text', 'number', 'date', 'boolean', 'email', 'url'] as const;

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\u0400-\u04ff]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'col';
}

function uniquifyIds(ids: string[]): string[] {
  const seen = new Map<string, number>();
  return ids.map((id) => {
    const count = seen.get(id) ?? 0;
    seen.set(id, count + 1);
    return count === 0 ? id : `${id}_${count + 1}`;
  });
}

export const createTableTool = {
  description: `Create a new structured data table for the user.
    Use this when the user wants to track, organize, or collect structured information — e.g. "create a table for books I want to read", "make me a table of job applications", "start tracking expenses in a table".
    Columns are defined by name and type. The tool auto-generates column IDs.
    After creating, you can use addTableRows to populate it, or ask the user what data to add.`,
  inputSchema: z.object({
    title: z.string().min(1).describe('Short descriptive title for the table (e.g. "Books to Read", "Job Applications")'),
    description: z.string().optional().describe('Optional longer description of the table purpose'),
    columns: z
      .array(
        z.object({
          name: z.string().min(1).describe('Human-readable column name (e.g. "Author", "Due Date")'),
          type: z.enum(COLUMN_TYPES).describe('Column data type'),
          required: z.boolean().optional().describe('Whether this column is required'),
        })
      )
      .min(1)
      .describe('Array of column definitions. Must have at least one column.'),
  }),
  execute: async ({
    title,
    description,
    columns,
  }: {
    title: string;
    description?: string;
    columns: Array<{ name: string; type: typeof COLUMN_TYPES[number]; required?: boolean }>;
  }) => {
    const session = await getSessionOrNull();
    if (!session?.user?.id) {
      throw new Error('Unauthorized');
    }

    const rawIds = columns.map((c) => slugify(c.name));
    const ids = uniquifyIds(rawIds);

    const columnsWithIds = columns.map((c, i) => ({
      id: ids[i]!,
      name: c.name,
      type: c.type,
      required: c.required,
    }));

    const result = await createUserTable({
      title,
      description: description ?? null,
      columns: columnsWithIds,
    });

    if (!result.success) {
      return { success: false, message: result.message };
    }

    return {
      success: true,
      message: `Table "${title}" created with ${columnsWithIds.length} column(s).`,
      tableId: result.id,
      title,
      columns: columnsWithIds.map((c) => ({ id: c.id, name: c.name, type: c.type })),
    };
  },
} as const;
