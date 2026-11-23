import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { treatmentKeyOf } from '../pack-ledgers.js';

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
  /** R141: the servable population and the sample the support is read from. */
  readonly store?: { readonly stored: number; readonly active: number; readonly servable: number };
  readonly storeItems?: { readonly items: readonly { readonly id: string; readonly supportTasks?: number }[] };
  readonly floor?: number;
  /** R156: the level the arm was scored at, so a pair can be graded on metric parity. */
  readonly k?: number;
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
    metrics: { pass4: input.pass4, k: input.k ?? 2, tasks: byTask.size, unscored_tasks: 0 },
    per_task: [...byTask].map(([id, passes]) => ({ id, passed_all: passes.every(Boolean) })),
    per_trial: input.rows,
    ...(input.arm === 'memory'
      ? {
          tau2: {
            meanPackIds: input.meanPackIds ?? 1,
            scenario: { learn: 'retail', test: 'airline', recall: 'retail' },
            split: { train: ['retail/1', 'retail/2'], test: [...byTask.keys()] },
            ...(input.scenarioTasks === undefined ? {} : { scenarioTasks: input.scenarioTasks }),
            ...(input.store === undefined ? {} : { store: input.store }),
            ...(input.storeItems === undefined ? {} : { storeItems: input.storeItems }),
            ...(input.floor === undefined
              ? {}
              : { supportFloor: { total: 4, retired: 2, retained: 2, floor: input.floor } }),
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

  it('prints the support behind what the pack served, and grades the floor when one ran', () => {
    // R141. The join the floor's criterion is written in spans two artefacts — the attribution table and
    // the store sample — and the *wiring* between them is invisible to both: a field the pair's own
    // projection does not carry produces no line at all, which reads as a lane that never asked. So this
    // case runs the bin the workflow runs and asserts the sentence it prints.
    const dir = mkdtempSync(join(tmpdir(), 'l4-pair-support-'));
    const referenceRows: Row[] = [
      { id: 'airline/1', trial: 0, reward: 1 },
      { id: 'airline/1', trial: 1, reward: 1 },
      { id: 'airline/2', trial: 0, reward: 0 },
      { id: 'airline/2', trial: 1, reward: 0 },
    ];
    const memoryRows = referenceRows.map((row) => (row.id === 'airline/2' ? { ...row, reward: 1 } : row));
    writeFileSync(
      join(dir, 'reference.json'),
      JSON.stringify(arm({ arm: 'reference', rows: referenceRows, pass4: 0.5 })),
    );
    writeFileSync(
      join(dir, 'memory.json'),
      JSON.stringify(
        arm({
          arm: 'memory',
          rows: memoryRows,
          pass4: 0.5,
          store: { stored: 4, active: 2, servable: 2 },
          storeItems: { items: [{ id: 'airline/1', supportTasks: 2 }, { id: 'airline/2', supportTasks: 3 }] },
          floor: 2,
        }),
      ),
    );
    let printed = '';
    try {
      printed = execFileSync(TSX, [PAIR], {
        cwd: ROOT,
        encoding: 'utf8',
        env: {
          ...process.env,
          POC_RESULT_DIR: dir,
          L4_FIRST: join(dir, 'reference.json'),
          L4_SECOND: join(dir, 'memory.json'),
        },
      });
    } catch (error) {
      // A failed finding gate still prints every reading; the sentence is what this reads.
      printed = String((error as { stdout?: string }).stdout ?? '');
    }
    // This fixture carries no episode ledger, so nothing was served into a measured episode — which is a
    // reading and not an absence, and the line says which of the two it is.
    expect(printed).toContain('serve support: no item was served');
  }, 60_000);
});

describe('the rung the pair prices from the artefacts it was given', () => {
  /**
   * A pair whose memory arm carries the three arrays a sweep needs: the ids served per request, the gate's
   * margin per request, and the episode boundary that ties a request to the trial it belonged to.
   *
   * The fixture is four trials wide on purpose. One repairable trial carries a high margin, one broken trial
   * carries a low one, and two trials are inert — which is the shape R142 measured (four repairs, six breaks,
   * forty-seven inert) reduced to something a reader can check by hand.
   */
  function armWithLedger(input: {
    readonly rows: readonly Row[];
    readonly pass4: number;
    readonly ledger?: readonly (readonly string[])[];
    readonly margins?: readonly (number | null)[];
    readonly starts?: readonly number[];
    readonly tasks?: readonly string[];
  }): unknown {
    const base = arm({ arm: 'memory', rows: input.rows, pass4: input.pass4 }) as Record<string, unknown>;
    const tau2 = base['tau2'] as Record<string, unknown>;
    return {
      ...base,
      tau2: {
        ...tau2,
        ...(input.ledger === undefined
          ? {}
          : {
              pack: {
                summary: { meanIds: 1, meanChars: 10 },
                ledger: input.ledger,
                ...(input.margins === undefined ? {} : { margins: { perRequest: input.margins } }),
              },
            }),
        ...(input.starts === undefined
          ? {}
          : {
              memory: {
                episodeStarts: input.starts,
                ...(input.tasks === undefined ? {} : { boundaryTasks: input.tasks }),
              },
            }),
      },
    };
  }

  it('prices every rung against the two arms\u2019 outcomes and publishes the first clean one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'l4-pair-sweep-'));
    const ids = ['airline/1', 'airline/2', 'airline/3', 'airline/4'];
    const reference: Row[] = [
      { id: 'airline/1', trial: 0, reward: 1 },
      { id: 'airline/2', trial: 0, reward: 0 },
      { id: 'airline/3', trial: 0, reward: 1 },
      { id: 'airline/4', trial: 0, reward: 0 },
    ];
    // 2 is repaired, 3 is broken, 1 and 4 are inert.
    const memory: Row[] = [
      { id: 'airline/1', trial: 0, reward: 1 },
      { id: 'airline/2', trial: 0, reward: 1 },
      { id: 'airline/3', trial: 0, reward: 0 },
      { id: 'airline/4', trial: 0, reward: 0 },
    ];
    writeFileSync(join(dir, 'reference.json'), JSON.stringify(arm({ arm: 'reference', rows: reference, pass4: 0.5 })));
    writeFileSync(
      join(dir, 'memory.json'),
      JSON.stringify(
        armWithLedger({
          rows: memory,
          pass4: 0.5,
          ledger: ids.map((_, index) => [`k_${String(index)}`]),
          // The repair carries 0.30 and the break 0.05, so 0.10 is the cheapest rung that keeps one and
          // withholds the other. The two inert trials sit above it so the served count is three of four.
          margins: [0.5, 0.3, 0.05, 0.5],
          starts: [0, 1, 2, 3],
          tasks: ids,
        }),
      ),
    );

    let printed = '';
    try {
      printed = execFileSync(TSX, [PAIR], {
        cwd: ROOT,
        encoding: 'utf8',
        env: {
          ...process.env,
          POC_RESULT_DIR: dir,
          L4_FIRST: join(dir, 'reference.json'),
          L4_SECOND: join(dir, 'memory.json'),
        },
      });
    } catch (error) {
      printed = String((error as { stdout?: string }).stdout ?? '');
    }

    expect(printed).toContain('serve sweep (estimated, withholding is priced as the control outcome)');
    expect(printed).toContain('the first rung that withholds every break is 0.08');
    expect(printed).toContain('keeps 1 repair(s) and serves 3 of 4 trial(s)');

    const published = JSON.parse(readFileSync(join(dir, 'poc-l4-pair.json'), 'utf8')) as {
      serveSweep?: {
        trials: number;
        unpriced: number;
        firstClean: { rung: number; served: number; kept: number; broke: number } | null;
        rows: readonly { rung: number; served: number; net: number }[];
      };
    };
    expect(published.serveSweep?.trials).toBe(4);
    expect(published.serveSweep?.unpriced).toBe(0);
    expect(published.serveSweep?.firstClean).toMatchObject({ rung: 0.08, served: 3, kept: 1, broke: 0 });
    expect(published.serveSweep?.rows).toHaveLength(10);
    // At rung zero everything is served, so the estimated net is the measured one: one repair and one break.
    expect(published.serveSweep?.rows[0]).toMatchObject({ rung: 0, served: 4, net: 0 });
  }, 60_000);

  it('refuses to price a rung when one task was simulated twice, because a render cannot tell the trials apart', () => {
    // `trials: 4` is a legal arm and this lane has run it. The sweep's unit is the trial, the render's grain is
    // (record, task), and pooling two trials of one task would price a population the artefacts cannot
    // separate — so the line names the refusal instead of printing a table about the wrong unit.
    const dir = mkdtempSync(join(tmpdir(), 'l4-pair-repeat-'));
    const reference: Row[] = [
      { id: 'airline/1', trial: 0, reward: 1 },
      { id: 'airline/1', trial: 1, reward: 1 },
    ];
    const memory: Row[] = [
      { id: 'airline/1', trial: 0, reward: 0 },
      { id: 'airline/1', trial: 1, reward: 0 },
    ];
    writeFileSync(join(dir, 'reference.json'), JSON.stringify(arm({ arm: 'reference', rows: reference, pass4: 0 })));
    writeFileSync(
      join(dir, 'memory.json'),
      JSON.stringify(
        armWithLedger({
          rows: memory,
          pass4: 0,
          ledger: [['k_1'], ['k_1']],
          margins: [0.5, 0.4],
          starts: [0, 1],
          tasks: ['airline/1', 'airline/1'],
        }),
      ),
    );

    let printed = '';
    try {
      printed = execFileSync(TSX, [PAIR], {
        cwd: ROOT,
        encoding: 'utf8',
        env: {
          ...process.env,
          POC_RESULT_DIR: dir,
          L4_FIRST: join(dir, 'reference.json'),
          L4_SECOND: join(dir, 'memory.json'),
        },
      });
    } catch (error) {
      printed = String((error as { stdout?: string }).stdout ?? '');
    }
    expect(printed).toContain('serve sweep: not priced, 1 task(s) were simulated more than once');
    const published = JSON.parse(readFileSync(join(dir, 'poc-l4-pair.json'), 'utf8')) as { serveSweep?: unknown };
    expect(published.serveSweep).toBeUndefined();
  }, 60_000);

  it('says nothing at all when the memory arm carried no margin census', () => {
    const dir = mkdtempSync(join(tmpdir(), 'l4-pair-nosweep-'));
    const rows: Row[] = [
      { id: 'airline/1', trial: 0, reward: 1 },
      { id: 'airline/2', trial: 0, reward: 0 },
    ];
    writeFileSync(join(dir, 'reference.json'), JSON.stringify(arm({ arm: 'reference', rows, pass4: 0.5 })));
    writeFileSync(
      join(dir, 'memory.json'),
      JSON.stringify(
        armWithLedger({
          rows,
          pass4: 0.5,
          ledger: [['k_1'], ['k_2']],
          starts: [0, 1],
          tasks: ['airline/1', 'airline/2'],
        }),
      ),
    );

    let published: { serveSweep?: unknown } = {};
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
      // A failed finding gate still publishes its record.
    }
    published = JSON.parse(readFileSync(join(dir, 'poc-l4-pair.json'), 'utf8')) as { serveSweep?: unknown };
    // Absent rather than a table of zeroes: an arm that asked no census cannot be read as a store whose packs
    // were never contested, and the sweep says so by carrying nothing.
    expect(published.serveSweep).toBeUndefined();
  }, 60_000);
});

/**
 * The two identities a cross-fit reads off the pair, over the shape the arms actually write.
 *
 * The reference arm is not a memory arm with an empty store in the artefact: it carries a `tau2` block since
 * R130 — usage, cost, turns, a scenario — and its `split.train` is the empty list `controlRaw` records because
 * the arm learned nothing, while `split.test` is the same held-out half the memory arm answered. That
 * asymmetry is the pair's design, and a guard that read it as "two arms that recorded different splits"
 * refused every artefact this lane has written: the committed pair carries `foldSplitAbsent` and
 * `treatmentAbsent` down to today, which is why no cross-fit has ever been poolable.
 */
describe('the fold a cross-fit reads off the pair', () => {
  /** One arm as the driver writes it: the four metrics, the episodes, and the `tau2` block both arms carry. */
  function armWithSplit(input: {
    readonly arm: 'memory' | 'reference';
    readonly rows: readonly Row[];
    readonly train: readonly string[] | undefined;
    readonly test: readonly string[] | undefined;
    readonly treatment?: {
      readonly unit?: string;
      readonly form?: string;
      readonly scope?: string;
      readonly knobs?: string;
    };
    /** R202: the policy the arm declared. Absent is every arm that declared none, and every artefact before R152. */
    readonly rotation?: 'fair-share' | 'off';
    /** R204: the body the pack was made of. Absent is every artefact before the field, which is the block. */
    readonly serveBody?: 'rendered' | 'guidance';
    /** R204: the store counted before and after the phase, as the driver records it. */
    readonly storeGrowth?: { readonly before: number; readonly after: number; readonly grew: boolean };
    /** R204: the summariser's own census, which the agent writes into the phase's diagnostics. */
    readonly guidance?: Readonly<Record<string, unknown>>;
  }): unknown {
    const base = arm({ arm: input.arm, rows: input.rows, pass4: 0.5 }) as Record<string, unknown>;
    return {
      ...base,
      model: 'deepseek/deepseek-chat',
      tau2: {
        ...((base['tau2'] as Record<string, unknown> | undefined) ?? {}),
        scenario: { learn: 'retail', test: 'airline', recall: 'retail' },
        ...(input.train === undefined || input.test === undefined
          ? // `undefined` rather than nothing: the base fixture is a memory arm and carries a split, and this
            // case is the arm that predates the field. `JSON.stringify` drops the key, which is absence.
            { split: undefined }
          : { split: { train: input.train, test: input.test } }),
        servedPackSizes: [],
        learning: { rows: input.train?.length ?? 0, unanswered: 0, edited: 0, distilled: 0, distillFailed: 0 },
        // R202: a mode on its own is what the report type allows, and it is the whole identity the pool compares.
        ...(input.rotation === undefined ? {} : { serveRotation: { mode: input.rotation } }),
        ...(input.serveBody === undefined ? {} : { serveBody: input.serveBody }),
        ...(input.storeGrowth === undefined ? {} : { storeGrowth: input.storeGrowth }),
        ...(input.guidance === undefined ? {} : { memory: { guidance: input.guidance } }),
        ...(input.treatment === undefined
          ? {}
          : {
              ...(input.treatment.unit === undefined ? {} : { distillUnit: { unit: input.treatment.unit } }),
              ...(input.treatment.form === undefined ? {} : { distillForm: { form: input.treatment.form } }),
              ...(input.treatment.scope === undefined ? {} : { distillScope: input.treatment.scope }),
              ...(input.treatment.knobs === undefined ? {} : { pack: { summary: null, knobs: input.treatment.knobs } }),
            }),
      },
    };
  }

  const ROWS: Row[] = [
    { id: 'airline/1', trial: 0, reward: 1 },
    { id: 'airline/2', trial: 0, reward: 0 },
  ];

  function publish(reference: unknown, memory: unknown): Record<string, unknown> {
    const dir = mkdtempSync(join(tmpdir(), 'l4-pair-fold-'));
    writeFileSync(join(dir, 'reference.json'), JSON.stringify(reference));
    writeFileSync(join(dir, 'memory.json'), JSON.stringify(memory));
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
      // A failed finding gate still publishes its record.
    }
    return JSON.parse(readFileSync(join(dir, 'poc-l4-pair.json'), 'utf8')) as Record<string, unknown>;
  }

  it('states the split of the arm that learned and the treatment of the arm that served', () => {
    // The reference arm learned nothing and served nothing: `train: []` is its record, not its omission.
    const reference = armWithSplit({ arm: 'reference', rows: ROWS, train: [], test: ['airline/1', 'airline/2'] });
    const memory = armWithSplit({
      arm: 'memory',
      rows: ROWS,
      train: ['retail/1', 'retail/2', 'retail/3'],
      test: ['airline/1', 'airline/2'],
      treatment: { unit: 'correction', form: 'lesson', scope: 'edited', knobs: '' },
    });
    const published = publish(reference, memory);

    expect(published['foldSplitAbsent']).toBeUndefined();
    expect(published['foldSplit']).toEqual({
      learned: ['retail/1', 'retail/2', 'retail/3'],
      evaluated: ['airline/1', 'airline/2'],
    });
    expect(published['treatmentAbsent']).toBeUndefined();
    // R202: the serving policy is a field of the treatment even when nobody declared one. This fixture's arms
    // carry no `serveRotation` block, which is the shape every pre-R152 artefact has, and the pair now says
    // `none` where it used to say nothing — the two used to produce the same pool key.
    expect(published['treatment']).toEqual({
      unit: 'correction',
      form: 'lesson',
      scope: 'edited',
      model: 'deepseek/deepseek-chat',
      knobs: '',
      rotation: 'none',
      // R204: and the body, which this fixture's arms never named — `rendered` is the answer for every fold
      // written before the field, because there was one body and every artefact was produced under it.
      serveBody: 'rendered',
    });
  }, 60_000);

  it('states the policy a bounded arm declared, and gives that fold a key of its own', () => {
    // R202's other half: the field is not a constant. `none` and `fair-share` are the two names the pool has to
    // tell apart, and this runs both through the step that writes the artefact rather than comparing literals.
    const reference = armWithSplit({ arm: 'reference', rows: ROWS, train: [], test: ['airline/1', 'airline/2'] });
    const treatment = { unit: 'correction', form: 'lesson', scope: 'edited', knobs: '' };
    const memory = (rotation?: 'fair-share'): unknown =>
      armWithSplit({ arm: 'memory', rows: ROWS, train: ['retail/1'], test: ['airline/1', 'airline/2'], treatment, rotation });

    const bounded = publish(reference, memory('fair-share'));
    const unbounded = publish(reference, memory());
    expect((bounded['treatment'] as { rotation?: string }).rotation).toBe('fair-share');
    expect((unbounded['treatment'] as { rotation?: string }).rotation).toBe('none');
    expect(treatmentKeyOf(bounded['treatment'])).not.toBe(treatmentKeyOf(unbounded['treatment']));
  }, 60_000);

  it('publishes the transient arm’s three readings, and gives that fold a key of its own', () => {
    // R204's acceptance, at the boundary the reader actually sees. The arm's claim is a shape, not a score:
    // the summariser was called once per served episode, the store is the same size at the end of the phase as
    // at the start, and the pack was a sentence. The delta this pair also carries is the by-product the
    // registration ordered last, and none of the three readings above can be reconstructed from it.
    const treatment = { unit: 'correction', form: 'lesson', scope: 'edited', knobs: '' };
    const store = { before: 11, after: 11, grew: false };
    const guidance = {
      mode: 'guidance',
      model: 'deepseek/deepseek-flash',
      calls: 40,
      sentences: 37,
      refusals: 3,
      failures: 0,
      promptChars: 52_000,
      sentenceChars: 96.4,
    };
    const reference = armWithSplit({
      arm: 'reference',
      rows: ROWS,
      train: [],
      test: ['airline/1', 'airline/2'],
      storeGrowth: store,
    });
    const memory = armWithSplit({
      arm: 'memory',
      rows: ROWS,
      train: ['retail/1'],
      test: ['airline/1', 'airline/2'],
      treatment,
      serveBody: 'guidance',
      storeGrowth: store,
      guidance,
    });

    const published = publish(reference, memory);
    expect((published['treatment'] as { serveBody?: string }).serveBody).toBe('guidance');
    const transient = published['transient'] as {
      serveBody: string;
      guidance: unknown;
      store: { reference: unknown; memory: unknown };
    };
    expect(transient.serveBody).toBe('guidance');
    expect(transient.guidance).toEqual(guidance);
    expect(transient.store).toEqual({ reference: store, memory: store });

    // And the key: a sentence arm is not poolable with a block arm, which is the whole reason the field exists.
    const block = publish(reference, armWithSplit({
      arm: 'memory',
      rows: ROWS,
      train: ['retail/1'],
      test: ['airline/1', 'airline/2'],
      treatment,
      serveBody: 'rendered',
      storeGrowth: store,
    }));
    expect(treatmentKeyOf(published['treatment'])).toContain('serveBody=guidance');
    expect(treatmentKeyOf(block['treatment'])).toContain('serveBody=rendered');
  }, 60_000);

  it('says which arm could not state its split, because an artefact from before the field is not a leak', () => {
    const reference = armWithSplit({ arm: 'reference', rows: ROWS, train: [], test: ['airline/1', 'airline/2'] });
    // A memory arm from before R143: no `tau2.split` at all. The pair cannot state the half its store learned,
    // and it says which arm left the hole rather than inventing a boundary that would pass the leak check.
    const memory = armWithSplit({ arm: 'memory', rows: ROWS, train: undefined, test: undefined });
    const published = publish(reference, memory);
    expect(published['foldSplit']).toBeUndefined();
    expect((published['foldSplitAbsent'] as { reason: string }).reason).toBe('arm(s) record no evaluation half: memory');
  }, 60_000);
});


/**
 * The level the pair was scored at, end to end.
 *
 * R152c published a `k = 1` delta under a field named `pass4` and compared it to a `pass^4` bar, and no
 * file in the three it wrote could be read to see it. These tests are that shape, run through the step:
 * the pair states each arm's level, its own, and whether the bar's agrees.
 */
describe('the metric a pair was scored at', () => {
  const ROWS: Row[] = [
    { id: 'airline/1', trial: 0, reward: 1 },
    { id: 'airline/2', trial: 0, reward: 0 },
    { id: 'airline/3', trial: 0, reward: 0 },
    { id: 'airline/4', trial: 0, reward: 0 },
  ];

  function publish(input: {
    readonly kReference?: number;
    readonly kMemory?: number;
    readonly test?: string;
  }): { readonly published: Record<string, unknown>; readonly status: number } {
    const dir = mkdtempSync(join(tmpdir(), 'l4-pair-metric-'));
    const build = (armKind: 'memory' | 'reference', k: number): unknown => {
      const base = arm({ arm: armKind, rows: ROWS, pass4: 0.25, k }) as Record<string, unknown>;
      return {
        ...base,
        tau2: {
          ...((base['tau2'] as Record<string, unknown> | undefined) ?? {}),
          scenario: { learn: 'retail', test: input.test ?? 'airline', recall: 'retail' },
        },
      };
    };
    writeFileSync(join(dir, 'reference.json'), JSON.stringify(build('reference', input.kReference ?? 2)));
    writeFileSync(join(dir, 'memory.json'), JSON.stringify(build('memory', input.kMemory ?? 2)));
    let status = 0;
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
    } catch (error) {
      status = (error as { status?: number }).status ?? 1;
    }
    return {
      published: JSON.parse(readFileSync(join(dir, 'poc-l4-pair.json'), 'utf8')) as Record<string, unknown>,
      status,
    };
  }

  it('states each arm\u2019s level and passes the gate when they agree', () => {
    const { published } = publish({ kReference: 2, kMemory: 2 });
    const protocol = published['protocol'] as Record<string, unknown>;
    expect(protocol['k']).toBe(2);
    expect(protocol['kFirst']).toBe(2);
    expect(protocol['kSecond']).toBe(2);
    // An airline pair has no published bar, so there is no level of the bar's to compare with.
    expect(protocol['barK']).toBeNull();
    expect(protocol['barKMismatch']).toBeNull();
    expect(protocol['kAbsent']).toBeUndefined();
    const gates = published['gates'] as readonly { id: string; pass: boolean; blocking: boolean }[];
    const gate = gates.find((row) => row.id === 'l4-same-k');
    expect(gate).toMatchObject({ pass: true, blocking: true });
    expect((published['first'] as Record<string, unknown>)['k']).toBe(2);
    expect((published['second'] as Record<string, unknown>)['k']).toBe(2);
  });

  it('fails and blocks when the arms were scored at different levels', () => {
    const { published } = publish({ kReference: 2, kMemory: 4 });
    const protocol = published['protocol'] as Record<string, unknown>;
    expect(protocol['k']).toBeNull();
    expect(protocol['kFirst']).toBe(2);
    expect(protocol['kSecond']).toBe(4);
    const gates = published['gates'] as readonly { id: string; pass: boolean; blocking: boolean }[];
    expect(gates.find((row) => row.id === 'l4-same-k')).toMatchObject({ pass: false, blocking: true });
  });

  it('says the bar is on another statistic when the pair agrees at a level the bar does not use', () => {
    // The R152c shape: a `k = 1` fold on the published scenario. The pair is internally consistent and may
    // be read; the delta against `0.575` is a comparison of two statistics, and the artefact now says so.
    const { published } = publish({ kReference: 1, kMemory: 1, test: 'retail' });
    const protocol = published['protocol'] as Record<string, unknown>;
    expect(protocol['k']).toBe(1);
    expect(protocol['barK']).toBe(4);
    expect(protocol['barKMismatch']).toBe(true);
    const gates = published['gates'] as readonly { id: string; pass: boolean }[];
    expect(gates.find((row) => row.id === 'l4-same-k')?.pass).toBe(true);
    // And what each arm's headline would read at the bar's level: the fixture's arms both scored 0.25, so
    // the restatement is 0.25⁴, and the assumption is carried beside it rather than in a footnote.
    const restated = protocol['restatedAtBarK'] as Record<string, unknown>;
    expect(restated['k']).toBe(4);
    expect(restated['first']).toBeCloseTo(0.25 ** 4, 12);
    expect(restated['second']).toBeCloseTo(0.25 ** 4, 12);
    expect(String(restated['assumption'])).toContain('independent');
  });
});
