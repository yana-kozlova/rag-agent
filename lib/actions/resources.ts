'use server';

import {
  NewResourceParams,
  UpdateResourceParams,
  insertResourceSchema,
  updateResourceSchema,
  resources,
} from '@/lib/db/schema/resources';
import { db } from '../db';
import { generateEmbeddings } from '../ai/embedding';
import { embeddings as embeddingsTable } from '../db/schema/embeddings';
import { eq, and } from 'drizzle-orm';
import { getSessionOrNull } from '@/lib/utils/auth';
import { sql } from 'drizzle-orm';
import { embeddingCache } from '../ai/embedding-cache';
import { autoRouteResource } from './auto-route-resource';
import { syncEntitiesForResource } from './entities';
import { syncTimelineForResource } from './timeline';
import { deleteStoredImage } from '@/lib/storage/images';

export const createResource = async (input: NewResourceParams) => {
  try {
    const parsed = insertResourceSchema.parse(input);
    const { content, title, metadata, userId } = parsed;

    if (!userId) {
      return { success: false, message: 'Unauthorized. Please sign in.' };
    }

    // Embed first, write second.
    //
    // The insert used to come first, so a failed or rate-limited embeddings call
    // left a row in `resources` with no vectors behind it: perfectly readable on
    // its own page, absent from every search, with nothing retrying it and no
    // record of which notes it had happened to. A note that cannot be found is
    // not a saved note, and failing before anything is written at least lets the
    // caller say so.
    const embeddings = await generateEmbeddings(content, 'createResource');

    const resource = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(resources)
        .values({
          content,
          userId,
          title: title || null,
          metadata: metadata || null,
        })
        .returning();

      if (embeddings.length > 0) {
        await tx.insert(embeddingsTable).values(
          embeddings.map(embedding => ({
            sourceId: row.id,
            source: 'resource' as const,
            content: embedding.content,
            embedding: embedding.embedding,
          })),
        );
      }

      return row;
    });

    embeddingCache.clearForUser(userId);

    // Promote the entities extraction found into shared graph nodes, so this
    // note joins everything else that mentions the same people or projects.
    // Non-fatal: a note without its edges is still a saved note.
    const extractedEntities = (metadata as any)?.entities;
    if (Array.isArray(extractedEntities) && extractedEntities.length > 0) {
      try {
        await syncEntitiesForResource({
          resourceId: resource.id,
          userId,
          entities: extractedEntities,
        });
      } catch (err) {
        console.error('[createResource] syncEntitiesForResource failed (non-fatal):', err);
      }
    }

    // And onto the axis, for the same reason and on the same terms: a note that
    // says when something happened is the only place that fact exists, and
    // prose cannot be put in order. Non-fatal — a note without its dates is
    // still a saved note.
    const extractedDates = (metadata as any)?.dates;
    if (Array.isArray(extractedDates) && extractedDates.length > 0) {
      try {
        await syncTimelineForResource({
          resourceId: resource.id,
          userId,
          dates: extractedDates,
        });
      } catch (err) {
        console.error('[createResource] syncTimelineForResource failed (non-fatal):', err);
      }
    }

    // Fire-and-forget: auto-route into tables whose autoRoute rule matches.
    // Never blocks or fails createResource.
    autoRouteResource(resource.id, userId).catch((err) => {
      console.error('[createResource] autoRouteResource failed (non-fatal):', err);
    });

    return { success: true, message: 'Resource successfully created and embedded.', id: resource.id };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error && error.message.length > 0
        ? error.message
        : 'Error, please try again.'
    };
  }
};

export const updateResource = async (resourceId: string, input: UpdateResourceParams) => {
  try {
    const session = await getSessionOrNull();
    const userId = session?.user?.id;
    if (!userId) {
      return { success: false, message: 'Unauthorized. Please sign in.' };
    }

    const parsed = updateResourceSchema.parse(input);
    
    // Verify resource belongs to user
    const [existing] = await db
      .select()
      .from(resources)
      .where(and(
        eq(resources.id, resourceId),
        eq(resources.userId, userId as string)
      ))
      .limit(1);

    if (!existing) {
      return { success: false, message: 'Resource not found or access denied.' };
    }

    // Update resource
    const updateData: any = {
      updatedAt: sql`now()`,
    };
    
    if (parsed.title !== undefined) {
      updateData.title = parsed.title || null;
    }
    if (parsed.content !== undefined) {
      updateData.content = parsed.content;
    }
    if (parsed.metadata !== undefined) {
      updateData.metadata = parsed.metadata || null;
    }

    const contentChanged = parsed.content !== undefined && parsed.content !== existing.content;

    // Embed before touching anything, and swap the text and the vectors together.
    //
    // The old order was: update the row, delete the old embeddings, then call
    // OpenAI. A failure at the last step left the note holding its new text and
    // no vectors at all — unfindable from then on, silently and permanently.
    // Worse, `addResource` reads a failed update as "save it as a new note
    // instead", so a merge that got this far wrote the merged content into the
    // dossier *and* created a second note saying the same thing: the exact
    // duplication note routing exists to prevent.
    //
    // Generating first means a failed call changes nothing at all, which is
    // what makes that fallback correct.
    const regenerated = contentChanged
      ? await generateEmbeddings(parsed.content as string, 'updateResource')
      : [];

    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(resources)
        .set(updateData)
        .where(and(
          eq(resources.id, resourceId),
          eq(resources.userId, userId as string)
        ))
        .returning();

      if (contentChanged) {
        await tx.delete(embeddingsTable).where(eq(embeddingsTable.sourceId, resourceId));

        if (regenerated.length > 0) {
          await tx.insert(embeddingsTable).values(
            regenerated.map(embedding => ({
              sourceId: resourceId,
              source: 'resource' as const,
              content: embedding.content,
              embedding: embedding.embedding,
            })),
          );
        }
      }

      return row;
    });

    embeddingCache.clearForUser(userId);

    // The graph has to follow the text. Without this an updated note keeps the
    // edges it had when it was created, so a person added to it today is
    // invisible in the graph tomorrow — and one removed from it stays linked
    // forever. Non-fatal for the same reason as in `createResource`.
    const updatedEntities = (parsed.metadata as any)?.entities;
    if (parsed.metadata !== undefined && Array.isArray(updatedEntities)) {
      try {
        await syncEntitiesForResource({
          resourceId,
          userId,
          entities: updatedEntities,
          replace: true,
        });
      } catch (err) {
        console.error('[updateResource] syncEntitiesForResource failed (non-fatal):', err);
      }
    }

    // The axis has to follow the text too. `replace` drops only this note's own
    // extracted dates: a date the user stated outright has no resource behind it
    // and survives every edit of every note.
    const updatedDates = (parsed.metadata as any)?.dates;
    if (parsed.metadata !== undefined && Array.isArray(updatedDates)) {
      try {
        await syncTimelineForResource({
          resourceId,
          userId,
          dates: updatedDates,
          replace: true,
        });
      } catch (err) {
        console.error('[updateResource] syncTimelineForResource failed (non-fatal):', err);
      }
    }

    return { success: true, message: 'Resource successfully updated.', resource: updated };
  } catch (error) {
    return { 
      success: false, 
      message: error instanceof Error && error.message.length > 0
        ? error.message
        : 'Error updating resource, please try again.' 
    };
  }
};

export const deleteResource = async (resourceId: string) => {
  try {
    const session = await getSessionOrNull();
    const userId = session?.user?.id;
    if (!userId) {
      return { success: false, message: 'Unauthorized. Please sign in.' };
    }

    // Verify resource belongs to user
    const [existing] = await db
      .select()
      .from(resources)
      .where(and(
        eq(resources.id, resourceId),
        eq(resources.userId, userId as string)
      ))
      .limit(1);

    if (!existing) {
      return { success: false, message: 'Resource not found or access denied.' };
    }

    // Delete embeddings (cascade should handle this, but being explicit)
      await db
        .delete(embeddingsTable)
        .where(eq(embeddingsTable.sourceId, resourceId));

    // Delete resource
    await db
      .delete(resources)
      .where(and(
        eq(resources.id, resourceId),
        eq(resources.userId, userId as string)
      ));

    embeddingCache.clearForUser(userId);

    // Drop the picture too, if this resource was one. After the row is gone, so
    // that a blob store outage cannot block the delete the user asked for.
    const imageUrl = (existing.metadata as { imageUrl?: string } | null)?.imageUrl;
    if (imageUrl) await deleteStoredImage(imageUrl);

    return { success: true, message: 'Resource successfully deleted.' };
  } catch (error) {
    return { 
      success: false, 
      message: error instanceof Error && error.message.length > 0
        ? error.message
        : 'Error deleting resource, please try again.' 
    };
  }
};