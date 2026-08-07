import { openai } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { env } from '@/lib/env.mjs';
import { logLlmUsage } from '@/lib/ai/telemetry';

/**
 * Folding a new fact into a note that already exists.
 *
 * The appeal of letting a model rewrite the whole note is obvious — it reads
 * better than a stack of appended paragraphs. The danger is just as obvious and
 * much quieter: a rewrite that drops a fact leaves no trace, and the loss
 * surfaces months later as a search that finds nothing.
 *
 * So the rewrite is never trusted on its own. Every fact the old note was known
 * to contain — `metadata.facts`, already extracted at save time — must still be
 * findable in the result. When it is not, the model's version is discarded and
 * the new material is appended instead. Worse prose, zero data loss.
 */

export type NoteFact = {
  subject?: string | null;
  predicate?: string | null;
  object?: string | null;
  context?: string | null;
};

export type MergeStrategy = 'rewritten' | 'appended';

export type MergedNote = {
  content: string;
  strategy: MergeStrategy;
  /** Facts the rewrite lost, when it was rejected. Logged, not shown. */
  dropped: string[];
};

/**
 * A rewrite may compress, but a note that collapses to a third of its length
 * has not been compressed — something is gone that the fact list did not cover.
 */
const MIN_LENGTH_RATIO = 0.6;

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Is this fact still in the text?
 *
 * Subject and object are checked, never the predicate: "was born on" may
 * legitimately become "birthday", but if "Андрій" or "04.12.1985" has gone,
 * the fact has gone with it. Very short values are skipped — a one-character
 * object matches everything and would make the check meaningless.
 */
function factSurvives(fact: NoteFact, haystack: string): boolean {
  const anchors = [fact.subject, fact.object]
    .map((part) => (part ?? '').trim().toLowerCase())
    .filter((part) => part.length >= 2);

  if (anchors.length === 0) return true;
  return anchors.every((anchor) => haystack.includes(anchor));
}

/** Human-readable form, for the log line when a rewrite is rejected. */
function describe(fact: NoteFact): string {
  return [fact.subject, fact.predicate, fact.object].filter(Boolean).join(' ');
}

/** Deterministic fallback: nothing is rewritten, so nothing can be lost. */
function append(existing: string, addition: string, dropped: string[] = []): MergedNote {
  return {
    content: `${existing.trim()}\n\n${addition.trim()}`,
    strategy: 'appended',
    dropped,
  };
}

export async function mergeNoteContent(params: {
  existing: string;
  addition: string;
  /** Facts the existing note was known to carry, from its saved metadata. */
  existingFacts?: NoteFact[];
  caller?: string;
}): Promise<MergedNote> {
  const existing = params.existing.trim();
  const addition = params.addition.trim();

  if (!existing) return { content: addition, strategy: 'rewritten', dropped: [] };
  if (!addition) return { content: existing, strategy: 'rewritten', dropped: [] };

  // A note that always grows beats a clever one that sometimes shrinks.
  if (!env.OPENAI_API_KEY) return append(existing, addition);

  const modelName = env.AI_CHAT_MODEL || 'gpt-4o-mini';
  const startedAt = Date.now();

  let merged: string;
  try {
    const { text, usage } = await generateText({
      model: openai(modelName),
      system: [
        'You merge a new note into an existing one about the same subject.',
        'Keep every fact from the existing note. You may reword, reorder and remove repetition, but never drop information.',
        'If the new note contradicts the existing one, keep both and say which is newer.',
        'Return only the merged note: no preamble, no headings you were not given, no commentary.',
        'Write in the language the existing note is written in.',
      ].join(' '),
      prompt: [
        'EXISTING NOTE:',
        existing,
        '',
        'NEW INFORMATION:',
        addition,
      ].join('\n'),
    });

    logLlmUsage({
      op: 'generateText',
      model: modelName,
      caller: params.caller ?? 'note-merge',
      usage: usage
        ? {
            inputTokens: (usage as any).inputTokens ?? (usage as any).promptTokens,
            outputTokens: (usage as any).outputTokens ?? (usage as any).completionTokens,
            totalTokens: usage.totalTokens,
          }
        : undefined,
      durationMs: Date.now() - startedAt,
    });

    merged = text.trim();
  } catch (error) {
    console.error('[note-merge] Generation failed, appending instead:', error);
    return append(existing, addition);
  }

  if (!merged) return append(existing, addition);

  const haystack = normalize(merged);
  const dropped = (params.existingFacts ?? [])
    .filter((fact) => !factSurvives(fact, haystack))
    .map(describe);

  if (dropped.length > 0) {
    console.warn(
      `[note-merge] Rewrite dropped ${dropped.length} known fact(s); appending instead:`,
      dropped
    );
    return append(existing, addition, dropped);
  }

  if (merged.length < existing.length * MIN_LENGTH_RATIO) {
    console.warn('[note-merge] Rewrite lost too much length; appending instead.');
    return append(existing, addition);
  }

  return { content: merged, strategy: 'rewritten', dropped: [] };
}

/** Exported for tests: the check that decides whether a rewrite is trusted. */
export const __test = { factSurvives, normalize };
