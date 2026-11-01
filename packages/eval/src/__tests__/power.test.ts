import { describe, expect, it } from 'vitest';
import { HALF_WIDTH_Z, pairedWidths, powerOf, readPower, type PairedCase, type PowerRow } from '../power.js';

const cases = (helped: number, harmed: number, concordant: number): PairedCase[] => [
  ...Array.from({ length: helped }, () => ({ correct: true, withoutMemoryCorrect: false })),
  ...Array.from({ length: harmed }, () => ({ correct: false, withoutMemoryCorrect: true })),
  ...Array.from({ length: concordant }, () => ({ correct: true, withoutMemoryCorrect: true })),
];

const row = (artefact: string, helped: number, harmed: number, concordant: number): PowerRow =>
  powerOf(artefact, cases(helped, harmed, concordant));

describe('pairedWidths', () => {
  it('is null for an empty sample rather than a measured zero', () => {
    expect(pairedWidths(0, 0, 0)).toBeNull();
  });

  it('counts only the discordant pairs in the standard error', () => {
    // Ten helped and ten harmed out of two hundred: the concordant 180 carry no information about
    // the difference, and a width computed over all two hundred would understate the interval by
    // the ratio of the two square roots.
    const widths = pairedWidths(10, 10, 200);
    expect(widths?.deltaPp).toBe(0);
    expect(widths?.halfWidthPp).toBeCloseTo(HALF_WIDTH_Z * (Math.sqrt(20) / 200) * 100, 10);
    expect(widths?.minDetectablePp).toBeCloseTo(2.802 * (Math.sqrt(20) / 200) * 100, 10);
  });

  it('makes the minimum detectable difference wider than the interval, every time', () => {
    // 2.802 / 1.96 = 1.43, and a pair of numbers that agreed here would mean one of the two
    // constants had been swapped for the other somewhere upstream.
    for (const [helped, harmed, n] of [
      [10, 27, 350],
      [67, 62, 1534],
      [1, 0, 4],
    ] as const) {
      const widths = pairedWidths(helped, harmed, n);
      expect(widths?.minDetectablePp).toBeCloseTo((2.802 / HALF_WIDTH_Z) * (widths as { halfWidthPp: number }).halfWidthPp, 10);
    }
  });

  it('reports an infinite minimum detectable difference when nothing changed hands', () => {
    const widths = pairedWidths(0, 0, 100);
    expect(widths?.deltaPp).toBe(0);
    expect(widths?.halfWidthPp).toBe(0);
    expect(widths?.minDetectablePp).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('powerOf', () => {
  it('tallies the pairs that changed hands and ignores the ones that did not', () => {
    const entry = row('a.json', 10, 27, 313);
    expect(entry.n).toBe(350);
    expect(entry.helped).toBe(10);
    expect(entry.harmed).toBe(27);
    expect(entry.deltaPp).toBeCloseTo((10 - 27) / 350 * 100, 10);
  });

  it('refuses an artefact with no paired cases instead of publishing a row of zeros', () => {
    expect(() => powerOf('empty.json', [])).toThrow(/no paired cases/);
  });

  it('separates the two bars on a row that beats one and not the other', () => {
    // The evidence artefact: −4.86pp against a 3.41pp half-width and a 4.87pp minimum detectable
    // difference. It is inside the 95% interval's reach and just outside the 80%-power bar, and a
    // single flag would have had to be wrong about one of the two.
    const entry = row('evidence.json', 10, 27, 313);
    expect(entry.significant95).toBe(true);
    expect(entry.resolvable).toBe(false);
  });

  it('calls a row resolvable only when it beats both bars', () => {
    const entry = row('transfer.json', 8, 24, 318);
    expect(entry.significant95).toBe(true);
    expect(entry.resolvable).toBe(true);
  });

  it('calls a small effect on a large sample unresolvable, which is the finding', () => {
    // Sixty-seven against sixty-two over 1,534 questions: the record's best-measured positive
    // effect, and its own resolution is wider than the effect.
    const entry = row('dev.json', 67, 62, 1405);
    expect(entry.deltaPp).toBeCloseTo(0.3259, 4);
    expect(entry.resolvable).toBe(false);
    expect(entry.significant95).toBe(false);
  });

  it('is symmetric in sign, so a harm and a help of the same size flag identically', () => {
    const help = row('h.json', 27, 10, 313);
    const harm = row('d.json', 10, 27, 313);
    expect(help.resolvable).toBe(harm.resolvable);
    expect(help.significant95).toBe(harm.significant95);
    expect(help.deltaPp).toBeCloseTo(-(harm.deltaPp), 10);
  });
});

describe('readPower', () => {
  it('reports an empty record without inventing a largest row', () => {
    const summary = readPower([]);
    expect(summary.rows).toEqual([]);
    expect(summary.resolvable).toBe(0);
    expect(summary.significant95).toBe(0);
    expect(summary.total).toBe(0);
    expect(summary.largest).toBeNull();
    expect(summary.sharpest).toBeNull();
  });

  it('keeps the largest claim and the sharpest design as separate rows', () => {
    // The distinction the summary exists for: the record's biggest number and its best instrument
    // were never the same artefact, and one field could only have reported one of them.
    const rows = [row('small-n.json', 10, 27, 313), row('big-n.json', 67, 62, 1405)];
    const summary = readPower(rows);
    expect(summary.largest?.artefact).toBe('small-n.json');
    expect(summary.sharpest?.artefact).toBe('big-n.json');
    expect(summary.total).toBe(2);
  });

  it('counts both bars independently', () => {
    const rows = [
      row('resolvable.json', 8, 24, 318),
      row('significant-only.json', 10, 27, 313),
      row('neither.json', 10, 12, 328),
    ];
    const summary = readPower(rows);
    expect(summary.resolvable).toBe(1);
    expect(summary.significant95).toBe(2);
    expect(summary.total).toBe(3);
  });

  it('breaks a tie at the first row, so a recomputation of the same record agrees', () => {
    const rows = [row('a.json', 10, 27, 313), row('b.json', 10, 27, 313)];
    expect(readPower(rows).largest?.artefact).toBe('a.json');
  });
});
