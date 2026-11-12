import { describe, expect, it } from 'vitest';
import { detectablePp, halfWidthOf, poolArms, poolLine, type PoolArm } from '../l4-pool.js';

/**
 * Pooling two dispatches into one reading.
 *
 * The arithmetic is three lines and the guards are the module, so every case here is a way a pool can
 * be made to say something larger than it measured: a duplicate task counted twice, an arm that has
 * no tasks, two treatments averaged as if they were one, two models averaged as if they were one.
 */

const arm = (label: string, passes: readonly boolean[], over: Partial<PoolArm> = {}): PoolArm => ({
  label,
  tasks: passes.map((passedAll, index) => ({ id: `${label}/${String(index + 1)}`, passedAll })),
  unit: 'raw',
  form: 'record',
  scope: 'edited',
  model: 'deepseek-chat',
  ...over,
});

describe('poolArms', () => {
  it('pools two domains into one rate and one interval', () => {
    const outcome = poolArms([arm('retail', [true, true, false, false]), arm('airline', [true, false, false, false])]);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.reading.tasks).toBe(8);
    expect(outcome.reading.pass4).toBeCloseTo(3 / 8, 10);
    expect(outcome.reading.domains).toEqual(['retail', 'airline']);
    expect(outcome.reading.halfWidth).toBeCloseTo(halfWidthOf(3 / 8, 8), 10);
  });

  it('refuses to pool one arm, because one arm has no tasks to add', () => {
    const outcome = poolArms([arm('retail', [true, false])]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.refusals.join(' ')).toContain('a pool of one arm is the arm itself');
  });

  it('refuses a task that appears in both arms, rather than de-duplicating it', () => {
    // A duplicate means one of the two files is not the split it claims to be. De-duplicating would
    // hide that and leave a pool whose n is right for the wrong reason.
    const shared = { id: 'retail/1', passedAll: true };
    const outcome = poolArms([
      { ...arm('retail', [true, false]), tasks: [shared, { id: 'retail/2', passedAll: false }] },
      { ...arm('airline', [true, false]), tasks: [shared, { id: 'airline/2', passedAll: false }] },
    ]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.refusals.join(' ')).toContain('the same task appears in two arms');
    expect(outcome.refusals.join(' ')).toContain('retail/1 (retail, airline)');
  });

  it('summarises a large overlap rather than printing every duplicated id', () => {
    // A duplicate file is 57 overlapping rows, and a refusal that prints all of them is a refusal
    // nobody reads to the end -- where the sentence that says what is wrong lives.
    const shared = Array.from({ length: 7 }, (_, index) => ({ id: `retail/${String(index)}`, passedAll: true }));
    const outcome = poolArms([
      { ...arm('retail', []), tasks: shared },
      { ...arm('airline', []), tasks: shared.map((row) => ({ ...row })) },
    ]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    const text = outcome.refusals.join(' ');
    expect(text).toContain('and 2 more');
    expect(text).not.toContain('retail/6');
  });

  it('refuses an arm that measured nothing instead of averaging it in', () => {
    const outcome = poolArms([arm('retail', [true, false]), arm('airline', [])]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.refusals.join(' ')).toContain('arm(s) with no tasks: airline');
  });

  it('names the field that makes two arms two experiments', () => {
    const outcome = poolArms([
      arm('retail', [true, false]),
      arm('airline', [true, false], { unit: 'trace' }),
    ]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.refusals.join(' ')).toContain("unit is 'raw' on retail and 'trace' on airline");
  });

  it('refuses two models, whoever dispatched them', () => {
    const outcome = poolArms([
      arm('retail', [true, false]),
      arm('airline', [true, false], { model: 'deepseek-reasoner' }),
    ]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.refusals.join(' ')).toContain('model is');
  });

  it('refuses two trace ceilings, because the ceiling decides the yield', () => {
    const outcome = poolArms([
      arm('retail', [true, false], { traceClaims: 3 }),
      arm('airline', [true, false], { traceClaims: 6 }),
    ]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.refusals.join(' ')).toContain("traceClaims is '3' on retail and '6' on airline");
  });

  it('refuses a pool where only one arm states the trace ceiling', () => {
    // The correction and raw units have no ceiling, so its absence is a fact about the unit rather
    // than a gap -- but one arm stating it and another not is a disagreement, because the ceiling
    // decides the yield and a pool that cannot compare the ceiling cannot compare the stores.
    const outcome = poolArms([
      arm('retail', [true, false], { traceClaims: 3 }),
      arm('airline', [true, false]),
    ]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.refusals.join(' ')).toContain('one arm states a trace ceiling and another does not (airline)');
  });

  it('treats an unrecorded field as silence rather than as a match', () => {
    // An artefact written before a field existed says nothing about it, and "nothing" is not "the
    // same as the other arm": pooling it would assume the arm ran the same treatment.
    const outcome = poolArms([
      { label: 'retail', tasks: [{ id: 'retail/1', passedAll: true }] },
      { label: 'airline', tasks: [{ id: 'airline/1', passedAll: true }] },
    ]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.refusals.join(' ')).toContain('unit, form, scope, model unrecorded on retail');
  });

  it('collects every refusal rather than stopping at the first', () => {
    const outcome = poolArms([
      arm('retail', [true, false]),
      arm('airline', [true, false], { unit: 'trace', model: 'other' }),
    ]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.refusals.length).toBeGreaterThanOrEqual(2);
  });
});

describe('the interval arithmetic', () => {
  it('halves the interval when the sample quadruples', () => {
    const one = halfWidthOf(0.575, 57);
    const four = halfWidthOf(0.575, 228);
    expect(one / four).toBeCloseTo(2, 1);
    expect(one * 100).toBeGreaterThan(12);
    expect(one * 100).toBeLessThan(13);
  });

  it('states the smallest difference a pool of this size could resolve', () => {
    const at57 = detectablePp({ halfWidth: halfWidthOf(0.575, 57) });
    const at114 = detectablePp({ halfWidth: halfWidthOf(0.575, 114) });
    expect(at57).toBeGreaterThan(at114);
    expect(at114).toBeGreaterThan(11);
    expect(at114).toBeLessThan(14);
  });

  it('is maximal rather than infinite at zero tasks, so a caller cannot divide by it', () => {
    expect(halfWidthOf(0.5, 0)).toBe(1);
  });
});

describe('poolLine', () => {
  it('prints the pooled rate with the per-arm rates that produced it', () => {
    const outcome = poolArms([arm('retail', [true, true, false, false]), arm('airline', [true, false, false, false])]);
    const line = poolLine(outcome);
    expect(line).toContain('0.3750 over 8 task(s)');
    expect(line).toContain('retail 0.5000 (n=4)');
    expect(line).toContain('airline 0.2500 (n=4)');
  });

  it('prints the refusal instead of a number', () => {
    const line = poolLine(poolArms([arm('retail', [true])]));
    expect(line.startsWith('pool: refused')).toBe(true);
    expect(line).toContain('a pool of one arm');
  });
});
