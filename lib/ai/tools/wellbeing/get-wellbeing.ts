import { z } from 'zod';

import { getSessionOrNull } from '@/lib/utils/auth';
import { getWellbeingReport } from '@/lib/actions/wellbeing';
import { formatSleep } from '@/lib/wellbeing/scale';

export const getWellbeingTool = {
  description:
    'Read the wellbeing tracker: mood, energy, sleep and recurring symptoms over the last N days. Prefer over getInformation for these — it has the numbers.',
  inputSchema: z.object({
    days: z
      .number()
      .int()
      .min(1)
      .max(365)
      .optional()
      .describe('How many days back to read, ending today. Defaults to 14.'),
  }),
  execute: async ({ days }: { days?: number }) => {
    const session = await getSessionOrNull();
    if (!session?.user?.id) {
      throw new Error('Unauthorized');
    }

    const report = await getWellbeingReport(session.user.id, days ?? 14);

    if (report.summary.daysLogged === 0) {
      return {
        success: true,
        range: `${report.from} … ${report.to}`,
        daysLogged: 0,
        message: 'No check-ins recorded in this range.',
        url: '/health',
      };
    }

    const { summary } = report;

    return {
      success: true,
      range: `${report.from} … ${report.to}`,
      // Where the charts are. A tool that reports on saved data and hands back
      // no address is one the model has to guess an address for.
      url: '/health',
      daysLogged: summary.daysLogged,
      checkIns: summary.entryCount,
      average: {
        mood: summary.avgMood,
        energy: summary.avgEnergy,
        sleep: summary.avgSleepMinutes !== null ? formatSleep(Math.round(summary.avgSleepMinutes)) : null,
      },
      // Only days that hold something. Empty days matter on a chart, where the
      // gap is visible; in a tool result they are a page of nulls the model
      // pays for and then has to reason past.
      byDay: report.days
        .filter((d) => d.entryCount > 0)
        .map((d) => ({
          date: d.date,
          mood: d.mood,
          energy: d.energy,
          sleep: d.sleepMinutes !== null ? formatSleep(d.sleepMinutes) : null,
          symptoms: d.symptoms.length > 0 ? d.symptoms : undefined,
          checkIns: d.entryCount,
        })),
      recurringSymptoms: report.symptoms.slice(0, 8),
      // Present only when both sides hold enough days to mean anything.
      sleepVsMood: report.sleepVsMood
        ? {
            threshold: formatSleep(report.sleepVsMood.thresholdMinutes),
            under: report.sleepVsMood.shortNights,
            over: report.sleepVsMood.longNights,
          }
        : undefined,
    };
  },
} as const;
