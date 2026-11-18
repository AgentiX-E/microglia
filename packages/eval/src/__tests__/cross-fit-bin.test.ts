import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The cross-fit command, run as a command.
 *
 * The command's whole job is to refuse rather than to add when the two files are not two halves of one corpus,
 * and every one of those refusals is a property of the process — which file it read, what it printed, what it
 * exited with. Asserting them through `crossFitPool` alone would leave the wiring untested: a path typo, a
 * ledger that the artefact does not carry, and a single argument all reach the user as a message and a code.
 */
const BIN = 'packages/eval/src/bin/cross-fit.ts';

type Row = { task: string; blankCorrect: boolean; withMemoryCorrect: boolean };

/**
 * One pair artefact, written where the reader expects it.
 *
 * `foldSplit` is the field R143 added: the halves the arms ran. A fold that does not carry it is not refused
 * here — it is refused by the pool, with the sentence about a leak check that cannot run, which is the one a
 * reader needs.
 */
function pair(
  dir: string,
  name: string,
  options: {
    readonly learned?: readonly string[];
    readonly rows: readonly Row[];
    readonly treatment?: Record<string, string | number>;
  },
): string {
  const path = join(dir, `${name}.json`);
  writeFileSync(
    path,
    JSON.stringify({
      id: 'poc-l4-pair',
      domain: 'retail',
      ...(options.learned === undefined
        ? { foldSplitAbsent: { reason: 'arm(s) record no split: memory' } }
        : { foldSplit: { learned: options.learned, evaluated: options.rows.map((row) => row.task) } }),
      treatment: options.treatment ?? {
        unit: 'correction',
        form: 'lesson',
        scope: 'all',
        model: 'deepseek/deepseek-flash',
        traceClaims: 6,
      },
      transfer: { ledger: options.rows },
    }),
    'utf8',
  );
  return path;
}

function run(args: readonly string[], dir: string): { code: number; out: string; err: string } {
  const child = spawnSync('npx', ['tsx', BIN, ...args], {
    encoding: 'utf8',
    env: { ...process.env, POC_RESULT_DIR: join(dir, 'results') },
  });
  return { code: child.status ?? 1, out: child.stdout ?? '', err: child.stderr ?? '' };
}

function workdir(): string {
  return mkdtempSync(join(tmpdir(), 'cross-fit-'));
}

describe('cross-fit', () => {
  it('pools two folds into one reading over the whole corpus and writes it', () => {
    const dir = workdir();
    const a = pair(dir, 'fold-a', {
      learned: ['retail/1', 'retail/2'],
      rows: [
        { task: 'retail/3', blankCorrect: false, withMemoryCorrect: true },
        { task: 'retail/4', blankCorrect: true, withMemoryCorrect: true },
      ],
    });
    const b = pair(dir, 'fold-b', {
      learned: ['retail/3', 'retail/4'],
      rows: [
        { task: 'retail/1', blankCorrect: false, withMemoryCorrect: true },
        { task: 'retail/2', blankCorrect: true, withMemoryCorrect: false },
      ],
    });
    const result = run([a, b], dir);
    expect(result.code).toBe(0);
    expect(result.out).toContain('[cross-fit] pooled n=4 memory=0.7500 control=0.5000 delta=+25.00pp');
    expect(result.out).toContain('[cross-fit] tiles 4 of 4 task(s); folds agree in sign');

    const written = join(dir, 'results', 'poc-cross-fit.json');
    expect(existsSync(written)).toBe(true);
    const artefact = JSON.parse(readFileSync(written, 'utf8')) as {
      sources: readonly string[];
      reading: { tasks: number; deltaPp: number };
      census: { tiles: boolean };
    };
    expect(artefact.sources).toEqual([a, b]);
    expect(artefact.reading.tasks).toBe(4);
    expect(artefact.reading.deltaPp).toBeCloseTo(25, 10);
    expect(artefact.census.tiles).toBe(true);
  });

  it('pools two fold records, which is the shape the composition writes', () => {
    // `eval:fold-records` states the ledger at the top level beside the two id sets; a run's pair artefact nests
    // it under `transfer`. Both are inputs to this command, and a reader who pools what the composition wrote
    // must not be told the fold has no paired trials.
    const dir = workdir();
    const record = (name: string, learned: readonly string[], rows: readonly Row[]): string => {
      const path = join(dir, `${name}.json`);
      writeFileSync(
        path,
        JSON.stringify({
          id: name,
          source: 'poc-l4-pair @ 2026-11-18T13:55:00Z',
          foldSplit: { learned, evaluated: rows.map((row) => row.task) },
          treatment: { unit: 'correction', form: 'lesson', scope: 'all', model: 'deepseek/deepseek-chat', knobs: '' },
          ledger: rows,
          derivation: [],
        }),
        'utf8',
      );
      return path;
    };
    const a = record('official', ['retail/3', 'retail/4'], [
      { task: 'retail/1', blankCorrect: false, withMemoryCorrect: true },
      { task: 'retail/2', blankCorrect: true, withMemoryCorrect: true },
    ]);
    const b = record('swapped', ['retail/1', 'retail/2'], [
      { task: 'retail/3', blankCorrect: false, withMemoryCorrect: true },
      { task: 'retail/4', blankCorrect: true, withMemoryCorrect: false },
    ]);
    const result = run([a, b], dir);
    expect(result.code).toBe(0);
    expect(result.out).toContain('[cross-fit] pooled n=4 memory=0.7500 control=0.5000 delta=+25.00pp');
    expect(result.out).toContain('[cross-fit] tiles 4 of 4 task(s)');
  });

  it('refuses one path, because one fold has no other half to have trained it', () => {
    const dir = workdir();
    const result = run([pair(dir, 'fold-a', { learned: [], rows: [{ task: 'retail/1', blankCorrect: true, withMemoryCorrect: true }] })], dir);
    expect(result.code).toBe(1);
    expect(result.err).toContain('two fold artefacts are needed, and 1 were given');
  });

  it('refuses a path that does not exist, instead of pooling the one that does', () => {
    const dir = workdir();
    const a = pair(dir, 'fold-a', { learned: [], rows: [{ task: 'retail/1', blankCorrect: true, withMemoryCorrect: true }] });
    const result = run([a, join(dir, 'absent.json')], dir);
    expect(result.code).toBe(1);
    expect(result.err).toContain('missing fold artefact');
  });

  it('refuses a fold whose artefact carries no ledger, because a fold with no rows measured nothing', () => {
    const dir = workdir();
    const empty = join(dir, 'empty.json');
    writeFileSync(empty, JSON.stringify({ id: 'poc-l4-pair' }), 'utf8');
    const a = pair(dir, 'fold-a', { learned: [], rows: [{ task: 'retail/1', blankCorrect: true, withMemoryCorrect: true }] });
    const result = run([a, empty], dir);
    expect(result.code).toBe(1);
    expect(result.err).toContain('carries no transfer ledger');
  });

  it('refuses a fold that scored a task its own store learned from', () => {
    // The one defect the cross-fit exists to exclude, and the only one whose number looks better than the
    // truth rather than failing: a fold that trained on what it answered is not held out at all.
    const dir = workdir();
    const a = pair(dir, 'fold-a', {
      learned: ['retail/1'],
      rows: [{ task: 'retail/1', blankCorrect: false, withMemoryCorrect: true }],
    });
    const b = pair(dir, 'fold-b', { learned: ['retail/2'], rows: [{ task: 'retail/2', blankCorrect: true, withMemoryCorrect: true }] });
    const result = run([a, b], dir);
    expect(result.code).toBe(1);
    expect(result.err).toContain("fold 'fold-a' evaluates 1 task(s) its store learned from: retail/1");
  });

  it('refuses a fold that does not state what it learned, which is every artefact before R143', () => {
    // Every pair artefact written before R143 carries no fold split, so this is the message the first attempt
    // at a cross-fit will get — and it has to name the reason rather than invent a boundary.
    const dir = workdir();
    const a = pair(dir, 'fold-a', { rows: [{ task: 'retail/1', blankCorrect: true, withMemoryCorrect: true }] });
    const b = pair(dir, 'fold-b', { learned: ['retail/1'], rows: [{ task: 'retail/2', blankCorrect: true, withMemoryCorrect: true }] });
    const result = run([a, b], dir);
    expect(result.code).toBe(1);
    expect(result.err).toContain('fold(s) that do not say what they learned from: fold-a');
  });

  it('refuses two folds served through two recall filters, which the artefact states and the loader must carry', () => {
    // R150's knob string is the only record of *what filter ran*. The pool has compared it since the field
    // existed, but the command that feeds the pool omitted it from the fold it builds — so two folds of one
    // store read through two anchors reached `identityOf` as 'none' and 'none' and pooled. The test is on the
    // command rather than on the pool because the defect was in the wiring, and a pool test cannot see it.
    const dir = workdir();
    const treatment = { unit: 'correction', form: 'lesson', scope: 'all', model: 'deepseek/deepseek-flash', knobs: 'anchoring=lexical' };
    const a = pair(dir, 'fold-a', { learned: ['retail/2'], rows: [{ task: 'retail/1', blankCorrect: true, withMemoryCorrect: true }], treatment });
    const b = pair(dir, 'fold-b', { learned: ['retail/1'], rows: [{ task: 'retail/2', blankCorrect: true, withMemoryCorrect: true }], treatment: { ...treatment, knobs: '' } });
    const result = run([a, b], dir);
    expect(result.code).toBe(1);
    expect(result.err).toContain("knobs is 'anchoring=lexical' on fold-a and 'none' on fold-b");
  });

  it('pools two folds that name the same filter, because one filter served both halves', () => {
    // The counterpart: the refusal above must not fire on a fold pair that ran one filter, or the knob would
    // have made every cross-fit unpoolable — a guard that refuses everything is not a guard.
    const dir = workdir();
    const treatment = { unit: 'correction', form: 'lesson', scope: 'all', model: 'deepseek/deepseek-flash', knobs: 'anchoring=lexical' };
    const a = pair(dir, 'fold-a', { learned: ['retail/2'], rows: [{ task: 'retail/1', blankCorrect: false, withMemoryCorrect: true }], treatment });
    const b = pair(dir, 'fold-b', { learned: ['retail/1'], rows: [{ task: 'retail/2', blankCorrect: true, withMemoryCorrect: true }], treatment });
    const result = run([a, b], dir);
    expect(result.code).toBe(0);
    expect(result.out).toContain('[cross-fit] tiles 2 of 2 task(s)');
  });

  it('refuses two folds of two models, whatever the delta between them is', () => {
    const dir = workdir();
    const treatment = { unit: 'correction', form: 'lesson', scope: 'all', model: 'deepseek/deepseek-flash' };
    const a = pair(dir, 'fold-a', { learned: ['retail/2'], rows: [{ task: 'retail/1', blankCorrect: true, withMemoryCorrect: true }], treatment });
    const b = pair(dir, 'fold-b', { learned: ['retail/1'], rows: [{ task: 'retail/2', blankCorrect: true, withMemoryCorrect: true }], treatment: { ...treatment, model: 'deepseek/deepseek-chat' } });
    const result = run([a, b], dir);
    expect(result.code).toBe(1);
    expect(result.err).toContain('the folds are two experiments, not one corpus: model is');
  });
});
