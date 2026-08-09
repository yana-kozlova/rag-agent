// Information extraction and structuring for knowledge base
// Analyzes user messages to extract structured information before saving

import { generateObject } from 'ai';
import { openai } from '@ai-sdk/openai';
import { env } from '@/lib/env.mjs';
import { z } from 'zod';
import { EXTRACTABLE_RESOURCE_TYPES } from '@/lib/utils/resource-types';
import { DEFAULT_TIMEZONE, getLocalDateKey } from '@/lib/push/timezone';
import { logLlmUsage } from './telemetry';

/**
 * Today in the deployment's own zone, for callers that have no user to ask.
 *
 * A fallback, not the answer: "вчора" resolved against the wrong zone is filed a
 * day out and stays that way, so anything that *can* pass the user's own today
 * does — see `todayFor`.
 */
function serverToday(): string {
  return getLocalDateKey(new Date(), DEFAULT_TIMEZONE);
}

/**
 * One dated thing, in the shape `toTimelineCandidates` checks.
 *
 * Shared by the full extraction and by the dates-only pass the backfill runs, so
 * the two cannot come to disagree about what a date looks like — the same reason
 * the rules below are a constant rather than two paragraphs of prompt.
 */
const datedEventSchema = z.object({
  date: z
    .string()
    .describe(
      'YYYY-MM-DD if the day is known, YYYY-MM if only the month, YYYY if only the year, ' +
        '--MM-DD if the day and month are known but the year is not (birthdays). Never guess a component that was not stated.'
    ),
  title: z
    .string()
    .describe("Short label naming what happened, in the note's own language — \"Артем народився\""),
  kind: z
    .string()
    .default('other')
    .describe(
      'One of: birth, anniversary, move, trip, work, education, health, milestone, loss, purchase, other'
    ),
  subject: z
    .string()
    .nullish()
    .default(null)
    .describe('Who the date is about, named exactly as in the text. Null if it is about no one in particular.'),
  note: z
    .string()
    .nullish()
    .default(null)
    .describe('One sentence of detail worth keeping alongside the date'),
  recurring: z
    .boolean()
    .default(false)
    .describe('True only for dates that come round every year — a birthday, a wedding anniversary'),
});

/**
 * What makes a date worth a row on the axis.
 *
 * The hard part is not parsing dates, it is refusing most of them. A knowledge
 * base full of "the meeting is on Tuesday" has a timeline nobody opens twice —
 * scheduling belongs to the calendar, which already holds it, and a note's own
 * created-at is not an event. What belongs here is the small number of days a
 * person would still name years later.
 *
 * Deadlines are named explicitly because leaving them out was not enough. The
 * first backfill over a real base returned five dates: one birthday and four due
 * dates read off `need` notes — "клопотатися про довідку до 17.08", "купити
 * форму до 31.08" — including the same certificate twice under two dates and one
 * meaningless title. The earlier wording banned meetings and appointments and a
 * due date is neither, so the model was reading the rules correctly. A deadline
 * is a *task*: it is over the moment it passes, nobody names it years later, and
 * `needs` already carries it in metadata waiting for a tasks layer to read.
 * Putting it on the axis makes the axis a worse to-do list.
 */
export const DATE_EXTRACTION_RULES = [
  'DATES — only dates worth remembering for years: births, deaths, weddings, moves, first days at a school or job,',
  'trips, diagnoses and procedures, significant purchases, achievements, anniversaries.',
  'The test is whether the person would still name that day in five years.',
  'Never extract: the day the note was written, times of day, recurring routines ("щоранку о 7"),',
  'appointments, visits and meetings (those live in the calendar), or vague futures ("колись", "наступного разу").',
  'Never extract a deadline or a due date — "до 31.08", "треба купити до понеділка", "подати заяву до 17.08"',
  'are tasks, not dates on a life: they stop mattering once they pass. This holds however urgent the task is.',
  'Resolve relative wording ("вчора", "минулого літа") against today\'s date, given above.',
  'Record only what was actually said: if the text gives a year and no month, answer with the year alone.',
  'Set recurring=true only for a date that repeats every year, and use --MM-DD when a birthday is given without a year.',
  'If nothing in the text qualifies, answer with an empty list. That is the normal case — most notes have no such date.',
].join(' ');

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
    // Relative to the user and nobody else. A note states relations between
    // third parties all the time ("Артем is my kuma's godson"), and lifting the
    // relation out of the sentence it was in makes the user the other end of
    // it — so the graph learns that the user's own son is their godson and
    // prints it beside his name as fact. `setRelationship` is the correction;
    // this is the rule that stops it needing one.
    relationship: z.string().nullish().default(null).describe('How this entity relates to THE USER specifically (e.g., "friend", "colleague", "hobby"). If the message only states how it relates to someone else, either say so in full ("godson of the user\'s kuma") or leave this null — never record that relation as if it were the user\'s.'),
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

  // Dates worth putting on a timeline. See DATE_EXTRACTION_RULES for what
  // qualifies — the schema cannot express "only if it matters next year".
  dates: z.array(datedEventSchema).default([]).describe('Dates worth remembering, if any'),

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
  caller: string = 'extractStructuredInformation',
  today: string = serverToday()
): Promise<ExtractedInformation> {
  try {
    const modelName = env.AI_CHAT_MODEL || 'gpt-4o-mini';

    const userContext = userName ? `The user's name is ${userName}. ` : '';
    const startedAt = Date.now();
    const result = await generateObject({
      model: openai(modelName),
      schema: informationExtractionSchema,
      prompt: `You are analyzing a user message to extract structured information for a personal knowledge base.

Today is ${today}.

Your goal is to:
1. Extract key facts, entities, and relationships
2. Identify user needs, preferences, and goals
3. Pick out any dates the user would still want to find years from now
4. Create a structured summary that will be searchable and useful
5. Link information to the user when appropriate

${userContext}Analyze the following message and extract structured information:

"${content}"

Guidelines:
- Extract facts in subject-predicate-object format
- Identify all entities (people, places, projects, activities, etc.)
- Note user needs, preferences, and requests explicitly
- Create a clear title and summary
- Generate relevant tags for searchability
- If the user mentions their name or it can be inferred, include it in userName
- Link facts to the user when they're about the user: as the subject use the word for "user" in the message's language ("user", "користувач"), never their name
- An entity's "relationship" is to the USER and to nobody else. When the message states a relation between two other people, either write it out in full or leave it null — do not move it onto the user. "Артем — похресник моєї куми" makes Артем the godson of the user's kuma, not the user's godson; "Артем, мій син, — похресник куми" makes him relationship: "син користувача"
- Be specific and detailed - this information will be used to help the user in future conversations
- ${DATE_EXTRACTION_RULES}

Language:
- WRITE IN THE LANGUAGE OF THE MESSAGE. The title, the summary, every key point, and the wording of every fact, entity and need are written in the language the user wrote in. Do not translate.
- Never translate or transliterate a name. A person, place or organization keeps the exact spelling the message used, in its own alphabet.
- Four fields are machine-readable and are ALWAYS lowercase English, whatever the message's language: contentType, each entity's "type", each need's "priority", and every tag.

Examples:
Message: "дай рекомендації конкретні! мені треба впихнути сон, прибирання, читання давай побудуємо графік дня"
Facts:
- subject: "користувач", predicate: "потребує допомоги з", object: "плануванням графіка дня"
- subject: "користувач", predicate: "хоче включити", object: "сон, прибирання, читання в графік дня"
Entities:
- name: "графік дня", type: "activity", relationship: "щоденна рутина користувача"
Needs:
- need: "допомога з плануванням графіка дня", priority: "high", context: "хоче включити сон, прибирання, читання"
Structured content:
- title: "Користувач потребує допомоги зі складанням графіка дня"
- summary: "Користувач просить допомогти скласти графік дня, куди входять сон, прибирання і читання. Хоче конкретні рекомендації щодо розподілу часу."
- keyPoints: ["Потрібна допомога зі складанням графіка дня", "Має вміщати: сон, прибирання, читання", "Просить конкретні рекомендації"]
- tags: ["schedule", "daily-routine", "time-management", "sleep", "cleaning", "reading"]

Message: "Met Sarah from Acme yesterday, she's leading their billing migration"
Facts:
- subject: "Sarah", predicate: "works at", object: "Acme"
- subject: "Sarah", predicate: "is leading", object: "billing migration"
Entities:
- name: "Sarah", type: "person", relationship: "professional contact"
- name: "Acme", type: "organization", relationship: null
Structured content:
- title: "Sarah from Acme is leading their billing migration"
- tags: ["work", "contacts", "migration"]

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
  caller: string = 'extractStructuredInformation',
  /** The user's own today, `YYYY-MM-DD`. Relative dates are resolved against it. */
  today?: string
): Promise<ExtractedInformation | null> {
  const input = content.length > MAX_EXTRACTION_CHARS
    ? content.slice(0, MAX_EXTRACTION_CHARS)
    : content;

  for (let attempt = 1; attempt <= MAX_EXTRACTION_ATTEMPTS; attempt++) {
    try {
      return await runExtraction(input, userName, caller, today ?? serverToday());
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

export type ExtractedDateInfo = z.infer<typeof datedEventSchema>;

const datesOnlySchema = z.object({
  dates: z.array(datedEventSchema).default([]),
});

/**
 * Dates and nothing else, for notes that were saved before the timeline existed.
 *
 * A narrower call than the full extraction on purpose. Re-running that over the
 * whole base would rewrite every note's type, tags, facts and entities as a side
 * effect of wanting its dates — replacing structure the user may have corrected
 * by hand with whatever the model says today. This reads and answers one
 * question, and `pnpm timeline:backfill` writes only what it returns.
 *
 * Returns null when the call fails, which the backfill reports rather than
 * silently recording as "this note has no dates".
 */
export async function extractDates(
  content: string,
  today: string,
  caller: string = 'extractDates'
): Promise<ExtractedDateInfo[] | null> {
  const modelName = env.AI_CHAT_MODEL || 'gpt-4o-mini';
  const input = content.length > MAX_EXTRACTION_CHARS
    ? content.slice(0, MAX_EXTRACTION_CHARS)
    : content;

  const startedAt = Date.now();

  try {
    const result = await generateObject({
      model: openai(modelName),
      schema: datesOnlySchema,
      prompt: [
        'Read the following note from a personal knowledge base and list the dates it records.',
        `Today is ${today}.`,
        '',
        DATE_EXTRACTION_RULES,
        '',
        `Note:\n"${input}"`,
      ].join('\n'),
      temperature: 0.2,
    });

    const usage = (result as any).usage;
    logLlmUsage({
      op: 'generateObject',
      model: modelName,
      caller,
      inputChars: input.length,
      usage: usage
        ? {
            inputTokens: usage.inputTokens ?? usage.promptTokens,
            outputTokens: usage.outputTokens ?? usage.completionTokens,
            totalTokens: usage.totalTokens,
          }
        : undefined,
      durationMs: Date.now() - startedAt,
    });

    return result.object.dates;
  } catch (error) {
    console.error(
      '[extractDates] failed:',
      error instanceof Error ? error.message : error
    );
    return null;
  }
}

/**
 * The note as text: the summary, and the key points under it.
 *
 * This used to append the facts, the entities and the needs as well, so one
 * sentence came back out of the base said five times over — a prose summary,
 * the same thing as bullets, the same thing again as subject-predicate-object,
 * once more as "name - type (relationship)", and a last time as a need. A
 * message asking for a pediatrician's certificate stored 743 characters of
 * which 190 carried anything; the other 550 were restatements, and every one
 * of them was embedded and searched as if it were a separate claim.
 *
 * All three dropped sections are already in `metadata`, in a machine-readable
 * form the graph and the merge check read directly. Prose copies of them were
 * never the source of anything — only volume. Three second-order costs went
 * with them: the inflated length pushed notes past `MAX_ROUTABLE_LENGTH` so
 * dossier routing declined them as imports and wrote a new note instead (the
 * exact duplication the routing exists to prevent), retrieval scored five
 * near-identical chunks against a query that deserved one, and the resource
 * page printed the key points a second time under text that already had them.
 *
 * `keyPoints` stays because it is the note, not a projection of it: these are
 * the specifics — dates, names, amounts — and the embedding is built from this
 * string, so dropping them would take the searchable detail out with the
 * repetition.
 */
export function formatStructuredContent(extracted: ExtractedInformation, originalContent: string, includeOriginal = false): string {
  const parts: string[] = [];

  parts.push(extracted.structuredContent.summary);

  if (extracted.structuredContent.keyPoints.length > 0) {
    parts.push('');
    extracted.structuredContent.keyPoints.forEach(point => {
      parts.push(`- ${point}`);
    });
  }

  // Only include original content if explicitly requested (for debugging/reference)
  if (includeOriginal) {
    parts.push('');
    parts.push('---');
    parts.push('Original message:');
    parts.push(originalContent);
  }

  return parts.join('\n').trim();
}

/** The three blocks the formatter above used to append, rendered as they were. */
const legacyProseSections = {
  facts: (fact: { subject?: unknown; predicate?: unknown; object?: unknown; context?: unknown }) =>
    `${fact.subject} ${fact.predicate} ${fact.object}${fact.context ? `. ${fact.context}` : ''}`,

  entities: (entity: { name?: unknown; type?: unknown; relationship?: unknown }) =>
    `${entity.name} - ${entity.type}${entity.relationship ? ` (${entity.relationship})` : ''}`,

  needs: (need: { need?: unknown; priority?: unknown; context?: unknown }) =>
    `${need.need}${need.priority ? ` [${need.priority} priority]` : ''}${need.context ? `. ${need.context}` : ''}`,
};

/**
 * A stored note with the old restatements taken back out, or null if there were
 * none to take.
 *
 * Used by `pnpm kb:compact` on notes written before the formatter stopped
 * producing them. The text being cleaned has in some cases since been merged,
 * rewritten by a model and edited by hand, so the only safe way to know a line
 * was generated rather than typed is to generate it again from that same note's
 * metadata and match it character for character. Nothing is matched by pattern;
 * a sentence the user wrote cannot collide with this.
 *
 * Returns null rather than an empty note when the lines are all there is:
 * `summary` defaults to an empty string, so an extraction that returned only
 * facts produced a note made of nothing else, and emptying it would delete it
 * in all but name. It keeps its repetition instead.
 */
export function stripLegacyProseSections(content: string, metadata: unknown): string | null {
  const meta = (metadata ?? {}) as Record<string, unknown>;
  const generated = new Set<string>();

  for (const [key, render] of Object.entries(legacyProseSections)) {
    const items = meta[key];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (item && typeof item === 'object') generated.add(render(item as never).trim());
    }
  }

  generated.delete('');
  if (generated.size === 0) return null;

  const lines = content.split('\n');
  const kept = lines.filter((line) => !generated.has(line.trim()));
  if (kept.length === lines.length) return null;

  const result = kept
    .join('\n')
    // The removed blocks leave their separating blank lines behind.
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return result.length > 0 ? result : null;
}

