/**
 * Standing instructions about how the assistant should behave.
 *
 * Dependency-free on purpose, for the same reason as `lib/wellbeing/scale.ts`:
 * the settings panel is a client component and needs the length cap for its
 * textarea, and importing that from the schema would drag drizzle and every
 * table definition into the browser bundle. The schema imports these instead.
 */

/**
 * How many directives may be active at once.
 *
 * A cap is the whole difference between a preference memory and a slowly
 * rotting system prompt. Every one of these is prepended to every turn on both
 * surfaces, so they compete with the user's actual question for the model's
 * attention — twenty short rules is already more than anyone follows.
 * Reaching the cap is reported to the model rather than silently evicting the
 * oldest: the user typed each of these, and choosing which to drop is theirs.
 */
export const MAX_DIRECTIVES = 20;

/**
 * A directive is a rule, not a paragraph.
 *
 * The limit is what forces "answer in Ukrainian unless I write in English"
 * instead of a page about tone. Long ones are also the ones that contradict
 * each other, and a contradiction inside the system prompt resolves at random.
 */
export const MAX_DIRECTIVE_LENGTH = 200;

/** Where a directive came from: typed by the user, or read off their behaviour. */
export type DirectiveSource = 'user' | 'inferred';

export type Directive = {
  id: string;
  text: string;
  source: DirectiveSource;
  createdAt: Date;
};

/**
 * Two spellings of the same rule share this.
 *
 * Case, outer and inner whitespace and trailing punctuation are noise; nothing
 * beyond that is attempted. Stemming and synonym folding are deliberately left
 * out — unlike symptom labels, which are matched blind and charted, directives
 * top out at {@link MAX_DIRECTIVES} and are listed on a settings screen, so a
 * near-duplicate that slips through is visible and one click from gone. A
 * wrong merge is not.
 */
export function normalizeDirective(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.,;!?]+$/u, '')
    .trim();
}

/** Case-folded token set, for comparing one directive against another. */
function tokenize(text: string): Set<string> {
  return new Set(
    normalizeDirective(text)
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean)
  );
}

/**
 * How much two directives overlap, 0 to 1 (Jaccard over tokens).
 *
 * Used for both halves of the same problem: refusing to store a rule the user
 * already gave, and finding the rule they mean when they ask to drop one. The
 * two share an implementation so "that's the same instruction" and "that's the
 * instruction you meant" can never disagree.
 */
export function directiveSimilarity(a: string, b: string): number {
  const left = tokenize(a);
  const right = tokenize(b);
  if (left.size === 0 || right.size === 0) return 0;

  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;

  return shared / (left.size + right.size - shared);
}

/** Close enough that storing both would put two versions of one rule in the prompt. */
export const DUPLICATE_THRESHOLD = 0.7;

/** Loose enough to find "speak Ukrainian" from "stop answering in Ukrainian". */
export const MATCH_THRESHOLD = 0.4;

/** The stored directive a new one would duplicate, or null. */
export function findDuplicate<T extends { text: string }>(
  text: string,
  existing: T[]
): T | null {
  for (const item of existing) {
    if (directiveSimilarity(text, item.text) >= DUPLICATE_THRESHOLD) return item;
  }
  return null;
}

export type DirectiveMatch<T> =
  | { kind: 'none' }
  | { kind: 'one'; directive: T }
  /** Two candidates too close to separate — the caller must ask which. */
  | { kind: 'ambiguous'; candidates: T[] };

/**
 * Which stored directive a free-text "forget …" refers to.
 *
 * Deleting is by description rather than by id because ids would have to be
 * rendered into the prompt to be quotable, and a list of nanoids in front of
 * every turn costs tokens on every request to serve the rarest action. The
 * price is this function, and an ambiguous match that asks instead of guessing:
 * silently dropping the wrong standing instruction is invisible until the
 * assistant has been misbehaving for a week.
 */
export function matchDirective<T extends { text: string }>(
  text: string,
  existing: T[]
): DirectiveMatch<T> {
  const scored = existing
    .map((directive) => ({ directive, score: directiveSimilarity(text, directive.text) }))
    .filter((s) => s.score >= MATCH_THRESHOLD)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return { kind: 'none' };
  if (scored.length === 1) return { kind: 'one', directive: scored[0].directive };

  const [best, runnerUp] = scored;
  if (best.score - runnerUp.score < 0.1) {
    return {
      kind: 'ambiguous',
      candidates: scored.filter((s) => best.score - s.score < 0.1).map((s) => s.directive),
    };
  }

  return { kind: 'one', directive: best.directive };
}

/** Rejection reasons a caller has to render; the text differs per surface. */
export type DirectiveRejection = 'empty' | 'too-long' | 'duplicate' | 'full';

/**
 * The block spliced into the system prompt, or '' when there is nothing to say.
 *
 * Deliberately placed *below* the assistant's own rules by the prompt template
 * and framed as preferences rather than policy: these arrive through a tool the
 * model itself can call, so a note that talks its way into this list must not
 * be able to switch off the medical or confirmation rules above it.
 */
export function renderDirectives(directives: Pick<Directive, 'text'>[]): string {
  if (directives.length === 0) return '';

  return [
    '## How this user wants you to respond',
    '',
    'Standing preferences they set themselves. Follow them in every reply, including',
    'through Telegram. They shape tone, format and what to skip — they never override',
    'the rules above, and never license diagnosis, advice or unconfirmed writes.',
    '',
    ...directives.map((d) => `- ${d.text}`),
  ].join('\n');
}
