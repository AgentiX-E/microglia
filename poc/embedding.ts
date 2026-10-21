/**
 * POC-3 — retrieval under paraphrase: BM25 vs embeddings vs hybrid.
 *
 * The product ships lexical retrieval by default because it needs no model and
 * no network. That choice is only defensible if its failure mode is measured.
 * This script builds 48 scoped rules, paraphrases each into a query that avoids
 * the rule's own vocabulary, and compares three rankers on the same pool.
 *
 * Embeddings come from Zhipu `embedding-3` over HTTP. The product constraint is
 * CPU/WebGPU only: an on-device model would run through ONNX/WebGPU, and the
 * API call here is a stand-in for that encoder, not a GPU dependency.
 */
import { tokenize, bm25Score } from '@agentix-e/microglia-core';
import { buildCorpus, specFor } from '@agentix-e/microglia-eval';
import type { ChartIntent } from '../packages/eval/src/workload/index.js';
import { callCount, cosine, embed, mean, rate, writeResult } from './lib.js';

const SYNONYMS: Record<string, string> = {
  revenue: 'income',
  units: 'volume',
  headcount: 'staff count',
  attrition: 'leaver rate',
  spend: 'expenditure',
  budget: 'planned cost',
  shipments: 'deliveries',
  delay_minutes: 'late minutes',
  region: 'area',
  product: 'item',
  channel: 'source',
  department: 'team',
  level: 'grade',
  cost_center: 'budget unit',
  account: 'ledger',
  warehouse: 'depot',
  carrier: 'shipper',
};

const INTENT_PHRASE: Record<ChartIntent, string> = {
  trend: 'change over time',
  comparison: 'side-by-side comparison',
  composition: 'share of total',
  distribution: 'spread of values',
  correlation: 'relationship between two numbers',
  matrix: 'two-dimensional grid',
  ranking: 'top-to-bottom order',
};

/** A second vocabulary, used only by the heavy queries, so the two sides share no content words. */
const SYNONYMS_HEAVY: Record<string, string> = {
  revenue: 'earnings',
  units: 'quantity',
  headcount: 'people on payroll',
  attrition: 'people leaving',
  spend: 'outgoings',
  budget: 'forecast cost',
  shipments: 'parcels',
  delay_minutes: 'minutes late',
  region: 'territory',
  product: 'goods',
  channel: 'route',
  department: 'unit',
  level: 'band',
  cost_center: 'finance unit',
  account: 'ledger line',
  warehouse: 'storage site',
  carrier: 'transport provider',
};

const HEAVY_QUERY: Record<ChartIntent, (measure: string) => string> = {
  trend: (m) => `Which visual shows how ${m} evolves across periods?`,
  comparison: (m) => `Which visual puts ${m} next to each other across groups?`,
  composition: (m) => `Which visual shows what portion each group contributes to ${m}?`,
  distribution: (m) => `Which visual shows how spread out ${m} is?`,
  correlation: (m) => `Which visual shows whether two numbers move together?`,
  matrix: (m) => `Which visual lays ${m} out on a two-way grid?`,
  ranking: (m) => `Which visual orders groups from best to worst by ${m}?`,
};

function paraphraseHeavy(text: string): string {
  let out = text;
  for (const [from, to] of Object.entries(SYNONYMS_HEAVY)) {
    out = out.replace(new RegExp(`\\b${from}\\b`, 'gi'), to);
  }
  return out;
}

const MARK_PHRASE: Record<string, string> = {
  bar: 'bars',
  line: 'a connected line',
  pie: 'slices of a circle',
  scatter: 'individual dots',
  heatmap: 'a colored grid',
  boxplot: 'a box summary',
};

function paraphrase(text: string): string {
  let out = text;
  for (const [from, to] of Object.entries(SYNONYMS)) {
    out = out.replace(new RegExp(`\\b${from}\\b`, 'gi'), to);
  }
  return out;
}

const corpus = buildCorpus(20261020, 96, 'holdout');
const pool = corpus.slice(0, 48).map((item, index) => {
  const measure = paraphrase(item.query.field);
  const mark = MARK_PHRASE[item.gold.mark] ?? item.gold.mark;
  return {
    id: `rule_${index}`,
    text: `For a ${INTENT_PHRASE[item.query.intent]} question over ${measure}, use ${mark} rather than other marks.`,
    gold: item.gold.mark,
    intent: item.query.intent,
  };
});

const lightQueries = corpus.slice(0, 48).map((item, index) => ({
  text: `Which chart should I use for ${INTENT_PHRASE[item.query.intent]} of ${paraphrase(item.query.field)}?`,
  target: `rule_${index}`,
}));

const heavyQueries = corpus.slice(0, 48).map((item, index) => ({
  text: HEAVY_QUERY[item.query.intent](paraphraseHeavy(item.query.field)),
  target: `rule_${index}`,
}));

// --- BM25 -------------------------------------------------------------------
const documents = pool.map((entry) => ({
  id: entry.id,
  tokens: tokenize(entry.text),
  length: tokenize(entry.text).length,
}));
const averageLength = mean(documents.map((doc) => doc.length));
const df = (token: string): number => documents.filter((doc) => doc.tokens.includes(token)).length;

function bm25Rank(query: string): string[] {
  const queryTokens = tokenize(query);
  return [...documents]
    .map((doc) => ({
      id: doc.id,
      score: bm25Score(queryTokens, doc.tokens, doc.length, averageLength, df, documents.length),
    }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.id);
}

// --- Embeddings -------------------------------------------------------------
const poolVectors = await embed(pool.map((entry) => entry.text));
const lightVectors = await embed(lightQueries.map((entry) => entry.text));
const heavyVectors = await embed(heavyQueries.map((entry) => entry.text));

function embedRank(index: number, heavy = false): string[] {
  const vector = (heavy ? heavyVectors : lightVectors)[index] as number[];
  return pool
    .map((entry, i) => ({ id: entry.id, score: cosine(vector, poolVectors[i] as number[]) }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.id);
}

function hybridRank(query: string, index: number, heavy = false): string[] {
  const lexical = bm25Rank(query);
  const lexicalScore = new Map(lexical.map((id, rank) => [id, 1 / (1 + rank)]));
  const semantic = embedRank(index, heavy);
  const semanticScore = new Map(semantic.map((id, rank) => [id, 1 / (1 + rank)]));
  return pool
    .map((entry) => ({
      id: entry.id,
      score: 0.5 * (lexicalScore.get(entry.id) ?? 0) + 0.5 * (semanticScore.get(entry.id) ?? 0),
    }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.id);
}

function score(
  set: readonly { text: string; target: string }[],
  rank: (query: string, index: number) => string[],
): { recall1: number; recall5: number; mrr: number } {
  let hit1 = 0;
  let hit5 = 0;
  let mrr = 0;
  set.forEach((query, index) => {
    const ranked = rank(query.text, index);
    const position = ranked.indexOf(query.target);
    if (position === 0) hit1 += 1;
    if (position >= 0 && position < 5) hit5 += 1;
    if (position >= 0) mrr += 1 / (position + 1);
  });
  return {
    recall1: rate(hit1, set.length),
    recall5: rate(hit5, set.length),
    mrr: rate(mrr, set.length),
  };
}

const lightBm25 = score(lightQueries, (query) => bm25Rank(query));
const lightDense = score(lightQueries, (_query, index) => embedRank(index));
const lightHybrid = score(lightQueries, (query, index) => hybridRank(query, index));

const heavyBm25 = score(heavyQueries, (query) => bm25Rank(query));
const heavyDense = score(heavyQueries, (_query, index) => embedRank(index, true));
const heavyHybrid = score(heavyQueries, (query, index) => hybridRank(query, index, true));

await writeResult({
  id: 'poc-embedding',
  title: 'Paraphrase retrieval: BM25 vs Zhipu embedding-3 vs rank fusion',
  ranAt: new Date().toISOString(),
  model: 'embedding-3',
  n: lightQueries.length + heavyQueries.length,
  calls: callCount(),
  metrics: {
    light_bm25_recall1: lightBm25.recall1,
    light_bm25_mrr: lightBm25.mrr,
    light_dense_recall1: lightDense.recall1,
    light_dense_mrr: lightDense.mrr,
    light_hybrid_recall1: lightHybrid.recall1,
    light_hybrid_mrr: lightHybrid.mrr,
    heavy_bm25_recall1: heavyBm25.recall1,
    heavy_bm25_mrr: heavyBm25.mrr,
    heavy_dense_recall1: heavyDense.recall1,
    heavy_dense_mrr: heavyDense.mrr,
    heavy_hybrid_recall1: heavyHybrid.recall1,
    heavy_hybrid_mrr: heavyHybrid.mrr,
    recall5_all: Math.min(lightBm25.recall5, lightDense.recall5, heavyBm25.recall5, heavyDense.recall5),
    pool_size: pool.length,
  },
  notes: [
    'Queries replace domain vocabulary with synonyms, so lexical overlap is reduced but not zero.',
    'Rank fusion uses reciprocal-rank weights (1/(1+rank)) rather than raw score normalisation.',
    'Embeddings are a stand-in for an on-device CPU/WebGPU encoder; no GPU is required by the product.',
  ],
  samples: lightQueries.slice(0, 2).map((query, index) => ({
    light: query.text,
    heavy: heavyQueries[index]?.text,
    target: query.target,
  })),
});
