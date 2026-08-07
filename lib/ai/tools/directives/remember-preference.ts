import { z } from 'zod';

import { getSessionOrNull } from '@/lib/utils/auth';
import { rememberDirective } from '@/lib/actions/directives';
import { MAX_DIRECTIVES, MAX_DIRECTIVE_LENGTH } from '@/lib/directives/directives';

/**
 * Save a standing instruction about how to respond.
 *
 * Split from `addResource` for the same reason `logWellbeing` is: that tool is
 * told to save preferences proactively and will happily file "відповідай
 * коротше" as prose, where it becomes findable and never applied. What lands
 * here is prepended to every turn instead.
 *
 * The line between them is what the sentence is *about*. "I like oat milk" is a
 * fact about the user — `addResource`. "Stop asking me to confirm every save"
 * is an instruction to the assistant — here.
 */
export const rememberPreferenceTool = {
  description: [
    'Save a standing instruction about HOW to respond — language, length, format, tone, what to skip,',
    'when to ask versus act. Applies to every future reply on every surface.',
    'Call it when the user states a preference about your behaviour ("відповідай коротше", "не питай',
    'щоразу", "пиши українською"), and also when they correct the same behaviour a second time —',
    'pass source:"inferred" for that case so they can see it was your reading, not their words.',
    'NOT for facts about the user (what they like, own, or do) — those go to addResource.',
    'One rule per call, in the user\'s own language, phrased as an instruction to you.',
    `At most ${MAX_DIRECTIVES} may be active; adding past that fails and the user must drop one.`,
  ].join(' '),
  inputSchema: z.object({
    text: z
      .string()
      .min(1)
      .max(MAX_DIRECTIVE_LENGTH)
      .describe(
        'The rule, imperative and self-contained: "Answer in Ukrainian unless I write in English", ' +
          '"Skip the preamble, lead with the answer", "Do not offer follow-up suggestions". ' +
          'No context, no explanation of why — it is read without this conversation attached.'
      ),
    source: z
      .enum(['user', 'inferred'])
      .default('user')
      .describe('"user" when they asked for it in words; "inferred" when you read it off a repeated correction.'),
  }),
  execute: async (input: { text: string; source?: 'user' | 'inferred' }) => {
    const session = await getSessionOrNull();
    if (!session?.user?.id) {
      throw new Error('Unauthorized');
    }

    const result = await rememberDirective(session.user.id, input);

    if (result.ok) {
      return {
        success: true,
        saved: result.directive.text,
        // The model has the old list in its prompt and would otherwise report
        // this as applying from the next message. It applies from the next one.
        message: 'Saved. It takes effect from your next reply — confirm it back briefly.',
      };
    }

    switch (result.reason) {
      case 'duplicate':
        return {
          success: false,
          message: `Already saved as "${result.existing?.text}" — tell the user it is already in force.`,
        };
      case 'full':
        return {
          success: false,
          message:
            `They already have ${result.count} standing instructions, which is the limit. ` +
            'Ask which one to drop, then call forgetPreference for it.',
        };
      case 'too-long':
        return {
          success: false,
          message: `Too long — a rule must fit in ${MAX_DIRECTIVE_LENGTH} characters. Shorten it and retry.`,
        };
      default:
        return { success: false, message: 'Nothing to save.' };
    }
  },
} as const;
