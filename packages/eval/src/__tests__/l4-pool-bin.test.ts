import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The pool command's refusals, run as a command.
 *
 * `l4-pool.ts` is the only path by which two dispatches become one reading, and its four failure
 * modes are all of the same kind: a caller who is about to publish a number. A refusal that throws a
 * stack trace instead of a sentence is a refusal that gets worked around, and a success that writes an
 * artefact into the repository is a gate that dirties the tree on every run. Both are properties of
 * the *process*, not of the module, so they are asserted by running it.
 */

const BIN = 'packages/eval/src/bin/l4-pool.ts';
const ROW = (id: string, passed: boolean) => ({ id, passed_all: passed, k: 4 });

function artefact(rows: readonly { id: string; passed_all: boolean }[], over: Record<string, unknown> = {}) {
  return {
    id: 'poc-l4',
    model: 'deepseek-chat',
    metrics: { pass4: 0.5, k: 4, tasks: rows.length },
    tau2: {
      distillUnit: { unit: 'raw' },
      distillForm: { form: 'record' },
      distillScope: 'edited',
    },
    per_task: rows,
    ...over,
  };
}

function run(spec: string, dir: string): { code: number; out: string } {
  try {
    const out = execFileSync('npx', ['tsx', BIN], {
      encoding: 'utf8',
      env: { ...process.env, L4_POOL: spec, POC_RESULT_DIR: dir },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
    });
    return { code: 0, out };
  } catch (error) {
    const failed = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failed.status ?? -1, out: `${failed.stdout ?? ''}${failed.stderr ?? ''}` };
  }
}

describe('the pool command', () => {
  it('refuses an empty spec by name rather than crashing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pool-'));
    const { code, out } = run('', dir);
    expect(code).toBe(2);
    expect(out).toContain('L4_POOL is empty');
  });

  it('names a spec that is not label=path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pool-'));
    const { code, out } = run('retail', dir);
    expect(code).toBe(2);
    expect(out).toContain("'retail' is not label=path");
  });

  it('names the file it could not read', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pool-'));
    const { code, out } = run(`a=${join(dir, 'nope.json')},b=${join(dir, 'nope2.json')}`, dir);
    expect(code).toBe(1);
    expect(out).toContain('missing artefact for a');
  });

  it('refuses an artefact with no per-task rows instead of pooling nothing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pool-'));
    const path = join(dir, 'empty.json');
    writeFileSync(path, JSON.stringify({ id: 'poc-l4', per_task: [] }), 'utf8');
    const { code, out } = run(`a=${path},b=${path}`, dir);
    expect(code).toBe(1);
    expect(out).toContain('has no per_task rows');
  });

  it('writes nothing when the arms overlap, because the sentence is the output', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pool-'));
    const path = join(dir, 'retail.json');
    writeFileSync(path, JSON.stringify(artefact([ROW('retail/1', true), ROW('retail/2', false)])), 'utf8');
    const { code, out } = run(`a=${path},b=${path}`, dir);
    expect(code).toBe(1);
    expect(out).toContain('the same task appears in two arms');
    expect(existsSync(join(dir, 'poc-l4-pool.json'))).toBe(false);
  });

  it('writes the pooled reading with its interval and the arms that produced it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pool-'));
    const first = join(dir, 'retail.json');
    const second = join(dir, 'airline.json');
    writeFileSync(
      first,
      JSON.stringify(artefact([ROW('retail/1', true), ROW('retail/2', false)])),
      'utf8',
    );
    writeFileSync(
      second,
      JSON.stringify(artefact([ROW('airline/1', true), ROW('airline/2', false)])),
      'utf8',
    );
    const { code, out } = run(`retail=${first},airline=${second}`, dir);
    expect(code).toBe(0);
    expect(out).toContain('pool: 0.5000 over 4 task(s)');
    const written = JSON.parse(readFileSync(join(dir, 'poc-l4-pool.json'), 'utf8')) as {
      pooled: { tasks: number; pass4: number; detectablePp: number; domains: string[] };
      arms: { label: string; pass4: number }[];
    };
    expect(written.pooled.tasks).toBe(4);
    expect(written.pooled.pass4).toBeCloseTo(0.5, 10);
    expect(written.pooled.domains).toEqual(['retail', 'airline']);
    expect(written.pooled.detectablePp).toBeGreaterThan(0);
    expect(written.arms.map((arm) => arm.label)).toEqual(['retail', 'airline']);
  }, 120_000);
});
