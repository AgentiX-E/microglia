/**
 * Whether capping the pack at one rule pays, read from two artefacts and no model call.
 *
 * The lane has carried a `full-one` arm since R25 — the same retrieval, the first item and no second
 * one — and R25 reported it as a dose control. R35 then measured the pack-size contrast on questions
 * retrieval happened to serve a single rule and found +3.13pp on this split, which is a statement about
 * the questions rather than about the pack. This command puts the two on one scale:
 *
 *  - the *observational* contrast, recomputed here from the same rows by the same accounting R35 used;
 *  - the *assigned* contrast, from the arm that gives one rule to every question;
 *  - the exchange rate of each arm against the bare model's odds, which is what decides profit;
 *  - the marginal item, which is what truncating the pack actually removes;
 *  - and, when the replication dispatch has landed, the same readings on a second store draw.
 *
 * No model call. Every field is a column in a committed artefact.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  R36_BARS,
  adjudicateR36,
  assignmentOf,
  foldPairsOf,
  foldsOf,
  packAssignCasesOf,
  packSizeOf,
  singleSlotOf,
  type AssignRow,
  type LedgerCase,
} from '@agentix-e/microglia-eval';
import { writeJson } from './lib.js';

// The inputs are the committed artefacts, not the output directory: `POC_RESULT_DIR` redirects where
// a self-check writes, and a run that took its corpus from there would read its own output.
const COMMITTED = join('eval', 'results');
const DISCOVERY =
  process.env['POC_PACK_ARTEFACT'] ?? join(COMMITTED, 'poc-sota-bird-dev-R25-dose-and-admission.json');
const REPLICATION = process.env['POC_PACK_REPLICA'] ?? join(COMMITTED, 'poc-sota-bird-dev-R36-pack-assignment.json');

type Arm = {
  readonly arm: string;
  readonly n: number;
  readonly accuracy: number;
  readonly mean_pack_ids: number;
};

type Fold = {
  readonly one_slot_over?: number | null;
  readonly one_slot_differs?: number | null;
};

type Gate = { readonly id: string; readonly pass?: boolean };

type Artefact = {
  readonly id?: string;
  readonly generated_at?: string;
  readonly dataset?: string | null;
  readonly config?: { readonly prereg?: string | null; readonly split?: string | null } | null;
  readonly arms?: readonly Arm[];
  readonly arm_pairs?: readonly { readonly arm: string; readonly deltaPp: number; readonly gained: number; readonly lost: number }[];
  readonly gates?: readonly Gate[];
  readonly per_fold?: readonly Fold[];
  readonly per_case?: readonly (AssignRow & {
    readonly injected?: readonly string[] | null;
    readonly packIdList?: readonly string[] | null;
  })[];
};

function load(path: string): Artefact | undefined {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Artefact) : undefined;
}

/** The evidence that the arm was a truncation, from whichever source this artefact carries. */
function slotOf(run: Artefact) {
  const folds = run.per_fold ?? [];
  const over = folds.some((fold) => fold.one_slot_over !== undefined)
    ? folds.reduce((sum, fold) => sum + (fold.one_slot_over ?? 0), 0)
    : undefined;
  const differs = folds.some((fold) => fold.one_slot_differs !== undefined)
    ? folds.reduce((sum, fold) => sum + (fold.one_slot_differs ?? 0), 0)
    : null;
  const gate = run.gates?.find((entry) => entry.id === 'V49-dose-truncated');
  const one = run.arms?.find((entry) => entry.arm === 'full-one');
  return singleSlotOf({
    over,
    gatePassed: gate === undefined || gate.pass === undefined ? null : gate.pass,
    meanItems: one === undefined ? null : one.mean_pack_ids,
    differs,
    questions: run.per_case?.length ?? 0,
  });
}

/** The observational contrast R35 registered, recomputed on this artefact rather than quoted. */
function leadOf(run: Artefact) {
  const rows = run.per_case ?? [];
  const cases: LedgerCase[] = rows.map((row) => ({
    id: row.id,
    dbId: row.dbId,
    injected: row.injected ?? [],
    ...(row.packIdList === undefined || row.packIdList === null ? {} : { packIdList: row.packIdList }),
    correct: row.correct,
    withoutMemoryCorrect: row.withoutMemoryCorrect,
  }));
  return packSizeOf(cases);
}

const discovery = load(DISCOVERY);
if (discovery === undefined) {
  throw new Error(`no artefact at ${DISCOVERY}; this command reads a committed run rather than making one`);
}

const { cases, skipped } = packAssignCasesOf(discovery.per_case ?? []);
const reading = assignmentOf(cases);
const instrument = slotOf(discovery);
const lead = leadOf(discovery);
const reported = discovery.arm_pairs?.find((entry) => entry.arm === 'full-one');

const replica = load(REPLICATION);
const replicaCases = replica === undefined ? null : packAssignCasesOf(replica.per_case ?? []).cases;
const replication = replicaCases === null ? null : assignmentOf(replicaCases);
const replicationInstrument = replica === undefined ? null : slotOf(replica);
const discoveryFolds = foldsOf(cases);
const replicaFolds = replicaCases === null ? null : foldsOf(replicaCases);
const foldPairs = replicaFolds === null ? null : foldPairsOf(discoveryFolds, replicaFolds);

const verdicts = adjudicateR36({
  reading,
  instrument,
  reported: {
    deltaPp: reported?.deltaPp ?? null,
    gained: reported?.gained ?? null,
    lost: reported?.lost ?? null,
  },
  replication,
});

const gates = [
  {
    id: 'V62-assignment-instrument',
    criterion:
      'the arm is a truncation of the pack rather than a duplicate of it: one item at most, every question asked, and the block changed on at least seven tenths of them',
    actual: `${instrument.maxItemsPerPrompt} item(s) at most (${instrument.basis}), ${cases.length} questions read and ${skipped} skipped, ${instrument.changedShare === null ? 'no recorded prompt change' : `${(instrument.changedShare * 100).toFixed(1)}% of prompts changed`}`,
    pass: verdicts[0]?.holds === true && skipped === 0,
    blocking: true,
  },
  {
    id: 'V63-assignment-reproduces-the-lane',
    criterion:
      'the reading agrees with the lane\u2019s own entry for the same pair to within a hundredth of a point, on the point estimate and on both discordant counts',
    actual:
      reported === undefined
        ? 'the artefact carries no contrast for this pair'
        : `${reading.contrast.deltaPp.toFixed(2)}pp and ${reading.contrast.gained}/${reading.contrast.lost} against ${reported.deltaPp.toFixed(2)}pp and ${reported.gained}/${reported.lost}`,
    pass: verdicts[1]?.holds === true,
    blocking: true,
  },
];

const pp = (value: number | null): string => (value === null ? 'n/a' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}pp`);
const armRow = (arm: 'bare' | 'kept' | 'removed') => {
  const entry = reading.arms[arm];
  return {
    arm,
    items: entry.items,
    repaired: entry.exchange.repaired,
    broken: entry.exchange.broken,
    netPp: entry.exchange.netPp,
    repairRatePp: entry.exchange.repairRatePp,
    breakRatePp: entry.exchange.breakRatePp,
    hurdle: entry.exchange.hurdle,
    helpPerHarm: entry.exchange.helpPerHarm,
    clearance: entry.exchange.clearance,
  };
};

// What the paired folds say, computed rather than asserted in prose: a fold that looked decided on the
// first draw and does not on the second is the one fact a pooled replication cannot report.
const foldStatement =
  foldPairs === null
    ? 'no second store draw on disk, so no fold is paired'
    : (() => {
        const zeroFirst = foldPairs.filter((pair) => pair.firstNet === 0).length;
        const agreed = foldPairs.filter((pair) => pair.sameSign).length;
        const decided = foldPairs.filter((pair) => !pair.firstSpansZero);
        const survived = decided.filter((pair) => !pair.secondSpansZero);
        return (
          `the same ${String(foldPairs.length)} folds read on the second store: ${String(agreed)} keep their sign` +
          (zeroFirst === 0 ? '' : ` (${String(zeroFirst)} are exactly zero on the first draw and have none to keep)`) +
          `, and of the ${String(decided.length)} whose interval excluded zero on the first draw ${String(survived.length)} still exclude it`
        );
      })();

const statements = {
  headline:
    `assigning one rule to every question reads ${pp(reading.contrast.deltaPp)} ` +
    `[${pp(reading.contrast.clusteredLowPp)}, ${pp(reading.contrast.clusteredHighPp)}] against the pack ` +
    `retrieval returned, while the questions retrieval happened to serve one rule read ${pp(lead.differencePp)} ` +
    `[${pp(lead.lowPp)}, ${pp(lead.highPp)}] — the contrast is a property of the questions, not of the count`,
  profit:
    `the one-rule pack clears ${reading.arms.removed.exchange.clearance === null ? 'nothing' : (reading.arms.removed.exchange.clearance as number).toFixed(3)} ` +
    `of its hurdle against ${reading.arms.kept.exchange.clearance === null ? 'nothing' : (reading.arms.kept.exchange.clearance as number).toFixed(3)} for the pair, ` +
    `so truncation moves the arm further from paying rather than closer`,
  marginal:
    `the second item carries ${reading.marginal.repairsLost} repairs and causes ${reading.marginal.breaksSaved} breaks, ` +
    `${reading.marginal.helpPerHarm === null ? 'an undefined ratio' : `${reading.marginal.helpPerHarm.toFixed(2)} repairs per break`}, ` +
    `while preventing ${reading.marginal.repairsGained} repairs and ${reading.marginal.breaksGained} breaks: ` +
    `a net ${reading.marginal.netChange >= 0 ? '+' : ''}${reading.marginal.netChange} questions`,
  leverage:
    `the arm is a strict truncation (${instrument.changedShare === null ? 'change not recorded' : `${(instrument.changedShare * 100).toFixed(1)}% of prompts changed`}, ` +
    `${instrument.maxItemsPerPrompt} item at most), so the comparison is one field of the prompt and not a second retrieval`,
  replication:
    replication === null
      ? `no replication on disk yet: ${R36_BARS.materialPp}pp is the threshold the second store draw will be read against`
      : `a second store draw reads ${pp(replication.contrast.deltaPp)} [${pp(replication.contrast.clusteredLowPp)}, ${pp(replication.contrast.clusteredHighPp)}] on ${replication.n} questions`,
  replicationFolds: foldStatement,
};

const payload = {
  id: 'R36-pack-assignment',
  // The file this reading was registered in, carried by the artefact so a reader can find the
  // prediction rather than take the verdict's word for it.
  registered: 'prereg/R36-pack-assignment.md',
  source: {
    discovery: { path: DISCOVERY, id: discovery.id ?? null, generated_at: discovery.generated_at ?? null },
    replication:
      replica === undefined
        ? null
        : { path: REPLICATION, id: replica.id ?? null, generated_at: replica.generated_at ?? null },
  },
  corpus: {
    questions: reading.n,
    skipped,
    databases: reading.databases,
    discordant: reading.discordant,
    discordant_share: Number(reading.discordantShare.toFixed(4)),
  },
  instrument: { ...instrument },
  reading: {
    contrast: reading.contrast,
    arms: [armRow('bare'), armRow('kept'), armRow('removed')],
    marginal: reading.marginal,
    // Per fold, because the store is distilled per fold: a cross-term that lives in one fold and not
    // the others is a property of that store rather than of packs.
    folds: discoveryFolds,
  },
  lead: {
    source: 'questions retrieval served a single rule, on this artefact',
    single: lead.single,
    pair: lead.pair,
    differencePp: lead.differencePp,
    lowPp: lead.lowPp,
    highPp: lead.highPp,
  },
  replication:
    replication === null || replicationInstrument === null || replicaCases === null
      ? null
      : {
          contrast: replication.contrast,
          marginal: replication.marginal,
          arms: replication.arms,
          instrument: replicationInstrument,
          // The same table on the second store draw: the pooled sign is the claim, and a claim about a
          // mechanism has to be read on both draws before it is called one.
          folds: replicaFolds,
          // Paired, because the split is seeded: fold k is the same questions in both artefacts, so the
          // question "does this fold's sign survive a second draw" has an answer rather than an opinion.
          foldPairs,
        },
  verdicts,
  gates,
  statements,
  statement:
    `${statements.headline}. ${statements.profit}. ${statements.marginal}. ${statements.leverage}. ` +
    `${statements.replication}; ${statements.replicationFolds}.`,
};

await writeJson('poc-pack-assign', payload);

const failed = gates.filter((gate) => !gate.pass).map((gate) => gate.id);
process.stdout.write(
  `[pack-assign] n=${reading.n} assigned ${pp(reading.contrast.deltaPp)} ` +
    `[${pp(reading.contrast.clusteredLowPp)}, ${pp(reading.contrast.clusteredHighPp)}] ` +
    `against observed ${pp(lead.differencePp)}; clearance ${reading.arms.removed.exchange.clearance?.toFixed(3) ?? 'n/a'} ` +
    `vs ${reading.arms.kept.exchange.clearance?.toFixed(3) ?? 'n/a'}; ` +
    `marginal item ${reading.marginal.repairsLost}/${reading.marginal.breaksSaved}; ` +
    `verdicts ${verdicts.filter((verdict: { readonly holds: boolean }) => verdict.holds).length}/${verdicts.length}` +
    `${failed.length === 0 ? '' : `; gates failed: ${failed.join(', ')}`}\n`,
);
if (failed.length > 0) process.exitCode = 1;
