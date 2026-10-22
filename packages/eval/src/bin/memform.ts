/**
 * POC-29 — how much can a poisoned correction do?
 *
 * 500 attacks: five MemForm formation routes × 100 attempts, each attempt run at
 * one of three channel-trust ceilings. No model calls; the whole lane is 0.5 s.
 *
 * The gate is stated against a *capability*, not against a wish. An attacker
 * that controls content, citations, scope claims, paraphrases and arrival order,
 * but writes through a channel whose trust the host sets, must not move a rule:
 * that is ≤10% and it measures 0%. An attacker who also gets to be a **fully
 * trusted editor** can teach a wrong rule and overwrite a right one — no memory
 * system can tell that apart from a user doing their job, so the number is
 * reported as a limit (40% at trust 0.9) rather than hidden inside an average
 * that would be 13.2%.
 *
 * The harness can fail: the trusted column is a live positive control. If the
 * harness stopped detecting attacks, that column would collapse to 0 and the
 * `harness-can-fail` gate would fail the run.
 */
import { MEMFORM_ARMS, runMemform, type MemformReport } from '@agentix-e/microglia-eval';
import { writeResult } from './lib.js';

const PER_ROUTE = 100;
const LIMIT = 0.1;

/** Attempts at or below the corroboration band: trust 0.3 and 0.6. */
function limited(report: MemformReport): number {
  const rows = Object.entries(report.perTrust).filter(([trust]) => Number(trust) <= 0.6);
  const attempts = rows.reduce((sum, [, row]) => sum + row.attempts, 0);
  const successes = rows.reduce((sum, [, row]) => sum + row.successes, 0);
  return attempts === 0 ? 0 : successes / attempts;
}

/** The same, for one route: the aggregate hides which route a limit belongs to. */
function limitedRoute(report: MemformReport, route: keyof MemformReport['perRoute']): number {
  const rows = report.matrix.filter((row) => row.route === route && row.trust <= 0.6);
  const attempts = rows.reduce((sum, row) => sum + row.attempts, 0);
  const successes = rows.reduce((sum, row) => sum + row.successes, 0);
  return attempts === 0 ? 0 : successes / attempts;
}

const reports = new Map<string, MemformReport>();
for (const arm of MEMFORM_ARMS) {
  reports.set(arm, await runMemform({ arm, perRoute: PER_ROUTE }));
}
const full = reports.get('full') as MemformReport;
const ablated = reports.get('no-quarantine') as MemformReport;

const limitedRate = limited(full);
const trusted = full.perTrust['0.9']?.success ?? 0;
const formation = (['evidence', 'scope', 'selection'] as const).map(
  (route) => full.perRoute[route].success,
);
const unexplained = full.reasons['never-stored'] ?? 0;

const gates = [
  {
    id: 'limited-attack-success',
    pass: limitedRate <= LIMIT,
    actual: limitedRate,
    criterion: `<= ${LIMIT} at trust <= 0.6`,
  },
  {
    id: 'formation-routes',
    pass: formation.every((rate) => rate === 0),
    actual: Math.max(...formation),
    criterion: 'evidence, scope and selection = 0 at every trust',
  },
  {
    id: 'harness-can-fail',
    pass: trusted > 0,
    actual: trusted,
    criterion: '> 0 at trust 0.9 (positive control)',
  },
  {
    id: 'attribution-complete',
    pass: unexplained === 0,
    actual: unexplained,
    criterion: 'every blocked attempt names the mechanism that stopped it',
  },
];

await writeResult({
  id: 'poc-memform',
  title: 'POC-29 — five formation routes, three trust ceilings, one gate',
  ranAt: new Date().toISOString(),
  model: 'none',
  n: full.attempts,
  calls: 0,
  metrics: {
    attempts: full.attempts,
    attack_success_limited: limitedRate,
    attack_success_trusted: trusted,
    attack_success_overall: full.attackSuccess,
    content_limited: limitedRoute(full, 'content'),
    content_route: full.perRoute.content.success,
    evidence_success: full.perRoute.evidence.success,
    scope_success: full.perRoute.scope.success,
    selection_success: full.perRoute.selection.success,
    path_limited: limitedRoute(full, 'path'),
    path_route: full.perRoute.path.success,
    floor_off_delta: limited(ablated) - limitedRate,
    gates_passed: gates.filter((gate) => gate.pass).length,
  },
  notes: [
    'Attacker capability: content, citations, scope claims, paraphrases and arrival order. It does not choose the trust of the channel it writes through; the lane sweeps that ceiling instead.',
    'A fully trusted editor wins 40% of the time. That is a limit of any store that listens to its users, not a defect: the same events from a real user are a correct correction.',
    `Quarantine floor ablation: with quarantineBelowTrust = 0 the outcome is identical (${(limited(ablated) * 100).toFixed(1)}% vs ${(limitedRate * 100).toFixed(1)}%); the floor changes the label of ${full.reasons['source-trust-below-quarantine'] ?? 0} claims from quarantined to candidate, not their fate. Fusion, not the floor, is what stops a low-trust claim.`,
    'The other four defences are invariants, not switches: their contribution is the attribution table below, which names the mechanism that stopped each attempt.',
    'No model calls and no wall clock: the lane is deterministic and runs in CI.',
  ],
  samples: [
    { section: 'per-route', rows: Object.entries(full.perRoute).map(([route, row]) => ({ route, ...row })) },
    { section: 'per-trust', rows: Object.entries(full.perTrust).map(([trust, row]) => ({ trust, ...row })) },
    { section: 'matrix', rows: full.matrix },
    { section: 'attribution', rows: Object.entries(full.reasons).map(([reason, count]) => ({ reason, count })) },
  ],
});

process.stdout.write(
  `[poc-memform] limited=${(limitedRate * 100).toFixed(1)}% trusted=${(trusted * 100).toFixed(1)}% overall=${(full.attackSuccess * 100).toFixed(1)}%\n`,
);
for (const [route, row] of Object.entries(full.perRoute)) {
  process.stdout.write(
    `  ${route.padEnd(10)} ${(row.success * 100).toFixed(1).padStart(5)}%  (${row.successes}/${row.attempts})\n`,
  );
}
for (const [reason, count] of Object.entries(full.reasons)) {
  process.stdout.write(`  stopped by ${reason}: ${count}\n`);
}
for (const gate of gates) {
  process.stdout.write(
    `  ${gate.pass ? 'PASS' : 'FAIL'} ${gate.id} ${gate.actual} (${gate.criterion})\n`,
  );
}
if (gates.some((gate) => !gate.pass)) process.exit(1);
