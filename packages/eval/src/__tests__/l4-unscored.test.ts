import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The denominator a driver path had been allowed to lose.
 *
 * R92 ran forty held-out tasks on τ² v1.0.1 and published `pass4 0.7586`. Forty-four episodes ended
 * in `INFRASTRUCTURE_ERROR`, eleven tasks therefore had no verdict, and the artefact said
 * `unscored_tasks: 0` because `measureFromDriver` had returned an empty list — the count the driver
 * kept never crossed the boundary. The `l4-fully-scored` gate then read zero and passed.
 *
 * That is the defect class this repository exists to refuse: a denominator that is smaller than the
 * one the reader is told it is. A number computed over 29 of 40 tasks is not the number 40 tasks
 * produced, and a gate that cannot see the difference is a green square over a missing quarter.
 *
 * Two behaviours are pinned here, and the second one is the load-bearing one:
 *
 *   1. when the driver can name its unscored tasks, the artefact carries the count and the ids;
 *   2. when it cannot, the count still crosses — because an instrument that reports zero by default
 *      is worse than one that reports `unknown`, and `sampleGates` has no `unknown`.
 */

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const TSX = join(ROOT, 'node_modules', '.bin', 'tsx');
const L4 = join(ROOT, 'packages', 'eval', 'src', 'bin', 'l4.ts');

/** The size R92 was scored at, and the size a lane is held to. */
const TASKS = 40;
/** How many of them had an infrastructure error and left the denominator. */
const UNSCORED = 11;

/**
 * A driver the bin can import.
 *
 * `run()` reports the tasks that have a verdict, exactly as `scoredArm` does after `toPassAtK` has
 * dropped the unscorable ones — the driver never had the job of inventing a zero for them.
 */
function driverModule(options: {
  readonly scored: number;
  readonly unscored: number;
  readonly exposeIds: boolean;
}): string {
  const rows = Array.from({ length: options.scored }, (_, index) => ({
    taskId: `retail/${String(index)}`,
    successes: 2,
    trials: 2,
    k: 2,
  }));
  const ids = Array.from(
    { length: options.unscored },
    (_, index) => `retail/${String(options.scored + index)}`,
  );
  const counter = `export function instrument() {
  return { unscored: ${String(options.unscored)} };
}
`;
  const named = options.exposeIds
    ? `export function unscoredTasks() {\n  return ${JSON.stringify(ids)};\n}\n`
    : '';
  return `export async function run() {\n  return ${JSON.stringify(rows)};\n}\n${counter}${named}`;
}

function runLane(
  dir: string,
  driver: string,
): { readonly artefact: Record<string, unknown>; readonly code: number } {
  const out = join(dir, 'out');
  let code = 0;
  try {
    execFileSync(TSX, [L4], {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        POC_RESULT_DIR: out,
        TAU_MIN_TASKS: '40',
        TAU_TRIALS: '2',
        TAU_TEST_DOMAIN: 'retail',
        TAU_TRAIN_DOMAIN: 'retail',
        TAU_RECALL_DOMAIN: 'retail',
        TAU_PLANTED_RULES: '',
        TAU_DISTILL_SCOPE: '',
        TAU_MEMORY: 'true',
        TAU_DRIVER: driver,
      },
    });
  } catch (error) {
    code = (error as { status?: number }).status ?? 1;
  }
  return {
    artefact: JSON.parse(readFileSync(join(out, 'poc-l4.json'), 'utf8')) as Record<string, unknown>,
    code,
  };
}

function workdir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe('the driver path and the denominator', () => {
  it('carries the unscored count and names the tasks when the driver can', () => {
    const dir = workdir('l4-unscored-');
    const driver = join(dir, 'driver.ts');
    writeFileSync(
      driver,
      driverModule({ scored: TASKS - UNSCORED, unscored: UNSCORED, exposeIds: true }),
    );

    const { artefact, code } = runLane(dir, driver);
    const metrics = artefact['metrics'] as Record<string, number>;
    const gates = artefact['samples'] as readonly { id: string; pass: boolean; actual: string | number }[];

    expect(metrics['tasks']).toBe(TASKS - UNSCORED);
    expect(metrics['unscored_tasks']).toBe(UNSCORED);
    // The gate that exists to notice exactly this now fails, and the run is red because of it.
    expect(gates.find((gate) => gate.id === 'l4-fully-scored')?.pass).toBe(false);
    expect(String(gates.find((gate) => gate.id === 'l4-fully-scored')?.actual)).toBe(String(UNSCORED));
    expect(code).not.toBe(0);
  });

  it('still carries the count when the driver can only count them', () => {
    // The R92 shape: the count existed in `instrument()` and no id list was ever exported. A lane
    // that reports zero here is the lane that published 0.7586 as a forty-task reading.
    const dir = workdir('l4-unscored-count-');
    const driver = join(dir, 'driver.ts');
    writeFileSync(
      driver,
      driverModule({ scored: TASKS - UNSCORED, unscored: UNSCORED, exposeIds: false }),
    );

    const { artefact } = runLane(dir, driver);
    const metrics = artefact['metrics'] as Record<string, number>;
    const gates = artefact['samples'] as readonly { id: string; pass: boolean }[];

    expect(metrics['unscored_tasks']).toBe(UNSCORED);
    expect(gates.find((gate) => gate.id === 'l4-fully-scored')?.pass).toBe(false);
  });

  it('reports zero only where the driver counted zero', () => {
    // The control for the two cases above: a forty-task grid with every verdict present stays green,
    // so the fix is not a gate that fails every driver.
    const dir = workdir('l4-unscored-none-');
    const driver = join(dir, 'driver.ts');
    writeFileSync(driver, driverModule({ scored: TASKS, unscored: 0, exposeIds: true }));

    const { artefact, code } = runLane(dir, driver);
    const metrics = artefact['metrics'] as Record<string, number>;
    const gates = artefact['samples'] as readonly { id: string; pass: boolean }[];

    expect(metrics['unscored_tasks']).toBe(0);
    expect(gates.find((gate) => gate.id === 'l4-fully-scored')?.pass).toBe(true);
    expect(code).toBe(0);
  });
});
