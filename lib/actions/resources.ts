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
import { auth } from '@/app/api/auth/auth';
import { sql } from 'drizzle-orm';

export const createResource = async (input: NewResourceParams) => {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return { success: false, message: 'Unauthorized. Please sign in.' };
    }

    const parsed = insertResourceSchema.parse(input);
    const { content, title, metadata } = parsed;

    const [resource] = await db
      .insert(resources)
      .values({ 
        content, 
        userId,
        title: title || null,
        metadata: metadata || null,
      })
      .returning();

    const embeddings = await generateEmbeddings(content);
    if (embeddings.length > 0) {
      await db.insert(embeddingsTable).values(
        embeddings.map(embedding => ({
          sourceId: resource.id,
          source: 'resource' as const,
          content: embedding.content,
          embedding: embedding.embedding,
        })),
      );
    }

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
    const session = await auth();
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
        eq(resources.userId, userId as any)
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

    const [updated] = await db
      .update(resources)
      .set(updateData)
      .where(and(
        eq(resources.id, resourceId),
        eq(resources.userId, userId as any)
      ))
      .returning();

    // If content changed, regenerate embeddings
    if (parsed.content !== undefined && parsed.content !== existing.content) {
      // Delete old embeddings
      await db
        .delete(embeddingsTable)
        .where(eq(embeddingsTable.sourceId, resourceId));

      // Generate new embeddings
      const embeddings = await generateEmbeddings(parsed.content);
      if (embeddings.length > 0) {
        await db.insert(embeddingsTable).values(
          embeddings.map(embedding => ({
            sourceId: resourceId,
            source: 'resource' as const,
            content: embedding.content,
            embedding: embedding.embedding,
          })),
        );
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
    const session = await auth();
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
        eq(resources.userId, userId as any)
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
        eq(resources.userId, userId as any)
      ));

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