/**
 * Whether the memory is shown to the wrong population.
 *
 * §147 measured the exchange rate as a property of the injected item and §148 closed the product on
 * it. R34 restates the question as one about *which questions* the pack reaches, and the tests here
 * are built to make the restatement fail in the ways it can: an estimator that reports a subset gain
 * on the subset instead of on the corpus, a gate that reads its own answer back through a neighbour,
 * a split that leaks a database, and an arithmetic that treats a rate over nothing as zero.
 *
 * The fixtures are small enough to check by hand. Every ratio in the module is asserted against a
 * number written out in the test, never against the module's own helper.
 */
import { describe, expect, it } from 'vitest';
import {
  PRECISION_BAR_TOLERANCE,
  admissionGainOf,
  adjudicateR34,
  admitsOf,
  compareIds,
  exchangeOf,
  precisionBarOf,
  quantilesOf,
  selfKnowledgeOf,
  similarityOf,
  splitByDatabase,
  tokensOf,
  type AdmissionCase,
  type AdmissionReading,
} from '../admission.js';

/** One case: `correct` is the memory arm, `withoutMemoryCorrect` the bare one. */
function entry(
  id: string,
  dbId: string,
  withoutMemoryCorrect: boolean,
  correct: boolean,
  extra: { question?: string; coverage?: number; packIds?: number } = {},
): AdmissionCase {
  return {
    id,
    dbId,
    question: extra.question ?? 'how many movies',
    correct,
    withoutMemoryCorrect,
    coverage: extra.coverage ?? 0.5,
    packIds: extra.packIds ?? 2,
  };
}

/**
 * Six questions in two databases: two repaired, one broken, one unchanged-right, two unchanged-wrong.
 *
 *   a: wrong → right   repair
 *   b: wrong → right   repair
 *   c: right → wrong   break
 *   d: right → right   untouched
 *   e: wrong → wrong   untouched
 *   f: wrong → wrong   untouched
 */
const CORPUS: readonly AdmissionCase[] = [
  entry('a', 'db1', false, true),
  entry('b', 'db1', false, true),
  entry('c', 'db1', true, false),
  entry('d', 'db2', true, true),
  entry('e', 'db2', false, false),
  entry('f', 'db2', false, false),
];

describe('exchangeOf', () => {
  it('puts repairs and breaks on their own bases, and the hurdle on the ratio of the bases', () => {
    const reading = exchangeOf(CORPUS);
    expect(reading.n).toBe(6);
    // Four questions were wrong without memory and two of them were repaired: 50%.
    expect(reading.repairable).toBe(4);
    expect(reading.repaired).toBe(2);
    expect(reading.repairRatePp).toBeCloseTo(50, 10);
    // Two were right without memory and one of them was broken: 50%.
    expect(reading.breakable).toBe(2);
    expect(reading.broken).toBe(1);
    expect(reading.breakRatePp).toBeCloseTo(50, 10);
    expect(reading.net).toBe(1);
    expect(reading.netPp).toBeCloseTo(100 / 6, 10);
    expect(reading.helpPerHarm).toBeCloseTo(2, 10);
    // The hurdle is the bare odds: 2 right against 4 wrong, so 0.5. Parity would be 1.
    expect(reading.hurdle).toBeCloseTo(0.5, 10);
    // 2.0 of exchange against a hurdle of 0.5 clears by four times, which is why this corpus is a
    // fixture rather than a finding.
    expect(reading.clearance).toBeCloseTo(4, 10);
  });

  it('derives the repair rate that would break even at the measured break rate', () => {
    const reading = exchangeOf(CORPUS);
    // 50% breaks × hurdle 0.5 = 25% repairs needed, against 50% observed.
    expect(reading.requiredRepairRatePp).toBeCloseTo(25, 10);
    expect(reading.requiredBreakRatePp).toBeCloseTo(100, 10);
  });

  it('reports a rate over nothing as unmeasured rather than zero', () => {
    const allRight = [entry('a', 'db1', true, true), entry('b', 'db1', true, false)];
    const reading = exchangeOf(allRight);
    expect(reading.repairable).toBe(0);
    expect(reading.repairRatePp).toBeNull();
    expect(reading.hurdle).toBeNull();
    expect(reading.clearance).toBeNull();
    expect(reading.requiredRepairRatePp).toBeNull();

    const allWrong = [entry('a', 'db1', false, true)];
    const noBreaks = exchangeOf(allWrong);
    expect(noBreaks.breakable).toBe(0);
    expect(noBreaks.breakRatePp).toBeNull();
    expect(noBreaks.helpPerHarm).toBeNull();
    expect(noBreaks.requiredBreakRatePp).toBeNull();
  });

  it('handles an empty corpus without inventing a zero', () => {
    const reading = exchangeOf([]);
    expect(reading.n).toBe(0);
    expect(reading.net).toBe(0);
    expect(reading.netPp).toBeNull();
    expect(reading.helpPerHarm).toBeNull();
  });

  it('reports a corpus with no discordance as an exchange rate of zero and not as missing', () => {
    const quiet = [entry('a', 'db1', false, false), entry('b', 'db1', true, true)];
    const reading = exchangeOf(quiet);
    expect(reading.repaired).toBe(0);
    expect(reading.broken).toBe(0);
    expect(reading.helpPerHarm).toBeNull();
    expect(reading.net).toBe(0);
    expect(reading.netPp).toBeCloseTo(0, 10);
  });
});

describe('precisionBarOf', () => {
  it('is the share of admitted questions that must be repairable for the gain to be positive', () => {
    // 4 repairs of 100 repairable is r = 4%; 3 breaks of 100 breakable is b = 3%. The bar is
    // 0.03 / 0.07 = 42.86%, and a gate at 50% precision pays.
    const reading = exchangeOf([
      ...Array.from({ length: 100 }, (_, at) => entry(`r${at}`, 'db1', false, at < 4)),
      ...Array.from({ length: 100 }, (_, at) => entry(`b${at}`, 'db1', true, at >= 3)),
    ]);
    expect(reading.repairRatePp).toBeCloseTo(4, 10);
    expect(reading.breakRatePp).toBeCloseTo(3, 10);
    const bar = precisionBarOf(reading);
    expect(bar).not.toBeNull();
    expect(bar as number).toBeCloseTo(0.03 / 0.07, 10);
    // At 50% precision the expected net is 0.5·4% − 0.5·3% = +0.5pp per admitted question.
    expect(0.5 * 0.04 - 0.5 * 0.03).toBeCloseTo(0.005, 10);
  });

  it('is undefined when either base is empty', () => {
    expect(precisionBarOf(exchangeOf([entry('a', 'db1', false, true)]))).toBeNull();
  });

  it('is undefined when both rates are zero, because no precision would pay', () => {
    // One question that stayed wrong and one that stayed right: both bases are populated and both
    // rates are zero, so the bar has a denominator of zero rather than a value.
    const quiet = [entry('a', 'db1', false, false), entry('b', 'db1', true, true)];
    expect(exchangeOf(quiet).repairRatePp).toBeCloseTo(0, 10);
    expect(precisionBarOf(exchangeOf(quiet))).toBeNull();
  });

  it('carries a tolerance so a gate at exactly the bar is not called a win', () => {
    expect(PRECISION_BAR_TOLERANCE).toBeGreaterThan(0);
  });
});

describe('admissionGainOf', () => {
  it('reports the gain on the corpus, not on the admitted subset', () => {
    // Admitting one repaired question must move the corpus by 1/6 of 100pp, not by 100pp.
    const reading = admissionGainOf([...CORPUS], (row) => row.id === 'a');
    expect(reading.admitted).toBe(1);
    expect(reading.share).toBeCloseTo(1 / 6, 10);
    expect(reading.repaired).toBe(1);
    expect(reading.broken).toBe(0);
    expect(reading.net).toBe(1);
    expect(reading.netPp).toBeCloseTo(100 / 6, 10);
    // Per admitted question the gain is the whole 100pp, which is why the two scales are reported
    // separately: a subset reading presented alone overstates the product.
    expect(reading.perAdmittedPp).toBeCloseTo(100, 10);
  });

  it('reports precision against the repairable set and recall against the repairs', () => {
    const reading = admissionGainOf([...CORPUS], (row) => row.id === 'a' || row.id === 'c');
    // One of the two admitted was bare-wrong.
    expect(reading.precision).toBeCloseTo(0.5, 10);
    // One of the two repairs was admitted.
    expect(reading.recall).toBeCloseTo(0.5, 10);
  });

  it('reports an empty admission as zero admitted with no precision', () => {
    const reading = admissionGainOf([...CORPUS], () => false);
    expect(reading.admitted).toBe(0);
    expect(reading.share).toBe(0);
    expect(reading.netPp).toBeCloseTo(0, 10);
    expect(reading.precision).toBeNull();
    expect(reading.perAdmittedPp).toBeNull();
    expect(reading.clears).toBe(false);
  });

  it('refuses to resolve an interval from one cluster', () => {
    const single = [entry('a', 'db1', false, true), entry('b', 'db1', true, false)];
    const reading = admissionGainOf(single, () => true, { resamples: 200 });
    expect(reading.databases).toBe(1);
    expect(reading.lowPp).toBeNull();
    expect(reading.highPp).toBeNull();
    expect(reading.resolves).toBe(false);
  });

  it('resolves an interval from many clusters and clears only when it excludes zero upward', () => {
    const rows: AdmissionCase[] = [];
    // Twelve databases, six of them repaired by memory on every question and six untouched. A gate
    // that admits exactly the treated half must clear; the mirror must not.
    for (let db = 0; db < 12; db += 1) {
      for (let at = 0; at < 10; at += 1) {
        rows.push(db < 6 ? entry(`x${db}_${at}`, `db${db}`, false, true) : entry(`y${db}_${at}`, `db${db}`, true, true));
      }
    }
    const treated = (row: AdmissionCase): number => Number(row.dbId.slice(2));
    const positive = admissionGainOf(rows, (row) => treated(row) < 6, { resamples: 800 });
    expect(positive.databases).toBe(6);
    expect(positive.resolves).toBe(true);
    expect(positive.netPp).toBeCloseTo(50, 10);
    expect(positive.clears).toBe(true);

    const negative = admissionGainOf(rows, (row) => treated(row) >= 6, { resamples: 800 });
    expect(negative.netPp).toBeCloseTo(0, 10);
    expect(negative.resolves).toBe(false);
    expect(negative.clears).toBe(false);
  });

  it('counts only the databases an admission actually reaches', () => {
    const reading = admissionGainOf([...CORPUS], (row) => row.dbId === 'db2');
    expect(reading.admitted).toBe(3);
    expect(reading.databases).toBe(1);
  });

  it('reports an empty corpus as an empty admission rather than dividing by it', () => {
    const reading = admissionGainOf([], () => true);
    expect(reading.admitted).toBe(0);
    expect(reading.share).toBe(0);
    expect(reading.netPp).toBeNull();
    expect(reading.clears).toBe(false);
  });
});

describe('selfKnowledgeOf', () => {
  const ask = (id: string, dbId: string, question: string, withoutMemoryCorrect: boolean): AdmissionCase =>
    entry(id, dbId, withoutMemoryCorrect, true, { question });

  it('never reads a question back through itself', () => {
    // Two questions, one a near-copy of the other. A leave-one-out score for `a` is built from `b`
    // alone, so a corpus where only `a` failed must report 0 for `a` and 1 for `b`.
    const rows = [
      ask('a', 'db1', 'how many movies were released', false),
      ask('b', 'db1', 'how many movies were released last year', true),
    ];
    const scores = selfKnowledgeOf(rows, { k: 5 });
    expect(scores.get('a')).toBeCloseTo(0, 10);
    expect(scores.get('b')).toBeCloseTo(1, 10);
  });

  it('keeps databases separate even when the questions are identical', () => {
    const rows = [
      ask('a', 'db1', 'list the actors', false),
      ask('b', 'db2', 'list the actors', true),
    ];
    const scores = selfKnowledgeOf(rows, { k: 5 });
    expect(scores.get('a')).toBeNull();
    expect(scores.get('b')).toBeNull();
  });

  it('breaks similarity ties by id so the score is a function of the corpus, not of its order', () => {
    // Four identical questions in one database; two of them failed. With k = 2 a tie-break by id
    // decides which neighbours count, and the answer has to be the same in either input order.
    const rows = [
      ask('a', 'db1', 'count the rows', false),
      ask('b', 'db1', 'count the rows', false),
      ask('c', 'db1', 'count the rows', true),
      ask('d', 'db1', 'count the rows', true),
    ];
    const forward = selfKnowledgeOf(rows, { k: 2 });
    const backward = selfKnowledgeOf([...rows].reverse(), { k: 2 });
    expect([...forward.entries()]).toEqual([...backward.entries()]);
    // `a` and `b` failed, `c` and `d` did not. The two lowest ids are a and b, so `a` sees b and c,
    // `c` sees a and b, and every score is decided by those two.
    expect(forward.get('a')).toBeCloseTo(0.5, 10);
    expect(forward.get('c')).toBeCloseTo(1, 10);
  });

  it('reports no score for a database that holds one question', () => {
    const scores = selfKnowledgeOf([ask('solo', 'db9', 'anything at all', false)], { k: 3 });
    expect(scores.get('solo')).toBeNull();
  });

  it('measures similarity on content tokens only', () => {
    // A three-character floor removes the two- and three-letter function words a question is mostly
    // made of; `the` survives it and is left to the Jaccard denominator, which is why the measure is
    // a ratio rather than a count.
    expect([...tokensOf('The count Of films')].sort()).toEqual(['count', 'films', 'the']);
    expect(similarityOf(tokensOf('count films'), tokensOf('list actors'))).toBe(0);
    expect(similarityOf(tokensOf('count films'), tokensOf('count films'))).toBeCloseTo(1, 10);
    // One shared of three distinct: 1 / 3.
    expect(similarityOf(tokensOf('count films'), tokensOf('films released'))).toBeCloseTo(1 / 3, 10);
    // A question with no content tokens is unmeasured against anything, not perfectly similar to it.
    expect(similarityOf(tokensOf('a of to'), tokensOf('a of to'))).toBe(0);
  });

  it('scores a corpus whose questions share only stopwords as no evidence of failure', () => {
    const rows = [
      ask('a', 'db1', 'the count of films', false),
      ask('b', 'db1', 'the number of actors', true),
    ];
    const scores = selfKnowledgeOf(rows, { k: 1 });
    expect(scores.get('a')).toBeCloseTo(0, 10);
    expect(scores.get('b')).toBeCloseTo(1, 10);
  });

  it('scores an empty-question corpus without dividing by an empty union', () => {
    const rows = [ask('a', 'db1', '', false), ask('b', 'db1', '', true)];
    const scores = selfKnowledgeOf(rows, { k: 1 });
    // Nothing in common and nothing in either question: the neighbour is still chosen by id.
    expect(scores.get('a')).toBeCloseTo(0, 10);
  });

  it('defaults to ten neighbours and admits no evidence when k is zero', () => {
    const rows = Array.from({ length: 12 }, (_, at) => ask(`q${String(at).padStart(2, '0')}`, 'db1', 'count the rows', at < 6));
    // The default k is 10, so each score is a share over ten neighbours.
    const scores = selfKnowledgeOf(rows);
    expect(scores.get('q00')).toBeCloseTo(5 / 10, 10);
    // k = 0 leaves every question without a neighbour, which is missing rather than zero.
    expect(selfKnowledgeOf(rows, { k: 0 }).get('q00')).toBeNull();
  });

  it('orders ids the same way everywhere, including when they are equal', () => {
    expect(compareIds('a', 'b')).toBe(-1);
    expect(compareIds('b', 'a')).toBe(1);
    expect(compareIds('a', 'a')).toBe(0);
  });
});

describe('quantilesOf', () => {
  it('returns the nearest rank up, on a sorted copy it does not mutate', () => {
    const values = [5, 1, 4, 2, 3];
    expect(quantilesOf(values, [0, 25, 50, 100])).toEqual([1, 2, 3, 5]);
    expect(values).toEqual([5, 1, 4, 2, 3]);
  });

  it('clamps a percentile outside the range instead of indexing past the end', () => {
    expect(quantilesOf([7], [-10, 50, 400])).toEqual([7, 7, 7]);
    expect(quantilesOf([], [50])).toEqual([]);
  });
});

describe('splitByDatabase', () => {
  const many: readonly AdmissionCase[] = Array.from({ length: 12 }, (_, at) =>
    entry(`q${at}`, `db${at % 6}`, at % 3 === 0, at % 2 === 0),
  );

  it('never puts a database on both sides', () => {
    const { discovery, confirmation } = splitByDatabase(many);
    const left = new Set(discovery.map((row) => row.dbId));
    const right = new Set(confirmation.map((row) => row.dbId));
    for (const id of left) expect(right.has(id)).toBe(false);
    expect(left.size + right.size).toBe(6);
  });

  it('loses nothing and does not depend on the order of the input', () => {
    const forward = splitByDatabase(many);
    const backward = splitByDatabase([...many].reverse());
    const ids = (rows: readonly AdmissionCase[]): string[] => rows.map((row) => row.id).sort();
    expect(ids(forward.discovery)).toEqual(ids(backward.discovery));
    expect(ids(forward.confirmation)).toEqual(ids(backward.confirmation));
    expect(forward.discovery.length + forward.confirmation.length).toBe(many.length);
  });

  it('puts every question of a one-database corpus on the same side', () => {
    const single = [entry('a', 'only', false, true), entry('b', 'only', true, true)];
    const { discovery, confirmation } = splitByDatabase(single);
    expect(discovery.length + confirmation.length).toBe(2);
    expect(discovery.length === 0 || confirmation.length === 0).toBe(true);
  });
});

describe('admitsOf', () => {
  const row = entry('a', 'db1', false, true, { coverage: 0.25, packIds: 2 });

  it('orients each gate so that a higher score never means the opposite of the label', () => {
    expect(admitsOf('self-knowledge', { value: 0.5 }, row, 0.6)).toBe(true);
    expect(admitsOf('self-knowledge', { value: 0.5 }, row, null)).toBe(false);
    expect(admitsOf('coverage-high', { value: 0.2 }, row, null)).toBe(true);
    expect(admitsOf('coverage-high', { value: 0.3 }, row, null)).toBe(false);
    expect(admitsOf('coverage-low', { value: 0.3 }, row, null)).toBe(true);
    expect(admitsOf('coverage-low', { value: 0.2 }, row, null)).toBe(false);
    expect(admitsOf('pack-two', { value: 0 }, row, null)).toBe(true);
    expect(admitsOf('pack-two', { value: 0 }, entry('b', 'db1', false, true, { packIds: 1 }), null)).toBe(false);
    // The control is never a predicate: an estimator whose control is not reproducible is not one.
    expect(admitsOf('random', { value: 0 }, row, 1)).toBe(false);
  });

  it('requires both halves of the conjunction', () => {
    expect(admitsOf('conjunction', { value: 0.5, coverageFloor: 0.5 }, row, 0.6)).toBe(false);
    const wide = entry('c', 'db1', false, true, { coverage: 0.5 });
    expect(admitsOf('conjunction', { value: 0.5, coverageFloor: 0.5 }, wide, 0.6)).toBe(true);
    expect(admitsOf('conjunction', { value: 0.5, coverageFloor: 0.5 }, wide, null)).toBe(false);
    // An unspecified floor means "no floor", which is what a caller sweeping one threshold expects.
    expect(admitsOf('conjunction', { value: 0.5 }, row, 0.6)).toBe(true);
  });
});

describe('adjudicateR34', () => {
  const reading = (netPp: number, resolves: boolean): AdmissionReading => ({
    admitted: 100,
    share: 0.5,
    databases: 20,
    repaired: 40,
    broken: 30,
    net: 10,
    netPp,
    perAdmittedPp: netPp * 2,
    precision: 0.5,
    recall: 0.25,
    lowPp: resolves ? netPp - 0.2 : null,
    highPp: resolves ? netPp + 0.2 : null,
    resolves,
    clears: resolves && netPp > 0,
  });

  const base = {
    halves: [
      { label: 'discovery', n: 3500, databases: 29, discordant: 220 },
      { label: 'confirmation', n: 3500, databases: 29, discordant: 204 },
    ],
    exchange: exchangeOf(CORPUS),
    precisionBar: 0.4764,
    // The oracle reads §147's two identities: everything repairable is admitted and nothing breaks,
    // and then the mirror. The counts have to match the corpus or P4 is a tautology.
    oracle: {
      repairable: { ...reading(2.671, false), repaired: 2, broken: 0, net: 2 },
      breakable: { ...reading(-3.386, false), repaired: 0, broken: 1, net: -1 },
    },
    control: [{ share: 0.5, deviationPp: 0.02, halfWidthPp: 0.3, covers: true }],
    primary: { discovery: reading(1.2, true), confirmation: reading(0.7, true) },
    relevance: [
      { id: 'coverage-high', reading: reading(0.1, false) },
      { id: 'coverage-low', reading: reading(-0.1, false) },
    ],
  };

  it('holds when every registered condition is met', () => {
    const verdicts = adjudicateR34(base);
    expect(verdicts.map((verdict) => verdict.id)).toEqual(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7']);
    expect(verdicts.filter((verdict) => verdict.holds).map((verdict) => verdict.id)).toEqual([
      'P1',
      'P3',
      'P4',
      'P5',
      'P6',
      'P7',
    ]);
  });

  it('refutes the instrument when a half is too small to hold a discord', () => {
    const verdicts = adjudicateR34({
      ...base,
      halves: [
        { label: 'discovery', n: 3500, databases: 29, discordant: 220 },
        { label: 'confirmation', n: 1200, databases: 4, discordant: 4 },
      ],
    });
    expect(verdicts.find((verdict) => verdict.id === 'P1')?.holds).toBe(false);
  });

  it('refutes the control when random admission does not scale with coverage', () => {
    const verdicts = adjudicateR34({
      ...base,
      control: [{ share: 0.5, deviationPp: 0.4, halfWidthPp: 0.3, covers: false }],
    });
    expect(verdicts.find((verdict) => verdict.id === 'P3')?.holds).toBe(false);
  });

  it('refutes the oracle identity when the two halves do not sum to the corpus', () => {
    const verdicts = adjudicateR34({
      ...base,
      oracle: {
        repairable: { ...reading(2.671, false), repaired: 2, broken: 0, net: 2 },
        breakable: { ...reading(-2.671, false), repaired: 1, broken: 1, net: 0 },
      },
    });
    expect(verdicts.find((verdict) => verdict.id === 'P4')?.holds).toBe(false);
  });

  it('refutes the primary when the interval does not exclude zero', () => {
    const verdicts = adjudicateR34({
      ...base,
      primary: { discovery: reading(1.2, true), confirmation: reading(0.7, false) },
    });
    expect(verdicts.find((verdict) => verdict.id === 'P5')?.holds).toBe(false);
  });

  it('refutes the primary when its precision is under the bar even if the interval clears', () => {
    const weak: AdmissionReading = { ...reading(0.7, true), precision: 0.44 };
    const verdicts = adjudicateR34({ ...base, primary: { discovery: reading(1.2, true), confirmation: weak } });
    expect(verdicts.find((verdict) => verdict.id === 'P5')?.holds).toBe(false);
  });

  it('refutes relevance when either coverage gate clears', () => {
    const verdicts = adjudicateR34({
      ...base,
      relevance: [
        { id: 'coverage-high', reading: reading(0.9, true) },
        { id: 'coverage-low', reading: reading(-0.1, false) },
      ],
    });
    expect(verdicts.find((verdict) => verdict.id === 'P6')?.holds).toBe(false);
  });

  it('refutes the shrinkage prediction when confirmation exceeds discovery', () => {
    const verdicts = adjudicateR34({
      ...base,
      primary: { discovery: reading(0.5, true), confirmation: reading(0.7, true) },
    });
    expect(verdicts.find((verdict) => verdict.id === 'P7')?.holds).toBe(false);
  });

  it('reports an unmeasurable reading as missing rather than as a number', () => {
    const empty: AdmissionReading = {
      admitted: 0,
      share: 0,
      databases: 0,
      repaired: 0,
      broken: 0,
      net: 0,
      netPp: null,
      perAdmittedPp: null,
      precision: null,
      recall: null,
      lowPp: null,
      highPp: null,
      resolves: false,
      clears: false,
    };
    const verdicts = adjudicateR34({
      halves: [{ label: 'confirmation', n: 0, databases: 0, discordant: 0 }],
      exchange: exchangeOf([]),
      precisionBar: null,
      oracle: { repairable: empty, breakable: empty },
      control: [],
      primary: { discovery: empty, confirmation: empty },
      relevance: [{ id: 'coverage-high', reading: empty }],
    });
    // Nothing is measurable, so nothing holds: an empty run is not a quiet success.
    expect(verdicts.every((verdict) => !verdict.holds)).toBe(true);
    expect(verdicts.find((verdict) => verdict.id === 'P5')?.observed).toContain('n/a');
    expect(verdicts.find((verdict) => verdict.id === 'P2')?.observed).toContain('n/a');
  });

  it('refutes the oracle identity when its two arms do not carry the corpus counts', () => {
    const verdicts = adjudicateR34({
      ...base,
      oracle: {
        repairable: { ...reading(2.671, false), repaired: 2, broken: 0, net: 1 },
        breakable: { ...reading(-3.386, false), repaired: 0, broken: 1, net: -1 },
      },
    });
    expect(verdicts.find((verdict) => verdict.id === 'P4')?.holds).toBe(false);
  });

  it('reports P2 as a comparison of the exchange with its hurdle, not as a restatement', () => {
    const parity = adjudicateR34({ ...base, exchange: exchangeOf(CORPUS) });
    expect(parity.find((verdict) => verdict.id === 'P2')?.holds).toBe(false);
    const failing = adjudicateR34({
      ...base,
      exchange: {
        ...exchangeOf(CORPUS),
        helpPerHarm: 0.5,
        hurdle: 1.4,
      },
    });
    expect(failing.find((verdict) => verdict.id === 'P2')?.holds).toBe(true);
  });
});
