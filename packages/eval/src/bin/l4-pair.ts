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
import {
  compareArms,
  resolutionOf,
  tau2ArmRecordOf,
  tau2DetectablePp,
  tau2GateAudit,
  transferReadingOf,
  type Tau2Evidence,
  type TauTrialRow,
} from '@agentix-e/microglia-eval';
import { writeJson } from './lib.js';

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
/** The bar the paired gate holds: the memory must not cost accuracy, at p<0.05. */
const BAR = 0.05;

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

const scenario = second.tau2?.scenario ?? first.tau2?.scenario;

const evidence: Tau2Evidence = {
  domain: scenario?.test ?? DOMAIN,
  trialCount: first.metrics?.k ?? 4,
  reference: tau2ArmRecordOf('reference', first),
  memory: tau2ArmRecordOf('memory', second),
  comparison: {
    paired: comparison.paired,
    onlyFirst: comparison.onlyFirst,
    onlySecond: comparison.onlySecond,
    lost: comparison.lost,
    gained: comparison.gained,
    deltaPp: comparison.deltaPp,
  },
  ...(transfer === undefined ? {} : { transfer: transfer.gate }),
};
const audit = tau2GateAudit(evidence);
const detectablePp = tau2DetectablePp(evidence.comparison);

/**
 * The two conditions that belong to this pair rather than to the instrument.
 *
 * Both block, and both already did: a treatment that cost accuracy is the finding, and two arms on
 * different splits are not a pair. What changed is that the third, advisory one is no longer here
 * to be ignored.
 */
const scenarioGates: readonly ValidityGate[] = [
  {
    id: 'l4-paired',
    criterion: `the memory does not cost accuracy: delta >= 0 at p < ${BAR}`,
    actual: `${comparison.deltaPp.toFixed(2)}pp (p=${comparison.p.toFixed(4)}, n=${comparison.paired})`,
    pass: comparison.deltaPp >= 0 && comparison.p < BAR,
    blocking: true,
  },
  {
    id: 'l4-same-split',
    criterion: 'both arms scored exactly the same tasks',
    actual: `${comparison.onlyFirst} only in first, ${comparison.onlySecond} only in second`,
    pass: splitMatches,
    blocking: true,
  },
];

const gates = mergeGates(audit.gates, scenarioGates, inGateOrder);

await writeJson('poc-l4-pair', {
  id: 'poc-l4-pair',
  title: 'L4 — memory arm against the reference arm on one split, paired per task',
  ranAt: new Date().toISOString(),
  domain: DOMAIN,
  first: { path: FIRST, ranAt: first.ranAt ?? null, pass4: first.metrics?.pass4 ?? null },
  second: { path: SECOND, ranAt: second.ranAt ?? null, pass4: second.metrics?.pass4 ?? null },
  comparison,
  resolution,
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
    'The protocol gates are the shared thirty-nine, not a τ² copy of them; `absent` names the arm each of the rest would need.',
    '`transfer` pairs the two arms episode by episode, so a repair is one episode the control failed and the treatment passed. The treatment is the whole pack: `repaired` says the pack fixed an episode, not which item in it did.',
  ],
});

process.stdout.write(
  `[l4-pair] paired n=${comparison.paired} delta=${comparison.deltaPp.toFixed(2)}pp ` +
    `[${comparison.ciLowPp.toFixed(2)}, ${comparison.ciHighPp.toFixed(2)}] p=${comparison.p.toFixed(4)} ` +
    `lost=${comparison.lost} gained=${comparison.gained}\n`,
);
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
