import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The composition command, run as a command.
 *
 * Its whole job is to write two files or refuse, and every refusal is a property of the process: which path it
 * read, what it printed, what it exited with. Asserting the composition through `foldRecordsOf` alone would leave
 * the wiring untested — a typo'd output directory, a missing file, and a single argument all reach an operator as
 * a message and a code, and an operator is who runs this between a run and a cross-fit.
 */
const BIN = 'packages/eval/src/bin/fold-records.ts';

type Row = { task: string; blankCorrect: boolean; withMemoryCorrect: boolean };

const TREATMENT = { unit: 'correction', form: 'lesson', scope: 'all', model: 'deepseek/deepseek-chat', knobs: '' };

function pair(
  dir: string,
  name: string,
  options: { readonly rows: readonly Row[]; readonly train?: readonly string[]; readonly treatment?: Record<string, string> },
): string {
  const path = join(dir, `${name}.json`);
  writeFileSync(
    path,
    JSON.stringify({
      id: 'poc-l4-pair',
      ranAt: '2026-11-18T13:55:00Z',
      domain: 'retail',
      ...(options.train === undefined
        ? { foldSplitAbsent: { reason: 'the arms scored different splits' } }
        : { foldSplit: { learned: options.train, evaluated: options.rows.map((row) => row.task) } }),
      ...(options.treatment === undefined
        ? { treatmentAbsent: { reason: 'the arms do not both state unit' } }
        : { treatment: options.treatment }),
      transfer: { ledger: options.rows },
    }),
    'utf8',
  );
  return path;
}

function run(args: readonly string[]): { code: number; out: string; err: string } {
  const child = spawnSync('npx', ['tsx', BIN, ...args], { encoding: 'utf8' });
  return { code: child.status ?? 1, out: child.stdout ?? '', err: child.stderr ?? '' };
}

function workdir(): { dir: string; out: string } {
  const dir = mkdtempSync(join(tmpdir(), 'fold-records-'));
  return { dir, out: join(dir, 'folds') };
}

describe('fold-records', () => {
  it('writes both records, carrying the half and the treatment the silent artefact does not state', () => {
    const { dir, out } = workdir();
    const official = pair(dir, 'official', {
      rows: [
        { task: 'retail/1', blankCorrect: true, withMemoryCorrect: true },
        { task: 'retail/2', blankCorrect: false, withMemoryCorrect: true },
      ],
    });
    const swapped = pair(dir, 'swapped', {
      rows: [
        { task: 'retail/3', blankCorrect: true, withMemoryCorrect: false },
        { task: 'retail/4', blankCorrect: true, withMemoryCorrect: true },
        { task: 'retail/5', blankCorrect: false, withMemoryCorrect: false },
      ],
      train: ['retail/1', 'retail/2'],
      treatment: TREATMENT,
    });
    const result = run([official, swapped, '--out-dir', out]);
    expect(result.code).toBe(0);
    expect(result.out).toContain('[fold-records] official: learned 3 / evaluated 2, treatment correction/lesson/all');
    expect(result.out).toContain('[fold-records] swapped: learned 2 / evaluated 3, treatment correction/lesson/all');

    const written = join(out, 'official.json');
    expect(existsSync(written)).toBe(true);
    const record = JSON.parse(readFileSync(written, 'utf8')) as {
      id: string;
      source: string;
      foldSplit: { learned: readonly string[]; evaluated: readonly string[] };
      treatment: Record<string, string>;
      ledger: readonly Row[];
      derivation: readonly string[];
    };
    expect(record.id).toBe('official');
    expect(record.source).toContain('poc-l4-pair');
    expect(record.foldSplit).toEqual({ learned: ['retail/3', 'retail/4', 'retail/5'], evaluated: ['retail/1', 'retail/2'] });
    expect(record.treatment).toEqual(TREATMENT);
    // The ledger travels verbatim: the pool reads tasks, and a record that re-derived outcomes would be a
    // second implementation of the reading it is only supposed to carry.
    expect(record.ledger).toHaveLength(2);
    expect(record.derivation.join(' ')).toContain("learned: the sibling fold's evaluated half");
    expect(record.derivation.join(' ')).toContain('form: carried from swapped');
  });

  it('refuses a pair that does not tile, and writes nothing', () => {
    const { dir, out } = workdir();
    const official = pair(dir, 'official', {
      rows: [{ task: 'retail/1', blankCorrect: true, withMemoryCorrect: true }],
      train: ['retail/9'],
    });
    const swapped = pair(dir, 'swapped', {
      rows: [{ task: 'retail/3', blankCorrect: true, withMemoryCorrect: true }],
      train: ['retail/1'],
      treatment: TREATMENT,
    });
    const result = run([official, swapped, '--out-dir', out]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("the folds do not tile: 'official' learned 1 task(s) of which 1 were not answered");
    expect(existsSync(join(out, 'official.json'))).toBe(false);
  });

  it('refuses a path that does not exist, naming it', () => {
    const { dir, out } = workdir();
    const official = pair(dir, 'official', { rows: [{ task: 'retail/1', blankCorrect: true, withMemoryCorrect: true }] });
    const result = run([official, join(dir, 'absent.json'), '--out-dir', out]);
    expect(result.code).toBe(1);
    expect(result.err).toContain('missing pair artefact');
  });

  it('refuses a call that does not name two artefacts and an output directory', () => {
    const { dir } = workdir();
    const official = pair(dir, 'official', { rows: [{ task: 'retail/1', blankCorrect: true, withMemoryCorrect: true }] });
    const one = run([official]);
    expect(one.code).toBe(1);
    expect(one.err).toContain('two pair artefacts and an output directory are needed; 1 path(s) and no output directory were given');

    const noDir = run([official, official]);
    expect(noDir.code).toBe(1);
    expect(noDir.err).toContain('2 path(s) and no output directory were given');
  });

  it('refuses an artefact with no ledger, rather than writing a fold that measured nothing', () => {
    const { dir, out } = workdir();
    const empty = join(dir, 'empty.json');
    writeFileSync(empty, JSON.stringify({ id: 'poc-l4-pair' }), 'utf8');
    const swapped = pair(dir, 'swapped', {
      rows: [{ task: 'retail/1', blankCorrect: true, withMemoryCorrect: true }],
      train: [],
      treatment: TREATMENT,
    });
    const result = run([empty, swapped, '--out-dir', out]);
    expect(result.code).toBe(1);
    expect(result.err).toContain('carries no transfer ledger');
  });
});
