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
 *
 * The same file answers the same question on the out-of-sample split, where it is not a stability
 * check but the estimate itself. Everything the artefact says about its corpus is therefore derived
 * from the corpus — `stabilityFramingOf` holds that rule and is where the tests point — rather than
 * written as the dev sentence it used to be.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  corpusOf,
  splitOfName,
  stabilityFramingOf,
  stabilityOf,
  type CommittedArtefact,
} from '@agentix-e/microglia-eval';
import { writeJson } from './lib.js';

const SOURCE = process.env['STABILITY_SOURCE'] ?? join('eval', 'results', 'poc-sota-bird-dev-R26-channels.json');
/** The documentation section this reading answers. */
const REGISTERED = 'ROADMAP.md §R31-stability';

const artefact = JSON.parse(readFileSync(SOURCE, 'utf8')) as CommittedArtefact & {
  readonly dataset?: string | null;
};
const corpus = corpusOf(artefact);

// Two modes, because §140's headline is the strict one and its robustness check is the other. A
// gate that only holds under one grounding rule is a statement about the tokeniser.
const strict = stabilityOf(corpus.cases, { mode: 'strict' });
const loose = stabilityOf(corpus.cases, { mode: 'morphological' });

const framing = stabilityFramingOf({
  observedPp: strict.observedPp,
  discarded: strict.discarded,
  n: strict.n,
  databases: strict.jackknife.length,
  split: splitOfName(artefact.dataset),
});

await writeJson('poc-gate-stability', {
  id: 'poc-gate-stability',
  title: framing.title,
  source: SOURCE,
  sourceGeneratedAt: corpus.generatedAt,
  dataset: artefact.dataset ?? null,
  registered: REGISTERED,
  n: corpus.cases.length,
  strict,
  loose,
  unmeasured: framing.unmeasured,
  notes: framing.notes,
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
