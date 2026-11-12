import { describe, expect, it } from 'vitest';
import {
  ENTITY_MAX_CHARS,
  entitiesOf,
  faithfulnessLine,
  faithfulnessOf,
  faithfulnessRate,
} from '../tau2-faithfulness.js';

/**
 * Faithfulness: what the write destroyed.
 *
 * Every other instrument in this repository measures the route from a stored item to a prompt, and
 * all of them read the same whether the item was written perfectly or written with the order id
 * removed. These cases pin the half that reads the write, and each one is a way that number can be
 * made to say something it did not measure: the wrong denominator, a join that credits one
 * correction with another's text, a zero standing in for an absence.
 */

const item = (statement: string, runId: string, condition?: string) => ({
  statement,
  ...(condition === undefined ? {} : { condition }),
  evidence: [{ runId }],
});

describe('entitiesOf', () => {
  it('takes the argument values, which are the identities a later task will quote', () => {
    expect(
      entitiesOf([
        { arguments: { order_id: 'W237', reason: 'no longer needed' } },
        { arguments: { item_ids: ['item-9', 'item-10'], quantity: 3 } },
      ]),
    ).toEqual(['W237', 'no longer needed', 'item-9', 'item-10', '3']);
  });

  it('drops values that identify nothing: short strings, booleans, empty fields', () => {
    // `1`, `no`, `true` and an empty string are the vocabulary of every task in the corpus, so a
    // writer cannot lose them and counting them would raise every rate toward one.
    expect(
      entitiesOf([{ arguments: { a: 'no', b: '', c: true, d: null, e: 12, f: 'abc' } }]),
    ).toEqual(['12', 'abc']);
  });

  it('excludes a pasted sentence, which is prose rather than an identity', () => {
    const prose = 'x'.repeat(ENTITY_MAX_CHARS + 1);
    expect(entitiesOf([{ arguments: { note: prose } }])).toEqual([]);
  });

  it('counts an entity once per correction however many calls carry it', () => {
    expect(
      entitiesOf([{ arguments: { order_id: 'W237' } }, { arguments: { order_id: 'W237' } }]),
    ).toEqual(['W237']);
  });
});

describe('faithfulnessOf', () => {
  it('reads one for a writer that kept everything, which is what a record is', () => {
    const census = faithfulnessOf(
      [{ runId: 'r1', entities: ['W237', 'item-9'] }],
      [item('Q: exchange W237 for item-9\nA: exchange_delivered_order(order_id="W237")', 'r1')],
    );
    expect(census).toEqual({
      corrections: 1,
      withoutEntities: 0,
      entities: 2,
      kept: 2,
      whole: 1,
      unwritten: 0,
      redacted: 0,
    });
    expect(faithfulnessRate(census)).toBe(1);
  });

  it('counts a dropped identity as lost, which is the number an abstraction moves', () => {
    const census = faithfulnessOf(
      [{ runId: 'r1', entities: ['W237', 'item-9'] }],
      [item('Exchange a delivered order for a different size', 'r1')],
    );
    expect(census?.kept).toBe(0);
    expect(census?.whole).toBe(0);
    expect(faithfulnessRate(census)).toBe(0);
  });

  it('counts the condition as text the write kept', () => {
    // A claim's trigger is part of what it preserved: a rule that says `order_id="W237"` only in its
    // condition has kept the identity, and a reading that looked at the statement alone would report
    // it destroyed.
    const census = faithfulnessOf(
      [{ runId: 'r1', entities: ['W237'] }],
      [item('Confirm before changing a pending order', 'r1', 'the request names W237')],
    );
    expect(census?.kept).toBe(1);
  });

  it('matches without regard to case, because the store writing w237 has kept W237', () => {
    const census = faithfulnessOf(
      [{ runId: 'r1', entities: ['W237'] }],
      [item('the order w237 was delivered', 'r1')],
    );
    expect(census?.kept).toBe(1);
  });

  it('does not credit one correction with another correction text', () => {
    // The join is the evidence's own run id. A store that answers a correction with an item citing a
    // different one has replaced it rather than preserved it, and the reading has to say so — this is
    // exactly what an aggressively merging distiller does, and it is the case a join on task id would
    // have hidden.
    const census = faithfulnessOf(
      [
        { runId: 'r1', entities: ['W237'] },
        { runId: 'r2', entities: ['W999'] },
      ],
      [item('Q: cancel W999', 'r2')],
    );
    expect(census?.kept).toBe(1);
    expect(census?.entities).toBe(2);
    expect(census?.whole).toBe(1);
  });

  it('keeps a correction with nothing to preserve out of the denominator', () => {
    const census = faithfulnessOf(
      [
        { runId: 'r1', entities: [] },
        { runId: 'r2', entities: ['W237'] },
      ],
      [item('Q: cancel W237', 'r2')],
    );
    expect(census).toEqual({
      corrections: 1,
      withoutEntities: 1,
      entities: 1,
      kept: 1,
      whole: 1,
      unwritten: 0,
      redacted: 0,
    });
  });

  it('answers undefined rather than one when no correction carried an entity', () => {
    // A corpus with nothing to preserve cannot be found unfaithful, and reporting 1.0 for it would
    // make an entity-free lane look like a perfect writer -- the same defect as a `0` hold rate over
    // no pairs, one measurement over.
    const census = faithfulnessOf([{ runId: 'r1', entities: [] }], [item('anything', 'r1')]);
    expect(census).toBeUndefined();
    expect(faithfulnessRate(census)).toBeUndefined();
    expect(faithfulnessLine(census)).toBe('faithfulness: absent (no correction carried an argument value)');
  });
});

  it('refuses to call an unwritten store an unfaithful writer', () => {
    // The one reading this instrument must not produce. A dispatch whose distiller wrote nothing --
    // eleven of fifteen calls faulted, in the run that motivated this module -- has an empty store,
    // and every entity then "fails" the containment test because there is no text to contain it. That
    // is `0 of 15 kept (0.0%)`, which reads as total destruction at the write and is really the
    // absence of a write: the same confusion as a coverage number from a store that was never built.
    const census = faithfulnessOf(
      [
        { runId: 'r1', entities: ['W237', 'item-9'] },
        { runId: 'r2', entities: ['W999'] },
      ],
      [],
    );
    expect(census).toEqual({
      corrections: 2,
      withoutEntities: 0,
      entities: 3,
      kept: 0,
      whole: 0,
      unwritten: 2,
      redacted: 0,
    });
    expect(faithfulnessRate(census)).toBeUndefined();
    expect(faithfulnessLine(census)).toBe(
      'faithfulness: no measurement -- 3 entity(ies) in 2 correction(s) never reached the store',
    );
  });

  it('still counts a replaced item as lost once the store answered anything', () => {
    // A store that holds items has a writer that ran, so a correction with no text of its own was
    // either merged into another item or dropped -- and the module's existing rule calls that lost
    // rather than unmeasurable. Only a store with nothing in it is exempt, because only then is there
    // no writer to judge.
    const census = faithfulnessOf([{ runId: 'r1', entities: ['W237'] }], [item('Q: cancel W999', 'r2')]);
    expect(census?.unwritten).toBe(0);
    expect(faithfulnessRate(census)).toBe(0);
  });

  it('says absent when the corrections carried no argument value at all', () => {
    // The second time this module would have printed a zero for an absence, and the one that a
    // coverage number found: with every correction in `withoutEntities`, `entities` is 0 and the rate
    // is `undefined`, so a `?? 0` fallback printed `0 of 0 entity(ies) kept (0.0%)`. That sentence
    // reads as total destruction at the write and is really "this corpus had no entity to preserve".
    const census = {
      corrections: 0,
      withoutEntities: 12,
      entities: 0,
      kept: 0,
      whole: 0,
      unwritten: 0,
      redacted: 0,
    };
    expect(faithfulnessRate(census)).toBeUndefined();
    expect(faithfulnessLine(census)).toBe(
      'faithfulness: absent (12 correction(s) carried no argument value)',
    );
  });

describe('the loss the guard caused, counted apart from the loss the writer caused', () => {
  /**
   * R88 read `82 of 128` and the readback could not say whether the writer abstracted or the ceiling
   * cut. Both were wrong: the value was removed by `kernel/guard.ts` before persistence. These cases
   * pin the decomposition, and the second one is the load-bearing case — a redaction counter that
   * absorbed every loss would become an alibi for the writer, which is the defect this module exists
   * to catch rather than to repeat.
   */
  const guard = (text: string) => text === '7363354090';

  it('counts a value the guard replaced as redacted rather than lost', () => {
    const census = faithfulnessOf(
      [{ runId: 'r1', entities: ['7363354090', '#W5199551'] }],
      [item('Q: exchange #W5199551 for item_ids=["[phone]"]', 'r1')],
      guard,
    );
    expect(census).toEqual({
      corrections: 1,
      withoutEntities: 0,
      entities: 2,
      kept: 1,
      whole: 0,
      unwritten: 0,
      redacted: 1,
    });
  });

  it('does not credit the guard with a value it would have left alone', () => {
    // The writer dropped `#W5199551` and nothing else explains it. If this counted as redacted, the
    // census would report a clean guard over a writer that lost an identity -- an acquittal bought by
    // the wrong explanation.
    const census = faithfulnessOf(
      [{ runId: 'r1', entities: ['#W5199551'] }],
      [item('Exchange a delivered order for a different size', 'r1')],
      guard,
    );
    expect(census?.redacted).toBe(0);
    expect(census?.kept).toBe(0);
  });

  it('counts nothing as redacted when no guard is supplied', () => {
    // The default is the historical reading, so an arm that ran without the census does not gain a
    // field it never measured: the same rule the lane applies to every instrument it adds late.
    const census = faithfulnessOf(
      [{ runId: 'r1', entities: ['7363354090'] }],
      [item('Q: product_id="[phone]"', 'r1')],
    );
    expect(census?.redacted).toBe(0);
    expect(census?.kept).toBe(0);
  });

  it('keeps a redacted value out of whole, so a correction cannot be complete by redaction', () => {
    const census = faithfulnessOf(
      [{ runId: 'r1', entities: ['7363354090'] }],
      [item('Q: product_id="[phone]"', 'r1')],
      guard,
    );
    expect(census?.whole).toBe(0);
    // The rate stays over the entities that were stated: a redaction explains a loss, it does not
    // remove it from the denominator, or an arm that redacted everything would read as perfect.
    expect(faithfulnessRate(census)).toBe(0);
  });
});

describe('faithfulnessLine', () => {
  it('names the guard when it took part of the rate', () => {
    const line = faithfulnessLine({
      corrections: 12,
      withoutEntities: 0,
      entities: 128,
      kept: 82,
      whole: 1,
      unwritten: 0,
      redacted: 46,
    });
    expect(line).toBe(
      'faithfulness: 82 of 128 entity(ies) kept (64.1%), 46 replaced by the redaction guard, ' +
        'whole in 1 of 12 correction(s), 0 with none to keep',
    );
  });

  it('prints the counts that give the rate meaning', () => {
    const line = faithfulnessLine({
      corrections: 3,
      withoutEntities: 1,
      entities: 8,
      kept: 6,
      whole: 1,
      unwritten: 0,
      redacted: 0,
    });
    expect(line).toBe(
      'faithfulness: 6 of 8 entity(ies) kept (75.0%), whole in 1 of 3 correction(s), 1 with none to keep',
    );
  });
});
