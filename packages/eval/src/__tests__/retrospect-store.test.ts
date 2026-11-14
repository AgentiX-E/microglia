import { describe, expect, it } from 'vitest';
import { clusterSources, DEFAULT_CLUSTER_OPTIONS } from '@agentix-e/microglia-core/retrospect';
import {
  readStoreDump,
  reconcileSides,
  refusalOf,
  storeDumpItems,
  type StoreDumpItem,
} from '../retrospect-store.js';

function record(overrides: Partial<StoreDumpItem> = {}): StoreDumpItem {
  return {
    id: 'k_1',
    kind: 'exemplar',
    polarity: 'repair',
    statement: 'The attempt joined orders to items through the wrong key. The correction filters on item id.',
    when: 'the question asks how many items an order holds',
    confidence: 0.7,
    scope: { task: 'tau2.retail', intent: 'order.items' },
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe('reading a store dump', () => {
  it('takes the side from the record and counts both populations', () => {
    const reading = readStoreDump(
      [record({ id: 'k_1' }), record({ id: 'k_2', polarity: 'pass' }), record({ id: 'k_3', polarity: 'pass' })],
      'unknown',
    );
    expect(reading.repairs).toBe(1);
    expect(reading.passes).toBe(2);
    expect(reading.unclassified).toBe(0);
    expect(reading.sources.map((source) => source.outcome)).toEqual(['repair', 'pass', 'pass']);
  });

  it('refuses to guess a side from the kind, and counts what it could not classify', () => {
    // The kind is what the model chose to write, not which side the record came from: the τ²
    // distiller writes `exemplar` for a correction and for a success alike, so a mapping from kind
    // to side is a guess with a systematic sign rather than a reading.
    const reading = readStoreDump(
      [
        record({ id: 'k_1', polarity: undefined }),
        record({ id: 'k_2', polarity: undefined, kind: 'negative' }),
      ],
      'unknown',
    );
    expect(reading.sources).toHaveLength(0);
    expect(reading.unclassified).toBe(2);
    expect(reading.repairs).toBe(0);
  });

  it('drops a record it cannot read at all, and says how many', () => {
    const reading = readStoreDump(
      [
        record({ id: 'k_1' }),
        record({ id: undefined }),
        record({ statement: undefined }),
        record({ id: 'k_4', polarity: undefined }),
      ],
      'unknown',
    );
    expect(reading.skipped).toBe(2);
    expect(reading.total).toBe(4);
    expect(reading.sources.map((source) => source.id)).toEqual(['k_1']);
  });

  it('counts support per declared scope, the way the consolidator counts it', () => {
    const reading = readStoreDump(
      [
        record({ id: 'k_1', scope: { task: 'tau2.retail', intent: 'order.items' } }),
        record({ id: 'k_2', scope: { task: 'tau2.retail', domain: 'retail' } }),
        record({ id: 'k_3', scope: undefined }),
      ],
      'fallback.task',
    );
    // The narrowest declared scope is the task identity, and a record that declares none is its own
    // task rather than the fallback: two unscoped records must not corroborate each other.
    expect(reading.sources.map((source) => source.taskId)).toEqual(['order.items', 'retail', 'k_3']);
    expect(reading.sources.map((source) => source.task)).toEqual([
      'tau2.retail',
      'tau2.retail',
      'fallback.task',
    ]);
  });

  it('feeds the consolidator, so a labelled store is one a batch can be built from', () => {
    const reading = readStoreDump(
      [
        record({ id: 'k_1', statement: 'Orders are joined to items on order id, not on item id.' }),
        record({ id: 'k_2', statement: 'Orders are joined to items on order id, not on sku.' }),
        record({ id: 'k_3', polarity: 'pass', statement: 'Shipments are joined on order id.' }),
      ],
      'unknown',
    );
    const repairs = reading.sources.filter((source) => source.outcome === 'repair');
    expect(repairs).toHaveLength(2);
    const clusters = clusterSources(repairs, DEFAULT_CLUSTER_OPTIONS);
    // The pass record is not in the corpus at all, which is the rule: a success may contradict a
    // guideline and may not be used to write one.
    expect(clusters.length).toBeGreaterThanOrEqual(1);
  });
});

describe('the fields a dump may leave out', () => {
  it('falls back from a confidence to the item’s trust, and to a coin flip after that', () => {
    const reading = readStoreDump(
      [
        record({ id: 'k_1', confidence: undefined, trust: 0.42 }),
        record({ id: 'k_2', confidence: undefined, trust: undefined }),
        record({ id: 'k_3', confidence: Number.NaN, trust: 0.8 }),
        record({ id: 'k_4', confidence: undefined, trust: Number.POSITIVE_INFINITY }),
      ],
      'unknown',
    );
    // A value that is not a finite number is a value the dump does not have, which is why `Number.NaN`
    // falls through rather than poisoning the confidence the consolidator ranks by.
    expect(reading.sources.map((source) => source.confidence)).toEqual([0.42, 0.5, 0.8, 0.5]);
  });

  it('reads the task from the domain when the record declares no task, and dates an undated one at zero', () => {
    const reading = readStoreDump(
      [record({ scope: { domain: 'retail' }, createdAt: undefined })],
      'fallback.task',
    );
    expect(reading.sources[0]?.task).toBe('retail');
    expect(reading.sources[0]?.taskId).toBe('retail');
    expect(reading.sources[0]?.at).toBe(0);
  });

  it('drops a condition that is only whitespace, because a blank trigger is no trigger', () => {
    const reading = readStoreDump([record({ when: '   ' })], 'unknown');
    expect(Object.hasOwn(reading.sources[0] ?? {}, 'when')).toBe(false);
  });

  it('keeps a condition that says something', () => {
    const reading = readStoreDump([record({ when: 'the question asks for a count' })], 'unknown');
    expect(reading.sources[0]?.when).toBe('the question asks for a count');
  });
});

describe('the refusal, when there is nothing to consolidate', () => {
  it('names the two causes apart rather than reporting one silence', () => {
    const unlabelled = readStoreDump([record({ polarity: undefined })], 'unknown');
    const sentence = refusalOf(unlabelled, 'r93.json');
    expect(sentence).toContain('does not record which side');
    expect(sentence).toContain('1 record');

    const successes = readStoreDump([record({ polarity: 'pass' })], 'unknown');
    expect(refusalOf(successes, 'r99.json')).toContain('only successes');
  });

  it('stays silent when at least one repair is in the corpus', () => {
    expect(refusalOf(readStoreDump([record()], 'unknown'), 'x.json')).toBeUndefined();
  });

  it('reports the count of unusable records when some exist', () => {
    const reading = readStoreDump([record({ polarity: undefined }), record({ id: undefined })], 'unknown');
    expect(refusalOf(reading, 'x.json')).toContain('1 could not be read');
  });
});

describe('two instruments over one store must agree', () => {
  const census = (
    overrides: Partial<{ itemsEditedOnly: number; itemsPassedOnly: number; itemsMixed: number }> = {},
  ): { itemsEditedOnly: number; itemsPassedOnly: number; itemsMixed: number } => ({
    itemsEditedOnly: 1,
    itemsPassedOnly: 2,
    itemsMixed: 0,
    ...overrides,
  });

  it('agrees when the sides and the run-level join attribute the same items', () => {
    const reading = readStoreDump(
      [record(), record({ id: 'k_2', polarity: 'pass' }), record({ id: 'k_3', polarity: 'pass' })],
      'unknown',
    );
    expect(reconcileSides(reading, { census: census(), omitted: 0 }).state).toBe('agree');
  });

  it('agrees when an item teaches from both populations, because the store records one side', () => {
    // One item cites a repair and a pass; the store records the side it was *learned from*. The
    // run-level census calls it mixed and the field calls it a repair, and that is the only
    // difference the mixture can explain.
    const reading = readStoreDump(
      [record(), record({ id: 'k_2' }), record({ id: 'k_3', polarity: 'pass' })],
      'unknown',
    );
    const check = reconcileSides(reading, {
      census: census({ itemsEditedOnly: 1, itemsPassedOnly: 1, itemsMixed: 1 }),
      omitted: 0,
    });
    expect(check.state).toBe('agree');
  });

  it('refuses the reading when the join knows of more repairs than the store records', () => {
    // Two records, both passes, and the join says one of them was a correction. A side that reads
    // the correction as a success is a mapping defect on the write path, not a store to trust.
    const reading = readStoreDump([record({ polarity: 'pass' }), record({ id: 'k_2', polarity: 'pass' })], 'unknown');
    const check = reconcileSides(reading, { census: census({ itemsEditedOnly: 1, itemsPassedOnly: 1 }), omitted: 0 });
    expect(check.state).toBe('disagree');
    expect(check.sentence).toContain('disagree');
  });

  it('refuses it when the two instruments count different stores', () => {
    const reading = readStoreDump([record()], 'unknown');
    const check = reconcileSides(reading, { census: census({ itemsEditedOnly: 1, itemsPassedOnly: 2 }), omitted: 0 });
    expect(check.state).toBe('disagree');
    expect(check.sentence).toContain('3');
  });

  it('is unavailable on a sampled store, because a capped dump cannot be compared to a full census', () => {
    const reading = readStoreDump([record()], 'unknown');
    expect(reconcileSides(reading, { census: census(), omitted: 9 }).state).toBe('unavailable');
    expect(reconcileSides(reading, {}).state).toBe('unavailable');
  });

  it('treats a document that never stated a cap as a complete one', () => {
    // A bare array or an older artefact carries no `omitted`; the field was never optional in the
    // sample, so its absence is a document that did not sample rather than one that hid a sample.
    const reading = readStoreDump(
      [record(), record({ id: 'k_2', polarity: 'pass' }), record({ id: 'k_3', polarity: 'pass' })],
      'unknown',
    );
    expect(reconcileSides(reading, { census: census() }).state).toBe('agree');
  });

  it('is unavailable when some records carry no side, since the census counts items the field cannot', () => {
    const reading = readStoreDump([record(), record({ id: 'k_2', polarity: undefined })], 'unknown');
    const check = reconcileSides(reading, { census: census({ itemsEditedOnly: 1, itemsPassedOnly: 0 }), omitted: 0 });
    expect(check.state).toBe('unavailable');
  });
});

describe('finding the store inside an artefact', () => {
  it('reads a bare array', () => {
    expect(storeDumpItems([record()], 'x.json').items).toHaveLength(1);
    expect(storeDumpItems([record()], 'x.json').omitted).toBe(0);
  });

  it('reads the l4 artefact’s nested sample, and remembers the cap', () => {
    const found = storeDumpItems({ tau2: { storeItems: { items: [record()], omitted: 3, limit: 64 } } }, 'x.json');
    expect(found.items).toHaveLength(1);
    expect(found.omitted).toBe(3);
  });

  it('refuses a document with no store rather than reporting an empty one', () => {
    expect(() => storeDumpItems({ tau2: {} }, 'x.json')).toThrow(/no item array/);
    expect(() => storeDumpItems({ tau2: { storeItems: { limit: 64 } } }, 'x.json')).toThrow(/no item array/);
  });

  it('reads a cap that is not a count as no cap, rather than as a number a reader would divide by', () => {
    expect(storeDumpItems({ tau2: { storeItems: { items: [record()], omitted: -3 } } }, 'x.json').omitted).toBe(0);
    expect(storeDumpItems({ tau2: { storeItems: { items: [record()], omitted: '3' } } }, 'x.json').omitted).toBe(0);
    expect(
      storeDumpItems({ tau2: { storeItems: { items: [record()], omitted: Number.NaN } } }, 'x.json').omitted,
    ).toBe(0);
  });
});
