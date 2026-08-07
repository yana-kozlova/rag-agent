import { z } from 'zod';

import { getSessionOrNull } from '@/lib/utils/auth';
import { forgetDirectiveByText } from '@/lib/actions/directives';

/**
 * Drop a standing instruction.
 *
 * Matched by description because the directives are rendered into the prompt
 * without their ids — see `matchDirective`. An ambiguous match asks rather than
 * picking: the user does not see which rule went, so a wrong deletion surfaces
 * only as the assistant quietly reverting to a habit they had already fixed.
 */
export const forgetPreferenceTool = {
  description: [
    'Remove a standing instruction saved by rememberPreference, when the user cancels or reverses it',
    '("більше не треба коротко", "можеш знову пропонувати варіанти").',
    'Describe the rule in your own words — it is matched against the list in your prompt.',
    'Only for response preferences; use forgetInformation for saved notes and facts.',
  ].join(' '),
  inputSchema: z.object({
    text: z
      .string()
      .min(1)
      .describe('The rule to remove, worded close to how it appears under "How this user wants you to respond".'),
  }),
  execute: async (input: { text: string }) => {
    const session = await getSessionOrNull();
    if (!session?.user?.id) {
      throw new Error('Unauthorized');
    }

    const result = await forgetDirectiveByText(session.user.id, input.text);

    if (result.ok) {
      return {
        success: true,
        removed: result.directive.text,
        message: 'Removed. It still applies to this reply and stops from the next one.',
      };
    }

    if (result.reason === 'ambiguous') {
      return {
        success: false,
        candidates: result.candidates.map((d) => d.text),
        message: 'More than one rule matches. Ask the user which of these to drop — do not guess.',
      };
    }

    return {
      success: false,
      message: 'No standing instruction matches that. Say so rather than inventing one.',
    };
  },
} as const;
