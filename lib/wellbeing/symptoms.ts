import { normalizeSymptom } from './scale';

/**
 * Keeping one symptom to one label.
 *
 * A frequency chart is only worth drawing if the same complaint lands on the
 * same label every time. Left alone it does not: each check-in names things
 * fresh, so "головний біль", "болить голова" and "головного болю" become three
 * rows that each occurred once, and the chart reports that nothing ever recurs
 * — which is exactly backwards.
 *
 * Matching is therefore done against the labels the user has already used, on a
 * key rather than the text. The key is deliberately crude: Ukrainian inflects
 * heavily, and a symptom vocabulary is a few dozen short noun phrases, not a
 * corpus. Nothing here is ever displayed — the display name is always one the
 * user's own check-in produced.
 */

/** Function words that carry no identity: "біль у горлі" is the same complaint as "біль горла". */
const STOPWORDS = new Set([
  'у', 'в', 'на', 'і', 'й', 'та', 'з', 'із', 'зі', 'до', 'від', 'при',
  'після', 'по', 'за', 'the', 'a', 'of', 'in',
]);

/**
 * Inflectional endings, longest first. Verb endings are included because a
 * symptom gets reported both ways — "болить голова" and "головний біль" are one
 * thing said twice.
 */
const ENDINGS = [
  'ього', 'ими', 'ому', 'ими', 'ити', 'ати', 'ять', 'ить', 'ать',
  'ого', 'ій', 'ий', 'их', 'ім', 'ем', 'ам', 'ах', 'ям', 'ях', 'ої', 'ою', 'ею', 'ів',
  'я', 'ю', 'і', 'и', 'е', 'а', 'о', 'у', 'й', 'ь',
];

/**
 * A token reduced to something two grammatical forms of it can share.
 *
 * Three steps, each earning its place:
 *  - strip one inflectional ending ("голови", "голові", "голова" → "голов");
 *  - strip a trailing adjectival -н- ("головн" → "голов"), so the adjective and
 *    the noun it derives from meet;
 *  - fold і→о, which is the closed-syllable alternation ("біль" / "болю") and
 *    the only reason those two would otherwise never match.
 *
 * That last step is the one that can overreach — "білий" also folds onto "бол".
 * It is tolerated because a match requires *every* token of the label to agree,
 * so a collision needs the whole phrase to collide, and because bare adjectives
 * are not valid symptom labels in the first place.
 */
export function stemToken(token: string): string {
  let stem = token;

  for (const ending of ENDINGS) {
    if (stem.endsWith(ending) && stem.length - ending.length >= 3) {
      stem = stem.slice(0, -ending.length);
      break;
    }
  }

  if (stem.length >= 5 && stem.endsWith('н')) {
    stem = stem.slice(0, -1);
  }

  return stem.replace(/і/g, 'о');
}

/**
 * The identity of a symptom label: its stems, sorted.
 *
 * Sorted because word order is not a distinction here — "біль голови" and
 * "головний біль" are the same complaint, and a user who says it both ways is
 * not tracking two things.
 */
export function symptomKey(label: string): string {
  return normalizeSymptom(label)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token))
    .map(stemToken)
    .filter(Boolean)
    .sort()
    .join(' ');
}

/**
 * `label` expressed in the user's existing vocabulary, when it is already in it.
 *
 * Returns the previously used spelling on a match, so the chart keeps one bar
 * instead of gaining one; returns the label normalised but otherwise untouched
 * when it is genuinely new. Never invents a name.
 */
export function canonicalizeSymptom(label: string, known: string[]): string {
  const key = symptomKey(label);
  if (!key) return normalizeSymptom(label);

  const match = known.find((candidate) => symptomKey(candidate) === key);
  return match ? normalizeSymptom(match) : normalizeSymptom(label);
}

export type Canonicalization = { from: string; to: string };

/**
 * A whole check-in's symptoms, canonicalised and de-duplicated by identity.
 *
 * De-duplication is on the key, not the text: a model that offers both
 * "головний біль" and "болить голова" in one call means one symptom, and
 * storing both would double-count that day.
 */
export function canonicalizeSymptoms(
  incoming: string[] | undefined | null,
  known: string[]
): { symptoms: string[]; changed: Canonicalization[] } {
  if (!incoming?.length) return { symptoms: [], changed: [] };

  const symptoms: string[] = [];
  const changed: Canonicalization[] = [];
  const seen = new Set<string>();

  for (const raw of incoming) {
    const normalized = normalizeSymptom(raw);
    if (!normalized) continue;

    const key = symptomKey(normalized) || normalized;
    if (seen.has(key)) continue;
    seen.add(key);

    // Already-accepted labels join the vocabulary, so two spellings inside one
    // call collapse onto the first rather than both surviving.
    const canonical = canonicalizeSymptom(normalized, [...known, ...symptoms]);

    symptoms.push(canonical);
    if (canonical !== normalized) changed.push({ from: normalized, to: canonical });
  }

  return { symptoms, changed };
}
