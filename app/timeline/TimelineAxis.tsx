'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';

import type { DatePrecision } from '@/lib/timeline/timeline';
import DateForm, { draftFrom, type DateSubmission } from './DateForm';

export type AxisItem = {
  id: string;
  /** Already formatted — only the server knows how much of the date is real. */
  date: string;
  sortKey: string;
  /** The raw halves, so the edit form can be seeded without re-deriving either. */
  occurredOn: string;
  precision: DatePrecision;
  title: string;
  subject: string | null;
  note: string | null;
  kind: string;
  icon: string;
  recurring: boolean;
  source: string;
  /** When the user last corrected this row, already formatted. Null until they have. */
  edited: string | null;
  entityId: string | null;
  resource: { id: string; title: string | null } | null;
};

export type AxisGroup = {
  year: string;
  items: AxisItem[];
};

/**
 * The axis itself: years descending, dates within them descending.
 *
 * Newest first rather than as a story from birth. A second brain is opened to
 * check something, and the thing being checked is almost always recent; the
 * childhood end of the axis is where you scroll deliberately, not where you land.
 *
 * Each row carries where it came from, because most of them were written by a
 * model reading a note rather than by the user. A date nobody remembers stating
 * and cannot trace is one nobody can decide whether to trust.
 *
 * And each row can be corrected in place, which is the other half of that. Most
 * of these were read out of prose, so they are wrong in the ordinary way models
 * are wrong — the right day off by one, the subject's name left in the title —
 * and until there was an edit the only repair was to delete the row and retype
 * it, which throws away the link back to the note that is the evidence for it.
 * A corrected row is chipped rather than silently changed: the source line says
 * where the date came from and no longer says whose reading it is.
 */
export default function TimelineAxis({ groups }: { groups: AxisGroup[] }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(id: string) {
    setDeleting(id);
    setError(null);
    try {
      const res = await fetch(`/api/timeline?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setDeleting(null);
    }
  }

  async function save(id: string, payload: DateSubmission) {
    const res = await fetch(`/api/timeline?id=${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `Save failed (${res.status})`);

    setEditing(null);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      {error && <p className="text-sm text-error">{error}</p>}

      {groups.map((group) => (
        <section key={group.year}>
          <h2 className="mb-2 font-mono text-xs font-semibold uppercase tracking-wide text-base-content/40">
            {group.year}
          </h2>

          <ul className="flex flex-col gap-2 border-l border-base-300 pl-4">
            {group.items.map((item) => (
              <li
                key={item.id}
                className="group relative flex items-start gap-3 rounded-box border border-base-300 bg-base-100 px-4 py-3"
              >
                {/* The tick on the line, aligned with the row's first line of text. */}
                <span
                  aria-hidden
                  className="absolute -left-[1.3125rem] top-5 h-1.5 w-1.5 rounded-full bg-base-300"
                />

                {editing === item.id ? (
                  <div className="min-w-0 flex-1">
                    <DateForm
                      initial={draftFrom(item)}
                      submitLabel="Save changes"
                      onSubmit={(payload) => save(item.id, payload)}
                      onCancel={() => setEditing(null)}
                    />
                  </div>
                ) : (
                  <>
                    <span className="mt-0.5 shrink-0 text-lg leading-none" aria-hidden>
                      {item.icon}
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <span className="font-mono text-xs text-base-content/50">{item.date}</span>
                        <span className="text-sm font-medium">{item.title}</span>
                        {item.recurring && (
                          <span className="badge badge-ghost badge-xs">every year</span>
                        )}
                      </div>

                      {item.subject && (
                        <div className="mt-1 text-xs text-base-content/60">
                          {item.entityId ? (
                            <Link href={`/entities/${item.entityId}`} className="link link-hover">
                              {item.subject}
                            </Link>
                          ) : (
                            item.subject
                          )}
                        </div>
                      )}

                      {item.note && (
                        <p className="mt-1 whitespace-pre-wrap text-sm text-base-content/60">
                          {item.note}
                        </p>
                      )}

                      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-base-content/40">
                        {item.resource ? (
                          <Link
                            href={`/resources/${item.resource.id}`}
                            className="link link-hover font-mono"
                          >
                            {item.resource.title || 'source note'}
                          </Link>
                        ) : (
                          <span className="font-mono">{item.source}</span>
                        )}

                        {/* Beside the provenance rather than beside the title,
                            because that is what it qualifies: the date still
                            came from that note, it is just no longer the note's
                            reading of it. */}
                        {item.edited && (
                          <span className="badge badge-ghost badge-xs" title={`Edited ${item.edited}`}>
                            edited
                          </span>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setEditing(item.id);
                        setError(null);
                      }}
                      aria-label={`Edit ${item.title}`}
                      className="shrink-0 rounded-md p-1.5 text-base-content/30 transition-colors hover:bg-base-200 hover:text-base-content"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>

                    <button
                      type="button"
                      onClick={() => remove(item.id)}
                      disabled={deleting === item.id}
                      aria-label={`Delete ${item.title}`}
                      className="shrink-0 rounded-md p-1.5 text-base-content/30 transition-colors hover:bg-base-200 hover:text-error disabled:opacity-40"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
