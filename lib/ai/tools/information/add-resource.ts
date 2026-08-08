import { z } from 'zod';
import { createResource, updateResource } from '@/lib/actions/resources';
import { toGraphCandidates } from '@/lib/actions/entities';
import { dossierTitle, findDossier } from '@/lib/actions/note-routing';
import { mergeNoteContent } from '@/lib/ai/note-merge';
import { getSessionOrNull } from '@/lib/utils/auth';
import type { ExtractableResourceType } from '@/lib/utils/resource-types';
import { looksLikeCalendarCommandOrScheduleOperation } from '@/lib/privacy/schedule-privacy';
import { extractStructuredInformation, formatStructuredContent } from '@/lib/ai/information-extraction';
import { todayFor } from '@/lib/actions/user-timezone';

export const addResourceTool = {
  description: `Save info to the knowledge base. Use proactively when user shares personal facts.`,
  inputSchema: z.object({
    content: z.string().describe('The content or resource to add to the knowledge base'),
    title: z.string().optional().describe('Optional title for the resource. If not provided, will try to extract from first line of content.'),
  }),
  execute: async ({ content, title }: { content: string; title?: string }) => {
    const session = await getSessionOrNull();
    if (!session?.user?.id) {
      throw new Error('Unauthorized');
    }

    // Privacy: do not store operational calendar/schedule commands in long-term memory.
    // These should be handled via calendar tools, not via RAG storage.
    if (looksLikeCalendarCommandOrScheduleOperation(content) || (title && looksLikeCalendarCommandOrScheduleOperation(title))) {
      return {
        success: false,
        message: 'Skipped saving: looks like a calendar operation / schedule command (privacy rule).',
      };
    }
    
    // Extract structured information using AI analysis
    const isLargeText = content.length > 5000;
    let structuredContent = content;
    let extractedTitle = title;
    let contentType: ExtractableResourceType = 'note';
    let metadata: any = {};
    
    // For smaller texts, use structured extraction
    if (!isLargeText && content.length <= 2000) {
      try {
        const userName = session?.user?.name || null;
        // The user's own today, not the server's: "вчора" typed at 01:00 in Kyiv
        // resolves to the wrong day otherwise, and a date filed a day early is
        // never noticed and never corrected.
        const extracted = await extractStructuredInformation(
          content,
          userName,
          'addResource',
          await todayFor(session.user.id)
        );

        if (extracted) {
          // Use structured content for storage - only save extracted information, not original message
          structuredContent = formatStructuredContent(extracted, content, false); // false = don't include original
          extractedTitle = extracted.structuredContent.title;
          contentType = extracted.contentType;
          
          // Build rich metadata from extracted information
          metadata = {
            type: contentType,
            tags: extracted.structuredContent.tags,
            facts: extracted.facts,
            entities: extracted.entities.map(e => ({
              name: e.name,
              type: e.type,
              relationship: e.relationship,
            })),
            needs: extracted.needs,
            dates: extracted.dates,
            keyPoints: extracted.structuredContent.keyPoints,
            userName: extracted.userName || userName,
          };

          console.log(`[addResource] Extracted structured information: ${extracted.facts.length} facts, ${extracted.entities.length} entities, ${extracted.needs.length} needs, ${extracted.dates.length} dates`);
        } else {
          // Fallback to simple extraction if AI extraction fails
          if (!extractedTitle) {
            const firstLine = content.split('\n')[0]?.trim();
            if (firstLine && firstLine.length > 0 && firstLine.length < 200) {
              extractedTitle = firstLine;
            }
          }
          metadata = { type: contentType };
        }
      } catch (error) {
        console.error('[addResource] Error extracting structured information:', error);
        // Fallback to simple extraction
        if (!extractedTitle) {
          const firstLine = content.split('\n')[0]?.trim();
          if (firstLine && firstLine.length > 0 && firstLine.length < 200) {
            extractedTitle = firstLine;
          }
        }
        metadata = { type: contentType };
      }
    } else {
      // For large texts, use simple extraction
      if (isLargeText) {
        contentType = 'document';
        metadata = { 
          type: contentType, 
          size: content.length, 
          chunks: Math.ceil(content.length / 800) 
        };
      } else {
        metadata = { type: contentType };
      }
      
      if (!extractedTitle) {
        const firstLine = content.split('\n')[0]?.trim();
        if (firstLine && firstLine.length > 0 && firstLine.length < 200) {
          extractedTitle = firstLine;
        }
      }
    }
    
    // A fact about someone already known belongs in their note, not beside it.
    // Before this, saving was an unconditional insert: one message about Andriy
    // produced two notes 900ms apart, and the graph split his wife's identity
    // three ways behind them.
    const dossier = await findDossier({
      userId: session.user.id,
      candidates: toGraphCandidates((metadata as any)?.entities ?? []),
      // What the user said, not what the extractor made of it. Measuring the
      // formatted text meant the summary, the bullets and the restatements
      // counted toward a limit meant to tell a fact from an import: a one-line
      // request about Артем came back out at 743 characters, cleared 600, and
      // was declined as an import — so it became a new note about a person who
      // already had one. The routing was defeated by its own preprocessing.
      contentLength: content.length,
    });

    if (dossier) {
      const merged = await mergeNoteContent({
        existing: dossier.content,
        addition: structuredContent,
        existingFacts: (dossier.metadata as any)?.facts ?? [],
        caller: 'addResource',
      });

      const result = await updateResource(dossier.id, {
        content: merged.content,
        title: dossierTitle(dossier.title, extractedTitle),
        // Facts and entities are unioned rather than replaced: the merged text
        // still carries the old ones, so metadata that forgot them would make
        // the next merge unable to check for what it must not lose.
        metadata: mergeMetadata(dossier.metadata, metadata),
      } as any);

      if (result?.success) {
        return {
          success: true,
          merged: true,
          strategy: merged.strategy,
          id: dossier.id,
          url: `/resources/${dossier.id}`,
          message: `Added to the existing note "${dossierTitle(dossier.title, extractedTitle) ?? 'untitled'}".`,
        };
      }

      // Falling through to a new note is deliberate: failing to update is not a
      // reason to lose what the user just told us.
      console.warn('[addResource] Dossier update failed, saving as a new note:', result?.message);
    }

    const created = await createResource({
      content: structuredContent,
      userId: session.user.id,
      title: extractedTitle || undefined,
      metadata,
    });

    // The saved note's own page, so that offering to open it is a working link
    // rather than an id the model has to guess an address for.
    return created.success && 'id' in created && created.id
      ? { ...created, url: `/resources/${created.id}` }
      : created;
  },
} as const;

/** Union of two notes' extracted metadata, newest winning on scalars. */
function mergeMetadata(existing: unknown, incoming: any) {
  const old = (existing ?? {}) as any;

  const byKey = <T,>(items: T[], key: (item: T) => string): T[] => {
    const seen = new Map<string, T>();
    for (const item of items) if (item) seen.set(key(item), item);
    return [...seen.values()];
  };

  return {
    ...old,
    ...incoming,
    tags: [...new Set([...(old.tags ?? []), ...(incoming.tags ?? [])])],
    facts: byKey(
      [...(old.facts ?? []), ...(incoming.facts ?? [])],
      (f: any) => `${f?.subject}::${f?.predicate}::${f?.object}`
    ),
    entities: byKey(
      [...(old.entities ?? []), ...(incoming.entities ?? [])],
      (e: any) => `${String(e?.name).toLowerCase()}::${e?.type}`
    ),
    // Unioned, not replaced, and this one is load-bearing: the merged note is
    // written through `updateResource`, which re-syncs the axis with `replace`.
    // Metadata that forgot the dossier's earlier dates would take them off the
    // timeline as a side effect of adding one fact to the note.
    dates: byKey(
      [...(old.dates ?? []), ...(incoming.dates ?? [])],
      (d: any) => `${d?.date}::${String(d?.title).toLowerCase()}`
    ),
    keyPoints: [...new Set([...(old.keyPoints ?? []), ...(incoming.keyPoints ?? [])])],
  };
}

