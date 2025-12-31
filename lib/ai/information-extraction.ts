// Information extraction and structuring for knowledge base
// Analyzes user messages to extract structured information before saving

import { generateObject } from 'ai';
import { openai } from '@ai-sdk/openai';
import { env } from '@/lib/env.mjs';
import { z } from 'zod';

// Schema for structured information extraction
const informationExtractionSchema = z.object({
  // Main facts extracted from the message
  facts: z.array(z.object({
    subject: z.string().describe('Who or what this fact is about (e.g., "user", "John", "project X")'),
    predicate: z.string().describe('What is being said about the subject (e.g., "needs help with", "works at", "likes")'),
    object: z.string().describe('The object or value of the predicate (e.g., "schedule planning", "Google", "guitar")'),
    context: z.string().optional().describe('Additional context or details'),
  })).describe('Key facts extracted from the message'),
  
  // Entities mentioned (people, places, things)
  entities: z.array(z.object({
    name: z.string().describe('Name or identifier of the entity'),
    type: z.enum(['person', 'place', 'organization', 'project', 'skill', 'activity', 'preference', 'need', 'goal', 'other']).describe('Type of entity'),
    relationship: z.string().optional().describe('Relationship to user (e.g., "friend", "colleague", "hobby")'),
    attributes: z.record(z.string()).optional().describe('Additional attributes about the entity'),
  })).describe('Entities mentioned in the message'),
  
  // User needs, preferences, or requests
  needs: z.array(z.object({
    need: z.string().describe('What the user needs or wants (e.g., "help with schedule planning", "learn React")'),
    priority: z.enum(['high', 'medium', 'low']).optional().describe('Priority level if mentioned'),
    context: z.string().optional().describe('Context or details about the need'),
  })).describe('User needs, preferences, or requests mentioned'),
  
  // Structured summary for storage
  structuredContent: z.object({
    title: z.string().describe('Clear, descriptive title summarizing the main point'),
    summary: z.string().describe('Concise summary of the key information (2-3 sentences)'),
    keyPoints: z.array(z.string()).describe('Key points or facts to remember (3-5 bullet points)'),
    tags: z.array(z.string()).describe('Relevant tags for searchability (e.g., ["schedule", "daily-routine", "time-management"])'),
  }).describe('Structured content ready for storage'),
  
  // User name if mentioned or inferred
  userName: z.string().optional().describe('User name if mentioned or can be inferred from context'),
  
  // Content type classification
  contentType: z.enum(['note', 'document', 'schedule', 'person', 'project', 'skill', 'event', 'learning', 'preference', 'need', 'other']).describe('Type of content'),
});

export type ExtractedInformation = z.infer<typeof informationExtractionSchema>;

/**
 * Analyzes user message and extracts structured information
 */
export async function extractStructuredInformation(
  content: string,
  userName?: string | null
): Promise<ExtractedInformation | null> {
  try {
    const modelName = env.AI_CHAT_MODEL || 'gpt-4o-mini';
    
    const userContext = userName ? `The user's name is ${userName}. ` : '';
    
    const result = await generateObject({
      model: openai(modelName),
      schema: informationExtractionSchema,
      prompt: `You are analyzing a user message to extract structured information for a personal knowledge base.

Your goal is to:
1. Extract key facts, entities, and relationships
2. Identify user needs, preferences, and goals
3. Create a structured summary that will be searchable and useful
4. Link information to the user when appropriate

${userContext}Analyze the following message and extract structured information:

"${content}"

Guidelines:
- Extract facts in subject-predicate-object format
- Identify all entities (people, places, projects, activities, etc.)
- Note user needs, preferences, and requests explicitly
- Create a clear title and summary
- Generate relevant tags for searchability
- If the user mentions their name or it can be inferred, include it in userName
- Link facts to the user when they're about the user (use "user" as subject)
- Be specific and detailed - this information will be used to help the user in future conversations

Examples:
Message: "дай рекомендації конкретні! мені треба впихнути сон, прибирання, читання давай побудуємо графік дня"
Facts:
- subject: "user", predicate: "needs help with", object: "daily schedule planning"
- subject: "user", predicate: "wants to include", object: "sleep, cleaning, reading in daily schedule"
Entities:
- name: "daily schedule", type: "activity", relationship: "user's routine"
Needs:
- need: "help with daily schedule planning", priority: "high", context: "wants to include sleep, cleaning, reading"
Structured content:
- title: "User needs help planning daily schedule with sleep, cleaning, and reading"
- summary: "User requests help creating a daily schedule that includes sleep, cleaning, and reading activities. They want specific recommendations for time management."
- keyPoints: ["User needs help with daily schedule planning", "Wants to include: sleep, cleaning, reading", "Requests specific recommendations", "Wants to build a daily schedule"]
- tags: ["schedule", "daily-routine", "time-management", "sleep", "cleaning", "reading"]

Now analyze the provided message.`,
      temperature: 0.2, // Lower temperature for more consistent extraction
    });

    return result.object;
  } catch (error) {
    console.error('[extractStructuredInformation] Error:', error);
    return null;
  }
}

/**
 * Formats extracted information into content for storage
 * Only saves structured information, not the original message
 */
export function formatStructuredContent(extracted: ExtractedInformation, originalContent: string, includeOriginal = false): string {
  const parts: string[] = [];
  
  // Add structured summary
  parts.push(extracted.structuredContent.summary);
  parts.push('');
  
  // Add key points
  if (extracted.structuredContent.keyPoints.length > 0) {
    extracted.structuredContent.keyPoints.forEach(point => {
      parts.push(`- ${point}`);
    });
    parts.push('');
  }
  
  // Add facts if any (formatted as natural statements)
  if (extracted.facts.length > 0) {
    extracted.facts.forEach(fact => {
      const contextPart = fact.context ? `. ${fact.context}` : '';
      parts.push(`${fact.subject} ${fact.predicate} ${fact.object}${contextPart}`);
    });
    parts.push('');
  }
  
  // Add entities if any (as contextual information)
  if (extracted.entities.length > 0) {
    extracted.entities.forEach(entity => {
      const relPart = entity.relationship ? ` (${entity.relationship})` : '';
      parts.push(`${entity.name} - ${entity.type}${relPart}`);
    });
    parts.push('');
  }
  
  // Add needs if any
  if (extracted.needs.length > 0) {
    extracted.needs.forEach(need => {
      const priorityPart = need.priority ? ` [${need.priority} priority]` : '';
      const contextPart = need.context ? `. ${need.context}` : '';
      parts.push(`${need.need}${priorityPart}${contextPart}`);
    });
    parts.push('');
  }
  
  // Only include original content if explicitly requested (for debugging/reference)
  if (includeOriginal) {
    parts.push('---');
    parts.push('Original message:');
    parts.push(originalContent);
  }
  
  return parts.join('\n').trim();
}

