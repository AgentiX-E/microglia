import { describe, expect, it } from 'vitest';
import {
  GATE_ORDER,
  blockingFailure,
  inGateOrder,
  mergeGates,
  type LaneAdapter,
  type ValidityGate,
} from '../index.js';

/**
 * The two functions that make a second scenario publishable.
 *
 * `gates.ts` certifies a run; this module decides how a scenario's own gates join that list and which
 * failure stops a run. Both are small, and both are the difference between an extension point and a
 * fork: a lane that cannot merge a gate will write its own gate list, which is how τ²-bench ended up
 * with three gates and one of them failing quietly.
 */

const entry = (id: string, pass = true, blocking = false): ValidityGate => ({
  id,
  criterion: 'c',
  actual: 'a',
  pass,
  blocking,
});

describe('mergeGates', () => {
  it('places a known scenario gate at its publication position, not at the end', () => {
    // A lane may contribute a gate the protocol already publishes an order for; it must land there,
    // or a reader comparing two artefacts sees the same gate at two positions.
    const merged = mergeGates(
      [entry('V1-pack-not-empty'), entry('V5-resolution')],
      [entry('V2-fold-partition')],
      inGateOrder,
    );
    expect(merged.map((gate) => gate.id)).toEqual([
      'V1-pack-not-empty',
      'V2-fold-partition',
      'V5-resolution',
    ]);
  });

  it('keeps an unknown scenario gate after every known one', () => {
    const merged = mergeGates([entry('V1-pack-not-empty')], [entry('X1-lane-specific')], inGateOrder);
    expect(merged.map((gate) => gate.id)).toEqual(['V1-pack-not-empty', 'X1-lane-specific']);
  });

  it('returns the protocol list unchanged when the scenario contributes nothing', () => {
    const protocol = GATE_ORDER.slice(0, 3).map((id) => entry(id));
    expect(mergeGates(protocol, [], inGateOrder).map((gate) => gate.id)).toEqual(
      protocol.map((gate) => gate.id),
    );
  });

  it('does not mutate either input', () => {
    const protocol = [entry('V1-pack-not-empty')];
    const scenario = [entry('V2-fold-partition')];
    mergeGates(protocol, scenario, inGateOrder);
    expect(protocol.map((gate) => gate.id)).toEqual(['V1-pack-not-empty']);
    expect(scenario.map((gate) => gate.id)).toEqual(['V2-fold-partition']);
  });

  it('carries each gate object through untouched', () => {
    // The merge decides order, never content: a gate whose `actual` string changed on the way through
    // would be a report that disagrees with the run that produced it.
    const failing = entry('X1', false, true);
    const merged = mergeGates([entry('V1-pack-not-empty')], [failing], inGateOrder);
    expect(merged.find((gate) => gate.id === 'X1')).toEqual(failing);
  });
});

describe('blockingFailure', () => {
  it('returns the failing blocking gate', () => {
    const found = blockingFailure([entry('V1-pack-not-empty', false, true), entry('V5-resolution')]);
    expect(found?.id).toBe('V1-pack-not-empty');
  });

  it('ignores an advisory gate that failed', () => {
    // The mechanism, on a gate that is advisory today — `V5-resolution` itself stopped being
    // advisory in stage 2, when the second scenario showed that its only failure case was the case
    // it existed for. What is tested here is the reader, not the flags: an advisory failure must not
    // reach `blockingFailure`, or every lane would be refused over a note.
    const found = blockingFailure([entry('V5-resolution', false, false)]);
    expect(found).toBeUndefined();
  });

  it('returns undefined when every blocking gate passed', () => {
    expect(blockingFailure([entry('V1-pack-not-empty'), entry('V2-fold-partition')])).toBeUndefined();
  });

  it('returns the first failure in publication order', () => {
    // The first one is the one to fix: reporting the last would send a reader to repair a symptom.
    const found = blockingFailure(
      inGateOrder([
        entry('V5-resolution', false, true),
        entry('V1-pack-not-empty', false, true),
        entry('V2-fold-partition', false, true),
      ]),
    );
    expect(found?.id).toBe('V1-pack-not-empty');
  });

  it('returns undefined for an empty list', () => {
    expect(blockingFailure([])).toBeUndefined();
  });
});

describe('the lane contract', () => {
  /**
   * A worked implementation, because a contract nobody has implemented is a diagram.
   *
   * The five methods are exercised in the order a lane uses them, and the assertions state the two
   * properties the signature is there to enforce: an unreadable reply is a value, and `strata` cannot
   * see an outcome because it is never given one.
   */
  const adapter: LaneAdapter<{ id: string; question: string }, string, { notes: readonly string[] }> =
    {
      async load() {
        return [
          { id: 'q1', question: 'the first' },
          { id: 'q2', question: 'the second' },
        ];
      },
      prompt(task, pack) {
        return `${pack.notes.join('\n')}\n${task.question}`;
      },
      parse(raw) {
        const trimmed = raw.trim();
        return trimmed.length === 0 ? undefined : trimmed;
      },
      async score(_task, candidate) {
        return candidate.startsWith('ok');
      },
      strata(task) {
        return [task.id.startsWith('q') ? 'first-batch' : 'later'];
      },
    };

  it('loads tasks in a stable order', async () => {
    expect((await adapter.load()).map((task) => task.id)).toEqual(['q1', 'q2']);
  });

  it('renders the pack into the prompt above the question', () => {
    const rendered = adapter.prompt({ id: 'q1', question: 'the first' }, { notes: ['n1', 'n2'] });
    expect(rendered).toBe('n1\nn2\nthe first');
  });

  it('treats an unreadable reply as a value rather than a failure', () => {
    expect(adapter.parse('   ')).toBeUndefined();
    expect(adapter.parse(' ok ')).toBe('ok');
  });

  it('scores through the lane, so the protocol never learns what correct means', async () => {
    expect(await adapter.score({ id: 'q1', question: 'x' }, 'ok-answer')).toBe(true);
    expect(await adapter.score({ id: 'q1', question: 'x' }, 'wrong')).toBe(false);
  });

  it('derives strata from the task alone', () => {
    // The signature is the enforcement: there is no arm result to condition on, so a stratum can
    // never be defined by one and the regression-to-the-mean trap cannot be entered by accident.
    expect(adapter.strata({ id: 'q1', question: 'x' })).toEqual(['first-batch']);
    expect(adapter.strata({ id: 'z9', question: 'x' })).toEqual(['later']);
  });
});
