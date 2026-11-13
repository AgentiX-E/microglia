import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * A planted arm, through the two steps that grade it, end to end.
 *
 * `sampleGates` and `pairGates` are unit-tested, and the *wiring* between them and the environment was
 * not: `l4.ts` reads `TAU_PLANTED_RULES` and `l4-pair.ts` reads the plant census out of the artefact,
 * and a wiring mistake is invisible to both modules — it shows up as a bar applied to an arm whose own
 * hypothesis is that it misses the bar. That happened twice in one day (`597788d`, `4083945`), and the
 * second time it was a `string` written into `Record<string, number>` that no local gate checked.
 *
 * So these two cases run the bins the workflow runs, with a driver module standing in for the τ²
 * environment, and read what they published.
 */

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const TSX = join(ROOT, 'node_modules', '.bin', 'tsx');
const L4 = join(ROOT, 'packages', 'eval', 'src', 'bin', 'l4.ts');
const PAIR = join(ROOT, 'packages', 'eval', 'src', 'bin', 'l4-pair.ts');

const TASKS = 48;

/**
 * A driver the bin can import: it reports the tasks it was asked to, and its plant census.
 *
 * The shape is the one `l4.ts` reads through a dynamic `import` — `run()` for the measurement and
 * `instrument()` for the counts — which is the whole contract between the lane and this file.
 */
function driverModule(options: { readonly passes: number; readonly plant?: string }): string {
  const rows = Array.from({ length: TASKS }, (_, index) => ({
    taskId: `retail/${String(index)}`,
    // Four trials since R93: `l4.ts` derives `k` from `TAU_TRIALS` and withholds the published bar at
    // any other value, so a two-trial fixture would exercise the arm without the bar it is about.
    successes: index < options.passes ? 4 : 0,
    trials: 4,
    k: 4,
  }));
  const plant =
    options.plant === undefined
      ? ''
      : `export function instrument() {
  return {
    plant: {
      arm: '${options.plant}', declared: true, planted: ${String(TASKS)}, inBand: ${String(TASKS)},
      createdBlock: 0, terms: [], coverages: [], byRule: {}, digest: 'fixture-digest',
    },
  };
}
`;
  return `export async function run() {\n  return ${JSON.stringify(rows)};\n}\n${plant}`;
}

/** Run one bin and return what it wrote, tolerating a non-zero exit: the artefact is the reading. */
function runBin(
  bin: string,
  dir: string,
  env: Readonly<Record<string, string>>,
): Record<string, unknown> {
  const out = join(dir, 'out');
  try {
    execFileSync(TSX, [bin], {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        POC_RESULT_DIR: out,
        TAU_MIN_TASKS: '40',
        TAU_TRIALS: '4',
        TAU_TEST_DOMAIN: 'retail',
        TAU_TRAIN_DOMAIN: 'retail',
        TAU_RECALL_DOMAIN: 'retail',
        // Cleared rather than inherited: the test machine may run this suite inside a dispatch that
        // planted something, and a case that silently measured the plant would assert the opposite
        // of what it says.
        TAU_PLANTED_RULES: '',
        TAU_DISTILL_SCOPE: '',
        TAU_MEMORY: 'true',
        ...env,
      },
    });
  } catch {
    // A failed gate still writes its artefact, which is the thing under test here.
  }
  const file = bin === L4 ? 'poc-l4.json' : 'poc-l4-pair.json';
  return JSON.parse(readFileSync(join(out, file), 'utf8')) as Record<string, unknown>;
}

function workdir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe('a dispatch that planted a distractor', () => {
  it('is graded without the published bar and says so in its artefact', () => {
    const dir = workdir('l4-plant-');
    const driver = join(dir, 'driver.ts');
    writeFileSync(driver, driverModule({ passes: TASKS, plant: 'near' }));

    const published = runBin(L4, dir, { TAU_DRIVER: driver, TAU_PLANTED_RULES: 'near' });
    const metrics = published['metrics'] as Record<string, number>;
    const samples = published['samples'] as readonly { id: string }[];

    // The two flags a reader needs: this arm is a memory arm (1) and the competitive bar is not its
    // bar (0), and the plant's own name is in the census the driver wrote rather than duplicated into
    // a record of numbers.
    expect(metrics['arm']).toBe(1);
    expect(metrics['published_bar_applies']).toBe(0);
    expect(metrics['planted_arm']).toBe(1);
    expect((published['tau2'] as { plant?: { arm?: string } }).plant?.arm).toBe('near');
    // The bar is omitted rather than passed, and it is omitted rather than quietly dropped: the gates
    // that every arm owes are still there.
    expect(samples.map((gate) => gate.id)).not.toContain('l4-pass4');
    expect(samples.map((gate) => gate.id)).toContain('l4-coverage');
    expect(samples.map((gate) => gate.id)).toContain('l4-fully-scored');
    // And no delta against the published number, for the same reason the gate is gone.
    expect(metrics['delta']).toBeUndefined();
  });

  it('leaves a memory arm that planted nothing holding the bar it always had', () => {
    const dir = workdir('l4-control-');
    const driver = join(dir, 'driver.ts');
    writeFileSync(driver, driverModule({ passes: TASKS }));

    const published = runBin(L4, dir, { TAU_DRIVER: driver });
    const metrics = published['metrics'] as Record<string, number>;
    const samples = published['samples'] as readonly { id: string; pass: boolean }[];

    expect(metrics['arm']).toBe(1);
    expect(metrics['published_bar_applies']).toBe(1);
    expect(metrics['planted_arm']).toBe(0);
    expect(published['tau2']).toBeUndefined();
    const bar = samples.find((gate) => gate.id === 'l4-pass4');
    expect(bar).toBeDefined();
    // Every task passed, so the bar is met rather than merely present.
    expect(bar?.pass).toBe(true);
  });
});

describe('a pair whose memory arm planted a distractor', () => {
  /** One arm's artefact, in the shape `l4.ts` writes and `l4-pair.ts` reads. */
  function arm(input: {
    readonly rows: readonly { readonly id: string; readonly passed: boolean }[];
    readonly plant?: string;
  }): unknown {
    return {
      id: 'poc-l4',
      n: input.rows.length,
      metrics: { pass4: 0.5, k: 2, tasks: input.rows.length, unscored_tasks: 0 },
      per_task: input.rows.map((row) => ({ id: row.id, passed_all: row.passed })),
      ...(input.plant === undefined ? {} : { tau2: { plant: { arm: input.plant } } }),
    };
  }

  /**
   * The pair R57's `near` arm is registered to produce: eight episodes broken, none repaired.
   *
   * Eight of twelve discordant pairs in one direction is p = 2·0.5⁸ = 0.0078, which clears the revert
   * rule's significance branch — so this pair is a `HARM` by the lane's own definition, and the only
   * question the test asks is whose harm it is.
   */
  function harmedPair(dir: string, plant: string | undefined): void {
    const reference = Array.from({ length: 12 }, (_, index) => ({
      id: `retail/${String(index)}`,
      passed: true,
    }));
    const memory = reference.map((row, index) => ({ ...row, passed: index < 4 }));
    writeFileSync(
      join(dir, 'reference.json'),
      JSON.stringify(arm({ rows: reference })),
    );
    writeFileSync(
      join(dir, 'memory.json'),
      JSON.stringify(arm({ rows: memory, ...(plant === undefined ? {} : { plant }) })),
    );
  }

  it('is not read against the treatment\'s harm branch', () => {
    const dir = workdir('l4-pair-plant-');
    harmedPair(dir, 'near');

    const published = runBin(PAIR, dir, {
      L4_FIRST: join(dir, 'reference.json'),
      L4_SECOND: join(dir, 'memory.json'),
    });

    const gates = published['gates'] as readonly { id: string; pass: boolean; blocking: boolean }[];
    expect(gates.map((gate) => gate.id)).not.toContain('l4-paired');
    expect(gates.map((gate) => gate.id)).not.toContain('l4-effect-resolved');
    // The split gate is a property of the two files rather than a hypothesis about either arm, so it
    // stays — and it passes, because both arms scored the same twelve tasks.
    expect(gates.find((gate) => gate.id === 'l4-same-split')?.pass).toBe(true);
    expect(published['planted_arm']).toBe('near');
    // The gate is omitted; the number is not, and it is the number the arm was registered to produce.
    expect((published['comparison'] as { paired: number }).paired).toBe(12);
    // The state is the registered revert rule's answer and stays: -7.02pp below the -5pp bar with a
    // served pack is what R45 says it is. The *claim* does not stay, because "the memory costs
    // accuracy" is false of a loss we planted on purpose.
    const verdict = published['verdict'] as { state: string; claim: string | null };
    expect(verdict.state).toBe('HARM');
    expect(verdict.claim).toBeNull();
    // And that suppression is what the protocol's resolution gate reads: a run that publishes a
    // direction it cannot resolve is blocked by `V5-resolution`, which is right — so the fix belongs
    // in the artefact rather than in the gate. On these twelve tasks the minimum detectable
    // difference is far above the seven-point delta, so a claim here would have been refused.
    const resolution = gates.find((gate) => gate.id === 'V5-resolution');
    expect(resolution?.pass).toBe(true);
    expect(resolution?.actual).toContain('claims no direction');
  });

  it('fails the same pair when nothing was planted, which is why the exemption is keyed on the census', () => {
    // The control for the case above. Identical rows, no plant census, and the harm branch fires: the
    // exemption is a property of the arm's own artefact, not of the environment the step ran in.
    const dir = workdir('l4-pair-control-');
    harmedPair(dir, undefined);

    const published = runBin(PAIR, dir, {
      L4_FIRST: join(dir, 'reference.json'),
      L4_SECOND: join(dir, 'memory.json'),
    });

    const gates = published['gates'] as readonly { id: string; pass: boolean; blocking: boolean }[];
    const paired = gates.find((gate) => gate.id === 'l4-paired');
    expect(paired?.pass).toBe(false);
    expect(paired?.blocking).toBe(true);
    expect(published['planted_arm']).toBeUndefined();
    // The other half of the pair above: the same numbers, no plant, and the claim is published —
    // which is what makes `V5-resolution` fail. Two files that agreed on the omission but disagreed
    // about the claim would have left the sentence standing on the arm it misattributes.
    const verdict = published['verdict'] as { claim: string | null };
    expect(verdict.claim).toBe('the memory costs accuracy: -66.67pp');
    // And the protocol grades a claim it can see. This one is *resolved* — 66.67pp against a
    // resolution of about twenty — so the gate passes, which is why the assertion is on what it read
    // rather than on its verdict: the contrast with the planted case above is "claims no direction"
    // versus "claims -66.67pp", and that contrast is what the suppression buys.
    const resolution = gates.find((gate) => gate.id === 'V5-resolution');
    expect(resolution?.actual).toContain('claims -66.67pp');
    expect(resolution?.actual).not.toContain('claims no direction');
  });
});
