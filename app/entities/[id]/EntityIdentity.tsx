'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { mergeEntities } from '@/lib/actions/entity-merge';
import { renameEntity, type EntityRef } from '@/lib/actions/entity-rename';

/**
 * "This is actually…" — one question with two answers.
 *
 * A name the model got wrong and a node that split in two are the same problem
 * seen from either end, and both are repaired by the same alias row: if the name
 * typed here belongs to an existing node it is a merge, and otherwise a rename.
 * So there is one input rather than a rename field and a separate merge picker
 * the user has to know to choose between.
 *
 * The automatic suggestions on `/entities` are deliberately narrow — phonetic
 * folding and prefix containment, nothing else — so the pairs that need this are
 * exactly the ones nothing can propose: a bare surname against a full name, a
 * diminutive, an abbreviation, a name filed under two types.
 */

type Props = { entity: EntityRef };

export function EntityIdentity({ entity }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(entity.name);
  const [matches, setMatches] = useState<EntityRef[]>([]);
  const [picked, setPicked] = useState<EntityRef | null>(null);
  // Which of the pair survives. The default is that this page's node is the one
  // being resolved *away* — you open this from the duplicate you are looking at.
  const [keepThis, setKeepThis] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const typed = query.trim();

  useEffect(() => {
    if (!open || picked || typed.length < 2) {
      setMatches([]);
      return;
    }

    // Debounced, because this fires per keystroke against the user's whole graph.
    let active = true;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/entities?q=${encodeURIComponent(typed)}&limit=6`);
        if (!res.ok) return;
        const data = await res.json();
        if (!active) return;
        setMatches(
          (Array.isArray(data.entities) ? data.entities : []).filter(
            (e: EntityRef) => e.id !== entity.id
          )
        );
      } catch {
        // A failed lookup only costs the merge shortcut; renaming still works.
      }
    }, 200);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [open, picked, typed, entity.id]);

  function close() {
    setOpen(false);
    setQuery(entity.name);
    setMatches([]);
    setPicked(null);
    setKeepThis(false);
    setError(null);
  }

  async function rename() {
    setBusy(true);
    setError(null);

    const result = await renameEntity(entity.id, typed);

    setBusy(false);
    if (!result.success) {
      setError(result.message);
      // The name was taken, so the rename was really a merge. Offering it here
      // saves retyping it into a picker that would have found the same node.
      if (result.mergeInto) setPicked(result.mergeInto);
      return;
    }

    close();
    router.refresh();
  }

  async function merge() {
    if (!picked) return;

    const survivor = keepThis ? entity : picked;
    const absorbed = keepThis ? picked : entity;

    setBusy(true);
    setError(null);

    const result = await mergeEntities(survivor.id, absorbed.id);

    setBusy(false);
    if (!result.success) {
      setError(result.message);
      return;
    }

    // This page's node may no longer exist, so follow the survivor rather than
    // refreshing into a 404.
    if (survivor.id === entity.id) {
      close();
      router.refresh();
    } else {
      router.push(`/entities/${survivor.id}`);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className="btn btn-ghost btn-xs shrink-0"
        onClick={() => setOpen(true)}
      >
        Rename or merge
      </button>
    );
  }

  const survivor = picked ? (keepThis ? entity : picked) : null;
  const absorbed = picked ? (keepThis ? picked : entity) : null;

  return (
    <div className="mt-3 w-full rounded-box border border-base-300 bg-base-200/40 p-3">
      {picked && survivor && absorbed ? (
        <>
          <p className="text-sm">
            Merge <span className="font-medium">{absorbed.name}</span> into{' '}
            <span className="font-medium">{survivor.name}</span>?
          </p>
          <p className="mt-1 text-xs leading-relaxed text-base-content/60">
            {absorbed.mentionCount} {absorbed.mentionCount === 1 ? 'note' : 'notes'} move to{' '}
            {survivor.name}, which keeps every note it already has. &ldquo;{absorbed.name}&rdquo;
            disappears and its spelling is remembered, so it will not split off again.
            {survivor.type !== absorbed.type && ` The type becomes ${survivor.type}.`}
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary btn-xs" disabled={busy} onClick={merge}>
              {busy ? 'Merging…' : 'Merge'}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              disabled={busy}
              onClick={() => setKeepThis((v) => !v)}
            >
              Keep &ldquo;{absorbed.name}&rdquo; instead
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              disabled={busy}
              onClick={() => setPicked(null)}
            >
              Back
            </button>
          </div>
        </>
      ) : (
        <>
          <label className="mb-1 block font-mono text-[10px] uppercase tracking-wide text-base-content/40">
            This is actually
          </label>
          <input
            autoFocus
            className="input input-sm input-bordered w-full"
            value={query}
            disabled={busy}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && typed && typed !== entity.name) rename();
              if (e.key === 'Escape') close();
            }}
            placeholder="A name, or an entity you already have"
          />

          {matches.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1">
              {matches.map((match) => (
                <li key={match.id}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 rounded-box border border-base-300 bg-base-100 px-3 py-2 text-left transition-colors hover:border-primary/40"
                    disabled={busy}
                    onClick={() => setPicked(match)}
                  >
                    <span className="min-w-0 truncate text-sm font-medium">{match.name}</span>
                    <span className="shrink-0 font-mono text-[11px] text-base-content/50">
                      {match.type} · {match.mentionCount}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn btn-primary btn-xs"
              disabled={busy || !typed || typed === entity.name}
              onClick={rename}
            >
              {busy ? 'Renaming…' : `Rename to "${typed || entity.name}"`}
            </button>
            <button type="button" className="btn btn-ghost btn-xs" disabled={busy} onClick={close}>
              Cancel
            </button>
            {matches.length > 0 && (
              <span className="text-xs text-base-content/50">
                …or pick one above to merge into it.
              </span>
            )}
          </div>
        </>
      )}

      {error && <div className="mt-2 text-sm text-warning">{error}</div>}
    </div>
  );
}
