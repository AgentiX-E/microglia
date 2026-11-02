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
      protocol: { evaluable: readonly string[]; supplyable: number; armIndexed: number };
    };

    expect(published.scenario).toEqual({ learn: 'retail', test: 'airline', recall: 'retail' });
    expect(published.transfer?.paired).toBe(12);
    expect(published.transfer?.informative).toBe(8);
    expect(published.transfer?.repaired).toBe(4);
    expect(published.transfer?.broke).toBe(0);
    expect(published.transfer?.measured).toBe(12);
    expect(published.transfer?.orphanMemory).toBe(0);
    expect(published.transfer?.netPp).toBeCloseTo((4 / 12) * 100, 9);
    expect(published.transfer?.verdict).toBe('unmeasured');
    // The ledger is the pairs themselves: one row per episode, with the trial number kept.
    expect(published.transfer?.ledger).toHaveLength(12);
    expect(published.transfer?.ledger[0]).toEqual({ task: 'airline/1', trial: 0, blankCorrect: true, withMemoryCorrect: true });
    // Four gates arrive with the reading, and the index says so.
    expect(published.protocol.evaluable).toContain('V15-transfer-reconciles');
    expect(published.protocol.evaluable).toContain('V33-transfer-ledger');
    expect(published.protocol.supplyable).toBe(13);
    expect(published.protocol.armIndexed).toBe(26);
  }, 60_000);
});
