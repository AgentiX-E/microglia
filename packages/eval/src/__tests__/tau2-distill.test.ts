import { describe, expect, it } from 'vitest';
import { EmbeddedMemory, MemoryJournal } from '@agentix-e/microglia-core/memory';
import { openMicroglia } from '@agentix-e/microglia-core/capture';
import { MicrogliaError, mulberry32, steppingClock } from '@agentix-e/microglia-core';
import { createLlmInterpreter, ruleInterpreter } from '@agentix-e/microglia-core/distill';
import type { DistillCandidate } from '@agentix-e/microglia-core';
import type { InterpretContext } from '@agentix-e/microglia-core/distill';
import { correctionEdit } from '../tau2.js';
import { resilientInterpreter, stampDomain } from '../tau2-distill.js';
import { stoppedRun } from '../stopped-run.js';

/**
 * The fallback the τ² lane needs, and the one it must not have.
 *
 * `combineInterpreters` runs every interpreter it is given and stops at the first one that throws —
 * the docstring called the second one a fallback, the code made it a sibling. The τ² lane cannot
 * live with either extreme: an outage of the model must not empty its store (the empty store is the
 * defect R41 published), and it must not be quietly replaced by generic lessons either (a pack of
 * negative lessons grades as a memory that ran).
 */

function context(id: string): InterpretContext {
  return {
    event: {
      schema: 'microglia.feedback/1',
      id,
      runId: 'run-1',
      namespace: 'tau2',
      at: 1,
      task: 'tau2.act',
      actor: { type: 'user' },
      signal: { type: 'edit', after: { actions: [] } },
      trust: 1,
    },
    run: undefined,
  } as unknown as InterpretContext;
}

const candidate = (statement: string): DistillCandidate =>
  ({ statement, kind: 'procedure' }) as unknown as DistillCandidate;

describe('resilientInterpreter', () => {
  it('answers with the primary interpreter when it answers', async () => {
    const { interpreter, faults } = resilientInterpreter(
      async () => [candidate('from the model')],
      async () => [candidate('from the rules')],
    );
    await expect(interpreter(context('fb-1'))).resolves.toEqual([candidate('from the model')]);
    expect(faults()).toEqual({ events: 0, reasons: [], samples: {} });
  });

  it('falls back per event, and counts the event rather than the batch', async () => {
    // The model is down for the first event and up for the second. A composition that gave up on
    // the whole batch would lose a lesson it could have had; one that stopped at the throw would
    // lose both.
    let call = 0;
    const { interpreter, faults } = resilientInterpreter(
      async () => {
        call += 1;
        if (call === 1) throw new MicrogliaError('MG_E_STORE_IO', 'the provider returned 400');
        return [candidate('from the model')];
      },
      async () => [candidate('from the rules')],
    );
    await expect(interpreter(context('fb-1'))).resolves.toEqual([candidate('from the rules')]);
    await expect(interpreter(context('fb-2'))).resolves.toEqual([candidate('from the model')]);
    expect(faults().events).toBe(1);
    expect(faults().reasons).toEqual(['MG_E_STORE_IO']);
  });

  it('rethrows a failure that says the run is over, rather than papering it with lessons', async () => {
    // A spent budget or a refused key is not this event's problem: every remaining event will fail
    // the same way, and a store built from the rule interpreter's generic lessons would then be
    // graded as if the model had distilled it. `distill` re-counts what this rethrows as a failed
    // event, and its own `fatal` predicate turns that into a stopped run.
    const { interpreter, faults } = resilientInterpreter(
      async () => {
        throw new MicrogliaError('MG_E_PROVIDER_FAILED', 'not answering');
      },
      async () => [candidate('from the rules')],
    );
    await expect(interpreter(context('fb-1'))).rejects.toMatchObject({
      code: 'MG_E_PROVIDER_FAILED',
    });
    expect(faults().events).toBe(1);
  });

  it('rethrows the primary failure when the fallback fails too', async () => {
    // The first error is the one that describes the run: a rule interpreter failing on an event is
    // usually a consequence of whatever broke upstream.
    const { interpreter, faults } = resilientInterpreter(
      async () => {
        throw new MicrogliaError('MG_E_STORE_IO', 'primary');
      },
      async () => {
        throw new MicrogliaError('MG_E_STORE_IO', 'fallback');
      },
    );
    await expect(interpreter(context('fb-1'))).rejects.toThrow(/primary/);
    expect(faults().events).toBe(1);
  });

  it('reports a name for every failure, including one that is not an error object', async () => {
    const { interpreter, faults } = resilientInterpreter(
      async () => {
        throw 'a string, because host code throws strings';
      },
      async () => [],
    );
    await expect(interpreter(context('fb-1'))).resolves.toEqual([]);
    expect(faults().reasons).toEqual(['unknown']);
  });

  it('keeps one specimen per fault code, because the code is a category and the round needs the reply', async () => {
    // `MG_E_INVALID_SIGNAL` is a truncated reply, a reply written in prose, and a reply of the right
    // shape that the schema refused. Three fixes, one word. `parseCandidates` puts the reply's first
    // 160 characters in the error's `preview`; that string used to die with the process, so R58 could
    // report eleven of this code and nothing about which of the three it was.
    let call = 0;
    const { interpreter, faults } = resilientInterpreter(
      async () => {
        call += 1;
        if (call <= 2) {
          throw new MicrogliaError('MG_E_INVALID_SIGNAL', 'LLM response is not JSON', {
            preview: call === 1 ? 'Here is a note about the order…' : 'a second, later reply',
          });
        }
        throw new MicrogliaError('MG_E_STORE_IO', 'the disk said no');
      },
      async () => [candidate('from the rules')],
    );
    for (const id of ['fb-1', 'fb-2', 'fb-3']) await interpreter(context(id));
    const reading = faults();
    expect(reading.reasons).toEqual(['MG_E_INVALID_SIGNAL', 'MG_E_INVALID_SIGNAL', 'MG_E_STORE_IO']);
    // First sample per code, not last: the first failure of a kind happened before any fallback had
    // a chance to change the state, and two samples of one failure say no more than one.
    expect(reading.samples).toEqual({
      MG_E_INVALID_SIGNAL: 'MG_E_INVALID_SIGNAL: LLM response is not JSON <- Here is a note about the order…',
      MG_E_STORE_IO: 'MG_E_STORE_IO: the disk said no',
    });
  });

  it('forwards the primary\u2019s prefetch, so the batch still warms its calls once', async () => {
    // The wrapper sits between the distiller and the interpreter that pays for round trips. Dropping
    // `prefetch` here would turn one batched prompt into one prompt per event and move the fold's
    // cost without moving anything a reader can see.
    let warmed = 0;
    const primary = (async () => []) as unknown as import('@agentix-e/microglia-core/distill').Interpreter;
    primary.prefetch = async (contexts) => {
      warmed += contexts.length;
    };
    const { interpreter } = resilientInterpreter(primary, async () => []);
    await interpreter.prefetch?.([context('a'), context('b')]);
    expect(warmed).toBe(2);
  });

  it('does not invent a prefetch when the primary has none', () => {
    const { interpreter } = resilientInterpreter(async () => [], async () => []);
    expect(interpreter.prefetch).toBeUndefined();
  });
});

describe('stampDomain', () => {
  it("gives every claim the host's domain, whatever the interpreter said", async () => {
    // The model is not the party that observed the scenario: an item keyed on its spelling is
    // stored, counted by V44, and unreachable, because recall asks in the host's.
    const stamped = stampDomain(
      () => [{ ...candidate('a rule'), scope: { task: 'tau2.act', domain: 'Retail (US)' } }],
      'retail',
    );
    const out = await stamped(context('fb-1'));
    expect(out[0]?.scope).toEqual({ task: 'tau2.act', domain: 'retail' });
  });

  it('fills the domain in when the interpreter left it out', async () => {
    const stamped = stampDomain(() => [{ ...candidate('a rule'), scope: { task: 'tau2.act' } }], 'retail');
    expect((await stamped(context('fb-2')))[0]?.scope.domain).toBe('retail');
  });

  it('leaves the rest of the scope, and the claim, alone', async () => {
    const original = {
      ...candidate('a rule'),
      scope: { task: 'tau2.act', domain: 'x', field: 'status', reasonCode: 'R1' },
      trust: 0.42,
    };
    const stamped = stampDomain(() => [original], 'airline');
    const out = await stamped(context('fb-3'));
    expect(out[0]?.scope).toEqual({ task: 'tau2.act', domain: 'airline', field: 'status', reasonCode: 'R1' });
    expect(out[0]?.trust).toBe(0.42);
    expect(out[0]?.statement).toBe('a rule');
  });

  it('stamps an empty batch as empty rather than inventing a claim', async () => {
    const stamped = stampDomain(() => [], 'retail');
    expect(await stamped(context('fb-4'))).toEqual([]);
  });

  it('forwards prefetch, so a wrapper does not serialize a batch of prompts', async () => {
    const seen: string[] = [];
    const inner = Object.assign(() => [], {
      prefetch: (contexts: readonly InterpretContext[]) => {
        seen.push(...contexts.map((entry) => entry.event.id));
        return Promise.resolve();
      },
    });
    const stamped = stampDomain(inner, 'retail');
    await stamped.prefetch?.([context('fb-5'), context('fb-6')]);
    expect(seen).toEqual(['fb-5', 'fb-6']);
  });

  it('reports no prefetch when the interpreter it wraps has none', () => {
    expect(stampDomain(() => [], 'retail').prefetch).toBeUndefined();
  });
});

describe('the learning half end to end', () => {
  /**
   * The R42 reading, reproduced without a benchmark.
   *
   * A model that answers with a domain of its own choosing — the prompt forbids a guess and nothing
   * validates one — used to leave a store whose items no recall could reach: the facade asks in the
   * host's spelling, `MemoryStore.search` filters on `scope.domain` equality, and the arm then
   * published `0.00 rules/question` beside fourteen items. This test runs the exact composition the
   * driver builds (a stamped resilient interpreter over the real LLM interpreter, with the real rule
   * fallback) and asserts the two things that were false before: the item carries the host's domain,
   * and the pack serves it.
   */
  it('serves a claim whose interpreter named another domain, because the host owns the key', async () => {
    const store = await EmbeddedMemory.open(new MemoryJournal());
    const llm = createLlmInterpreter({
      // What a model actually answers when it is told the domain and asked for a claim: a claim, and
      // its own spelling of the domain it was told about.
      llm: {
        complete: () =>
          Promise.resolve(
            JSON.stringify([
              {
                kind: 'procedure',
                statement: 'Confirm the order status before offering an exchange.',
                scope: { domain: 'Retail (US)', field: 'status' },
              },
            ]),
          ),
      },
    });
    const interpreter = stampDomain(
      resilientInterpreter(llm, ruleInterpreter, { fatal: stoppedRun }).interpreter,
      'retail',
    );
    const host = await openMicroglia({
      app: 'microglia-l4',
      namespace: 'tau2',
      store,
      interpreter,
      budget: 1200,
      clock: steppingClock(1_700_000_000_000, 1),
      random: mulberry32(7),
    });

    const handle = host.begin({
      task: 'tau2.act',
      input: { question: '0', domain: 'retail', schemaDigest: 'retail' },
      model: 'deepseek-chat',
      promptVersion: 'tau2/1',
      domainPack: 'tau2',
    });
    await handle.complete({ actions: ['get_order_details'] });
    await handle.edit(
      { actions: [{ name: 'get_order_details', arguments: {} }] },
      { note: 'Confirm the order status before offering an exchange.' },
    );
    await host.distill({ generalize: false, fatal: stoppedRun });

    const items = await store.listKnowledge({});
    expect(items).toHaveLength(1);
    expect(items[0]?.scope).toEqual({ task: 'tau2.act', domain: 'retail', field: 'status' });
    expect(items[0]?.status).toBe('active');

    const pack = await host.recall({
      task: 'tau2.act',
      text: 'I would like to exchange this item for a larger size.',
      scope: { domain: 'retail' },
    });
    expect(pack.ids).toEqual([items[0]?.id]);
    expect(pack.rendered).toContain('Confirm the order status');
  });

  it('records a rubric-only correction, and the rubric reaches the distiller', async () => {
    // The end-to-end shape of a retail failure: no calls named, a prose rubric, and an edit that has
    // to differ from the completion or the capture layer refuses it. What the test watches is the
    // prompt: the point of the fallback is that the model *sees* the rubric, not that a field exists.
    const prompts: string[] = [];
    const store = await EmbeddedMemory.open(new MemoryJournal());
    const llm = createLlmInterpreter({
      llm: {
        complete: (prompt: string) => {
          prompts.push(prompt);
          return Promise.resolve(
            JSON.stringify([
              {
                kind: 'procedure',
                statement: 'Cancel a pending order before promising a refund it cannot pay.',
                scope: { field: 'status' },
              },
            ]),
          );
        },
      },
    });
    const host = await openMicroglia({
      app: 'microglia-l4',
      namespace: 'tau2',
      store,
      interpreter: stampDomain(resilientInterpreter(llm, ruleInterpreter, { fatal: stoppedRun }).interpreter, 'retail'),
      budget: 1200,
      clock: steppingClock(1_700_000_000_000, 1),
      random: mulberry32(7),
    });

    const correction = {
      taskId: '9',
      statement: 'A request of this shape is resolved when: the order is cancelled.',
      actions: [],
    };
    const handle = host.begin({
      task: 'tau2.act',
      input: { question: correction.taskId, domain: 'retail', schemaDigest: 'retail' },
      model: 'deepseek-chat',
      promptVersion: 'tau2/1',
      domainPack: 'tau2',
    });
    await handle.complete({ actions: correction.actions.map((action: { name: string }) => action.name) });
    await handle.edit(correctionEdit(correction), { note: correction.statement });
    const report = await host.distill({ generalize: false, fatal: stoppedRun });

    expect(report.events).toBe(1);
    expect(report.created).toBe(1);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('the order is cancelled');
    expect((await store.listKnowledge({}))[0]?.scope.domain).toBe('retail');
  });

  it('and serves nothing without the stamp, which is the reading R42 published', async () => {
    // The control half of the experiment above: the same store, the same claims, the same question,
    // and no stamp. Both facts R42 recorded are here — a store with an item in it, and a pack with
    // nothing — and the only difference is which party named the domain.
    const store = await EmbeddedMemory.open(new MemoryJournal());
    const llm = createLlmInterpreter({
      llm: {
        complete: () =>
          Promise.resolve(
            JSON.stringify([
              {
                kind: 'procedure',
                statement: 'Confirm the order status before offering an exchange.',
                scope: { domain: 'Retail (US)', field: 'status' },
              },
            ]),
          ),
      },
    });
    const host = await openMicroglia({
      app: 'microglia-l4',
      namespace: 'tau2',
      store,
      interpreter: resilientInterpreter(llm, ruleInterpreter, { fatal: stoppedRun }).interpreter,
      budget: 1200,
      clock: steppingClock(1_700_000_000_000, 1),
      random: mulberry32(7),
    });

    const handle = host.begin({
      task: 'tau2.act',
      input: { question: '0', domain: 'retail', schemaDigest: 'retail' },
      model: 'deepseek-chat',
      promptVersion: 'tau2/1',
      domainPack: 'tau2',
    });
    await handle.complete({ actions: ['get_order_details'] });
    await handle.edit(
      { actions: [{ name: 'get_order_details', arguments: {} }] },
      { note: 'Confirm the order status before offering an exchange.' },
    );
    await host.distill({ generalize: false, fatal: stoppedRun });

    const items = await store.listKnowledge({});
    expect(items[0]?.scope.domain).toBe('Retail (US)');
    expect(items[0]?.status).toBe('active');
    const pack = await host.recall({
      task: 'tau2.act',
      text: 'I would like to exchange this item for a larger size.',
      scope: { domain: 'retail' },
    });
    expect(pack.ids).toEqual([]);
  });
});

describe('stoppedRun', () => {
  it('names the four conditions under which every remaining call fails the same way', () => {
    for (const code of [
      'MG_E_BUDGET_EXCEEDED',
      'MG_E_PROVIDER_FAILED',
      'MG_E_DEADLINE',
      'MG_E_CONFIG',
    ] as const) {
      expect(stoppedRun(new MicrogliaError(code, 'x'))).toBe(true);
    }
  });

  it('treats one unanswered prompt as data, and anything that is not a Microglia error as data', () => {
    expect(stoppedRun(new MicrogliaError('MG_E_STORE_IO', 'one prompt'))).toBe(false);
    expect(stoppedRun(new Error('socket hang up'))).toBe(false);
    expect(stoppedRun(undefined)).toBe(false);
  });
});


describe('what a correction weighs as evidence', () => {
  it('clears admission in the shape the driver writes, so a store of candidates has another cause', async () => {
    // R43's store held 24 items, none active and none servable. The obvious suspect is the shape of the
    // evidence the driver writes: it has no transcript of the failed episode, so it states the completion
    // as the *reference call names* and the edit as those names with their arguments. `trustFor('edit')`
    // derives trust from how far that edit moved the completion (`capture/trust.ts`), and admission needs
    // 0.8 (`minSupport`), so a payload that reads as a small change would be held as a candidate forever.
    //
    // Measured rather than assumed, and the measurement rejects it: every shape the driver writes clears
    // the floor on its own. Three conditions, one store each, same interpreter, same task.
    const run = async (
      complete: unknown,
      edit: Record<string, unknown>,
    ): Promise<{ status: string | undefined; trust: number | undefined }> => {
      const store = await EmbeddedMemory.open(new MemoryJournal());
      const llm = createLlmInterpreter({
        llm: {
          complete: () =>
            Promise.resolve(
              JSON.stringify([
                { kind: 'procedure', statement: 'Cancel the pending order before refunding it.', scope: {} },
              ]),
            ),
        },
      });
      const host = await openMicroglia({
        app: 'microglia-l4',
        namespace: 'tau2',
        store,
        interpreter: stampDomain(resilientInterpreter(llm, ruleInterpreter, { fatal: stoppedRun }).interpreter, 'retail'),
        budget: 1200,
        clock: steppingClock(1_700_000_000_000, 1),
        random: mulberry32(7),
      });
      const handle = host.begin({
        task: 'tau2.act',
        input: { question: 'q', domain: 'retail', schemaDigest: 'retail' },
        model: 'deepseek-chat',
        promptVersion: 'tau2/1',
      });
      await handle.complete(complete);
      await handle.edit(edit, { note: 'the order is cancelled' });
      await host.distill({ generalize: false, fatal: stoppedRun });
      const [item] = await store.listKnowledge({});
      return { status: item?.status, trust: item?.trust };
    };

    const referenceCall = { name: 'cancel_pending_order', arguments: { order_id: 'W1' } };
    // The shape the driver writes for a call-shaped correction: names, then names with arguments.
    expect(await run({ actions: ['cancel_pending_order'] }, { actions: [referenceCall] })).toEqual({
      status: 'active',
      trust: 0.9,
    });
    // A rubric-only correction: nothing in the completion, an expectation in the edit.
    expect((await run({ actions: [] }, { actions: [], expectation: 'the order is cancelled' })).status).toBe('active');
    // And against a completion that names a different call.
    expect((await run({ actions: ['get_order_details'] }, { actions: [referenceCall] })).status).toBe('active');
    // So the ceiling is not in this file. The next dispatch prints `store.reasons` (the histogram of what
    // the admission gate wrote) and that is the reading that decides which of the three decisions holds
    // the items: `minSupport` on the merged evidence, `activationThreshold` on confidence, or the
    // corroboration rule that prose needs two tasks to clear.
  });
});
