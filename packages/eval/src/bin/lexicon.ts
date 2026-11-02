/**
 * R37's reading, recomputed from the committed artefact and no model call.
 *
 * The arm answered one question — is the grain of a memory write the lever? — and the answer this
 * command has to make checkable is the one that decides what comes next: **the representation reached
 * 8.6% of the split**, because 179 entries written from 547 corrections collapsed to 13 terms any
 * held-out question repeats. That is a statement about the corpus, and it is arithmetic over columns
 * the artefact already carries, so it is recomputed here rather than quoted from a paragraph.
 *
 * Four things are read, and each is a different kind of claim:
 *
 *  - **reach** — how many questions the block reached, how many entries and terms produced that, and
 *    how concentrated it is. This is the statistic the registration's first refutation clause is
 *    written against, and the one that decides whether the delta means anything.
 *  - **the licence** — every rendered line's term re-found in its own question, from the rendered text
 *    rather than from the gate. A representation whose action radius is the question's words can be
 *    checked against the question, so it is.
 *  - **the two deltas** — the arm against no memory and against the rule grain, both from the lane's
 *    own paired arithmetic.
 *  - **the exchange rate** — repairs per break against the bare model's hurdle, because a small
 *    positive delta on a hundred questions is not a payment.
 *
 * The adjudication of P1–P6 is written here, in code, so that a reader cannot pick the clause that
 * flatters the round: the verdicts are fields of the artefact like any other.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { exchangeOf } from '../admission.js';
import { occursIn, termOfLine } from '../lexicon.js';
import { writeJson } from './lib.js';

const COMMITTED = join('eval', 'results');
const SOURCE = process.env['POC_LEXICON_ARTEFACT'] ?? join(COMMITTED, 'poc-sota-bird-dev-R37-lexicon-grain.json');

type Case = {
  readonly dbId: string;
  readonly question: string;
  readonly evidence?: string | null;
  readonly correct: boolean;
  readonly withoutMemoryCorrect: boolean;
  readonly arms: Readonly<Record<string, boolean | undefined>>;
  readonly injectedLexicon?: readonly string[];
};

type Fold = {
  readonly fold: number;
  readonly learn?: number;
  readonly edited?: number;
  readonly lexicon?: {
    readonly entries: number;
    readonly lines: number;
    readonly checked: number;
    readonly unlicensed: number;
    readonly questions: number;
    readonly refused: Readonly<Record<string, number>>;
  } | null;
};

type Artefact = {
  readonly id?: string;
  readonly dataset?: string | null;
  readonly calls?: number;
  readonly n?: { readonly total?: number; readonly databases?: number; readonly learn_mean?: number };
  readonly config?: { readonly prereg?: string | null } | null;
  readonly arms?: readonly {
    readonly arm: string;
    readonly accuracy: number;
    readonly delta_pp: number;
    readonly ci_low_pp: number;
    readonly ci_high_pp: number;
    readonly gained: number;
    readonly lost: number;
    readonly mean_pack_ids: number;
    readonly mean_pack_chars: number;
  }[];
  readonly arm_pairs?: readonly {
    readonly arm: string;
    readonly deltaPp: number;
    readonly ciLowPp: number;
    readonly ciHighPp: number;
    readonly p: number;
    readonly n: number;
    readonly gained: number;
    readonly lost: number;
  }[];
  readonly per_fold?: readonly Fold[];
  readonly per_case?: readonly Case[];
  readonly gates?: readonly { readonly id: string; readonly pass?: boolean }[];
};

const round = (value: number, places = 4): number => Number(value.toFixed(places));

const read = JSON.parse(readFileSync(SOURCE, 'utf8')) as Artefact;
const cases = read.per_case ?? [];
const folds = read.per_fold ?? [];
const armOf = (name: string) => read.arms?.find((entry) => entry.arm === name);
const pairOf = (name: string) => read.arm_pairs?.find((entry) => entry.arm === name);
const lexicon = armOf('full-lexicon');
const rules = armOf('full');
const pair = pairOf('full-lexicon');

if (lexicon === undefined || rules === undefined || pair === undefined) {
  throw new Error(`${SOURCE} is not an R37 artefact: it is missing the arm or the paired contrast`);
}

// --- reach --------------------------------------------------------------------------------------
const covered = cases.filter((entry) => (entry.injectedLexicon ?? []).length > 0);
const terms = new Map<string, number>();
for (const entry of covered) {
  for (const line of entry.injectedLexicon ?? []) {
    const term = termOfLine(line);
    if (term !== undefined) terms.set(term, (terms.get(term) ?? 0) + 1);
  }
}
const ranked = [...terms.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
const entries = folds.reduce((sum, fold) => sum + (fold.lexicon?.entries ?? 0), 0);
const corrections = folds.reduce((sum, fold) => sum + (fold.edited ?? 0), 0);

// --- the licence, re-checked from the rendered text ---------------------------------------------
const unlicensed: { readonly question: string; readonly term: string | undefined }[] = [];
let lines = 0;
for (const entry of covered) {
  for (const line of entry.injectedLexicon ?? []) {
    lines += 1;
    const term = termOfLine(line);
    if (term === undefined || !occursIn(term, entry.question)) unlicensed.push({ question: entry.question, term });
  }
}

// --- the exchange rate, on the arm's own cells --------------------------------------------------
/**
 * Two readings of one payment, and they answer different questions.
 *
 * `split` is the lane's standard measure: every question the arm was scored on, which is what R21's
 * hurdle and R36's two rule arms were also measured over, so it is the only reading comparable to
 * 1.335. `covered` is the 132 questions where the block actually rendered — the only cells the grain
 * could have acted on, and therefore the only place a *rate* means anything about the grain rather
 * than about the arm's coverage.
 *
 * Both are published because reporting only the first hides the second's denominator (a 132-question
 * rate against an 875-cell hurdle is not a ratio), and reporting only the second would break the
 * comparison the hurdle was fixed for. The verdict uses `split` because the registration fixed it
 * that way before the run; the sentence quotes `covered` because that is where the arm was.
 */
const readingOf = (rows: readonly Case[]) => {
  // The lane's own exchange arithmetic (`admission.ts`), over the rows this reading is about: an
  // unanswered question is left out rather than counted as a break, because an arm that stopped
  // answering has not broken anything.
  const cells = rows.flatMap((entry) => {
    const treated = entry.arms['full-lexicon'];
    return treated === undefined
      ? []
      : [{ correct: treated, withoutMemoryCorrect: entry.withoutMemoryCorrect }];
  });
  const read = exchangeOf(cells);
  return {
    questions: read.n,
    repaired: read.repaired,
    broken: read.broken,
    repairable: read.repairable,
    breakable: read.breakable,
    hurdle: read.hurdle === null ? null : round(read.hurdle, 4),
    helpPerHarm: read.helpPerHarm === null ? null : round(read.helpPerHarm, 4),
    clearance: read.clearance === null ? null : round(read.clearance, 4),
  };
};

const coveredRead = readingOf(covered);
const splitRead = readingOf(cases);
const ledger = {
  questions: cases.length,
  databases: read.n?.databases ?? 0,
  learnPerFold: read.n?.learn_mean ?? 0,
  corrections,
  entries,
  entriesPerCorrection: corrections === 0 ? null : round(entries / corrections, 4),
  distinctTerms: terms.size,
  coveredQuestions: covered.length,
  coverageShare: cases.length === 0 ? 0 : round(covered.length / cases.length, 4),
  renderedLines: lines,
  topTwoQuestions: (ranked[0]?.[1] ?? 0) + (ranked[1]?.[1] ?? 0),
  topTerms: ranked.slice(0, 5).map(([term, count]) => ({ term, questions: count })),
  coveredWithEvidence: covered.filter((entry) => (entry.evidence ?? '') !== '').length,
};

// --- the verdicts ------------------------------------------------------------------------------
const REQUIRED_COVERAGE = 0.25;
const REQUIRED_MARGIN_PP = 1;
const HURDLE = 1.335;

const verdicts = [
  {
    id: 'P1',
    claim: 'the arm renders on at least a quarter of the split',
    observed: `${String(covered.length)} of ${String(cases.length)} questions (${(100 * ledger.coverageShare).toFixed(1)}%)`,
    holds: ledger.coverageShare >= REQUIRED_COVERAGE,
  },
  {
    id: 'P2',
    claim: 'the definitional grain beats no memory, clustered',
    observed: `${lexicon.delta_pp.toFixed(2)}pp [${lexicon.ci_low_pp.toFixed(2)}, ${lexicon.ci_high_pp.toFixed(2)}]`,
    holds: lexicon.delta_pp > 0 && lexicon.ci_low_pp > 0,
  },
  {
    id: 'P3',
    claim: 'it beats the rule grain by at least one point',
    observed: `${pair.deltaPp.toFixed(2)}pp [${pair.ciLowPp.toFixed(2)}, ${pair.ciHighPp.toFixed(2)}]`,
    holds: pair.deltaPp >= REQUIRED_MARGIN_PP && pair.ciLowPp > 0,
  },
  {
    id: 'P4',
    claim: 'its exchange rate clears the bare model hurdle',
    observed: `${String(splitRead.clearance)} against ${String(HURDLE)}`,
    holds: splitRead.clearance !== null && splitRead.clearance >= HURDLE,
  },
  {
    id: 'P5',
    claim: 'every rendered term occurs in the question it was rendered for',
    observed: `${String(lines - unlicensed.length)} of ${String(lines)} lines licensed`,
    holds: unlicensed.length === 0 && lines > 0,
  },
  {
    id: 'P6',
    claim: 'the arm cost within a fifth of the rule block, so a delta is not a dose',
    observed: `${rules.mean_pack_chars.toFixed(0)} chars against ${lexicon.mean_pack_chars.toFixed(0)}`,
    holds:
      rules.mean_pack_chars > 0 &&
      Math.abs(lexicon.mean_pack_chars - rules.mean_pack_chars) / rules.mean_pack_chars <= 0.2,
  },
];

const feasibility = !(verdicts[0]?.holds ?? false);
const statement = feasibility
  ? `The grain is not refused and not tested: ${String(covered.length)} of ${String(cases.length)} questions ` +
    `(${(100 * ledger.coverageShare).toFixed(1)}%) carried a definition, because ${String(entries)} entries from ` +
    `${String(corrections)} corrections collapsed to ${String(terms.size)} terms a held-out question repeats. ` +
    `On the ${String(coveredRead.questions)} questions it reached it repaired ${String(coveredRead.repaired)} and broke ` +
    `${String(coveredRead.broken)} (clearance ${String(coveredRead.clearance)} there, ${String(splitRead.clearance)} ` +
    `across the split against the ${String(HURDLE)} hurdle).`
  : `The grain reached ${(100 * ledger.coverageShare).toFixed(1)}% of the split and read ` +
    `${pair.deltaPp.toFixed(2)}pp against the rule grain on [${pair.ciLowPp.toFixed(2)}, ${pair.ciHighPp.toFixed(2)}].`;

const gates = [
  {
    id: 'V64-lexicon-is-licensed',
    criterion:
      'the store holds at least one entry, the arm rendered at least one line, every rendered line ' +
      'carries a readable term, and every term occurs in the question it was rendered for',
    actual:
      `entries=${String(entries)} lines=${String(lines)} unlicensed=${String(unlicensed.length)} ` +
      `refused(${Object.entries(
        folds.reduce<Record<string, number>>((all, fold) => {
          for (const [reason, count] of Object.entries(fold.lexicon?.refused ?? {})) {
            all[reason] = (all[reason] ?? 0) + count;
          }
          return all;
        }, {}),
      )
        .map(([reason, count]) => `${reason}=${String(count)}`)
        .sort()
        .join(', ')})`,
    pass: entries > 0 && lines > 0 && unlicensed.length === 0,
    blocking: true,
  },
  {
    id: 'V65-lexicon-is-feasible',
    criterion: `the arm renders on at least ${String(REQUIRED_COVERAGE * 100)}% of the split, which the registration fixed before the run`,
    actual: `${String(covered.length)} of ${String(cases.length)} questions`,
    pass: ledger.coverageShare >= REQUIRED_COVERAGE,
    blocking: false,
  },
];

const reading = {
  id: 'poc-lexicon',
  title: 'Whether a definitional memory is reachable at all, read from the arm that tried it',
  source: SOURCE,
  sourceGeneratedAt: read.id ?? null,
  registered: read.config?.prereg ?? null,
  dataset: read.dataset ?? null,
  calls: read.calls ?? 0,
  ledger,
  arms: {
    rule: {
      arm: 'full',
      deltaPp: round(rules.delta_pp),
      lowPp: round(rules.ci_low_pp),
      highPp: round(rules.ci_high_pp),
      gained: rules.gained,
      lost: rules.lost,
      meanItems: round(rules.mean_pack_ids),
      meanChars: round(rules.mean_pack_chars, 2),
    },
    lexicon: {
      arm: 'full-lexicon',
      deltaPp: round(lexicon.delta_pp),
      lowPp: round(lexicon.ci_low_pp),
      highPp: round(lexicon.ci_high_pp),
      gained: lexicon.gained,
      lost: lexicon.lost,
      meanItems: round(lexicon.mean_pack_ids),
      meanChars: round(lexicon.mean_pack_chars, 2),
    },
    pair: {
      deltaPp: round(pair.deltaPp),
      lowPp: round(pair.ciLowPp),
      highPp: round(pair.ciHighPp),
      p: round(pair.p, 6),
      gained: pair.gained,
      lost: pair.lost,
    },
  },
  exchange: { split: splitRead, covered: coveredRead },
  verdicts,
  feasibility: { tested: !feasibility, clause: feasibility ? 'inconclusive by feasibility' : 'measured' },
  gates,
  statement,
};

await writeJson('poc-lexicon', reading);
process.stdout.write(
  `[lexicon] ${statement}\n` +
    `[lexicon] entries ${String(entries)} from ${String(corrections)} corrections, ` +
    `${String(terms.size)} terms, ${String(verdicts.filter((verdict) => verdict.holds).length)} of 6 predictions hold\n`,
);
// Only the blocking gate can fail the command: the feasibility gate is advisory by construction,
// because a representation that does not reach far enough is a fact about the corpus, not a defect.
const failed = gates.filter((gate) => gate.blocking && !gate.pass).map((gate) => gate.id);
if (failed.length > 0) process.exitCode = 1;
