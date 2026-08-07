/**
 * Ranking rules for hybrid retrieval, kept pure so they can be tested without
 * a database or an embedding call.
 *
 * Search runs two independent retrievers over the same chunks — one semantic
 * (pgvector, cosine), one lexical (Postgres full text) — and fuses their
 * rankings. Neither is redundant: the vector half finds a paraphrase that
 * shares no words with the query, the lexical half finds the invoice number,
 * the surname, the library version. Fusing them is what makes an exact match
 * reachable when the embedding does not happen to rank it.
 */

/**
 * How much of a token to keep before the prefix wildcard.
 *
 * Postgres has no Ukrainian stemmer and the base is Ukrainian and English in
 * one column, so the index is built with the 'simple' config, which stems
 * nothing. Ukrainian inflects at the suffix — "Марта", "Марті", "Марту" are
 * one name — and a whole-token match finds none of the others. Truncating to a
 * prefix and matching with `:*` is the substitute: it is not a stemmer, but it
 * collapses exactly the endings that a stemmer would.
 *
 * The truncation is deliberately shallow. This retriever generates candidates
 * that fusion then ranks; an over-eager prefix costs a few extra rows, while a
 * too-strict one costs the match entirely.
 */
const MIN_PREFIX_LENGTH = 4;
const PREFIX_RATIO = 0.75;

/** Tokens shorter than this carry no retrieval signal and match half the base. */
const MIN_TOKEN_LENGTH = 2;

/** A tsquery can only carry so many terms before it stops being selective. */
const MAX_QUERY_TERMS = 12;

/**
 * Words that must never reach the lexical query.
 *
 * `ts_rank_cd` has no notion of IDF — it counts occurrences and weighs their
 * proximity, so a term appearing in every chunk is not discounted for it. With
 * the terms OR'd together, one function word is enough to put the whole base in
 * the candidate list, ranked by how often each chunk happens to say "за". The
 * chunk that actually holds the rare term is then one of thousands, and the
 * `LIMIT` cuts it off before fusion ever sees it.
 *
 * The prefix wildcard makes it worse than it sounds: "за" is not a word here,
 * it is `за:*`, which matches "завтра", "заняття", "записати", "зателефонувати".
 * A two-letter stopword with a wildcard is a query for everything.
 *
 * Shared with `heuristicVariations` in query-expansion, so that "not a content
 * word" means one thing in this codebase rather than two.
 */
export const STOPWORDS = new Set([
  // English
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with',
  'is', 'are', 'was', 'were', 'be', 'been', 'am', 'do', 'does', 'did', 'have', 'has', 'had',
  'what', 'when', 'where', 'who', 'whom', 'why', 'how', 'which', 'that', 'this', 'these', 'those',
  'about', 'from', 'into', 'over', 'my', 'me', 'i', 'you', 'your', 'it', 'its', 'we', 'our',
  'not', 'no', 'yes', 'can', 'could', 'would', 'should', 'will', 'shall', 'may', 'might',
  // Ukrainian
  'що', 'як', 'де', 'коли', 'хто', 'кого', 'чому', 'чий', 'який', 'яка', 'яке', 'які',
  'мій', 'моя', 'моє', 'мої', 'мене', 'мені', 'мною', 'я', 'ти', 'ви', 'він', 'вона', 'воно', 'вони',
  'це', 'цей', 'ця', 'той', 'та', 'те', 'ті', 'все', 'всі', 'весь', 'вся',
  'у', 'в', 'на', 'до', 'з', 'зі', 'із', 'за', 'по', 'про', 'від', 'для', 'над', 'під', 'при', 'без',
  'і', 'й', 'а', 'але', 'чи', 'бо', 'щоб', 'якщо', 'ще', 'вже', 'теж', 'також',
  'не', 'ні', 'так', 'є', 'був', 'була', 'було', 'були', 'буде', 'бути',
  'мати', 'маю', 'маєш', 'має', 'мене', 'себе', 'соб',
]);

/**
 * The tsquery term for one token, wildcarded only where a wildcard can help.
 *
 * Truncation is what makes the wildcard useful: "спортзалі" cut to "спортз:*"
 * also finds "спортзал". A token at or under `MIN_PREFIX_LENGTH` loses nothing
 * to truncation, so `:*` on it cannot reach a single inflected form — Ukrainian
 * inflects at the final character, and that character is inside the prefix.
 * "рука:*" matches "рукав" and "рукавиця"; it does not match "руки" or "руці",
 * which are the words it was meant to find. All the wildcard buys there is
 * noise, so short tokens go in as themselves.
 */
function termFor(token: string): string {
  if (token.length <= MIN_PREFIX_LENGTH) return token;
  const cut = Math.max(MIN_PREFIX_LENGTH, Math.ceil(token.length * PREFIX_RATIO));
  return `${token.slice(0, cut)}:*`;
}

/**
 * Turn a user question into a `to_tsquery` string of OR'd prefix terms.
 *
 * OR rather than AND: this is the recall side of the pair. Requiring every
 * term reproduces the failure mode being fixed — a chunk that holds the one
 * word that matters gets excluded because it lacks the other four. Ranking
 * inside the list, and fusion outside it, sort out which of the matches is
 * worth returning.
 *
 * Everything that is not a letter or a digit is dropped rather than escaped.
 * tsquery has its own operator syntax (`&`, `|`, `!`, `:`, parentheses) and a
 * user question is not written in it — a stray `!` would either error or
 * silently invert the query. Nothing here reaches SQL as text in any case: the
 * result is passed as a bound parameter.
 *
 * Returns null when nothing usable survives, which is the signal to skip the
 * lexical retriever entirely rather than run a query matching everything. A
 * question built entirely of function words — "що в мене?" — is exactly that
 * case: there is no exact match to look for, the vector half answers it, and
 * running the lexical half anyway would hand fusion a ranking of whichever
 * chunks repeat "мене" the most.
 */
export function toTsQuery(query: string): string | null {
  const tokens = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= MIN_TOKEN_LENGTH && !STOPWORDS.has(t));

  if (tokens.length === 0) return null;

  const seen = new Set<string>();
  const terms: string[] = [];
  for (const token of tokens) {
    const term = termFor(token);
    if (seen.has(term)) continue;
    seen.add(term);
    terms.push(term);
  }

  // When there are more terms than the query can carry, keep the longest.
  // The cap used to cut by position, which drops the end of a long question —
  // and in both languages here the end of a question is where its specific noun
  // sits ("скільки я плачу за абонемент у спортзалі"). Length is a crude stand-in
  // for rarity, but it is the right crude one: the long words are the nouns.
  if (terms.length > MAX_QUERY_TERMS) {
    const kept = new Set(
      [...terms].sort((a, b) => b.length - a.length).slice(0, MAX_QUERY_TERMS)
    );
    // Emitted in the order they were said, so a logged query still reads.
    return terms.filter((t) => kept.has(t)).join(' | ');
  }

  return terms.join(' | ');
}

/**
 * Reciprocal rank fusion.
 *
 * The two retrievers return scores that cannot be compared — a cosine
 * similarity and a `ts_rank_cd` live on different scales, and normalising them
 * against each other means inventing a conversion that changes with every
 * query. RRF sidesteps that by using only the position a document reached in
 * each list, which is why it is the standard way to combine retrievers.
 *
 * `RRF_K` damps the top of each list: without it, rank 1 would be worth many
 * times rank 2 and a single confident retriever would decide every query. At
 * 60 (the value from the original paper) the first few ranks are close
 * together, so a document both retrievers like beats one that only one of them
 * ranked first — which is the entire point of fusing.
 */
const RRF_K = 60;

export function fuseByRrf<T>(lists: T[][], keyOf: (item: T) => string): Map<string, number> {
  const scores = new Map<string, number>();

  for (const list of lists) {
    list.forEach((item, index) => {
      const key = keyOf(item);
      const contribution = 1 / (RRF_K + index + 1);
      scores.set(key, (scores.get(key) ?? 0) + contribution);
    });
  }

  return scores;
}

/**
 * How much fresher notes are favoured, and how fast that fades.
 *
 * A second brain is not a library: "where do I live", "what am I working on",
 * "what did I decide about X" all have a current answer and several stale ones,
 * and the stale ones are often worded more like the question because that is
 * the note that first introduced the topic. Nothing in cosine distance knows
 * which came last.
 *
 * The weight is small on purpose — about a quarter of what a first-place
 * finish in one retriever contributes. It settles near-ties in favour of the
 * newer note and never overturns a clearly better match, because "recent" is
 * evidence about relevance, not a substitute for it.
 */
const RECENCY_WEIGHT = 0.004;
const RECENCY_HALF_LIFE_DAYS = 180;

export function recencyBoost(createdAt: Date | string | null | undefined, now: Date = new Date()): number {
  if (!createdAt) return 0;
  const created = createdAt instanceof Date ? createdAt : new Date(createdAt);
  const ms = created.getTime();
  if (!Number.isFinite(ms)) return 0;

  const ageDays = (now.getTime() - ms) / 86_400_000;
  // A clock skew or a future-dated row should not earn more than "today".
  const decay = Math.pow(0.5, Math.max(0, ageDays) / RECENCY_HALF_LIFE_DAYS);
  return RECENCY_WEIGHT * decay;
}
