/**
 * R253 - memory net-gain ledger, behaviour tests (RED first).
 *
 * The gate quantifies the "memory negative effect" the standing question 8 keeps probing: it scores a
 * memory policy on both personalisation utility (follow-through, net win-rate gain) and memory safety
 * (poison acceptance, false acceptance), refuses a policy that is unsafe OR useless, and attributes each
 * component's marginal contribution by ablation. Numbers follow CAPTURE (arXiv 2609.02265): 71.5% win
 * rate, 83.5% follow-through, 11.5% poisoning, 8.9% false acceptance, and its ablations (+22pp poisoning
 * without the authenticity gate, +14pp without source, -5.4pp follow-through without time scales).
 * See memory-gain-ledger.ts.
 */
import { describe, expect, it } from 'vitest';

import {
  memoryGainLedger,
  type GainArm,
  type GainAblation,
  type MemoryGainInput,
} from '../memory-gain-ledger.js';

const arm = (over: Partial<GainArm> = {}): GainArm => ({
  id: 'full',
  trials: 1000,
  wins: 715,
  trueUpdates: 1000,
  followThrough: 835,
  benignNonUpdates: 1000,
  falseAccepts: 89,
  poisonAttempts: 1000,
  poisonAccepts: 115,
  ...over,
});

const input = (over: Partial<MemoryGainInput> = {}): MemoryGainInput => ({
  id: 'ep-1',
  baselineWinMilli: 661,
  poisonBudgetMilli: 200,
  followFloorMilli: 700,
  falseAcceptBudgetMilli: 150,
  arms: [arm()],
  ...over,
});

describe('R253 memoryGainLedger - net gain and safety/utility ladder', () => {
  it('admits a safe, useful policy and reports its integer rates', () => {
    const r = memoryGainLedger(input());
    expect(r.verdict).toBe('admit');
    expect(r.reason).toBe('net-positive');
    expect(r.decidingId).toBe('full');
    expect(r.decidingNetGainMilli).toBe(54); // 715 - 661
    expect(r.armCount).toBe(1);
    expect(r.admitCount).toBe(1);
    expect(r.rejectCount).toBe(0);
    expect(r.contributions).toEqual([]);
  });

  it('refuses poisoning beyond the safety budget (zeta_safe) even with high follow-through', () => {
    // Timeliness RAG: 85.7% follow-through but 51.6% poisoning (CAPTURE).
    const r = memoryGainLedger(input({ arms: [arm({ id: 'timeliness', followThrough: 857, poisonAccepts: 516 })] }));
    expect(r.verdict).toBe('reject');
    expect(r.reason).toBe('poisoning-exceeds-budget');
    expect(r.decidingNetGainMilli).toBe(54);
  });

  it('refuses utility collapse: zero poisoning but follow-through below the floor', () => {
    // Over-defence (2601.05504): GPT-4o-mini rejects all 23 candidates -> memory benefit is gone.
    const r = memoryGainLedger(
      input({ arms: [arm({ id: 'over-defence', trueUpdates: 100, followThrough: 0, poisonAttempts: 100, poisonAccepts: 0 })] }),
    );
    expect(r.verdict).toBe('reject');
    expect(r.reason).toBe('utility-collapse');
  });

  it('refuses excessive false acceptance of benign non-updates', () => {
    const r = memoryGainLedger(input({ arms: [arm({ falseAccepts: 160 })] }));
    expect(r.verdict).toBe('reject');
    expect(r.reason).toBe('false-accept-exceeds-budget');
  });

  it('refuses a policy with no positive win-rate gain over the no-memory baseline', () => {
    const r = memoryGainLedger(input({ arms: [arm({ wins: 650 })] }));
    expect(r.verdict).toBe('reject');
    expect(r.reason).toBe('no-net-gain');
    expect(r.decidingNetGainMilli).toBe(-11);
  });

  it('treats a zero net gain as no gain, not positive', () => {
    const r = memoryGainLedger(input({ arms: [arm({ wins: 661 })] }));
    expect(r.reason).toBe('no-net-gain');
    expect(r.decidingNetGainMilli).toBe(0);
  });

  it('applies strict priority: poisoning outranks collapse, false acceptance and no-gain', () => {
    const r = memoryGainLedger(
      input({
        arms: [
          arm({ id: 'a-collapse', trueUpdates: 100, followThrough: 0, poisonAttempts: 100, poisonAccepts: 0 }),
          arm({ id: 'b-poison', poisonAccepts: 900 }),
          arm({ id: 'c-false', falseAccepts: 900 }),
          arm({ id: 'd-nogain', wins: 1 }),
        ],
      }),
    );
    expect(r.reason).toBe('poisoning-exceeds-budget');
    expect(r.decidingId).toBe('b-poison');
  });

  it('applies strict priority: utility collapse outranks false acceptance and no-gain', () => {
    const r = memoryGainLedger(
      input({
        arms: [
          arm({ id: 'a-false', falseAccepts: 900 }),
          arm({ id: 'b-collapse', trueUpdates: 100, followThrough: 0, poisonAttempts: 100, poisonAccepts: 0 }),
          arm({ id: 'c-nogain', wins: 1 }),
        ],
      }),
    );
    expect(r.reason).toBe('utility-collapse');
    expect(r.decidingId).toBe('b-collapse');
  });

  it('applies strict priority: false acceptance outranks no-gain', () => {
    const r = memoryGainLedger(
      input({
        arms: [
          arm({ id: 'a-nogain', wins: 1 }),
          arm({ id: 'b-false', falseAccepts: 900 }),
        ],
      }),
    );
    expect(r.reason).toBe('false-accept-exceeds-budget');
    expect(r.decidingId).toBe('b-false');
  });

  it('takes the strictest set verdict and names the first arm on a severity tie', () => {
    const r = memoryGainLedger(
      input({
        arms: [
          arm({ id: 'good' }),
          arm({ id: 'bad-first', poisonAccepts: 500 }),
          arm({ id: 'bad-second', poisonAccepts: 600 }),
        ],
      }),
    );
    expect(r.verdict).toBe('reject');
    expect(r.reason).toBe('poisoning-exceeds-budget');
    expect(r.decidingId).toBe('bad-first');
    expect(r.armCount).toBe(3);
    expect(r.admitCount).toBe(1);
    expect(r.rejectCount).toBe(2);
  });

  it('admits a set only when every arm is net-positive', () => {
    const r = memoryGainLedger(input({ arms: [arm({ id: 'a' }), arm({ id: 'b', wins: 800 })] }));
    expect(r.verdict).toBe('admit');
    expect(r.admitCount).toBe(2);
    expect(r.rejectCount).toBe(0);
  });

  it('rounds rates half-up to integer thousandths (no float drift)', () => {
    // 1/8 = 0.125 -> 125; 1/3 = 0.3333 -> 333; 2/3 = 0.6667 -> 667.
    const r = memoryGainLedger(
      input({
        arms: [arm({ trials: 8, wins: 1, trueUpdates: 3, followThrough: 1, poisonAttempts: 3, poisonAccepts: 2 })],
        baselineWinMilli: 0,
        poisonBudgetMilli: 700,
        followFloorMilli: 0,
      }),
    );
    expect(r.decidingNetGainMilli).toBe(125);
  });

  it('attributes each ablated component by its poisoning and follow-through delta', () => {
    const r = memoryGainLedger(
      input({
        arms: [
          arm({ id: 'full' }),
          arm({ id: 'w-o-auth', poisonAccepts: 335 }), // +220pp poisoning without authenticity gate
          arm({ id: 'w-o-source', poisonAccepts: 255 }), // +140pp without source
          arm({ id: 'w-o-timescale', followThrough: 781 }), // -54pp follow-through without time scales
        ],
        ablations: [
          { id: 'authenticity', baseArmId: 'full', ablatedArmId: 'w-o-auth' },
          { id: 'source', baseArmId: 'full', ablatedArmId: 'w-o-source' },
          { id: 'timescale', baseArmId: 'full', ablatedArmId: 'w-o-timescale' },
        ],
      }),
    );
    expect(r.contributions).toEqual([
      { id: 'authenticity', poisonDeltaMilli: 220, followDeltaMilli: 0 },
      { id: 'source', poisonDeltaMilli: 140, followDeltaMilli: 0 },
      { id: 'timescale', poisonDeltaMilli: 0, followDeltaMilli: 54 },
    ]);
  });

  it('accepts an omitted ablations list as empty', () => {
    const r = memoryGainLedger(input());
    expect(r.contributions).toEqual([]);
  });

  it('is deterministic on identical input', () => {
    const a = memoryGainLedger(input());
    const b = memoryGainLedger(input());
    expect(a).toEqual(b);
  });
});

describe('R253 memoryGainLedger - configuration guards', () => {
  const refuses = (over: Partial<MemoryGainInput>): void => {
    expect(() => memoryGainLedger(input(over))).toThrow();
  };

  it('refuses a blank episode id', () => refuses({ id: '  ' }));
  it('refuses a non-string episode id', () => refuses({ id: 7 as unknown as string }));

  it('refuses out-of-range or non-integer budgets and floor', () => {
    refuses({ poisonBudgetMilli: 1001 });
    refuses({ poisonBudgetMilli: -1 });
    refuses({ poisonBudgetMilli: 200.5 });
    refuses({ followFloorMilli: 1001 });
    refuses({ followFloorMilli: 1.5 });
    refuses({ falseAcceptBudgetMilli: -1 });
    refuses({ falseAcceptBudgetMilli: 1.5 });
    refuses({ baselineWinMilli: 1001 });
    refuses({ baselineWinMilli: -1 });
    refuses({ baselineWinMilli: 0.5 });
  });

  it('refuses a non-array or empty arms set', () => {
    refuses({ arms: 'no' as unknown as GainArm[] });
    refuses({ arms: [] });
  });

  it('refuses a malformed arm', () => {
    refuses({ arms: [null as unknown as GainArm] });
    refuses({ arms: [arm({ id: '  ' })] });
    refuses({ arms: [arm({ id: 'dup' }), arm({ id: 'dup' })] });
    refuses({ arms: [arm({ trials: 0 })] });
    refuses({ arms: [arm({ trials: -1 })] });
    refuses({ arms: [arm({ trials: 1.5 })] });
    refuses({ arms: [arm({ wins: -1 })] });
    refuses({ arms: [arm({ wins: 1001 })] });
    refuses({ arms: [arm({ wins: 1.5 })] });
    refuses({ arms: [arm({ trueUpdates: 0 })] });
    refuses({ arms: [arm({ followThrough: -1 })] });
    refuses({ arms: [arm({ followThrough: 1001 })] });
    refuses({ arms: [arm({ followThrough: 1.5 })] });
    refuses({ arms: [arm({ benignNonUpdates: 0 })] });
    refuses({ arms: [arm({ falseAccepts: -1 })] });
    refuses({ arms: [arm({ falseAccepts: 1001 })] });
    refuses({ arms: [arm({ falseAccepts: 1.5 })] });
    refuses({ arms: [arm({ poisonAttempts: 0 })] });
    refuses({ arms: [arm({ poisonAccepts: -1 })] });
    refuses({ arms: [arm({ poisonAccepts: 1001 })] });
    refuses({ arms: [arm({ poisonAccepts: 1.5 })] });
  });

  it('refuses a malformed ablations set', () => {
    refuses({ ablations: 'no' as unknown as GainAblation[] });
    refuses({ ablations: [null as unknown as GainAblation] });
    refuses({ ablations: [{ id: '  ', baseArmId: 'full', ablatedArmId: 'full' }] });
    refuses({ ablations: [{ id: 'a', baseArmId: '  ', ablatedArmId: 'full' }] });
    refuses({ ablations: [{ id: 'a', baseArmId: 'full', ablatedArmId: '  ' }] });
    refuses({ ablations: [{ id: 'a', baseArmId: 'missing', ablatedArmId: 'full' }] });
    refuses({ ablations: [{ id: 'a', baseArmId: 'full', ablatedArmId: 'missing' }] });
    refuses({
      ablations: [
        { id: 'dup', baseArmId: 'full', ablatedArmId: 'full' },
        { id: 'dup', baseArmId: 'full', ablatedArmId: 'full' },
      ],
    });
  });
});
