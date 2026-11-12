import { describe, expect, it } from 'vitest';
import {
  encodeItemLine,
  maxStatementChars,
  renderPack,
  type RenderableItem,
  type StatementShape,
} from '../render.js';

/**
 * The capacity number is the one that says whether a writer and a reader agree.
 *
 * R88 raised the record ceiling to 2,000 characters while the pack stayed at 1,200, and nothing
 * anywhere compared the two: a record above what the pack can render is retrieved, ranked, and then
 * dropped at render, so the write side spends text the read side never shows. These tests hold the
 * measurement that makes the comparison possible — and, in the last two, the limits of that
 * measurement, because a capacity quoted outside its shape is the defect it was built to catch.
 */

/** A bare claim: no condition, no payload, a short id, one scope dimension. */
const BARE: StatementShape = {
  id: 'k_000000000000000000',
  kind: 'claim',
  confidence: 0.6,
  scope: { task: 'probe' },
};

/** The shape a τ² record is written in: a domain dimension, a four-digit confidence, a payload. */
const RECORD: StatementShape = {
  id: 'k_01hf7uaq1e_9znv8',
  kind: 'exemplar',
  confidence: 0.6165,
  scope: { task: '3', domain: 'retail' },
  payload: {
    taskId: '4f2a1c3e-9b1d-4c7a-8e11-2b3c4d5e6f70',
    runId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
    calls: 3,
    ceiling: 2000,
  },
};

describe('maxStatementChars', () => {
  it('returns the exact boundary: one character more does not render', () => {
    const budget = 1200;
    const capacity = maxStatementChars({ budget }, RECORD);
    const at = renderPack([{ ...RECORD, statement: 'x'.repeat(capacity) }], { budget });
    const over = renderPack([{ ...RECORD, statement: 'x'.repeat(capacity + 1) }], { budget });
    expect(at.ids).toHaveLength(1);
    expect(over.ids).toEqual([]);
    expect(over.truncated).toBe(1);
  });

  it('buys exactly one character of capacity per character of budget, because the wrapper is fixed', () => {
    // The claim being tested is not "capacity grows" but "capacity grows in step": a fixed wrapper
    // and a per-line cost that does not depend on the budget are what make `ceiling + cost = budget`
    // an arithmetic fact a registration can be checked against.
    for (const shape of [BARE, RECORD]) {
      const low = maxStatementChars({ budget: 1200 }, shape);
      const high = maxStatementChars({ budget: 2000 }, shape);
      expect(high - low).toBe(800);
    }
  });

  it('reports zero when the budget cannot hold the wrapper, rather than a negative number', () => {
    expect(maxStatementChars({ budget: 120 }, RECORD)).toBe(0);
    expect(maxStatementChars({ budget: 0 }, RECORD)).toBe(0);
  });

  it('charges the line for what the item actually carries', () => {
    // The reason the shape is a parameter and not a default: a record costs more pack than a bare
    // claim does, and a capacity quoted for the wrong shape is a check that passes on a pack that
    // cannot render the item it was quoted for. The difference is measured against the renderer's own
    // line encoder rather than a constant, so it cannot drift from what the renderer charges.
    const lineCost = (shape: StatementShape): number =>
      encodeItemLine({ ...shape, statement: '' }, true).length;
    const bare = maxStatementChars({ budget: 1200 }, BARE);
    const record = maxStatementChars({ budget: 1200 }, RECORD);
    expect(record).toBeLessThan(bare);
    expect(bare - record).toBe(lineCost(RECORD) - lineCost(BARE));
  });

  it('agrees with the historical ceiling: 700 characters fits at 1,200 with room to spare', () => {
    // Not a preference — the reason R85 never lost a record to the pack while R88 would. The 700
    // ceiling was inside the budget by accident of history, and this pins that it was inside it: 390
    // characters of the pack are wrapper and fixed fields, so 810 of a single record survive.
    expect(maxStatementChars({ budget: 1200 }, RECORD)).toBe(810);
    expect(1200 - maxStatementChars({ budget: 1200 }, RECORD)).toBe(390);
  });

  it('is an upper bound on capacity, not a guarantee, for text that needs escaping', () => {
    // The probe is plain ASCII, so a statement of quotes or newlines encodes longer than its length
    // and does not fit at the reported capacity. Stated here so the number is never read as a promise
    // about arbitrary text: a ceiling should sit below the capacity by the escape cost of what the
    // lane writes, and the τ² record's text is unescaped prose and tool calls.
    const capacity = maxStatementChars({ budget: 1200 }, RECORD);
    const quoted = renderPack([{ ...RECORD, statement: '"'.repeat(capacity) }], { budget: 1200 });
    expect(quoted.ids).toEqual([]);
  });

  it('measures under the render options it is given, so a note or basis changes the number', () => {
    // `hardened` is ~110 characters longer than `standard`, and under `note-excluded` the note is not
    // charged at all. A capacity that ignored the note would be a number about a pack nobody ran.
    const standard = maxStatementChars({ budget: 1200 }, RECORD);
    const hardened = maxStatementChars({ budget: 1200, note: 'hardened' }, RECORD);
    const excluded = maxStatementChars(
      { budget: 1200, note: 'hardened', budgetBasis: 'note-excluded' },
      RECORD,
    );
    expect(hardened).toBeLessThan(standard);
    // Excluding the note from the charge is the same arithmetic as carrying no note, which is why the
    // two numbers agree: the sentence is rendered either way and only stops competing for characters.
    expect(excluded).toBe(maxStatementChars({ budget: 1200, note: 'none' }, RECORD));
    expect(excluded).toBeGreaterThan(standard);
  });

  it('carries no state between calls, so two shapes in one process do not interfere', () => {
    const first = maxStatementChars({ budget: 1200 }, RECORD);
    maxStatementChars({ budget: 4000 }, BARE);
    expect(maxStatementChars({ budget: 1200 }, RECORD)).toBe(first);
  });
});

describe('the pack a record needs', () => {
  it('renders two short records only when the budget is raised past one record plus a second', () => {
    // What the next registration has to buy: at 1,200 a second record does not fit even when both are
    // short, so raising the ceiling without raising the budget changes what is written and not what is
    // read.
    const short = (id: string): RenderableItem => ({
      ...RECORD,
      id,
      statement: 'x'.repeat(744),
    });
    const one = renderPack([short('k_01hf7uaq1e_9znv8'), short('k_01hf7uaq1f_eqn0m')], {
      budget: 1200,
    });
    const two = renderPack([short('k_01hf7uaq1e_9znv8'), short('k_01hf7uaq1f_eqn0m')], {
      budget: 2400,
    });
    expect(one.ids).toHaveLength(1);
    expect(one.truncated).toBe(1);
    expect(two.ids).toHaveLength(2);
    expect(two.truncated).toBe(0);
  });
});
