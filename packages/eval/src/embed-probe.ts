/**
 * Does *any* retrieval signal separate a rule that helped from one that hurt?
 *
 * The lexical one does not, and the measurement is unambiguous: on the BIRD
 * artefact, the rules credited with a hurt have a median word coverage of **0.133**
 * against a question, and the rules credited with a help have **0.130**. Identifiers
 * fare worse — 0.000 for both. That is why the coverage gate recovered 0.29pp of a
 * 4.00pp cost: a keyword threshold is not a weak relevance signal here, it is no
 * signal at all.
 *
 * Before rebuilding recall around embeddings — which is what ReasoningBank, A-MEM
 * and MemHarness all do — the same question has to be asked of the embedding. If
 * cosine similarity also fails to separate the two sets, the problem is not the
 * retriever and no amount of architecture will fix it.
 *
 * This file is the pure half: the attribution recomputation and the comparison. The
 * CLI is `bin/embed-probe.ts`, which supplies the vectors.
 */
import type { KnowledgeItem } from '@agentix-e/microglia-core';

export type CaseRecord = {
  readonly question: string;
  readonly correct: boolean;
  readonly withoutMemoryCorrect: boolean;
  readonly packIdList: readonly string[];
};

export type Credited = {
  /** Rules whose net effect on held-out questions was negative. */
  readonly hurt: readonly string[];
  /** Rules whose net effect was positive. */
  readonly helped: readonly string[];
  readonly neutral: readonly string[];
};

/**
 * Attribute flips to the rules that were in context, one credit per flip.
 *
 * This is the coarse reading the lane's own attribution uses: a question that only
 * the memory arm got wrong credits every rule in its pack, because with a pack of
 * two there is no way to separate them from outcome alone. It is deliberately not a
 * regression — the point of the probe is to compare two *groups of rules*, and a
 * coarse attribution is enough to sort them into those groups.
 */
export function creditedWith(cases: readonly CaseRecord[]): Credited {
  const net = new Map<string, number>();
  for (const item of cases) {
    if (item.correct === item.withoutMemoryCorrect) continue;
    const delta = item.withoutMemoryCorrect ? -1 : 1;
    for (const id of item.packIdList) net.set(id, (net.get(id) ?? 0) + delta);
  }
  const hurt: string[] = [];
  const helped: string[] = [];
  const neutral: string[] = [];
  for (const [id, value] of net) {
    if (value < 0) hurt.push(id);
    else if (value > 0) helped.push(id);
    else neutral.push(id);
  }
  return { hurt, helped, neutral };
}

export type SimilarityPair = {
  readonly kind: 'hurt' | 'helped';
  readonly similarity: number;
};

/**
 * Every (question, credited rule) pair, with the similarity the caller measured.
 *
 * A rule appears once per question that carried it, not once overall: a rule that is
 * close to the question it hurt is the case the retriever has to fix, and averaging
 * that away per rule would hide it.
 */
export function pairsOf(
  cases: readonly CaseRecord[],
  credited: Credited,
  similarity: (question: string, ruleId: string) => number,
): SimilarityPair[] {
  const hurt = new Set(credited.hurt);
  const helped = new Set(credited.helped);
  const out: SimilarityPair[] = [];
  for (const item of cases) {
    for (const id of item.packIdList) {
      const kind = hurt.has(id) ? 'hurt' : helped.has(id) ? 'helped' : undefined;
      if (kind === undefined) continue;
      out.push({ kind, similarity: similarity(item.question, id) });
    }
  }
  return out;
}

export type Separation = {
  readonly hurt: { readonly n: number; readonly median: number; readonly mean: number };
  readonly helped: { readonly n: number; readonly median: number; readonly mean: number };
  /** Median difference, helped minus hurt. Negative means the signal is backwards. */
  readonly gap: number;
  /** Two-sided permutation p-value on the gap. */
  readonly p: number;
  /** True when the signal points the right way at p<0.05. */
  readonly separated: boolean;
};

function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2 : (sorted[mid] as number);
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Compare two distributions with a permutation test.
 *
 * A permutation test rather than a t-test because neither arm is normal — similarities
 * pile up at the extremes — and because the question is exactly "could a gap this big
 * arise from labelling these pairs at random", which is what reshuffling answers.
 * Deterministic: the shuffle is a mulberry32 stream from a fixed seed, so the same
 * artefact produces the same p-value twice.
 */
export function separationOf(
  pairs: readonly SimilarityPair[],
  options: { readonly resamples?: number; readonly seed?: number } = {},
): Separation {
  const hurt = pairs.filter((pair) => pair.kind === 'hurt').map((pair) => pair.similarity);
  const helped = pairs.filter((pair) => pair.kind === 'helped').map((pair) => pair.similarity);
  const observed = median(helped) - median(hurt);

  const resamples = options.resamples ?? 2000;
  let seed = options.seed ?? 7;
  const next = (): number => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const all = [...hurt, ...helped];
  let atLeast = 0;
  for (let round = 0; round < resamples; round += 1) {
    const shuffled = [...all];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(next() * (i + 1));
      const swap = shuffled[i] as number;
      shuffled[i] = shuffled[j] as number;
      shuffled[j] = swap;
    }
    const fakeHurt = shuffled.slice(0, hurt.length);
    const fakeHelped = shuffled.slice(hurt.length);
    if (Math.abs(median(fakeHelped) - median(fakeHurt)) >= Math.abs(observed)) atLeast += 1;
  }

  return {
    hurt: { n: hurt.length, median: median(hurt), mean: mean(hurt) },
    helped: { n: helped.length, median: median(helped), mean: mean(helped) },
    gap: observed,
    p: all.length === 0 ? 1 : atLeast / resamples,
    separated: observed > 0 && all.length > 0 && atLeast / resamples < 0.05,
  };
}

/** The text an embedding is computed over: what a retriever would actually see. */
export function embeddingText(item: KnowledgeItem): string {
  return [item.statement, JSON.stringify(item.scope), item.payload === undefined ? '' : JSON.stringify(item.payload)]
    .filter((part) => part !== '')
    .join('\n');
}

/**
 * The text a *filter* would compare against a question: the condition alone.
 *
 * Distinct from `embeddingText`, which is what a *retriever* ranks on. Iteration 63
 * established that rendering the condition changes what the model writes and not
 * whether it is right, so the remaining question is whether the condition can decide
 * applicability without the model — and if it can, the text to score is the condition,
 * not the claim.
 */
export function conditionText(item: KnowledgeItem): string | undefined {
  const when = item.when;
  if (when === undefined || when.trim() === '') return undefined;
  return when.trim();
}


