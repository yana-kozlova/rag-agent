'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { timelineKindIcon, UPCOMING_HORIZON_DAYS } from '@/lib/timeline/timeline';

type Occurrence = {
  date: string;
  daysAway: number;
  years: number | null;
  event: { id: string; title: string; kind: string; subject: string | null };
};

const MAX_SHOWN = 5;

function when(daysAway: number): string {
  if (daysAway === 0) return 'today';
  if (daysAway === 1) return 'tomorrow';
  if (daysAway < 7) return `${daysAway}d`;
  if (daysAway < 30) return `${Math.round(daysAway / 7)}w`;
  return `${Math.round(daysAway / 30)}mo`;
}

/**
 * The dates coming up, and only those.
 *
 * Asks for the narrow read (`view=upcoming`) rather than the whole axis: a
 * lifetime of dates serialised into the dashboard to render five lines is work
 * that grows every year and shows nothing extra.
 */
export default function TimelineWidget() {
  const [occurrences, setOccurrences] = useState<Occurrence[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);

  // Failure is a separate state from emptiness, and conflating them cost real
  // time: a 500 from this route left the panel saying "nothing in the next 60
  // days" — a confident statement about the data, made by a widget that had not
  // read any. "Nothing saved yet" and "could not read it" are opposite
  // instructions to whoever is looking at it.
  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/timeline?view=upcoming&days=${UPCOMING_HORIZON_DAYS}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setOccurrences(Array.isArray(data?.occurrences) ? data.occurrences : []);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // A date mentioned in the chat rail lands on the axis through `addResource`,
  // so this listens to the same event the other widgets do — otherwise saving
  // "у Андрія день народження 14 березня" leaves the panel beside it stale.
  useEffect(() => {
    load();
    const onChange = () => load();
    window.addEventListener('dashboard:resources-changed', onChange);
    return () => window.removeEventListener('dashboard:resources-changed', onChange);
  }, [load]);

  const shown = occurrences?.slice(0, MAX_SHOWN) ?? [];

  return (
    <section className="w-full">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-base-content">Dates ahead</h2>
        <Link
          href="/timeline"
          className="text-[13px] font-medium text-base-content/50 transition-colors hover:text-primary"
        >
          Timeline →
        </Link>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-6 animate-pulse rounded-md bg-base-200" />
          ))}
        </div>
      ) : failed ? (
        <div className="text-sm text-base-content/50">
          <p>Could not read the timeline.</p>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              load();
            }}
            className="mt-1 link link-hover text-[13px] font-medium"
          >
            Try again
          </button>
        </div>
      ) : shown.length === 0 ? (
        <p className="text-sm text-base-content/50">
          Nothing in the next {UPCOMING_HORIZON_DAYS} days. Past dates are on the{' '}
          <Link href="/timeline" className="link link-hover">
            timeline
          </Link>
          ; birthdays and anniversaries appear here as they come round.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((occurrence) => (
            <li key={`${occurrence.event.id}:${occurrence.date}`} className="flex items-baseline gap-2">
              <span className="w-10 shrink-0 font-mono text-[11px] uppercase text-base-content/40">
                {when(occurrence.daysAway)}
              </span>
              <span className="shrink-0" aria-hidden>
                {timelineKindIcon(occurrence.event.kind)}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">{occurrence.event.title}</span>
              {occurrence.years !== null && occurrence.years > 0 && (
                <span className="shrink-0 font-mono text-xs text-base-content/40">
                  {occurrence.years}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
