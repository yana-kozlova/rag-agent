import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/app/api/auth/auth';
import { getWellbeingReport } from '@/lib/actions/wellbeing';
import { SleepChart, TrendChart } from '@/app/components/wellbeing/charts';
import { formatSleep } from '@/lib/wellbeing/scale';
import EntryList, { type EntryView } from './EntryList';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Ranges offered as links rather than a client control — the page is a read, and this keeps it one. */
const RANGES = [
  { days: 7, label: '7d' },
  { days: 30, label: '30d' },
  { days: 90, label: '90d' },
  { days: 365, label: '1y' },
];

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-box border border-base-300 bg-base-100 px-4 py-3">
      <div className="font-mono text-[10px] uppercase tracking-wide text-base-content/40">
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold tabular-nums text-base-content">{value}</div>
      {hint && <div className="text-xs text-base-content/50">{hint}</div>}
    </div>
  );
}

export default async function HealthPage({
  searchParams,
}: {
  searchParams: { days?: string };
}) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect('/api/auth/signin');

  const requested = Number.parseInt(searchParams.days ?? '', 10);
  const days = RANGES.some((r) => r.days === requested) ? requested : 30;

  const report = await getWellbeingReport(userId, days);
  const { summary } = report;

  // Newest first, and capped: at a year's range the full log is thousands of
  // rows serialised into the page for a section nobody scrolls that far down.
  // The charts above already cover the whole range.
  const LOG_LIMIT = 100;

  const entries: EntryView[] = report.entries
    .slice()
    .reverse()
    .slice(0, LOG_LIMIT)
    .map((entry) => ({
      id: entry.id,
      localDate: entry.localDate,
      time: new Intl.DateTimeFormat('en-GB', {
        timeZone: report.timezone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(new Date(entry.recordedAt)),
      mood: entry.mood,
      energy: entry.energy,
      sleepMinutes: entry.sleepMinutes,
      symptoms: entry.symptoms ?? [],
      note: entry.note,
      source: entry.source,
    }));

  const maxSymptomDays = report.symptoms[0]?.days ?? 1;

  return (
    <div className="container mx-auto max-w-4xl p-4 md:p-6">
      <header className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Health</h1>
          <p className="mt-1 text-sm text-base-content/60">
            How you have been feeling. Logged from chat — just say how you are.
          </p>
        </div>

        <nav className="flex items-center gap-1 rounded-box border border-base-300 bg-base-100 p-1">
          {RANGES.map((range) => (
            <Link
              key={range.days}
              href={`/health?days=${range.days}`}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                range.days === days
                  ? 'bg-primary text-primary-content'
                  : 'text-base-content/60 hover:bg-base-200'
              }`}
            >
              {range.label}
            </Link>
          ))}
        </nav>
      </header>

      {summary.daysLogged === 0 ? (
        <div className="rounded-box border border-base-300 bg-base-100 p-6 text-center">
          <p className="text-sm text-base-content/60">
            Nothing logged in this range. Tell the assistant how you feel — &ldquo;спала 6 годин,
            настрій норм&rdquo; — in chat or on Telegram, and it lands here.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat
              label="Avg mood"
              value={summary.avgMood !== null ? `${summary.avgMood}` : '—'}
              hint="out of 5"
            />
            <Stat
              label="Avg energy"
              value={summary.avgEnergy !== null ? `${summary.avgEnergy}` : '—'}
              hint="out of 5"
            />
            <Stat
              label="Avg sleep"
              value={
                summary.avgSleepMinutes !== null
                  ? formatSleep(Math.round(summary.avgSleepMinutes))
                  : '—'
              }
              hint="per night"
            />
            <Stat
              label="Logged"
              value={`${summary.daysLogged}`}
              hint={`days · ${summary.entryCount} check-ins`}
            />
          </div>

          <section className="rounded-box border border-base-300 bg-base-100 p-4">
            <h2 className="mb-3 text-[15px] font-semibold">Mood &amp; energy</h2>
            <TrendChart days={report.days} />
          </section>

          <section className="rounded-box border border-base-300 bg-base-100 p-4">
            <h2 className="mb-3 text-[15px] font-semibold">Sleep</h2>
            <SleepChart days={report.days} />

            {report.sleepVsMood && (
              <p className="mt-3 text-xs text-base-content/60">
                Average mood was{' '}
                <strong className="text-base-content">
                  {report.sleepVsMood.longNights.avgMood}
                </strong>{' '}
                on the {report.sleepVsMood.longNights.days} days after{' '}
                {formatSleep(report.sleepVsMood.thresholdMinutes)}+ of sleep, versus{' '}
                <strong className="text-base-content">
                  {report.sleepVsMood.shortNights.avgMood}
                </strong>{' '}
                on the {report.sleepVsMood.shortNights.days} days after less.
              </p>
            )}
          </section>

          {report.symptoms.length > 0 && (
            <section className="rounded-box border border-base-300 bg-base-100 p-4">
              <h2 className="mb-3 text-[15px] font-semibold">Symptoms</h2>
              <ul className="flex flex-col gap-2">
                {report.symptoms.slice(0, 10).map((item) => (
                  <li key={item.symptom} className="flex items-center gap-3">
                    <span className="w-40 shrink-0 truncate text-sm text-base-content/80">
                      {item.symptom}
                    </span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-base-200">
                      <span
                        className="block h-full rounded-full bg-secondary"
                        style={{ width: `${Math.round((item.days / maxSymptomDays) * 100)}%` }}
                      />
                    </span>
                    <span className="w-16 shrink-0 text-right font-mono text-xs text-base-content/50">
                      {item.days}d
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h2 className="mb-3 text-[15px] font-semibold">
              Log
              {summary.entryCount > entries.length && (
                <span className="ml-2 text-xs font-normal text-base-content/40">
                  latest {entries.length} of {summary.entryCount}
                </span>
              )}
            </h2>
            <EntryList entries={entries} />
          </section>

          <p className="text-xs text-base-content/40">
            A record of what you said, not a medical assessment.
          </p>
        </div>
      )}
    </div>
  );
}
