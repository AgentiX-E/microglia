/**
 * Whether memory is worth keeping for a subpopulation a gate can identify.
 *
 * R33 closed the product on the item: a better rule about *what* the pack says could not beat a wash,
 * because the filter is a difference and the difference realises a sixth of its ceiling. R34 asks the
 * other question, and it is the one the arithmetic points at. A repair can only happen on a question
 * the bare model got wrong and a break only on one it got right, so admitting memory only to the first
 * kind makes the break rate zero by construction. The bar for a gate that does this is `b / (r + b)` —
 * 47.6% precision against a 41.8% base rate — and it can be read off a corpus that already exists.
 *
 * Nothing here calls a model. Every field the six registered gates read is a column in the artefact
 * §146 paid for, which is why a question that decides the product runs on every push for nothing.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mulberry32 } from '@agentix-e/microglia-core';
import {
  R34_BARS,
  admissionGainOf,
  adjudicateR34,
  admitsOf,
  exchangeOf,
  precisionBarOf,
  quantilesOf,
  selfKnowledgeOf,
  splitByDatabase,
  type AdmissionCase,
  type AdmissionReading,
  type ExchangeReading,
  type GateId,
  type GateThreshold,
  type HalfShape,
} from '@agentix-e/microglia-eval';
import { writeJson } from './lib.js';

const TRAIN = process.env['POC_TRAIN_ARTEFACT'] ?? join('eval', 'results', 'poc-sota-bird-train.json');

/** The fields this reading needs. Everything else on a per-case row belongs to another reading. */
type Row = {
  readonly id: string;
  readonly dbId: string;
  readonly question?: string | null;
  readonly coverage?: number | null;
  readonly packIds?: number | null;
  readonly correct: boolean;
  readonly withoutMemoryCorrect: boolean;
};

type CommittedRun = { readonly dataset?: string | null; readonly per_case?: readonly Row[] };

const run = JSON.parse(readFileSync(TRAIN, 'utf8')) as CommittedRun;
const rows = run.per_case ?? [];
const cases: readonly AdmissionCase[] = rows.map((row) => ({
  id: row.id,
  dbId: row.dbId,
  question: row.question ?? '',
  correct: row.correct,
  withoutMemoryCorrect: row.withoutMemoryCorrect,
  coverage: row.coverage ?? 0,
  packIds: row.packIds ?? 0,
}));

const { discovery, confirmation } = splitByDatabase(cases);
const exchange = exchangeOf(cases);
const precisionBar = precisionBarOf(exchange);

/**
 * The gate score is a property of the whole corpus, not of a half.
 *
 * A leave-one-out estimate recomputed inside each half would answer a different question on each side
 * of the wall, and the confirmation number would then be a confirmation of a rule that was never
 * selected on discovery. The neighbour set stays whole; only the questions being judged are split.
 */
const selfKnowledge = selfKnowledgeOf(cases, { k: 10 });

const shapeOf = (label: string, slice: readonly AdmissionCase[]): HalfShape => ({
  label,
  n: slice.length,
  databases: new Set(slice.map((entry) => entry.dbId)).size,
  discordant: slice.filter((entry) => entry.correct !== entry.withoutMemoryCorrect).length,
});

const halves = [shapeOf('discovery', discovery), shapeOf('confirmation', confirmation)];

/** One threshold, scored on both halves, so a curve can be read without re-running anything. */
type Point = {
  readonly value: number;
  readonly coverageFloor: number | null;
  readonly discovery: AdmissionReading;
  readonly confirmation: AdmissionReading;
  /**
   * The exchange rate **inside** the admitted set.
   *
   * This is the quantity the registration's arithmetic assumed was constant, and it is not: a gate
   * that raises precision by selecting failure-dense questions also changes the population those
   * rates are measured on. Reporting it beside the gain is the difference between knowing a gate
   * failed and knowing why.
   */
  readonly withinDiscovery: ExchangeReading;
  readonly withinConfirmation: ExchangeReading;
};

const PERCENTILES = [10, 25, 40, 50, 60, 75] as const;

function sweep(gate: GateId, values: readonly number[], coverageFloor: number | null): readonly Point[] {
  return quantilesOf(values, PERCENTILES).map((value) => {
    const threshold: GateThreshold = coverageFloor === null ? { value } : { value, coverageFloor };
    const admits = (entry: AdmissionCase): boolean => admitsOf(gate, threshold, entry, selfKnowledge.get(entry.id) ?? null);
    return {
      value,
      coverageFloor,
      discovery: admissionGainOf(discovery, admits),
      confirmation: admissionGainOf(confirmation, admits),
      withinDiscovery: exchangeOf(discovery.filter(admits)),
      withinConfirmation: exchangeOf(confirmation.filter(admits)),
    };
  });
}

/** The threshold a gate would ship: the best discovery gain that admits enough to be a decision. */
function selected(points: readonly Point[]): Point | null {
  const eligible = points.filter(
    (point) => point.discovery.share >= R34_BARS.minimumShare && point.discovery.databases >= 5,
  );
  if (eligible.length === 0) return null;
  return eligible.reduce((best, point) =>
    (point.discovery.netPp ?? -Infinity) > (best.discovery.netPp ?? -Infinity) ? point : best,
  );
}

const scoreValues = cases.map((entry) => selfKnowledge.get(entry.id)).filter((value): value is number => value !== null);
const coverageValues = cases.map((entry) => entry.coverage);

const selfKnowledgePoints = sweep('self-knowledge', scoreValues, null);
const coverageHighPoints = sweep('coverage-high', coverageValues, null);
const coverageLowPoints = sweep('coverage-low', coverageValues, null);
const packTwoPoints = sweep('pack-two', [0], null);

const selfKnowledgeChoice = selected(selfKnowledgePoints);
const coverageHighChoice = selected(coverageHighPoints);
const coverageLowChoice = selected(coverageLowPoints);
/** The conjunction borrows both cuts rather than fitting its own: a second grid would be a second search. */
const conjunctionPoints =
  selfKnowledgeChoice === null || coverageHighChoice === null
    ? []
    : sweep('conjunction', scoreValues, coverageHighChoice.value);
const conjunctionChoice = selected(conjunctionPoints);

/** The oracle, and the control, on the same scale as every gate. */
const oracleRepairable = admissionGainOf(cases, (entry) => !entry.withoutMemoryCorrect);
const oracleBreakable = admissionGainOf(cases, (entry) => entry.withoutMemoryCorrect);

const shuffled = mulberry32(20261101);
const drawn = new Map(cases.map((entry) => [entry.id, shuffled()]));
const controlShares = [0.9, 0.75, 0.6, 0.45, 0.3, 0.15] as const;
const confirmationExchange = exchangeOf(confirmation);
const control = controlShares.map((share) => {
  const admits = (entry: AdmissionCase): boolean => (drawn.get(entry.id) ?? 0) < share;
  const reading = admissionGainOf(confirmation, admits);
  const expected = share * (confirmationExchange.netPp ?? 0);
  const deviationPp = Math.abs((reading.netPp ?? 0) - expected);
  const halfWidthPp =
    reading.lowPp === null || reading.highPp === null ? null : (reading.highPp - reading.lowPp) / 2;
  return {
    share,
    admitted: reading.admitted,
    netPp: reading.netPp,
    expectedPp: expected,
    deviationPp,
    halfWidthPp,
    // The amended criterion: the expected value has to lie inside the reading's own interval. A
    // tolerance narrower than the measurement's resolution is a prediction nothing can satisfy.
    covers: halfWidthPp !== null && deviationPp <= halfWidthPp,
  };
});

const readingSummary = (reading: AdmissionReading): Record<string, unknown> => ({
  admitted: reading.admitted,
  share: reading.share,
  databases: reading.databases,
  repaired: reading.repaired,
  broken: reading.broken,
  net: reading.net,
  netPp: reading.netPp,
  perAdmittedPp: reading.perAdmittedPp,
  precision: reading.precision,
  recall: reading.recall,
  lowPp: reading.lowPp,
  highPp: reading.highPp,
  resolves: reading.resolves,
  clears: reading.clears,
});

const exchangeSummary = (value: ExchangeReading): Record<string, unknown> => ({
  n: value.n,
  repairable: value.repairable,
  breakable: value.breakable,
  repaired: value.repaired,
  broken: value.broken,
  repairRatePp: value.repairRatePp,
  breakRatePp: value.breakRatePp,
  net: value.net,
  netPp: value.netPp,
  helpPerHarm: value.helpPerHarm,
  hurdle: value.hurdle,
  clearance: value.clearance,
  requiredRepairRatePp: value.requiredRepairRatePp,
  requiredBreakRatePp: value.requiredBreakRatePp,
});

const verdicts = adjudicateR34({
  halves,
  exchange,
  precisionBar,
  oracle: { repairable: oracleRepairable, breakable: oracleBreakable },
  control,
  primary: {
    discovery: selfKnowledgeChoice?.discovery ?? admissionGainOf(discovery, () => false),
    confirmation: selfKnowledgeChoice?.confirmation ?? admissionGainOf(confirmation, () => false),
  },
  relevance: [
    { id: 'coverage-high', reading: coverageHighChoice?.confirmation ?? admissionGainOf(confirmation, () => false) },
    { id: 'coverage-low', reading: coverageLowChoice?.confirmation ?? admissionGainOf(confirmation, () => false) },
  ],
});

/**
 * Whether the instrument has a corpus under it, which is what a gate can decide.
 *
 * These are not findings. A gate that failed because the answer was unwelcome would be a gate that
 * could only ever pass, and this repository has spent five rounds learning what that costs.
 */
const gates = [
  {
    id: 'V55-admission-loaded',
    pass: cases.length === 7000 && new Set(cases.map((entry) => entry.dbId)).size === 58,
    criterion: 'the committed artefact loads at the registered 7,000 questions over 58 databases',
    actual: `${cases.length} questions, ${new Set(cases.map((entry) => entry.dbId)).size} databases`,
  },
  {
    id: 'V56-admission-split-disjoint',
    pass:
      discovery.length + confirmation.length === cases.length &&
      [...new Set(discovery.map((entry) => entry.dbId))].every(
        (dbId) => !new Set(confirmation.map((entry) => entry.dbId)).has(dbId),
      ),
    criterion: 'the two halves partition the corpus and share no database',
    actual: `${halves.map((half) => `${half.label} ${half.n}/${half.databases}`).join(', ')}`,
  },
  {
    id: 'V57-admission-oracle',
    pass: oracleRepairable.repaired === exchange.repaired && oracleRepairable.broken === 0 &&
      oracleBreakable.broken === exchange.broken && oracleBreakable.repaired === 0,
    criterion: 'the two oracle admissions carry every repair with no break, and the mirror, so the counts agree with the corpus',
    actual: `${oracleRepairable.repaired} repaired and ${oracleRepairable.broken} broken, then ${oracleBreakable.repaired} and ${oracleBreakable.broken}`,
  },
  {
    id: 'V58-admission-control',
    pass: control.every((point) => point.covers),
    criterion:
      'random admission scales with coverage: the expected gain lies inside each reading\'s own clustered interval',
    actual: control
      .map((point) => `${(point.share * 100).toFixed(0)}% ${point.deviationPp.toFixed(3)}pp of ${(point.halfWidthPp ?? 0).toFixed(3)}pp`)
      .join(', '),
  },
];

/**
 * The best point any registered curve reached on the confirmation half.
 *
 * Not a selection — the selection already happened on discovery, and this is the record of what the
 * whole registered family achieved out of sample, so that "no gate cleared" can be read against the
 * ceiling rather than against nothing.
 */
type Frontier = {
  readonly gate: string;
  readonly value: number;
  readonly coverageFloor: number | null;
  readonly point: Point;
};

const allCurves: readonly { gate: string; points: readonly Point[] }[] = [
  { gate: 'self-knowledge', points: selfKnowledgePoints },
  { gate: 'coverage-high', points: coverageHighPoints },
  { gate: 'coverage-low', points: coverageLowPoints },
  { gate: 'pack-two', points: packTwoPoints },
  { gate: 'conjunction', points: conjunctionPoints },
];
const frontier: Frontier | null = allCurves
  .flatMap((curve) => curve.points.map((point) => ({ gate: curve.gate, value: point.value, coverageFloor: point.coverageFloor, point })))
  .reduce<Frontier | null>((best, entry) => {
    if (entry.point.confirmation.netPp === null) return best;
    if (best === null) return entry;
    const bestNet = best.point.confirmation.netPp ?? -Infinity;
    return entry.point.confirmation.netPp > bestNet ? entry : best;
  }, null);

const pct = (value: number | null): string => (value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`);
const pp = (value: number | null): string => (value === null ? 'n/a' : `${value.toFixed(2)}pp`);

/**
 * The sentence the corpus supports, derived rather than written.
 *
 * Four numbers and a conclusion: the hurdle, the best gate the discovery half can find, what it does
 * on the other half, and how far it is from the ceiling admission puts in front of it.
 */
function statementOf(): string {
  const chosen = selfKnowledgeChoice;
  const loose = selfKnowledgePoints[0];
  const tight = selfKnowledgePoints[selfKnowledgePoints.length - 1];
  if (chosen === null || frontier === null || tight === undefined || loose === undefined) {
    return (
      `No gate on this corpus produced an admission that covered ${pct(R34_BARS.minimumShare)} of the questions ` +
      `and five databases, so nothing here can be selected and nothing can be confirmed.`
    );
  }
  const confirmationRead = chosen.confirmation;
  const best = frontier.point.confirmation;
  const repairLow = loose.withinConfirmation.repairRatePp ?? 0;
  const repairHigh = tight.withinConfirmation.repairRatePp ?? 0;
  return (
    `Memory repairs ${pp(exchange.repairRatePp)} of the ${exchange.repairable} questions the bare model got wrong and ` +
    `breaks ${pp(exchange.breakRatePp)} of the ${exchange.breakable} it got right: an exchange of ` +
    `${(exchange.helpPerHarm ?? 0).toFixed(3)} against a hurdle of ${(exchange.hurdle ?? 0).toFixed(3)}, so it is ` +
    `${(100 * (1 - (exchange.clearance ?? 0))).toFixed(0)}% short of paying rather than close to a wash. ` +
    `Admitting only to the questions a self-knowledge gate selects covers ${pct(confirmationRead.share)} of the ` +
    `confirmation half at ${pct(confirmationRead.precision)} precision and returns ${pp(confirmationRead.netPp)} on ` +
    `[${pp(confirmationRead.lowPp)}, ${pp(confirmationRead.highPp)}]. Tightening the gate does not close the gap: ` +
    `across its six thresholds precision climbs from ${pct(loose.confirmation.precision)} to ` +
    `${pct(tight.confirmation.precision)} while the precision the admitted set itself needs climbs from ` +
    `${pct(precisionBarOf(loose.withinConfirmation))} to ${pct(precisionBarOf(tight.withinConfirmation))}, because ` +
    `the break rate inside the set goes from ${pp(loose.withinConfirmation.breakRatePp)} to ` +
    `${pp(tight.withinConfirmation.breakRatePp)} while the repair rate stays inside ` +
    `${pp(Math.min(repairLow, repairHigh))}–${pp(Math.max(repairLow, repairHigh))}. The best point ` +
    `any registered curve reached out of sample is ${pp(best.netPp)} at ${pct(best.share)} coverage on ` +
    `[${pp(best.lowPp)}, ${pp(best.highPp)}], against a ceiling admission puts at ${pp(oracleRepairable.netPp)} ` +
    `— ${((best.netPp ?? 0) / (oracleRepairable.netPp ?? 1) * 100).toFixed(0)}% of it.`
  );
}

await writeJson('poc-admission', {
  id: 'poc-admission',
  title: 'Whether memory is shown to the wrong population',
  registered: 'prereg/R34-admission.md',
  source: TRAIN,
  dataset: run.dataset ?? null,
  corpus: {
    questions: cases.length,
    databases: new Set(cases.map((entry) => entry.dbId)).size,
    discovery: halves[0],
    confirmation: halves[1],
  },
  gates,
  verdicts,
  exchange: {
    all: exchangeSummary(exchange),
    discovery: exchangeSummary(exchangeOf(discovery)),
    confirmation: exchangeSummary(exchangeOf(confirmation)),
  },
  precisionBar,
  ceiling: {
    // Admission can capture the repair rate and removal can eliminate the break rate; the oracle does
    // both, and the two ceilings sum to it. §147 published the second number without the first.
    admissionPp: oracleRepairable.netPp,
    removalPp: oracleBreakable.netPp === null ? null : Math.abs(oracleBreakable.netPp),
    combinedPp:
      oracleRepairable.netPp === null || oracleBreakable.netPp === null
        ? null
        : oracleRepairable.netPp - oracleBreakable.netPp,
  },
  oracle: { repairable: readingSummary(oracleRepairable), breakable: readingSummary(oracleBreakable) },
  control,
  curves: [
    { gate: 'self-knowledge', points: selfKnowledgePoints.map(pointOf) },
    { gate: 'coverage-high', points: coverageHighPoints.map(pointOf) },
    { gate: 'coverage-low', points: coverageLowPoints.map(pointOf) },
    { gate: 'pack-two', points: packTwoPoints.map(pointOf) },
    { gate: 'conjunction', points: conjunctionPoints.map(pointOf) },
  ],
  frontier:
    frontier === null
      ? null
      : {
          gate: frontier.gate,
          value: frontier.value,
          coverageFloor: frontier.coverageFloor,
          precisionBarWithin: precisionBarOf(frontier.point.withinConfirmation),
          shareOfCeiling:
            oracleRepairable.netPp === null || oracleRepairable.netPp === 0
              ? null
              : (frontier.point.confirmation.netPp ?? 0) / oracleRepairable.netPp,
          reading: pointOf(frontier.point),
        },
  selection: {
    'self-knowledge': selfKnowledgeChoice === null ? null : pointOf(selfKnowledgeChoice),
    'coverage-high': coverageHighChoice === null ? null : pointOf(coverageHighChoice),
    'coverage-low': coverageLowChoice === null ? null : pointOf(coverageLowChoice),
    'pack-two': packTwoPoints[0] === undefined ? null : pointOf(packTwoPoints[0]),
    conjunction: conjunctionChoice === null ? null : pointOf(conjunctionChoice),
  },
  statement: statementOf(),
  notes: [
    'The hurdle is not parity. A repair can only happen on a question the bare model got wrong and a break only on one it got right, so the exchange rate that breaks even is the bare odds of being right — 4,075 / 2,925 = 1.393 out of sample. §147 compared 0.79 against 1.0 and read a near miss where the arithmetic shows a 43% shortfall.',
    'Admission is selective classification (Chow 1957; El-Yaniv et al. 2010; Geifman & El-Yaniv 2017) applied to a paired treatment, which makes the perfect-ordering bound sharper than it is for accuracy: admitting the repairable questions first makes the gain 100pp on that sliver and +2.67pp on the corpus. The removal ceiling §147 published is the same bound read from the other side, at 3.39pp.',
    'The self-knowledge gate is SKR (Wang et al., 2023) in lexical form: for each question, the share of its ten most similar questions in the same database that the bare model got wrong. SKR reports 2.91pp and 4.20pp over full retrieval on five benchmarks; the bar here is a 5.85pp lift over the base rate, so a much weaker signal is enough.',
    'Nothing here is a model call. Coverage, pack size and the question text are columns in the artefact R30 stage 2 already paid for, and the outcomes the gate reads are the bare arm\'s, which is the history a deployment would have on the day it decided.',
  ],
});

function pointOf(point: Point): Record<string, unknown> {
  return {
    value: point.value,
    coverageFloor: point.coverageFloor,
    discovery: readingSummary(point.discovery),
    confirmation: readingSummary(point.confirmation),
    within: {
      discovery: exchangeSummary(point.withinDiscovery),
      confirmation: exchangeSummary(point.withinConfirmation),
    },
  };
}

process.stdout.write(`[admission] ${statementOf()}\n`);
for (const gate of gates) {
  process.stdout.write(`[admission] ${gate.pass ? 'PASS' : 'FAIL'} ${gate.id} — ${gate.actual}\n`);
}
for (const verdict of verdicts) {
  process.stdout.write(`[admission] ${verdict.holds ? 'holds ' : 'FAILED'} ${verdict.id} — ${verdict.observed}\n`);
}
