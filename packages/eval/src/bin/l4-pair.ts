/**
 * Pair the two L4 arms of one split, task by task.
 *
 * Iterations 60-61 measured the memory arm and the reference arm in two dispatches and
 * compared 0.6471 against 0.5882. That is a difference of two means: no interval, no
 * denominator, and no way to tell "the memory costs 5.89 points" from "the two runs
 * disagreed on eight of sixty-eight tasks". This reads both artefacts and pairs them.
 *
 * It reads artefacts rather than runs: the arms cost an hour each, and a pairing step
 * that needed its own run would be a step nobody re-runs.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compareArms, resolutionOf } from '@agentix-e/microglia-eval';
import { writeJson } from './lib.js';

type TaskRow = { readonly id: string; readonly passed_all: boolean };

type Artefact = {
  readonly n?: number;
  readonly metrics?: { readonly pass4?: number; readonly pass4_ci_low?: number; readonly pass4_ci_high?: number };
  readonly per_task?: readonly TaskRow[];
  readonly ranAt?: string;
};

const RESULTS = process.env['POC_RESULT_DIR'] ?? join(process.cwd(), 'eval', 'results');
const FIRST = process.env['L4_FIRST'] ?? join(RESULTS, 'arms', 'reference', 'poc-l4.json');
const SECOND = process.env['L4_SECOND'] ?? join(RESULTS, 'arms', 'memory', 'poc-l4.json');
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
const gates = [
  {
    id: 'l4-paired',
    criterion: `memory - reference >= 0 at p < ${BAR}`,
    actual: `${comparison.deltaPp.toFixed(2)}pp (p=${comparison.p.toFixed(4)}, n=${comparison.paired})`,
    pass: comparison.deltaPp >= 0 && comparison.p < BAR,
    blocking: true,
  },
  {
    id: 'l4-resolution',
    criterion: 'the design can detect a 5pp difference: 95% half-width <= 5pp',
    actual: `±${resolution.halfWidthPp.toFixed(1)}pp at n=${comparison.paired} (needs ~${resolution.tasksForFivePp} tasks)`,
    pass: resolution.detectableAtFivePp,
    // Advisory, not blocking: an unresolvable run is still a run, and refusing to publish
    // it would leave the sample size unmeasured. What it cannot do is support a 5pp claim,
    // and this is the line that says so.
    blocking: false,
  },
  {
    id: 'l4-same-split',
    criterion: 'both arms scored exactly the same tasks',
    actual: `${comparison.onlyFirst} only in first, ${comparison.onlySecond} only in second`,
    pass: splitMatches,
    blocking: true,
  },
];

await writeJson('poc-l4-pair', {
  id: 'poc-l4-pair',
  title: 'L4 — memory arm against the reference arm on one split, paired per task',
  ranAt: new Date().toISOString(),
  first: { path: FIRST, ranAt: first.ranAt ?? null, pass4: first.metrics?.pass4 ?? null },
  second: { path: SECOND, ranAt: second.ranAt ?? null, pass4: second.metrics?.pass4 ?? null },
  comparison,
  resolution,
  gates,
  notes: [
    '`deltaPp` is second - first, so a negative number means the second arm (memory) did worse.',
    'pass^4 per task is the k=4 reading: a task counts only when all four trials passed.',
    'The pair is defined on the intersection of task ids; tasks scored by one arm only are counted, not dropped silently.',
    `Published reference for scale: ALTK-Evolve pass^4 = 0.575 on tau2-retail.`,
  ],
});

process.stdout.write(
  `[l4-pair] paired n=${comparison.paired} delta=${comparison.deltaPp.toFixed(2)}pp ` +
    `[${comparison.ciLowPp.toFixed(2)}, ${comparison.ciHighPp.toFixed(2)}] p=${comparison.p.toFixed(4)} ` +
    `lost=${comparison.lost} gained=${comparison.gained}\n`,
);
for (const gate of gates) {
  process.stdout.write(`[l4-pair] ${gate.pass ? 'PASS' : 'FAIL'} ${gate.id}: ${gate.actual}\n`);
}

if (gates.some((gate) => gate.blocking && !gate.pass)) process.exitCode = 1;
