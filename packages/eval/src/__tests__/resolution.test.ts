import { describe, expect, it } from 'vitest';
import {
  armReadingOf,
  coverageGate,
  designFloors,
  median,
  priceGate,
  readResolution,
  reconcileGate,
  replicationsOf,
  requiredSampleSize,
  round4,
  shrinkageOf,
  type ArmReading,
  type PublishedArm,
} from '../resolution.js';

/** One published row, with the printed delta derived from its counts unless a test lies about it. */
const row = (arm: string, control: string, n: number, helped: number, harmed: number): PublishedArm => ({
  arm,
  control,
  n,
  helped,
  harmed,
  foundPp: ((helped - harmed) / n) * 100,
});

const read = (
  artefact: string,
  dataset: string,
  arm: string,
  control: string,
  n: number,
  helped: number,
  harmed: number,
): ArmReading => armReadingOf(artefact, dataset, row(arm, control, n, helped, harmed));

describe('one arm, recomputed', () => {
  it('reads a delta off the discordant counts and not off the printed number', () => {
    const reading = read('a.json', 'dev', 'full', 'none', 1534, 47, 68);
    expect(reading.deltaPp).toBeCloseTo(-1.369, 3);
    expect(reading.n).toBe(1534);
    expect(reading.helped).toBe(47);
    expect(reading.harmed).toBe(68);
  });

  it('agrees with the artefact when the artefact agrees with itself', () => {
    expect(read('a.json', 'dev', 'full', 'none', 1000, 20, 10).reconciles).toBe(true);
  });

  it('refuses a printed delta that its own counts do not imply', () => {
    // The defect this catches: a row whose delta and whose discordant counts came from different
    // question sets. Both halves are plausible; their disagreement is the only symptom.
    const reading = armReadingOf('a.json', 'dev', {
      arm: 'full',
      control: 'none',
      n: 1000,
      helped: 20,
      harmed: 10,
      foundPp: 5,
    });
    expect(reading.deltaPp).toBeCloseTo(1, 6);
    expect(reading.reconciles).toBe(false);
  });

  it('tolerates a printed delta rounded to the last digit, and nothing looser', () => {
    const exact = ((20 - 10) / 1000) * 100;
    const tolerance = (delta: number): boolean =>
      armReadingOf('a.json', 'dev', { arm: 'full', control: 'none', n: 1000, helped: 20, harmed: 10, foundPp: delta })
        .reconciles;
    expect(tolerance(exact + 0.0004)).toBe(true);
    expect(tolerance(exact + 0.0006)).toBe(false);
  });

  it('throws on an arm with no cases, because a rate over nothing is not a rate', () => {
    expect(() => read('a.json', 'dev', 'full', 'none', 0, 0, 0)).toThrow(/no cases/);
  });

  it('is undecided when the effect is smaller than the smallest it could see', () => {
    const reading = read('a.json', 'dev', 'full', 'none', 1534, 47, 68);
    expect(reading.decided).toBe(false);
    expect(Math.abs(reading.deltaPp)).toBeLessThan(reading.minDetectablePp);
  });

  it('is decided when the effect clears it, and only then', () => {
    const reading = read('a.json', 'dev', 'linked', 'none', 1534, 24, 166);
    expect(reading.decided).toBe(true);
    expect(Math.abs(reading.deltaPp)).toBeGreaterThan(reading.minDetectablePp);
  });

  it('separates the 80% bar from the 95% bar on a row that clears one and not the other', () => {
    // 0.71pp on 7,000 questions: inside the interval, outside the power bar. The record's best
    // memory run is exactly this shape, so a reader has to be able to see the two columns differ.
    const reading = read('train.json', 'train', 'full', 'none', 7000, 190, 240);
    expect(reading.significant95).toBe(true);
    expect(reading.decided).toBe(false);
  });

  it('prices an undecided row above its own sample and a decided row below it', () => {
    const undecided = read('a.json', 'dev', 'full', 'none', 1534, 47, 68);
    const decided = read('a.json', 'dev', 'linked', 'none', 1534, 24, 166);
    expect(undecided.requiredN).not.toBeNull();
    expect(undecided.requiredN as number).toBeGreaterThanOrEqual(undecided.n);
    expect(decided.requiredN as number).toBeLessThanOrEqual(decided.n);
  });

  it('rounds to four places so a percentage point does not claim nine', () => {
    expect(round4(1.23456789)).toBe(1.2346);
    expect(round4(-0.00004)).toBe(-0);
    expect(round4(0)).toBe(0);
  });
});

describe('the price of a question', () => {
  it('inverts the resolution formula: the price of the effect just at the bar is the sample', () => {
    // At the boundary `|delta| = mde`, the questions needed equal the questions had. Anything else
    // means the two formulas disagree and `V71` would fire on the whole record.
    for (const n of [350, 1534, 7000]) {
      for (const discordant of [30, 115, 200]) {
        const mde = Math.sqrt((2.802 * 2.802 * (discordant / n)) / n) * 100;
        const price = requiredSampleSize(mde, discordant, n) as number;
        // Within one question of the sample: the price is a ceiling and the boundary is a float.
        expect(Math.abs(price - n)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('never prices a zero effect', () => {
    expect(requiredSampleSize(0, 100, 1000)).toBeNull();
    expect(requiredSampleSize(-0, 100, 1000)).toBeNull();
  });

  it('never prices a sample that does not exist', () => {
    expect(requiredSampleSize(1, 10, 0)).toBeNull();
    expect(requiredSampleSize(1, 0, 1000)).toBeNull();
  });

  it('caps the discordance at one, so a malformed row cannot buy a cheaper question', () => {
    const real = requiredSampleSize(1, 1000, 1000);
    const malformed = requiredSampleSize(1, 5000, 1000);
    expect(malformed).toBe(real);
  });

  it('costs more for a smaller effect: the price is the inverse square', () => {
    const big = requiredSampleSize(4, 100, 1000) as number;
    const small = requiredSampleSize(1, 100, 1000) as number;
    expect(small / big).toBeCloseTo(16, 0);
  });

  it('rounds up, because a fractional question does not exist', () => {
    const price = requiredSampleSize(3, 90, 1000) as number;
    expect(Number.isInteger(price)).toBe(true);
    expect(price).toBe(Math.ceil((2.802 * 2.802 * 0.09) / (0.03 * 0.03)));
  });
});

describe('the ledger over the whole record', () => {
  const record: readonly ArmReading[] = [
    read('dev.json', 'dev', 'full', 'none', 1534, 47, 68),
    read('train.json', 'train', 'full', 'none', 7000, 190, 240),
    read('mini.json', 'mini', 'linked', 'none', 350, 8, 35),
    read('mini.json', 'mini', 'values', 'full', 350, 28, 9),
  ];

  it('counts what it read rather than what it was given', () => {
    const ledger = readResolution(record);
    expect(ledger.rows).toBe(4);
    expect(ledger.decided + ledger.undecided).toBe(4);
    expect(ledger.reconciled).toBe(4);
    expect(ledger.artefacts).toBe(3);
  });

  it('names the largest claim and the sharpest design separately when they differ', () => {
    const ledger = readResolution(record);
    expect(ledger.largest?.arm).toBe('linked');
    expect(ledger.sharpest?.artefact).toBe('train.json');
  });

  it('counts rows that are both undecided and under a point', () => {
    const ledger = readResolution([read('dev.json', 'dev', 'full', 'none', 1534, 40, 47)]);
    expect(ledger.quiet).toBe(1);
  });

  it('does not call a decided row quiet even when its effect is small', () => {
    // 0.06pp decided is a contradiction the arithmetic cannot produce, so the fixture is a lie on
    // purpose: what is under test is that `quiet` reads the decision and not only the magnitude.
    const liar: ArmReading = {
      ...read('a.json', 'dev', 'full', 'none', 100000, 30, 60),
      decided: true,
      deltaPp: -0.03,
    };
    expect(readResolution([liar]).quiet).toBe(0);
  });

  it('reports an empty record as empty rather than as zero decided of zero', () => {
    const ledger = readResolution([]);
    expect(ledger.rows).toBe(0);
    expect(ledger.largest).toBeNull();
    expect(ledger.sharpest).toBeNull();
    expect(ledger.artefacts).toBe(0);
  });
});

describe('replication across runs', () => {
  it('groups by contrast name and sorts the loudest replication first', () => {
    const groups = replicationsOf([
      read('a.json', 'dev', 'full', 'none', 1534, 47, 68),
      read('b.json', 'train', 'full', 'none', 7000, 190, 240),
      read('c.json', 'mini', 'values', 'full', 350, 28, 9),
    ]);
    expect(groups[0]?.contrast).toBe('full − none');
    expect(groups[0]?.readings).toHaveLength(2);
    expect(groups[0]?.readings[0]?.n).toBe(1534);
  });

  it('refuses to call one decided run a replication', () => {
    const groups = replicationsOf([read('mini.json', 'mini', 'linked', 'none', 350, 8, 35)]);
    expect(groups[0]?.decided).toBe(1);
    expect(groups[0]?.decidedAgree).toBeNull();
  });

  it('says so when two decided runs disagree about direction', () => {
    const groups = replicationsOf([
      read('mini.json', 'mini', 'full', 'none', 350, 30, 5),
      read('dev.json', 'dev', 'full', 'none', 1534, 20, 120),
    ]);
    expect(groups[0]?.decided).toBe(2);
    expect(groups[0]?.decidedAgree).toBe(false);
    expect(groups[0]?.positive).toBe(1);
    expect(groups[0]?.negative).toBe(1);
  });

  it('says so when two decided runs agree, which is the only case a reader may quote', () => {
    const groups = replicationsOf([
      read('mini.json', 'mini', 'linked', 'none', 350, 8, 35),
      read('dev.json', 'dev', 'linked', 'none', 1534, 24, 166),
    ]);
    expect(groups[0]?.decidedAgree).toBe(true);
  });

  it('marks a contrast on which nothing was ever decided', () => {
    const groups = replicationsOf([
      read('a.json', 'dev', 'full', 'none', 1534, 47, 68),
      read('b.json', 'train', 'full', 'none', 7000, 190, 240),
    ]);
    expect(groups[0]?.allUndecided).toBe(true);
    expect(groups[0]?.decided).toBe(0);
  });

  it('breaks a tie on sample size by artefact name, so the order is stable between runs', () => {
    // Two runs of the same size otherwise sort by whatever the filesystem returned, and an artefact
    // whose row order changes between machines is an artefact nobody can diff.
    const groups = replicationsOf([
      read('z.json', 'mini', 'full', 'none', 350, 10, 24),
      read('a.json', 'mini', 'full', 'none', 350, 12, 26),
    ]);
    expect(groups[0]?.readings.map((one) => one.artefact)).toEqual(['a.json', 'z.json']);
  });

  it('breaks a tie on run count by contrast name', () => {
    const groups = replicationsOf([
      read('a.json', 'dev', 'full', 'none', 1534, 47, 68),
      read('b.json', 'dev', 'linked', 'none', 1534, 24, 166),
    ]);
    expect(groups.map((one) => one.contrast)).toEqual(['full − none', 'linked − none']);
  });

  it('does not pool runs: three runs stay three rows', () => {
    const groups = replicationsOf([
      read('a.json', 'mini', 'full', 'none', 350, 10, 24),
      read('b.json', 'dev', 'full', 'none', 1534, 47, 68),
      read('c.json', 'train', 'full', 'none', 7000, 190, 240),
    ]);
    expect(groups[0]?.readings.map((one) => one.n)).toEqual([350, 1534, 7000]);
  });
});

describe('shrinkage across sample sizes', () => {
  it('skips a contrast measured at one size, because one size has no direction', () => {
    expect(shrinkageOf([read('a.json', 'dev', 'full', 'none', 1534, 47, 68)])).toEqual([]);
  });

  it('reports a fall when the median magnitude is smaller on the bigger sample', () => {
    const groups = shrinkageOf([
      read('m1.json', 'mini', 'full', 'none', 350, 10, 24),
      read('m2.json', 'mini', 'full', 'none', 350, 12, 26),
      read('d1.json', 'dev', 'full', 'none', 1534, 47, 68),
    ]);
    expect(groups[0]?.direction).toBe('fell');
    expect(groups[0]?.points.map((point) => point.rows)).toEqual([2, 1]);
  });

  it('reports a rise rather than forcing the shrinage story', () => {
    // `linked` is the record's counter-example: 7.71pp on 350 questions, 9.26pp on 1,534. A reader
    // must be able to quote this one as confirmed rather than dissolved.
    const groups = shrinkageOf([
      read('m.json', 'mini', 'linked', 'none', 350, 8, 35),
      read('d.json', 'dev', 'linked', 'none', 1534, 24, 166),
    ]);
    expect(groups[0]?.direction).toBe('rose');
  });

  it('reports a flat direction when the medians are equal', () => {
    const groups = shrinkageOf([
      read('m.json', 'mini', 'x', 'none', 350, 10, 10),
      read('d.json', 'dev', 'x', 'none', 1534, 40, 40),
    ]);
    expect(groups[0]?.direction).toBe('flat');
  });

  it('keeps the signed median beside the absolute one, because they differ when signs do', () => {
    const groups = shrinkageOf([
      read('a.json', 'mini', 'x', 'none', 350, 30, 5),
      read('b.json', 'mini', 'x', 'none', 350, 5, 30),
      read('c.json', 'dev', 'x', 'none', 1534, 10, 10),
    ]);
    expect(groups[0]?.points[0]?.medianPp).toBe(-7.1429);
    expect(groups[0]?.points[0]?.medianAbsPp).toBe(7.1429);
  });

  it('returns the lower of two middle values, so the median is always observed', () => {
    expect(median([1, 2, 100, 200])).toBe(2);
    expect(median([3])).toBe(3);
    expect(median([])).toBe(0);
  });
});

describe('what each design size buys', () => {
  it('groups the record by n and reports the middle floor', () => {
    const floors = designFloors([
      read('a.json', 'mini', 'x', 'none', 350, 10, 24),
      read('b.json', 'mini', 'y', 'none', 350, 40, 10),
      read('b2.json', 'mini', 'w', 'none', 350, 100, 60),
      read('c.json', 'dev', 'z', 'none', 1534, 47, 68),
    ]);
    expect(floors.map((floor) => floor.n)).toEqual([350, 1534]);
    expect(floors[0]?.rows).toBe(3);
    expect(floors[0]?.bestPp).toBeLessThan(floors[0]?.medianPp as number);
    expect(floors[0]?.medianPp).toBeLessThanOrEqual(floors[0]?.worstPp as number);
  });

  it('is empty for an empty record rather than a list of zero floors', () => {
    expect(designFloors([])).toEqual([]);
  });
});

describe('the three gates', () => {
  it('V69 passes when every published row reached the table', () => {
    expect(coverageGate({ published: 98, emitted: 98, artefacts: 20 }).pass).toBe(true);
  });

  it('V69 fails on a single dropped row, and says how many', () => {
    const gate = coverageGate({ published: 98, emitted: 97, artefacts: 20 });
    expect(gate.pass).toBe(false);
    expect(gate.detail).toContain('1 of 98');
  });

  it('V69 fails on an empty record, where "nothing dropped" would be vacuously true', () => {
    expect(coverageGate({ published: 0, emitted: 0, artefacts: 0 }).pass).toBe(false);
  });

  it('V69 fails when artefacts carried arms but no row came out', () => {
    const gate = coverageGate({ published: 4, emitted: 0, artefacts: 1 });
    expect(gate.pass).toBe(false);
    expect(gate.detail).toContain('4 of 4');
  });

  it('V70 passes on a reconciled record and names the first row that is not', () => {
    expect(reconcileGate([read('a.json', 'dev', 'full', 'none', 1000, 20, 10)]).pass).toBe(true);
    const broken = armReadingOf('a.json', 'dev', {
      arm: 'full', control: 'none', n: 1000, helped: 20, harmed: 10, foundPp: 9,
    });
    const gate = reconcileGate([broken]);
    expect(gate.pass).toBe(false);
    expect(gate.detail).toContain('full');
  });

  it('V70 fails on an empty record, because there is nothing to have reconciled', () => {
    expect(reconcileGate([]).pass).toBe(false);
  });

  it('V71 holds on the record it was written for', () => {
    expect(priceGate([
      read('a.json', 'dev', 'full', 'none', 1534, 47, 68),
      read('b.json', 'dev', 'linked', 'none', 1534, 24, 166),
    ]).pass).toBe(true);
  });

  it('V71 catches a row whose decision contradicts its own price', () => {
    const liar: ArmReading = {
      ...read('a.json', 'dev', 'full', 'none', 1534, 47, 68),
      decided: true,
    };
    const gate = priceGate([liar]);
    expect(gate.pass).toBe(false);
    expect(gate.detail).toContain('1 rows break the equivalence');
  });

  it('V71 catches a decided row with no price at all', () => {
    const liar: ArmReading = {
      ...read('a.json', 'dev', 'full', 'none', 1534, 47, 68),
      decided: true,
      requiredN: null,
    };
    expect(priceGate([liar]).pass).toBe(false);
  });

  it('V71 treats a zero-effect row as consistent when it was not decided', () => {
    const flat = read('a.json', 'dev', 'x', 'none', 1000, 10, 10);
    expect(flat.requiredN).toBeNull();
    expect(priceGate([flat]).pass).toBe(true);
  });

  it('V71 is advisory, and every other gate here blocks', () => {
    expect(priceGate([]).blocking).toBe(false);
    expect(reconcileGate([]).blocking).toBe(true);
    expect(coverageGate({ published: 0, emitted: 0, artefacts: 0 }).blocking).toBe(true);
  });

  it('V71 refuses an empty record', () => {
    expect(priceGate([]).pass).toBe(false);
  });
});
