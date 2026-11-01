/**
 * The reading R33 stage 0 was registered for, computed from the two committed artefacts.
 *
 * The question is whether the filter survives being pointed at one query instead of at a difference
 * between two, because a deployment without rules has no difference to look at. Both answers are
 * useful — a check that fires on the bare arm and separates is a product that does not need the
 * memory, and a check that fires on everything is proof that the filter's precision came from the
 * baseline anchor rather than from the query.
 *
 * Nothing here calls a model. `per_case` stores both queries, so the same corpus that produced §146
 * and §147 answers this as well, and the workflow recomputes it on every push.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MEMORY_FILTER_YOUDEN,
  adjudicateR33,
  validityReadingOf,
  type ValidityCase,
  type ValidityReading,
  type ValiditySplit,
} from '@agentix-e/microglia-eval';
import { writeJson } from './lib.js';

const DEV = process.env['POC_DEV_ARTEFACT'] ?? join('eval', 'results', 'poc-sota-bird-dev-R26-channels.json');
const TRAIN = process.env['POC_TRAIN_ARTEFACT'] ?? join('eval', 'results', 'poc-sota-bird-train.json');

/** The fields this reading needs; every other field on a per-case row belongs to another reading. */
type Row = {
  readonly id: string;
  readonly dbId: string;
  readonly question?: string | null;
  readonly evidence?: string | null;
  readonly baselineSql?: string | null;
  readonly predictedSql?: string | null;
  readonly correct: boolean;
  readonly withoutMemoryCorrect: boolean;
};

type CommittedRun = { readonly dataset?: string | null; readonly per_case?: readonly Row[] };

function load(path: string): { run: CommittedRun; rows: readonly Row[] } {
  const run = JSON.parse(readFileSync(path, 'utf8')) as CommittedRun;
  return { run, rows: run.per_case ?? [] };
}

const dev = load(DEV);
const train = load(TRAIN);

/** One arm of one corpus: the query that was executed, and whether it was right. */
function armOf(rows: readonly Row[], pick: (row: Row) => string, correctOf: (row: Row) => boolean): readonly ValidityCase[] {
  return rows.map((row) => ({
    id: row.id,
    dbId: row.dbId,
    question: row.question ?? '',
    evidence: row.evidence ?? '',
    sql: pick(row),
    correct: correctOf(row),
  }));
}

const bareOf = (rows: readonly Row[]): readonly ValidityCase[] =>
  armOf(rows, (row) => row.baselineSql ?? '', (row) => row.withoutMemoryCorrect);
const servedOf = (rows: readonly Row[]): readonly ValidityCase[] =>
  armOf(rows, (row) => row.predictedSql ?? '', (row) => row.correct);

function splitOf(rows: readonly Row[], expected: number): ValiditySplit {
  const bare = bareOf(rows);
  const served = servedOf(rows);
  const bareMissing = rows.filter((row) => (row.baselineSql ?? '') === '').length;
  const servedMissing = rows.filter((row) => (row.predictedSql ?? '') === '').length;
  // A missing query is not evidence of a broken reading on its own: a parse failure has no query by
  // definition, and a bare arm recorded as wrong may legitimately have stored nothing. What would be
  // evidence of a defect is a case that claims to be right with no query at all.
  const consistent = rows.every(
    (row) =>
      ((row.baselineSql ?? '') !== '' || !row.withoutMemoryCorrect) &&
      ((row.predictedSql ?? '') !== '' || !row.correct),
  );
  return {
    n: rows.length,
    bareMissing,
    servedMissing,
    complete: rows.length === expected && consistent,
    bare: validityReadingOf(bare, { rule: 'strict' }),
    served: validityReadingOf(served, { rule: 'strict' }),
    bareLoose: validityReadingOf(bare, { rule: 'morphological' }),
    servedLoose: validityReadingOf(served, { rule: 'morphological' }),
  };
}

const devSplit = splitOf(dev.rows, 1534);
const trainSplit = splitOf(train.rows, 7000);
const verdicts = adjudicateR33({ train: trainSplit, dev: devSplit });

/**
 * Whether the reading has a corpus under it at all, which is what a gate can decide.
 *
 * These are instrument checks, not findings. A gate that failed because the answer was unwelcome
 * would be a gate that could only ever pass, and this repository has spent four rounds learning what
 * that costs.
 */
const gates = [
  {
    id: 'V52-validity-loaded',
    pass: devSplit.n === 1534 && trainSplit.n === 7000,
    criterion: 'both committed artefacts load and carry the registered 1,534 and 7,000 cases',
    actual: `${devSplit.n} dev, ${trainSplit.n} train`,
  },
  {
    id: 'V53-validity-queries-present',
    pass: devSplit.complete && trainSplit.complete,
    criterion:
      'no case is missing a query it claims to have answered — a missing bare query must come with a bare arm recorded wrong, and a missing served query with a parse failure',
    actual:
      `${devSplit.bareMissing} dev and ${trainSplit.bareMissing} train bare, ` +
      `${devSplit.servedMissing} dev and ${trainSplit.servedMissing} train served, none of them recorded as answered`,
  },
  {
    id: 'V54-validity-rules-reported',
    pass: new Set([
      devSplit.bare.rule,
      devSplit.served.rule,
      devSplit.bareLoose.rule,
      devSplit.servedLoose.rule,
      trainSplit.bare.rule,
      trainSplit.served.rule,
      trainSplit.bareLoose.rule,
      trainSplit.servedLoose.rule,
    ]).size === 2,
    criterion: 'both grounding rules are read on both arms of both splits, so the rule cannot be chosen after the fact',
    actual: 'strict and morphological, on bare and served, on dev and train',
  },
];

const headline = (reading: ValidityReading): Record<string, unknown> => ({
  rule: reading.rule,
  n: reading.n,
  excluded: reading.excluded,
  databases: reading.databases,
  accuracyPp: reading.accuracyPp,
  flagged: reading.flagged,
  clean: reading.clean,
  gapPp: reading.gapPp,
  clustered: { lowPp: reading.clusterLowPp, highPp: reading.clusterHighPp, resolves: reading.resolves },
  fisherP: reading.fisherP,
  sensitivity: reading.sensitivity,
  specificity: reading.specificity,
  youdenJ: reading.youdenJ,
});

/**
 * The sentence the two splits support, derived rather than written.
 *
 * It says three things and each is a number in this file: how often the question-only rule fires,
 * whether the attempts it fires on are worse, and whether the resulting check clears the bar the
 * registration set for it. Prose that restates a number is the part of an artefact nobody re-checks.
 */
function statementOf(): string {
  const strict = trainSplit.bare;
  const loose = trainSplit.bareLoose;
  const j = strict.youdenJ;
  const clears = j !== null && j >= MEMORY_FILTER_YOUDEN;
  return (
    `Pointed at one query instead of at a difference, the grounding rule flags ` +
    `${(strict.flagged.share * 100).toFixed(1)}% of ${strict.n} bare attempts under the strict rule and ` +
    `${(loose.flagged.share * 100).toFixed(1)}% under the morphological one. ` +
    `Flagged attempts are ${strict.gapPp === null ? 'n/a' : strict.gapPp.toFixed(2)}pp against clean ones, ` +
    `on a clustered interval that ${strict.resolves ? 'excludes' : 'covers'} zero, and Youden's index is ` +
    `${j === null ? 'n/a' : j.toFixed(4)} against the memory filter's ${MEMORY_FILTER_YOUDEN.toFixed(4)}, which ` +
    `the check ${clears ? 'clears' : 'does not clear'}.`
  );
}

await writeJson('poc-validity', {
  id: 'poc-validity',
  title: 'Whether the read-time filter survives without a baseline to anchor on',
  registered: 'prereg/R33.md',
  sources: { dev: DEV, train: TRAIN },
  datasets: { dev: dev.run.dataset ?? null, train: train.run.dataset ?? null },
  gates,
  verdicts,
  statement: statementOf(),
  train: {
    bare: headline(trainSplit.bare),
    served: headline(trainSplit.served),
    bareLoose: headline(trainSplit.bareLoose),
    servedLoose: headline(trainSplit.servedLoose),
  },
  dev: {
    bare: headline(devSplit.bare),
    served: headline(devSplit.served),
    bareLoose: headline(devSplit.bareLoose),
    servedLoose: headline(devSplit.servedLoose),
  },
  notes: [
    'The anchor is the whole of the difference from the covariate §146 used. diffQueries reports what the second query adds to the first, so against an empty baseline it reports every name the query uses, and the grounding rule then decides which of those the question supports. A second implementation of "is this name implied" would differ from the first by exactly the thing under test.',
    'The strict rule grounds an identifier only when the identifier or one of its whitespace-separated parts is a token of the question or the evidence. The morphological rule additionally accepts a prefix match on de-underscored forms, which is what recognises an inflected schema name. Both are reported on both arms of both splits; the registration named strict as primary before either number existed.',
    'Nothing here is a model call. Both queries are columns in the artefacts the earlier rounds already paid for, which is why a question that decides a product could be asked for the price of a script.',
  ],
});

const text = (value: number | null, digits = 2): string => (value === null ? 'n/a' : value.toFixed(digits));
process.stdout.write(`[validity] ${statementOf()}\n`);
for (const split of [
  ['train', trainSplit] as const,
  ['dev', devSplit] as const,
]) {
  for (const [label, reading] of [
    ['bare strict', split[1].bare],
    ['served strict', split[1].served],
    ['bare morphological', split[1].bareLoose],
    ['served morphological', split[1].servedLoose],
  ] as const) {
    process.stdout.write(
      `[validity] ${split[0].padEnd(5)} ${label.padEnd(19)} flagged ${(reading.flagged.share * 100).toFixed(1).padStart(5)}% ` +
        `acc ${text(reading.flagged.accuracyPp).padStart(6)}% clean ${text(reading.clean.accuracyPp).padStart(6)}% ` +
        `gap ${text(reading.gapPp).padStart(7)} J ${text(reading.youdenJ, 4)}\n`,
    );
  }
}
for (const gate of gates) {
  process.stdout.write(`[validity] ${gate.pass ? 'PASS' : 'FAIL'} ${gate.id} — ${gate.actual}\n`);
}
for (const verdict of verdicts) {
  process.stdout.write(`[validity] ${verdict.holds ? 'holds ' : 'FAILED'} ${verdict.id} — ${verdict.observed}\n`);
}
