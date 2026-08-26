'use client';

import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { QuickField } from '@/lib/quick-actions/quick-actions';

/**
 * "You have written this row six times — shall I make it a button?"
 *
 * The repetition was always visible on this page; what was missing was anything
 * that read it. `detectRepeatingRow` reads it server-side, and this is the
 * offer, sitting where the table's buttons already live rather than at the top
 * of the page as an alert — the answer to it is "make me a button", and this is
 * where buttons are.
 *
 * Deliberately not dismissible-forever. There is no tombstone table behind it
 * because there is nothing to bury: the offer only exists while the routine is
 * live in the recent rows and no button covers it, so accepting removes it and
 * so does the habit stopping. "Not now" closes it for this visit, which is what
 * a person means by it.
 */
export function RoutineOffer({
  tableId,
  label,
  values,
  occurrences,
  days,
  fields,
  onCreated,
}: {
  tableId: string;
  label: string;
  values: string[];
  occurrences: number;
  days: number;
  fields: QuickField[];
  onCreated?: () => void;
}) {
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (hidden) return null;

  const asks = fields.filter((f) => f.kind === 'ask');

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/quick-actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableId, label, fields }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.ok) {
        setError(data?.error ?? 'Could not create the button.');
        return;
      }

      setHidden(true);
      // The bar on this page and the one on the dashboard both listen, so the
      // new button appears without a reload.
      window.dispatchEvent(new Event('quick-actions:changed'));
      onCreated?.();
    } catch {
      setError('Could not create the button.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-3 rounded-box border border-primary/30 bg-primary/5 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Sparkles className="h-4 w-4 shrink-0 text-primary" />
            This row keeps repeating
          </div>
          <p className="mt-1 text-sm text-base-content/70">
            <span className="font-mono">{values.join(' · ')}</span> — written {occurrences} times
            across {days} days. One tap could write it, with today&apos;s date filled in
            {asks.length > 0 && <> and only {asks.map((f) => f.prompt).join(', ')} to type</>}.
          </p>
          {error && <p className="mt-1 text-sm text-error">{error}</p>}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button className="btn btn-ghost btn-sm" onClick={() => setHidden(true)} disabled={busy}>
            Not now
          </button>
          <button className="btn btn-primary btn-sm" onClick={create} disabled={busy}>
            {busy ? 'Creating…' : `Create "${label}"`}
          </button>
        </div>
      </div>
    </div>
  );
}
