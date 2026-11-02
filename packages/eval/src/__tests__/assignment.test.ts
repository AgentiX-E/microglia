import { describe, expect, it } from 'vitest';
import {
  R36_BARS,
  adjudicateR36,
  assignmentOf,
  foldPairsOf,
  foldsOf,
  packAssignCasesOf,
  singleSlotOf,
  type AssignmentCase,
  type AssignmentReading,
} from '../assignment.js';

/** One question under the two arms the round compares: the pair, and the pair cut to one item. */
function caseOf(id: string, dbId: string, bare: boolean, kept: boolean, removed: boolean): AssignmentCase {
  return { id, dbId, bare, kept, removed };
}

/** A corpus where every question behaves the same way, which is what the boundaries need. */
function uniform(n: number, bare: boolean, kept: boolean, removed: boolean, databases = 2): AssignmentCase[] {
  return Array.from({ length: n }, (_, at) => caseOf(`q${at}`, `db${at % databases}`, bare, kept, removed));
}

/** The identities a reading has to satisfy, checked together because they are one accounting. */
function totals(reading: AssignmentReading) {
  const { arms, marginal } = reading;
  return {
    repaired: arms.removed.exchange.repaired + marginal.repairsLost,
    broken: arms.removed.exchange.broken + marginal.breaksSaved,
    keptRepaired: arms.kept.exchange.repaired,
    keptBroken: arms.kept.exchange.broken,
  };
}

describe('assignmentOf', () => {
  it('counts the questions whose prompt the truncation changed', () => {
    const cases = [
      caseOf('a', 'db1', false, true, false),
      caseOf('b', 'db1', true, false, true),
      caseOf('c', 'db2', true, true, true),
      caseOf('d', 'db2', false, false, false),
    ];
    const reading = assignmentOf(cases, { resamples: 200 });
    expect(reading.n).toBe(4);
    expect(reading.databases).toBe(2);
    expect(reading.discordant).toBe(2);
    expect(reading.discordantShare).toBe(0.5);
  });

  it('reads the contrast in the direction of the truncation', () => {
    // Two questions the pair repaired and the single rule did not, one the pair broke and it did not.
    const cases = [
      caseOf('a', 'db1', false, true, false),
      caseOf('b', 'db1', false, true, false),
      caseOf('c', 'db2', true, false, true),
      caseOf('d', 'db2', true, true, true),
    ];
    const reading = assignmentOf(cases, { resamples: 200 });
    expect(reading.contrast.gained).toBe(1);
    expect(reading.contrast.lost).toBe(2);
    expect(reading.contrast.deltaPp).toBeCloseTo(-25, 6);
  });

  it('keeps every question the exchange readings are built from', () => {
    const cases = [
      caseOf('a', 'db1', false, true, false),
      caseOf('b', 'db1', true, false, true),
      caseOf('c', 'db2', false, false, false),
      caseOf('d', 'db2', true, true, true),
    ];
    const reading = assignmentOf(cases, { resamples: 200 });
    // The bare model got two right and two wrong; the arms differ only inside those two groups.
    expect(reading.arms.bare.exchange.breakable).toBe(2);
    expect(reading.arms.bare.exchange.repairable).toBe(2);
    expect(reading.arms.kept.exchange.repairable).toBe(2);
    expect(reading.arms.removed.exchange.repairable).toBe(2);
    expect(reading.arms.kept.exchange.hurdle).toBe(1);
  });

  it('decomposes the second item into the repairs it carries and the breaks it saves', () => {
    const cases = [
      // The pair repaired this and one rule did not: the second item is worth a repair.
      caseOf('a', 'db1', false, true, false),
      // The pair broke this and one rule did not: the second item is worth a break.
      caseOf('b', 'db2', true, false, true),
      caseOf('c', 'db2', true, true, true),
    ];
    const reading = assignmentOf(cases, { resamples: 200 });
    expect(reading.marginal.repairsLost).toBe(1);
    expect(reading.marginal.breaksSaved).toBe(1);
    expect(reading.marginal.repairsGained).toBe(0);
    expect(reading.marginal.breaksGained).toBe(0);
    expect(reading.marginal.netChange).toBe(0);
    expect(reading.marginal.helpPerHarm).toBe(1);
    expect(totals(reading)).toMatchObject({ repaired: 1, broken: 1, keptRepaired: 1, keptBroken: 1 });
  });

  it('reports an undefined ratio rather than a zero when the removed item saved nothing', () => {
    const reading = assignmentOf(uniform(4, false, true, true), { resamples: 200 });
    expect(reading.marginal.breaksSaved).toBe(0);
    expect(reading.marginal.helpPerHarm).toBeNull();
  });

  it('clusters the interval by database, so one database cannot narrow it', () => {
    const single = assignmentOf(uniform(40, false, true, false, 1), { resamples: 400 });
    // A resample of one cluster is that cluster: the interval collapses onto the point rather than
    // claiming a precision the design does not have.
    expect(single.contrast.clusteredLowPp).toBeCloseTo(single.contrast.deltaPp, 9);
    expect(single.contrast.clusteredHighPp).toBeCloseTo(single.contrast.deltaPp, 9);
    // Two databases that disagree: the resample can draw either one twice, so the interval is the
    // width of that disagreement rather than the width of forty independent questions.
    const spread = assignmentOf(
      [...Array.from({ length: 10 }, (_, at) => caseOf(`x${at}`, 'db1', false, true, false)),
       ...Array.from({ length: 10 }, (_, at) => caseOf(`y${at}`, 'db2', false, false, true))],
      { resamples: 400 },
    );
    expect(spread.contrast.deltaPp).toBeCloseTo(0, 9);
    expect(spread.contrast.clusteredHighPp).toBeGreaterThan(50);
    expect(spread.contrast.clusteredLowPp).toBeLessThan(-50);
  });

  it('gives the same point estimates whatever order the cases arrive in', () => {
    const cases = [
      caseOf('a', 'db1', false, true, false),
      caseOf('b', 'db1', true, false, true),
      caseOf('c', 'db2', false, false, false),
      caseOf('d', 'db2', true, true, true),
    ];
    const forward = assignmentOf(cases, { resamples: 200 });
    const backward = assignmentOf([...cases].reverse(), { resamples: 200 });
    expect(backward.contrast.deltaPp).toBeCloseTo(forward.contrast.deltaPp, 9);
    expect(backward.marginal.repairsLost).toBe(forward.marginal.repairsLost);
    expect(backward.discordant).toBe(forward.discordant);
  });

  it('survives an empty corpus without inventing a number', () => {
    const reading = assignmentOf([], { resamples: 200 });
    expect(reading.n).toBe(0);
    expect(reading.databases).toBe(0);
    expect(reading.discordantShare).toBe(0);
    expect(reading.arms.kept.exchange.clearance).toBeNull();
    expect(reading.marginal.helpPerHarm).toBeNull();
    expect(reading.contrast.clusteredLowPp).toBe(0);
  });
});

describe('adjudicateR36', () => {
  /** A corpus with the shape of the real one: repairs and breaks on both arms, over ten databases. */
  function corpus(): AssignmentCase[] {
    const rows: AssignmentCase[] = [];
    // Ten questions the bare model missed: two repaired by both arms, two only by the pair, six by
    // neither.
    for (let at = 0; at < 10; at += 1) rows.push(caseOf(`rr${at}`, `db${at}`, false, at < 4, at < 2));
    // Twenty it answered: one broken only by the pair, two by both arms, seventeen by neither.
    for (let at = 0; at < 20; at += 1) rows.push(caseOf(`bb${at}`, `db${at % 10}`, true, at > 2, at === 0 || at > 2));
    return rows;
  }
  const cases = corpus();
  const reading = assignmentOf(cases, { resamples: 400 });
  const instrument = { maxItemsPerPrompt: 1, meanItemsPerPrompt: 1, changedShare: 0.74, basis: 'count' as const };
  const reported = {
    deltaPp: reading.contrast.deltaPp,
    gained: reading.contrast.gained,
    lost: reading.contrast.lost,
  };

  it('reads a corpus in which the pair repairs more than the single rule as unprofitable for the truncation', () => {
    // The pair repairs four and breaks three; the single rule repairs two and breaks two.
    expect(reading.arms.kept.exchange.repaired).toBe(4);
    expect(reading.arms.removed.exchange.repaired).toBe(2);
    expect(reading.arms.removed.exchange.clearance).toBeLessThan(1);
    expect(reading.arms.removed.exchange.clearance).toBeLessThan(reading.arms.kept.exchange.clearance ?? 0);
  });

  it('names five verdicts, in the order the registration states them', () => {
    const verdicts = adjudicateR36({
      reading,
      instrument,
      reported: { deltaPp: reading.contrast.deltaPp, gained: reading.contrast.gained, lost: reading.contrast.lost },
      replication: null,
    });
    expect(verdicts.map((verdict) => verdict.id)).toEqual(['P1', 'P2', 'P3', 'P4', 'P5']);
  });

  it('fails the instrument when the truncation barely changed anything', () => {
    const flat = assignmentOf(uniform(40, true, true, true, 20), { resamples: 200 });
    const [first] = adjudicateR36({
      reading: flat,
      instrument: { ...instrument, changedShare: 0.1 },
      reported: { deltaPp: 0, gained: 0, lost: 0 },
      replication: null,
    });
    expect(first?.holds).toBe(false);
    expect(first?.observed).toContain('10.0%');
  });

  it('fails the instrument when the arm carried more than one item', () => {
    const [first] = adjudicateR36({
      reading,
      instrument: { maxItemsPerPrompt: 2, meanItemsPerPrompt: 1.4, changedShare: 0.74, basis: 'count' as const },
      reported: { deltaPp: reading.contrast.deltaPp, gained: reading.contrast.gained, lost: reading.contrast.lost },
      replication: null,
    });
    expect(first?.holds).toBe(false);
  });

  it('agrees with the lane to a hundredth of a point and no further', () => {
    const exact = adjudicateR36({
      reading,
      instrument,
      reported: { deltaPp: reading.contrast.deltaPp + 0.009, gained: reading.contrast.gained, lost: reading.contrast.lost },
      replication: null,
    });
    expect(exact[1]?.holds).toBe(true);
    const off = adjudicateR36({
      reading,
      instrument,
      reported: { deltaPp: reading.contrast.deltaPp + 0.05, gained: reading.contrast.gained, lost: reading.contrast.lost },
      replication: null,
    });
    expect(off[1]?.holds).toBe(false);
  });

  it('fails the agreement when the discordant counts differ, whatever the delta says', () => {
    const [second] = adjudicateR36({
      reading,
      instrument,
      reported: { deltaPp: reading.contrast.deltaPp, gained: reading.contrast.gained + 1, lost: reading.contrast.lost + 1 },
      replication: null,
    }).slice(1);
    expect(second?.holds).toBe(false);
  });

  it('reads the one-rule pack as unprofitable when its clearance is below one', () => {
    const [third] = adjudicateR36({
      reading,
      instrument,
      reported: { deltaPp: reading.contrast.deltaPp, gained: reading.contrast.gained, lost: reading.contrast.lost },
      replication: null,
    }).slice(2);
    expect(third?.holds).toBe(true);
  });

  it('refuses the one-rule pack a profit it does not have when clearance clears one', () => {
    // Every question the bare model missed is repaired by the single rule, and nothing breaks.
    const lucky = assignmentOf(uniform(40, false, true, true, 10), { resamples: 200 });
    const [third] = adjudicateR36({
      reading: lucky,
      instrument,
      reported: { deltaPp: 0, gained: 0, lost: 0 },
      replication: null,
    }).slice(2);
    expect(lucky.arms.removed.exchange.clearance).toBeNull();
    expect(third?.holds).toBe(false);
  });

  it('states the marginal item as paid above two repairs per break', () => {
    const cases = [
      ...Array.from({ length: 6 }, (_, at) => caseOf(`r${at}`, `db${at}`, false, true, false)),
      caseOf('b', 'db9', true, false, true),
      ...Array.from({ length: 10 }, (_, at) => caseOf(`f${at}`, `db${at}`, true, true, true)),
    ];
    const [fourth] = adjudicateR36({
      reading: assignmentOf(cases, { resamples: 200 }),
      instrument,
      reported: { deltaPp: 0, gained: 0, lost: 0 },
      replication: null,
    }).slice(3);
    expect(fourth?.holds).toBe(true);
    expect(fourth?.observed).toContain('6');
  });

  it('calls the replication underpowered rather than reading its sign', () => {
    const [fifth] = adjudicateR36({
      reading,
      instrument,
      reported: { deltaPp: reading.contrast.deltaPp, gained: reading.contrast.gained, lost: reading.contrast.lost },
      replication: { ...reading, contrast: { ...reading.contrast, clusteredLowPp: 1, clusteredHighPp: 3 } },
    }).slice(4);
    expect(fifth?.holds).toBe(false);
    expect(fifth?.observed).toContain('+2');
  });

  it('calls the lever closed when the replication interval excludes the threshold', () => {
    const [fifth] = adjudicateR36({
      reading,
      instrument,
      reported: { deltaPp: reading.contrast.deltaPp, gained: reading.contrast.gained, lost: reading.contrast.lost },
      replication: { ...reading, contrast: { ...reading.contrast, clusteredLowPp: -1, clusteredHighPp: R36_BARS.materialPp - 0.1 } },
    }).slice(4);
    expect(fifth?.holds).toBe(true);
  });

  it('calls the lead real when the replication clears the threshold from below', () => {
    const [fifth] = adjudicateR36({
      reading,
      instrument,
      reported: { deltaPp: reading.contrast.deltaPp, gained: reading.contrast.gained, lost: reading.contrast.lost },
      replication: { ...reading, contrast: { ...reading.contrast, clusteredLowPp: R36_BARS.materialPp + 0.5, clusteredHighPp: 6 } },
    }).slice(4);
    expect(fifth?.holds).toBe(false);
    expect(fifth?.observed).toContain('refuted');
  });
});

describe('packAssignCasesOf', () => {
  const row = (id: string, arm: boolean | undefined, correct: boolean, bare: boolean, fold?: number) => ({
    id,
    dbId: 'db1',
    correct,
    withoutMemoryCorrect: bare,
    ...(fold === undefined ? {} : { fold }),
    ...(arm === undefined ? {} : { arms: { 'full-one': arm, full: correct } }),
  });

  it('reads the two arms and the bare model the exchange needs', () => {
    const { cases, skipped } = packAssignCasesOf([row('a', false, true, false)]);
    expect(skipped).toBe(0);
    expect(cases).toEqual([{ id: 'a', dbId: 'db1', bare: false, kept: true, removed: false }]);
  });

  it('skips a question the named arm never answered, and says how many', () => {
    // An artefact from a dispatch that did not ask for the arm carries no cell for it: counting those
    // as failures would be a truncation that was never rendered.
    const { cases, skipped } = packAssignCasesOf([row('a', true, true, true), row('b', undefined, false, true)]);
    expect(cases.map((entry) => entry.id)).toEqual(['a']);
    expect(skipped).toBe(1);
  });

  it('reads an arm named something else', () => {
    const { cases } = packAssignCasesOf(
      [{ id: 'a', dbId: 'db1', correct: true, withoutMemoryCorrect: false, arms: { other: false } }],
      'other',
    );
    expect(cases[0]?.removed).toBe(false);
  });

  it('carries the fold through when the artefact records one', () => {
    // Without this the per-fold table would silently pool: every case would land in fold 0 and the
    // five rows would be one row repeated, which is the failure the table exists to rule out.
    const { cases } = packAssignCasesOf([row('a', true, true, true, 3), row('b', true, true, true, 3)]);
    expect(cases.map((entry) => entry.fold)).toEqual([3, 3]);
  });

  it('leaves the field absent rather than undefined when the artefact has no folds', () => {
    // `exactOptionalPropertyTypes` is on: an explicit `fold: undefined` is a type error, so the case
    // has to be built without the key at all. `typeof` would pass on both, hence the own-key check.
    const { cases } = packAssignCasesOf([row('a', true, true, true)]);
    expect(Object.hasOwn(cases[0] as object, 'fold')).toBe(false);
  });
});

describe('singleSlotOf', () => {
  it('reads the structured count when the artefact carries one', () => {
    expect(singleSlotOf({ over: 0, gatePassed: null, meanItems: 1, differs: 1133, questions: 1534 })).toMatchObject({
      maxItemsPerPrompt: 1,
      basis: 'count',
      changedShare: 1133 / 1534,
    });
    expect(singleSlotOf({ over: 3, gatePassed: true, meanItems: 1.4, differs: 900, questions: 1534 })).toMatchObject({
      maxItemsPerPrompt: 2,
      basis: 'count',
    });
  });

  it('falls back to the lane’s own gate on an artefact that predates the count', () => {
    expect(singleSlotOf({ over: undefined, gatePassed: true, meanItems: 1, differs: 800, questions: 1000 })).toMatchObject({
      maxItemsPerPrompt: 1,
      basis: 'gate',
      changedShare: 0.8,
    });
    expect(singleSlotOf({ over: null, gatePassed: false, meanItems: 1.2, differs: null, questions: 1000 })).toMatchObject({
      maxItemsPerPrompt: 2,
      basis: 'gate',
      changedShare: null,
    });
  });

  it('fails closed when nothing recorded whether the arm was a truncation', () => {
    expect(singleSlotOf({ over: undefined, gatePassed: null, meanItems: null, differs: 5, questions: 0 })).toMatchObject({
      maxItemsPerPrompt: 2,
      basis: 'none',
      meanItemsPerPrompt: 0,
      changedShare: null,
    });
  });
});

describe('adjudicateR36, on the inputs a real artefact can hand it', () => {
  /** A corpus at the size the registration describes, so the instrument's branches can be reached. */
  function wide(databases: number, changed: number): AssignmentCase[] {
    return Array.from({ length: 1600 }, (_, at) =>
      caseOf(`w${at}`, `db${at % databases}`, at % 2 === 0, at % 3 !== 0, at % 3 !== 0 && at >= changed),
    );
  }

  it('passes the instrument on a corpus of the registered size', () => {
    const [first] = adjudicateR36({
      reading: assignmentOf(wide(12, 1600), { resamples: 100 }),
      instrument: { maxItemsPerPrompt: 1, meanItemsPerPrompt: 1, changedShare: 0.9, basis: 'count' },
      reported: { deltaPp: 0, gained: 0, lost: 0 },
      replication: null,
    });
    expect(first?.holds).toBe(true);
  });

  it('fails the instrument when the questions are spread over too few databases', () => {
    const [first] = adjudicateR36({
      reading: assignmentOf(wide(3, 1600), { resamples: 100 }),
      instrument: { maxItemsPerPrompt: 1, meanItemsPerPrompt: 1, changedShare: 0.9, basis: 'count' },
      reported: { deltaPp: 0, gained: 0, lost: 0 },
      replication: null,
    });
    expect(first?.holds).toBe(false);
    expect(first?.observed).toContain('3 databases');
  });

  it('says so when nothing recorded how much of the prompt the truncation changed', () => {
    const [first] = adjudicateR36({
      reading: assignmentOf(wide(12, 1600), { resamples: 100 }),
      instrument: { maxItemsPerPrompt: 1, meanItemsPerPrompt: 1, changedShare: null, basis: 'none' },
      reported: { deltaPp: 0, gained: 0, lost: 0 },
      replication: null,
    });
    expect(first?.holds).toBe(false);
    expect(first?.observed).toContain('an unrecorded share');
  });

  it('says so when the artefact carries no contrast to agree with', () => {
    const [, second] = adjudicateR36({
      reading: assignmentOf(wide(12, 1600), { resamples: 100 }),
      instrument: { maxItemsPerPrompt: 1, meanItemsPerPrompt: 1, changedShare: 0.9, basis: 'count' },
      reported: { deltaPp: null, gained: null, lost: null },
      replication: null,
    });
    expect(second?.holds).toBe(false);
    expect(second?.observed).toBe('the artefact carries no contrast for this pair');
  });
});

describe('assignmentOf defaults', () => {
  it('runs at the registration\u2019s resample count and seed when a caller names neither', () => {
    // The defaults are part of the protocol: an artefact read at somebody else's resample count is a
    // number that cannot be put beside this one.
    const reading = assignmentOf([
      caseOf('a', 'db1', false, true, false),
      caseOf('b', 'db1', true, false, true),
    ]);
    expect(reading.n).toBe(2);
    expect(reading.contrast.iidLowPp).toBeLessThanOrEqual(reading.contrast.deltaPp);
    expect(reading.contrast.clusteredLowPp).toBeLessThanOrEqual(reading.contrast.clusteredHighPp);
  });
});

describe('foldsOf', () => {
  it('reports the four cells per fold, in fold order', () => {
    const cases = [
      { ...caseOf('a', 'db1', false, true, false), fold: 1 },
      { ...caseOf('b', 'db1', true, false, true), fold: 1 },
      { ...caseOf('c', 'db2', true, true, true), fold: 0 },
    ];
    const folds = foldsOf(cases);
    expect(folds.map((entry) => entry.fold)).toEqual([0, 1]);
    expect(folds[1]).toMatchObject({ questions: 2, repairsLost: 1, breaksSaved: 1, netChange: 0 });
    expect(folds[0]).toMatchObject({ questions: 1, repairsLost: 0, breaksSaved: 0, netChange: 0 });
  });

  it('treats a case with no fold as fold zero rather than dropping it', () => {
    // The artefact records the fold; a hand-built corpus may not, and a silently dropped question is a
    // fold whose four cells do not sum to its own delta.
    expect(foldsOf([caseOf('a', 'db1', false, true, false)]).map((entry) => entry.fold)).toEqual([0]);
  });

  it('keeps the identity inside every fold', () => {
    const cases = [
      { ...caseOf('a', 'db1', false, true, false), fold: 0 },
      { ...caseOf('b', 'db1', false, false, true), fold: 0 },
      { ...caseOf('c', 'db2', true, false, false), fold: 0 },
      { ...caseOf('d', 'db2', true, true, true), fold: 1 },
    ];
    for (const fold of foldsOf(cases)) {
      const net = fold.repairsGained + fold.breaksSaved - fold.repairsLost - fold.breaksGained;
      expect(net).toBe(fold.netChange);
    }
  });

  it('carries an interval per fold, and it contains the fold\u2019s own point estimate', () => {
    // A per-fold sign without an interval invites reading four questions on 307 as a finding.
    const cases = [
      ...uniform(40, false, true, false).map((entry) => ({ ...entry, fold: 0 })),
      ...uniform(40, false, false, true).map((entry, at) => ({ ...entry, dbId: `x${at % 3}`, fold: 1 })),
    ];
    for (const fold of foldsOf(cases)) {
      expect(fold.clusteredLowPp).toBeLessThanOrEqual(fold.deltaPp);
      expect(fold.clusteredHighPp).toBeGreaterThanOrEqual(fold.deltaPp);
      expect(fold.p).toBeGreaterThanOrEqual(0);
      expect(fold.p).toBeLessThanOrEqual(1);
    }
  });
});

describe('foldPairsOf', () => {
  const fold = (id: number, netChange: number, low: number, high: number) => ({
    fold: id,
    questions: 307,
    repairsGained: 0,
    repairsLost: 0,
    breaksGained: 0,
    breaksSaved: 0,
    netChange,
    deltaPp: netChange / 3.07,
    clusteredLowPp: low,
    clusteredHighPp: high,
    p: 0.5,
  });

  it('pairs the same fold across two store draws and reports whether the sign survived', () => {
    const pairs = foldPairsOf(
      [fold(0, 4, -2, 6), fold(1, -5, -9, -1)],
      [fold(0, 5, -3, 8), fold(1, 2, -4, 7)],
    );
    expect(pairs.map((entry) => entry.fold)).toEqual([0, 1]);
    expect(pairs[0]?.sameSign).toBe(true);
    expect(pairs[1]?.sameSign).toBe(false);
  });

  it('drops a fold the other artefact does not carry instead of padding it', () => {
    // A padded fold would compare two different question sets and call the difference a replication.
    const pairs = foldPairsOf([fold(0, 1, -1, 2), fold(1, 1, -1, 2)], [fold(1, 1, -1, 2)]);
    expect(pairs.map((entry) => entry.fold)).toEqual([1]);
  });

  it('says when both intervals span zero, which is what agreement on noise looks like', () => {
    const spanning = foldPairsOf([fold(0, 4, -2, 6)], [fold(0, 5, -3, 8)]);
    expect(spanning[0]?.bothSpanZero).toBe(true);
    const decided = foldPairsOf([fold(0, 4, 1, 6)], [fold(0, 5, 2, 8)]);
    expect(decided[0]?.bothSpanZero).toBe(false);
  });

  it('carries the two sides separately, which is what a fold that only looks decided needs', () => {
    // The interesting fold is the one whose interval excluded zero on the first draw: a second draw that
    // covers zero is a refuted fold, and a single combined flag could not say which side moved.
    const pairs = foldPairsOf([fold(3, -5, -7, -1)], [fold(3, -1, -3, 2)]);
    expect(pairs[0]).toMatchObject({ firstSpansZero: false, secondSpansZero: true, bothSpanZero: false });
  });
});
