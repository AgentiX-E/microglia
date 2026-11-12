import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The pairing step, end to end, over two arm artefacts that carry their episodes.
 *
 * The transfer reading spans three files — two arms and the pair — and the seam between them is not
 * type-checked: an artefact whose `per_trial` rows are named one way and whose `per_task` rows are
 * named another would pair nothing while reporting a denominator. This writes both arms, runs the
 * step the workflow runs, and reads what it published.
 */

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const TSX = join(ROOT, 'node_modules', '.bin', 'tsx');
const PAIR = join(ROOT, 'packages', 'eval', 'src', 'bin', 'l4-pair.ts');

type Row = { readonly id: string; readonly trial: number; readonly reward: number | null };

/** One arm's artefact: the four metrics every version writes, the records, and the episodes. */
function arm(input: {
  readonly arm: 'memory' | 'reference';
  readonly rows: readonly Row[];
  readonly pass4: number;
  readonly meanPackIds?: number;
  readonly scenarioTasks?: { readonly learn: number; readonly test: number };
}): unknown {
  const byTask = new Map<string, boolean[]>();
  for (const row of input.rows) {
    const list = byTask.get(row.id) ?? [];
    list.push(row.reward === 1);
    byTask.set(row.id, list);
  }
  return {
    id: 'poc-l4',
    n: byTask.size,
    metrics: { pass4: input.pass4, k: 2, tasks: byTask.size, unscored_tasks: 0 },
    per_task: [...byTask].map(([id, passes]) => ({ id, passed_all: passes.every(Boolean) })),
    per_trial: input.rows,
    ...(input.arm === 'memory'
      ? {
          tau2: {
            meanPackIds: input.meanPackIds ?? 1,
            scenario: { learn: 'retail', test: 'airline', recall: 'retail' },
            split: { train: ['retail/1', 'retail/2'], test: [...byTask.keys()] },
            ...(input.scenarioTasks === undefined ? {} : { scenarioTasks: input.scenarioTasks }),
          },
        }
      : {}),
  };
}

describe('the pairing step on a cross-domain pair', () => {
  it('publishes the transfer reading from the two arms\u2019 episodes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'l4-pair-'));
    const referenceRows: Row[] = [
      { id: 'airline/1', trial: 0, reward: 1 },
      { id: 'airline/1', trial: 1, reward: 1 },
      { id: 'airline/2', trial: 0, reward: 1 },
      { id: 'airline/2', trial: 1, reward: 1 },
      { id: 'airline/3', trial: 0, reward: 0 },
      { id: 'airline/3', trial: 1, reward: 0 },
      { id: 'airline/4', trial: 0, reward: 0 },
      { id: 'airline/4', trial: 1, reward: 0 },
      { id: 'airline/5', trial: 0, reward: 0 },
      { id: 'airline/5', trial: 1, reward: 0 },
      { id: 'airline/6', trial: 0, reward: 0 },
      { id: 'airline/6', trial: 1, reward: 0 },
    ];
    // The treatment repairs 3 and 5, breaks nothing, and leaves 4 and 6 alone.
    const memoryRows = referenceRows.map((row) =>
      row.id === 'airline/3' || row.id === 'airline/5' ? { ...row, reward: 1 } : row,
    );

    writeFileSync(
      join(dir, 'reference.json'),
      JSON.stringify(arm({ arm: 'reference', rows: referenceRows, pass4: 0.5 })),
    );
    writeFileSync(
      join(dir, 'memory.json'),
      JSON.stringify(arm({ arm: 'memory', rows: memoryRows, pass4: 0.5, meanPackIds: 2 })),
    );

    // The step exits non-zero when a finding gate fails (`l4-paired` needs p < 0.05), which is the
    // lane's existing behaviour; what this test reads is the artefact it writes either way.
    try {
      execFileSync(TSX, [PAIR], {
        cwd: ROOT,
        encoding: 'utf8',
        env: {
          ...process.env,
          POC_RESULT_DIR: dir,
          L4_FIRST: join(dir, 'reference.json'),
          L4_SECOND: join(dir, 'memory.json'),
        },
      });
    } catch {
      // Covered by the assertions below: a failed finding gate still publishes its record.
    }

    const published = JSON.parse(readFileSync(join(dir, 'poc-l4-pair.json'), 'utf8')) as {
      scenario?: { learn: string; test: string; recall: string };
      transfer?: {
        paired: number;
        informative: number;
        repaired: number;
        broke: number;
        measured: number;
        netPp: number;
        verdict: string;
        orphanMemory: number;
        ledger: readonly { task: string; trial: number }[];
      };
      ceiling?: { tasks: number; halfWidthPp: number; mde80Pp: number; resolvesFivePp: boolean };
      degradation?: {
        broke: number;
        repaired: number;
        blankRight: number;
        measured: number;
        breakRate: number;
        netPp: number;
      };
      protocol: { evaluable: readonly string[]; supplyable: number; armIndexed: number };
    };

    expect(published.scenario).toEqual({ learn: 'retail', test: 'airline', recall: 'retail' });
    expect(published.transfer?.paired).toBe(12);
    expect(published.transfer?.informative).toBe(8);
    expect(published.transfer?.repaired).toBe(4);
    expect(published.transfer?.broke).toBe(0);
    expect(published.transfer?.measured).toBe(12);
    expect(published.transfer?.orphanMemory).toBe(0);
    // R88: the field's own metric, published on every pair rather than only on a transfer. Of the 12
    // paired trials the reference passed 4 (the other 8 are the informative ones it failed), and the
    // memory arm broke none of those — so the share is 0 over a denominator of 4 rather than absent.
    expect(published.degradation?.broke).toBe(0);
    expect(published.degradation?.measured).toBe(12);
    expect(published.degradation?.blankRight).toBe(4);
    expect(published.degradation?.breakRate).toBe(0);
    expect(published.degradation?.repaired).toBe(4);
    expect(published.transfer?.netPp).toBeCloseTo((4 / 12) * 100, 9);
    expect(published.transfer?.verdict).toBe('unmeasured');
    // The ledger is the pairs themselves: one row per episode, with the trial number kept.
    expect(published.transfer?.ledger).toHaveLength(12);
    expect(published.transfer?.ledger[0]).toEqual({ task: 'airline/1', trial: 0, blankCorrect: true, withMemoryCorrect: true });
    // Four gates arrive with the reading, and the index says so.
    expect(published.protocol.evaluable).toContain('V15-transfer-reconciles');
    expect(published.protocol.evaluable).toContain('V33-transfer-ledger');
    expect(published.protocol.supplyable).toBe(14);
    expect(published.protocol.armIndexed).toBe(26);
    // These arms did not record how many tasks their scenarios hold, so the pair states no ceiling:
    // an upper bound invented from a guess is worse than the absence it replaces.
    expect(published.ceiling).toBeUndefined();
  }, 60_000);

  it('states what the whole scenario could decide, from the listing the arm recorded', () => {
    // The resolution requirement and the resolution supply are different numbers, and the pair
    // published only the first: `tasksForFivePp` says what a 5pp half-width would take. This second
    // test is the supply — the scenario's own size — which is the number that decides whether
    // another dispatch can help at all.
    const dir = mkdtempSync(join(tmpdir(), 'l4-pair-ceiling-'));
    const referenceRows: Row[] = [
      { id: 'airline/1', trial: 0, reward: 1 },
      { id: 'airline/1', trial: 1, reward: 1 },
      { id: 'airline/2', trial: 0, reward: 0 },
      { id: 'airline/2', trial: 1, reward: 0 },
      { id: 'airline/3', trial: 0, reward: 0 },
      { id: 'airline/3', trial: 1, reward: 0 },
      { id: 'airline/4', trial: 0, reward: 0 },
      { id: 'airline/4', trial: 1, reward: 0 },
    ];
    // One task repaired, so a quarter of the paired tasks disagree.
    const memoryRows = referenceRows.map((row) => (row.id === 'airline/2' ? { ...row, reward: 1 } : row));

    writeFileSync(
      join(dir, 'reference.json'),
      JSON.stringify(arm({ arm: 'reference', rows: referenceRows, pass4: 0.25 })),
    );
    writeFileSync(
      join(dir, 'memory.json'),
      JSON.stringify(
        arm({
          arm: 'memory',
          rows: memoryRows,
          pass4: 0.5,
          scenarioTasks: { learn: 115, test: 57 },
        }),
      ),
    );

    try {
      execFileSync(TSX, [PAIR], {
        cwd: ROOT,
        encoding: 'utf8',
        env: {
          ...process.env,
          POC_RESULT_DIR: dir,
          L4_FIRST: join(dir, 'reference.json'),
          L4_SECOND: join(dir, 'memory.json'),
        },
      });
    } catch {
      // A failed finding gate still publishes its record, which is what this reads.
    }

    const published = JSON.parse(readFileSync(join(dir, 'poc-l4-pair.json'), 'utf8')) as {
      comparison: { paired: number; lost: number; gained: number };
      ceiling?: { tasks: number; halfWidthPp: number; mde80Pp: number; resolvesFivePp: boolean };
      degradation?: {
        broke: number;
        repaired: number;
        blankRight: number;
        measured: number;
        breakRate: number;
        netPp: number;
      };
    };

    expect(published.comparison.paired).toBe(4);
    expect(published.comparison.lost).toBe(0);
    expect(published.comparison.gained).toBe(1);
    // A quarter of the tasks disagree, so at 57 tasks the standard error is 6.62pp, the 95%
    // half-width 12.98pp and the 80%-power bar 18.56pp: the scenario cannot decide 5pp, and the
    // artefact now says so instead of leaving it to a reader who happens to know its size.
    expect(published.ceiling?.tasks).toBe(57);
    expect(published.ceiling?.halfWidthPp).toBeCloseTo(12.98, 1);
    expect(published.ceiling?.mde80Pp).toBeCloseTo(18.56, 1);
    expect(published.ceiling?.resolvesFivePp).toBe(false);
  }, 60_000);
});
