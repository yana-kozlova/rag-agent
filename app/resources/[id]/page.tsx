import Link from 'next/link';
import Image from 'next/image';
import { notFound, redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { auth } from '@/app/api/auth/auth';
import { db } from '@/lib/db';
import { resources } from '@/lib/db/schema';
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
  keyPoints?: string[];
  facts?: Array<{ fact?: string; text?: string }>;
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
  const facts = (meta.facts ?? []).map((f) => f.fact ?? f.text).filter(Boolean) as string[];

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

        {(facts.length > 0 || (meta.keyPoints && meta.keyPoints.length > 0)) && (
          <footer className="mt-6 border-t border-base-200 pt-4">
            {meta.keyPoints && meta.keyPoints.length > 0 && (
              <section className="mb-4">
                <h2 className="mb-2 font-mono text-[10px] uppercase tracking-wide text-base-content/40">
                  Key points
                </h2>
                <ul className="ml-5 list-disc space-y-1 text-sm text-base-content/80">
                  {meta.keyPoints.map((point, i) => (
                    <li key={i}>{point}</li>
                  ))}
                </ul>
              </section>
            )}

            {facts.length > 0 && (
              <section>
                <h2 className="mb-2 font-mono text-[10px] uppercase tracking-wide text-base-content/40">
                  Facts
                </h2>
                <ul className="ml-5 list-disc space-y-1 text-sm text-base-content/80">
                  {facts.map((fact, i) => (
                    <li key={i}>{fact}</li>
                  ))}
                </ul>
              </section>
            )}
          </footer>
        )}
      </article>
    </div>
  );
}
