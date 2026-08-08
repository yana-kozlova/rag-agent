'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { deleteEntity } from '@/lib/actions/entity-delete';

/**
 * "This is not a thing."
 *
 * The correction rename and merge cannot make. Both of those assume the node
 * names something — one fixes the spelling, the other says two nodes are one.
 * Neither helps with a greeting the extractor read as a person or a stray noun
 * it read as a place, and those are the entries that make a graph tiring to
 * look at.
 *
 * Confirmation spells out the two things a person is right to worry about
 * before pressing it: the notes are untouched, and it stays deleted. The second
 * is the surprising one — a node that came back on the next save would look
 * like the delete had failed.
 */

type Props = {
  entity: { id: string; name: string; mentionCount: number };
};

export function EntityDelete({ entity }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);

    const result = await deleteEntity(entity.id);

    if (!result.success) {
      setBusy(false);
      setError(result.message);
      return;
    }

    // The node this page is about is gone, so there is nothing to refresh into.
    router.push('/entities');
  }

  if (!open) {
    return (
      <button
        type="button"
        className="btn btn-ghost btn-xs shrink-0 text-base-content/50 hover:text-error"
        onClick={() => setOpen(true)}
      >
        Delete
      </button>
    );
  }

  return (
    <div className="mt-3 w-full rounded-box border border-error/30 bg-error/5 p-3">
      <p className="text-sm">
        Delete <span className="font-medium">{entity.name}</span> from the graph?
      </p>
      <p className="mt-1 text-xs leading-relaxed text-base-content/60">
        {entity.mentionCount === 0
          ? 'No note mentions it, so nothing else changes.'
          : `The ${entity.mentionCount} ${entity.mentionCount === 1 ? 'note' : 'notes'} behind it are not touched — they keep their text and stay searchable.`}{' '}
        The name stops becoming an entity, so it will not reappear the next time a
        note mentions it. You can undo this from the entities page.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn btn-error btn-xs" disabled={busy} onClick={remove}>
          {busy ? 'Deleting…' : 'Delete'}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-xs"
          disabled={busy}
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
        >
          Cancel
        </button>
      </div>

      {error && <div className="mt-2 text-sm text-warning">{error}</div>}
    </div>
  );
}
