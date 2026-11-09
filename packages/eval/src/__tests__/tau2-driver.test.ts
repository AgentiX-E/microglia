import { existsSync, mkdtempSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

/**
 * The L4 driver's orchestration, against a stand-in for τ²-bench.
 *
 * The benchmark itself needs Python, a clone, and hours of model calls, so it
 * cannot run here. Everything around it can: the task listing, the deterministic
 * split, the argv handed to the script, and the reading of its result document. A
 * driver that passes the wrong flag fails *after* the environment is installed,
 * which is the most expensive possible moment to find out.
 *
 * The reference arm (`TAU_MEMORY=false`) is what runs end to end here: it makes no
 * model call of its own, so the whole path from "list tasks" to "pass^4 inputs" is
 * exercised without a provider.
 */

const STUB = `#!/usr/bin/env node
const args = process.argv.slice(2);
const read = (flag) => {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
};
const phase = read('--phase');
const out = read('--out');
if (phase === 'list') {
  require('node:fs').writeFileSync(out, JSON.stringify({ domain: 'retail', tasks: ['t4', 't1', 't3', 't2'] }));
} else {
  const tasks = (read('--tasks') || '').split(',').filter(Boolean);
  const trials = Number(read('--trials') || 1);
  const simulations = [];
  for (const taskId of tasks) {
    for (let trial = 0; trial < trials; trial += 1) {
      // t1 passes every trial, t2 fails every trial, the rest alternate by trial.
      const reward = taskId === 't1' ? 1 : taskId === 't2' ? 0 : trial % 2 === 0 ? 1 : 0;
      simulations.push({ task_id: taskId, trial, reward_info: { reward } });
    }
  }
  // Every task states the tool call it expects, which is what a correction is learned from: a task
  // without criteria teaches nothing and would make the learning half look empty for a reason that
  // has nothing to do with the provider.
  require('node:fs').writeFileSync(
    out,
    JSON.stringify({
      info: { environment_info: { domain_name: 'retail' } },
      tasks: tasks.map((id) => ({
        id,
        evaluation_criteria: { actions: [{ name: 'lookup', arguments: { id } }] },
      })),
      simulations,
    }),
  );
}
`;

function stubRunner(): { dir: string; executable: string } {
  const dir = mkdtempSync(join(tmpdir(), 'tau2-stub-'));
  const executable = join(dir, 'stub-runner');
  writeFileSync(executable, STUB, 'utf8');
  chmodSync(executable, 0o755);
  return { dir, executable };
}

// Every case here spawns a runner and drives a full evaluation loop. The suite's 20s default is a
// budget for a unit test, and at 172 files a parallel run starves one; the same cases take 1.4s
// alone. 60s is the convention the other end-to-end cases in this package already use, so a failure
// here means the driver hung rather than that the machine was busy.
describe('the L4 driver', () => {
  it('lists, splits, and scores the reference arm end to end', async () => {
    const { dir, executable } = stubRunner();
    process.env['TAU_PYTHON'] = executable;
    process.env['TAU_MEMORY'] = 'false';
    process.env['TAU_TRIALS'] = '4';
    process.env['TAU_TRAIN_SHARE'] = '0.5';
    process.env['TAU_WORKDIR'] = dir;
    try {
      // Imported after the environment is set: the module reads it at load time.
      const driver = await import('../bin/tau2-driver.js');
      const tasks = await driver.run();
      // The held-out half is t3 and t4. Both alternate pass/fail across four
      // trials, so pass^4 is 0 for each - the estimator's answer, not an average
      // that would read 50%.
      // Each task is named by the scenario that owns it. τ² numbers its tasks from zero in every
      // domain, so a bare `t3` is a name two scenarios can both claim and the split's own overlap
      // check would read one scenario's tasks as another's leaks.
      expect(tasks).toEqual([
        { successes: 2, trials: 4, k: 4, taskId: 'retail/t3' },
        { successes: 2, trials: 4, k: 4, taskId: 'retail/t4' },
      ]);
      const written = JSON.parse(readFileSync(join(dir, 'eval.json'), 'utf8')) as {
        simulations: unknown[];
      };
      expect(written.simulations).toHaveLength(8);
      // The episodes the pairing step needs, one row per trial, named the same way.
      expect(driver.trials()).toHaveLength(8);
      expect(driver.trials()?.[0]).toEqual({
        id: 'retail/t3',
        trial: 0,
        reward: 1,
      });
    } finally {
      delete process.env['TAU_PYTHON'];
      delete process.env['TAU_MEMORY'];
      delete process.env['TAU_TRIALS'];
      delete process.env['TAU_TRAIN_SHARE'];
      delete process.env['TAU_WORKDIR'];
    }
  }, 60_000);

  it('sweeps the consolidation floor on a trace arm, end to end', async () => {
    // The sweep is the instrument R61 grades, and it sits after distillation in the driver: a fault
    // there would spend an hour of evaluation before showing. This drives the whole path — stub
    // benchmark, stubbed provider, write, pass, sweep — and asserts the reading reaches the
    // instrument block.
    //
    // Two paraphrases alternating between calls, because two *identical* claims never reach the
    // consolidation pass: the write path absorbs them under one dedupe key first, which is a
    // different mechanism and would make this test pass for the wrong reason.
    const { dir, executable } = stubRunner();
    process.env['TAU_PYTHON'] = executable;
    process.env['TAU_MEMORY'] = 'true';
    process.env['TAU_TRIALS'] = '2';
    // Three tasks teach and one is held out: the split has to be strictly interior, and two failing
    // teaching tasks are what a corroboration needs.
    process.env['TAU_TRAIN_SHARE'] = '0.75';
    process.env['TAU_DISTILL_UNIT'] = 'trace';
    process.env['TAU_WORKDIR'] = dir;
    process.env['DEEPSEEK_API_KEY'] = 'test-key';
    process.env['TAU_DISTILL_MODEL'] = 'deepseek/deepseek-chat';
    const statements = [
      'Confirm the customer identity before changing a pending reservation',
      'Confirm the customer identity before you change a pending reservation',
    ];
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify([
                    {
                      kind: 'procedure',
                      statement: statements[calls++ % statements.length],
                    },
                  ]),
                },
              },
            ],
            usage: { prompt_tokens: 3, completion_tokens: 3 },
          }),
          { status: 200 },
        ),
    );
    try {
      const driver = await import('../bin/tau2-driver.js?case=trace-sweep');
      await driver.run();
      const record = driver.instrument();
      // The pass ran, and the sweep describes it at the operating floor rather than at a floor of
      // its own choosing.
      const census = record?.distillUnit?.consolidation;
      const sweep = record?.consolidationSweep;
      // What this stub can prove is the wiring: the pass ran over a real store, and the sweep
      // describes that same pass. It cannot prove a merge — this benchmark produces one correction,
      // and a corroboration needs two tasks — so the grouping itself is asserted where the store is
      // constructed rather than here.
      expect(census?.considered).toBeGreaterThanOrEqual(1);
      expect(sweep?.operating.threshold).toBeCloseTo(census?.threshold ?? -1, 10);
      expect(sweep?.operating.groups).toBe(census?.groups);
      expect(sweep?.operating.maxSupport).toBe(census?.maxSupportAfter);
      // Complete linkage's invariant, over whatever groups this store holds.
      for (const group of sweep?.groups ?? []) {
        expect(group.weakestPair).toBeGreaterThanOrEqual((sweep?.operating.threshold ?? 1) - 1e-9);
      }
      // A grid, not a point: the veto's column has to be there for the ablation to exist.
      const conditions = new Set((sweep?.points ?? []).map((point) => point.conditionMinShared));
      expect(conditions.has(0)).toBe(true);
      expect(conditions.has(3)).toBe(true);
    } finally {
      vi.unstubAllGlobals();
      delete process.env['TAU_PYTHON'];
      delete process.env['TAU_MEMORY'];
      delete process.env['TAU_TRIALS'];
      delete process.env['TAU_TRAIN_SHARE'];
      delete process.env['TAU_DISTILL_UNIT'];
      delete process.env['TAU_WORKDIR'];
      delete process.env['DEEPSEEK_API_KEY'];
      delete process.env['TAU_DISTILL_MODEL'];
    }
  }, 60_000);

  it('teaches from the tasks that passed when the scope asks for every trajectory', async () => {
    // R62's treatment, driven end to end: three tasks teach instead of one, and every claim can be
    // traced to the population that produced it. The stub passes t1 every trial and fails t2 every
    // trial, so the split of one repair and two passes is the benchmark's own answer rather than a
    // fixture the driver was told to find.
    //
    // The assertion that matters is the attribution: an item citing a run the round never opened is
    // counted separately by `provenanceCensus` and must be zero here, because it would mean the join
    // between a stored claim and the record that taught it does not hold -- and every reading this
    // round publishes is a comparison between those two populations.
    const { dir, executable } = stubRunner();
    process.env['TAU_PYTHON'] = executable;
    process.env['TAU_MEMORY'] = 'true';
    process.env['TAU_TRIALS'] = '2';
    process.env['TAU_TRAIN_SHARE'] = '0.75';
    process.env['TAU_DISTILL_UNIT'] = 'trace';
    process.env['TAU_DISTILL_SCOPE'] = 'all';
    process.env['TAU_WORKDIR'] = dir;
    process.env['DEEPSEEK_API_KEY'] = 'test-key';
    process.env['TAU_DISTILL_MODEL'] = 'deepseek/deepseek-chat';
    let calls = 0;
    const prompts: string[] = [];
    vi.stubGlobal('fetch', async (_url: unknown, init: unknown) => {
      const body = JSON.parse(String((init as { body?: string }).body ?? '{}')) as {
        messages?: { content: string }[];
      };
      prompts.push(body.messages?.[0]?.content ?? '');
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify([
                  {
                    kind: 'procedure',
                    statement: `Confirm the reservation state before acting (${String(calls++)})`,
                  },
                ]),
              },
            },
          ],
          usage: { prompt_tokens: 3, completion_tokens: 3 },
        }),
        { status: 200 },
      );
    });
    try {
      const driver = await import('../bin/tau2-driver.js?case=scope-all');
      await driver.run();
      const record = driver.instrument();
      // The switch reached the artefact, and the population it produced is both.
      expect(record?.distillScope).toBe('all');
      expect(record?.learning.edited).toBe(1);
      expect(record?.provenance?.edited).toBe(1);
      expect(record?.provenance?.passed).toBe(2);
      expect(record?.provenance?.tasksPassed).toBe(2);
      // Every claim is attributable, and at least one came from a pass -- without this the round
      // would grade a store it cannot split.
      expect(record?.provenance?.itemsUnattributed).toBe(0);
      expect(record?.provenance?.evidenceUnattributed).toBe(0);
      expect(record?.provenance?.itemsPassedOnly).toBeGreaterThan(0);
      // The prompt names the passing shape: a record whose `expected` is absent must not be left for
      // the model to interpret as a lost reference.
      expect(prompts.some((prompt) => prompt.includes('`rubricMet` is true'))).toBe(true);
    } finally {
      vi.unstubAllGlobals();
      delete process.env['TAU_PYTHON'];
      delete process.env['TAU_MEMORY'];
      delete process.env['TAU_TRIALS'];
      delete process.env['TAU_TRAIN_SHARE'];
      delete process.env['TAU_DISTILL_UNIT'];
      delete process.env['TAU_DISTILL_SCOPE'];
      delete process.env['TAU_WORKDIR'];
      delete process.env['DEEPSEEK_API_KEY'];
      delete process.env['TAU_DISTILL_MODEL'];
    }
  }, 60_000);

  it("answers a second scenario without reading its task numbers as the first's", async () => {
    // The cross-domain path, end to end, with the two scenarios deliberately sharing task ids: this
    // is what τ² actually does, and the leak guard is what would fail if the plan carried bare ids.
    const { dir, executable } = stubRunner();
    process.env['TAU_PYTHON'] = executable;
    process.env['TAU_MEMORY'] = 'false';
    process.env['TAU_TRIALS'] = '1';
    process.env['TAU_TRAIN_DOMAIN'] = 'retail';
    process.env['TAU_TEST_DOMAIN'] = 'airline';
    process.env['TAU_WORKDIR'] = dir;
    try {
      const driver = await import('../bin/tau2-driver.js?case=cross-domain');
      const tasks = await driver.run();
      // Cross-domain learns from one list and answers the whole other: there is nothing to hold
      // back out of a scenario the store never saw.
      expect(tasks.map((task) => task.taskId)).toEqual([
        'airline/t1',
        'airline/t2',
        'airline/t3',
        'airline/t4',
      ]);
      expect(driver.trials()).toHaveLength(4);
    } finally {
      delete process.env['TAU_PYTHON'];
      delete process.env['TAU_MEMORY'];
      delete process.env['TAU_TRIALS'];
      delete process.env['TAU_TRAIN_DOMAIN'];
      delete process.env['TAU_TEST_DOMAIN'];
      delete process.env['TAU_WORKDIR'];
    }
  });

  it('stops at distillation when the provider refuses every distiller call', async () => {
    // The R41 shape, reproduced without a provider, a benchmark or an hour: the distiller's model is
    // refused, so every correction comes back empty and the store is built out of nothing. Before
    // R42 this ran the whole evaluation and published a memory arm whose pack was empty for all 200
    // recall requests; the two things that made it invisible were the discarded distill report and
    // the 400 being counted as a prompt that failed *after retries*, which it never had.
    //
    // What is asserted is the behaviour a reader needs: the run stops where the fault is, the message
    // names the status and the model, and the evaluation is never paid for.
    const { dir, executable } = stubRunner();
    process.env['TAU_PYTHON'] = executable;
    process.env['TAU_MEMORY'] = 'true';
    process.env['TAU_TRIALS'] = '1';
    process.env['TAU_TRAIN_SHARE'] = '0.5';
    process.env['TAU_WORKDIR'] = dir;
    process.env['DEEPSEEK_API_KEY'] = 'test-key';
    process.env['TAU_DISTILL_MODEL'] = 'deepseek/deepseek-chat';
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(JSON.stringify({ error: { message: 'Model Not Exist' } }), { status: 400 }),
    );
    try {
      const driver = await import('../bin/tau2-driver.js?case=refused-model');
      await expect(driver.run()).rejects.toThrow(/refused the request \(400\)/);
      // The learning half ran and the evaluation did not: `learn.json` exists, `eval.json` does not.
      expect(existsSync(join(dir, 'learn.json'))).toBe(true);
      expect(existsSync(join(dir, 'eval.json'))).toBe(false);
      // And the name the endpoint was sent is the one it serves, not the router's spelling.
      expect(driver.instrument()).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
      delete process.env['TAU_PYTHON'];
      delete process.env['TAU_MEMORY'];
      delete process.env['TAU_TRIALS'];
      delete process.env['TAU_TRAIN_SHARE'];
      delete process.env['TAU_WORKDIR'];
      delete process.env['DEEPSEEK_API_KEY'];
      delete process.env['TAU_DISTILL_MODEL'];
    }
  });

  it('refuses a run whose split leaves nothing held out', async () => {
    const { dir, executable } = stubRunner();
    // One task, split in half: the held-out side is empty, and a pass^4 over zero
    // tasks is a zero that was never measured.
    writeFileSync(executable, STUB.replace("['t4', 't1', 't3', 't2']", "['only']"), 'utf8');
    chmodSync(executable, 0o755);
    process.env['TAU_PYTHON'] = executable;
    process.env['TAU_MEMORY'] = 'false';
    process.env['TAU_TRIALS'] = '1';
    process.env['TAU_WORKDIR'] = dir;
    try {
      const driver = await import('../bin/tau2-driver.js?case=empty-split');
      await expect(driver.run()).rejects.toThrow(/no held-out task/);
    } finally {
      delete process.env['TAU_PYTHON'];
      delete process.env['TAU_MEMORY'];
      delete process.env['TAU_TRIALS'];
      delete process.env['TAU_WORKDIR'];
    }
  });
});
