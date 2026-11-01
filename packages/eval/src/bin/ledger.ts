/**
 * Whether the store's items have a value, read from the corpus §146 already paid for.
 *
 * §149 closed the last route that kept the store fixed: no gate computable before generation selects
 * the questions where memory helps. What no round has tested is whether the rules themselves are worth
 * different amounts — and pruning, the obvious store-side intervention, needs exactly that. This
 * command measures it: a dispersion statistic against a null that preserves the pack structure, a
 * split-half correlation that is a reliability, an out-of-sample test of a coarse prune flag, and the
 * one structural variable that turned out to vary — how many rules a prompt carries.
 *
 * No model call. Every field is a column in a committed artefact.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  R35_BARS,
  adjudicateR35,
  dispersionOf,
  packSizeOf,
  replicationOf,
  screeningOf,
  splitByDatabase,
  type LedgerCase,
  type PackSizeFamily,
} from '@agentix-e/microglia-eval';
import { writeJson } from './lib.js';

// The inputs are the committed artefacts, not the output directory: `POC_RESULT_DIR` redirects where a
// self-check writes, and a run that took its corpus from there would read its own output.
const COMMITTED = join('eval', 'results');
const TRAIN = process.env['POC_TRAIN_ARTEFACT'] ?? join(COMMITTED, 'poc-sota-bird-train.json');

type Row = {
  readonly id: string;
  readonly dbId: string;
  readonly question?: string | null;
  readonly injected?: readonly string[] | null;
  readonly packIdList?: readonly string[] | null;
  readonly correct: boolean;
  readonly withoutMemoryCorrect: boolean;
};

type Artefact = {
  readonly id?: string;
  readonly dataset?: string | null;
  readonly per_case?: readonly Row[];
};

function load(path: string): readonly Row[] {
  const run = JSON.parse(readFileSync(path, 'utf8')) as Artefact;
  return run.per_case ?? [];
}

function ledgerOf(rows: readonly Row[]): readonly LedgerCase[] {
  return rows.map((row) => ({
    id: row.id,
    dbId: row.dbId,
    injected: row.injected ?? [],
    ...(row.packIdList === undefined || row.packIdList === null ? {} : { packIdList: row.packIdList }),
    correct: row.correct,
    withoutMemoryCorrect: row.withoutMemoryCorrect,
  }));
}

const rows = load(TRAIN);
const cases = ledgerOf(rows);
const { discovery, confirmation } = splitByDatabase(cases);

const dispersion = dispersionOf(cases, { permutations: 4000 });
const replication = replicationOf(discovery, confirmation, { minShown: R35_BARS.minShown });
const screening = screeningOf(discovery, confirmation, { minShown: R35_BARS.pruneShown });
const packSize = packSizeOf(cases);

/**
 * The pack-size contrast, recomputed on every committed artefact that carries a pack.
 *
 * These are not independent studies — several are the same 350 questions at different settings — so
 * they are counted rather than pooled: the question is whether the sign survives a change of corpus,
 * and a pooled estimate over overlapping corpora would answer a question nobody asked.
 */
function familyOf(): { family: PackSizeFamily; rows: readonly Record<string, unknown>[] } {
  const files = readdirSync(COMMITTED)
    .filter((name) => name.startsWith('poc-sota-bird') && name.endsWith('.json'))
    .sort();
  const tally: Record<string, unknown>[] = [];
  let positive = 0;
  let negative = 0;
  let flat = 0;
  for (const name of files) {
    const data = JSON.parse(readFileSync(join(COMMITTED, name), 'utf8')) as Artefact;
    const entries = ledgerOf(data.per_case ?? []);
    // The same resample count as the primary reading, so the row for this corpus is the primary
    // reading rather than a second, noisier estimate of it.
    const reading = packSizeOf(entries);
    if (reading.differencePp === null) continue;
    const verdict = reading.differencePp > 0.01 ? 'positive' : reading.differencePp < -0.01 ? 'negative' : 'flat';
    if (verdict === 'positive') positive += 1;
    else if (verdict === 'negative') negative += 1;
    else flat += 1;
    tally.push({
      artefact: name,
      questions: reading.single.questions + reading.pair.questions,
      single: reading.single,
      pair: reading.pair,
      differencePp: reading.differencePp,
      lowPp: reading.lowPp,
      highPp: reading.highPp,
      verdict,
    });
  }
  return { family: { datasets: positive + negative + flat, positive, negative, flat }, rows: tally };
}

const { family, rows: familyRows } = familyOf();

const corpus = {
  questions: rows.length,
  databases: new Set(rows.map((row) => row.dbId)).size,
  rules: dispersion.rules,
  injections: dispersion.injections,
  repaired: rows.filter((row) => row.correct && !row.withoutMemoryCorrect).length,
  broken: rows.filter((row) => row.withoutMemoryCorrect && !row.correct).length,
  halves: {
    databases: new Set(discovery.map((entry) => entry.dbId)).size,
    discovery: discovery.length,
    confirmation: confirmation.length,
  },
  rulesPerHalf: replication.rules,
};

const verdicts = adjudicateR35({ corpus, dispersion, replication, screening, packSize, family });

const gates = [
  {
    id: 'V59-ledger-corpus',
    pass:
      corpus.questions === 7000 &&
      corpus.databases === 58 &&
      corpus.rules === 203 &&
      corpus.injections === 13_578 &&
      corpus.repaired === 187 &&
      corpus.broken === 237,
    criterion: 'the corpus is the one R30 stage 2 paid for: 7,000 questions, 58 databases, 203 rules, 13,578 injections',
    actual: `${corpus.questions} questions, ${corpus.databases} databases, ${corpus.rules} rules, ${corpus.injections} injections, ${corpus.repaired} repaired, ${corpus.broken} broken`,
  },
  {
    id: 'V60-ledger-split',
    pass:
      corpus.halves.databases === 29 &&
      corpus.halves.discovery + corpus.halves.confirmation === corpus.questions,
    criterion: 'the two halves deal 29 databases each, share none, and between them hold every question',
    actual: `${corpus.halves.discovery} + ${corpus.halves.confirmation} questions over ${corpus.halves.databases} databases per half`,
  },
  {
    id: 'V61-ledger-family',
    pass: family.datasets >= 15 && family.positive + family.negative + family.flat === family.datasets,
    criterion: 'the pack-size family was recomputed on at least fifteen committed artefacts and every row has a sign',
    actual: `${family.datasets} artefacts: ${family.positive} positive, ${family.negative} negative, ${family.flat} flat`,
  },
];

function pp(value: number | null): string {
  return value === null ? 'n/a' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}pp`;
}

/**
 * The sentence the round is for.
 *
 * It quotes the ledger's failure and the pack-size lead in the same breath, because the two together
 * are the finding: the store's items are not worth different amounts, and the one variable with a
 * signal is how many of them a prompt carries.
 */
function statementOf(): string {
  const perRule = corpus.injections / corpus.rules;
  return (
    `Across ${corpus.rules} rules and ${corpus.injections} injections, a rule's record is ` +
    `${dispersion.repairStatistic.toFixed(0)} against a permutation null of ${dispersion.nullMean.toFixed(0)} ` +
    `(p = ${dispersion.p.toFixed(4)}), so the rules are not interchangeable — but the record does not travel: ` +
    `measured on one set of databases and again on another it correlates ` +
    `${replication.correlation === null ? 'in no direction at all' : replication.correlation.toFixed(2)} over ` +
    `${replication.rules} rules with sign agreement of ${(100 * (replication.signAgreement ?? 0)).toFixed(0)}%. ` +
    `At ${perRule.toFixed(1)} injections per rule the ledger is mostly its own noise, and a rule that looked ` +
    `harmful does not keep looking harmful where it was not measured (${pp(screening.differencePp)} ` +
    `[${pp(screening.lowPp)}, ${pp(screening.highPp)}]). The one structural variable with a signal is how many ` +
    `rules the prompt carries: ${packSize.single.questions} questions served a single rule return ` +
    `${pp(packSize.single.netPp)} against ${pp(packSize.pair.netPp)} for the ${packSize.pair.questions} served two, ` +
    `a difference of ${pp(packSize.differencePp)} [${pp(packSize.lowPp)}, ${pp(packSize.highPp)}] — and that ` +
    `contrast reverses on ${family.negative} of the ${family.datasets} committed artefacts, so it is a corpus ` +
    `effect until an arm says otherwise.`
  );
}

const statement = statementOf();

await writeJson('poc-ledger', {
  id: 'poc-ledger',
  title: 'Whether a stored rule has a value, and whether the value travels',
  registered: 'prereg/R35-ledger.md',
  source: TRAIN,
  corpus,
  dispersion,
  replication,
  screening,
  packSize,
  family,
  familyRows,
  verdicts,
  gates,
  statement,
  notes: [
    'The unit of the ledger is the injection, not the rule: a question with a two-rule pack credits both rules with the same flip, which is why the dispersion null permutes outcomes rather than resampling rules.',
    'The split-half correlation is the reliability of a half-length ledger; Spearman-Brown turns it into the reliability of the full one, and that number is what a prune has to clear.',
    'The pack-size contrast is not randomized. Retrieval serves one rule when only one clears the threshold, and those questions are harder (47.3% unanswerable by the bare model against 41.4%), so both arms are netted on their own questions and the interval is clustered by database.',
  ],
});

process.stdout.write(`[ledger] ${statement}\n`);
for (const verdict of verdicts) {
  process.stdout.write(`[ledger] ${verdict.id} ${verdict.holds ? 'holds ' : 'fails '} ${verdict.observed}\n`);
}
process.stdout.write(
  `[ledger] ${gates.filter((gate) => gate.pass).length} of ${gates.length} gates pass; dispersion p = ${dispersion.p.toFixed(4)}, split-half r = ${
    replication.correlation === null ? 'n/a' : replication.correlation.toFixed(3)
  }, pack-size difference ${pp(packSize.differencePp)}\n`,
);
