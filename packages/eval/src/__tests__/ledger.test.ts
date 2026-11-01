import { describe, expect, it } from 'vitest';
import {
  R35_BARS,
  adjudicateR35,
  dispersionOf,
  packSizeOf,
  replicationOf,
  screeningOf,
  type LedgerCase,
  type PackSizeFamily,
} from '../ledger.js';

/** A question, with the rules its prompt carried. */
function caseOf(
  id: string,
  dbId: string,
  pack: readonly string[],
  correct: boolean,
  withoutMemoryCorrect: boolean,
): LedgerCase {
  return { id, dbId, injected: pack.map((rule) => `text of ${rule}`), packIdList: pack, correct, withoutMemoryCorrect };
}

const repaired = (id: string, db: string, pack: readonly string[]) => caseOf(id, db, pack, true, false);
const broken = (id: string, db: string, pack: readonly string[]) => caseOf(id, db, pack, false, true);
const quiet = (id: string, db: string, pack: readonly string[]) => caseOf(id, db, pack, true, true);

describe('dispersionOf', () => {
  it('counts injections, not rules', () => {
    const cases = [repaired('a', 'db1', ['r1', 'r2']), broken('b', 'db1', ['r1', 'r2']), quiet('c', 'db1', ['r1'])];
    const reading = dispersionOf(cases, { permutations: 20 });
    expect(reading.rules).toBe(2);
    expect(reading.injections).toBe(5);
    expect(reading.repairs).toBe(2);
    expect(reading.breaks).toBe(2);
    expect(reading.permutations).toBe(20);
  });

  it('is zero when nothing flipped', () => {
    const cases = Array.from({ length: 12 }, (_, at) => quiet(`q${at}`, 'db1', ['r1', 'r2']));
    const reading = dispersionOf(cases, { permutations: 50 });
    expect(reading.repairStatistic).toBe(0);
    expect(reading.breakStatistic).toBe(0);
    expect(reading.p).toBe(1);
  });

  it('is zero when every injection belongs to the same rule', () => {
    // A single rule's count is its own expectation, so the deviation is exactly zero whatever happens.
    const cases = [repaired('a', 'db1', ['r1']), broken('b', 'db1', ['r1']), quiet('c', 'db1', ['r1'])];
    const reading = dispersionOf(cases, { permutations: 50 });
    expect(reading.rules).toBe(1);
    expect(reading.repairStatistic).toBe(0);
    expect(reading.p).toBe(1);
  });

  it('is zero when two rules are always injected together', () => {
    // The pack structure is preserved by the null, so a pair that never appears apart cannot be
    // separated by any permutation of the outcomes. This is the test that the null is the right one:
    // a binomial null would call this heterogeneity and a structure-preserving null cannot.
    const cases = [
      ...Array.from({ length: 10 }, (_, at) => repaired(`a${at}`, 'db1', ['r1', 'r2'])),
      ...Array.from({ length: 10 }, (_, at) => broken(`b${at}`, 'db1', ['r1', 'r2'])),
    ];
    const reading = dispersionOf(cases, { permutations: 100 });
    expect(reading.repairStatistic).toBe(0);
    expect(reading.breakStatistic).toBe(0);
    expect(reading.p).toBe(1);
  });

  it('exceeds its null when the flips belong to one rule', () => {
    const cases = [
      ...Array.from({ length: 20 }, (_, at) => repaired(`a${at}`, 'db1', ['good'])),
      ...Array.from({ length: 20 }, (_, at) => quiet(`b${at}`, 'db1', ['bad'])),
    ];
    const reading = dispersionOf(cases, { permutations: 200 });
    expect(reading.repairStatistic).toBeGreaterThan(reading.nullMean);
    expect(reading.p).toBeLessThan(0.01);
  });

  it('skips a pack whose ids and text disagree, and says how many', () => {
    const broken1: LedgerCase = {
      id: 'x',
      dbId: 'db1',
      injected: ['one'],
      packIdList: ['r1', 'r2'],
      correct: true,
      withoutMemoryCorrect: false,
    };
    const reading = dispersionOf([broken1, repaired('y', 'db1', ['r1'])], { permutations: 10 });
    expect(reading.rules).toBe(1);
    expect(reading.injections).toBe(1);
    expect(reading.unkeyed).toBe(1);
  });

  it('returns a p of one when there is nothing to test', () => {
    const reading = dispersionOf([], { permutations: 10 });
    expect(reading.rules).toBe(0);
    expect(reading.injections).toBe(0);
    expect(reading.p).toBe(1);
    expect(reading.nullMean).toBe(0);
  });
});

describe('replicationOf', () => {
  it('recovers a per-rule value that is the same in both halves', () => {
    const half = (offset: number) => [
      ...Array.from({ length: 20 }, (_, at) => repaired(`a${offset}${at}`, 'db1', ['good'])),
      ...Array.from({ length: 20 }, (_, at) => broken(`b${offset}${at}`, 'db1', ['bad'])),
      ...Array.from({ length: 10 }, (_, at) => repaired(`c${offset}${at}`, 'db1', ['mid'])),
      ...Array.from({ length: 10 }, (_, at) => broken(`d${offset}${at}`, 'db1', ['mid'])),
      ...Array.from({ length: 5 }, (_, at) => quiet(`e${offset}${at}`, 'db1', ['flat'])),
    ];
    const reading = replicationOf(half(0), half(1), { minShown: 5 });
    expect(reading.rules).toBe(4);
    expect(reading.correlation).toBeCloseTo(1, 10);
    expect(reading.reliability).toBeCloseTo(1, 10);
    expect(reading.signAgreement).toBe(1);
    expect(reading.signPairs).toBe(2);
  });

  it('reports disagreement rather than hiding it', () => {
    const discovery = [
      ...Array.from({ length: 10 }, (_, at) => repaired(`a${at}`, 'db1', ['x'])),
      ...Array.from({ length: 10 }, (_, at) => broken(`b${at}`, 'db1', ['y'])),
      ...Array.from({ length: 10 }, (_, at) => repaired(`c${at}`, 'db1', ['z'])),
    ];
    const confirmation = [
      ...Array.from({ length: 10 }, (_, at) => broken(`d${at}`, 'db1', ['x'])),
      ...Array.from({ length: 10 }, (_, at) => repaired(`e${at}`, 'db1', ['y'])),
      ...Array.from({ length: 10 }, (_, at) => broken(`f${at}`, 'db1', ['z'])),
    ];
    const reading = replicationOf(discovery, confirmation, { minShown: 5 });
    expect(reading.correlation).toBeLessThan(0);
    expect(reading.signAgreement).toBe(0);
    expect(reading.signPairs).toBe(3);
  });

  it('declines a reliability it cannot compute', () => {
    // Two rules, perfectly anti-correlated: 1 + r is zero and Spearman–Brown has no value there.
    const discovery = [
      ...Array.from({ length: 10 }, (_, at) => repaired(`a${at}`, 'db1', ['x'])),
      ...Array.from({ length: 10 }, (_, at) => broken(`b${at}`, 'db1', ['y'])),
    ];
    const confirmation = [
      ...Array.from({ length: 10 }, (_, at) => broken(`c${at}`, 'db1', ['x'])),
      ...Array.from({ length: 10 }, (_, at) => repaired(`d${at}`, 'db1', ['y'])),
    ];
    const reading = replicationOf(discovery, confirmation, { minShown: 5 });
    expect(reading.correlation).toBeCloseTo(-1, 10);
    expect(reading.reliability).toBeNull();
  });

  it('needs three common rules before it will correlate anything', () => {
    const discovery = [repaired('a', 'db1', ['x']), repaired('b', 'db1', ['x'])];
    const confirmation = [repaired('c', 'db1', ['x']), repaired('d', 'db1', ['x'])];
    const reading = replicationOf(discovery, confirmation, { minShown: 1 });
    expect(reading.rules).toBe(1);
    expect(reading.correlation).toBeNull();
    expect(reading.low).toBeNull();
    expect(reading.reliability).toBeNull();
    expect(reading.signAgreement).toBeNull();
  });

  it('orders the rules by id before it pairs them up', () => {
    // The two halves name the same rules in opposite orders; a comparator that only ever returned -1
    // would still pass a naive test, so both directions are exercised here.
    const half = (offset: string) => [
      repaired(`${offset}1`, 'db1', ['zeta']),
      repaired(`${offset}2`, 'db1', ['zeta']),
      quiet(`${offset}3`, 'db1', ['zeta']),
      broken(`${offset}4`, 'db1', ['alpha']),
      quiet(`${offset}5`, 'db1', ['alpha']),
    ];
    const reading = replicationOf(half('a'), half('b'), { minShown: 1 });
    expect(reading.rules).toBe(2);
    expect(reading.correlation).toBeCloseTo(1, 10);
  });

  it('honours the floor on how often a rule has to have been shown', () => {
    const discovery = [
      ...Array.from({ length: 2 }, (_, at) => repaired(`a${at}`, 'db1', ['rare', 'common'])),
      ...Array.from({ length: 9 }, (_, at) => quiet(`b${at}`, 'db1', ['common'])),
    ];
    const confirmation = [
      ...Array.from({ length: 9 }, (_, at) => quiet(`c${at}`, 'db1', ['common'])),
      ...Array.from({ length: 9 }, (_, at) => quiet(`d${at}`, 'db1', ['rare'])),
    ];
    const reading = replicationOf(discovery, confirmation, { minShown: 5 });
    expect(reading.rules).toBe(1);
  });
});

describe('screeningOf', () => {
  const discovery = [
    ...Array.from({ length: 12 }, (_, at) => broken(`d1${at}`, 'dbA', ['harmful'])),
    ...Array.from({ length: 12 }, (_, at) => repaired(`d2${at}`, 'dbB', ['useful'])),
    ...Array.from({ length: 12 }, (_, at) => quiet(`d3${at}`, 'dbC', ['harmless'])),
  ];

  it('flags the rules the discovery half saw enough of and that lost', () => {
    const confirmation = [
      ...Array.from({ length: 6 }, (_, at) => broken(`c1${at}`, 'dbA', ['harmful'])),
      ...Array.from({ length: 6 }, (_, at) => repaired(`c2${at}`, 'dbB', ['useful'])),
    ];
    const reading = screeningOf(discovery, confirmation, { minShown: 10, resamples: 200 });
    expect(reading.flaggedRules).toBe(1);
    expect(reading.flaggedRules).toBeLessThan(2);
  });

  it('measures the flag on questions it never saw', () => {
    const confirmation = [
      ...Array.from({ length: 20 }, (_, at) => broken(`c1${at}`, `dbA${at % 4}`, ['harmful'])),
      ...Array.from({ length: 20 }, (_, at) => repaired(`c2${at}`, `dbB${at % 4}`, ['useful'])),
    ];
    const reading = screeningOf(discovery, confirmation, { minShown: 10, resamples: 500 });
    expect(reading.flagged.questions).toBe(20);
    expect(reading.clean.questions).toBe(20);
    expect(reading.flagged.netPp).toBeCloseTo(-100, 10);
    expect(reading.clean.netPp).toBeCloseTo(100, 10);
    expect(reading.differencePp).toBeCloseTo(-200, 10);
    expect(reading.clears).toBe(true);
  });

  it('does not clear when the flagged questions are no worse', () => {
    const confirmation = [
      ...Array.from({ length: 20 }, (_, at) => (at % 2 === 0 ? repaired(`c1${at}`, `dbA${at % 4}`, ['harmful']) : broken(`c1b${at}`, `dbA${at % 4}`, ['harmful']))),
      ...Array.from({ length: 20 }, (_, at) => (at % 2 === 0 ? repaired(`c2${at}`, `dbB${at % 4}`, ['useful']) : broken(`c2b${at}`, `dbB${at % 4}`, ['useful']))),
    ];
    const reading = screeningOf(discovery, confirmation, { minShown: 10, resamples: 500 });
    expect(reading.differencePp).toBeCloseTo(0, 10);
    expect(reading.clears).toBe(false);
  });

  it('refuses an interval from a single database', () => {
    const confirmation = [
      ...Array.from({ length: 10 }, (_, at) => broken(`c1${at}`, 'only', ['harmful'])),
      ...Array.from({ length: 10 }, (_, at) => repaired(`c2${at}`, 'only', ['useful'])),
    ];
    const reading = screeningOf(discovery, confirmation, { minShown: 10, resamples: 200 });
    expect(reading.differencePp).toBeCloseTo(-200, 10);
    expect(reading.lowPp).toBeNull();
    expect(reading.highPp).toBeNull();
    expect(reading.clears).toBe(false);
  });

  it('reports an empty arm rather than a zero', () => {
    const confirmation = [...Array.from({ length: 10 }, (_, at) => repaired(`c2${at}`, 'dbB', ['useful']))];
    const reading = screeningOf(discovery, confirmation, { minShown: 10, resamples: 200 });
    expect(reading.flagged.questions).toBe(0);
    expect(reading.flagged.netPp).toBeNull();
    expect(reading.differencePp).toBeNull();
    expect(reading.clears).toBe(false);
  });
});

describe('packSizeOf', () => {
  const cases: LedgerCase[] = [
    ...Array.from({ length: 8 }, (_, at) => repaired(`s1${at}`, `db${at % 4}`, ['r1'])),
    ...Array.from({ length: 2 }, (_, at) => broken(`s2${at}`, `db${at % 4}`, ['r2'])),
    ...Array.from({ length: 20 }, (_, at) => broken(`p1${at}`, `db${at % 4}`, ['r1', 'r2'])),
    ...Array.from({ length: 20 }, (_, at) => repaired(`p2${at}`, `db${at % 4}`, ['r3', 'r4'])),
  ];

  it('separates the packs by how many rules they carried', () => {
    const reading = packSizeOf(cases, { resamples: 500 });
    expect(reading.single.questions).toBe(10);
    expect(reading.single.repairable).toBe(8);
    expect(reading.single.repaired).toBe(8);
    expect(reading.single.breakable).toBe(2);
    expect(reading.single.broken).toBe(2);
    expect(reading.pair.questions).toBe(40);
  });

  it('nets each arm on its own questions', () => {
    const reading = packSizeOf(cases, { resamples: 500 });
    expect(reading.single.netPp).toBeCloseTo(60, 10);
    expect(reading.pair.netPp).toBeCloseTo(0, 10);
    expect(reading.differencePp).toBeCloseTo(60, 10);
  });

  it('clusters the interval over databases rather than questions', () => {
    const reading = packSizeOf(cases, { resamples: 500 });
    expect(reading.lowPp).not.toBeNull();
    expect(reading.highPp).not.toBeNull();
    expect(reading.lowPp as number).toBeLessThanOrEqual(reading.differencePp as number);
    expect(reading.highPp as number).toBeGreaterThanOrEqual(reading.differencePp as number);
    expect(reading.excludesZero).toBe(reading.lowPp !== null && (reading.lowPp > 0 || (reading.highPp as number) < 0));
  });

  it('clears zero when the arms separate cleanly', () => {
    const separated = [
      ...Array.from({ length: 8 }, (_, at) => repaired(`s${at}`, `db${at % 4}`, ['one'])),
      ...Array.from({ length: 8 }, (_, at) => broken(`p${at}`, `db${at % 4}`, ['one', 'two'])),
    ];
    const reading = packSizeOf(separated, { resamples: 600 });
    expect(reading.differencePp).toBeCloseTo(200, 10);
    expect(reading.excludesZero).toBe(true);
    expect(reading.lowPp as number).toBeGreaterThan(0);
  });

  it('reports a negative lead as negative', () => {
    const reversed = [
      ...Array.from({ length: 8 }, (_, at) => broken(`s${at}`, `db${at % 4}`, ['one'])),
      ...Array.from({ length: 8 }, (_, at) => repaired(`p${at}`, `db${at % 4}`, ['one', 'two'])),
    ];
    const reading = packSizeOf(reversed, { resamples: 600 });
    expect(reading.differencePp).toBeCloseTo(-200, 10);
    expect(reading.highPp as number).toBeLessThan(0);
    expect(reading.excludesZero).toBe(true);
  });

  it('refuses an interval when one arm is empty', () => {
    const pairsOnly = cases.filter((entry) => entry.id.startsWith('p'));
    const reading = packSizeOf(pairsOnly, { resamples: 200 });
    expect(reading.single.questions).toBe(0);
    expect(reading.single.netPp).toBeNull();
    expect(reading.differencePp).toBeNull();
    expect(reading.excludesZero).toBe(false);
  });

  it('refuses an interval from a single database', () => {
    const one = cases.filter((entry) => entry.dbId === 'db0');
    const reading = packSizeOf(one, { resamples: 200 });
    expect(reading.differencePp).not.toBeNull();
    expect(reading.lowPp).toBeNull();
    expect(reading.excludesZero).toBe(false);
  });

  it('ignores a question whose pack has three rules', () => {
    const reading = packSizeOf([...cases, repaired('t', 'db0', ['a', 'b', 'c'])], { resamples: 200 });
    expect(reading.single.questions + reading.pair.questions).toBe(50);
  });
});

describe('adjudicateR35', () => {
  const family: PackSizeFamily = { datasets: 18, positive: 4, negative: 13, flat: 1 };
  const base = {
    corpus: { rules: 203, injections: 13_578, halves: { databases: 29 }, rulesPerHalf: 120 },
    dispersion: {
      rules: 203,
      injections: 13_578,
      repairs: 349,
      breaks: 462,
      repairStatistic: 293.3,
      breakStatistic: 236.2,
      nullMean: 209.7,
      nullP99: 284.0,
      p: 0.0045,
      unkeyed: 0,
      permutations: 2000,
    },
    replication: { rules: 135, correlation: -0.13, low: -0.3, high: 0.04, signAgreement: 0.49, signPairs: 53, reliability: null },
    screening: {
      flaggedRules: 12,
      flaggedQuestions: 400,
      cleanQuestions: 600,
      flagged: { questions: 400, injections: 800, repaired: 10, broken: 20, netPp: -2.5 },
      clean: { questions: 600, injections: 1200, repaired: 30, broken: 30, netPp: 0 },
      differencePp: -2.5,
      lowPp: -6.1,
      highPp: 1.2,
      clears: false,
    },
    packSize: {
      single: { questions: 423, repairable: 200, repaired: 25, breakable: 223, broken: 12, netPp: 3.07 },
      pair: { questions: 6576, repairable: 2725, repaired: 162, breakable: 3851, broken: 225, netPp: -0.96 },
      differencePp: 4.03,
      lowPp: 0.87,
      highPp: 6.52,
      excludesZero: true,
    },
    family,
  };

  it('holds P1 only when both halves carry enough rules', () => {
    expect(adjudicateR35(base).find((verdict) => verdict.id === 'P1')?.holds).toBe(true);
    const thin = { ...base, corpus: { ...base.corpus, rulesPerHalf: 40 } };
    expect(adjudicateR35(thin).find((verdict) => verdict.id === 'P1')?.holds).toBe(false);
  });

  it('holds P2 when the dispersion clears its null at the registered level', () => {
    expect(adjudicateR35(base).find((verdict) => verdict.id === 'P2')?.holds).toBe(true);
    const flat = { ...base, dispersion: { ...base.dispersion, p: 0.4 } };
    expect(adjudicateR35(flat).find((verdict) => verdict.id === 'P2')?.holds).toBe(false);
  });

  it('holds P3 only when the value fails to travel', () => {
    expect(adjudicateR35(base).find((verdict) => verdict.id === 'P3')?.holds).toBe(true);
    const travels = { ...base, replication: { ...base.replication, correlation: 0.62, signAgreement: 0.7 } };
    expect(adjudicateR35(travels).find((verdict) => verdict.id === 'P3')?.holds).toBe(false);
  });

  it('holds P4 against the reliability floor, and refuses a missing reliability as a pass', () => {
    expect(adjudicateR35(base).find((verdict) => verdict.id === 'P4')?.holds).toBe(true);
    const usable = { ...base, replication: { ...base.replication, reliability: 0.8 } };
    expect(adjudicateR35(usable).find((verdict) => verdict.id === 'P4')?.holds).toBe(false);
  });

  it('inverts P5: the prediction holds when the screening rule does not', () => {
    expect(adjudicateR35(base).find((verdict) => verdict.id === 'P5')?.holds).toBe(true);
    const works = { ...base, screening: { ...base.screening, clears: true } };
    expect(adjudicateR35(works).find((verdict) => verdict.id === 'P5')?.holds).toBe(false);
  });

  it('states the power requirement as a multiple of what was measured', () => {
    const verdict = adjudicateR35(base).find((item) => item.id === 'P6');
    expect(verdict?.holds).toBe(true);
    expect(verdict?.observed).toContain('670');
  });

  it('holds P7 when the pack-size lead is a minority of the family', () => {
    expect(adjudicateR35(base).find((verdict) => verdict.id === 'P7')?.holds).toBe(true);
    const consistent = { ...base, family: { datasets: 18, positive: 15, negative: 3, flat: 0 } };
    expect(adjudicateR35(consistent).find((verdict) => verdict.id === 'P7')?.holds).toBe(false);
  });

  it('keeps the registered bars in one place', () => {
    expect(R35_BARS.maxCorrelation).toBe(0.2);
    expect(R35_BARS.maxReliability).toBe(0.3);
    expect(R35_BARS.pruneShown).toBe(10);
  });
});

describe('the defaults, and the inputs that produce no number', () => {
  const small = [
    ...Array.from({ length: 8 }, (_, at) => repaired(`a${at}`, 'db1', ['good'])),
    ...Array.from({ length: 8 }, (_, at) => broken(`b${at}`, 'db2', ['bad'])),
    ...Array.from({ length: 4 }, (_, at) => quiet(`c${at}`, 'db3', ['flat'])),
  ];

  it('runs every reading without options', () => {
    const dispersion = dispersionOf(small);
    expect(dispersion.permutations).toBe(2000);
    // The flat rule was shown four times, below the default floor of five, so it is not compared.
    const replication = replicationOf(small, small);
    expect(replication.rules).toBe(2);
    // Eight showings is below the registered floor of ten, so the default flags nothing; the same
    // call with the floor lowered flags exactly the rule that lost.
    const screening = screeningOf(small, small);
    expect(screening.flaggedRules).toBe(0);
    expect(screeningOf(small, small, { minShown: 5 }).flaggedRules).toBe(1);
    // Every question in `small` carries one rule, so the pack-size reading needs a mixed corpus
    // before its defaults are exercised all the way through the bootstrap.
    const packSize = packSizeOf([...small, broken('pair1', 'db4', ['good', 'bad']), broken('pair2', 'db5', ['good', 'bad'])]);
    expect(packSize.single.questions).toBe(20);
    expect(packSize.pair.questions).toBe(2);
    expect(packSize.lowPp).not.toBeNull();
  });

  it('reports no null distribution when it was asked for none', () => {
    const reading = dispersionOf(small, { permutations: 0 });
    expect(reading.nullMean).toBe(0);
    expect(reading.nullP99).toBe(0);
    expect(reading.p).toBe(1);
  });

  it('finds no correlation when one half did not move', () => {
    const flat = Array.from({ length: 9 }, (_, at) => quiet(`f${at}`, 'db1', ['x', 'y', 'z']));
    const reading = replicationOf(flat, small, { minShown: 1 });
    expect(reading.rules).toBe(0);
    const shared = replicationOf(
      [...Array.from({ length: 9 }, (_, at) => quiet(`g${at}`, 'db1', ['good', 'bad', 'flat']))],
      [...Array.from({ length: 9 }, (_, at) => quiet(`h${at}`, 'db2', ['good', 'bad', 'flat']))],
      { minShown: 1 },
    );
    expect(shared.correlation).toBeNull();
    expect(shared.reliability).toBeNull();
  });

  it('skips a malformed pack rather than counting half of it', () => {
    const malformed: LedgerCase = {
      id: 'm',
      dbId: 'db1',
      injected: ['only one text'],
      packIdList: ['a', 'b'],
      correct: true,
      withoutMemoryCorrect: false,
    };
    const screening = screeningOf(small, [...small, malformed], { minShown: 1, resamples: 100 });
    expect(screening.flagged.questions + screening.clean.questions).toBe(small.length);
    const packSize = packSizeOf([...small, malformed], { resamples: 100 });
    expect(packSize.single.questions).toBe(20);
  });

  it('returns no interval when the bootstrap was asked for no resamples', () => {
    const mixed = [
      ...Array.from({ length: 6 }, (_, at) => repaired(`s${at}`, `db${at % 3}`, ['a'])),
      ...Array.from({ length: 6 }, (_, at) => broken(`p${at}`, `db${at % 3}`, ['a', 'b'])),
    ];
    const reading = packSizeOf(mixed, { resamples: 0 });
    expect(reading.differencePp).not.toBeNull();
    expect(reading.lowPp).toBeNull();
    expect(reading.highPp).toBeNull();
    expect(reading.excludesZero).toBe(false);
  });

  it('refuses to read a missing correlation as a travellable value', () => {
    const verdicts = adjudicateR35({
      corpus: { rules: 203, injections: 13_578, halves: { databases: 29 }, rulesPerHalf: 120 },
      dispersion: {
        rules: 203,
        injections: 13_578,
        repairs: 349,
        breaks: 462,
        repairStatistic: 250,
        breakStatistic: 236,
        nullMean: 209.7,
        nullP99: 284,
        p: 0.2,
        unkeyed: 0,
        permutations: 2000,
      },
      replication: { rules: 135, correlation: null, low: null, high: null, signAgreement: null, signPairs: 0, reliability: null },
      screening: {
        flaggedRules: 0,
        flagged: { questions: 0, injections: 0, repaired: 0, broken: 0, netPp: null },
        clean: { questions: 10, injections: 20, repaired: 1, broken: 2, netPp: -10 },
        differencePp: null,
        lowPp: null,
        highPp: null,
        clears: false,
      },
      packSize: {
        single: { questions: 0, repairable: 0, repaired: 0, breakable: 0, broken: 0, netPp: null },
        pair: { questions: 10, repairable: 5, repaired: 2, breakable: 5, broken: 2, netPp: 0 },
        differencePp: null,
        lowPp: null,
        highPp: null,
        excludesZero: false,
      },
      family: { datasets: 18, positive: 4, negative: 13, flat: 1 },
    });
    expect(verdicts.find((verdict) => verdict.id === 'P3')?.holds).toBe(true);
    expect(verdicts.find((verdict) => verdict.id === 'P4')?.holds).toBe(false);
    expect(verdicts.find((verdict) => verdict.id === 'P6')?.holds).toBe(false);
    expect(verdicts.find((verdict) => verdict.id === 'P5')?.observed).toContain('n/a');

    const empty = adjudicateR35({
      corpus: { rules: 0, injections: 0, halves: { databases: 29 }, rulesPerHalf: 0 },
      dispersion: { rules: 0, injections: 0, repairs: 0, breaks: 0, repairStatistic: 0, breakStatistic: 0, nullMean: 0, nullP99: 0, p: 1, unkeyed: 0, permutations: 0 },
      replication: { rules: 0, correlation: null, low: null, high: null, signAgreement: null, signPairs: 0, reliability: null },
      screening: {
        flaggedRules: 0,
        flagged: { questions: 0, injections: 0, repaired: 0, broken: 0, netPp: null },
        clean: { questions: 0, injections: 0, repaired: 0, broken: 0, netPp: null },
        differencePp: null,
        lowPp: null,
        highPp: null,
        clears: false,
      },
      packSize: {
        single: { questions: 0, repairable: 0, repaired: 0, breakable: 0, broken: 0, netPp: null },
        pair: { questions: 0, repairable: 0, repaired: 0, breakable: 0, broken: 0, netPp: null },
        differencePp: null,
        lowPp: null,
        highPp: null,
        excludesZero: false,
      },
      family: { datasets: 0, positive: 0, negative: 0, flat: 0 },
    });
    expect(empty.find((verdict) => verdict.id === 'P6')?.observed).toContain('0 injections per rule');
  });
});
