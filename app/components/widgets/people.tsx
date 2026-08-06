'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getUserInitials } from '@/lib/utils';

/**
 * People, read from the entity graph rather than from notes typed 'person'.
 *
 * A note about someone is evidence; the person is the thing. Reading the graph
 * means three notes mentioning Marta show one Marta with three mentions, which
 * is what this tile was always trying to say.
 */

type Entity = {
  id: string;
  name: string;
  relationship: string | null;
  mentionCount: number;
};

export default function People() {
  const [items, setItems] = useState<Entity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const load = () => {
      fetch('/api/entities?type=person&limit=6')
        .then((res) => (res.ok ? res.json() : { entities: [] }))
        .then((data) => {
          if (active) setItems(Array.isArray(data.entities) ? data.entities : []);
        })
        .catch(() => {})
        .finally(() => {
          if (active) setLoading(false);
        });
    };

    load();
    // Saving in the chat rail can mint new people; the rail announces it.
    window.addEventListener('dashboard:resources-changed', load);
    return () => {
      active = false;
      window.removeEventListener('dashboard:resources-changed', load);
    };
  }, []);

  return (
    <section className="w-full">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-[15px] font-semibold text-base-content">People</h2>
          {items.length > 0 && (
            <span className="rounded-full bg-base-200 px-1.5 py-0.5 font-mono text-[11px] text-base-content/60">
              {items.length}
            </span>
          )}
        </div>
        <Link
          href="/entities"
          className="text-[13px] font-medium text-base-content/50 transition-colors hover:text-primary"
        >
          All →
        </Link>
      </div>

      {loading && items.length === 0 ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-9 animate-pulse rounded-md bg-base-200" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-base-content/50">
          No people yet — tell the assistant about someone to remember them.
        </p>
      ) : (
        <ul className="flex flex-col">
          {items.map((entity) => (
            <li key={entity.id}>
              <Link
                href={`/entities/${entity.id}`}
                className="-mx-2 flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-base-200/60"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary/15 text-[13px] font-semibold text-secondary">
                  {getUserInitials(entity.name)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-base-content">{entity.name}</div>
                  <div className="truncate text-xs text-base-content/50">
                    {entity.relationship ?? `${entity.mentionCount} ${entity.mentionCount === 1 ? 'note' : 'notes'}`}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
