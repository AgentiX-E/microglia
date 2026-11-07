import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { readFacadePairArtifact } from '../facade-pair.js';

/**
 * The L4 lane's R49 wiring, end to end.
 *
 * Pure tests prove the verdict is right; this proves the lane actually WRITES
 * it. `l4.ts` is a CLI entrypoint that loads a driver dynamically, writes two
 * artefacts and exits, so the only honest test is to run it with a stand-in
 * driver at the process boundary. The stand-in is a driver module, not a mock
 * of the code under test: it calls the real production functions to build its
 * reading, and the lane, the artefact writer and the gates are the real ones.
 *
 * Two shapes matter: a registered PAIRED dispatch must produce its own
 * artefact, and a provider refusal must produce an explicit no-measurement
 * artefact that is NOT a not-run and NOT a result.
 */
const run = promisify(execFile);
const REPO = join(process.cwd());
const LANE = join(REPO, 'packages/eval/src/bin/l4.ts');
const DIST = pathToFileURL(join(REPO, 'packages/eval/dist/index.js')).href;

const DRIVER_PAIRED = `
const tasks = [
  { taskId: 'airline/001', successes: 4, trials: 4, k: 4 },
  { taskId: 'airline/002', successes: 4, trials: 4, k: 4 },
];
const scope = {
  dispatchId: 'l4-facade-pair-smoke',
  preregId: 'R49-within-run-pair',
  storeFingerprint: 'store:smoke',
  learnSplit: ['retail/001'],
  testSplit: ['airline/001', 'airline/002'],
  seed: 300,
  trials: 4,
  model: 'stub-model',
};
const verdict = {
  state: 'PAIRED',
  contrast: {
    kind: 'facade-contrast',
    comparison: {
      paired: 2, onlyFirst: 0, onlySecond: 0,
      deltaPp: 0, ciLowPp: 0, ciHighPp: 0, p: 1, lost: 0, gained: 0,
    },
    floor: 0.01,
    servedPacks: { asIs: 2, floored: 2 },
  },
  reason: 'within-run pair on 2 tasks; floor 0.01 delivered 2 packs against 2 as-is',
};
export async function run() { return tasks; }
export function pairedFacades() {
  return {
    dispatchId: 'l4-facade-pair-smoke',
    preregId: 'R49-within-run-pair',
    floors: { asIs: 0, floored: 0.01 },
    scope,
    servedPacks: { asIs: 2, floored: 2 },
    pass4: { asIs: 1, floored: 1 },
    verdict,
    treatmentDelivered: true,
    seed: 300,
    model: 'stub-model',
  };
}
`;

const DRIVER_NO_MEASUREMENT = `
export async function run() {
  const error = new Error('the provider answered 5xx on every pre-flight call');
  error.name = 'ProviderNoMeasurementError';
  error.marker = {
    status_no_measurement: 1,
    status_not_run: 0,
    claim: 'none',
    reason: error.message,
  };
  throw error;
}
`;

async function lane(
  driverSource: string,
): Promise<{ readonly stdout: string; readonly stderr: string; readonly dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'l4-facade-pair-'));
  const driverPath = join(dir, 'stub-driver.ts');
  writeFileSync(driverPath, driverSource, 'utf8');
  const { stdout, stderr } = await run('pnpm', ['exec', 'tsx', LANE], {
    cwd: REPO,
    env: {
      ...process.env,
      TAU_DRIVER: driverPath,
      POC_RESULT_DIR: dir,
      TAU_MIN_TASKS: '1',
      TAU_TEST_DOMAIN: 'airline',
      TAU_MODEL: 'stub-model',
      TAU_RESULTS: '',
      TAU_REFERENCE: '',
    },
    maxBuffer: 8 * 1024 * 1024,
  });
  return { stdout, stderr, dir };
}

function read(dir: string, name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, name), 'utf8')) as Record<string, unknown>;
}

describe('the L4 lane writes a paired-facade artefact', () => {
  it('produces its own PAIRED artefact and passes the new gate', async () => {
    const { stdout, dir } = await lane(DRIVER_PAIRED);
    const main = read(dir, 'poc-l4.json');
    expect(main['per_task']).toHaveLength(2);
    const samples = main['samples'] as readonly { id: string; pass: boolean; actual: string }[];
    const gate = samples.find((entry) => entry.id === 'l4-facade-pair');
    expect(gate).toEqual({
      id: 'l4-facade-pair',
      pass: true,
      actual: 'PAIRED',
      criterion: 'a registered within-run pair is never a cross-run comparison',
    });
    expect(existsSync(join(dir, 'poc-l4-facade-pair.json'))).toBe(true);
    const back = readFacadePairArtifact(read(dir, 'poc-l4-facade-pair.json'));
    expect(back.state).toBe('PAIRED');
    expect(back.paired).toBe(2);
    expect(back.deltaPp).toBe(0);
    expect(back.treatmentDelivered).toBe(true);
    expect(back.floor).toBe(0.01);
    expect(stdout).toContain('[poc-l4-facade-pair] PAIRED:');
  });

  it('does not write a paired artefact for a single-facade driver', async () => {
    const { dir } = await lane(`
export async function run() { return [{ taskId: 'airline/001', successes: 4, trials: 4, k: 4 }]; }
`);
    const samples = read(dir, 'poc-l4.json')['samples'] as readonly { id: string }[];
    expect(samples.some((entry) => entry.id === 'l4-facade-pair')).toBe(false);
    expect(existsSync(join(dir, 'poc-l4-facade-pair.json'))).toBe(false);
  });

  it('records a provider refusal as no measurement, never as a not-run or a result', async () => {
    const { stdout, dir } = await lane(DRIVER_NO_MEASUREMENT);
    const main = read(dir, 'poc-l4.json');
    const metrics = main['metrics'] as Record<string, unknown>;
    expect(metrics['status_no_measurement']).toBe(1);
    expect(metrics['status_not_run']).toBe(0);
    expect(metrics).not.toHaveProperty('pass4');
    expect(metrics).not.toHaveProperty('paired_delta_pp');
    // A stopped run writes no per-task rows at all: an empty array would be a
    // zero-task measurement dressed up as a measurement that happened.
    expect(main['per_task']).toBeUndefined();
    expect(main['tau2']).toBeUndefined();
    expect(existsSync(join(dir, 'poc-l4-facade-pair.json'))).toBe(false);
    expect(stdout).toContain('no measurement');
    const notes = main['notes'] as readonly string[];
    expect(notes.join(' ')).toMatch(/5xx/);
    expect(notes.join(' ')).toMatch(/Claim: none/);
  });
});
