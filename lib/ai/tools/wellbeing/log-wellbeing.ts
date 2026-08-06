import { z } from 'zod';

import { getSessionOrNull } from '@/lib/utils/auth';
import { logWellbeingEntry } from '@/lib/actions/wellbeing';
import { SCALE_ANCHORS, formatSleep } from '@/lib/wellbeing/scale';

const anchors = Object.entries(SCALE_ANCHORS)
  .map(([value, meaning]) => `${value} = ${meaning}`)
  .join('; ');

/**
 * The one place a state check-in is recorded.
 *
 * It exists mainly to keep this out of `addResource`, which is instructed to
 * save personal facts proactively and would happily swallow "болить голова" as
 * prose. Prose cannot be charted, and the point of tracking state is the trend.
 */
export const logWellbeingTool = {
  // Kept to a few lines: every description here is concatenated into the system
  // prompt, and the routing rules already live there under "Wellbeing tracker".
  // What belongs to the tool and nowhere else is the scale.
  description: [
    'Record a wellbeing check-in (mood, energy, sleep, symptoms). Appends — call again when the state changes.',
    `Scales are 1-5: ${anchors}. Map the user's words onto that yourself; omit anything they did not mention.`,
  ].join('\n'),
  inputSchema: z.object({
    mood: z.number().int().min(1).max(5).optional().describe('1-5, how they feel emotionally'),
    energy: z.number().int().min(1).max(5).optional().describe('1-5, physical energy / tiredness'),
    sleepHours: z
      .number()
      .min(0)
      .max(24)
      .optional()
      .describe('Hours slept the night before this day, e.g. 6.5'),
    symptoms: z
      .array(z.string())
      .max(12)
      .optional()
      .describe('Short symptom labels in the user\'s own words, e.g. ["головний біль", "нудота"]'),
    note: z
      .string()
      .max(2000)
      .optional()
      .describe('What the user actually said about their state, verbatim where possible'),
    recordedAt: z
      .string()
      .optional()
      .describe('ISO 8601 instant with offset. Only for backdating a past state; omit for now.'),
  }),
  execute: async (input: {
    mood?: number;
    energy?: number;
    sleepHours?: number;
    symptoms?: string[];
    note?: string;
    recordedAt?: string;
  }) => {
    const session = await getSessionOrNull();
    if (!session?.user?.id) {
      throw new Error('Unauthorized');
    }

    try {
      const entry = await logWellbeingEntry({
        userId: session.user.id,
        input,
        source: session.user.surface === 'telegram' ? 'telegram' : 'web',
      });

      // Echoed back so the model confirms what was stored rather than what it
      // meant to store — the two diverge when it hands over an off-scale value.
      return {
        success: true,
        recorded: {
          date: entry.localDate,
          time: new Intl.DateTimeFormat('en-GB', {
            timeZone: entry.timezone,
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23',
          }).format(entry.recordedAt),
          mood: entry.mood,
          energy: entry.energy,
          sleep: entry.sleepMinutes !== null ? formatSleep(entry.sleepMinutes) : null,
          symptoms: entry.symptoms,
        },
        message: 'Check-in saved. Confirm the values back to the user.',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save the check-in.';
      return { success: false, message };
    }
  },
} as const;
