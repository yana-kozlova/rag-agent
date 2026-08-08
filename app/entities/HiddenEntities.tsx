'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { HiddenEntity } from '@/lib/actions/entities';
import { restoreEntity } from '@/lib/actions/entity-delete';

/**
 * What was deleted, and the way back.
 *
 * A delete here is not a row disappearing — it writes a standing rule that this
 * name is not a node, which then quietly filters every save from now on. A rule
 * like that has to be visible somewhere or it is indistinguishable from a bug:
 * the user deletes "Марта", writes three notes about Марта, and no entity ever
 * appears. This section is where that rule can be read and lifted.
 *
 * Collapsed by default, because it is a list of things deliberately put away.
 */

export function HiddenEntities({ hidden }: { hidden: HiddenEntity[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  if (hidden.length === 0) return null;

  async function restore(entry: HiddenEntity) {
    setBusy(entry.id);
    setNote(null);

    const result = await restoreEntity(entry.id);

    setBusy(null);
    setNote(result.message);

    // Rebuilding may have recreated the node and certainly changed this list,
    // so both are re-derived on the server rather than patched here.
    router.refresh();
  }

  return (
    <section className="mb-6">
      <button
        type="button"
        className="font-mono text-[10px] uppercase tracking-wide text-base-content/40 transition-colors hover:text-primary"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? '▾' : '▸'} Hidden · {hidden.length}
      </button>

      {open && (
        <div className="mt-2 rounded-box border border-base-300 bg-base-100 p-4">
          <p className="mb-3 text-xs text-base-content/60">
            Names you deleted. Notes mentioning them are untouched and still
            searchable — they just do not become entities. Restoring rebuilds the
            entity from those notes.
          </p>

          <ul className="flex flex-col gap-2">
            {hidden.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-box border border-base-300 px-3 py-2"
              >
                <div className="min-w-0 text-sm">
                  <span className="font-medium">{entry.name}</span>
                  <span className="ml-2 font-mono text-[11px] text-base-content/50">
                    {entry.type}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs shrink-0"
                  disabled={busy !== null}
                  onClick={() => restore(entry)}
                >
                  {busy === entry.id ? 'Restoring…' : 'Restore'}
                </button>
              </li>
            ))}
          </ul>

          {note && <div className="mt-2 text-xs text-base-content/60">{note}</div>}
        </div>
      )}
    </section>
  );
}
