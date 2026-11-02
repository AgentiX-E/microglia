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
      const written = JSON.parse(readFileSync(join(dir, 'eval.json'), 'utf8')) as { simulations: unknown[] };
      expect(written.simulations).toHaveLength(8);
      // The episodes the pairing step needs, one row per trial, named the same way.
      expect(driver.trials()).toHaveLength(8);
      expect(driver.trials()?.[0]).toEqual({ id: 'retail/t3', trial: 0, reward: 1 });
    } finally {
      delete process.env['TAU_PYTHON'];
      delete process.env['TAU_MEMORY'];
      delete process.env['TAU_TRIALS'];
      delete process.env['TAU_TRAIN_SHARE'];
      delete process.env['TAU_WORKDIR'];
    }
  });

  it('answers a second scenario without reading its task numbers as the first\'s', async () => {
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
    vi.stubGlobal('fetch', async () =>
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
    writeFileSync(
      executable,
      STUB.replace("['t4', 't1', 't3', 't2']", "['only']"),
      'utf8',
    );
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
