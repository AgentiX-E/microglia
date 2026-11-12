/**
 * Pair the two L4 arms of one split, task by task, and measure the pair with the shared protocol.
 *
 * Iterations 60-61 measured the memory arm and the reference arm in two dispatches and compared
 * 0.6471 against 0.5882. That is a difference of two means: no interval, no denominator, and no way
 * to tell "the memory costs 5.89 points" from "the two runs disagreed on eight of sixty-eight
 * tasks". This reads both artefacts and pairs them.
 *
 * It reads artefacts rather than runs: the arms cost an hour each, and a pairing step that needed
 * its own run would be a step nobody re-runs.
 *
 * ## What changed in R27 stage 2, and why the three gates became a merge
 *
 * Until this stage the lane wrote three validity conditions of its own — `l4-paired`,
 * `l4-resolution`, `l4-same-split` — while the BIRD lane wrote thirty-nine. `l4-resolution` failed
 * at a 15pp half-width against a 5pp bar and was recorded with `blocking: false`, so the lane
 * published a delta its own instrument had already said it could not resolve. That is the
 * single-customer pathology in miniature: the gate existed, fired, and changed nothing.
 *
 * The lane now supplies the protocol's gates through `tau2GateAudit` and keeps only the two
 * conditions the protocol cannot state, because they are about this pair rather than about the
 * instrument:
 *
 *   - `l4-paired` — the treatment did not cost accuracy, at p < 0.05. That is the **finding**, and
 *     the protocol certifies instruments, not findings.
 *   - `l4-same-split` — both arms scored exactly the same tasks. That is a property of the two
 *     files on disk, which the protocol never sees.
 *
 * `l4-resolution` is gone rather than renamed: the protocol's `V5-resolution` is the same condition
 * computed from the same discordance with the same constant, and it is now blocking.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inGateOrder, mergeGates, type ValidityGate } from '@agentix-e/microglia-protocol';
import { degradationLineOf, degradationOfPair } from '../tau2-degradation.js';
import {
  ceilingOf,
  compareArms,
  resolutionOf,
  tau2ArmRecordOf,
  holdRateOfTrials,
  tau2DetectablePp,
  tau2GateAudit,
  transferReadingOf,
  type Tau2ArmRecord,
  type Tau2ComparisonRecord,
  type Tau2Evidence,
  type TauTrialRow,
} from '@agentix-e/microglia-eval';
import { writeJson } from './lib.js';
import { pairedVerdict } from '../paired-verdict.js';
import { pairGates, plantedBarNote } from '../pair-gates.js';

type TaskRow = { readonly id: string; readonly passed_all: boolean };

type Artefact = {
  readonly n?: number;
  readonly metrics?: { readonly pass4?: number; readonly k?: number; readonly tasks?: number };
  readonly tau2?: {
    readonly meanPackIds?: number;
    readonly calls?: { readonly calls: number; readonly failures: number };
    readonly learning?: {
      readonly rows: number;
      readonly unanswered: number;
      readonly edited: number;
      readonly distillFailed: number;
    };
    readonly domainOrigin?: {
      readonly storedWithDomain: number;
      readonly storedWithoutDomain: number;
      readonly unscopedIn: number;
      readonly widenedIn: number;
    };
    readonly split?: { readonly train: readonly string[]; readonly test: readonly string[] };
    readonly scenario?: { readonly learn: string; readonly test: string; readonly recall: string };
    readonly scenarioTasks?: { readonly learn: number; readonly test: number };
    /** The store's census and the recall tally, when the arm recorded them (R43 onward). */
    readonly store?: Tau2ArmRecord['store'];
    readonly recall?: Tau2ArmRecord['recall'];
    /**
     * R57: the distractor this arm planted. Read from the artefact rather than from the dispatch's
     * environment, because the pair is about the two files: an arm filed under `near` whose artefact
     * carries no plant census planted nothing, and its pair must be graded as the control it was.
     */
    readonly plant?: { readonly arm: string };
  };
  readonly per_task?: readonly TaskRow[];
  /** One row per evaluated episode; absent on artefacts written before R29 stage 2. */
  readonly per_trial?: readonly TauTrialRow[];
  readonly ranAt?: string;
};

const RESULTS = process.env['POC_RESULT_DIR'] ?? join(process.cwd(), 'eval', 'results');
const FIRST = process.env['L4_FIRST'] ?? join(RESULTS, 'arms', 'reference', 'poc-l4.json');
const SECOND = process.env['L4_SECOND'] ?? join(RESULTS, 'arms', 'memory', 'poc-l4.json');
/** The domain the run was scored in; the protocol's strata never read it, but the artefact names it. */
const DOMAIN = process.env['TAU_DOMAIN'] ?? 'retail';

function load(path: string): Artefact {
  if (!existsSync(path)) {
    process.stderr.write(`[l4-pair] missing artefact: ${path}\n`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, 'utf8')) as Artefact;
}

const first = load(FIRST);
const second = load(SECOND);

for (const [label, artefact, path] of [
  ['first', first, FIRST],
  ['second', second, SECOND],
] as const) {
  if (artefact.per_task === undefined || artefact.per_task.length === 0) {
    // Per-task outcomes are what makes a pair possible. An artefact without them is
    // from a run that predates the field, and silently pairing nothing would report
    // "no difference" for two arms that were never compared.
    process.stderr.write(`[l4-pair] ${label} artefact has no per_task rows: ${path}\n`);
    process.exit(1);
  }
}

const comparison = compareArms(
  (first.per_task ?? []).map((row) => ({ id: row.id, passedAll: row.passed_all })),
  (second.per_task ?? []).map((row) => ({ id: row.id, passedAll: row.passed_all })),
);

const splitMatches = comparison.onlyFirst === 0 && comparison.onlySecond === 0;
const resolution = resolutionOf(comparison);
/**
 * The ceiling the scenario imposes, read from whichever arm recorded the listing.
 *
 * Both arms list the same scenarios, so either arm's record answers it; the first one that has it
 * wins rather than the two being compared, because a disagreement would be a defect in the listing
 * and not a question this file can settle.
 */
const scenarioTasks = first.tau2?.scenarioTasks ?? second.tau2?.scenarioTasks;
const ceiling = scenarioTasks === undefined ? undefined : ceilingOf(comparison, scenarioTasks.test);
/**
 * Which scenario the pair ran, read from the arms rather than from the environment.
 *
 * `TAU_DOMAIN` used to supply this, and on the cross-domain dispatch it was unset while both arms
 * were answering `airline`: the pair's own `domain` field said `retail` about a run that never
 * scored a retail task. An artefact that names the wrong scenario is the same defect as a gate that
 * grades one scenario against another's bar, one step earlier.
 */
const scenario = second.tau2?.scenario ?? first.tau2?.scenario;

/**
 * The transfer reading, when both artefacts carry their episodes.
 *
 * Absent on a within-scenario pair, and that absence is a statement rather than a gap: a store
 * answering the corpus it learned from has not transferred anything, so the four gates it would
 * supply do not apply. On a cross-domain pair it is the round's whole measurement — how many of the
 * control arm's failures the foreign pack repaired, how many of its successes it broke, and whether
 * either count is large enough to be a rate rather than a direction.
 */
const transfer =
  first.per_trial === undefined || second.per_trial === undefined
    ? undefined
    : transferReadingOf({
        reference: first.per_trial,
        memory: second.per_trial,
        store: second.tau2?.scenario?.learn ?? second.tau2?.scenario?.test ?? DOMAIN,
      });

const comparisonRecord: Tau2ComparisonRecord = {
  paired: comparison.paired,
  onlyFirst: comparison.onlyFirst,
  onlySecond: comparison.onlySecond,
  lost: comparison.lost,
  gained: comparison.gained,
  deltaPp: comparison.deltaPp,
};

const detectablePp = tau2DetectablePp(comparisonRecord);

/**
 * What this pair is allowed to say, decided before the gates are written.
 *
 * R50: `l4-paired` used to pass only on `delta >= 0 && p < 0.05`, a condition the
 * pair's own minimum detectable difference made unreachable. R49 graded it FAIL
 * at -4.00pp against an MDE of 13.73pp — a verdict that says the memory is broken
 * when what it actually says is that 50 paired tasks cannot see an effect that
 * small. The gate now mirrors the R45 revert rule (harm) and the readout carries
 * the resolution it can honestly claim. See `paired-verdict.ts`.
 *
 * R52 moved it above the evidence, because the evidence now carries the claim: the
 * protocol's `V5-resolution` grades whether a run claimed more than its sample can
 * resolve, and the only place that answer exists is here.
 */
/**
 * The distractor the memory arm planted, read from the arm's own artefact.
 *
 * `second` is the memory arm by construction (the order is stated where the two paths are read). An
 * arm that planted one is graded by its plant census and its per-episode ledger rather than by the
 * treatment's harm branch, which for that arm is its registered prediction; see `pair-gates.ts`.
 *
 * Read before the evidence rather than after it, because the claim described below is a statement
 * about this arm and the evidence is where the protocol reads it. The first version of this change
 * read the artefact after the evidence that consumed it, which is a temporal dead zone rather than a
 * wrong answer — `l4-planted-arm.test.ts` caught it on the first run, and the reason it caught it is
 * that it runs the bin instead of the module.
 */
const plantedArm = second.tau2?.plant?.arm;
const served = second.tau2?.recall?.served ?? 0;
const verdict = pairedVerdict({
  deltaPp: comparison.deltaPp,
  p: comparison.p,
  paired: comparison.paired,
  servedPacks: served,
  detectablePp: detectablePp ?? Number.POSITIVE_INFINITY,
});

const evidence: Tau2Evidence = {
  domain: scenario?.test ?? DOMAIN,
  trialCount: first.metrics?.k ?? 4,
  reference: tau2ArmRecordOf('reference', first),
  memory: tau2ArmRecordOf('memory', second),
  comparison: comparisonRecord,
  // R52: the protocol grades the claim, not the sample. `null` where the pair concluded nothing is
  // the point of the field — without it, `V5` would read this pair's silence as a lane that never
  // reports claims and fall back to the 6pp bar this scenario cannot meet at any n.
  // R57: a planted arm publishes no direction, so `null` here is a statement about the arm rather
  // than a claim it declined to make. The sentence HARM carries — "the memory costs accuracy" — is
  // false of a pair whose loss came from a rule we planted on purpose, and the protocol's resolution
  // gate is right to refuse it: `V5` blocks a published direction the sample cannot resolve, and
  // -7.02pp against a 20.86pp minimum detectable difference is exactly that. Suppressing the claim is
  // what makes the artefact true; suppressing the gate would have left the sentence standing.
  claimPp: plantedArm !== undefined || verdict.state === 'UNRESOLVED' ? null : comparison.deltaPp,
  ...(transfer === undefined ? {} : { transfer: transfer.gate }),
};
const audit = tau2GateAudit(evidence);

const scenarioGates: readonly ValidityGate[] = pairGates({
  state: verdict.state,
  claim: verdict.claim ?? null,
  deltaPp: comparison.deltaPp,
  p: comparison.p,
  paired: comparison.paired,
  served,
  detectablePp,
  splitMatches,
  onlyFirst: comparison.onlyFirst,
  onlySecond: comparison.onlySecond,
  ...(plantedArm === undefined ? {} : { plantedArm }),
});

const gates = mergeGates(audit.gates, scenarioGates, inGateOrder);

// Retention, per arm, from the episode ledger each arm wrote.
//
// `pass^4` says how often a task held on all four trials; this says how often a task that passed a trial
// passed the next one, which is the number the published continual-learning result reports beside it
// (*Learning on the Job*, arXiv 2607.22157; hold rate 0.88 for outcome feedback, 0.65 for verified
// corrections). The two move separately — an arm can hold every pair it opens and still lose a task by
// opening none — so the pair carries both rather than one replacing the other.
//
// It is computed from `per_trial` rather than from `per_task`: the ledger keeps `{id, trial, reward}`,
// which is the order, and every artefact published before `per_task` gained `outcomes` carries the
// ledger and not the order. A run whose artefact carries neither reports `undefined` rather than a zero
// it did not measure.
// R88: the field's own metric, on every pair rather than only on a transfer. `pass^4` calls a task
// lost when one of its four trials fails and hides that three were unharmed; the share of trials the
// reference passed that the memory arm failed is the number `Don't Just Trust Your Memory` reports as
// 52% of memory-induced failures, and this lane has never published it for a within-domain pair.
const degradation =
  first.per_trial === undefined || second.per_trial === undefined
    ? undefined
    : degradationOfPair(first.per_trial, second.per_trial, second.tau2?.scenario?.learn ?? DOMAIN);
process.stdout.write(`${degradationLineOf(degradation)}\n`);

const retain = (artefact: Artefact) =>
  artefact.per_trial === undefined ? undefined : holdRateOfTrials(artefact.per_trial);
const firstHeld = retain(first);
const secondHeld = retain(second);
const retention =
  firstHeld === undefined || secondHeld === undefined
    ? undefined
    : // `second` is the memory arm by construction, the same order the comparison uses.
      { reference: firstHeld, memory: secondHeld };

await writeJson('poc-l4-pair', {
  id: 'poc-l4-pair',
  title: 'L4 — memory arm against the reference arm on one split, paired per task',
  ranAt: new Date().toISOString(),
  // The scenario the arms answered, which is the only domain this pair can be about.
  domain: scenario?.test ?? DOMAIN,
  first: { path: FIRST, ranAt: first.ranAt ?? null, pass4: first.metrics?.pass4 ?? null },
  second: { path: SECOND, ranAt: second.ranAt ?? null, pass4: second.metrics?.pass4 ?? null },
  comparison,
  ...(retention === undefined ? {} : { retention }),
  // The degradation reading, unconditionally: it is the only number in this artefact that says how
  // many trials the treatment broke rather than how many tasks it changed.
  ...(degradation === undefined
    ? {}
    : {
        degradation: {
          broke: degradation.broke,
          repaired: degradation.repaired,
          blankRight: degradation.blankRight,
          measured: degradation.measured,
          breakRate: degradation.breakRate,
          netPp: degradation.netPp,
        },
      }),
  // R57: the distractor this pair is about, when the memory arm planted one. Without it a reader sees
  // a pair artefact with no treatment gate and no reason for the omission.
  ...(plantedBarNote(plantedArm) ?? {}),
  // R50: what the pair establishes, in one of three states, decided by the same
  // two numbers the report prints. `claim` is null unless a direction is
  // supported, so a reader cannot concatenate an unsupported sentence into a
  // result.
  verdict: {
    state: verdict.state,
    // The state stays — it is the registered revert rule's answer and a reader needs to see that the
    // rule fired — but the sentence that turns it into a claim about the memory does not, because on
    // a planted arm the loss is the distractor's and saying otherwise misattributes it.
    claim: plantedArm === undefined ? verdict.claim : null,
    reason: verdict.reason,
    excludedAbovePp: verdict.excludedAbovePp,
    servedPacks: served,
  },
  resolution,
  // What the scenario itself could decide, when the arms listed it. `tasksForFivePp` is a
  // requirement; this is the supply, and on τ² the two do not meet: retail carries 115 tasks and a
  // 5pp half-width at the observed discordance takes several hundred, so no split of it reaches the
  // bar. Absent on artefacts that did not record the listing, which is every run before R42.
  ...(ceiling === undefined ? {} : { ceiling }),
  // The statistic the protocol's resolution gate reads, beside the interval this lane has always
  // quoted. They differ by 2.802/1.96 = 1.43, and reporting only one of them is how a 15pp
  // half-width became a 21pp minimum detectable difference without anybody noticing.
  protocol: {
    detectablePp: detectablePp ?? null,
    evaluable: audit.evaluable,
    vacuous: audit.vacuous,
    absent: audit.absent,
    supplyable: audit.supplyable,
    armIndexed: audit.armIndexed,
  },
  gates,
  // Where each half ran, when the arms recorded it. A reader of a cross-domain pair has to be able
  // to see the two scenario names without opening both arm files.
  ...(scenario === undefined ? {} : { scenario }),
  // The transfer measurement with its ledger: the aggregate says how often, the rows say where. The
  // ledger is committed with the artefact because the first version of it lived in a record the
  // artefact never serialised, and a rate was published with no pairs behind it.
  ...(transfer === undefined
    ? {}
    : {
        transfer: {
          store: second.tau2?.scenario?.learn ?? null,
          // What the store held when recall began. A `repaired` count of zero means one thing when
          // the store carried forty items and another when it carried none, and the pair used to
          // leave a reader to open the arm file to tell them apart.
          storeItems:
            (second.tau2?.domainOrigin?.storedWithDomain ?? 0) +
            (second.tau2?.domainOrigin?.storedWithoutDomain ?? 0),
          paired: transfer.paired,
          orphanMemory: transfer.orphanMemory,
          informative: transfer.gate.informative,
          repaired: transfer.gate.repaired,
          broke: transfer.gate.broke,
          blankRight: transfer.gate.blankRight,
          unmeasured: transfer.gate.unmeasured,
          measured: transfer.gate.measured,
          netPp: transfer.gate.netPp,
          verdict: transfer.gate.verdict,
          // The rows, one per episode, which is what `V33` counts.
          ledger: transfer.episodes,
        },
      }),
  notes: [
    '`deltaPp` is second - first, so a negative number means the second arm (memory) did worse.',
    'pass^4 per task is the k=4 reading: a task counts only when all four trials passed.',
    'The pair is defined on the intersection of task ids; tasks scored by one arm only are counted, not dropped silently.',
    'Published reference for scale: ALTK-Evolve pass^4 = 0.575 on tau2-retail.',
    'The protocol gates are the shared forty, not a τ² copy of them; `absent` names the arm each of the rest would need.',
    'Call reliability is graded over the population the arm recorded: `calls.scope` is `distillation` when the episodes\u2019 tally came from a process that does not report one.',
    '`transfer` pairs the two arms episode by episode, so a repair is one episode the control failed and the treatment passed. The treatment is the whole pack: `repaired` says the pack fixed an episode, not which item in it did.',
  ],
});

process.stdout.write(
  `[l4-pair] paired n=${comparison.paired} delta=${comparison.deltaPp.toFixed(2)}pp ` +
    `[${comparison.ciLowPp.toFixed(2)}, ${comparison.ciHighPp.toFixed(2)}] p=${comparison.p.toFixed(4)} ` +
    `lost=${comparison.lost} gained=${comparison.gained}\n`,
);
process.stdout.write(`[l4-pair] verdict ${verdict.state}: ${verdict.claim ?? verdict.reason}\n`);
if (transfer !== undefined) {
  process.stdout.write(
    `[l4-pair] transfer: ${transfer.gate.repaired} repaired, ${transfer.gate.broke} broken of ` +
      `${transfer.gate.measured} measured (${transfer.gate.informative} informative), ` +
      `net ${transfer.gate.netPp.toFixed(2)}pp, verdict \`${transfer.gate.verdict}\`\n`,
  );
}
process.stdout.write(
  `[l4-pair] protocol: ${audit.evaluable.length} gate(s) fired, ${audit.vacuous.length} vacuous, ` +
    `${audit.absent.length} absent (${audit.supplyable} supplyable, ${audit.armIndexed} arm-indexed), ` +
    `minimum detectable ${detectablePp === undefined ? 'not estimable' : `${detectablePp.toFixed(2)}pp`}\n`,
);
for (const gate of gates) {
  process.stdout.write(`[l4-pair] ${gate.pass ? 'PASS' : 'FAIL'} ${gate.id}: ${gate.actual}\n`);
}

if (gates.some((gate) => gate.blocking && !gate.pass)) process.exitCode = 1;
