import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The bill, end to end: from a document or a driver, into the artefact, and back out through the pair.
 *
 * R198 was registered because this lane could not be priced. `bin/l4.ts` wrote `calls: 0` as a literal
 * on every arm while `bin/l4-pair.ts` read `tau2.usage.calls`, so one run had two answers and the
 * documents had to assemble a cost claim by hand from a workflow log. Three properties are pinned
 * here, and the third is the one that makes the other two useful:
 *
 *   1. a census in the document or the driver reaches the artefact's `calls` and its token columns;
 *   2. its absence is written as absence (`usage_absent: 1`), never as a measured zero;
 *   3. the arm artefact and the pairing step report the **same** call count for the same run.
 */

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const TSX = join(ROOT, 'node_modules', '.bin', 'tsx');
const LANE = join(ROOT, 'packages', 'eval', 'src', 'bin', 'l4.ts');
const PAIR = join(ROOT, 'packages', 'eval', 'src', 'bin', 'l4-pair.ts');

/** Two tasks, four trials, all four won: a perfect grid, so no gate is about accuracy. */
function document(extra: Record<string, unknown> = {}): string {
  const tasks = [{ id: 'retail/0' }, { id: 'retail/1' }];
  const simulations = tasks.flatMap((task) =>
    [0, 1, 2, 3].map((trial) => ({ task_id: task.id, trial, reward: 1 })),
  );
  return JSON.stringify({
    info: { environment_info: { domain_name: 'retail' } },
    tasks,
    simulations,
    ...extra,
  });
}

function lane(input: { readonly results?: string; readonly driver?: string; readonly dir: string }): {
  readonly artefact: Record<string, unknown>;
  readonly stdout: string;
} {
  let stdout = '';
  try {
    stdout = String(
      execFileSync(TSX, [LANE], {
        cwd: ROOT,
        encoding: 'utf8',
        env: {
          ...process.env,
          POC_RESULT_DIR: input.dir,
          TAU_RESULTS: input.results ?? '',
          TAU_DRIVER: input.driver ?? '',
          TAU_REFERENCE: '',
          TAU_MIN_TASKS: '1',
          TAU_TEST_DOMAIN: 'retail',
          TAU_MODEL: 'stub-model',
        },
        maxBuffer: 8 * 1024 * 1024,
      }),
    );
  } catch (error) {
    // A gate may fail on a perfect grid (the published bar belongs to another backbone); the artefact is
    // written either way, and the bill is what this file reads.
    stdout = String((error as { stdout?: string }).stdout ?? '');
  }
  return {
    artefact: JSON.parse(readFileSync(join(input.dir, 'poc-l4.json'), 'utf8')) as Record<string, unknown>,
    stdout,
  };
}

function metricsOf(artefact: Record<string, unknown>): Record<string, number> {
  return artefact['metrics'] as Record<string, number>;
}

describe('the bill a lane records', () => {
  it('writes the census a document carries, and states that it was measured', () => {
    const dir = mkdtempSync(join(tmpdir(), 'l4-bill-'));
    const path = join(dir, 'results.json');
    writeFileSync(path, document({ usage: { calls: 12, prompt_tokens: 900, uncached_tokens: 120, completion_tokens: 40 } }));

    const { artefact } = lane({ results: path, dir });
    expect(artefact['calls']).toBe(12);
    expect(artefact['usage']).toEqual({ calls: 12, prompt_tokens: 900, uncached_tokens: 120, completion_tokens: 40 });
    expect(metricsOf(artefact)).toMatchObject({
      usage_absent: 0,
      usage_counted: 0,
      prompt_tokens: 900,
      uncached_tokens: 120,
      completion_tokens: 40,
    });
    expect((artefact['notes'] as readonly string[]).join('\n')).toContain(
      'Arm bill (census): 12 provider call(s), 900 prompt token(s) of which 120 uncached, 40 completion token(s).',
    );
  });

  it('writes a document with no census as unmeasured, not as zero calls', () => {
    const dir = mkdtempSync(join(tmpdir(), 'l4-bill-'));
    const path = join(dir, 'results.json');
    writeFileSync(path, document());

    const { artefact } = lane({ results: path, dir });
    expect(artefact['calls']).toBe(0);
    expect(artefact['usage']).toBeUndefined();
    expect(metricsOf(artefact)).toMatchObject({ usage_absent: 1, usage_counted: 0 });
    expect(metricsOf(artefact)['prompt_tokens']).toBeUndefined();
    expect((artefact['notes'] as readonly string[]).join('\n')).toContain('nobody counted');
  });

  it('carries the census a driver exports, from the driver\u2019s own record', () => {
    const dir = mkdtempSync(join(tmpdir(), 'l4-bill-'));
    const driver = join(dir, 'stub-driver.ts');
    // A stub driver, not a mock of the lane: it is the module boundary the production runner uses, and
    // the two functions it exports are the two the lane calls.
    writeFileSync(
      driver,
      `export async function run() {
  return [
    { taskId: 'retail/0', successes: 4, trials: 4, k: 4 },
    { taskId: 'retail/1', successes: 4, trials: 4, k: 4 },
  ];
}
export function instrument() {
  return { usage: { calls: 5, prompt_tokens: 50 } };
}
`,
    );

    const { artefact } = lane({ driver, dir });
    expect(artefact['calls']).toBe(5);
    expect(metricsOf(artefact)).toMatchObject({ usage_absent: 0, usage_counted: 0, prompt_tokens: 50 });
    expect((artefact['tau2'] as Record<string, unknown>)['usage']).toEqual({ calls: 5, prompt_tokens: 50 });
  });
});

describe('the arm and the pair agree about one run', () => {
  it('reports the same call count in the artefact and in the pairing step', () => {
    const dir = mkdtempSync(join(tmpdir(), 'l4-bill-'));
    const path = join(dir, 'results.json');
    writeFileSync(path, document({ usage: { calls: 12, prompt_tokens: 900, uncached_tokens: 120 } }));

    const first = join(dir, 'reference');
    const second = join(dir, 'memory');
    for (const arm of [first, second]) {
      // Each arm is written into its own directory, exactly as a dispatch files them.
      const written = lane({ results: path, dir: arm });
      expect(written.artefact['calls']).toBe(12);
    }

    let stdout = '';
    try {
      stdout = String(
        execFileSync(TSX, [PAIR], {
          cwd: ROOT,
          encoding: 'utf8',
          env: {
            ...process.env,
            POC_RESULT_DIR: dir,
            L4_FIRST: join(first, 'poc-l4.json'),
            L4_SECOND: join(second, 'poc-l4.json'),
          },
          maxBuffer: 8 * 1024 * 1024,
        }),
      );
    } catch (error) {
      // The finding gates need a difference between the arms, and these two arms are one document scored
      // twice. The bill lines are printed before any gate, which is what this test reads.
      stdout = String((error as { stdout?: string }).stdout ?? '');
    }

    for (const name of ['first', 'second']) {
      expect(stdout).toContain(`${name} arm's bill (census): 12 provider call(s)`);
    }
    const published = JSON.parse(readFileSync(join(dir, 'poc-l4-pair.json'), 'utf8')) as {
      readonly first?: { readonly calls?: number; readonly bill?: string };
      readonly second?: { readonly calls?: number; readonly bill?: string };
    };
    // The acceptance R198 registered: one document, two files, one number — and the state of that number
    // carried beside it, so the pair cannot present a count as a census or silence as a zero.
    expect(published.first).toMatchObject({ calls: 12, bill: 'census' });
    expect(published.second).toMatchObject({ calls: 12, bill: 'census' });
  });
});
