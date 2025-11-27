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

// Classify if message contains important information about the user
async function shouldSaveMessage(content: string): Promise<{ shouldSave: boolean; reason?: string }> {
  try {
    const modelName = env.AI_CHAT_MODEL || 'gpt-4o-mini';
    const result = await generateObject({
      model: openai(modelName),
      schema: messageClassificationSchema,
      prompt: `Analyze the following user message and determine if it contains important information about the user that should be saved to their knowledge base.

Rules:
- SAVE if message contains: personal facts, preferences, work info, goals, plans, schedules, important events, personal notes, decisions, or any factual information about the user
- DO NOT SAVE if message is: a question, a greeting, a simple acknowledgment, a request for information, or general conversation without personal facts

Examples:
- "I work at Google" → shouldSave: true (personal fact)
- "I like programming" → shouldSave: true (preference)
- "I have a meeting tomorrow at 2pm" → shouldSave: true (schedule/plan)
- "How does React work?" → shouldSave: false (question)
- "Thanks!" → shouldSave: false (acknowledgment)
- "What is the weather?" → shouldSave: false (question)

Message to analyze: "${content}"`,
      temperature: 0.1,
    });

    return {
      shouldSave: result.object.shouldSave,
      reason: result.object.reason,
    };
  } catch (error) {
    console.error('Error classifying message:', error);
    // On error, use simple heuristics as fallback
    const trimmed = content.trim().toLowerCase();
    const questionWords = ['what', 'how', 'why', 'when', 'where', 'who', 'which', '?'];
    const isQuestion = questionWords.some(word => trimmed.startsWith(word) || trimmed.includes('?'));
    const hasPersonalInfo = /(i (am|work|like|prefer|want|need|have|plan)|my |me |myself)/i.test(content);
    
    return { 
      shouldSave: !isQuestion && hasPersonalInfo && content.length > 20,
      reason: 'Fallback heuristic'
    };
  }
}

/**
 * Middleware function to automatically save important user messages to RAG
 * Call this after receiving a user message but before processing
 */
export async function saveUserMessageIfImportant(content: string): Promise<{ saved: boolean; reason?: string }> {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return { saved: false, reason: 'Not authenticated' };
    }

    if (!content || content.trim().length === 0) {
      return { saved: false, reason: 'Empty content' };
    }

    // Skip saving very short messages or common greetings
    const trimmed = content.trim();
    const shortMessages = ['hi', 'hello', 'hey', 'ok', 'okay', 'thanks', 'thank you', 'bye', 'goodbye', 'yes', 'no', '?', '??'];
    if (trimmed.length < 10 || shortMessages.includes(trimmed.toLowerCase())) {
      return { saved: false, reason: 'Too short or common greeting' };
    }

    // Use AI to classify if message contains important information about the user
    const classification = await shouldSaveMessage(content);
    if (!classification.shouldSave) {
      return { 
        saved: false, 
        reason: classification.reason || 'Does not contain important user information' 
      };
    }

    // Save to resources and create embeddings
    const items = extractScheduleItems(content);
    const [resRow] = await db.insert(resources).values({
      content,
      userId: userId as any,
      source: 'resource',
      metadata: items.length > 0 ? { type: 'schedule', items } : { type: 'note' },
    }).returning({ id: resources.id });

    const chunks = await generateEmbeddings(content);
    if (chunks.length > 0) {
      await db.insert(embeddingsTable).values(
        chunks.map(e => ({
          resourceId: resRow.id,
          source: 'resource' as const,
          content: e.content,
          embedding: e.embedding,
        }))
      );
    }

    return { saved: true };
  } catch (error: any) {
    console.error('Error saving user message:', error);
    return { saved: false, reason: error?.message ?? 'Unknown error' };
  }
}

