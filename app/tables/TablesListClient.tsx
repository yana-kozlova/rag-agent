'use client';

import { useEffect, useState } from 'react';
import { deleteUserTable } from '@/lib/actions/user-tables';
import Link from 'next/link';
import { Trash2 } from 'lucide-react';
import { relativeTime } from '@/lib/utils/relative-time';

export type UserTable = {
  id: string;
  title: string;
  description?: string | null;
  columns: any[];
  settings?: any;
  createdAt: string | Date;
  updatedAt: string | Date;
  /** Rows in it, counted. */
  rowCount: number;
  /** When the newest row was written, or null for a table nothing has filled. */
  lastEntryAt: string | null;
};

/** Column names to print before the rest become a count. */
const NAMES_SHOWN = 4;

/**
 * What a card has to answer, and what the old one answered instead.
 *
 * Three facts were on it. "4 columns" is a number nobody has ever wanted: it
 * says how wide the table is, never what it holds. "View rows" was a `<span>`
 * styled like a link and wired to nothing. And "Updated: August 27, 2026 at
 * 10:06 AM" was `userTables.updatedAt` — the last time the *definition*
 * changed — so a table filled every morning since August went on advertising
 * the day its columns were last touched, which is the one date that cannot say
 * whether it is still in use.
 *
 * So: how many rows, when the last one was written, and the column names, which
 * are what "4 columns" was standing in for — «дата · ліки · доза» identifies a
 * table at a glance in a way its count never could. A table with no rows says
 * so rather than showing a blank, because empty is the state where the number
 * matters most: it is either brand new or something that was never used.
 */
export default function TablesListClient({ initialTables }: { initialTables: UserTable[] }) {
  const [tables, setTables] = useState<UserTable[]>(initialTables);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const handleDelete = async (table: UserTable) => {
    // The count is in the question because it is the part that cannot be
    // undone: "delete this table?" reads the same over an empty one and over
    // two years of a dog's medication.
    const rows = table.rowCount === 1 ? '1 row' : `${table.rowCount} rows`;
    if (!confirm(`Delete "${table.title}" and its ${rows}? This cannot be undone.`)) return;

    setDeleting(table.id);
    const result = await deleteUserTable(table.id);
    setDeleting(null);

    if (result.success) {
      setTables((prev) => prev.filter((t) => t.id !== table.id));
      setToast({ message: `"${table.title}" deleted`, type: 'success' });
    } else {
      setToast({ message: result.message || 'Failed to delete table', type: 'error' });
    }
  };

  return (
    <div className="container mx-auto space-y-5 p-4 md:p-6">
      {toast && (
        <div
          className={`alert ${toast.type === 'success' ? 'alert-success' : 'alert-error'} fixed right-4 top-4 z-50 max-w-md shadow-lg`}
        >
          <span>{toast.message}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setToast(null)}>
            ×
          </button>
        </div>
      )}

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">My Tables</h1>
        <Link href="/tables/new" className="btn btn-primary btn-sm">
          Create New Table
        </Link>
      </div>

      {tables.length === 0 ? (
        <div className="py-8 text-center text-base-content/70">
          <p className="mb-4">No tables yet. Create your first table to get started!</p>
          <Link href="/tables/new" className="btn btn-primary">
            Create New Table
          </Link>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {tables.map((table) => {
            const names = table.columns.map((c: any) => c?.name).filter(Boolean) as string[];
            const shown = names.slice(0, NAMES_SHOWN);
            const rest = names.length - shown.length;

            return (
              <div
                key={table.id}
                className="group relative flex flex-col rounded-lg border border-base-300 bg-base-100 p-4 transition-colors hover:border-primary/40"
              >
                <div className="flex items-start justify-between gap-2">
                  {/* The whole card opens the table: `after:inset-0` stretches
                      this link over it, which is what lets the delete button
                      sit inside the same card without being nested in an <a>. */}
                  <Link
                    href={`/tables/${table.id}`}
                    className="text-[15px] font-semibold leading-snug after:absolute after:inset-0 after:content-[''] hover:text-primary"
                  >
                    {table.title}
                  </Link>
                  <button
                    className="btn btn-ghost btn-xs relative z-10 text-base-content/30 opacity-0 transition hover:text-error focus-visible:opacity-100 group-hover:opacity-100"
                    onClick={() => handleDelete(table)}
                    disabled={deleting === table.id}
                    aria-label={`Delete ${table.title}`}
                    title="Delete table"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>

                {table.description && (
                  <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-base-content/60">
                    {table.description}
                  </p>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-base-content/70">
                  <span className="font-medium text-base-content/80">
                    {table.rowCount === 0
                      ? 'No rows yet'
                      : `${table.rowCount} ${table.rowCount === 1 ? 'row' : 'rows'}`}
                  </span>
                  {table.lastEntryAt && (
                    <>
                      <span aria-hidden className="text-base-content/30">
                        ·
                      </span>
                      {/* Rendered once on the server and again on the client,
                          which straddle a minute boundary often enough to warn
                          about it. The text is the same fact either way. */}
                      <span suppressHydrationWarning>last {relativeTime(table.lastEntryAt)}</span>
                    </>
                  )}
                </div>

                {shown.length > 0 && (
                  <p className="mt-1 truncate text-[12px] text-base-content/45">
                    {shown.join(' · ')}
                    {rest > 0 && ` +${rest}`}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
