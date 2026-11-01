/**
 * Stratify the committed paired record by query–rule overlap, and report what the shape is.
 *
 * This is the R28 measurement. It reads one committed artefact and writes one, calls no model,
 * and is deterministic: the same JSON in gives the same JSON out, which is what lets the workflow
 * recompute it and compare byte for byte instead of trusting the committed copy.
 *
 * The registration it executes is `ROADMAP.md` §R28 in the documentation repository, committed
 * before this file existed. The artefact names that commit so the ordering — prediction, then run —
 * is checkable by anyone with the two repositories rather than asserted by the author of both.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  byDifficulty,
  characterOverlapOf,
  overlapOf,
  readStrata,
  stratify,
  type DifficultyStrata,
  type StratumCase,
} from '@agentix-e/microglia-eval';
import { writeJson } from './lib.js';

const SOURCE = process.env['HARM_SOURCE'] ?? join('eval', 'results', 'poc-sota-bird-dev-R26-channels.json');
/** The documentation commit that registered the four criteria before this run existed. */
const REGISTERED = 'ROADMAP.md §R28 (microglia-docs a3b303d)';

type SourceCase = {
  readonly question: string;
  readonly injected?: readonly string[];
  readonly correct: boolean;
  readonly withoutMemoryCorrect: boolean;
  readonly difficulty?: string;
};

const source = JSON.parse(readFileSync(SOURCE, 'utf8')) as {
  readonly per_case?: readonly SourceCase[];
  readonly generated_at?: string;
};
const rows = source.per_case;
if (rows === undefined || rows.length === 0) {
  throw new Error(`${SOURCE} carries no per_case rows to stratify`);
}

const cases: StratumCase[] = rows.map((entry) => ({
  question: entry.question,
  injected: entry.injected ?? [],
  correct: entry.correct,
  withoutMemoryCorrect: entry.withoutMemoryCorrect,
  difficulty: entry.difficulty ?? 'unstated',
}));

const primary = stratify(cases, (entry) => overlapOf(entry.question, entry.injected));
const alternative = stratify(cases, (entry) => characterOverlapOf(entry.question, entry.injected));
const bands: readonly DifficultyStrata[] = byDifficulty(cases, (entry) => overlapOf(entry.question, entry.injected));
const reading = readStrata({ primary, alternative, byDifficulty: bands });

const helped = cases.filter((entry) => entry.correct && !entry.withoutMemoryCorrect).length;
const harmed = cases.filter((entry) => entry.withoutMemoryCorrect && !entry.correct).length;
const populated = primary.filter((bucket) => bucket.n >= 100);
const populatedShare = populated.reduce((sum, bucket) => sum + bucket.n, 0) / cases.length;
// `Math.max` of nothing is −Infinity, which serialises to `null` and would be read as "not
// measured" beside a share of zero that says the same thing twice. One absence, stated once.
const populatedWorst =
  populated.length === 0 ? null : Math.max(...populated.map((bucket) => Math.abs(bucket.deltaPp ?? 0)));

await writeJson('poc-harm-strata', {
  id: 'poc-harm-strata',
  title: 'Does the harm concentrate at intermediate query–rule overlap?',
  // No `ranAt`: a stratification makes no call and has no run time of its own, only the timestamp
  // of the measurement it re-reads. Recording a clock here would also make the artefact impossible
  // to recompute byte for byte, which is the one check that keeps it honest.
  source: SOURCE,
  sourceGeneratedAt: source.generated_at ?? null,
  registered: REGISTERED,
  n: cases.length,
  paired: { helped, harmed, deltaPp: ((helped - harmed) / cases.length) * 100 },
  edges: primary.map((bucket) => [bucket.lower, bucket.upper]),
  buckets: primary,
  buckets_character_4gram: alternative,
  by_difficulty: bands,
  minimum: reading.minimum,
  maximum: reading.maximum,
  gapPp: reading.gapPp,
  gapMinDetectablePp: reading.gapMinDetectablePp,
  criteria: reading.criteria,
  refuted: reading.refuted,
  populated: { buckets: populated.length, share: populatedShare, worstAbsDeltaPp: populatedWorst },
  notes: [
    'Overlap is the maximum of queryCoverage over the rules the question was actually shown — the store\'s own function behind minCoverage, not a second definition of the same quantity.',
    'Outcome-blind by construction: the stratifier reads the question and the injected rule text, never a result, so a stratum cannot be conditioned on the outcome it explains.',
    'S5 is an amendment to the registration, disclosed in the artefact: a minimum is only a minimum if the gap around it exceeds its own minimum detectable difference. The registered four criteria did not carry a power floor, and a bucket of four discordant pairs can otherwise be reported as the minimum of four and read as a shape.',
    'S2 applies a floor of 10 discordant pairs per bucket; a band with no bucket above it is reported as undecided rather than as agreeing with the prediction.',
    'The character 4-gram column exists only for S4. It is not a relevance signal and must not be wired to one.',
  ],
});

const line = (name: string, buckets: readonly (typeof primary)[number][]): string =>
  `[strata] ${name.padEnd(10)} ` +
  buckets
    .map(
      (bucket) =>
        `[${bucket.lower},${bucket.upper === null ? '1' : bucket.upper}) n=${String(bucket.n).padStart(4)} ` +
        `${bucket.deltaPp === null ? '   n/a' : bucket.deltaPp.toFixed(2).padStart(6)}pp ` +
        `±${bucket.halfWidthPp === null ? 'n/a' : bucket.halfWidthPp.toFixed(2)}`,
    )
    .join(' | ') +
  '\n';

process.stdout.write(line('words', primary) + line('4-grams', alternative));
process.stdout.write(
  `[strata] overall ${helped} helped, ${harmed} harmed over ${cases.length} questions; ` +
    `populated buckets cover ${(populatedShare * 100).toFixed(1)}%, worst |delta| ${
      populatedWorst === null ? 'n/a' : `${populatedWorst.toFixed(2)}pp`
    }\n`,
);
for (const criterion of reading.criteria) {
  process.stdout.write(`[strata] ${criterion.ok ? 'pass' : 'FAIL'} ${criterion.code} — ${criterion.actual}\n`);
}
process.stdout.write(
  `[strata] ${reading.refuted ? 'refuted' : 'not refuted'}: the minimum sits at bucket ${String(reading.minimum)}, ` +
    `gap ${reading.gapPp === null ? 'n/a' : reading.gapPp.toFixed(2)}pp against a minimum detectable ` +
    `${reading.gapMinDetectablePp === null ? 'n/a' : reading.gapMinDetectablePp.toFixed(2)}pp\n`,
);
