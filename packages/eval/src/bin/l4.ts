/**
 * L4 — τ²-bench, pass^4, against ALTK-Evolve on the same split.
 *
 * The statistics are implemented and tested (`passk.ts`): the unbiased
 * `C(c,k)/C(n,k)` estimator, the mean over tasks, and a comparison that only
 * "meets" a published number through a stated bar. What is **not** here is the
 * environment: τ²-retail and τ²-airline need a tool-calling sandbox and a user
 * simulator, and this sandbox cannot reach either.
 *
 * So the lane refuses to invent a number. With `TAU_DRIVER` unset it writes an
 * artefact that says `not-run`, and exits 0 — a missing environment is not a
 * failed gate, and it must not look like one in the record. When the driver
 * exists, the workflow runs it and the same gates apply.
 */
import { compareToPublished, meanPassAtK, type PassAtKInput } from '@agentix-e/microglia-eval';
import { writeResult } from './lib.js';

const PUBLISHED = 0.575; // ALTK-Evolve, τ²-retail, pass^4 on the same split.
const BAR = 0.05;
const K = 4;
const driver = process.env['TAU_DRIVER'];

if (driver === undefined) {
  await writeResult({
    id: 'poc-l4',
    title: 'L4 — τ²-bench pass^4 (not run: no environment)',
    ranAt: new Date().toISOString(),
    model: 'none',
    n: 0,
    calls: 0,
    metrics: { status_not_run: 1, published_pass4: PUBLISHED, bar: BAR, k: K },
    notes: [
      'The metric layer is live (passk.ts, four tests): the unbiased estimator, the task mean, and a bar-gated comparison.',
      'No result is claimed. τ²-retail and τ²-airline need a tool-calling sandbox and a user simulator; this lane reports not-run rather than a zero it did not measure.',
      'Set TAU_DRIVER to a module exporting run(): Promise<readonly PassAtKInput[]> and the sota workflow will run it and apply the same gates.',
    ],
  });
  process.stdout.write('[poc-l4] not-run: no TAU_DRIVER; metric layer verified separately\n');
  process.exit(0);
}

const module_ = (await import(driver)) as { run: () => Promise<readonly PassAtKInput[]> };
const tasks = await module_.run();
const measured = meanPassAtK(tasks);
const compared = compareToPublished(measured, PUBLISHED, BAR);
const gates = [
  { id: 'l4-pass4', pass: compared.meets, actual: measured, criterion: `>= published + ${BAR}` },
  { id: 'l4-coverage', pass: tasks.length >= 60, actual: tasks.length, criterion: '>= 60 tasks' },
];
await writeResult({
  id: 'poc-l4',
  title: 'L4 — τ²-bench pass^4 against ALTK-Evolve',
  ranAt: new Date().toISOString(),
  model: process.env['TAU_MODEL'] ?? 'unknown',
  n: tasks.length,
  calls: 0,
  metrics: {
    pass4: measured,
    published_pass4: PUBLISHED,
    delta: compared.delta,
    tasks: tasks.length,
    gates_passed: gates.filter((gate) => gate.pass).length,
  },
  notes: ['Two arms share the split; the reference number is ALTK-Evolve on τ²-retail.'],
  samples: gates,
});
for (const gate of gates) process.stdout.write(`  ${gate.pass ? 'PASS' : 'FAIL'} ${gate.id} ${gate.actual}\n`);
if (gates.some((gate) => !gate.pass)) process.exit(1);
