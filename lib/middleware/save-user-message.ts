'use server';

import { auth } from '@/app/api/auth/auth';
import { db } from '@/lib/db';
import { resources } from '@/lib/db/schema/resources';
import { embeddings as embeddingsTable } from '@/lib/db/schema/embeddings';
import { generateEmbeddings } from '@/lib/ai/embedding';
import { generateObject } from 'ai';
import { openai } from '@ai-sdk/openai';
import { env } from '@/lib/env.mjs';
import { z } from 'zod';

// Schema for message classification
const messageClassificationSchema = z.object({
  shouldSave: z.boolean().describe('Whether the message contains important information about the user that should be saved'),
  reason: z.string().optional().describe('Brief explanation of the decision'),
});

// Very simple heuristic extractor for schedules
function extractScheduleItems(text: string) {
  const lines = text.split(/\n+/).map(l => l.trim()).filter(Boolean);
  const items: Array<{ title: string; time?: string }> = [];
  const timeRe = /(\d{1,2}:\d{2}\s?(AM|PM)?)|(\d{1,2}[.:]\d{2})/i;
  for (const l of lines) {
    if (/^(\d+\.|[-*])/.test(l) || /event|schedule|meeting|call|class/i.test(l)) {
      const time = l.match(timeRe)?.[0];
      const title = l.replace(/^\d+\.|^[-*]\s?/, '').trim();
      if (title) items.push({ title, time: time ?? undefined });
    }
  }
  return items;
}

// Classify if message contains information worth saving to knowledge base
async function shouldSaveMessage(content: string): Promise<{ shouldSave: boolean; reason?: string }> {
  try {
    const modelName = env.AI_CHAT_MODEL || 'gpt-4o-mini';
    const result = await generateObject({
      model: openai(modelName),
      schema: messageClassificationSchema,
      prompt: `You are helping build a personal knowledge base for a user. This is a learning assistant that gets better over time through interaction.

The goal is to save information that helps the assistant understand the user's world and context. Be generous in saving - it's better to save slightly more than to miss important context.

SAVE if message contains ANY of:
- Personal facts, preferences, work info, goals, plans, schedules
- Information about people in user's life (friends, family, colleagues, acquaintances, anyone mentioned)
- Things the user is learning, studying, or wants to learn
- Projects, hobbies, interests, activities
- Events, experiences, memories, stories
- Decisions, thoughts, ideas, opinions
- Context about places, organizations, or entities related to the user
- Any factual information that provides context (even if it seems minor)
- Information that might be useful for future conversations

ONLY SKIP if message is clearly:
- A pure greeting without content ("Hi", "Hello", "Hey")
- A simple acknowledgment ("Thanks", "OK", "Yes", "No")
- A pure technical question without any personal context ("How does React work?" - but if user says "I'm learning React, how does it work?" then SAVE)

When in doubt, SAVE. The user and assistant are learning together, so context is valuable.

Examples:
- "I work at Google" → shouldSave: true
- "I'm learning React" → shouldSave: true
- "My friend John works in finance" → shouldSave: true
- "I'm planning a trip to Japan" → shouldSave: true
- "I love playing guitar" → shouldSave: true
- "I met Sarah yesterday, she's a designer" → shouldSave: true
- "I'm reading a book about AI" → shouldSave: true
- "How does React work?" → shouldSave: false (pure question)
- "Thanks!" → shouldSave: false (acknowledgment)
- "Hi" → shouldSave: false (greeting)

Message to analyze: "${content}"`,
      temperature: 0.1,
    });

    return {
      shouldSave: result.object.shouldSave,
      reason: result.object.reason,
    };
  } catch (error) {
    console.error('Error classifying message:', error);
    // On error, use simple heuristics as fallback (very lenient - save more)
    const trimmed = content.trim().toLowerCase();
    const questionWords = ['what', 'how', 'why', 'when', 'where', 'who', 'which'];
    // Only skip if it's a pure question without personal context
    const isPureQuestion = trimmed.length < 30 && questionWords.some(word => trimmed.startsWith(word)) && trimmed.includes('?');
    // Very lenient: save if it has any personal context or is longer than 20 chars
    const hasAnyContext = content.length > 20 || /(i |my |me |friend|colleague|family|learning|studying|project|hobby|work|like|want|need|have|plan|met|saw|know)/i.test(content);
    
    return { 
      shouldSave: !isPureQuestion && hasAnyContext,
      reason: 'Fallback heuristic - very lenient, learning mode'
    };
  }
}

/**
 * Middleware function to automatically save user messages to knowledge base (RAG)
 * Saves information about user's life: personal facts, people, learning, projects, experiences
 * Call this after receiving a user message but before processing
 */
export async function saveUserMessageIfImportant(content: string): Promise<{ saved: boolean; reason?: string; chunks?: number; isLargeText?: boolean; resourceId?: string }> {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return { saved: false, reason: 'Not authenticated' };
    }

    if (!content || content.trim().length === 0) {
      return { saved: false, reason: 'Empty content' };
    }

    // Skip saving very short messages or common greetings (very minimal filtering)
    const trimmed = content.trim();
    const shortMessages = ['hi', 'hello', 'hey', 'ok', 'okay', 'thanks', 'thank you', 'bye', 'goodbye'];
    // Only skip if it's a very short message that's clearly just a greeting/acknowledgment
    if (trimmed.length < 5 || (trimmed.length < 15 && shortMessages.includes(trimmed.toLowerCase()))) {
      return { saved: false, reason: 'Too short or common greeting' };
    }

    // For very large texts, skip AI classification (expensive) and save directly
    // Large texts are likely important documents/articles that should be saved
    const MAX_CLASSIFICATION_LENGTH = 2000; // characters
    let shouldSave = true;
    let classificationReason = 'Large text - saving directly';
    
    if (content.length <= MAX_CLASSIFICATION_LENGTH) {
      // Use AI to classify if message contains information worth saving (only for smaller texts)
      const classification = await shouldSaveMessage(content);
      shouldSave = classification.shouldSave;
      classificationReason = classification.reason || 'Does not contain information worth saving';
    }
    
    if (!shouldSave) {
      return { 
        saved: false, 
        reason: classificationReason
      };
    }

    // Save to resources and create embeddings
    const items = extractScheduleItems(content);
    
    // For large texts, add metadata about size
    const isLargeText = content.length > 5000;
    const metadata: any = items.length > 0 
      ? { type: 'schedule', items } 
      : isLargeText 
        ? { type: 'document', size: content.length, chunks: Math.ceil(content.length / 800) }
        : { type: 'note' };
    
    // Try to extract a title from content (first line or first sentence)
    const firstLine = content.split('\n')[0]?.trim();
    const title = firstLine && firstLine.length > 0 && firstLine.length < 200 
      ? firstLine 
      : null;
    
    const [resRow] = await db.insert(resources).values({
      content,
      userId: userId as any,
      source: 'resource',
      title: title || null,
      metadata,
    }).returning({ id: resources.id });

    // Generate embeddings - this will chunk large texts appropriately
    const chunks = await generateEmbeddings(content);
    if (chunks.length > 0) {
      // For very large texts, batch insert to avoid overwhelming the database
      const BATCH_SIZE = 50;
      for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
        const batch = chunks.slice(i, i + BATCH_SIZE);
        await db.insert(embeddingsTable).values(
          batch.map(e => ({
            resourceId: resRow.id,
            source: 'resource' as const,
            content: e.content,
            embedding: e.embedding,
          }))
        );
      }
    }

    return { 
      saved: true,
      chunks: chunks.length,
      isLargeText,
      resourceId: resRow.id,
    };
  } catch (error: any) {
    console.error('[saveUserMessage] Error saving user message:', error);
    return { saved: false, reason: error?.message ?? 'Unknown error' };
  }
}

