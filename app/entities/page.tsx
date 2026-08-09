import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/app/api/auth/auth';
import { listEntities, listHiddenEntities } from '@/lib/actions/entities';
import { findMergeCandidates } from '@/lib/entities/merge-candidates';
import { HiddenEntities } from './HiddenEntities';
import { MergeSuggestions } from './MergeSuggestions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Everything the knowledge base knows *about*, as opposed to what it stores. */

const TYPE_ICON: Record<string, string> = {
  person: '🧑',
  place: '📍',
  organization: '🏢',
  project: '📁',
  skill: '🛠️',
  activity: '🎯',
  preference: '💡',
  need: '⏰',
  goal: '🎯',
  other: '📄',
};

const TYPE_ORDER = ['person', 'project', 'organization', 'place', 'skill', 'activity', 'goal', 'need', 'preference', 'other'];

export default async function EntitiesPage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect('/api/auth/signin');

  const [all, mergeCandidates, hidden] = await Promise.all([
    listEntities(userId, { limit: 100 }),
    findMergeCandidates(userId),
    listHiddenEntities(userId),
  ]);

  const grouped = new Map<string, typeof all>();
  for (const entity of all) {
    const list = grouped.get(entity.type) ?? [];
    list.push(entity);
    grouped.set(entity.type, list);
  }

  const groups = [...grouped.entries()].sort(
    (a, b) => (TYPE_ORDER.indexOf(a[0]) + 100) % 100 - (TYPE_ORDER.indexOf(b[0]) + 100) % 100
  );

  return (
    <div className="container mx-auto max-w-4xl p-4 md:p-6">
      <header className="mb-6 flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Entities</h1>
          <p className="mt-1 text-sm text-base-content/60">
            People, projects and places your notes talk about.
          </p>
        </div>
        <Link
          href="/resources"
          className="text-[13px] font-medium text-base-content/50 transition-colors hover:text-primary"
        >
          Knowledge base →
        </Link>
      </header>

      {mergeCandidates.length > 0 && <MergeSuggestions candidates={mergeCandidates} />}

      <HiddenEntities hidden={hidden} />

      {all.length === 0 ? (
        <div className="rounded-box border border-base-300 bg-base-100 p-6 text-center">
          <p className="text-sm text-base-content/60">
            Nothing here yet. Entities appear on their own as you save notes that
            mention people, projects or places.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map(([type, items]) => (
            <section key={type}>
              <h2 className="mb-2 font-mono text-[10px] uppercase tracking-wide text-base-content/40">
                {TYPE_ICON[type] ?? '📄'} {type} · {items.length}
              </h2>
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {items.map((entity) => (
                  <li key={entity.id}>
                    <Link
                      href={`/entities/${entity.id}`}
                      className="flex items-center justify-between gap-3 rounded-box border border-base-300 bg-base-100 px-4 py-3 transition-colors hover:border-primary/40"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-base-content">
                          {entity.name}
                        </div>
                        {entity.relationship && (
                          <div className="truncate text-xs text-base-content/50">
                            {entity.relationship}
                          </div>
                        )}
                      </div>
                      <span className="shrink-0 rounded-full bg-base-200 px-2 py-0.5 font-mono text-[11px] text-base-content/60">
                        {entity.mentionCount}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
