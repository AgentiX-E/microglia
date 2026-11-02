/**
 * R38's reading: was 8.6% the corpus's ceiling, or the store's construction?
 *
 * §153 closed the grain route as *inconclusive by feasibility* and gave a cause — "a definition is
 * reusable only where a corpus reuses a phrase, and this one does not." That is one of two
 * explanations of the same number, and the corpus carries what is needed to separate them: BIRD's
 * own `evidence` block is a store of definitions, keyed by phrases from the questions, present for
 * 90% of the split. Rank its keys by the questions they reach and ask how many are needed to render
 * on a quarter of the split.
 *
 * The first answer this command produced was "two", and it was wrong in a way worth keeping in the
 * record: the two keys were `list` and `name`, each annotated exactly once and each occurring in
 * hundreds of questions. A frontier built from them measures the frequency of English. The
 * separator is now the corpus's own judgement — how often a key is annotated over how often it
 * occurs — and the reading publishes the band three thresholds produce rather than one number.
 *
 * Four readings, each a different claim:
 *
 *  - **the frontier** — reach as a function of distinct keys, raw and over vocabulary, with the
 *    crossings and the ceiling when every key is held.
 *  - **the arm's position** — its 13 terms, the reach its own fold's store licenses, the reach the
 *    renderer delivered, and the difference, which is the budget's cost.
 *  - **the concentration** — a store whose reach sits in one database is not evidence about the
 *    corpus.
 *  - **the redundancy** — entries per distinct term, because a store that spends 179 entries on 13
 *    terms bought 13 reaches and 166 restatements.
 *
 * No model call and no dataset download: every column is in the committed artefact.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  bridgesOf,
  databaseShares,
  frontierGate,
  keysForShare,
  keyStats,
  orderedKeys,
  reachCurve,
  reachOf,
  vocabularyKeys,
  type BridgeCase,
  type CurvePoint,
  type KeyStat,
} from '../frontier.js';
import { occursIn, termOfLine } from '../lexicon.js';
import { writeJson } from './lib.js';

const COMMITTED = join('eval', 'results');
const SOURCE = process.env['POC_FRONTIER_ARTEFACT'] ?? join(COMMITTED, 'poc-sota-bird-dev-R37-lexicon-grain.json');
const LEXICON = join(COMMITTED, 'poc-lexicon.json');

/** The floor the R37 registration fixed before it ran. */
const FLOOR = 0.25;

/**
 * The three densities the artefact publishes.
 *
 * 0.5 is the most generous reading — a key the corpus annotates in at least half the questions that
 * mention it — and it is the one the verdicts use, so a result that only survives a stricter filter
 * cannot be read into the statement. 0.8 and 1.0 are published beside it because the band is the
 * finding: the reach of a vocabulary frontier at the arm's own size is 241, 148 or 78 depending on a
 * threshold, and the arm's 201 sits inside that band.
 */
const DENSITIES = [0.5, 0.8, 1] as const;

type Case = {
  readonly dbId: string;
  readonly fold: string;
  readonly question: string;
  readonly evidence?: string | null;
  readonly injectedLexicon?: readonly string[];
};

const read = JSON.parse(readFileSync(SOURCE, 'utf8')) as {
  readonly per_case: readonly Case[];
  readonly generated_at?: string;
};
const cases: readonly BridgeCase[] = read.per_case.map((entry) => ({
  question: entry.question,
  evidence: entry.evidence ?? undefined,
  database: entry.dbId,
}));
const questions = cases.map((entry) => entry.question);
const share = (covered: number): number =>
  questions.length === 0 ? 0 : Math.round((covered / questions.length) * 10000) / 10000;

// --- the frontier ------------------------------------------------------------------------------
const stats = keyStats(cases);
// The refutation clause that guards the key universe: a frontier is only about the corpus if the three
// annotation shapes read most of the corpus's annotations. Measured here rather than asserted in prose.
const annotated = read.per_case.filter((entry) => (entry.evidence ?? '').trim() !== '').length;
const parsed = read.per_case.filter((entry) => bridgesOf(entry.evidence ?? undefined).length > 0).length;
const parseShare = annotated === 0 ? 0 : Math.round((parsed / annotated) * 10000) / 10000;
const raw = orderedKeys(stats);
const curveOver = (ordered: readonly string[]): readonly CurvePoint[] => {
  const stops = [1, 3, 5, 8, 13, 15, 20, 30, 45, 50, 100, 150, 200, 500, ordered.length]
    .filter((stop, index, all) => stop > 0 && stop <= ordered.length && all.indexOf(stop) === index)
    .sort((left, right) => left - right);
  return reachCurve(ordered, questions, stops);
};
const rawCurve = curveOver(raw);
const at = (curve: readonly CurvePoint[], keys: number): CurvePoint | undefined =>
  curve.find((point) => point.keys === keys);
const keysForFloorRaw = keysForShare(raw, questions, FLOOR);

const bands = DENSITIES.map((density) => {
  const ordered = vocabularyKeys(stats, density);
  const curve = curveOver(ordered);
  return {
    minDensity: density,
    keys: ordered.length,
    curve,
    ceiling: share(curve[curve.length - 1]?.covered ?? 0),
    keysForFloor: keysForShare(ordered, questions, FLOOR),
    topKeys: ordered.slice(0, 10),
  };
});

/** The band the verdicts use: the most generous filter, so nothing depends on being strict. */
const generous = bands[0] as (typeof bands)[number];

// --- the arm's position -------------------------------------------------------------------------
// The store is scoped twice — per fold, and per database — so a question is licensed only by the
// terms its own fold held *for its own database*. Both scopes were wrong in the first version of
// this reading, and each inflated the reach in a way that looked like a finding:
//
//  - against the union of all five folds the arm licensed 201 questions rather than 141, which reads
//    as a store that lost a third of its licensed reach to a character budget;
//  - against the union of a fold's databases it licensed 141 rather than 132, which reads as nine
//    questions that were licensed and silent.
//
// Neither was true. `lexiconByDomain.get(row.db_id)` in the lane is the scope, and a reading that
// does not apply it is measuring a store nobody built. This is `AUDIT` §34.9's defect in a new place:
// a correct computation about the wrong population, found by its own two columns disagreeing.
const storeTerms = new Map<string, Set<string>>();
const armTerms = new Set<string>();
let renderedQuestions = 0;
const keyOf = (fold: string, database: string): string => `${fold}\u0000${database}`;
for (const entry of read.per_case) {
  const lines = entry.injectedLexicon ?? [];
  if (lines.length > 0) renderedQuestions += 1;
  const key = keyOf(entry.fold, entry.dbId);
  const set = storeTerms.get(key) ?? new Set<string>();
  for (const line of lines) {
    const term = termOfLine(line);
    if (term === undefined) continue;
    set.add(term);
    armTerms.add(term);
  }
  storeTerms.set(key, set);
}
let armLicensed = 0;
for (const entry of read.per_case) {
  const store = storeTerms.get(keyOf(entry.fold, entry.dbId)) ?? new Set<string>();
  for (const term of store) {
    if (occursIn(term, entry.question)) {
      armLicensed += 1;
      break;
    }
  }
}
const lexicon = JSON.parse(readFileSync(LEXICON, 'utf8')) as {
  readonly ledger: {
    readonly corrections: number;
    readonly entries: number;
    readonly distinctTerms: number;
    readonly coveredQuestions: number;
  };
};
const terms = [...armTerms].sort();
const entriesPerTerm = terms.length === 0 ? null : lexicon.ledger.entries / terms.length;
const frontierAtArmSize = at(generous.curve, terms.length)?.covered ?? null;

// --- the concentration --------------------------------------------------------------------------
const armShares = databaseShares(terms, cases);
const frontierShares = databaseShares(generous.topKeys, cases);
const databasesTouched = armShares.filter((one) => one.covered > 0).length;
const databases = armShares.length;

// --- the density structure ----------------------------------------------------------------------
// The claim under test is that the corpus defines what it repeats *rarely*, so the sign of the
// relationship between reach and density is the whole finding, not a footnote.
const niche = stats.filter((one) => one.questions <= 3 && one.questions > 0);
const common = stats.filter((one) => one.questions >= 50);
const mean = (rows: readonly KeyStat[]): number =>
  rows.length === 0 ? 0 : Math.round((rows.reduce((sum, one) => sum + one.density, 0) / rows.length) * 10000) / 10000;

// --- the verdicts, written here so no reader picks the clause that flatters the round -------------
const ratio = frontierAtArmSize === null || armLicensed === 0 ? null : frontierAtArmSize / armLicensed;
const verdicts = [
  {
    id: 'P1',
    claim: 'the raw key set crosses the quarter floor within a handful of keys, and the keys that cross it are generic',
    observed: keysForFloorRaw === null
      ? 'no prefix crosses the floor'
      : `${String(keysForFloorRaw)} keys cross it: ${raw.slice(0, keysForFloorRaw).join(', ')}`,
    holds: keysForFloorRaw !== null
      && keysForFloorRaw <= 5
      && raw.slice(0, keysForFloorRaw).every((key) => (stats.find((one) => one.key === key)?.density ?? 0) < 0.1),
  },
  {
    id: 'P2',
    claim: 'at the arm\'s own key count the vocabulary frontier reaches less than twice what the arm\'s store licensed',
    observed: `${String(frontierAtArmSize)} against ${String(armLicensed)} at ${String(terms.length)} keys, ratio ${ratio === null ? 'undefined' : String(Math.round(ratio * 100) / 100)}`,
    holds: ratio !== null && ratio < 2,
  },
  {
    id: 'P3',
    claim: 'even holding every vocabulary key, a quarter of the split is never reached',
    observed: `${String(Math.round(generous.ceiling * 1000) / 10)}% with ${String(generous.keys)} keys at density ${String(generous.minDensity)}`,
    holds: generous.ceiling <= 0.75,
  },
  {
    id: 'P4',
    claim: 'the arm spent its entries redundantly rather than on distinct terms',
    observed: entriesPerTerm === null
      ? 'no terms were rendered'
      : `${String(lexicon.ledger.entries)} entries on ${String(terms.length)} terms, ${String(Math.round(entriesPerTerm * 100) / 100)} per term`,
    holds: entriesPerTerm !== null && entriesPerTerm >= 2,
  },
  {
    id: 'P5',
    claim: 'the corpus annotates the terms it mentions rarely more thoroughly than the words it mentions often',
    observed: `mean density ${String(mean(niche))} at ≤3 questions against ${String(mean(common))} at ≥50`,
    holds: niche.length > 0 && common.length > 0 && mean(niche) > mean(common),
  },
  {
    id: 'P6',
    claim: 'the licence and the renderer agree: every question the store licenses is served',
    observed: `${String(armLicensed)} licensed against ${String(renderedQuestions)} served`,
    holds: armLicensed === renderedQuestions,
  },
] as const;

const gates = [
  frontierGate({ curve: rawCurve, distinctKeys: raw.length, questions: questions.length }),
  {
    id: 'V68-the-annotations-were-parsed',
    pass: parseShare >= 0.5,
    blocking: true,
    detail: `${String(parsed)} of ${String(annotated)} annotated questions yielded a mapping (${String(Math.round(parseShare * 1000) / 10)}%), `
      + `so the key universe is ${parseShare >= 0.5 ? 'the corpus\'s' : 'the parser\'s'}`,
  },
  {
    id: 'V67-the-store-was-redundant',
    pass: entriesPerTerm !== null && entriesPerTerm >= 1,
    blocking: false,
    detail: entriesPerTerm === null
      ? 'no term was rendered, so nothing was bought'
      : `${String(lexicon.ledger.entries)} entries bought ${String(terms.length)} distinct terms`,
  },
];

const statement = `${String(raw.length)} keys annotated over ${String(questions.length)} questions, of which `
  + `${String(stats.filter((one) => one.density < 0.5).length)} are generic; ${String(generous.keys)} carry a definition `
  + `wherever they are used and reach ${String(Math.round(generous.ceiling * 1000) / 10)}% with every key held; `
  + `at the arm's ${String(terms.length)} terms the vocabulary frontier is ${String(frontierAtArmSize ?? 0)} `
  + `and the arm's own store licensed ${String(armLicensed)} and served ${String(renderedQuestions)}; `
  + `${String(parsed)} of ${String(annotated)} annotations parsed.`;

await writeJson('poc-frontier', {
  id: 'poc-frontier',
  title: 'Whether the grain\'s reach was the corpus\'s ceiling or the store\'s construction',
  source: SOURCE,
  sourceGeneratedAt: read.generated_at ?? null,
  questions: questions.length,
  databases,
  ledger: {
    corrections: lexicon.ledger.corrections,
    entries: lexicon.ledger.entries,
    entriesPerTerm: entriesPerTerm === null ? null : Math.round(entriesPerTerm * 10000) / 10000,
    armTerms: terms,
    armLicensed,
    armLicensedShare: share(armLicensed),
    renderedQuestions,
    renderedShare: share(renderedQuestions),
    silentQuestions: Math.max(0, armLicensed - renderedQuestions),
    annotated,
    parsed,
    parseShare,
    distinctKeys: raw.length,
    recurringKeys: stats.filter((one) => one.questions > 1).length,
    genericKeys: stats.filter((one) => one.density < 0.5).length,
    meanDensityNiche: mean(niche),
    meanDensityCommon: mean(common),
  },
  rawFrontier: {
    curve: rawCurve,
    keysForFloor: keysForFloorRaw,
    ceiling: share(rawCurve[rawCurve.length - 1]?.covered ?? 0),
    topKeys: raw.slice(0, 20),
  },
  vocabulary: bands.map((band) => ({
    minDensity: band.minDensity,
    keys: band.keys,
    keysForFloor: band.keysForFloor,
    ceiling: band.ceiling,
    atArmSize: at(band.curve, terms.length)?.covered ?? null,
    curve: band.curve,
    topKeys: band.topKeys,
  })),
  concentration: {
    arm: armShares,
    frontier: frontierShares,
    databasesTouched,
    databases,
  },
  verdicts,
  gates,
  statement,
});

process.stdout.write(
  `[frontier] ${statement}\n`
  + `[frontier] ${String(verdicts.filter((verdict) => verdict.holds).length)} of 6 predictions hold; `
  + `gates ${gates.map((gate) => `${gate.id} ${gate.pass ? 'pass' : 'FAIL'}`).join(', ')}\n`,
);
