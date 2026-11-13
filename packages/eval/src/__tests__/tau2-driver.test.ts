import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';

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
// Every phase this stand-in is asked for, in order, beside the script rather than in the workdir: the
// driver's version probe is an ordering claim — it is worth nothing if it runs after the first episode
// has been paid for — and an order is only observable from outside.
require('node:fs').appendFileSync(
  require('node:path').join(__dirname, 'phases.log'),
  phase + '\\n',
);
if (phase === 'selftest') {
  // What the real runner prints: which runner it found, the surface it is about to call, and the
  // registry's capability. A stand-in that answered this with an exit code alone would let the driver
  // stop checking and keep passing.
  process.stdout.write('[tau2] selftest: runner v1, get_tasks(domain), registry ok\\n');
} else if (phase === 'list') {
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
  // The in-process diagnostics arrive on stdout rather than in the document: run_split.py prints one
  // JSON line and the driver keeps the last one carrying diagnostics. A stand-in that printed none
  // would leave the usage and the per-conversation cost untested while every case still passed.
  process.stdout.write(
    JSON.stringify({
      phase,
      diagnostics: {
        usage: { calls: simulations.length, cost: { usd: 4, band: 'off_peak' } },
      },
    }) + '\\n',
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
      // `outcomes` is the order the trials ran, carried beside the counts because retention is a
      // property of the sequence: both tasks are 2 of 4 here, and only the order tells the run that
      // passed-first-and-last from the one that alternated.
      expect(tasks).toEqual([
        { successes: 2, trials: 4, k: 4, taskId: 'retail/t3', outcomes: [true, false, true, false] },
        { successes: 2, trials: 4, k: 4, taskId: 'retail/t4', outcomes: [true, false, true, false] },
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

  it('prices the conversations it bought, which is the number the competitor prints', async () => {
    // T.4 of the competitive record: ALTK reports USD per conversation on the run that produced its
    // pass^4 and this lane reported a token census instead. The quotient is derived from the evaluation
    // phase's own document rather than from a rate card here, because there are two copies of the rate
    // card in this repository and a third would be the one that disagreed.
    //
    // A memory arm, because the record this field lives in is the memory arm's: a reference arm has no
    // store to describe, so it reports trials and no instrument.
    const { dir, executable } = stubRunner();
    process.env['TAU_PYTHON'] = executable;
    process.env['TAU_MEMORY'] = 'true';
    process.env['TAU_TRIALS'] = '4';
    process.env['TAU_TRAIN_SHARE'] = '0.5';
    // The raw arm: records are written verbatim and the model is never asked, so this case prices the
    // conversations without also having to fake a provider. An arm whose distiller returned nothing is
    // refused earlier, by the no-measurement guard, which is a different test's subject.
    process.env['TAU_DISTILL_UNIT'] = 'raw';
    process.env['TAU_WORKDIR'] = dir;
    process.env['DEEPSEEK_API_KEY'] = 'test-key';
    process.env['TAU_DISTILL_MODEL'] = 'deepseek/deepseek-chat';
    vi.stubGlobal('fetch', async () => {
      throw new Error('a raw arm must not call a model');
    });
    const said: string[] = [];
    const write = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array): boolean => {
        said.push(String(chunk));
        return true;
      });
    try {
      const driver = await import('../bin/tau2-driver.js?case=cost');
      await driver.run();
      // Two held-out tasks at four trials each: the divisor is the conversations the evaluation phase
      // ran, not the tasks it ran them on.
      expect(driver.instrument()?.cost).toEqual({
        usd: 4,
        band: 'off_peak',
        conversations: 8,
        perConversation: 0.5,
      });
      expect(said.join('')).toContain('cost: $4.0000 over 8 conversation(s) = $0.5000 each');
    } finally {
      write.mockRestore();
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

  it('asks which τ² this is before the first episode, and says so out loud', async () => {
    // R92's first dispatch installed τ² v0.2.0, built a store, generated a corpus, and died on the
    // first read of a file that release does not ship. The probe is only worth its two seconds if it
    // runs first, so the claim under test is an *order*: selftest, then the listing, then the episodes.
    const { dir, executable } = stubRunner();
    process.env['TAU_PYTHON'] = executable;
    process.env['TAU_MEMORY'] = 'false';
    process.env['TAU_TRIALS'] = '4';
    process.env['TAU_TRAIN_SHARE'] = '0.5';
    process.env['TAU_WORKDIR'] = dir;
    const said: string[] = [];
    const write = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array): boolean => {
        said.push(String(chunk));
        return true;
      });
    try {
      const driver = await import('../bin/tau2-driver.js?case=selftest-first');
      await driver.run();
      const phases = readFileSync(join(dir, 'phases.log'), 'utf8')
        .split('\n')
        .filter((line) => line !== '');
      expect(phases[0]).toBe('selftest');
      // Nothing else may come before it: a probe after the listing is a probe after the money.
      expect(phases.indexOf('selftest')).toBeLessThan(phases.indexOf('list'));
      // And the answer is a line a reader of the log can grade. A silent probe is indistinguishable in
      // the log from a probe that never ran.
      expect(said.join('')).toContain('selftest: runner');
    } finally {
      write.mockRestore();
      delete process.env['TAU_PYTHON'];
      delete process.env['TAU_MEMORY'];
      delete process.env['TAU_TRIALS'];
      delete process.env['TAU_TRAIN_SHARE'];
      delete process.env['TAU_WORKDIR'];
    }
  }, 60_000);

  it('stops on a release that does not speak this runner, before anything is listed', async () => {
    // The failure R92 paid for, reproduced cheaply: a τ² whose runner surface moved. The run has to end
    // here — not after the store is built, and not inside the first episode — and it has to end with the
    // probe's own words rather than a traceback from somewhere downstream.
    const { dir } = stubRunner();
    const refusing = join(dir, 'refusing-runner');
    writeFileSync(
      refusing,
      `#!/usr/bin/env node
process.stderr.write('[tau2] selftest: run_tasks is not (config, tasks)\\n');
process.exit(9);
`,
      'utf8',
    );
    chmodSync(refusing, 0o755);
    process.env['TAU_PYTHON'] = refusing;
    process.env['TAU_MEMORY'] = 'false';
    process.env['TAU_WORKDIR'] = dir;
    try {
      const driver = await import('../bin/tau2-driver.js?case=selftest-refuses');
      await expect(driver.run()).rejects.toThrow(/selftest: run_tasks is not/);
      // The listing is the first thing that writes, so its absence is the receipt for "nothing ran".
      expect(existsSync(join(dir, 'test-tasks.json'))).toBe(false);
    } finally {
      delete process.env['TAU_PYTHON'];
      delete process.env['TAU_MEMORY'];
      delete process.env['TAU_WORKDIR'];
    }
  }, 60_000);

  it('records the episode on a raw arm and asks no model at all, end to end', async () => {
    // The arm this test protects is the one the two preprints in `tau2-rawlog.ts` measure against:
    // the record, written verbatim, with no abstraction step. Three things have to hold at once for
    // it to be that arm — the store is made of records, the model is never called, and the artefact
    // says both — and each of the three fails silently in a different way.
    const { dir, executable } = stubRunner();
    process.env['TAU_PYTHON'] = executable;
    process.env['TAU_MEMORY'] = 'true';
    process.env['TAU_TRIALS'] = '2';
    process.env['TAU_TRAIN_SHARE'] = '0.75';
    process.env['TAU_DISTILL_UNIT'] = 'raw';
    process.env['TAU_WORKDIR'] = dir;
    process.env['DEEPSEEK_API_KEY'] = 'test-key';
    process.env['TAU_DISTILL_MODEL'] = 'deepseek/deepseek-chat';
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls += 1;
      throw new Error('a raw arm must not call a model');
    });
    try {
      const driver = await import('../bin/tau2-driver.js?case=raw');
      await driver.run();
      const record = driver.instrument();
      // Not "no fault was recorded": no call was made. A raw arm that fell back to the model on a
      // timeout would still have recorded zero faults on a provider that answered.
      expect(calls).toBe(0);
      expect(record?.distillUnit?.unit).toBe('raw');
      // A form of `record` is how the artefact says the prompt was never sent, and it has to say it:
      // the field would otherwise carry the `lesson` default on an arm that asked nothing.
      expect(record?.distillForm?.form).toBe('record');
      expect(record?.distillForm?.refused).toBe(0);
      // The records reached the store, and they are what the store is made of.
      expect(record?.rawlog?.records).toBeGreaterThanOrEqual(1);
      expect(record?.rawlog?.toolBan).toBe(false);
      const sampled = record?.storeItems?.items ?? [];
      expect(sampled.length).toBeGreaterThanOrEqual(1);
      for (const item of sampled) {
        expect(item.kind).toBe('exemplar');
        expect(item.statement.startsWith('Q: ')).toBe(true);
      }
      // The pass that merges claims did not run over a set of records.
      expect(record?.distillUnit?.consolidation).toBeUndefined();
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
      // The budget the calls were given is in the record beside the form that asked for them: a
      // store built under a ceiling the artefact cannot name is a store whose size has no cause.
      expect(record?.distillForm?.maxTokens).toBe(1_200);
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

  it('says the model carried nothing when the reply is an empty list', async () => {
    // R56's re-dispatch stopped on `12 correction(s) -> 0 candidate(s) (0 refused, 0 failed)` and
    // printed *the interpreter proposed no candidate* — a sentence about the model, written by a
    // counter that cannot see the parser. Both halves of the distinction are driven here, because the
    // sentence is the only thing a stopped run publishes.
    const { dir, executable } = stubRunner();
    process.env['TAU_PYTHON'] = executable;
    process.env['TAU_MEMORY'] = 'true';
    process.env['TAU_TRIALS'] = '1';
    process.env['TAU_TRAIN_SHARE'] = '0.5';
    process.env['TAU_WORKDIR'] = dir;
    process.env['DEEPSEEK_API_KEY'] = 'test-key';
    process.env['TAU_DISTILL_MODEL'] = 'deepseek/deepseek-chat';
    let asked = 0;
    vi.stubGlobal(
      'fetch',
      async () => {
        asked += 1;
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"candidates":[]}' } }],
            usage: { prompt_tokens: 3, completion_tokens: 3 },
          }),
          { status: 200 },
        );
      },
    );
    try {
      const driver = await import('../bin/tau2-driver.js?case=empty-reply');
      const refusal = await driver.run().catch((error: unknown) => error);
      const message = String((refusal as Error).message);
      expect(message).toMatch(/answered all 1 event\(s\) with no claim/);
      // The chain carries the count that answers the question the sentence used to leave open.
      expect(message).toMatch(/1 correction\(s\) -> 1 asked -> 0 candidate\(s\)/);
      // And the model was asked exactly once: the reply was read, not invented.
      expect(asked).toBe(1);
      expect(driver.instrument()).toBeUndefined();
      expect(existsSync(join(dir, 'eval.json'))).toBe(false);
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
  }, 60_000);

  it('says the parser threw the claims away when the reply does not fit the schema', async () => {
    // The other half of the same zero. A claim the prompt never asked for — `kind` outside the five
    // the store has — is parsed and dropped, so `candidates` is zero for a reason that belongs to the
    // parser. R56's re-dispatch could not tell this case from the one above, and this is the count
    // that separates them.
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
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify([{ kind: 'insight', statement: 'Check the ticket owner first' }]),
                },
              },
            ],
            usage: { prompt_tokens: 3, completion_tokens: 3 },
          }),
          { status: 200 },
        ),
    );
    try {
      const driver = await import('../bin/tau2-driver.js?case=wrong-kind');
      const refusal = await driver.run().catch((error: unknown) => error);
      const message = String((refusal as Error).message);
      expect(message).toMatch(/dropped every claim the model wrote \(1 dropped: unknown-kind 1\)/);
      expect(message).toMatch(/did not survive the schema/);
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
  }, 60_000);

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

  describe('the two facts a number is only comparable with', () => {
    // Imported once here rather than per case: both functions take everything they read as an
    // argument, so this is a lookup table and not a piece of state the cases share.
    let driver: typeof import('../bin/tau2-driver.js');
    beforeAll(async () => {
      driver = await import('../bin/tau2-driver.js?case=identity');
    });

    it('names the release that would have the split file, rather than the path that is missing', () => {
      // The refusal a dispatch reads. `ENOENT` on a path inside a clone says which file the checkout
      // lacks; it does not say that the release cannot have it, which is the whole decision.
      const empty = mkdtempSync(join(tmpdir(), 'tau2-checkout-'));
      expect(() => driver.splitPathIn(empty, 'retail', 'v0.2.0')).toThrow(
        /retail's split file is not in this checkout.*ship from tau2 v1\.0\.0.*pinned v0\.2\.0/,
      );
      // And an arm that pinned nothing says so, instead of printing an empty release.
      expect(() => driver.splitPathIn(empty, 'retail', '')).toThrow(/pinned unpinned/);
    });

    it('reads the published halves from the checkout it is given', () => {
      const checkout = mkdtempSync(join(tmpdir(), 'tau2-checkout-'));
      const path = join(checkout, 'data', 'tau2', 'domains', 'retail', 'split_tasks.json');
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify({ train: ['0'], test: ['5'], base: ['0', '5'] }), 'utf8');
      expect(driver.splitPathIn(checkout, 'retail', 'v1.0.1')).toBe(path);
    });

    it('carries the tag the workflow pinned and the commit the checkout is at', async () => {
      // The tag can be moved; the commit cannot. An arm that quotes a tag and no commit is an arm
      // quoting a belief, so both are read — and the commit is `git`'s answer, not ours.
      const checkout = mkdtempSync(join(tmpdir(), 'tau2-git-'));
      execFileSync('git', ['init', '--quiet'], { cwd: checkout });
      execFileSync(
        'git',
        ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '--quiet', '--allow-empty', '-m', 'x'],
        { cwd: checkout },
      );
      const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: checkout })
        .toString()
        .trim();
      expect(await driver.benchmarkIdentityOf(checkout, 'v1.0.1')).toEqual({
        version: 'v1.0.1',
        commit: head,
      });
      // No tag from the workflow still records the commit: the number is about a commit either way.
      expect(await driver.benchmarkIdentityOf(checkout, '')).toEqual({
        version: 'unpinned',
        commit: head,
      });
    });

    it('says nothing rather than guessing when the checkout cannot date itself', async () => {
      // Absent is "not recorded", which is a different claim from "v0.2.0". The two cases are a
      // checkout that is not there and one that is not a repository.
      expect(await driver.benchmarkIdentityOf(join(tmpdir(), 'tau2-absent-xyz'), 'v1.0.1')).toBe(
        undefined,
      );
      const notARepo = mkdtempSync(join(tmpdir(), 'tau2-plain-'));
      expect(await driver.benchmarkIdentityOf(notARepo, '')).toBe(undefined);
      // With a release pinned, the tag is still an answer and the commit is honestly unknown.
      expect(await driver.benchmarkIdentityOf(notARepo, 'v1.0.1')).toEqual({
        version: 'v1.0.1',
        commit: 'unknown',
      });
    });
  });
});
