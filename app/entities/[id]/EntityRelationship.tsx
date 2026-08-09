'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { resetRelationship, setRelationship } from '@/lib/actions/entity-relationship';
import { MAX_RELATIONSHIP_LENGTH } from '@/lib/entities/relationship';

/**
 * "…is my…" — the one line on this page that is a claim rather than evidence.
 *
 * Everything else in the header is derived and checkable: the name came from the
 * notes, the count is those notes, the mentions are listed underneath. The
 * relationship is the model's reading of a sentence, printed as fact, and it is
 * wrong in a specific and recurring way — a note that states how two other
 * people relate gets that relation filed against the user, so a son shows up as
 * a godson because the sentence that named him was about his godmother.
 *
 * Separate from `EntityIdentity` on purpose. That control asks "is this the same
 * thing as something else?", and its two answers both rewrite identity. This one
 * leaves identity alone: right person, wrong relation. Folding them into one
 * panel would put a destructive merge behind the same button as a typo fix.
 */

type Props = {
  entity: { id: string; relationship: string | null; relationshipSource: string };
};

export function EntityRelationship({ entity }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(entity.relationship ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mine = entity.relationshipSource === 'user';

  function close() {
    setOpen(false);
    setValue(entity.relationship ?? '');
    setError(null);
  }

  async function run(action: () => Promise<{ success: boolean; message: string }>) {
    setBusy(true);
    setError(null);

    const result = await action();

    setBusy(false);
    if (!result.success) {
      setError(result.message);
      return;
    }

    close();
    router.refresh();
  }

  if (!open) {
    return (
      <button type="button" className="btn btn-ghost btn-xs shrink-0" onClick={() => setOpen(true)}>
        {entity.relationship ? 'Fix relationship' : 'Add relationship'}
      </button>
    );
  }

  return (
    <div className="mt-3 w-full rounded-box border border-base-300 bg-base-200/40 p-3">
      <label className="mb-1 block font-mono text-[10px] uppercase tracking-wide text-base-content/40">
        To me, this is my
      </label>
      <input
        autoFocus
        className="input input-sm input-bordered w-full"
        value={value}
        disabled={busy}
        maxLength={MAX_RELATIONSHIP_LENGTH}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') run(() => setRelationship(entity.id, value));
          if (e.key === 'Escape') close();
        }}
        placeholder="son, colleague, my kuma's godson…"
      />

      <p className="mt-2 text-xs leading-relaxed text-base-content/60">
        {mine
          ? 'Your wording. Your notes will not overwrite it.'
          : 'Read out of your notes. Saving here replaces it for good — later notes stop rewriting it.'}{' '}
        Leaving it empty is an answer too: it means they are nothing in particular to you.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn btn-primary btn-xs"
          disabled={busy}
          onClick={() => run(() => setRelationship(entity.id, value))}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="btn btn-ghost btn-xs" disabled={busy} onClick={close}>
          Cancel
        </button>
        {/* The undo, and only worth offering once there is something to undo. */}
        {mine && (
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            disabled={busy}
            onClick={() => run(() => resetRelationship(entity.id))}
          >
            Let my notes decide again
          </button>
        )}
      </div>

      {error && <div className="mt-2 text-sm text-warning">{error}</div>}
    </div>
  );
}
