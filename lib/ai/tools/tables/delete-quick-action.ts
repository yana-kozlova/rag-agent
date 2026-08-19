import { z } from 'zod';

import { deleteQuickAction, listQuickActions } from '@/lib/actions/quick-actions';
import { getSessionOrNull } from '@/lib/utils/auth';

/**
 * Drop a button.
 *
 * By label, not by id — the same reasoning as `forgetPreference`: quoting an
 * id back would mean rendering nanoids into a prompt to serve the rarest
 * action, and the label is what the user is looking at when they say "прибери
 * кнопку про Арчі".
 *
 * Matching is exact-then-contains and *reports* ambiguity rather than guessing.
 * Deleting the wrong button is cheap to notice and cheap to redo, unlike
 * dropping the wrong standing rule — but it is still a thing the user did not
 * ask for, and there are at most twelve of these to name precisely.
 */
export const deleteQuickActionTool = {
  description: `Delete one of the user's quick-action buttons by its label ("прибери кнопку Арчі — ліки", "видали швидкий запис про температуру").
    Rows the button already wrote are NOT deleted — the records stay in the table. Say so.
    To change a button, delete it and create it again with createQuickAction.`,
  inputSchema: z.object({
    label: z.string().min(1).describe("The button's label, or a distinctive part of it"),
  }),
  execute: async ({ label }: { label: string }) => {
    const session = await getSessionOrNull();
    if (!session?.user?.id) throw new Error('Unauthorized');

    const wanted = label.trim().toLowerCase();
    const all = await listQuickActions();

    if (all.length === 0) {
      return { success: false, message: 'There are no quick actions to delete.' };
    }

    const exact = all.filter((a) => a.label.trim().toLowerCase() === wanted);
    const candidates =
      exact.length > 0 ? exact : all.filter((a) => a.label.toLowerCase().includes(wanted));

    if (candidates.length === 0) {
      return {
        success: false,
        message: `No quick action matching "${label}". Existing ones: ${all
          .map((a) => `"${a.label}"`)
          .join(', ')}.`,
      };
    }

    if (candidates.length > 1) {
      return {
        success: false,
        ambiguous: true,
        message: `"${label}" matches ${candidates.length} quick actions: ${candidates
          .map((a) => `"${a.label}"`)
          .join(', ')}. Ask which one.`,
      };
    }

    const result = await deleteQuickAction(candidates[0].id);
    if (!result.ok) return { success: false, message: result.error };

    return {
      success: true,
      message: `Quick action "${result.label}" deleted. The rows it already wrote are still in "${candidates[0].tableTitle}".`,
      label: result.label,
    };
  },
} as const;
