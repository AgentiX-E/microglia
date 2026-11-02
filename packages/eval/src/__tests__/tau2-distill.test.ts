import { describe, expect, it } from 'vitest';
import { MicrogliaError } from '@agentix-e/microglia-core';
import type { DistillCandidate } from '@agentix-e/microglia-core';
import type { InterpretContext } from '@agentix-e/microglia-core/distill';
import { resilientInterpreter } from '../tau2-distill.js';
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
    expect(faults()).toEqual({ events: 0, reasons: [] });
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
