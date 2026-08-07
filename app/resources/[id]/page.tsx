import Link from 'next/link';
import Image from 'next/image';
import { notFound, redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { auth } from '@/app/api/auth/auth';
import { db } from '@/lib/db';
import { entities, entityMentions, resources } from '@/lib/db/schema';
import { renderSimpleMarkdown } from '@/app/components/utils/markdown';
import { resourceTypeIcon } from '@/lib/utils/resource-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * A single note.
 *
 * Everything that mentions a note — the dashboard tiles, the chat's search
 * results — needs somewhere to send you. Without this page those mentions were
 * dead text: you could see that something was saved but never open it.
 */

type Metadata = {
  type?: string;
  tags?: string[];
  category?: string;
  personName?: string;
  /** Absent when the blob store was unconfigured at upload time. */
  imageUrl?: string;
};

export default async function ResourcePage({ params }: { params: { id: string } }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect('/api/auth/signin');

  // Scoped to the owner in the query itself: a note belonging to someone else
  // must be indistinguishable from one that does not exist.
  const [resource] = await db
    .select()
    .from(resources)
    .where(and(eq(resources.id, params.id), eq(resources.userId, userId)))
    .limit(1);

  if (!resource) notFound();

  const meta = (resource.metadata ?? {}) as Metadata;
  const title = resource.title || meta.personName || 'Untitled';
  const icon = resourceTypeIcon(meta.type ?? 'note');

  // Read from the graph rather than from `metadata.entities`. The metadata copy
  // is a snapshot of what extraction saw the day this note was written: it does
  // not know about a merge the user has since confirmed, or an alias that sent
  // a spelling to a different node, and it carries no id to link to. The
  // mentions table is the live answer to "what does this note connect to".
  const linked = await db
    .select({ id: entities.id, name: entities.name, type: entities.type, relationship: entities.relationship })
    .from(entityMentions)
    .innerJoin(entities, eq(entities.id, entityMentions.entityId))
    .where(eq(entityMentions.resourceId, resource.id));

  return (
    <div className="container mx-auto max-w-3xl p-4 md:p-6">
      <Link
        href="/resources"
        className="text-[13px] font-medium text-base-content/50 transition-colors hover:text-primary"
      >
        ← Knowledge base
      </Link>

      <article className="mt-4 rounded-box border border-base-300 bg-base-100 p-5 md:p-6">
        <header className="mb-5 border-b border-base-200 pb-4">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-base-200 text-lg">
              {icon}
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-semibold tracking-tight text-base-content">{title}</h1>
              <p className="mt-1 font-mono text-xs text-base-content/50">
                {meta.type ?? 'note'}
                {meta.category ? ` · ${meta.category}` : ''}
                {' · '}
                {new Date(resource.createdAt).toLocaleDateString([], {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
              </p>
            </div>
          </div>

          {meta.tags && meta.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {meta.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-base-200 px-2 py-0.5 font-mono text-[11px] text-base-content/60"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </header>

        {/* For an image the text below describes a picture, and this is the
            page someone lands on from a search result — so the picture comes
            first and the description reads as a caption for it. */}
        {meta.imageUrl && (
          <a href={meta.imageUrl} target="_blank" rel="noreferrer" className="mb-5 block w-fit">
            <Image
              src={meta.imageUrl}
              alt={title}
              width={768}
              height={576}
              className="max-h-[28rem] w-auto rounded-box border border-base-300 object-contain"
              unoptimized
            />
          </a>
        )}

        {/* The stored text is written as markdown — headings, lists, bold — so
            it is rendered as such rather than dumped as one preformatted block. */}
        <div className="text-sm leading-relaxed text-base-content">
          {renderSimpleMarkdown(resource.content)}
        </div>

        {/* What this note connects to — the one thing here that is not already
            said above it. The footer used to print the key points a second
            time under text that opens with them, and a "Facts" list that never
            rendered at all: it read `metadata.facts` as `{fact}`/`{text}` while
            extraction has always written `{subject, predicate, object}`, so
            every entry mapped to undefined and was filtered out. Both were
            restatements of the paragraph above; neither is worth repairing. */}
        {linked.length > 0 && (
          <footer className="mt-6 border-t border-base-200 pt-4">
            <h2 className="mb-2 font-mono text-[10px] uppercase tracking-wide text-base-content/40">
              Mentions
            </h2>
            <div className="flex flex-wrap gap-1.5">
              {linked.map((entity) => (
                <Link
                  key={entity.id}
                  href={`/entities/${entity.id}`}
                  className="rounded-full border border-base-300 px-2.5 py-1 text-[13px] text-base-content/80 transition-colors hover:border-primary hover:text-primary"
                >
                  {entity.name}
                  <span className="ml-1.5 font-mono text-[11px] text-base-content/40">
                    {entity.relationship || entity.type}
                  </span>
                </Link>
              ))}
            </div>
          </footer>
        )}
      </article>
    </div>
  );
}
