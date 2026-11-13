/**
 * R91's instrument: a store built from a list, and the three ways the list can lie.
 *
 * The tests are written around the reason the module exists. A pin is only worth the corpus check it
 * performs, so every rejection case here is a store that would otherwise have been *smaller* than its
 * registration claimed while every counter downstream still read as measured: an unknown id, a duplicate,
 * an empty list. The success cases pin the two properties the driver depends on -- a failure scores zero
 * and everything else passes, and a qualified id is the same task as its unqualified name.
 */
import { describe, expect, it } from 'vitest';
import { L4ParseError } from '../l4.js';
import { parseStorePin, pinRewards, pinnedLearn, tasksDocumentOf } from '../tau2-pin.js';
import type { TauTask } from '../tau2.js';

function task(id: string, instruction = `q${id}`): Record<string, unknown> {
  return {
    id,
    user_scenario: { instructions: instruction },
    evaluation_criteria: {
      actions: [{ name: 'get_order_details', arguments: { order_id: id } }],
      nl_assertions: [],
    },
  };
}

function corpus(ids: readonly string[]): Record<string, unknown> {
  return { tasks: ids.map((id) => task(id)) };
}

function reason(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return error instanceof L4ParseError ? error.reason : `not an L4ParseError: ${String(error)}`;
  }
  return 'no error';
}

function tauTasks(ids: readonly string[]): TauTask[] {
  return ids.map((id) => ({
    id,
    instruction: `q${id}`,
    actions: [],
    communicate: [],
    assertions: [],
  }));
}

describe('parseStorePin', () => {
  it('reads the list and the arm it came from', () => {
    const pin = parseStorePin({ source: 'R90', failures: ['retail/15', 'retail/18'] });
    expect(pin.source).toBe('R90');
    expect(pin.failures).toEqual(['retail/15', 'retail/18']);
  });

  it('names an unnamed source rather than leaving the field blank', () => {
    const pin = parseStorePin({ failures: ['retail/15'] });
    expect(pin.source).toBe('an arm this pin does not name');
  });

  it('refuses a document that is not an object', () => {
    expect(reason(() => parseStorePin(['retail/15']))).toBe('unreadable-json');
    expect(reason(() => parseStorePin(null))).toBe('unreadable-json');
  });

  it('refuses a document with no failures array', () => {
    expect(reason(() => parseStorePin({ source: 'R90' }))).toBe('missing-tasks');
  });

  it('refuses an empty list, because an empty store is not a pin', () => {
    expect(reason(() => parseStorePin({ failures: [] }))).toBe('bad-entry');
  });

  it('refuses an entry that is not a task id', () => {
    expect(reason(() => parseStorePin({ failures: ['retail/15', 7] }))).toBe('bad-entry');
    expect(reason(() => parseStorePin({ failures: [''] }))).toBe('bad-entry');
  });

  it('refuses a duplicate rather than deduplicating, because the count is read against it', () => {
    expect(reason(() => parseStorePin({ failures: ['retail/15', 'retail/15'] }))).toBe('bad-entry');
  });
});

describe('tasksDocumentOf', () => {
  it('wraps the bare list upstream publishes', () => {
    const wrapped = tasksDocumentOf([task('0')]);
    expect(wrapped.tasks).toHaveLength(1);
  });

  it('passes through a document that already has its array', () => {
    const wrapped = tasksDocumentOf(corpus(['0', '1']));
    expect(wrapped.tasks).toHaveLength(2);
  });

  it('refuses a file that is neither shape', () => {
    expect(reason(() => tasksDocumentOf({ data: [] }))).toBe('missing-tasks');
    expect(reason(() => tasksDocumentOf('nope'))).toBe('missing-tasks');
  });
});

describe('pinRewards', () => {
  it('scores a named failure zero and everything else a pass', () => {
    const rewards = pinRewards(tauTasks(['0', '1', '2']), ['1']);
    expect([...rewards.entries()]).toEqual([
      ['0', 1],
      ['1', 0],
      ['2', 1],
    ]);
  });

  it('refuses an id the corpus does not hold, and says which', () => {
    const error = (() => {
      try {
        pinRewards(tauTasks(['0']), ['9']);
      } catch (caught) {
        return caught as L4ParseError;
      }
      return undefined;
    })();
    expect(error?.reason).toBe('bad-entry');
    expect(error?.message).toContain('9');
  });
});

describe('pinnedLearn', () => {
  it('rebuilds the learn half from the corpus and the list', () => {
    const learned = pinnedLearn(
      corpus(['0', '1', '2', '3']),
      { source: 'R90', failures: ['retail/1', 'retail/3'] },
      ['0', '1', '2', '3'],
      'retail',
    );
    expect(learned.tasks.map((entry) => entry.id)).toEqual(['0', '1', '2', '3']);
    expect(learned.failures).toBe(2);
    expect(learned.rewards.get('1')).toBe(0);
    expect(learned.rewards.get('0')).toBe(1);
    expect(learned.pin.source).toBe('R90');
  });

  it('keeps only the tasks the split learns from', () => {
    const learned = pinnedLearn(
      corpus(['0', '1', '2', '3']),
      { source: 'R90', failures: ['retail/1', 'retail/3'] },
      ['0', '1'],
      'retail',
    );
    expect(learned.tasks.map((entry) => entry.id)).toEqual(['0', '1']);
    // One of the two pinned failures is in this split; the other is a task this run does not learn from.
    expect(learned.failures).toBe(1);
  });

  it('still refuses a misspelled id that the wider corpus does not hold', () => {
    expect(
      reason(() =>
        pinnedLearn(
          corpus(['0', '1']),
          { source: 'R90', failures: ['retail/99'] },
          ['0'],
          'retail',
        ),
      ),
    ).toBe('bad-entry');
  });

  it('refuses a corpus that holds none of the split', () => {
    expect(
      reason(() =>
        pinnedLearn(corpus(['7', '8']), { source: 'R90', failures: ['retail/7'] }, ['0'], 'retail'),
      ),
    ).toBe('missing-tasks');
  });

  it('accepts an unqualified id, which is the same task under another name', () => {
    const learned = pinnedLearn(
      corpus(['0', '1']),
      { source: 'R90', failures: ['1'] },
      ['0', '1'],
      'retail',
    );
    expect(learned.failures).toBe(1);
    expect(learned.rewards.get('1')).toBe(0);
  });
});
