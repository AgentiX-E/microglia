/**
 * A competitor-shaped baseline: the fact store.
 *
 * Memory products in this space converge on the same architecture — extract a
 * fact, deduplicate it against similar memories, retrieve the most similar one at
 * query time, put it in the prompt. That design has no notion of scope, evidence
 * weight, admission, contradiction, or retirement, because it models *recall*
 * rather than *governance*.
 *
 * This module implements that design faithfully and minimally, so the study can
 * answer a question the arm table cannot: is the extra machinery load-bearing, or
 * would a plain memory store have done the same job on the same corrections? The
 * reader is deliberately generous to the baseline — it applies the mark from the
 * retrieved sentence, which is the best case for a store that keeps sentences.
 */
import { diceSimilarity, tokenize } from '@agentix-e/microglia-core';
import type { ChartMark } from '@agentix-e/microglia-nl2charts';
import type { CorpusItem } from './scenario.js';

export type Fact = {
  readonly text: string;
  readonly mark: ChartMark;
  readonly trusted: boolean;
  readonly at: number;
};

export type FactStoreOptions = {
  /** Token overlap above which a new fact replaces an existing one, as Mem0 dedupes. */
  readonly duplicateThreshold?: number;
  /** Overlap below which nothing is retrieved and the baseline answer stands. */
  readonly retrievalFloor?: number;
  /** Ingest corrections that arrived through an untrusted channel. */
  readonly ingestUntrusted?: boolean;
};

export type FactStoreResult = {
  /** Share of held-out questions answered correctly. */
  readonly accuracy: number;
  readonly correct: readonly boolean[];
  readonly facts: number;
  readonly untrustedFacts: number;
  /** Corrections the store dropped as duplicates. */
  readonly merged: number;
};

/**
 * A friendly but faithful model of a similarity-based memory.
 *
 * `learn` applies the last-write-wins semantics that an ADD/UPDATE/DELETE prompt
 * converges on: a fact that is similar enough to an existing one replaces it.
 */
export class FactStore {
  private readonly facts: Fact[] = [];
  private merged = 0;
  private readonly duplicateThreshold: number;
  private readonly retrievalFloor: number;
  private readonly ingestUntrusted: boolean;

  public constructor(options: FactStoreOptions = {}) {
    this.duplicateThreshold = options.duplicateThreshold ?? 0.8;
    this.retrievalFloor = options.retrievalFloor ?? 0.2;
    this.ingestUntrusted = options.ingestUntrusted ?? true;
  }

  public learn(fact: Fact): void {
    if (!fact.trusted && !this.ingestUntrusted) return;
    let bestIndex = -1;
    let bestScore = 0;
    for (const [index, existing] of this.facts.entries()) {
      const score = diceSimilarity(existing.text, fact.text);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
    if (bestIndex >= 0 && bestScore >= this.duplicateThreshold) {
      this.facts[bestIndex] = fact;
      this.merged += 1;
      return;
    }
    this.facts.push(fact);
  }

  /** The single most similar sentence, or `undefined` when nothing is close enough. */
  public retrieve(question: string): Fact | undefined {
    const tokens = tokenize(question);
    let best: Fact | undefined;
    let bestScore = 0;
    for (const fact of this.facts) {
      const overlap = tokens.filter((token) => fact.text.includes(token)).length / Math.max(1, tokens.length);
      if (overlap > bestScore) {
        bestScore = overlap;
        best = fact;
      }
    }
    return bestScore >= this.retrievalFloor ? best : undefined;
  }

  public summary(): { facts: number; untrusted: number; merged: number } {
    return {
      facts: this.facts.length,
      untrusted: this.facts.filter((fact) => !fact.trusted).length,
      merged: this.merged,
    };
  }
}

/**
 * Run the fact store over the same feedback schedule the arms use.
 *
 * The reader applies the retrieved fact's mark to every question the retrieval
 * matches — no scope predicate, no confidence, no contradiction — which is exactly
 * what "put the top memory in the prompt" means when the downstream model is
 * cooperative.
 */
export function runFactStore(
  corpus: { readonly train: readonly CorpusItem[]; readonly holdout: readonly CorpusItem[] },
  batches: readonly (readonly CorpusItem[])[],
  options: FactStoreOptions & { readonly poisonEvery?: number } = {},
): FactStoreResult {
  const store = new FactStore(options);
  const poisonEvery = options.poisonEvery ?? 0;
  let seen = 0;

  for (const batch of batches) {
    for (const item of batch) {
      if (item.baseline.mark === item.gold.mark) continue;
      store.learn({
        text: `${item.query.intent} ${item.query.field} ${item.query.category} ${item.query.text}`,
        mark: item.gold.mark,
        trusted: true,
        at: seen,
      });
      seen += 1;
      if (poisonEvery > 0 && seen % poisonEvery === 0) {
        store.learn({
          text: `${item.query.intent} ${item.query.field} ${item.query.category} ${item.query.text}`,
          // The poison is the one chart type that is wrong for this question.
          mark: item.baseline.mark === 'pie' ? 'line' : 'pie',
          trusted: false,
          at: seen,
        });
      }
    }
  }

  const correct: boolean[] = [];
  for (const item of corpus.holdout) {
    const fact = store.retrieve(item.query.text);
    const mark = fact?.mark ?? item.baseline.mark;
    correct.push(mark === item.gold.mark);
  }
  const summary = store.summary();
  return {
    accuracy: correct.length === 0 ? 0 : correct.filter(Boolean).length / correct.length,
    correct,
    facts: summary.facts,
    untrustedFacts: summary.untrusted,
    merged: summary.merged,
  };
}
