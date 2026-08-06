'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

type TableRow = { id: string; title: string; description?: string | null };

export default function TablesWidget() {
  const [tables, setTables] = useState<TableRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/user-tables?limit=6');
        const data = await res.json();
        if (!cancelled && data?.ok && Array.isArray(data.tables)) setTables(data.tables);
      } catch {
        /* leave empty on failure */
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const onChange = () => load();
    window.addEventListener('dashboard:resources-changed', onChange);
    return () => {
      cancelled = true;
      window.removeEventListener('dashboard:resources-changed', onChange);
    };
  }, []);

  return (
    <section className="w-full">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-base-content">Tables</h2>
        <Link
          href="/tables"
          className="text-[13px] font-medium text-base-content/50 transition-colors hover:text-primary"
        >
          All →
        </Link>
      </div>

      {loading && tables.length === 0 ? (
        <div className="grid grid-cols-2 gap-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-base-200" />
          ))}
        </div>
      ) : tables.length === 0 ? (
        <p className="text-sm text-base-content/50">
          No tables yet — <Link href="/tables/new" className="text-primary hover:underline">create one</Link>.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {tables.map((t) => (
            <Link
              key={t.id}
              href={`/tables/${t.id}`}
              className="flex items-center gap-2 rounded-lg border border-base-300 bg-base-200/40 px-3 py-2.5 text-sm font-medium text-base-content transition-colors hover:border-primary"
            >
              <span className="text-base">📊</span>
              <span className="truncate">{t.title}</span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
