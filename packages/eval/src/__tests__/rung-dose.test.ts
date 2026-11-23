/**
 * R201's dose–response, priced from artefacts that were already bought.
 *
 * The registered question is whether a gate that withholds packs *before* the episode is free, and the registered
 * reading is a curve: three margins that withhold ≈0%, ≈35% and ≈70% of packs, with the inert share and the bill as
 * the primary readings. The three margins do not need three dispatches — every fold this lane has bought carries a
 * `serveSweep` ladder, which prices each rung against the same episodes — so the curve exists and needs a reader
 * rather than a purchase.
 *
 * These tests pin the arithmetic at three levels: one fold, a pool, and the committed corpus against the ledger
 * that reads the same files.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  RUNG_DOSE_SCHEMA,
  doseFoldOf,
  dosePointLine,
  doseResponseOf,
  driftOfDose,
  parseRungDose,
  shippableLine,
  type DoseFold,
} from '../rung-dose.js';
import { headlineOf, ledgerOf, type PackLedger } from '../pack-ledgers.js';

function fold(
  artefact: string,
  trials: number,
  rows: readonly Partial<DoseFold['rows'][number]>[],
): DoseFold {
  return {
    artefact,
    treatment: 'unit=correction',
    trials,
    rows: rows.map((row) => ({ rung: 0, served: trials, withheld: 0, kept: 0, broke: 0, ...row })),
  };
}

/** One fold whose ladder is the shape a real one has: rung 0 serves everything, later rungs withhold. */
const LADDER = fold('a.json', 10, [
  { rung: 0, served: 10, withheld: 0, kept: 4, broke: 6 },
  { rung: 0.05, served: 8, withheld: 2, kept: 3, broke: 4 },
  { rung: 0.1, served: 6, withheld: 4, kept: 2, broke: 2 },
]);

describe('doseResponseOf', () => {
  it('prices every rung of one fold, with rung 0 as the ungated corpus', () => {
    const outcome = doseResponseOf([LADDER]);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.dose.corpus).toEqual({ trials: 10, repairs: 4, breaks: 6, folds: 1 });
    const zero = outcome.dose.points[0]!;
    expect(zero).toMatchObject({
      rung: 0,
      served: 10,
      withheld: 0,
      kept: 4,
      broke: 6,
      prevented: 0,
      lostRepairs: 0,
      netPp: -20,
    });
    // `inertServed` is the ledger's reading — the share of packs that survived and changed nothing — and
    // `inertAll` is the gate's, which counts a withheld pack as inert because withholding cannot change a verdict
    // the pack did not change. They differ by construction, and the difference is what a gate reports.
    expect(zero.inertServed).toBeCloseTo(0, 10);
    expect(zero.inertAll).toBeCloseTo(0, 10);
  });

  it('states what each later rung keeps and prevents, against the corpus at rung 0', () => {
    const outcome = doseResponseOf([LADDER]);
    if (!outcome.ok) throw new Error(outcome.refusals.join(' | '));
    const mid = outcome.dose.points[1]!;
    expect(mid).toMatchObject({ rung: 0.05, served: 8, withheld: 2, kept: 3, broke: 4, prevented: 2, lostRepairs: 1 });
    expect(mid.retention).toBeCloseTo(3 / 4, 10);
    expect(mid.prevention).toBeCloseTo(2 / 6, 10);
    // 2/6 prevented against 1/4 lost: this rung withholds breaks faster than it loses repairs.
    expect(mid.selectivity).toBeCloseTo(2 / 6 - 1 / 4, 10);
    // Inert *among served* is 1 of 8 here (3 kept + 4 broke leave one unchanged), while the gate's own reading is
    // 3 of 10 — that same one plus the two trials the rung withheld, which join it by construction. The gap is the
    // whole reason both columns exist: only the first can say whether the rung selected on inertness.
    expect(mid.inertServed).toBeCloseTo(1 / 8, 10);
    expect(mid.inertAll).toBeCloseTo(3 / 10, 10);
  });

  it('pools two folds at every rung, and states the corpus once', () => {
    const other = fold('b.json', 30, [
      { rung: 0, served: 30, withheld: 0, kept: 0, broke: 3 },
      { rung: 0.05, served: 24, withheld: 6, kept: 0, broke: 1 },
      { rung: 0.1, served: 18, withheld: 12, kept: 0, broke: 0 },
    ]);
    const outcome = doseResponseOf([LADDER, other]);
    if (!outcome.ok) throw new Error(outcome.refusals.join(' | '));
    expect(outcome.dose.corpus).toEqual({ trials: 40, repairs: 4, breaks: 9, folds: 2 });
    expect(outcome.dose.points.map((point) => point.served)).toEqual([40, 32, 24]);
    expect(outcome.dose.points.map((point) => point.broke)).toEqual([9, 5, 2]);
    expect(outcome.dose.points.map((point) => point.prevented)).toEqual([0, 4, 7]);
  });

  it('refuses a corpus with no fold, because an empty curve has no rung', () => {
    expect(doseResponseOf([])).toEqual({
      ok: false,
      refusals: ['a dose–response needs a fold: an empty corpus prices no rung'],
    });
  });

  it('refuses a fold that carries no ladder, and names it', () => {
    const empty = fold('quiet.json', 10, []);
    const outcome = doseResponseOf([empty]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.refusals[0]).toContain('quiet.json: carries no rung rows, so it prices nothing');
  });

  it('refuses a fold whose trials count is zero, because no share would have a denominator', () => {
    const outcome = doseResponseOf([fold('empty.json', 0, [{ rung: 0, served: 0, withheld: 0, kept: 0, broke: 0 }])]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.refusals[0]).toContain('empty.json: trials is 0');
  });

  it('refuses a rung whose withheld count is not trials minus served', () => {
    const outcome = doseResponseOf([fold('bad.json', 10, [{ rung: 0.05, served: 8, withheld: 3, kept: 1, broke: 1 }])]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.refusals[0]).toContain('bad.json: rung 0.05 says 3 withheld');
  });

  it('refuses a rung that keeps and breaks more trials than it served', () => {
    const outcome = doseResponseOf([fold('bad.json', 10, [{ rung: 0.05, served: 2, withheld: 8, kept: 2, broke: 1 }])]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.refusals[0]).toContain('bad.json: rung 0.05 engages 3 trial(s) of 2 served');
  });

  it('refuses a ladder that names one rung twice', () => {
    const outcome = doseResponseOf([
      fold('twice.json', 10, [
        { rung: 0.1, served: 6, withheld: 4, kept: 1, broke: 1 },
        { rung: 0.1, served: 5, withheld: 5, kept: 1, broke: 1 },
      ]),
    ]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.refusals[0]).toContain('twice.json: rung 0.1 appears twice');
  });

  it('refuses to pool folds whose ladders do not cover the same rungs', () => {
    const short = fold('short.json', 10, [{ rung: 0, served: 10, withheld: 0, kept: 1, broke: 1 }]);
    const outcome = doseResponseOf([LADDER, short]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.refusals.join(' ')).toContain('short.json does not carry rung 0.05');
  });

  it('states a share with no denominator as zero rather than as a division', () => {
    // A corpus with no repair and a corpus with no break are both legal — they are what a memory that never helps
    // and a memory that never harms look like — and `kept / 0` would be `NaN`, which prints as a number in a JSON
    // record and reads as one in a report. The last rung serves nothing at all, which is the third case: the
    // ledger's column has no denominator, while the gate's still does.
    const harmless = fold('harmless.json', 10, [
      { rung: 0, served: 10, withheld: 0, kept: 0, broke: 0 },
      { rung: 0.1, served: 0, withheld: 10, kept: 0, broke: 0 },
    ]);
    const outcome = doseResponseOf([harmless]);
    if (!outcome.ok) throw new Error(outcome.refusals.join(' | '));
    expect(outcome.dose.points.map((point) => point.retention)).toEqual([0, 0]);
    expect(outcome.dose.points.map((point) => point.prevention)).toEqual([0, 0]);
    expect(outcome.dose.points[1]).toMatchObject({ served: 0, inertServed: 0, inertAll: 1, netPp: 0 });
    // And selectivity is `null` rather than `-100pp`: the corpus repaired nothing, so there is no repair to lose and
    // no denominator for the comparison. A `-1` here would read as the strongest possible finding about a gate on
    // the strength of an empty column.
    expect(outcome.dose.points.map((point) => point.selectivity)).toEqual([null, null]);
    expect(dosePointLine(outcome.dose.points[1]!)).toContain('selectivity n/a');
  });

  it('refuses a corpus whose ladder never prices rung 0, because nothing is a baseline', () => {
    const outcome = doseResponseOf([fold('late.json', 10, [{ rung: 0.1, served: 6, withheld: 4, kept: 1, broke: 1 }])]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.refusals[0]).toContain('no fold prices rung 0');
  });

  it('names the lowest rung that keeps the repairs it must and prevents the breaks it must', () => {
    const outcome = doseResponseOf([LADDER]);
    if (!outcome.ok) throw new Error(outcome.refusals.join(' | '));
    // R201's registered thresholds: ≥4 repairs kept and ≥4 breaks prevented. This ladder prevents at most 4, and
    // only at its last rung, where it keeps 2 — so no rung qualifies and the curve says so rather than quoting the
    // rung with the best delta.
    expect(outcome.dose.shippable).toBeNull();
    expect(outcome.dose.gates).toEqual({ minRepairs: 4, minPrevented: 4 });
  });

  it('accepts a rung exactly at both thresholds, and prefers the lowest such rung', () => {
    const wide = fold('wide.json', 40, [
      { rung: 0, served: 40, withheld: 0, kept: 10, broke: 20 },
      { rung: 0.05, served: 30, withheld: 10, kept: 8, broke: 14 },
      { rung: 0.1, served: 20, withheld: 20, kept: 4, broke: 4 },
      { rung: 0.2, served: 10, withheld: 30, kept: 0, broke: 0 },
    ]);
    const outcome = doseResponseOf([wide]);
    if (!outcome.ok) throw new Error(outcome.refusals.join(' | '));
    // Two rungs qualify — 0.05 (8 kept, 6 prevented) and 0.1 (4 kept, 16 prevented) — and the module names the
    // **lowest**, because a curve's later rungs always look better on harm and worse on value, and a gate chosen by
    // its best cell would be the rung that withholds everything: the last row here keeps nothing and prevents 20.
    expect(outcome.dose.shippable).toEqual({ rung: 0.05, kept: 8, prevented: 6 });
  });

  it('takes the thresholds as parameters, because a gate is priced against a corpus', () => {
    const outcome = doseResponseOf([LADDER], { minRepairs: 2, minPrevented: 2 });
    if (!outcome.ok) throw new Error(outcome.refusals.join(' | '));
    expect(outcome.dose.gates).toEqual({ minRepairs: 2, minPrevented: 2 });
    // With both thresholds at 2 the same corpus qualifies one rung earlier, which is the point of the parameter:
    // the acceptance is a price, and a different price names a different rung.
    expect(outcome.dose.shippable).toEqual({ rung: 0.05, kept: 3, prevented: 2 });
  });
});

describe('doseFoldOf', () => {
  const artefact = (sweep: unknown): unknown => ({ serveSweep: sweep });

  it('reads the ladder an artefact carries', () => {
    const read = doseFoldOf(
      artefact({
        trials: 2,
        rows: [
          { rung: 0, served: 2, withheld: 0, kept: 1, broke: 1 },
          { rung: 0.1, served: 1, withheld: 1, kept: 0, broke: 1 },
        ],
      }),
      'fold.json',
    );
    expect(read.problems).toEqual([]);
    expect(read.fold?.trials).toBe(2);
    expect(read.fold?.rows).toHaveLength(2);
  });

  it('says which part of the block it could not read', () => {
    expect(doseFoldOf({}, 'fold.json').problems).toEqual(['fold.json: no serveSweep block']);
    expect(doseFoldOf(null, 'fold.json').problems).toEqual(['fold.json: no serveSweep block']);
    expect(doseFoldOf(artefact({ trials: 2 }), 'fold.json').problems[0]).toContain('carries no rung rows');
    expect(doseFoldOf(artefact({ trials: 2, rows: {} }), 'fold.json').problems[0]).toContain('carries no rung rows');
    expect(doseFoldOf(artefact({ trials: 2, rows: [null] }), 'fold.json').problems[0]).toContain('row 0 is not an object');
    expect(doseFoldOf(artefact({ trials: 2, rows: [{ rung: '0.1' }] }), 'fold.json').problems[0]).toContain(
      'row 0 has no rung',
    );
    expect(
      doseFoldOf(artefact({ trials: 2, rows: [{ rung: 0.1 }] }), 'fold.json').problems.join(' '),
    ).toContain('is not a count');
    expect(doseFoldOf(artefact({ trials: -1, rows: [] }), 'fold.json').problems.join(' ')).toContain('trials is not a count');
  });
});

describe('the committed corpus, priced', () => {
  const sources = readdirSync(join(process.cwd(), 'eval/results'))
    .filter((name) => name.startsWith('poc-l4-pair') && name.endsWith('.json'))
    .sort()
    .map((name) => ({
      path: `eval/results/${name}`,
      artefact: JSON.parse(readFileSync(join(process.cwd(), 'eval/results', name), 'utf8')) as unknown,
    }));

  const folds: DoseFold[] = [];
  for (const source of sources) {
    const read = doseFoldOf(source.artefact, source.path);
    if (read.fold !== undefined) folds.push(read.fold);
  }

  it('reads every committed fold’s ladder', () => {
    // One ladder per committed fold, and the count is the corpus rather than a constant: R198's fold is the sixth,
    // and a test that pinned five would have to be edited by every dispatch that adds one.
    expect(folds).toHaveLength(sources.length);
    expect(folds.length).toBeGreaterThanOrEqual(6);
  });

  it('reproduces the ledger at rung 0, which is the check that the two readers see one corpus', () => {
    const dose = doseResponseOf(folds);
    if (!dose.ok) throw new Error(dose.refusals.join(' | '));
    const ledgers: readonly PackLedger[] = sources.map((source) => {
      const read = ledgerOf(source.artefact, source.path);
      if (!read.ok) throw new Error(read.problems.join(' | '));
      return read.ledger;
    });
    const zero = dose.dose.points[0]!;
    expect(zero.served).toBe(ledgers.reduce((total, ledger) => total + ledger.renders, 0));
    expect(zero.kept).toBe(ledgers.reduce((total, ledger) => total + ledger.repaired, 0));
    expect(zero.broke).toBe(ledgers.reduce((total, ledger) => total + ledger.broke, 0));
    expect(zero.netPp).toBeCloseTo(headlineOf(ledgers).deltaPp, 6);
    expect(zero.inertAll).toBeCloseTo(headlineOf(ledgers).inertShare, 6);
  });

  it('holds the committed record against the artefacts it was derived from', () => {
    const committed = parseRungDose(JSON.parse(readFileSync(join(process.cwd(), 'eval/results/rung-dose.json'), 'utf8')));
    if (committed.record === undefined) throw new Error(committed.refusals.join(' | '));
    const fresh = doseResponseOf(folds);
    if (!fresh.ok) throw new Error(fresh.refusals.join(' | '));
    expect(driftOfDose(committed.record, fresh.dose)).toEqual([]);
  });
});

describe('the record as a file', () => {
  it('refuses a schema it does not know, rather than reading it as this one', () => {
    const read = parseRungDose({ schema: 'microglia.rung-dose/0' });
    expect(read.record).toBeUndefined();
    expect(read.refusals.join(' ')).toContain('microglia.rung-dose/0');
  });

  it('refuses a record that is not an object at all', () => {
    expect(parseRungDose(null).refusals).toEqual(['the record is not an object']);
    expect(parseRungDose([]).refusals).toEqual(['the record is not an object']);
  });

  it('refuses a record whose points are not a list of rungs', () => {
    expect(parseRungDose({ schema: RUNG_DOSE_SCHEMA }).refusals[0]).toContain('points');
    expect(parseRungDose({ schema: RUNG_DOSE_SCHEMA, points: [null] }).refusals[0]).toContain('point 0');
    expect(
      parseRungDose({ schema: RUNG_DOSE_SCHEMA, points: [{ rung: 'zero' }] }).refusals[0],
    ).toContain('point 0 has no rung');
    expect(
      parseRungDose({ schema: RUNG_DOSE_SCHEMA, points: [{ rung: 0 }] }).refusals[0],
    ).toContain('point 0 is missing');
  });

  it('names the rung that moved when the committed record drifts', () => {
    const fresh = doseResponseOf([LADDER]);
    if (!fresh.ok) throw new Error(fresh.refusals.join(' | '));
    const moved = { ...fresh.dose, points: fresh.dose.points.map((point) => ({ ...point, kept: point.kept + 1 })) };
    expect(driftOfDose(moved, fresh.dose)[0]).toContain('rung 0');
    const shrunk = { ...fresh.dose, corpus: { ...fresh.dose.corpus, folds: 2 } };
    expect(driftOfDose(shrunk, fresh.dose)[0]).toContain('corpus');
    const fewer = { ...fresh.dose, points: fresh.dose.points.slice(0, 1) };
    expect(driftOfDose(fewer, fresh.dose)[0]).toContain('rung 0.05');
    const gateMoved = { ...fresh.dose, gates: { minRepairs: 1, minPrevented: 1 } };
    expect(driftOfDose(gateMoved, fresh.dose)[0]).toContain('threshold');
    const verdictMoved = { ...fresh.dose, shippable: { rung: 0.1, kept: 1, prevented: 1 } };
    expect(driftOfDose(verdictMoved, fresh.dose)[0]).toContain('verdict');
    // A rung the committed record prices and the artefacts no longer do: the fold it came from was replaced, so
    // the record is quoting a curve that no committed artefact contains.
    const dropped = { ...fresh.dose, points: fresh.dose.points.filter((point) => point.rung !== 0.05) };
    expect(driftOfDose(fresh.dose, dropped)[0]).toContain('rung 0.05 is no longer priced');
  });
});

describe('the lines', () => {
  it('prints a negative selectivity, which is the shape a rung that selects the wrong way has', () => {
    // Repairing packs withheld faster than breaking ones: prevention 1/6 against a retention of 0. The line has to
    // print the sign, because `selectivity 16.7pp` and `selectivity -16.7pp` are opposite findings about one rung.
    const wrong = fold('wrong.json', 10, [
      { rung: 0, served: 10, withheld: 0, kept: 4, broke: 6 },
      { rung: 0.1, served: 5, withheld: 5, kept: 0, broke: 5 },
    ]);
    const outcome = doseResponseOf([wrong]);
    if (!outcome.ok) throw new Error(outcome.refusals.join(' | '));
    expect(outcome.dose.points[1]!.selectivity).toBeLessThan(0);
    expect(dosePointLine(outcome.dose.points[1]!)).toContain('selectivity -');
  });

  it('prints a rung as one sentence a log can be grepped for', () => {
    const outcome = doseResponseOf([LADDER]);
    if (!outcome.ok) throw new Error(outcome.refusals.join(' | '));
    const line = dosePointLine(outcome.dose.points[1]!);
    expect(line).toContain('rung 0.05');
    expect(line).toContain('8 served, 2 withheld');
    expect(line).toContain('3 kept, 4 broke');
  });

  it('prints the verdict, or says no rung qualified', () => {
    const refused = doseResponseOf([LADDER]);
    if (!refused.ok) throw new Error(refused.refusals.join(' | '));
    expect(shippableLine(refused.dose)).toContain('no rung keeps 4 repair(s)');

    const wide = fold('wide.json', 40, [
      { rung: 0, served: 40, withheld: 0, kept: 10, broke: 20 },
      { rung: 0.1, served: 20, withheld: 20, kept: 4, broke: 4 },
    ]);
    const accepted = doseResponseOf([wide]);
    if (!accepted.ok) throw new Error(accepted.refusals.join(' | '));
    expect(shippableLine(accepted.dose)).toContain('rung 0.1 keeps 4 repair(s) and prevents 16 break(s)');
  });
});
