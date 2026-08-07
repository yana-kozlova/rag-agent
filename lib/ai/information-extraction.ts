// Information extraction and structuring for knowledge base
// Analyzes user messages to extract structured information before saving

import { generateObject } from 'ai';
import { openai } from '@ai-sdk/openai';
import { env } from '@/lib/env.mjs';
import { z } from 'zod';
import { EXTRACTABLE_RESOURCE_TYPES } from '@/lib/utils/resource-types';
import { logLlmUsage } from './telemetry';

// Schema for structured information extraction
/**
 * Deliberately forgiving: every branch has a default.
 *
 * This call does not run under OpenAI's strict structured output — an
 * open-ended `z.record` used to rule it out, and removing that was not enough
 * to switch it on. The model is therefore free to return a partial object, and
 * it does: on a short note it answered with a complete, well-formed JSON
 * carrying only `structuredContent` and `userName`; on a recipe it invented
 * `ingredients` and `instructions` keys of its own.
 *
 * Under an all-or-nothing schema every one of those responses failed
 * validation and the note was stored with nothing but its type — which is most
 * of why this knowledge base reads flat. Defaults turn that into "keep
 * whatever came back". Partial structure is worth far more than none, and the
 * missing branches simply stay empty.
 */
export const informationExtractionSchema = z.object({
  // Main facts extracted from the message
  facts: z.array(z.object({
    subject: z.string().describe('Who or what this fact is about (e.g., "user", "John", "project X")'),
    predicate: z.string().describe('What is being said about the subject (e.g., "needs help with", "works at", "likes")'),
    object: z.string().describe('The object or value of the predicate (e.g., "schedule planning", "Google", "guitar")'),
    context: z.string().nullish().default(null).describe('Additional context or details'),
  })).default([]).describe('Key facts extracted from the message'),

  // Entities mentioned (people, places, things)
  entities: z.array(z.object({
    name: z.string().describe('Name or identifier of the entity'),
    // Free-form rather than an enum: the taxonomy could not survive contact
    // with real notes — a recipe's entities are dishes and ingredients, and a
    // value outside the list failed the whole extraction. Unknown types land
    // in their own group in the UI, which is a far smaller price.
    type: z.string().default('other').describe('Type of entity: person, place, organization, project, skill, activity, or another short lowercase noun'),
    relationship: z.string().nullish().default(null).describe('Relationship to user (e.g., "friend", "colleague", "hobby")'),
    attributes: z
      .array(z.object({ key: z.string(), value: z.string() }))
      .nullish()
      .default(null)
      .describe('Additional attributes about the entity, as key/value pairs'),
  })).default([]).describe('Entities mentioned in the message'),

  // User needs, preferences, or requests
  needs: z.array(z.object({
    need: z.string().describe('What the user needs or wants (e.g., "help with schedule planning", "learn React")'),
    priority: z.enum(['high', 'medium', 'low']).nullish().default(null).describe('Priority level if mentioned'),
    context: z.string().nullish().default(null).describe('Context or details about the need'),
  })).default([]).describe('User needs, preferences, or requests mentioned'),

  // Structured summary for storage
  structuredContent: z.object({
    title: z.string().describe('Clear, descriptive title summarizing the main point'),
    summary: z.string().default('').describe('Concise summary of the key information (2-3 sentences)'),
    keyPoints: z.array(z.string()).default([]).describe('Key points or facts to remember (3-5 bullet points)'),
    tags: z.array(z.string()).default([]).describe('Relevant tags for searchability (e.g., ["schedule", "daily-routine", "time-management"])'),
  }).describe('Structured content ready for storage'),

  // User name if mentioned or inferred
  userName: z.string().nullish().default(null).describe('User name if mentioned or can be inferred from context'),

  // Content type classification
  contentType: z.enum(EXTRACTABLE_RESOURCE_TYPES).default('note').describe('Type of content'),
});

export type ExtractedInformation = z.infer<typeof informationExtractionSchema>;

/**
 * One extraction attempt. Throws on failure so the caller can decide whether
 * to try again — see `extractStructuredInformation` below.
 */
async function runExtraction(
  content: string,
  userName?: string | null,
  caller: string = 'extractStructuredInformation'
): Promise<ExtractedInformation> {
  try {
    const modelName = env.AI_CHAT_MODEL || 'gpt-4o-mini';

    const userContext = userName ? `The user's name is ${userName}. ` : '';
    const startedAt = Date.now();
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

    const usage = (result as any).usage;
    logLlmUsage({
      op: 'generateObject',
      model: modelName,
      caller,
      inputChars: content.length,
      usage: usage
        ? {
            inputTokens: usage.inputTokens ?? usage.promptTokens,
            outputTokens: usage.outputTokens ?? usage.completionTokens,
            totalTokens: usage.totalTokens,
          }
        : undefined,
      durationMs: Date.now() - startedAt,
    });

    return result.object;
  } catch (error) {
    // Left to the retry wrapper rather than swallowed here.
    throw error;
  }
}

/** One retry. A second failure on the same text is unlikely to be luck. */
const MAX_EXTRACTION_ATTEMPTS = 2;

/**
 * Analyzes a user message and extracts structured information.
 *
 * Structured output against a schema this wide — facts, entities, needs and a
 * summary in one call — fails validation now and then; measured at roughly one
 * attempt in eight. That failure used to be silent and permanent: the note
 * saved with nothing but its type, and nothing ever revisited it. Notes born
 * during such a failure are most of why the knowledge base reads flat, so it
 * is worth a second attempt before giving up.
 *
 * Still returns null when both attempts fail — a note saved without structure
 * beats a save that throws.
 *
 * Long content is read from the front only. Callers used to hand this whole
 * resources, which was harmless while those were notes and PDFs; an EPUB is
 * comfortably past any chat model's context window, and an over-long prompt
 * fails on both attempts and yields a book with no tags, facts or entities at
 * all. The opening of a book is also where its title, author and subject
 * actually live, so the first slice is the part worth spending.
 */
const MAX_EXTRACTION_CHARS = 60_000;

export async function extractStructuredInformation(
  content: string,
  userName?: string | null,
  caller: string = 'extractStructuredInformation'
): Promise<ExtractedInformation | null> {
  const input = content.length > MAX_EXTRACTION_CHARS
    ? content.slice(0, MAX_EXTRACTION_CHARS)
    : content;

  for (let attempt = 1; attempt <= MAX_EXTRACTION_ATTEMPTS; attempt++) {
    try {
      return await runExtraction(input, userName, caller);
    } catch (error) {
      const lastAttempt = attempt === MAX_EXTRACTION_ATTEMPTS;
      console.error(
        `[extractStructuredInformation] attempt ${attempt}/${MAX_EXTRACTION_ATTEMPTS} failed` +
          `${lastAttempt ? ' — giving up, saving without structure' : ', retrying'}:`,
        error instanceof Error ? error.message : error
      );
      if (lastAttempt) return null;
    }
  }

  return null;
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

