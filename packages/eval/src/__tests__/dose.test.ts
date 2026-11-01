import { describe, expect, it } from 'vitest';
import { DEFAULT_ADMISSION, admissionFloor, admitsAt, parseAdmissionPolicy } from '../dose.js';
import type { AdmissionSample } from '../dose.js';

const HELPS = (coverage: number): AdmissionSample => ({ coverage, credit: 'helped' });
const HARMS = (coverage: number): AdmissionSample => ({ coverage, credit: 'harmed' });
const FLAT = (coverage: number): AdmissionSample => ({ coverage, credit: 'uninformative' });

describe('a floor fitted on learning rows', () => {
  it('refuses to fit when there are no rows at all', () => {
    // The empty store. A fit over nothing that returned a number would be a threshold chosen by
    // the default value of a variable rather than by evidence.
    expect(admissionFloor([])).toEqual({
      floor: 0,
      kept: 0,
      total: 0,
      helped: 0,
      harmed: 0,
      reason: 'no-evidence',
    });
  });

  it('refuses to fit when the pairs were all uninformative', () => {
    // The realistic failure: 1,400 learning rows where the answer was the same with and without
    // the note, so no row can price a threshold. Reporting `fitted` with floor 0 here would make
    // an arm that never engaged admission indistinguishable from one that engaged it and kept
    // every question.
    const rows = Array.from({ length: 40 }, (_, i) => FLAT(i / 40));
    expect(admissionFloor(rows)).toEqual({
      floor: 0,
      kept: 40,
      total: 40,
      helped: 0,
      harmed: 0,
      reason: 'no-evidence',
    });
  });

  it('refuses to fit below its decisive floor', () => {
    // Seven decisive rows is inside the supply of a real fold but below the policy's floor, and
    // the two are different situations: `kept` and `total` stay honest about what was there.
    const rows = [...Array.from({ length: 93 }, (_, i) => FLAT(i / 93)), HELPS(0.1), HARMS(0.2)];
    const fit = admissionFloor(rows, { minKept: 0.5, minDecisive: 8 });
    expect(fit.reason).toBe('no-evidence');
    expect(fit.total).toBe(95);
    expect(fit.kept).toBe(95);
  });

  it('puts the floor where the net turns', () => {
    // Twenty rows: the low-coverage half is harmed and the high-coverage half is helped. The net
    // is maximised by keeping the top ten, so the floor is the lowest kept coverage.
    const rows = [
      ...Array.from({ length: 10 }, (_, i) => HARMS(i / 100)),
      ...Array.from({ length: 10 }, (_, i) => HELPS(0.5 + i / 100)),
    ];
    const fit = admissionFloor(rows, { minKept: 0.5, minDecisive: 8 });
    expect(fit.reason).toBe('fitted');
    expect(fit.floor).toBe(0.5);
    expect(fit.kept).toBe(10);
    expect(fit.helped).toBe(10);
    expect(fit.harmed).toBe(0);
  });

  it('will not buy a net with a population it was told to keep', () => {
    // The same rows under a policy that insists on keeping four fifths: the perfect floor keeps
    // half the rows and is refused, so the fit falls back to the best floor that keeps sixteen.
    const rows = [
      ...Array.from({ length: 10 }, (_, i) => HARMS(i / 100)),
      ...Array.from({ length: 10 }, (_, i) => HELPS(0.5 + i / 100)),
    ];
    const fit = admissionFloor(rows, { minKept: 0.8, minDecisive: 8 });
    expect(fit.reason).toBe('fitted');
    expect(fit.kept).toBeGreaterThanOrEqual(16);
    expect(fit.floor).toBeGreaterThan(0);
    expect(fit.floor).toBeLessThan(0.5);
  });

  it('says so when every candidate floor keeps too few', () => {
    // A policy that demands more than the population holds. The alternative readings are a floor
    // computed from nothing and a crash; both would hide that the arm was never a treatment.
    const rows = [HELPS(0.9), HELPS(0.8), HELPS(0.7)];
    const fit = admissionFloor(rows, { minKept: 2, minDecisive: 1 });
    expect(fit).toEqual({
      floor: 0,
      kept: 3,
      total: 3,
      helped: 0,
      harmed: 0,
      reason: 'nothing-kept',
    });
  });

  it('keeps everything when the best net is at the lowest coverage', () => {
    // A store whose notes are uniformly helpful. The fit should say "impose no floor", which is
    // an answer and not an absence: the arm then equals `full-one`, and the gate that reads
    // `reason` is what stops that from being published as a null result about admission.
    const rows = [HELPS(0.05), HELPS(0.2), HELPS(0.4), HELPS(0.6)];
    const fit = admissionFloor(rows, { minKept: 0.5, minDecisive: 1 });
    expect(fit.reason).toBe('fitted');
    expect(fit.floor).toBe(0.05);
    expect(fit.kept).toBe(4);
    expect(fit.helped).toBe(4);
  });

  it('resolves a tie towards showing the note', () => {
    // Two floors with the same net are the same evidence. The lower one asks the model to read
    // less of what it did not have, which is the direction the record's own dose curve favours.
    const rows = [
      HELPS(0.1),
      HARMS(0.2),
      HELPS(0.3),
      HARMS(0.4),
      HELPS(0.5),
      HARMS(0.6),
    ];
    const fit = admissionFloor(rows, { minKept: 0.5, minDecisive: 1 });
    // floor 0.1 keeps 6 rows, net 0; floor 0.3 keeps 4 rows, net 0 — equal nets, lower floor wins.
    expect(fit.floor).toBe(0.1);
    expect(fit.kept).toBe(6);
    expect(fit.helped - fit.harmed).toBe(0);
  });

  it('only ever returns a coverage that occurred', () => {
    // A floor interpolated between observations would be a threshold whose effect on the
    // population nobody computed. Every returned floor is one of the sampled coverages or zero.
    const rows = [HARMS(0.13), HARMS(0.31), HELPS(0.77), HELPS(0.91), HELPS(0.42)];
    const fit = admissionFloor(rows, { minKept: 0.2, minDecisive: 1 });
    expect([0.13, 0.31, 0.77, 0.91, 0.42, 0]).toContain(fit.floor);
  });

  it('counts the population over every row and the net over the decisive ones', () => {
    // The held-out questions have no credit by construction, so `kept` has to be the share of
    // *all* learning rows a floor would have shown a note to; only the decisive rows can price it.
    const rows = [FLAT(0.9), FLAT(0.9), HELPS(0.9), HARMS(0.1), FLAT(0.1), FLAT(0.1)];
    const fit = admissionFloor(rows, { minKept: 0.1, minDecisive: 1 });
    expect(fit.total).toBe(6);
    // Floor 0.9 keeps three rows and one decisive help, which beats every lower floor.
    expect(fit.floor).toBe(0.9);
    expect(fit.kept).toBe(3);
    expect(fit.helped).toBe(1);
    expect(fit.harmed).toBe(0);
  });

  it('carries the policy the pre-registration names', () => {
    // The defaults are part of the claim: a half of the population kept, eight decisive rows.
    expect(DEFAULT_ADMISSION).toEqual({ minKept: 0.5, minDecisive: 8 });
  });

  it('keeps a whole question when the share rounds to zero', () => {
    // A share small enough to round down is still a floor on a population, and a fit that could
    // keep nothing would divide by the empty set. `minKept: 0.001` on forty rows keeps one.
    const rows = [...Array.from({ length: 39 }, (_, i) => HELPS(0.9)), HARMS(0.1)];
    const fit = admissionFloor(rows, { minKept: 0.001, minDecisive: 1 });
    // floor 0.1 keeps 40 for a net of 38; floor 0.9 keeps 39 for a net of 39 and wins, which is
    // only reachable if the minimum is one rather than zero.
    expect(fit.floor).toBe(0.9);
    expect(fit.kept).toBe(39);
  });
});

describe('whether a question is shown its note', () => {
  it('admits at the floor, inclusive', () => {
    // The boundary belongs to the admitted side. A floor chosen because its own coverage was kept
    // has to admit the row that produced it, or the fit and the arm disagree by one question on
    // every fold and the reported `kept` is wrong by construction.
    expect(admitsAt(0.3, { floor: 0.3 })).toBe(true);
    expect(admitsAt(0.29999, { floor: 0.3 })).toBe(false);
  });

  it('admits everything at a floor of zero', () => {
    // The no-evidence case. If this were exclusive, a fold whose fit fell back would silently
    // drop its zero-coverage questions and the arm would not be `full-one`.
    expect(admitsAt(0, { floor: 0 })).toBe(true);
  });
});

describe('a policy from the environment', () => {
  it('accepts an absent setting and applies the default', () => {
    // The dispatch passes nothing and gets the registered pair. This is the only path by which
    // the numbers in a pre-registration reach a run.
    expect(parseAdmissionPolicy({})).toEqual(DEFAULT_ADMISSION);
    expect(parseAdmissionPolicy({ minKept: '', minDecisive: '' })).toEqual(DEFAULT_ADMISSION);
  });

  it('reads both settings when they are given', () => {
    expect(parseAdmissionPolicy({ minKept: '0.25', minDecisive: '12' })).toEqual({
      minKept: 0.25,
      minDecisive: 12,
    });
  });

  it('refuses a kept share outside (0, 1]', () => {
    // The defect this function exists for: a share of `1.4` read by arithmetic that clamped it
    // would keep every question and report a fitted floor of zero, which is `full-one` wearing
    // the name of an admission arm.
    for (const raw of ['0', '-0.5', '1.4', '2', 'NaN']) {
      expect(() => parseAdmissionPolicy({ minKept: raw })).toThrow(/kept share/);
    }
  });

  it('refuses a decisive floor that is not a whole count', () => {
    for (const raw of ['0', '-3', '2.5', 'many']) {
      expect(() => parseAdmissionPolicy({ minDecisive: raw })).toThrow(/decisive floor/);
    }
  });
});
