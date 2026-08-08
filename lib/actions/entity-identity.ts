/**
 * Deciding when two written names are one person.
 *
 * Pure and dependency-free, because everything here is a judgement call that
 * has to be testable in isolation — and because nothing in it is allowed to
 * cost a token. The model is not asked; the user is, and only about pairs this
 * file has already put in front of them.
 *
 * The bias is deliberate and one-directional: **over-suggest, never
 * auto-merge.** A pair that is offered and declined costs one click; a pair
 * that is never offered stays split forever and quietly halves every search.
 * So the folding below is lossy on purpose.
 */

/**
 * Cyrillic → Latin, one letter at a time.
 *
 * Not a transliteration standard — those disagree with each other exactly where
 * this needs them to agree. Ukrainian "й" is `i` in one standard and `y` in
 * another, which is precisely how "Андрій" and "Andriy" ended up as two nodes.
 * The output is fed to `fold`, which collapses that distinction anyway.
 */
const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'h', ґ: 'g', д: 'd', е: 'e', є: 'ie', ж: 'zh',
  з: 'z', и: 'y', і: 'i', ї: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n',
  о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts',
  ч: 'ch', ш: 'sh', щ: 'sch', ь: '', ю: 'iu', я: 'ia',
  // Russian letters that Ukrainian lacks, since notes arrive in both.
  ё: 'e', ъ: '', ы: 'y', э: 'e',
};

/** Matching key: case and stray whitespace must not fork a node. */
export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * A deliberately lossy key for *suggesting* that two names are the same.
 *
 * Never use it as a storage key — it maps genuinely different names together
 * often enough that only a person should act on it.
 */
export function fold(name: string): string {
  const latin = normalizeName(name)
    .split('')
    .map((ch) => CYRILLIC_TO_LATIN[ch] ?? ch)
    .join('');

  return (
    latin
      // A hyphen joins two name parts, so it becomes the space it stands for —
      // deleting it would make "Anna-Maria" and "Anna Maria" different keys.
      .replace(/[-–—]/g, ' ')
      // An apostrophe sits inside a word ("O'Brien"), so it just goes.
      .replace(/[^a-z0-9 ]/g, '')
      // The whole point: y, j and i are one sound spelled three ways.
      .replace(/[yj]/g, 'i')
      // "Filipp" and "Filip", "Anna" and "Ana".
      .replace(/(.)\1+/g, '$1')
      .trim()
      .replace(/\s+/g, ' ')
  );
}

/** Folded tokens, for comparing "Yana" against "Yana Kozlova". */
function tokens(name: string): string[] {
  return fold(name).split(' ').filter(Boolean);
}

export type MatchReason = 'same-spelling' | 'same-sound' | 'contained';

/**
 * Why two names might be one person, or null when they probably are not.
 *
 * `contained` is the "Yana" ⊂ "Yana Kozlova" case, and it is restricted to a
 * *prefix* of the tokens rather than any subset: a shared surname is not
 * evidence of anything, and "Andriy Kovalenko" against "Olena Kovalenko" must
 * not be offered as one person.
 */
export function matchNames(a: string, b: string): MatchReason | null {
  if (normalizeName(a) === normalizeName(b)) return 'same-spelling';

  const foldedA = fold(a);
  const foldedB = fold(b);
  if (!foldedA || !foldedB) return null;
  if (foldedA === foldedB) return 'same-sound';

  const tokensA = tokens(a);
  const tokensB = tokens(b);
  const [shorter, longer] =
    tokensA.length <= tokensB.length ? [tokensA, tokensB] : [tokensB, tokensA];

  // A single given name inside a fuller one. Both must start the same way.
  if (shorter.length > 0 && shorter.length < longer.length) {
    const isPrefix = shorter.every((token, i) => token === longer[i]);
    if (isPrefix) return 'contained';
  }

  return null;
}

/**
 * A name worth making a node of.
 *
 * The model occasionally returns a fragment rather than a thing — a bare
 * preposition, a whole clause. Neither makes a useful node, and both pollute
 * the list permanently. The same bounds apply to a name typed by hand, so the
 * rule lives here rather than beside either caller.
 */
export function isUsableName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length >= 2 && trimmed.length <= 120 && /\p{L}/u.test(trimmed);
}

/**
 * What renaming a node to a given name actually changes.
 *
 * Two cases that look alike and are not. A *respell* keeps the identity
 * `(user_id, normalized_name, type)` and only changes the spelling on screen —
 * it cannot collide with anything, because the row already occupies that
 * identity. A *rename* moves the row to a new identity, which can collide with
 * an existing node and therefore has to be checked against the database first.
 *
 * Both write an alias, and that is the point of doing this at all: the display
 * name is "as last written by the model", so an edit that only touched the
 * column would be overwritten by the next note mentioning it.
 */
export type RenamePlan =
  | { kind: 'invalid'; message: string }
  | { kind: 'unchanged' }
  | { kind: 'respell'; name: string; normalizedName: string }
  | { kind: 'rename'; name: string; normalizedName: string };

export function planRename(current: { name: string; normalizedName: string }, requested: string): RenamePlan {
  const name = requested.trim();

  if (!isUsableName(name)) {
    return {
      kind: 'invalid',
      message: 'A name needs at least two characters, one of them a letter, and at most 120.',
    };
  }

  if (name === current.name) return { kind: 'unchanged' };

  const normalizedName = normalizeName(name);

  return normalizedName === current.normalizedName
    ? { kind: 'respell', name, normalizedName }
    : { kind: 'rename', name, normalizedName };
}

/** Names the model uses for the account holder rather than for a person. */
const SELF_WORDS = new Set([
  'user',
  'the user',
  'me',
  'myself',
  'користувач',
  'користувачка',
  'юзер',
  'я',
  'пользователь',
]);

/**
 * The account holder's own name, whatever the model called them this time.
 *
 * Extraction has no idea whose knowledge base it is writing into, so it names
 * the user however the sentence did — "User", "Яна", "Yana Kozlova" — and each
 * spelling became its own node. Three of the five nodes in the first real graph
 * were the owner. This is not a judgement call worth a click: the signed-in
 * name is known, so self-references are collapsed automatically.
 */
export function resolveSelfName(name: string, selfName: string | null | undefined): string {
  if (!selfName) return name;

  const normalized = normalizeName(name);
  if (SELF_WORDS.has(normalized)) return selfName;

  return matchNames(name, selfName) ? selfName : name;
}
