import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/app/api/auth/auth';
import { getEntityWithMentions } from '@/lib/actions/entities';
import { EntityDelete } from './EntityDelete';
import { EntityIdentity } from './EntityIdentity';
import { EntityRelationship } from './EntityRelationship';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Everything known about one person, project or place.
 *
 * The view the knowledge base did not have: notes were searchable but never
 * gathered, so "what do I know about Marta" meant remembering which notes to
 * open. Here the entity is the subject and the notes are its evidence.
 */

const TYPE_LABEL: Record<string, string> = {
  person: '🧑 Person',
  place: '📍 Place',
  organization: '🏢 Organization',
  project: '📁 Project',
  skill: '🛠️ Skill',
  activity: '🎯 Activity',
  preference: '💡 Preference',
  need: '⏰ Need',
  goal: '🎯 Goal',
  other: '📄 Other',
};

function preview(content: string, limit = 200): string {
  const flat = content.replace(/\s+/g, ' ').trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

export default async function EntityPage({ params }: { params: { id: string } }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect('/api/auth/signin');

  const result = await getEntityWithMentions(params.id, userId);
  if (!result) notFound();

  const { entity, mentions } = result;
  const attributes = (entity.attributes ?? null) as Record<string, unknown> | null;

  return (
    <div className="container mx-auto max-w-3xl p-4 md:p-6">
      <Link
        href="/entities"
        className="text-[13px] font-medium text-base-content/50 transition-colors hover:text-primary"
      >
        ← All entities
      </Link>

      <header className="mt-4 rounded-box border border-base-300 bg-base-100 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          {/* Takes the slack, so the controls sit together on the right and an
              open panel still gets a line of its own at full width. */}
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold tracking-tight text-base-content">{entity.name}</h1>
            <p className="mt-1 font-mono text-xs text-base-content/50">
              {TYPE_LABEL[entity.type] ?? entity.type}
              {entity.relationship ? ` · ${entity.relationship}` : ''}
              {' · '}
              {entity.mentionCount} {entity.mentionCount === 1 ? 'mention' : 'mentions'}
            </p>
          </div>

          {/* Four corrections, all of them decisions the graph has to record
              rather than edits to a column: the name and the relationship here
              are the model's and are rewritten on every note that mentions this
              node, and the row itself is rebuilt from those notes. */}
          <EntityIdentity
            entity={{
              id: entity.id,
              name: entity.name,
              type: entity.type,
              mentionCount: entity.mentionCount,
            }}
          />
          <EntityRelationship
            entity={{
              id: entity.id,
              relationship: entity.relationship,
              relationshipSource: entity.relationshipSource,
            }}
          />
          <EntityDelete
            entity={{ id: entity.id, name: entity.name, mentionCount: entity.mentionCount }}
          />
        </div>

        {attributes && Object.keys(attributes).length > 0 && (
          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t border-base-200 pt-3 text-sm">
            {Object.entries(attributes).map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="font-mono text-xs text-base-content/50">{key}</dt>
                <dd className="text-base-content">{String(value)}</dd>
              </div>
            ))}
          </dl>
        )}
      </header>

      <section className="mt-4">
        <h2 className="mb-2 font-mono text-[10px] uppercase tracking-wide text-base-content/40">
          Where this comes from
        </h2>

        {mentions.length === 0 ? (
          <p className="text-sm text-base-content/50">
            No notes mention this any more.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {mentions.map((m) => (
              <li key={m.resourceId}>
                <Link
                  href={`/resources/${m.resourceId}`}
                  className="block rounded-box border border-base-300 bg-base-100 p-4 transition-colors hover:border-primary/40"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-sm font-medium text-base-content">
                      {m.title || 'Untitled'}
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-base-content/50">
                      {new Date(m.createdAt).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}
                    </span>
                  </div>
                  {/* The sentence that produced the link, when we captured one —
                      otherwise the note's opening as a fallback. */}
                  <p className="mt-1 text-xs leading-relaxed text-base-content/60">
                    {m.context || preview(m.content)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
