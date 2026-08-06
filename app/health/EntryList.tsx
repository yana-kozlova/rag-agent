'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Trash2 } from 'lucide-react';

import { SCALE_LABELS, formatSleep } from '@/lib/wellbeing/scale';

export type EntryView = {
  id: string;
  localDate: string;
  time: string;
  mood: number | null;
  energy: number | null;
  sleepMinutes: number | null;
  symptoms: string[];
  note: string | null;
  source: string;
};

/**
 * The day-by-day log under the charts.
 *
 * Every check-in is listed separately rather than folded into its day: the
 * charts already show the day as one point, and the reason to come here is to
 * see that the headache started after lunch — or to delete the entry where 6.5
 * hours of sleep got written down as 65.
 */
export default function EntryList({ entries }: { entries: EntryView[] }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(id: string) {
    setDeleting(id);
    setError(null);
    try {
      const res = await fetch(`/api/wellbeing?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setDeleting(null);
    }
  }

  const byDate = new Map<string, EntryView[]>();
  for (const entry of entries) {
    const list = byDate.get(entry.localDate) ?? [];
    list.push(entry);
    byDate.set(entry.localDate, list);
  }

  const days = [...byDate.entries()].sort((a, b) => b[0].localeCompare(a[0]));

  return (
    <div className="flex flex-col gap-5">
      {error && <p className="text-sm text-error">{error}</p>}

      {days.map(([date, dayEntries]) => (
        <section key={date}>
          <h3 className="mb-2 font-mono text-[10px] uppercase tracking-wide text-base-content/40">
            {date} · {dayEntries.length} check-in{dayEntries.length > 1 ? 's' : ''}
          </h3>

          <ul className="flex flex-col gap-2">
            {dayEntries.map((entry) => (
              <li
                key={entry.id}
                className="group flex items-start gap-3 rounded-box border border-base-300 bg-base-100 px-4 py-3"
              >
                <span className="mt-0.5 shrink-0 font-mono text-xs text-base-content/50">
                  {entry.time}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    {entry.mood !== null && (
                      <span>
                        Mood <strong>{entry.mood}</strong>
                        <span className="text-base-content/50"> · {SCALE_LABELS[entry.mood]}</span>
                      </span>
                    )}
                    {entry.energy !== null && (
                      <span className="text-base-content/70">Energy {entry.energy}</span>
                    )}
                    {entry.sleepMinutes !== null && (
                      <span className="text-base-content/70">
                        Slept {formatSleep(entry.sleepMinutes)}
                      </span>
                    )}
                  </div>

                  {entry.symptoms.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {entry.symptoms.map((symptom) => (
                        <span
                          key={symptom}
                          className="rounded-full bg-base-200 px-2 py-0.5 text-xs text-base-content/70"
                        >
                          {symptom}
                        </span>
                      ))}
                    </div>
                  )}

                  {entry.note && (
                    <p className="mt-1.5 whitespace-pre-wrap text-sm text-base-content/60">
                      {entry.note}
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => remove(entry.id)}
                  disabled={deleting === entry.id}
                  aria-label="Delete check-in"
                  className="shrink-0 rounded-md p-1.5 text-base-content/30 transition-colors hover:bg-base-200 hover:text-error disabled:opacity-40"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
