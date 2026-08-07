'use client';

import { useEffect, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';

import { MAX_DIRECTIVES, MAX_DIRECTIVE_LENGTH, type Directive } from '@/lib/directives/directives';
import { SettingsSection } from './ui';

/**
 * The list of standing instructions, and the only place they can be read whole.
 *
 * Every one of these is in front of the model on every request, on both
 * surfaces, whether or not the user remembers setting it — so the point of this
 * panel is less editing than visibility. Inferred rules are badged for that
 * reason: those are the assistant's reading of a habit, and the difference
 * between "I asked for this" and "it decided this" is exactly what someone
 * puzzled by an answer needs to see.
 *
 * Imports the caps from `lib/directives/directives.ts` rather than the schema —
 * that module is dependency-free precisely so this client component does not
 * pull drizzle into the browser bundle.
 */
export function ResponsePreferences() {
  const [directives, setDirectives] = useState<Directive[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Which row is open for editing, and the draft in it. */
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);

  const load = async () => {
    try {
      const res = await fetch('/api/directives');
      const json = await res.json();
      if (json.ok) {
        setDirectives(json.directives);
        setError(null);
      } else {
        setError(json.error ?? 'Could not load preferences');
      }
    } catch {
      setError('Could not load preferences');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const add = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;

    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/directives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: trimmed }),
      });
      const json = await res.json();
      if (json.ok) {
        setDirectives((prev) => [...prev, json.directive]);
        setText('');
      } else {
        setError(json.error ?? 'Could not save');
      }
    } catch {
      setError('Could not save');
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    const trimmed = editing.text.trim();
    if (!trimmed) return;

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/directives/${editing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: trimmed }),
      });
      const json = await res.json();
      if (json.ok) {
        // Replaced in place rather than refetched: the row keeps its position,
        // which is the whole reason editing exists instead of delete-and-add.
        setDirectives((prev) => prev.map((d) => (d.id === json.directive.id ? json.directive : d)));
        setEditing(null);
      } else {
        setError(json.error ?? 'Could not save');
      }
    } catch {
      setError('Could not save');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    // Optimistic, with a reload on failure: the list is short and the cost of
    // being briefly wrong is a row reappearing, not a lost instruction.
    const previous = directives;
    setDirectives((prev) => prev.filter((d) => d.id !== id));
    if (editing?.id === id) setEditing(null);
    try {
      const res = await fetch(`/api/directives/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
    } catch {
      setDirectives(previous);
      setError('Could not remove');
    }
  };

  const full = directives.length >= MAX_DIRECTIVES;

  return (
    <SettingsSection
      id="responses"
      title="How the assistant answers you"
      description={
        <>
          Standing instructions added to every reply, in the chat and in Telegram. Say
          “запам&apos;ятай: відповідай коротше” in the chat and it lands here too.
        </>
      }
      aside={
        <span className="font-mono text-xs text-base-content/50">
          {directives.length} / {MAX_DIRECTIVES}
        </span>
      }
    >
      <div className="flex flex-col gap-3">
        {error && <div className="alert alert-warning text-sm">{error}</div>}

        {loading ? (
          <div className="text-sm text-base-content/50">Loading…</div>
        ) : directives.length === 0 ? (
          <div className="text-sm text-base-content/50">
            Nothing saved yet — the assistant answers with its defaults.
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {directives.map((d) => (
              <li
                key={d.id}
                className="flex items-start justify-between gap-3 rounded-md border border-base-300 bg-base-200/40 px-3 py-2"
              >
                {editing?.id === d.id ? (
                  <>
                    <input
                      className="input input-bordered input-sm flex-1"
                      value={editing.text}
                      maxLength={MAX_DIRECTIVE_LENGTH}
                      autoFocus
                      disabled={saving}
                      onChange={(e) => setEditing({ id: d.id, text: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveEdit();
                        if (e.key === 'Escape') setEditing(null);
                      }}
                    />
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        onClick={() => setEditing(null)}
                        disabled={saving}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary btn-xs"
                        onClick={saveEdit}
                        disabled={saving || !editing.text.trim()}
                      >
                        Save
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex flex-col gap-1">
                      <span className="text-sm">{d.text}</span>
                      {d.source === 'inferred' && (
                        <span className="badge badge-ghost badge-sm w-fit">
                          picked up from how you replied
                        </span>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        aria-label={`Edit: ${d.text}`}
                        onClick={() => {
                          setError(null);
                          setEditing({ id: d.id, text: d.text });
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        aria-label={`Remove: ${d.text}`}
                        onClick={() => remove(d.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            className="input input-bordered input-sm flex-1"
            placeholder="Answer in Ukrainian unless I write in English"
            maxLength={MAX_DIRECTIVE_LENGTH}
            value={text}
            disabled={full || saving}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') add();
            }}
          />
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={add}
            disabled={full || saving || !text.trim()}
          >
            {saving ? 'Saving…' : 'Add'}
          </button>
        </div>
        {full && (
          <p className="text-xs text-base-content/50">
            That&apos;s the limit — remove one to add another. More rules than this and the
            assistant starts dropping them.
          </p>
        )}
      </div>
    </SettingsSection>
  );
}
