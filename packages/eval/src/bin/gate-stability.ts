/**
 * Take the gate's estimate apart: one database, one half, one random subset of its own size.
 *
 * §140 estimated that discarding every memory query which imports an ungrounded name would move
 * the dev delta from +0.33pp to +1.30pp, and said in the same breath that the estimate is in-sample
 * and that stage 2 would have to confirm it. Stage 2 is 14,000 calls. This is the question that
 * decides whether they are worth making: is +1.30pp a property of the gate, or of eleven databases
 * one of which happens to carry it?
 *
 * It reads one committed artefact, writes one, calls no model, opens no database and records no
 * clock, so the workflow can recompute it byte for byte.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { corpusOf, stabilityOf, type CommittedArtefact } from '@agentix-e/microglia-eval';
import { writeJson } from './lib.js';

const SOURCE = process.env['STABILITY_SOURCE'] ?? join('eval', 'results', 'poc-sota-bird-dev-R26-channels.json');
/** The documentation section this reading answers. */
const REGISTERED = 'ROADMAP.md §R31-stability';

const artefact = JSON.parse(readFileSync(SOURCE, 'utf8')) as CommittedArtefact;
const corpus = corpusOf(artefact);

// Two modes, because §140's headline is the strict one and its robustness check is the other. A
// gate that only holds under one grounding rule is a statement about the tokeniser.
const strict = stabilityOf(corpus.cases, { mode: 'strict' });
const loose = stabilityOf(corpus.cases, { mode: 'morphological' });

await writeJson('poc-gate-stability', {
  id: 'poc-gate-stability',
  title: 'Whether the read-time gate’s +1.30pp is a property of the gate or of one database',
  source: SOURCE,
  sourceGeneratedAt: corpus.generatedAt,
  registered: REGISTERED,
  n: corpus.cases.length,
  strict,
  loose,
  /**
   * What a split-half can and cannot say here, written down because the temptation to over-read it
   * is strong: both halves were part of the corpus the hypothesis came from, so this is a
   * stability check and not an out-of-sample test. Only stage 2 is that.
   */
  unmeasured: [
    {
      category: 'out-of-sample',
      registered: 'the estimate on questions the hypothesis was not formed on',
      reason: 'every question here was in the corpus that produced §140, so no split of it is out of sample',
      nearest: 'S3 (the two halves)',
      difference: 'S3 says the estimate is stable across sub-samples; it cannot say it reproduces on a new one',
    },
  ],
  notes: [
    'Leave-one-database-out is the clustering check. Questions within a database are not independent — a rule injected on one is injected on its neighbours — so an estimate carried by a single database would not reproduce at a different mixture, and stage 2 draws a different mixture by construction.',
    'The permutation test redraws which questions the gate discards, keeping the number discarded fixed. It asks whether the gate finds damaged questions or merely pays the variance of dropping ten percent of the corpus. Sampling is without replacement: with replacement the null would describe a smaller subset than the gate discards, and a wider null flatters the gate.',
    'The halves are balanced greedily by question count rather than split by hash, because dev has eleven databases of very different sizes and an arbitrary partition can leave one half too small to resolve anything.',
    'Every number here comes from a closed form over the recorded outcomes: the gated arm reads the no-pack query that already exists for every discarded question. Nothing is resampled except the permutation null and the two bootstrap intervals.',
  ],
});

const pct = (value: number | null): string => (value === null ? 'n/a' : value.toFixed(2));
process.stdout.write(
  `[stability] strict: discards ${strict.discarded} of ${strict.n}, improvement ${pct(strict.observedPp)}pp\n`,
);
const worst = strict.jackknife.reduce<{ dropped: string; improvementPp: number } | null>(
  (low, row) => (low === null || row.improvementPp <= low.improvementPp ? row : low),
  null,
);
process.stdout.write(
  `[stability] jackknife ${pct(strict.jackknifeMinPp)}pp to ${pct(strict.jackknifeMaxPp)}pp over ` +
    `${strict.jackknife.length} databases; weakest by dropping ${worst?.dropped ?? 'none'}\n`,
);
for (const half of strict.halves) {
  process.stdout.write(
    `[stability] half ${half.half}: n=${half.n}, ${half.discarded} discarded, gated ${pct(half.gatedDeltaPp)}pp, ` +
      `improvement ${pct(half.improvementPp)}pp, mde ${pct(half.minDetectablePp)}pp, ${half.databases.length} databases\n`,
  );
}
process.stdout.write(
  `[stability] permutation: p=${strict.permutation.p.toFixed(4)} against a null of ` +
    `${pct(strict.permutation.nullMeanPp)}pp [${pct(strict.permutation.nullLowPp)}, ${pct(strict.permutation.nullHighPp)}] ` +
    `over ${strict.permutation.resamples} draws\n`,
);
for (const criterion of strict.criteria) {
  process.stdout.write(`[stability] ${criterion.ok ? 'pass' : 'FAIL'} ${criterion.code} — ${criterion.actual}\n`);
}
process.stdout.write(
  `[stability] ${strict.unstable ? 'unstable: at least one reading failed, so the estimate is not a property of the gate' : 'stable on all three readings'}\n`,
);
