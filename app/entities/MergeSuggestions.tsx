'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { mergeEntities } from '@/lib/actions/entity-merge';
import type { MergeCandidate } from '@/lib/actions/entity-merge';

/**
 * "These two look like one person — are they?"
 *
 * The rules that produce these pairs are deliberately over-eager, so the whole
 * design rests on nobody acting but the user: a rejected suggestion costs a
 * glance, while a wrong merge quietly welds two real people together. Hence a
 * button per pair rather than a "merge all".
 */

const REASON_LABEL: Record<MergeCandidate['reason'], string> = {
  'same-spelling': 'identical name',
  'same-sound': 'same name, different script',
  contained: 'one name inside the other',
};

export function MergeSuggestions({ candidates }: { candidates: MergeCandidate[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  // Dismissals live for this render only: they are a "not now", not a decision,
  // and persisting them would need a table to store an absence of an opinion.
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const visible = candidates.filter((c) => !hidden.has(`${c.winner.id}:${c.loser.id}`));
  if (visible.length === 0) return null;

  async function merge(candidate: MergeCandidate) {
    const key = `${candidate.winner.id}:${candidate.loser.id}`;
    setBusy(key);
    setError(null);

    const result = await mergeEntities(candidate.winner.id, candidate.loser.id);

    setBusy(null);
    if (!result.success) {
      setError(result.message);
      return;
    }

    // The merge changes counts and can create further candidates, so the list
    // is re-derived on the server rather than patched here.
    router.refresh();
  }

  return (
    <section className="mb-6 rounded-box border border-base-300 bg-base-100 p-4">
      <h2 className="mb-1 text-sm font-semibold">Possible duplicates</h2>
      <p className="mb-3 text-xs text-base-content/60">
        Merging keeps every note. The other spelling is remembered, so it will not
        split off again.
      </p>

      <ul className="flex flex-col gap-2">
        {visible.map((candidate) => {
          const key = `${candidate.winner.id}:${candidate.loser.id}`;
          return (
            <li
              key={key}
              className="flex flex-wrap items-center justify-between gap-2 rounded-box border border-base-300 px-3 py-2"
            >
              <div className="min-w-0 text-sm">
                <span className="font-medium">{candidate.winner.name}</span>
                <span className="text-base-content/40"> ← </span>
                <span className="font-medium">{candidate.loser.name}</span>
                <span className="ml-2 text-xs text-base-content/50">
                  {REASON_LABEL[candidate.reason]}
                </span>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  className="btn btn-primary btn-xs"
                  disabled={busy !== null}
                  onClick={() => merge(candidate)}
                >
                  {busy === key ? 'Merging…' : 'Same person'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  disabled={busy !== null}
                  onClick={() => setHidden((prev) => new Set(prev).add(key))}
                >
                  Not now
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {error && <div className="mt-2 text-sm text-warning">{error}</div>}
    </section>
  );
}
