'use client';

import Link from 'next/link';
import type { Resource } from '@/app/resources/ResourcesClient';
import { useResourceList } from './use-resource-list';

const TYPE_ICON: Record<string, string> = {
  note: '📝',
  person: '🧑',
  preference: '💡',
  need: '⏰',
  project: '📁',
  skill: '🛠️',
  event: '📅',
  schedule: '🗓️',
  learning: '🎓',
  document: '🔗',
  other: '📄',
};

function iconFor(r: Resource): string {
  const type = (r.metadata as any)?.type as string | undefined;
  return (type && TYPE_ICON[type]) || '📄';
}

function label(r: Resource): string {
  const meta = r.metadata as any;
  if (r.title) return r.title;
  if (meta?.personName) return meta.personName;
  const firstLine = (r.content || '').split('\n')[0].trim();
  return firstLine || 'Untitled';
}

function relativeTime(value: string | Date): string {
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Math.max(0, Date.now() - then);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(value).toLocaleDateString([], { day: 'numeric', month: 'short' });
}

export default function RecentlySaved() {
  const { items, loading } = useResourceList('limit=6');

  return (
    <section className="w-full">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-base-content">Recently saved</h2>
        <Link
          href="/resources"
          className="text-[13px] font-medium text-base-content/50 transition-colors hover:text-primary"
        >
          Knowledge base →
        </Link>
      </div>

      {loading && items.length === 0 ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-9 animate-pulse rounded-md bg-base-200" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-base-content/50">Nothing saved yet.</p>
      ) : (
        <ul className="flex flex-col">
          {items.map((r) => (
            <li key={r.id}>
              <Link
                href={`/resources/${r.id}`}
                className="-mx-2 flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-base-200/60"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-base-200 text-base">
                  {iconFor(r)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-base-content">{label(r)}</div>
                  <div className="truncate font-mono text-xs text-base-content/50">
                    {(r.metadata as any)?.type ?? 'note'} · {relativeTime(r.createdAt)}
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
