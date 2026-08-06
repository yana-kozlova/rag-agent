'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Sparkline } from '@/app/components/wellbeing/charts';
import type { DayPoint, RangeSummary } from '@/lib/wellbeing/aggregate';
import { SCALE_LABELS, formatSleep } from '@/lib/wellbeing/scale';

type Report = { days: DayPoint[]; summary: RangeSummary };

export default function WellbeingWidget() {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    fetch('/api/wellbeing?days=7')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled) setReport(data);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // The latest day that holds anything — not necessarily today, which is the
  // point: "last logged 3 days ago" is itself worth seeing.
  const latest = report?.days.filter((d) => d.entryCount > 0).at(-1) ?? null;

  return (
    <section className="w-full">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-base-content">How you feel</h2>
        <Link
          href="/health"
          className="text-[13px] font-medium text-base-content/50 transition-colors hover:text-primary"
        >
          History →
        </Link>
      </div>

      {loading ? (
        <div className="h-16 animate-pulse rounded-md bg-base-200" />
      ) : !latest ? (
        <p className="text-sm text-base-content/50">
          Nothing logged this week. Tell the assistant how you are.
        </p>
      ) : (
        <>
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="text-2xl font-semibold tabular-nums text-base-content">
                {latest.mood !== null ? latest.mood : '—'}
                <span className="ml-1 text-sm font-normal text-base-content/40">/5</span>
              </div>
              <div className="text-xs text-base-content/50">
                {latest.mood !== null ? SCALE_LABELS[Math.round(latest.mood)] : 'no rating'} ·{' '}
                {latest.date}
              </div>
            </div>
            <Sparkline days={report!.days} className="h-8 w-28" />
          </div>

          <dl className="mt-3 flex gap-4 text-xs text-base-content/60">
            <div>
              <dt className="inline">Energy </dt>
              <dd className="inline font-medium text-base-content/80">
                {latest.energy !== null ? `${latest.energy}/5` : '—'}
              </dd>
            </div>
            <div>
              <dt className="inline">Sleep </dt>
              <dd className="inline font-medium text-base-content/80">
                {latest.sleepMinutes !== null ? formatSleep(latest.sleepMinutes) : '—'}
              </dd>
            </div>
          </dl>

          {latest.symptoms.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {latest.symptoms.slice(0, 4).map((symptom) => (
                <span
                  key={symptom}
                  className="rounded-full bg-base-200 px-2 py-0.5 text-xs text-base-content/70"
                >
                  {symptom}
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
