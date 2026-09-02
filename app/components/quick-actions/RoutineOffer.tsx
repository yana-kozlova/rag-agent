'use client';

import { useState } from 'react';
import { Sparkles } from 'lucide-react';

import {
  MAX_ANSWER_LENGTH,
  MAX_LABEL_LENGTH,
  promptFor,
  type QuickField,
} from '@/lib/quick-actions/quick-actions';
import type { ColumnLike } from '@/lib/utils/table-columns';

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
 *
 * What it offers is a reading of the rows, and a reading can be wrong in ways
 * only the user can see: the notes column holding the same standing instruction
 * every day is part of the routine and no part of what they want a button
 * writing, and the name taken from those values is theirs to word. So the offer
 * is editable once, here, before it is accepted — after that it is an ordinary
 * quick action, and the way to change one is still to delete it and say what
 * was meant. Deciding costs one tap; correcting costs one more.
 */
export function RoutineOffer({
  tableId,
  label,
  values,
  occurrences,
  days,
  fields,
  columns,
  onCreated,
}: {
  tableId: string;
  label: string;
  values: string[];
  occurrences: number;
  days: number;
  fields: QuickField[];
  /** The table's own columns — what to call each value while it is edited. */
  columns: ColumnLike[];
  onCreated?: () => void;
}) {
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(label);
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      fields
        .filter((f) => f.kind === 'fixed')
        .map((f) => [f.columnId, f.value === null || f.value === undefined ? '' : String(f.value)])
    )
  );

  if (hidden) return null;

  const asks = fields.filter((f) => f.kind === 'ask');
  const named = (id: string) => columns.find((c) => c.id === id)?.name ?? id;

  // A value cleared to nothing drops its column from the template rather than
  // writing a blank into it on every press: an empty cell reads as "recorded,
  // and there was nothing", and no later view of the table can tell those apart.
  const edited: QuickField[] = fields
    .map((f) => (f.kind === 'fixed' ? { ...f, value: (draft[f.columnId] ?? '').trim() } : f))
    .filter((f) => f.kind !== 'fixed' || f.value !== '');

  const writes = edited.filter((f) => f.kind === 'fixed').map((f) => String(f.value));
  const changed = writes.join(' · ') !== values.join(' · ');
  // Nothing fixed left is not a quick action but the add-row form with a tap in
  // front of it, which is what `asksMoreThanItKnows` refuses on the server.
  const ready = name.trim().length > 0 && writes.length > 0;

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/quick-actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableId, label: name.trim(), fields: edited }),
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
          {/* What was noticed stays worded as it was noticed — it is the
              evidence for the offer. What the button would write becomes a
              line of its own the moment the two stop being the same thing. */}
          {changed && !editing && (
            <p className="mt-1 text-sm text-base-content/70">
              Will write <span className="font-mono">{writes.join(' · ')}</span>.
            </p>
          )}
          {error && <p className="mt-1 text-sm text-error">{error}</p>}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button className="btn btn-ghost btn-sm" onClick={() => setHidden(true)} disabled={busy}>
            Not now
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setEditing((open) => !open)}
            disabled={busy}
            aria-expanded={editing}
          >
            {editing ? 'Done' : 'Edit'}
          </button>
          <button className="btn btn-primary btn-sm" onClick={create} disabled={busy || !ready}>
            {busy ? 'Creating' : 'Create'}
            {!editing && (
              <span className="max-w-[10rem] truncate font-normal opacity-80">
                {name.trim() || label}
              </span>
            )}
          </button>
        </div>
      </div>

      {editing && (
        <form
          className="mt-3 flex flex-wrap items-end gap-3 border-t border-primary/20 pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (ready) create();
          }}
        >
          <label className="flex flex-col gap-1">
            <span className="text-xs text-base-content/60">Button name</span>
            <input
              autoFocus
              className={`input input-bordered input-sm w-56 ${name.trim() ? '' : 'input-error'}`}
              maxLength={MAX_LABEL_LENGTH}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>

          {fields.map((field) => {
            const column = columns.find((c) => c.id === field.columnId);

            // The date stamp and the questions are shown but not editable: what
            // they hold is decided at press time, and the row on screen has to
            // be the row that will be written, blanks included.
            if (field.kind !== 'fixed') {
              return (
                <label key={field.columnId} className="flex flex-col gap-1">
                  <span className="text-xs text-base-content/60">{named(field.columnId)}</span>
                  <input
                    readOnly
                    tabIndex={-1}
                    className="input input-bordered input-sm w-44 bg-base-200/60 text-base-content/50"
                    value={
                      field.kind === 'today'
                        ? "today's date"
                        : field.kind === 'now'
                          ? "today's date and time"
                          : `asked: ${promptFor(field, columns)}`
                    }
                  />
                </label>
              );
            }

            return (
              <label key={field.columnId} className="flex flex-col gap-1">
                <span className="text-xs text-base-content/60">{named(field.columnId)}</span>
                <input
                  className="input input-bordered input-sm w-44"
                  type={
                    column?.type === 'number' ? 'number' : column?.type === 'date' ? 'date' : 'text'
                  }
                  inputMode={column?.type === 'number' ? 'decimal' : undefined}
                  step={column?.type === 'number' ? 'any' : undefined}
                  maxLength={MAX_ANSWER_LENGTH}
                  placeholder="empty to leave out"
                  value={draft[field.columnId] ?? ''}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, [field.columnId]: e.target.value }))
                  }
                />
              </label>
            );
          })}

          <p className="basis-full text-xs text-base-content/50">
            A column left empty is left out of the row the button writes.
          </p>
        </form>
      )}
    </div>
  );
}
