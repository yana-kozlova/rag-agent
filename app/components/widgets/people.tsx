'use client';

import Link from 'next/link';
import type { Resource } from '@/app/resources/ResourcesClient';
import { getUserInitials } from '@/lib/utils';
import { useResourceList } from './use-resource-list';

function displayName(r: Resource): string {
  const meta = r.metadata as any;
  if (meta?.personName) return meta.personName;
  if (r.title) return r.title;
  const firstLine = (r.content || '').split('\n')[0].trim();
  return firstLine || 'Unnamed';
}

function summary(r: Resource): string {
  const meta = r.metadata as any;
  const facts = meta?.facts;
  if (Array.isArray(facts) && facts.length) {
    const parts = facts.map((f: any) => f?.object).filter(Boolean);
    if (parts.length) return parts.join(' · ');
  }
  const keyPoints = meta?.keyPoints;
  if (Array.isArray(keyPoints) && keyPoints.length) return keyPoints.join(' · ');
  return (r.content || '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

export default function People() {
  const { items, loading } = useResourceList('type=person&limit=6');

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
          href="/resources"
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
          {items.map((r) => {
            const name = displayName(r);
            return (
              <li
                key={r.id}
                className="-mx-2 flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-base-200/60"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary/15 text-[13px] font-semibold text-secondary">
                  {getUserInitials(name)}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-base-content">{name}</div>
                  <div className="truncate text-xs text-base-content/50">{summary(r)}</div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
