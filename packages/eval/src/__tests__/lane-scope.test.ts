/**
 * Which lane a dispatch buys, and the argument for asking.
 *
 * R61's re-dispatch (`42524907557`) measured 350 Mini-Dev questions over 1,768 calls as a side effect of
 * naming a τ² registration, because `bird` defaulted to `true` and nothing in the workflow knew what kind
 * of experiment the registration described. The cost is not the money: it is that a lane nobody grades
 * still produces a number, a green step and a delta (-0.57pp) that then has to be explained as
 * incidental.
 *
 * These cases pin the order of precedence, which is the whole design: an explicit input outranks a
 * BIRD-only split, a BIRD-only split outranks the registration's kind, and the registration's kind
 * outranks a default. Each case below is one rung, and the two that must never move are the τ²
 * registration (no BIRD lane) and the BIRD registration (one).
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { laneScope, preregFileOf } from '../lane-scope.js';

const ROOT = process.cwd();
const TSX = join(ROOT, 'node_modules', '.bin', 'tsx');
const BIN = join(ROOT, 'packages', 'eval', 'src', 'bin', 'lane-scope.ts');

describe('laneScope decides the BIRD lane from the registration, not from a default', () => {
  it('runs the BIRD lane on a scheduled run, which has no inputs at all', () => {
    const scope = laneScope({
      event: 'schedule',
      bird: '',
      split: '',
      declaresRecallFloor: undefined,
    });
    expect(scope.bird).toBe(true);
    expect(scope.reason).toContain('no dispatch inputs');
  });

  it('skips the BIRD lane for a τ² registration, which is what R61 should have done', () => {
    const scope = laneScope({
      event: 'workflow_dispatch',
      bird: '',
      split: 'minidev',
      declaresRecallFloor: true,
    });
    expect(scope.bird).toBe(false);
    // The reason has to name the fix, because the person reading a skipped job is the person who has to
    // decide whether it should have run.
    expect(scope.reason).toContain('register a BIRD question');
  });

  it('runs it for a registration that declares no floor, which is a BIRD registration', () => {
    const scope = laneScope({
      event: 'workflow_dispatch',
      bird: '',
      split: 'minidev',
      declaresRecallFloor: false,
    });
    expect(scope.bird).toBe(true);
    expect(scope.reason).toContain('BIRD registration');
  });

  it('honours an explicit refusal before it reads the registration', () => {
    const scope = laneScope({
      event: 'workflow_dispatch',
      bird: 'false',
      split: 'dev',
      declaresRecallFloor: false,
    });
    expect(scope.bird).toBe(false);
    expect(scope.reason).toContain('bird: false');
  });

  it('honours an explicit request over a τ² registration, because an override is a statement', () => {
    const scope = laneScope({
      event: 'workflow_dispatch',
      bird: 'true',
      split: 'minidev',
      declaresRecallFloor: true,
    });
    expect(scope.bird).toBe(true);
    expect(scope.reason).toContain('explicitly');
  });

  it('runs it for the dev and train splits even under a τ² registration', () => {
    // `dev` and `train` are BIRD-only corpora: a dispatch that names one has asked for the lane in the
    // only way that split can be read, so the registration's kind cannot take it away.
    for (const split of ['dev', 'train']) {
      const scope = laneScope({
        event: 'workflow_dispatch',
        bird: '',
        split,
        declaresRecallFloor: true,
      });
      expect(scope.bird).toBe(true);
      expect(scope.reason).toContain(split);
    }
  });

  it('leaves the lane on when the dispatch names no registration', () => {
    const scope = laneScope({
      event: 'workflow_dispatch',
      bird: '',
      split: 'minidev',
      declaresRecallFloor: undefined,
    });
    expect(scope.bird).toBe(true);
    expect(scope.reason).toContain('stands on its default');
  });
});

describe('the lane-scope command reads a registration and writes one output file', () => {
  /** Run the command in a directory whose `prereg/` holds the given registrations. */
  function run(
    files: Record<string, string>,
    env: Record<string, string>,
  ): {
    readonly status: number;
    readonly stdout: string;
    readonly output: string;
  } {
    const dir = mkdtempSync(join(tmpdir(), 'lane-scope-'));
    const prereg = join(dir, 'prereg');
    execFileSync('mkdir', ['-p', prereg]);
    for (const [name, text] of Object.entries(files)) writeFileSync(join(prereg, name), text);
    const outputFile = join(dir, 'out.txt');
    writeFileSync(outputFile, 'previous=kept\n');
    let status = 0;
    let stdout = '';
    try {
      stdout = execFileSync(TSX, [BIN], {
        cwd: dir,
        encoding: 'utf8',
        // The workflow always passes the event and the split; a case that wants another event or
        // another split overrides them, and no case relies on the command inventing either.
        env: {
          ...process.env,
          EVENT: 'workflow_dispatch',
          BIRD_INPUT: '',
          SPLIT: 'minidev',
          ...env,
          GITHUB_OUTPUT: env['GITHUB_OUTPUT'] ?? outputFile,
        },
      });
    } catch (error) {
      const failed = error as { status?: number; stdout?: string };
      status = failed.status ?? -1;
      stdout = failed.stdout ?? '';
    }
    return { status, stdout, output: readFileSync(outputFile, 'utf8') };
  }

  /** A registration body, with or without the τ² header. */
  function registration(id: string, floor: boolean): string {
    return [
      '---',
      `id: ${id}`,
      `step: ${id.split('-')[0]}`,
      'opened: 2026-11-09',
      'arms: memory,reference',
      'sample: 228',
      'gates: V1,V2,V3',
      ...(floor ? ['recallFloor: 0'] : []),
      '---',
      '',
      `# ${id}`,
      '',
      '## Prediction',
      '',
      '- The sweep is present and its operating point is the census own numbers, so a reader never sees two answers to one question.',
      '',
      '## Refutation',
      '',
      '- The floor was never the constraint, so the store holds no duplicate family above the statement gate.',
      '',
    ].join('\n');
  }

  it('writes bird=false for a τ² registration, and appends rather than replacing', () => {
    const result = run(
      { 'R61-floor.md': registration('R61-floor', true) },
      { PREREG: 'R61-floor' },
    );
    expect(result.status).toBe(0);
    expect(result.output).toContain('previous=kept');
    expect(result.output).toContain('bird=false');
    expect(result.output).toContain('recall floor');
  });

  it('writes bird=true for a BIRD registration', () => {
    const result = run(
      { 'R9-something.md': registration('R9-something', false) },
      { PREREG: 'R9-something' },
    );
    expect(result.status).toBe(0);
    expect(result.output).toContain('bird=true');
  });

  it('refuses a registration it cannot read instead of guessing a scope', () => {
    // The error names the path, and the workflow's own `Require a pre-registration` step refuses the
    // dispatch with the fix. What must not happen is a seventeen-minute lane bought or skipped because
    // a file was missing and the command assumed a default.
    const result = run({}, { PREREG: 'R62-missing' });
    expect(result.status).toBe(1);
    expect(result.output).toBe('previous=kept\n');
  });

  it('refuses when the event was not passed, because the default branch buys a lane', () => {
    const result = run(
      { 'R9-something.md': registration('R9-something', false) },
      { PREREG: 'R9-something', EVENT: '' },
    );
    expect(result.status).toBe(1);
    expect(result.output).toBe('previous=kept\n');
  });

  it('prints the decision on stdout when there is no output file to write', () => {
    const result = run(
      { 'R9-something.md': registration('R9-something', false) },
      { PREREG: 'R9-something', GITHUB_OUTPUT: '' },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('bird=true');
  });
});

describe('preregFileOf', () => {
  it('takes the form the workflow input describes', () => {
    expect(preregFileOf('R63-recall-order')).toBe('prereg/R63-recall-order.md');
  });

  it('takes a path, which is the form the CLI takes', () => {
    // A dispatch that passed `prereg/R63-recall-order.md` to a field documented as
    // `prereg/<id>.md` built `prereg/prereg/R63-recall-order.md.md` and reported that the
    // registration did not exist. The file existed; the message was about a name nobody typed.
    expect(preregFileOf('prereg/R63-recall-order.md')).toBe('prereg/R63-recall-order.md');
    expect(preregFileOf('./prereg/R63-recall-order.md')).toBe('prereg/R63-recall-order.md');
    expect(preregFileOf('R63-recall-order.md')).toBe('prereg/R63-recall-order.md');
    expect(preregFileOf('  prereg/R63-recall-order  ')).toBe('prereg/R63-recall-order.md');
  });

  it('answers nothing for nothing, so a caller can tell "no registration" from a bad name', () => {
    expect(preregFileOf('')).toBe('');
    expect(preregFileOf('prereg/')).toBe('');
    expect(preregFileOf('.md')).toBe('');
  });

  it('leaves a name that merely contains a separator alone', () => {
    // A nested registration is a legitimate path; only the `prereg/` prefix is redundant.
    expect(preregFileOf('sub/R1.md')).toBe('prereg/sub/R1.md');
  });
});
