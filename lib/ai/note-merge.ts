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
 * Words too common to prove anything by their presence.
 *
 * An anchor is checked by its content words; matching on "for" or "від" would
 * pass a rewrite that kept the grammar and lost the fact.
 *
 * The words for the account holder are here for a different reason. A fact
 * about them is extracted with a *placeholder* subject — extraction is told to
 * write the word for "user" in the message's language rather than a name — and
 * that word is almost never what the note itself says, which names them or
 * simply speaks in the first person. This was invisible while notes were
 * written in English and the summary opened "User requests…", so the anchor
 * "user" happened to be present; once notes are written in the language the
 * user typed, that coincidence is gone and every fact about them would read as
 * dropped, rejecting every rewrite and turning merging silently back into
 * appending. The object of such a fact is the part carrying information, and it
 * still has to survive.
 */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'of', 'for', 'from', 'to', 'in', 'on', 'at', 'by', 'with',
  'and', 'or', 'is', 'are', 'was', 'were', 'be', 'been', 'has', 'have', 'had',
  'it', 'its', 'his', 'her', 'their',
  'і', 'й', 'та', 'в', 'у', 'на', 'з', 'із', 'до', 'від', 'для', 'про', 'що',
  'як', 'це',
  // The account holder, however extraction spelled them this time.
  'user', 'me', 'myself', 'користувач', 'користувачка', 'юзер', 'пользователь',
]);

/** The content words of an anchor, in no particular order. */
function anchorTokens(anchor: string): string[] {
  return anchor
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token));
}

/**
 * Is this fact still in the text?
 *
 * Subject and object are checked, never the predicate: "was born on" may
 * legitimately become "birthday", but if "Андрій" or "04.12.1985" has gone,
 * the fact has gone with it. Very short values are skipped — a one-character
 * object matches everything and would make the check meaningless.
 *
 * The anchors are matched word by word rather than as one string. Whole-string
 * matching only ever passed because the note being checked *contained the fact
 * list verbatim* — `formatStructuredContent` used to append every fact as
 * prose, so "medical certificate from pediatrician for Artem" was findable in
 * the note as exactly that. With those restatements gone the anchor has to be
 * recognised in the summary that carries it, where the same fact is written
 * "a medical certificate from a pediatrician for her child, Artem" — every
 * content word present, not one contiguous run. Matching the string would now
 * reject every rewrite and quietly turn merging into appending, which is how a
 * note starts repeating itself again.
 *
 * A long token is matched without its last character, because the merge prompt
 * asks for the note's own language and Ukrainian inflects: "Андрій" is written
 * "Андрія" wherever the sentence needs it, and neither string contains the
 * other. One character is the whole concession — it covers the single-ending
 * case a rewrite produces, and it is far short of a stemmer, which this check
 * does not need: it only has to catch a name or a date dropped outright.
 */
function stemForMatching(token: string): string {
  return token.length >= 5 ? token.slice(0, -1) : token;
}

function factSurvives(fact: NoteFact, haystack: string): boolean {
  const anchors = [fact.subject, fact.object]
    .map((part) => (part ?? '').trim().toLowerCase())
    .filter((part) => part.length >= 2);

  if (anchors.length === 0) return true;

  return anchors.every((anchor) => {
    const tokens = anchorTokens(anchor);
    // Nothing but stopwords and single characters: unprovable either way, and
    // calling it lost would reject rewrites over an anchor that says nothing.
    if (tokens.length === 0) return true;
    return tokens.every((token) => haystack.includes(stemForMatching(token)));
  });
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
export const __test = { factSurvives, normalize, anchorTokens };
