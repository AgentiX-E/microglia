/**
 * Lexical similarity and BM25.
 *
 * Embeddings are optional in Microglia, so retrieval must have a competent
 * lexical path rather than a placeholder one. BM25 is implemented here because
 * the index lives in `@agentix-e/microglia-memory` and the scoring function is
 * pure; keeping it in core makes it testable without a store.
 */

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'in', 'is', 'it', 'of',
  'on', 'or', 'that', 'the', 'to', 'was', 'were', 'will', 'with', 'what', 'which', 'when', 'how',
  'do', 'does', 'i', 'we', 'you', 'my', 'our', 'me', 'this', 'these', 'those', 'there', 'their',
]);

export function tokenize(text: string): string[] {
  const normalised = text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u0000-\u001f\u007f]/g, ' ');
  const raw = normalised.match(/[\p{L}\p{N}_]+/gu) ?? [];
  const tokens: string[] = [];
  for (const token of raw) {
    if (token.length === 1 && !/\d/.test(token)) continue;
    if (STOPWORDS.has(token)) continue;
    tokens.push(token);
  }
  return tokens;
}

/** Sørensen–Dice over token sets; symmetric and bounded, unlike raw overlap. */
export function diceSimilarity(a: string, b: string): number {
  const left = new Set(tokenize(a));
  const right = new Set(tokenize(b));
  if (left.size === 0 && right.size === 0) return 1;
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return (2 * shared) / (left.size + right.size);
}

export function jaccardSimilarity(a: string, b: string): number {
  const left = new Set(tokenize(a));
  const right = new Set(tokenize(b));
  if (left.size === 0 && right.size === 0) return 1;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / (left.size + right.size - shared);
}

export type Bm25Options = {
  readonly k1?: number;
  readonly b?: number;
};

/**
 * BM25 score for one document against a query.
 *
 * `averageLength` and `documentFrequency` are supplied by the index because they
 * are corpus statistics; this function stays pure so it can be property-tested.
 */
export function bm25Score(
  queryTokens: readonly string[],
  documentTokens: readonly string[],
  documentLength: number,
  averageLength: number,
  documentFrequency: (token: string) => number,
  documentCount: number,
  options: Bm25Options = {},
): number {
  const k1 = options.k1 ?? 1.2;
  const b = options.b ?? 0.75;
  if (documentTokens.length === 0 || queryTokens.length === 0) return 0;
  const frequencies = new Map<string, number>();
  for (const token of documentTokens) {
    frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
  }
  let score = 0;
  const seen = new Set<string>();
  for (const token of queryTokens) {
    if (seen.has(token)) continue;
    seen.add(token);
    const tf = frequencies.get(token) ?? 0;
    if (tf === 0) continue;
    const df = documentFrequency(token);
    const idf = Math.log(1 + (documentCount - df + 0.5) / (df + 0.5));
    const lengthNorm = 1 - b + b * (documentLength / Math.max(1, averageLength));
    score += idf * ((tf * (k1 + 1)) / (tf + k1 * lengthNorm));
  }
  return score;
}

/**
 * Maximal marginal relevance: relevance minus redundancy against what is
 * already selected. Without this, five paraphrases of one correction crowd out
 * the one constraint that would have changed the answer.
 */
export function mmrSelect<T>(
  candidates: readonly { item: T; relevance: number; text: string }[],
  limit: number,
  lambda = 0.7,
): T[] {
  const pool = [...candidates].sort((a, b) => b.relevance - a.relevance);
  const selected: typeof pool = [];
  while (pool.length > 0 && selected.length < limit) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < pool.length; i += 1) {
      const candidate = pool[i] as (typeof pool)[number];
      let redundancy = 0;
      for (const chosen of selected) {
        redundancy = Math.max(redundancy, diceSimilarity(candidate.text, chosen.text));
      }
      const score = lambda * candidate.relevance - (1 - lambda) * redundancy;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
    selected.push(pool.splice(bestIndex, 1)[0] as (typeof pool)[number]);
  }
  return selected.map((entry) => entry.item);
}
