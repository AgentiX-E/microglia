/**
 * Is embedding similarity a better relevance signal than the lexical one?
 *
 * The lexical signal is not weak, it is absent: rules credited with a hurt have a
 * median word coverage of 0.133 against their question and rules credited with a help
 * have 0.130. Rebuilding recall around a signal that cannot separate the two groups
 * would be an expensive way to learn nothing, so this probe measures the signal
 * first — on the artefact that already exists, with no lane change.
 *
 * If cosine similarity separates them, semantic recall is worth its cost (an
 * embedding per rule, a provider dependency, an index to keep). If it does not, the
 * problem is not the retriever and the next experiment is somewhere else entirely.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { KnowledgeItem } from '@agentix-e/microglia-core';
import { queryCoverage } from '@agentix-e/microglia-core';
import {
  conditionText,
  creditedWith,
  embeddingText,
  pairsOf,
  separationOf,
  type CaseRecord,
} from '@agentix-e/microglia-eval';
import { writeJson } from './lib.js';

const ARTEFACT = process.env['SOTA_ARTEFACT'] ?? join('eval', 'results', 'poc-sota-bird.json');
const KEY = process.env['ZHIPU_API_KEY'] ?? '';
const MODEL = process.env['ZHIPU_MODEL'] ?? 'embedding-3';
const URL = 'https://open.bigmodel.cn/api/paas/v4/embeddings';
const BATCH = 64;

type BirdArtefact = {
  readonly items: readonly KnowledgeItem[];
  readonly per_case: readonly {
    readonly question: string;
    readonly correct: boolean;
    readonly withoutMemoryCorrect: boolean;
    readonly packIdList: readonly string[];
  }[];
};

async function embed(texts: readonly string[]): Promise<Map<string, readonly number[]>> {
  const out = new Map<string, readonly number[]>();
  for (let start = 0; start < texts.length; start += BATCH) {
    const batch = texts.slice(start, start + BATCH);
    let last = '';
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const response = await fetch(URL, {
          method: 'POST',
          headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
          body: JSON.stringify({ model: MODEL, input: batch }),
          signal: AbortSignal.timeout(60_000),
        });
        if (!response.ok) {
          last = `${response.status}: ${(await response.text()).slice(0, 200)}`;
          await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
          continue;
        }
        const body = (await response.json()) as { data?: { index?: number; embedding?: number[] }[] };
        for (const entry of body.data ?? []) {
          const index = entry.index ?? 0;
          const text = batch[index];
          if (text !== undefined && entry.embedding !== undefined) out.set(text, entry.embedding);
        }
        process.stderr.write(`[probe] embedded ${out.size}/${texts.length}\n`);
        break;
      } catch (error) {
        last = String(error);
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
    if (out.size < start + batch.length) {
      throw new Error(`embedding batch failed at ${start}: ${last}`);
    }
  }
  return out;
}

function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const width = Math.min(a.length, b.length);
  for (let i = 0; i < width; i += 1) {
    const x = a[i] as number;
    const y = b[i] as number;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

if (KEY === '') throw new Error('ZHIPU_API_KEY is required');

const document = JSON.parse(readFileSync(ARTEFACT, 'utf8')) as BirdArtefact;
const items = new Map(document.items.map((item) => [item.id, item]));
const cases: CaseRecord[] = document.per_case.map((entry) => ({
  question: entry.question,
  correct: entry.correct,
  withoutMemoryCorrect: entry.withoutMemoryCorrect,
  packIdList: entry.packIdList,
}));

const credited = creditedWith(cases);
process.stderr.write(
  `[probe] credited: ${credited.hurt.length} hurt, ${credited.helped.length} helped, ${credited.neutral.length} neutral\n`,
);

const creditedIds = new Set([...credited.hurt, ...credited.helped]);
const ruleTexts = new Map<string, string>();
const conditionTexts = new Map<string, string>();
for (const id of creditedIds) {
  const item = items.get(id);
  if (item === undefined) continue;
  ruleTexts.set(id, embeddingText(item));
  const condition = conditionText(item);
  if (condition !== undefined) conditionTexts.set(id, condition);
}
const questionTexts = [...new Set(cases.map((entry) => entry.question))];

const vectors = await embed([
  ...new Set([...ruleTexts.values(), ...conditionTexts.values(), ...questionTexts]),
]);
const vectorOf = (text: string | undefined): readonly number[] | undefined =>
  text === undefined ? undefined : vectors.get(text);

const pairs = pairsOf(cases, credited, (question, ruleId) => {
  const a = vectors.get(question);
  const b = vectorOf(ruleTexts.get(ruleId));
  return a === undefined || b === undefined ? 0 : cosine(a, b);
});
const separation = separationOf(pairs, { resamples: 5000 });

/**
 * The same question, asked of the condition.
 *
 * `pairsOf` requires a similarity per pair, and a rule without a condition has none:
 * scoring it as zero would put every unconditioned rule in the "dissimilar" bucket and
 * make a separation look real. The pairs are therefore restricted to the rules that
 * carry one, which is 100% of this artefact's rules and need not be of the next.
 */
const conditionedCases = cases.map((entry) => ({
  ...entry,
  packIdList: entry.packIdList.filter((id) => conditionTexts.has(id)),
}));
const conditionPairs = pairsOf(conditionedCases, credited, (question, ruleId) => {
  const a = vectors.get(question);
  const b = vectorOf(conditionTexts.get(ruleId));
  return a === undefined || b === undefined ? 0 : cosine(a, b);
});
const conditionSeparation = separationOf(conditionPairs, { resamples: 5000 });

// The lexical baseline for the same question, computed without a provider: if a
// keyword test over the condition separates the two groups, no index is needed.
// `queryCoverage` is the store's own gate (`minCoverage`), not a second definition of
// the same quantity: a probe that measured coverage with a different tokenizer would
// report a number no caller could reproduce.
const lexicalPairs = pairsOf(conditionedCases, credited, (question, ruleId) =>
  queryCoverage(question, conditionTexts.get(ruleId) ?? ''),
);
const lexicalSeparation = separationOf(lexicalPairs, { resamples: 5000 });

await writeJson('poc-embed-probe', {
  id: 'poc-embed-probe',
  title: 'Is semantic similarity a relevance signal where lexical overlap is none?',
  ranAt: new Date().toISOString(),
  source: ARTEFACT,
  model: MODEL,
  n: pairs.length,
  n_condition: conditionPairs.length,
  rules: { hurt: credited.hurt.length, helped: credited.helped.length, neutral: credited.neutral.length },
  separation,
  condition_separation: conditionSeparation,
  condition_lexical_separation: lexicalSeparation,
  notes: [
    'Lexical baseline on the same artefact: median word coverage 0.133 for hurt rules and 0.130 for helped rules; identifier coverage 0.000 for both.',
    '`separation` scores the rule text a retriever ranks on; `condition_separation` scores the condition alone, which is what a filter would compare; `condition_lexical_separation` is the same comparison without a provider.',
    'Pairs are (question, credited rule) occurrences, not rules: a rule that is close to the question it hurt is exactly the case a retriever has to fix.',
    'Permutation test, 5,000 resamples, fixed seed: the p-value is the share of relabellings whose median gap is at least the observed one.',
  ],
});

const line = (name: string, value: typeof separation): string =>
  `[probe] ${name.padEnd(10)} hurt n=${value.hurt.n} median=${value.hurt.median.toFixed(3)} | ` +
  `helped n=${value.helped.n} median=${value.helped.median.toFixed(3)} | ` +
  `gap=${value.gap.toFixed(3)} p=${value.p.toFixed(4)} separated=${value.separated}\n`;
process.stdout.write(
  line('statement', separation) + line('condition', conditionSeparation) + line('lexical', lexicalSeparation),
);
