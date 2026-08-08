import { z } from 'zod';

import { queryTimelineEvents, upcomingTimeline } from '@/lib/actions/timeline';
import { getSessionOrNull } from '@/lib/utils/auth';
import { formatTimelineDate, type DatePrecision } from '@/lib/timeline/timeline';

/**
 * Reading the axis.
 *
 * Distinct from `getInformation`, which searches prose and would answer "коли ми
 * переїхали?" only if some note happens to embed near the question. This answers
 * from the dates themselves, which is the only way to answer "що було у 2022?"
 * or "чий день народження скоро" at all — those are questions about order, and
 * order is exactly what the note text does not have.
 */
export const getTimelineTool = {
  description: [
    'Look up dates on the timeline: what happened in a year or period, dates about one person, or what is coming up.',
    'Use for "коли...", "що було у 2022", "чий день народження скоро". Scheduling questions go to getEvents.',
  ].join('\n'),
  inputSchema: z.object({
    upcomingDays: z
      .number()
      .int()
      .min(1)
      .max(365)
      .optional()
      .describe('Look ahead this many days instead of back — for "what is coming up"'),
    year: z.string().optional().describe('A single year, e.g. "2022"'),
    from: z.string().optional().describe('Start of a range, YYYY-MM-DD'),
    to: z.string().optional().describe('End of a range, YYYY-MM-DD'),
    subject: z.string().optional().describe('Only dates about this person, as the user names them'),
    search: z.string().optional().describe('Substring to match in the title or detail'),
  }),
  execute: async (input: {
    upcomingDays?: number;
    year?: string;
    from?: string;
    to?: string;
    subject?: string;
    search?: string;
  }) => {
    const session = await getSessionOrNull();
    if (!session?.user?.id) {
      throw new Error('Unauthorized');
    }

    const userId = session.user.id;

    if (input.upcomingDays) {
      const { today, occurrences } = await upcomingTimeline(userId, input.upcomingDays);

      return {
        success: true,
        today,
        upcoming: occurrences.map((o) => ({
          date: o.date,
          daysAway: o.daysAway,
          title: o.event.title,
          subject: o.event.subject,
          kind: o.event.kind,
          // Present only when the original year is known, which is what makes
          // "виповнюється 7" safe to say and its absence a reason not to.
          years: o.years,
        })),
        url: '/timeline',
      };
    }

    // A year is a year, not the first of January: "що було у 2022" asks about
    // all of it, and a bare equality would answer with almost nothing.
    const from = input.year ? `${input.year}-01-01` : input.from;
    const to = input.year ? `${input.year}-12-31` : input.to;

    const events = await queryTimelineEvents(userId, {
      from,
      to,
      subject: input.subject,
      search: input.search,
    });

    return {
      success: true,
      count: events.length,
      events: events.map((event) => ({
        date: formatTimelineDate(event.occurredOn, event.precision as DatePrecision),
        sortKey: event.occurredOn,
        title: event.title,
        subject: event.subject,
        kind: event.kind,
        note: event.note,
        recurring: event.recurrence === 'annual',
      })),
      url: '/timeline',
    };
  },
} as const;
