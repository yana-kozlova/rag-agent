'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getUserInitials } from '@/lib/utils';

/**
 * People and tables, as ways in rather than as content.
 *
 * Both used to be full cards in the main grid, weighted the same as the day's
 * schedule, while all either did was link to its own page. Here they are one
 * compact block at the bottom: a row of names and a row of tables, each a link.
 */

type Person = { id: string; name: string; relationship: string | null };
type Table = { id: string; title: string };

const LIMIT = 8;

function Chip({ href, title, children }: { href: string; title?: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      title={title}
      className="flex max-w-[12rem] items-center gap-1.5 rounded-full border border-base-300 bg-base-200/40 py-1 pl-1 pr-3 text-sm text-base-content transition-colors hover:border-primary"
    >
      {children}
    </Link>
  );
}

function Heading({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <h3 className="font-mono text-[10px] uppercase tracking-wide text-base-content/40">{children}</h3>
      <Link
        href={href}
        className="text-[12px] font-medium text-base-content/50 transition-colors hover:text-primary"
      >
        All →
      </Link>
    </div>
  );
}

export default function Browse() {
  const [people, setPeople] = useState<Person[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const load = async () => {
      const [p, t] = await Promise.allSettled([
        fetch(`/api/entities?type=person&limit=${LIMIT}`).then((r) => (r.ok ? r.json() : null)),
        fetch(`/api/user-tables?limit=${LIMIT}`).then((r) => r.json()),
      ]);
      if (!active) return;
      if (p.status === 'fulfilled' && Array.isArray(p.value?.entities)) setPeople(p.value.entities);
      if (t.status === 'fulfilled' && t.value?.ok && Array.isArray(t.value.tables)) setTables(t.value.tables);
      setLoading(false);
    };

    load();
    window.addEventListener('dashboard:resources-changed', load);
    return () => {
      active = false;
      window.removeEventListener('dashboard:resources-changed', load);
    };
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        {[0, 1].map((i) => (
          <div key={i} className="flex gap-2">
            {[0, 1, 2].map((j) => (
              <div key={j} className="h-8 w-24 animate-pulse rounded-full bg-base-200" />
            ))}
          </div>
        ))}
      </div>
    );
  }

  return (
    <section className="w-full space-y-4">
      <div>
        <Heading href="/entities">People</Heading>
        {people.length === 0 ? (
          <p className="text-sm text-base-content/50">Tell the assistant about someone to remember them.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {people.map((person) => (
              <Chip key={person.id} href={`/entities/${person.id}`} title={person.relationship ?? undefined}>
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary/15 text-[11px] font-semibold text-secondary">
                  {getUserInitials(person.name)}
                </span>
                <span className="truncate">{person.name}</span>
              </Chip>
            ))}
          </div>
        )}
      </div>

      <div>
        <Heading href="/tables">Tables</Heading>
        {tables.length === 0 ? (
          <p className="text-sm text-base-content/50">
            No tables yet — <Link href="/tables/new" className="text-primary hover:underline">create one</Link>.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {tables.map((table) => (
              <Chip key={table.id} href={`/tables/${table.id}`}>
                <span className="flex h-6 w-6 shrink-0 items-center justify-center text-sm">📊</span>
                <span className="truncate">{table.title}</span>
              </Chip>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
