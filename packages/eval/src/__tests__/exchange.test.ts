import { describe, expect, it } from 'vitest';
import {
  CENSUS_HEADER,
  CENSUS_RULE,
  censusLine,
  exchangeCensus,
  deltaPpOf,
  exchangeCensusOf,
  pairRows,
  perCaseRows,
  type ExchangeRow,
} from '../exchange.js';

/** A run of identical rows, which keeps a fixture's shape readable at the call site. */
function run(count: number, correct: boolean, without: boolean, cluster = 'db'): ExchangeRow[] {
  return Array.from({ length: count }, () => ({ cluster, correct, withoutMemoryCorrect: without }));
}

/**
 * The same rows with one cluster each.
 *
 * A fixture that puts a thousand rows in one cluster cannot resolve anything, and one that spreads a
 * uniform mix over eleven clusters resolves everything, because every cluster then looks like the
 * corpus. Real arms are neither: their clusters differ, which is what the interval is for.
 */
function spread(count: number, correct: boolean, without: boolean, prefix: string): ExchangeRow[] {
  return Array.from({ length: count }, (_, at) => ({
    cluster: `${prefix}${String(at)}`,
    correct,
    withoutMemoryCorrect: without,
  }));
}

/** The BIRD dev lexicon cell, as rows: 78 repaired, 67 broken, 581 unchanged-wrong, 808 unchanged-right. */
function lexiconShape(cluster: (at: number) => string): ExchangeRow[] {
  const rows = [...run(78, true, false), ...run(67, false, true), ...run(581, false, false), ...run(808, true, true)];
  return rows.map((row, at) => ({ ...row, cluster: cluster(at) }));
}

describe('the census of one arm', () => {
  it('counts both bases and both outcomes, and reports the decision statistic', () => {
    const rows: ExchangeRow[] = [
      { cluster: 'db1', correct: true, withoutMemoryCorrect: false },
      { cluster: 'db1', correct: false, withoutMemoryCorrect: false },
      { cluster: 'db1', correct: true, withoutMemoryCorrect: true },
      { cluster: 'db2', correct: false, withoutMemoryCorrect: true },
      { cluster: 'db2', correct: true, withoutMemoryCorrect: true },
      { cluster: 'db2', correct: false, withoutMemoryCorrect: true },
    ];
    const census = exchangeCensusOf('fixture', rows);
    expect(census.n).toBe(6);
    expect(census.clusters).toBe(2);
    expect(census.repairable).toBe(2);
    expect(census.breakable).toBe(4);
    expect(census.repaired).toBe(1);
    expect(census.broken).toBe(2);
    // One repair against two breaks is 0.5, and the net is −1 question of 6.
    expect(census.netOdds).toBeCloseTo(0.5, 12);
    expect(census.netPp).toBeCloseTo((-1 / 6) * 100, 12);
    expect(census.deltaPp).toBeCloseTo(census.netPp, 12);
    // Parity is the corpus's own odds — a property of the corpus, carried but never divided by.
    expect(census.parity).toBeCloseTo(4 / 2, 12);
  });

  it('reads the delta as the share of questions whose outcome changed, signed', () => {
    expect(deltaPpOf(run(3, true, false))).toBeCloseTo(100, 12);
    expect(deltaPpOf(run(4, false, true))).toBeCloseTo(-100, 12);
    expect(deltaPpOf([...run(1, true, false), ...run(1, false, true)])).toBeCloseTo(0, 12);
    expect(deltaPpOf([...run(2, true, true)])).toBeCloseTo(0, 12);
  });

  it('says an arm pays when every break is outweighed, and loses when it is not', () => {
    const pays = exchangeCensusOf('pays', [...spread(40, true, false, 'a'), ...spread(60, true, true, 'b')]);
    expect(pays.verdict).toBe('pays');
    expect(pays.statement).toContain('the memory pays');
    const loses = exchangeCensusOf('loses', [...spread(40, false, true, 'a'), ...spread(60, true, true, 'b')]);
    expect(loses.verdict).toBe('loses');
    expect(loses.statement).toContain('the memory loses');
  });

  it('leaves an arm that neither repaired nor broke anything unresolved', () => {
    const quiet = exchangeCensusOf('quiet', [...run(5, true, true, 'a'), ...run(5, false, false, 'b')]);
    expect(quiet.repaired).toBe(0);
    expect(quiet.broken).toBe(0);
    expect(quiet.netOdds).toBeNull();
    // An exchange rate over no breaks does not exist, and the interval says so rather than reporting
    // infinity: every resample of this arm has the same zero denominator.
    expect(quiet.netOddsInterval).toBeNull();
    expect(quiet.verdict).toBe('unresolved');
    expect(quiet.statement).toContain('no exchange rate to form');
  });

  it('widens the interval when the correlation is in the data rather than in the count', () => {
    // The same rows, clustered two ways. One cluster means the resample can only return the whole
    // sample, so the interval collapses to the point — which is exactly the error an unclustered
    // bootstrap makes when it treats twenty questions from one database as twenty draws.
    const oneCluster = exchangeCensusOf('one', lexiconShape(() => 'db'));
    expect(oneCluster.deltaInterval.low).toBeCloseTo(oneCluster.deltaPp, 12);
    expect(oneCluster.deltaInterval.high).toBeCloseTo(oneCluster.deltaPp, 12);

    // Eleven clusters, and the discordance is not spread evenly: three repair 20 rows each, one breaks
    // 40, seven are untouched. That is what a real arm looks like — BIRD's harm sits in a handful of
    // databases — and it is why the interval has to be clustered rather than per question.
    const concentrated: ExchangeRow[] = [
      ...run(20, true, false, 'r0'),
      ...run(480, true, true, 'r0'),
      ...run(20, true, false, 'r1'),
      ...run(480, true, true, 'r1'),
      ...run(20, true, false, 'r2'),
      ...run(480, true, true, 'r2'),
      ...run(40, false, true, 'b3'),
      ...run(460, true, true, 'b3'),
      ...Array.from({ length: 7 }, (_, at) => run(500, true, true, `u${String(at)}`)).flat(),
    ];
    const eleven = exchangeCensusOf('eleven', concentrated);
    const width = (census: { deltaInterval: { low: number; high: number } }): number =>
      census.deltaInterval.high - census.deltaInterval.low;
    expect(eleven.clusters).toBe(11);
    expect(width(eleven)).toBeGreaterThan(0);
    expect(eleven.verdict).toBe('unresolved');
    // The point estimate does not change with the clustering — only what the record may say about it.
    expect(eleven.netPp).toBeCloseTo(((60 - 40) / 5500) * 100, 12);
  });

  it('is deterministic, because a gate that moves is re-run until it passes', () => {
    const rows = lexiconShape((at) => `db${String(at % 11)}`);
    expect(exchangeCensusOf('a', rows)).toEqual(exchangeCensusOf('a', rows));
  });

  it('carries the verdict into one sentence built from its own numbers', () => {
    const census = exchangeCensusOf('arm', lexiconShape(() => 'db'));
    expect(census.statement).toContain('78 repaired against 67 broken');
    expect(census.statement).toContain('pays');
    expect(census.statement).toContain('exchange rate of 1.164');
  });
});

describe('what the census refuses', () => {
  it('refuses an empty arm rather than reporting a rule of zero', () => {
    expect(() => exchangeCensusOf('empty', [])).toThrow(/at least one case/);
  });

  it('refuses a case with no cluster, because an unclustered case cannot be resampled', () => {
    expect(() => exchangeCensusOf('x', [{ cluster: '', correct: true, withoutMemoryCorrect: false }])).toThrow(
      /empty one is not a label/,
    );
    expect(() =>
      exchangeCensusOf('x', [{ cluster: 3 as unknown as string, correct: true, withoutMemoryCorrect: false }]),
    ).toThrow(/empty one is not a label/);
  });

  it('refuses an outcome that is not an outcome', () => {
    expect(() =>
      exchangeCensusOf('x', [{ cluster: 'db', correct: 'yes' as unknown as boolean, withoutMemoryCorrect: false }]),
    ).toThrow(/not a boolean/);
  });
});

describe('reading rows out of the artefacts this repository commits', () => {
  const perCase = {
    per_case: [
      { dbId: 'a', correct: true, withoutMemoryCorrect: false },
      { dbId: 'b', correct: false, withoutMemoryCorrect: true },
    ],
  };
  const pair = {
    transfer: {
      ledger: [
        { task: 'retail/1', withMemoryCorrect: true, blankCorrect: false },
        { task: 'retail/2', withMemoryCorrect: false, blankCorrect: true },
      ],
    },
  };

  it('takes the database as the cluster, because every question in one shares its schema', () => {
    expect(perCaseRows(perCase, 'arm')).toEqual([
      { cluster: 'a', correct: true, withoutMemoryCorrect: false },
      { cluster: 'b', correct: false, withoutMemoryCorrect: true },
    ]);
  });

  it('takes the task as the cluster, because four draws re-run the same forty tasks', () => {
    expect(pairRows(pair, 'fold')).toEqual([
      { cluster: 'retail/1', correct: true, withoutMemoryCorrect: false },
      { cluster: 'retail/2', correct: false, withoutMemoryCorrect: true },
    ]);
  });

  it('names the row it could not read instead of skipping it', () => {
    expect(() => perCaseRows({ per_case: [{ correct: true, withoutMemoryCorrect: false }] }, 'arm')).toThrow(
      /arm.per_case\[0\] carries no dbId/,
    );
    expect(() => perCaseRows({ per_case: [{ dbId: 'a', correct: true }] }, 'arm')).toThrow(
      /arm.per_case\[0\] does not carry both arms/,
    );
    expect(() => perCaseRows({ per_case: 'none' }, 'arm')).toThrow(/arm carries no per_case array/);
    expect(() => perCaseRows(null, 'arm')).toThrow(/arm is not an object/);
    expect(() => pairRows({ transfer: {} }, 'fold')).toThrow(/fold.transfer carries no ledger array/);
    expect(() => pairRows({}, 'fold')).toThrow(/fold.transfer is not an object/);
    expect(() => pairRows({ transfer: { ledger: [{ withMemoryCorrect: true, blankCorrect: false }] } }, 'f')).toThrow(
      /f.transfer.ledger\[0\] carries no task/,
    );
    expect(() => pairRows({ transfer: { ledger: [{ task: 'retail/1', correct: true }] } }, 'f')).toThrow(
      /f.transfer.ledger\[0\] does not carry both arms/,
    );
  });
});

describe('the census over several arms', () => {
  const files: Record<string, unknown> = {
    'one.json': { per_case: [{ dbId: 'a', correct: true, withoutMemoryCorrect: false }] },
    'two.json': { per_case: [{ dbId: 'a', correct: false, withoutMemoryCorrect: false }] },
    'pair-a.json': { transfer: { ledger: [{ task: 't1', withMemoryCorrect: true, blankCorrect: false }] } },
    'pair-b.json': { transfer: { ledger: [{ task: 't2', withMemoryCorrect: true, blankCorrect: false }] } },
  };
  const load = (path: string): unknown => files[path.split('/').pop() as string];
  const sources = [
    { name: 'single', kind: 'per_case' as const, paths: ['eval/results/one.json'] },
    { name: 'pooled', kind: 'pair' as const, paths: ['eval/results/pair-a.json', 'eval/results/pair-b.json'] },
  ];

  it('reads every path a source is written across, and records them in the entry', () => {
    const census = exchangeCensus(sources, load, 200);
    expect(census.id).toBe('poc-exchange-census');
    expect(census.resamples).toBe(200);
    expect(census.rule).toBe(CENSUS_RULE);
    expect(census.sources.map((entry) => entry.source)).toEqual(['single', 'pooled']);
    expect(census.sources[1]?.n).toBe(2);
    expect(census.sources[1]?.clusters).toBe(2);
    expect(census.sources[1]?.paths).toEqual(['eval/results/pair-a.json', 'eval/results/pair-b.json']);
    // One arm, two tasks, both repaired: it pays by every reading.
    expect(census.sources[1]?.verdict).toBe('pays');
  });

  it('hands the loader one call per path, in the order the source lists them', () => {
    const seen: string[] = [];
    exchangeCensus(sources, (path) => {
      seen.push(path);
      return load(path);
    }, 100);
    expect(seen).toEqual([
      'eval/results/one.json',
      'eval/results/pair-a.json',
      'eval/results/pair-b.json',
    ]);
  });
});

describe('the table the census prints', () => {
  it('aligns a row under its own header, column for column', () => {
    const census = exchangeCensusOf('bird-train', [
      ...spread(187, true, false, 'r-'),
      ...spread(237, false, true, 'b-'),
      ...spread(6576, true, true, 'p-'),
    ]);
    const line = censusLine(census);
    expect(line.indexOf('loses')).toBe(CENSUS_HEADER.indexOf('verdict'));
    expect(line.startsWith('bird-train')).toBe(true);
    expect(line).toContain('0.789');
  });

  it('prints the debt of a broken denominator rather than a number', () => {
    const census = exchangeCensusOf('quiet', [...run(3, true, true, 'a'), ...run(3, false, false, 'b')]);
    expect(censusLine(census)).toContain('—');
  });
});
