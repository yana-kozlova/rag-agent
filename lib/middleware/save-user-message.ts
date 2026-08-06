'use server';

import { getSessionOrNull } from '@/lib/utils/auth';
import { db } from '@/lib/db';
import { conversations, messages } from '@/lib/db/schema/chat';
import { eq } from 'drizzle-orm';

/**
 * Simple function to save user messages to the messages table (chat history)
 * Saves messages as-is without any classification or processing
 */
export async function saveUserMessage(content: string): Promise<{ saved: boolean; reason?: string; messageId?: string }> {
  try {
    const session = await getSessionOrNull();
    const userId = session?.user?.id;
    if (!userId) {
      return { saved: false, reason: 'Not authenticated' };
    }

    if (!content || content.trim().length === 0) {
      return { saved: false, reason: 'Empty content' };
    }

    // Get or create conversation for user
    let convoId: string | null = null;
    const existing = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.userId, userId as string))
      .limit(1);
    
    if (existing.length > 0) {
      convoId = existing[0].id;
    } else {
      const inserted = await db.insert(conversations).values({ userId: userId as string }).returning({ id: conversations.id });
      convoId = inserted[0].id;
    }

    // Save message to messages table
    const [insertedMsg] = await db
      .insert(messages)
      .values({ 
        conversationId: convoId, 
        role: 'user', 
        content 
      })
      .returning({ id: messages.id });

    return { 
      saved: true,
      messageId: insertedMsg.id,
    };
  } catch (error: any) {
    console.error('[saveUserMessage] Error saving user message:', error);
    return { saved: false, reason: error?.message ?? 'Unknown error' };
  }
}

