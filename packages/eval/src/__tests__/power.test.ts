import { describe, expect, it } from 'vitest';
import {
  HALF_WIDTH_Z,
  pairedWidths,
  pairRowOf,
  pairedWidths,
  powerFromComparison,
  powerFromCounts,
  powerOf,
  readPower,
  scoreHalfWidthPp,
  type PairedCase,
  type PowerRow,
} from '../power.js';

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

describe('powerFromCounts', () => {
  it('reaches the same row as the per-case route, from the counts a pair artefact carries', () => {
    // The τ² lane's pair artefact stores `lost`/`gained`/`paired` rather than per-question outcomes,
    // because the τ² agent owns the questions and reports totals. Two routes to one row are only
    // safe if they agree, so this is the assertion that keeps them agreeing.
    const fromCases = powerOf('a.json', cases(10, 27, 313));
    const fromCounts = powerFromCounts('a.json', { helped: 10, harmed: 27, n: 350 });
    expect(fromCounts).toEqual(fromCases);
  });

  it('refuses an empty sample rather than publishing a row of zeros', () => {
    expect(() => powerFromCounts('empty.json', { helped: 0, harmed: 0, n: 0 })).toThrow(/no pairs/);
  });

  it('refuses counts that cannot come from one sample', () => {
    // A pair artefact whose tallies exceed its own sample is not a row this audit may publish: the
    // arithmetic would still produce a number, and the number would be about nothing.
    expect(() => powerFromCounts('bad.json', { helped: 60, harmed: 50, n: 100 })).toThrow(/exceed/);
    expect(() => powerFromCounts('bad.json', { helped: -1, harmed: 0, n: 10 })).toThrow(/negative/);
  });

  it('reads the τ² lane at the resolution it actually has', () => {
    // The number this audit did not carry until now: thirteen lost, fourteen gained over sixty-eight
    // paired tasks is a 21.4pp design, five times coarser than the loosest BIRD row.
    const entry = powerFromCounts('poc-l4-pair.json', { helped: 14, harmed: 13, n: 68 });
    expect(entry.deltaPp).toBeCloseTo(1.4706, 4);
    expect(entry.minDetectablePp).toBeCloseTo(21.4112, 3);
    expect(entry.resolvable).toBe(false);
    expect(entry.significant95).toBe(false);
  });
});

describe('readPower, the coarsest design', () => {
  it('is null on an empty record', () => {
    expect(readPower([]).coarsest).toBeNull();
  });

  it('names the design that could resolve the least, which is not the sharpest one', () => {
    const rows = [
      row('bird.json', 10, 27, 313),
      powerFromCounts('tau2.json', { helped: 14, harmed: 13, n: 68 }),
    ];
    const summary = readPower(rows);
    expect(summary.sharpest?.artefact).toBe('bird.json');
    expect(summary.coarsest?.artefact).toBe('tau2.json');
  });

  it('is the same row as the sharpest when the record holds one', () => {
    const summary = readPower([row('only.json', 10, 27, 313)]);
    expect(summary.coarsest?.artefact).toBe('only.json');
    expect(summary.sharpest?.artefact).toBe('only.json');
  });

  it('breaks a tie at the first row, so a recomputation of the same record agrees', () => {
    const rows = [row('a.json', 10, 27, 313), row('b.json', 10, 27, 313)];
    expect(readPower(rows).coarsest?.artefact).toBe('a.json');
  });
});

describe('powerFromComparison', () => {
  const block = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    paired: 68,
    lost: 13,
    gained: 14,
    deltaPp: 1.4705882352941175,
    ...over,
  });

  it('reads a file that agrees with its own delta', () => {
    const entry = powerFromComparison('poc-l4-pair.json', block());
    expect(entry.n).toBe(68);
    expect(entry.helped).toBe(14);
    expect(entry.harmed).toBe(13);
    expect(entry.minDetectablePp).toBeCloseTo(21.4112, 3);
  });

  it('refuses a file whose two sides are the wrong way round', () => {
    // The sign of a paired delta is the whole claim. A file that wrote `gained`/`lost` swapped would
    // still produce a row, and every downstream reader would quote the opposite direction.
    expect(() => powerFromComparison('swapped.json', block({ gained: 13, lost: 14 }))).toThrow(
      /the wrong way round/,
    );
  });

  it('accepts a file that states no delta of its own, because the counts are the evidence', () => {
    const entry = powerFromComparison('counts-only.json', block({ deltaPp: undefined }));
    expect(entry.deltaPp).toBeCloseTo(1.4706, 4);
  });

  it('refuses a comparison block missing one of the three counts', () => {
    // Not skipped: a file that looks paired and is not must not silently leave the audit.
    for (const missing of ['paired', 'lost', 'gained'] as const) {
      expect(() => powerFromComparison('partial.json', block({ [missing]: undefined }))).toThrow(
        new RegExp(missing),
      );
    }
  });

  it('tolerates a delta rounded to the precision an artefact usually carries', () => {
    // A file that wrote `1.47` is counting the same pairs, and refusing it would make the audit
    // fail on formatting rather than on arithmetic.
    expect(powerFromComparison('rounded.json', block({ deltaPp: 1.47 })).n).toBe(68);
  });
});

describe('pairRowOf, the selector a directory scan needs', () => {
  const casesOf = (helped: number, harmed: number, concordant: number): PairedCase[] =>
    cases(helped, harmed, concordant);

  it('reads per-question outcomes when the artefact carries them', () => {
    const entry = pairRowOf('bird.json', { per_case: casesOf(8, 24, 318) });
    expect(entry?.n).toBe(350);
    expect(entry?.resolvable).toBe(true);
  });

  it('falls back to the comparison block when it does not', () => {
    const entry = pairRowOf('tau2.json', { comparison: { paired: 68, lost: 13, gained: 14 } });
    expect(entry?.n).toBe(68);
    expect(entry?.minDetectablePp).toBeCloseTo(21.4112, 3);
  });

  it('prefers the per-question route when both are present, because it is the raw data', () => {
    // A file carrying both is a file that measured the questions and summarised them, and the
    // summary must not become the evidence.
    const entry = pairRowOf('both.json', {
      per_case: casesOf(8, 24, 318),
      comparison: { paired: 68, lost: 13, gained: 14 },
    });
    expect(entry?.n).toBe(350);
  });

  it('leaves a file with neither shape out of the audit instead of refusing the whole run', () => {
    // A directory of artefacts holds many things; only a paired run has a delta to audit, and a
    // scan that threw on the first unpaired file would audit nothing at all.
    expect(pairRowOf('single-arm.json', {})).toBeNull();
    expect(pairRowOf('empty.json', { per_case: [] })).toBeNull();
  });

  it('leaves out a per_case list whose rows are not paired, because a name is not evidence', () => {
    expect(pairRowOf('unpaired.json', { per_case: [{ correct: true } as PairedCase] })).toBeNull();
  });

  it('refuses a comparison block that is missing a count, rather than skipping it', () => {
    expect(() => pairRowOf('partial.json', { comparison: { paired: 68, lost: 13 } })).toThrow(/gained/);
  });
});

describe('scoreHalfWidthPp, the ruler an absolute score is read with', () => {
  it('is the binomial half-width over tasks, which is a third of the paired floor', () => {
    // 0.55 on 40 tasks: +-15.42pp. The paired floor at the same n is 44.30pp, and the two numbers
    // are not interchangeable — one measures a score, the other a difference between two arms.
    expect(scoreHalfWidthPp(0.55, 40)).toBeCloseTo(15.42, 2);
    expect(scoreHalfWidthPp(0.5294, 68)).toBeCloseTo(11.86, 2);
  });

  it('is zero at a perfect or a null score, where there is no variance left to report', () => {
    expect(scoreHalfWidthPp(1, 40)).toBe(0);
    expect(scoreHalfWidthPp(0, 40)).toBe(0);
  });

  it('is infinite for no sample, because no score has a bound with nothing behind it', () => {
    expect(scoreHalfWidthPp(0.5, 0)).toBe(Number.POSITIVE_INFINITY);
  });

  it('says what it is given rather than quietly clamping a score that is not one', () => {
    expect(() => scoreHalfWidthPp(1.2, 40)).toThrow(/not a share/);
    expect(() => scoreHalfWidthPp(-0.1, 40)).toThrow(/not a share/);
    // A negative task count is not "no sample" and does not get the empty-sample answer.
    expect(() => scoreHalfWidthPp(0.5, -1)).toThrow(/not a number of tasks/);
  });

  it('is symmetric about a half, which is the same statement as a fair coin having no skew', () => {
    expect(scoreHalfWidthPp(0.3, 100)).toBeCloseTo(scoreHalfWidthPp(0.7, 100), 12);
  });

  it('shows that 0.70 does not clear a 0.575 bar on 40 tasks and 0.75 does', () => {
    // The arithmetic R119 is registered against, and the reason a point estimate is not a result.
    expect(0.70 - scoreHalfWidthPp(0.70, 40) / 100).toBeLessThan(0.575);
    expect(0.75 - scoreHalfWidthPp(0.75, 40) / 100).toBeGreaterThan(0.575);
  });
});

/**
 * R120 — the two refusals a `comparison` block earns, and the dead branch that used to sit between them.
 *
 * The missing-field guard was a loop over the three names, which throws for the reader and narrows
 * nothing for the compiler — so the function had to keep a second `throw` beneath it to make the types
 * line up, and that branch was unreachable by construction. The project's rule is that an unreachable
 * branch is deleted rather than exempted, and the version below meets it by writing the three guards
 * out. These two tests are the ones that would have caught the branch surviving: a block with no pairs
 * is refused by the width calculation, and a block missing one of its three counts is refused by name.
 */
describe('the refusals a comparison block earns', () => {
  it('refuses a block whose sample is empty, because it has no delta to audit', () => {
    // The refusal comes from the count guard, not from the width calculation: `pairedWidths` returns null
    // only when `n <= 0`, which this guard has already refused with the same sentence — so the second
    // `if (widths === null)` branch that used to sit here was unreachable twice over. It is deleted, and
    // this test is what stops it coming back: the sentence is still produced, once.
    expect(() =>
      powerFromComparison('empty.json', { paired: 0, lost: 0, gained: 0 }),
    ).toThrow(/has no pairs/);
    // The public nullable form still answers `null` for the same input, which is the shape a caller that
    // has *not* refused an empty sample needs.
    expect(pairedWidths(0, 0, 0)).toBeNull();
  });

  it('names the count a block is missing rather than reporting a type it never had', () => {
    for (const [over, name] of [
      [{ paired: undefined }, 'paired'],
      [{ lost: undefined }, 'lost'],
      [{ gained: undefined }, 'gained'],
    ] as const) {
      expect(() => powerFromComparison('thin.json', { paired: 68, lost: 13, gained: 14, ...over })).toThrow(
        new RegExp(`comparison' block without '${name}'`),
      );
    }
  });
});
