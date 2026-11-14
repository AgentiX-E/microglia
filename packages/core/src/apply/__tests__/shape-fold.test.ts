/**
 * The fold, tested on the three things it can get wrong: what a group is, who survives it, and what the
 * pack reports about the units it kept.
 *
 * The fixtures are records in the shape the τ² lane writes — `Q:`, `A:` and `note:` lines whose call
 * arguments are the only difference between two failures of one routine — because that is the population
 * this mechanism exists for, and a fixture of `a`/`b` strings would pass while saying nothing about it.
 */
import { describe, expect, it } from 'vitest';
import { defaultPolicy } from '../../kernel/index.js';
import type { DistillCandidate, KnowledgeItem } from '../../kernel/index.js';
import { createKnowledgeItem } from '../../kernel/index.js';
import { EmbeddedMemory, MemoryJournal } from '../../memory/index.js';
import { buildPack } from '../pack.js';
import { DEFAULT_FOLD_SUPPORT, foldByShape } from '../shape-fold.js';

const AT = 1_700_000_000_000;

/** One record: a question, the calls it should have made, and the task that taught it. */
function record(
  id: string,
  calls: readonly string[],
  options: { readonly task?: string; readonly kind?: DistillCandidate['kind']; readonly note?: string } = {},
): KnowledgeItem {
  const statement = [
    `Q: where is my order ${id}`,
    `A: ${calls.map((call) => `${call}(order_id="${id}")`).join('; ')}`,
    ...(options.note === undefined ? [] : [`note: ${options.note}`]),
  ].join('\n');
  const candidate: DistillCandidate = {
    namespace: 'tau2',
    kind: options.kind ?? 'exemplar',
    scope: { task: 'tau2.act' },
    statement,
    payload: { calls: calls.length },
    evidence: {
      feedbackId: `f_${id}`,
      runId: `r_${id}`,
      at: AT,
      taskId: options.task ?? id,
      weight: 0.9,
    },
    trust: 0.9,
    dedupeKey: `rawlog|${id}`,
  };
  return createKnowledgeItem(candidate, defaultPolicy, AT, id);
}

/** The extractor the τ² lane installs: the call names on the record's `A:` line. */
function shapeOf(item: KnowledgeItem): string | undefined {
  const line = item.statement.split('\n').find((entry) => entry.startsWith('A: '));
  if (line === undefined) return undefined;
  return line
    .slice(3)
    .split('; ')
    .map((call) => call.slice(0, call.indexOf('(')))
    .join(' > ');
}

const EXCHANGE = ['get_order_details', 'exchange_delivered_order_items'];

describe('what a shape is', () => {
  it('folds two failures of one routine into one line, and keeps the other routine apart', () => {
    const fold = foldByShape(
      [
        record('a', EXCHANGE, { task: '1' }),
        record('b', EXCHANGE, { task: '2' }),
        record('c', ['get_order_details', 'cancel_pending_order'], { task: '3' }),
      ],
      { mode: 'collapse', shapeOf },
    );
    expect(fold.items.map((item) => item.id)).toHaveLength(2);
    expect(fold.folded).toBe(1);
    expect(fold.groups).toHaveLength(1);
    expect(fold.groups[0]?.members).toEqual(['a', 'b']);
    expect(fold.groups[0]?.support).toBe(2);
    expect(fold.groups[0]?.shape).toBe('get_order_details > exchange_delivered_order_items');
  });

  it('never folds two kinds together, and reports one shape twice rather than hiding the kind', () => {
    const fold = foldByShape(
      [
        record('a', EXCHANGE, { task: '1' }),
        record('b', EXCHANGE, { task: '2', kind: 'negative' }),
        record('c', EXCHANGE, { task: '3' }),
      ],
      { mode: 'collapse', shapeOf },
    );
    // `a` and `c` are the same kind and fold; `b` asserts the opposite and is its own unit.
    expect(fold.items.map((item) => item.id).sort()).toEqual(['a', 'b']);
    expect(fold.groups).toHaveLength(1);
    expect(fold.groups[0]?.members).toEqual(['a', 'c']);
    expect(fold.groups[0]?.shape).toBe('get_order_details > exchange_delivered_order_items');
  });

  it('folds nothing when the group is taught by one task, and counts the refusal', () => {
    const fold = foldByShape(
      [record('a', EXCHANGE, { task: '7' }), record('b', EXCHANGE, { task: '7' })],
      { mode: 'collapse', shapeOf },
    );
    expect(fold.items.map((item) => item.id)).toEqual(['a', 'b']);
    expect(fold.groups).toEqual([]);
    expect(fold.refused).toBe(1);
    expect(fold.support).toEqual({ max: 1, atLeastTwo: 0, atLeastThree: 0 });
  });

  it('treats an item the extractor cannot name as its own unit', () => {
    const fold = foldByShape(
      [record('a', [], { task: '1' }), record('b', [], { task: '2' }), record('c', EXCHANGE, { task: '3' })],
      { mode: 'collapse', shapeOf },
    );
    // Two rubric-only records state no call line, so they share no shape and cannot fold.
    expect(fold.items.map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(fold.folded).toBe(0);
    expect(fold.refused).toBe(0);
  });

  it('reads a blank extractor answer as no shape at all', () => {
    const fold = foldByShape([record('a', EXCHANGE, { task: '1' }), record('b', EXCHANGE, { task: '2' })], {
      mode: 'collapse',
      shapeOf: () => '   ',
    });
    expect(fold.items).toHaveLength(2);
    expect(fold.groups).toEqual([]);
  });

  it('folds nothing at all without an extractor', () => {
    const items = [record('a', EXCHANGE, { task: '1' }), record('b', EXCHANGE, { task: '2' })];
    const fold = foldByShape(items, { mode: 'collapse' });
    expect(fold.items.map((item) => item.id)).toEqual(['a', 'b']);
    expect(fold.folded).toBe(0);
    // Each unit still reports the support it has — folding is what needs a vocabulary, counting does not.
    expect(fold.support).toEqual({ max: 1, atLeastTwo: 0, atLeastThree: 0 });
  });
});

describe('who survives a group', () => {
  it('keeps the member whose claim the others restate', () => {
    // `b` restates `a` and `c` with an extra caveat; the containment measure is symmetric over the
    // smaller claim, so the member that adds nothing is the centre.
    const fold = foldByShape(
      [
        record('a', EXCHANGE, { task: '1', note: 'refund the difference' }),
        record('b', EXCHANGE, { task: '2' }),
        record('c', EXCHANGE, { task: '3', note: 'confirm the address first' }),
      ],
      { mode: 'collapse', shapeOf },
    );
    expect(fold.items).toHaveLength(1);
    expect(fold.items[0]?.id).toBe('b');
    expect(fold.groups[0]?.kept).toBe('b');
  });

  it('keeps the earliest-ranked member when the group is a tie', () => {
    const fold = foldByShape(
      [record('a', EXCHANGE, { task: '1' }), record('b', EXCHANGE, { task: '2' })],
      { mode: 'collapse', shapeOf },
    );
    expect(fold.items[0]?.id).toBe('a');
  });

  it('leaves the survivor where its earliest member stood, and re-ranks nothing', () => {
    const fold = foldByShape(
      [
        record('x', ['get_order_details', 'cancel_pending_order'], { task: '1' }),
        record('a', EXCHANGE, { task: '2' }),
        record('y', ['get_order_details', 'cancel_pending_order'], { task: '3' }),
        record('b', EXCHANGE, { task: '4' }),
      ],
      { mode: 'collapse', shapeOf },
    );
    expect(fold.items.map((item) => item.id)).toEqual(['x', 'a']);
  });

  it('copies the survivor rather than rewriting it', () => {
    const items = [record('a', EXCHANGE, { task: '1' }), record('b', EXCHANGE, { task: '2' })];
    const fold = foldByShape(items, { mode: 'collapse', shapeOf });
    // The same object, not a copy with a rewritten statement or an invented evidence trail.
    expect(fold.items[0]).toBe(items[0]);
    expect(fold.items[0]?.evidence).toHaveLength(1);
  });
});

describe('what the pack reports', () => {
  it('counts the units at the support levels the competitor cells are named after', () => {
    const fold = foldByShape(
      [
        record('a', EXCHANGE, { task: '1' }),
        record('b', EXCHANGE, { task: '2' }),
        record('c', EXCHANGE, { task: '3' }),
        record('d', ['get_order_details', 'cancel_pending_order'], { task: '4' }),
        record('e', ['get_order_details', 'cancel_pending_order'], { task: '5' }),
        record('f', ['find_user_id_by_email'], { task: '6' }),
      ],
      { mode: 'collapse', shapeOf },
    );
    expect(fold.support.max).toBe(3);
    expect(fold.support.atLeastTwo).toBe(2);
    expect(fold.support.atLeastThree).toBe(1);
    expect(fold.folded).toBe(3);
  });

  it('keeps the largest support it saw, whichever order the pack arrives in', () => {
    const fold = foldByShape(
      [
        record('a', EXCHANGE, { task: '1' }),
        record('b', EXCHANGE, { task: '2' }),
        record('c', EXCHANGE, { task: '3' }),
        record('d', ['find_user_id_by_email'], { task: '4' }),
      ],
      { mode: 'collapse', shapeOf },
    );
    // The group of three folds to one unit of support 3, and the singleton beside it carries 1: a
    // census that took the last unit's support would report 1 here.
    expect(fold.support).toEqual({ max: 3, atLeastTwo: 1, atLeastThree: 1 });
  });

  it('reads the same census on the control arm, where it is a reading rather than an absence', () => {
    const items = [record('a', EXCHANGE, { task: '1' }), record('b', EXCHANGE, { task: '2' })];
    const fold = foldByShape(items, { mode: 'per-failure', shapeOf });
    expect(fold.items.map((item) => item.id)).toEqual(['a', 'b']);
    expect(fold.folded).toBe(0);
    expect(fold.groups).toEqual([]);
    // R92's finding, reproduced inside the arm instead of argued from the store's size.
    expect(fold.support).toEqual({ max: 1, atLeastTwo: 0, atLeastThree: 0 });
  });

  it('falls back to the run id when evidence names no task, and never invents a count', () => {
    const candidate: DistillCandidate = {
      namespace: 'tau2',
      kind: 'exemplar',
      scope: { task: 'tau2.act' },
      statement: 'Q: x\nA: get_order_details(order_id="1")',
      evidence: { feedbackId: 'f', runId: 'r1', at: AT, weight: 0.9 },
      trust: 0.9,
      dedupeKey: 'k1',
    };
    const one = createKnowledgeItem(candidate, defaultPolicy, AT, 'a');
    const two = createKnowledgeItem(
      { ...candidate, evidence: { feedbackId: 'g', runId: 'r2', at: AT, weight: 0.9 }, dedupeKey: 'k2' },
      defaultPolicy,
      AT,
      'b',
    );
    const fold = foldByShape([one, two], { mode: 'collapse', shapeOf });
    // Two runs are two tasks: an item that declares no task is its own task, not everyone's.
    expect(fold.folded).toBe(1);
    expect(fold.support.max).toBe(2);
  });

  it('counts an item with no evidence as support zero', () => {
    const bare: KnowledgeItem = { ...record('a', EXCHANGE), evidence: [] };
    const fold = foldByShape([bare], { mode: 'collapse', shapeOf });
    expect(fold.support.max).toBe(0);
    expect(fold.items).toHaveLength(1);
  });

  it('never folds below two distinct tasks, whatever the caller asks for', () => {
    const items = [record('a', EXCHANGE, { task: '9' }), record('b', EXCHANGE, { task: '9' })];
    for (const minSupport of [0, 1, -3, 1.9]) {
      const fold = foldByShape(items, { mode: 'collapse', shapeOf, minSupport });
      expect(fold.folded).toBe(0);
    }
    expect(DEFAULT_FOLD_SUPPORT).toBe(2);
  });

  it('is a function of the pack and not of its size', () => {
    expect(foldByShape([], { mode: 'collapse', shapeOf })).toEqual({
      items: [],
      folded: 0,
      groups: [],
      refused: 0,
      support: { max: 0, atLeastTwo: 0, atLeastThree: 0 },
    });
  });
});

describe('the pack the fold is applied to', () => {
  async function seeded(): Promise<EmbeddedMemory> {
    const memory = await EmbeddedMemory.open(new MemoryJournal());
    await memory.putKnowledge(
      createKnowledgeItem(
        {
          namespace: 'tau2',
          kind: 'exemplar',
          scope: { task: 'tau2.act' },
          statement: 'Q: exchange a delivered item\nexchange_delivered_order_items(order_id="W1")',
          evidence: { feedbackId: 'f1', runId: 'r1', at: AT, taskId: 't1', weight: 0.9 },
          trust: 0.9,
          dedupeKey: 'k1',
        },
        defaultPolicy,
        AT,
        'k1',
      ),
    );
    await memory.putKnowledge(
      createKnowledgeItem(
        {
          namespace: 'tau2',
          kind: 'exemplar',
          scope: { task: 'tau2.act' },
          statement: 'Q: exchange a delivered item\nexchange_delivered_order_items(order_id="W2")',
          evidence: { feedbackId: 'f2', runId: 'r2', at: AT, taskId: 't2', weight: 0.9 },
          trust: 0.9,
          dedupeKey: 'k2',
        },
        defaultPolicy,
        AT,
        'k2',
      ),
    );
    return memory;
  }

  const query = { task: 'tau2.act', text: 'exchange a delivered item', namespace: 'tau2' };

  it('carries no census at all on a host that cannot name a shape', async () => {
    const memory = await seeded();
    const pack = await buildPack(query, { memory });
    expect(pack.fold).toBeUndefined();
    expect(pack.ids).toHaveLength(2);
    await memory.close();
  });

  it('renders one line where the per-failure pack rendered two', async () => {
    const memory = await seeded();
    const before = await buildPack(query, { memory, shapeOf: () => 'exchange' });
    const after = await buildPack(query, { memory, shapeOf: () => 'exchange', shape: 'collapse' });
    expect(before.ids).toHaveLength(2);
    expect(after.ids).toHaveLength(1);
    expect(after.rendered.split('\n')).toHaveLength(3);
    expect(after.fold?.folded).toBe(1);
    expect(after.fold?.support.atLeastTwo).toBe(1);
    // The pack's `items` describe exactly what was rendered, and the survivor is one of the store's.
    expect(after.items.map((item) => item.id)).toEqual(after.ids);
    expect(before.hash).not.toBe(after.hash);
    await memory.close();
  });

  it('takes the unit from the query when the caller states no option', async () => {
    const memory = await seeded();
    const pack = await buildPack(
      { ...query, shape: 'collapse' },
      { memory, shapeOf: () => 'exchange' },
    );
    expect(pack.ids).toHaveLength(1);
    await memory.close();
  });
});
