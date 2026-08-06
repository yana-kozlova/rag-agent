/**
 * Turning one question into the handful of queries worth actually searching.
 *
 * A question and the note that answers it rarely share wording. "Скільки я
 * плачу за спортзал?" has to reach a note that says "membership 1200/міс" —
 * the vector half bridges some of that, but not across languages, and not when
 * the question names a thing the note calls something else.
 *
 * This used to be done by permuting the string: prepending "information
 * about", dropping the question mark, stripping stopwords. Those variants
 * embed to almost the same point as the original, so four searches asked the
 * index nearly the same thing four times — four embedding calls for one
 * question's worth of recall. A model, given the question, produces variants
 * that differ where it matters: the other language, the likely phrasing of the
 * note, the bare entity name.
 */

import { generateObject } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { env } from '@/lib/env.mjs';
import { logLlmUsage } from './telemetry';

/** Including the original. More costs an embedding call each and adds little. */
const MAX_QUERIES = 3;

const expansionSchema = z.object({
  queries: z
    .array(z.string())
    .default([])
    .describe('Alternative search queries, most promising first'),
});

/**
 * The fallback, and the whole of the old behaviour.
 *
 * Used when the rewrite model fails or is too slow to be worth waiting for.
 * Deliberately cheap and synchronous: search degrading to "search for what was
 * asked" is a fine outcome, and it is better than an error.
 */
export function heuristicVariations(question: string): string[] {
  const trimmed = question.trim();
  if (!trimmed) return [];

  const variations = [trimmed];
  const statement = trimmed.endsWith('?') ? trimmed.slice(0, -1).trim() : '';
  if (statement) variations.push(statement);

  // Content words alone, for when the question's grammar is the noisy part.
  const stopwords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'what', 'when', 'where', 'who', 'why', 'how',
    'about', 'my', 'me', 'i', 'do', 'does', 'did', 'have', 'has',
    'що', 'як', 'де', 'коли', 'хто', 'чому', 'мій', 'моя', 'моє', 'мені', 'я', 'це', 'у', 'в', 'на', 'до', 'з',
  ]);
  const keyTerms = trimmed
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopwords.has(w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')))
    .slice(0, 4);
  if (keyTerms.length > 0) variations.push(keyTerms.join(' '));

  return [...new Set(variations)].slice(0, MAX_QUERIES);
}

/**
 * Wall-clock budget for the rewrite.
 *
 * The rewrite sits in front of every knowledge-base lookup, so its latency is
 * added to every answer. Past this point the variants are not worth the wait —
 * searching the original question immediately beats searching a better
 * question noticeably later.
 */
const REWRITE_TIMEOUT_MS = 4_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(null);
      });
  });
}

/**
 * Expand a question into up to `MAX_QUERIES` search queries.
 *
 * The original question is always first and always present — the model is
 * asked for alternatives, never for a replacement, so a bad rewrite can add
 * noise but cannot lose the query the user actually asked.
 */
export async function expandQuery(
  question: string,
  caller: string = 'expandQuery'
): Promise<string[]> {
  const original = question.trim();
  if (!original) return [];

  // Two words or fewer is already the bare term a rewrite would produce.
  if (original.split(/\s+/).length <= 2) return [original];

  const modelName = env.AI_CHAT_MODEL || 'gpt-4o-mini';
  const startedAt = Date.now();

  const result = await withTimeout(
    generateObject({
      model: openai(modelName),
      schema: expansionSchema,
      temperature: 0,
      prompt: `Rewrite this question into up to ${MAX_QUERIES - 1} alternative search queries for a personal knowledge base of the user's own notes, documents and calendar entries.

Question: "${original}"

Rules:
- Write queries the way the stored NOTE would be worded, not the way a question is worded. The note is a statement.
- If the question is not in English, include one English query; if it is in English, include one query in the other language only when the question names something likely written in it. The base is Ukrainian and English mixed.
- Include a query that is just the key entity or term, with no grammar around it.
- Do not repeat the original question.
- No explanations, only the queries.`,
    }),
    REWRITE_TIMEOUT_MS
  );

  if (!result) {
    console.warn(`[expandQuery] rewrite unavailable, falling back to heuristics for: "${original}"`);
    return heuristicVariations(original);
  }

  const usage = (result as any).usage;
  logLlmUsage({
    op: 'generateObject',
    model: modelName,
    caller,
    inputChars: original.length,
    usage: usage
      ? {
          inputTokens: usage.inputTokens ?? usage.promptTokens,
          outputTokens: usage.outputTokens ?? usage.completionTokens,
          totalTokens: usage.totalTokens,
        }
      : undefined,
    durationMs: Date.now() - startedAt,
  });

  return dedupeQueries(original, result.object.queries);
}

/**
 * Original first, then whatever survives of the model's suggestions.
 *
 * Case-insensitive matching, because a variant differing from the original
 * only in capitalisation embeds to the same place and costs a full search.
 */
export function dedupeQueries(original: string, suggestions: string[]): string[] {
  const seen = new Set([original.toLowerCase()]);
  const queries = [original];

  for (const suggestion of suggestions ?? []) {
    const trimmed = typeof suggestion === 'string' ? suggestion.trim() : '';
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    queries.push(trimmed);
    if (queries.length >= MAX_QUERIES) break;
  }

  return queries;
}
