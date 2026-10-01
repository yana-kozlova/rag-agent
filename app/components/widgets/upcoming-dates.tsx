'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { timelineKindIcon } from '@/lib/timeline/timeline';

/**
 * Birthdays and anniversaries about to come round.
 *
 * The timeline has known these all along and the morning briefing prints them,
 * but the dashboard showed only the calendar — so a birthday saved as a note
 * was visible on `/timeline` and in Telegram and nowhere on the page opened
 * every day. The horizon is a fortnight: long enough to buy a present, short
 * enough that the card is not the same six lines for two months.
 */

const HORIZON_DAYS = 14;
const MAX_SHOWN = 6;

type Occurrence = {
  date: string;
  daysAway: number;
  /** Null when the original year was never recorded — then no age is claimed. */
  years: number | null;
  event: {
    id: string;
    title: string;
    kind: string;
    subject: string | null;
    resourceId: string | null;
  };
};

function whenLabel(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

/** "28 Sep", read off the string — a `Date` parse would shift it west of UTC. */
function shortDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

function yearsLabel(kind: string, years: number | null): string | null {
  if (years === null || years <= 0) return null;
  return kind === 'birth' ? `turns ${years}` : `${years} ${years === 1 ? 'year' : 'years'}`;
}

export default function UpcomingDates() {
  const [items, setItems] = useState<Occurrence[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const load = () => {
      fetch(`/api/timeline?view=upcoming&days=${HORIZON_DAYS}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (active && Array.isArray(data?.occurrences)) setItems(data.occurrences);
        })
        .catch(() => {})
        .finally(() => {
          if (active) setLoading(false);
        });
    };

    load();
    // A note saved in the chat rail can carry a date.
    window.addEventListener('dashboard:resources-changed', load);
    return () => {
      active = false;
      window.removeEventListener('dashboard:resources-changed', load);
    };
  }, []);

  const shown = items.slice(0, MAX_SHOWN);

  return (
    <section className="w-full">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-base-content">Dates</h2>
        <Link
          href="/timeline"
          className="text-[13px] font-medium text-base-content/50 transition-colors hover:text-primary"
        >
          Timeline →
        </Link>
      </div>

      {loading && items.length === 0 ? (
        <div className="space-y-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-9 animate-pulse rounded-md bg-base-200" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <p className="text-sm text-base-content/50">No dates in the next two weeks.</p>
      ) : (
        <ul className="flex flex-col">
          {shown.map((item) => {
            const years = yearsLabel(item.event.kind, item.years);
            const soon = item.daysAway <= 1;
            return (
              <li key={`${item.event.id}:${item.date}`}>
                <Link
                  // The note is where the details are; a date typed straight onto
                  // the axis has none, so it opens the axis.
                  href={item.event.resourceId ? `/resources/${item.event.resourceId}` : '/timeline'}
                  className="-mx-2 flex items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-base-200/60"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-base-200 text-base">
                    {timelineKindIcon(item.event.kind)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-base-content">{item.event.title}</div>
                    <div className="truncate font-mono text-xs text-base-content/50">
                      <span className={soon ? 'font-medium text-primary' : ''}>{whenLabel(item.daysAway)}</span>
                      {' · '}
                      {shortDate(item.date)}
                      {years ? ` · ${years}` : ''}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {items.length > shown.length && (
        <p className="mt-2 font-mono text-[11px] text-base-content/40">+{items.length - shown.length} more</p>
      )}
    </section>
  );
}
