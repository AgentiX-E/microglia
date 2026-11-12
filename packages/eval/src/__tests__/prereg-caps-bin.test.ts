import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The caps command, run as a command.
 *
 * `sota.yml` reads its two lines into `TAU_TRAIN_TASKS` and `TAU_TEST_TASKS`, so the command's output
 * shape *is* the contract: a registration that pins nothing has to print two empty lines, and a
 * registration that pins half of the pair has to refuse rather than let a repository variable decide
 * the other half. Both are properties of the process rather than of `readPrereg`, which is why they are
 * asserted by running it.
 */

const BIN = 'packages/eval/src/bin/prereg-caps.ts';

const HEADER = [
  '---',
  'id: R87-caps',
  // The header id must match the file's stem, so the fixture writes `R87-caps.md`.
  'step: R87',
  'opened: 2026-11-12',
  'arms: memory',
  'sample: 57',
  'gates: V1',
];
const BODY = [
  '',
  '## Prediction',
  '',
  '- the learning half produces enough calls to grade a distribution of codes',
  '',
  '## Refutation',
  '',
  '- fewer calls than the floor means the population arithmetic is wrong',
  '',
];

function file(extra: readonly string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'prereg-caps-'));
  const path = join(dir, 'R87-caps.md');
  writeFileSync(path, [...HEADER, ...extra, '---', ...BODY].join('\n'));
  return path;
}

function run(path: string): { code: number; out: string; err: string } {
  try {
    const out = execFileSync('npx', ['tsx', BIN, path], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out, err: '' };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? 1, out: failure.stdout ?? '', err: failure.stderr ?? '' };
  }
}

describe('prereg-caps', () => {
  it('prints both caps, one per line, for the two variables the workflow reads', () => {
    const result = run(file(['trainTasks: 57', 'testTasks: 1']));
    expect(result.code).toBe(0);
    expect(result.out).toBe('train=57\ntest=1\n');
  });

  it('prints two empty lines when the registration pins nothing, so the variables stand', () => {
    const result = run(file([]));
    expect(result.code).toBe(0);
    expect(result.out).toBe('train=\ntest=\n');
  });

  it('refuses half a pin instead of letting a variable decide the other half', () => {
    // The defect this removes, in the shape it would return: a registration that fixes the learning
    // half and leaves the evaluation to whichever dispatch ran last is a cost decided by history.
    const result = run(file(['trainTasks: 57']));
    expect(result.code).toBe(1);
    expect(result.err).toContain('declare trainTasks and testTasks together');
  });

  it('refuses a cap that is not a count of tasks, and says which header', () => {
    const result = run(file(['trainTasks: -1', 'testTasks: 1']));
    expect(result.code).toBe(1);
    expect(result.err).toContain("header 'trainTasks'");
    expect(result.err).toContain('is not a count of tasks');
  });

  it('refuses to run without a file rather than printing an empty contract', () => {
    let code = 0;
    let err = '';
    try {
      execFileSync('npx', ['tsx', BIN], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      const failure = error as { status?: number; stderr?: string };
      code = failure.status ?? 1;
      err = failure.stderr ?? '';
    }
    // An empty contract would silently leave both caps to the repository variables, which is the
    // state a registration exists to replace -- so the usage line is a refusal, not a help text.
    expect(code).toBe(1);
    expect(err).toContain('usage: pnpm eval:prereg-caps');
  });
});
