import { z } from 'zod';

import { recordTimelineEvent } from '@/lib/actions/timeline';
import { getSessionOrNull } from '@/lib/utils/auth';
import {
  MAX_TIMELINE_NOTE,
  MAX_TIMELINE_TITLE,
  TIMELINE_KINDS,
  formatTimelineDate,
} from '@/lib/timeline/timeline';
import type { DatePrecision } from '@/lib/timeline/timeline';

/**
 * A date stated outright, put straight on the axis.
 *
 * Saving it as a note would also work — extraction reads dates out of notes, so
 * "у Андрія день народження 14 березня" would land on the timeline either way.
 * What that path cannot do is take a date with no year: extraction has to infer
 * `--MM-DD` from prose, and when it guesses a year instead the birthday quietly
 * becomes a one-off event in 2026. Stating it here is also the only way to
 * *correct* a date, since a second note about the same day is a second note.
 *
 * The description carries the same refusal `DATE_EXTRACTION_RULES` does, and it
 * has to: extraction is governed by those rules, but a direct call to this tool
 * is governed by nothing except what is written here. The first thing a real
 * base produced through it was "Візит до Закладу…" — an appointment, which is
 * exactly the category the timeline exists to keep out. An axis that fills with
 * visits and meetings is a worse calendar, and stops being a place anyone looks
 * for the dates they would still name in ten years.
 */
export const rememberDateTool = {
  description: [
    'Record a date on the timeline: births, deaths, weddings, moves, first days at a school or job,',
    'trips, diagnoses and procedures, significant purchases, achievements, anniversaries.',
    'The test is whether the user would still name this day in five years.',
    'NEVER for an appointment, a visit, a meeting, a call, a deadline or anything else that stops',
    'mattering once it has passed — those are scheduleEvent, and the calendar already holds them.',
    'When unsure, say nothing rather than record: a wrong date on the axis looks exactly as',
    'trustworthy as a right one.',
    'Say the date as precisely as the user did and no more: YYYY-MM-DD, YYYY-MM, YYYY, or --MM-DD when a birthday has no year.',
  ].join('\n'),
  inputSchema: z.object({
    title: z
      .string()
      .max(MAX_TIMELINE_TITLE)
      .describe("What happened, in the user's own language — \"Артем народився\", \"переїзд до Львова\""),
    date: z
      .string()
      .describe(
        'YYYY-MM-DD when the day is known, YYYY-MM for a month, YYYY for a year, --MM-DD for a day and month with no year. Never invent a component the user did not say.'
      ),
    kind: z
      .enum(TIMELINE_KINDS)
      .optional()
      .describe('What sort of date this is'),
    subject: z
      .string()
      .optional()
      .describe('Whose date it is, named as the user names them — "Андрій". Omit if it is about no one in particular.'),
    note: z
      .string()
      .max(MAX_TIMELINE_NOTE)
      .optional()
      .describe('One sentence of detail worth keeping with the date'),
    recurring: z
      .boolean()
      .optional()
      .describe('True only if it comes round every year (birthday, anniversary). A --MM-DD date always does.'),
  }),
  execute: async (input: {
    title: string;
    date: string;
    kind?: string;
    subject?: string;
    note?: string;
    recurring?: boolean;
  }) => {
    const session = await getSessionOrNull();
    if (!session?.user?.id) {
      throw new Error('Unauthorized');
    }

    const result = await recordTimelineEvent({
      userId: session.user.id,
      input: {
        title: input.title,
        date: input.date,
        kind: input.kind,
        subject: input.subject,
        note: input.note,
        recurrence: input.recurring ? 'annual' : 'none',
      },
      source: 'tool',
    });

    if (!result.success) return result;

    const { event, duplicate } = result;

    // Echoed back as stored rather than as asked for: the two differ exactly
    // when the model handed over a precision the user never gave, and this is
    // where that is visible.
    return {
      success: true,
      duplicate,
      id: event.id,
      url: '/timeline',
      recorded: {
        title: event.title,
        date: formatTimelineDate(event.occurredOn, event.precision as DatePrecision),
        recurring: event.recurrence === 'annual',
        subject: event.subject,
      },
      message: duplicate
        ? 'That date was already on the timeline. Confirm it back rather than saving again.'
        : 'Saved to the timeline. Confirm the date back to the user as it is stored.',
    };
  },
} as const;
