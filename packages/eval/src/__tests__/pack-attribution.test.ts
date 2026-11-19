import { describe, expect, it } from 'vitest';
import { mulberry32 } from '@agentix-e/microglia-core';
import {
  ATTRIBUTION_SOURCES,
  MIN_COMPARABLE,
  attributionCensus,
  circulationContrasts,
  contrastOf,
  doseOf,
  doseLines,
  filterLines,
  filterPriceOf,
  gainOf,
  ledgerLines,
  ledgerOf,
  mentionsOf,
  screenLines,
  statementScreen,
  stratumLines,
  unsupportedOf,
  unusedConstructsOf,
  type AttributionEntry,
} from '../pack-attribution.js';
import type { PackCopyRow } from '../pack-copy.js';
import { clusterBootstrapRatio, clusterBootstrapStatistic } from '../stats.js';

/** A case, with the two arms' outcomes and the pack it received. */
function row(over: Partial<PackCopyRow> & { readonly gold?: string } = {}): PackCopyRow {
  return {
    cluster: over.cluster ?? 'a',
    correct: over.correct ?? true,
    withoutMemoryCorrect: over.withoutMemoryCorrect ?? true,
    statements: over.statements ?? [],
    goldSql: over.goldSql ?? over.gold ?? 'SELECT a FROM t',
  };
}

describe('gainOf', () => {
  it('reads the pack as a change and not as a score', () => {
    expect(gainOf(row({ correct: true, withoutMemoryCorrect: false }))).toBe(1);
    expect(gainOf(row({ correct: false, withoutMemoryCorrect: true }))).toBe(-1);
    expect(gainOf(row({ correct: true, withoutMemoryCorrect: true }))).toBe(0);
    expect(gainOf(row({ correct: false, withoutMemoryCorrect: false }))).toBe(0);
  });
});

describe('contrastOf', () => {
  /**
   * Two databases, chosen so the arithmetic is exact. Exposure is a marker statement, because the
   * comparison is always inside a database and a predicate that picks whole databases compares
   * nothing. A holds three exposed cases whose gains sum to +2 against two cases at 0, and B holds
   * one exposed case at −1 against two at 0. (2 − 3·0) + (−1 − 1·0) = 1 over 4 exposed cases, so the
   * contrast is +25.00pp.
   */
  const marked = { statements: ['Marker.'] } as const;
  const bare = { statements: [] } as const;
  const fixture: readonly PackCopyRow[] = [
    row({ cluster: 'a', statements: ['Marker.'], correct: true, withoutMemoryCorrect: false }),
    row({ cluster: 'a', statements: ['Marker.'], correct: true, withoutMemoryCorrect: false }),
    row({ cluster: 'a', statements: ['Marker.'], correct: true, withoutMemoryCorrect: true }),
    row({ cluster: 'a', statements: [], correct: true, withoutMemoryCorrect: true }),
    row({ cluster: 'a', statements: [], correct: true, withoutMemoryCorrect: true }),
    row({ cluster: 'b', statements: ['Marker.'], correct: false, withoutMemoryCorrect: true }),
    row({ cluster: 'b', statements: [], correct: true, withoutMemoryCorrect: true }),
    row({ cluster: 'b', statements: [], correct: true, withoutMemoryCorrect: true }),
  ];
  const isMarked = (entry: PackCopyRow): boolean => entry.statements.includes(marked.statements[0]);

  it('weights each database by its exposed cases and reports in percentage points', () => {
    const result = contrastOf(fixture, isMarked, 200);
    expect(result).not.toBeNull();
    expect(result?.exposed).toBe(4);
    expect(result?.comparable).toBe(2);
    expect(result?.att).toBe(4);
    expect(result?.contrast.point).toBeCloseTo(25, 6);
    expect(result?.contrast.low).toBeLessThanOrEqual(25);
    expect(result?.contrast.high).toBeGreaterThanOrEqual(25);
  });

  it('refuses to estimate when no database can form both sides', () => {
    const oneSided = [row({ cluster: 'a', statements: ['Marker.'] }), row({ cluster: 'b' })];
    expect(contrastOf(oneSided, isMarked, 100)).toBeNull();
  });

  it('gives a single comparable database its own value as both bounds', () => {
    const single = [
      row({ cluster: 'a', statements: ['Marker.'], correct: true, withoutMemoryCorrect: false }),
      row({ cluster: 'a', statements: [], correct: false, withoutMemoryCorrect: true }),
      row({ cluster: 'b', statements: [], correct: true, withoutMemoryCorrect: true }),
      row({ cluster: 'b', statements: [], correct: true, withoutMemoryCorrect: true }),
    ];
    const result = contrastOf(single, isMarked, 100);
    // Only A can compare, because B received the marker nowhere; exposure is still one case, and the
    // weight the estimate rests on is that same case.
    expect(result?.exposed).toBe(1);
    expect(result?.comparable).toBe(1);
    // A holds one gain of +1 against one of −1, so the contrast is 1 − (−1) = +2 over one case.
    expect(result?.contrast.point).toBeCloseTo(200, 6);
    expect(result?.contrast.low).toBeCloseTo(200, 6);
    expect(result?.contrast.high).toBeCloseTo(200, 6);
  });
});

describe('statementScreen', () => {
  /** Six databases, so a statement can clear the floor of five comparable clusters. */
  function corpus(): PackCopyRow[] {
    const rows: PackCopyRow[] = [];
    for (const cluster of ['a', 'b', 'c', 'd', 'e', 'f']) {
      rows.push(row({ cluster, statements: ['Wide rule.'], correct: false, withoutMemoryCorrect: true }));
      rows.push(row({ cluster, statements: [], correct: true, withoutMemoryCorrect: true }));
    }
    rows.push(row({ cluster: 'a', statements: ['Narrow rule.'], correct: true, withoutMemoryCorrect: true }));
    rows.push(row({ cluster: 'a', statements: [], correct: true, withoutMemoryCorrect: true }));
    return rows;
  }

  it('screens a statement only when five databases can compare it', () => {
    const screens = statementScreen(corpus(), { resamples: 100 });
    const wide = screens.find((entry) => entry.statement === 'Wide rule.');
    const narrow = screens.find((entry) => entry.statement === 'Narrow rule.');
    expect(wide?.comparable).toBe(6);
    expect(wide?.contrast).not.toBeNull();
    expect(narrow?.comparable).toBe(1);
    expect(narrow?.contrast).toBeNull();
    expect(narrow?.resolved).toBe(false);
    // The point estimate survives the interval's absence: it is arithmetic, not an inference.
    expect(narrow?.cases).toBe(1);
  });

  it('carries the screen floor as a constant the artefact can cite', () => {
    expect(MIN_COMPARABLE).toBe(5);
  });

  it('reads a statement delivered to every case in a database as uncountable there', () => {
    // The only case in `b` carries the rule, so `b` has no rest side and cannot contribute.
    const rows = [
      row({ cluster: 'a', statements: ['Everywhere.'] }),
      row({ cluster: 'a', statements: [] }),
      row({ cluster: 'b', statements: ['Everywhere.'] }),
    ];
    const screens = statementScreen(rows, { resamples: 50 });
    const everywhere = screens.find((entry) => entry.statement === 'Everywhere.');
    expect(everywhere?.databases).toBe(2);
    expect(everywhere?.comparable).toBe(1);
    expect(everywhere?.cases).toBe(2);
  });

  it('takes its own defaults when called with no options', () => {
    const screens = statementScreen(corpus());
    expect(screens.length).toBe(2);
    // The default resample count still produces an interval for the statement six databases compare.
    expect(screens.find((entry) => entry.statement === 'Wide rule.')?.contrast).not.toBeNull();
  });

  it('orders statements with no interval last, and sorts them by exposure then by text', () => {
    const rows = [
      row({ cluster: 'a', statements: ['Beta.', 'Alpha.'] }),
      row({ cluster: 'a', statements: [] }),
      row({ cluster: 'b', statements: ['Beta.', 'Gamma.'] }),
      row({ cluster: 'b', statements: [] }),
    ];
    const screens = statementScreen(rows, { resamples: 20 });
    // All three are below the floor, so all three carry no interval: the order is exposure first —
    // Beta reaches two cases, Alpha and Gamma one each — and then the statement's own text.
    expect(screens.map((entry) => entry.statement)).toEqual(['Beta.', 'Alpha.', 'Gamma.']);
  });

  it('sorts the worst contrast first and breaks ties by exposure', () => {
    const rows = corpus();
    rows.push(row({ cluster: 'b', statements: ['Harmful rule.'], correct: false, withoutMemoryCorrect: true }));
    rows.push(row({ cluster: 'b', statements: [], correct: true, withoutMemoryCorrect: true }));
    const screens = statementScreen(rows, { resamples: 50 });
    expect(screens[0]?.statement).toBe('Wide rule.');
    expect(screens.at(-1)?.contrast).toBeNull();
    const points = screens.filter((entry) => entry.contrast !== null).map((entry) => entry.contrast?.point as number);
    expect([...points].sort((left, right) => left - right)).toEqual(points);
  });

  it('does not let a shared statement be counted twice inside one case', () => {
    const rows = [
      row({ cluster: 'a', statements: ['Twice.', 'Twice.'] }),
      row({ cluster: 'a', statements: [] }),
    ];
    const screens = statementScreen(rows, { resamples: 20 });
    expect(screens[0]?.cases).toBe(1);
  });
});

describe('ledgerOf', () => {
  const screen = (statement: string, point: number, cases: number, resolved: boolean) => ({
    statement,
    cases,
    databases: 6,
    comparable: 6,
    att: cases,
    contrast: { low: resolved ? point - 1 : point - 50, high: resolved ? point + 1 : point + 50, point, dropped: 0 },
    resolved,
  });

  it('compares the resolved count with what five per cent would produce', () => {
    const ledger = ledgerOf([screen('a', -3, 100, true), screen('b', 4, 100, true), screen('c', 0.2, 100, false)], 1000);
    expect(ledger.statements).toBe(3);
    expect(ledger.screened).toBe(3);
    expect(ledger.resolved).toBe(2);
    expect(ledger.expected).toBeCloseTo(0.15, 6);
    expect(ledger.negative).toBe(1);
    expect(ledger.positive).toBe(1);
    // |−3| × 100 / 1000 = 0.30pp of the corpus, and the positive statement contributes nothing.
    expect(ledger.massAtRiskPp).toBeCloseTo(0.3, 6);
  });

  it('counts only the resolved statements as screened-and-negative', () => {
    const ledger = ledgerOf([screen('a', -3, 100, false), screen('b', -9, 10, true)], 100);
    expect(ledger.negative).toBe(1);
    expect(ledger.massAtRiskPp).toBeCloseTo(0.9, 6);
  });

  it('reads an empty screen as an empty ledger rather than as a clean corpus', () => {
    const ledger = ledgerOf([], 10);
    expect(ledger).toEqual({ statements: 0, screened: 0, resolved: 0, expected: 0, negative: 0, positive: 0, massAtRiskPp: 0 });
  });
});

describe('mentionsOf', () => {
  it('names every construct the record can measure', () => {
    expect([...mentionsOf('Return the count(*) with DISTINCT and an ORDER BY.')].sort()).toEqual(['count-star', 'distinct', 'order-by']);
    expect([...mentionsOf('Wrap the ratio in a CAST and ROUND it.')].sort()).toEqual(['cast', 'round']);
    expect([...mentionsOf('The result is left unaliased unless the question names it.')]).toEqual(['select-alias']);
    expect([...mentionsOf('Join the table, then LIMIT the UNION of subqueries.')].sort()).toEqual(['join', 'limit', 'subquery', 'union']);
    expect([...mentionsOf('A prefix match uses LIKE.')]).toEqual(['like']);
  });

  it('finds nothing in a sentence that names no machinery', () => {
    expect([...mentionsOf('Categorical values must match the stored casing.')]).toEqual([]);
  });

  it('reads mentions and not denials, which is what makes the converse axis possible', () => {
    // The denial reader in `pack-copy` fires only on a cue bound to the construct; this one fires on
    // the mention, because a rule *prescribes* by naming.
    expect([...mentionsOf('Not DISTINCT here.')]).toEqual(['distinct']);
    expect([...mentionsOf('DISTINCT here.')]).toEqual(['distinct']);
  });
});

describe('unsupportedOf and unusedConstructsOf', () => {
  it('counts statements naming a construct the gold does not use', () => {
    const entry = row({ statements: ['Use DISTINCT.', 'Use JOIN.', 'Match the casing.'], gold: 'SELECT a FROM t' });
    expect(unsupportedOf(entry)).toBe(2);
    expect([...unusedConstructsOf(entry)].sort()).toEqual(['distinct', 'join']);
  });

  it('treats a statement that names nothing as supported, because nothing can refute it', () => {
    const entry = row({ statements: ['Match the stored casing.'], gold: 'SELECT a FROM t' });
    expect(unsupportedOf(entry)).toBe(0);
    expect([...unusedConstructsOf(entry)]).toEqual([]);
  });

  it('counts a statement once even when it names two unused constructs', () => {
    const entry = row({ statements: ['Return DISTINCT rows with LIMIT.'], gold: 'SELECT a FROM t' });
    expect(unsupportedOf(entry)).toBe(1);
    expect([...unusedConstructsOf(entry)].sort()).toEqual(['distinct', 'limit']);
  });

  it('reads the gold through the shared shape, so a literal is not a construct', () => {
    const entry = row({ statements: ['Use DISTINCT.'], gold: "SELECT a FROM t WHERE label = 'distinct'" });
    expect(unsupportedOf(entry)).toBe(1);
  });
});

describe('circulationContrasts', () => {
  it('puts an empty pack in `none` rather than in a stratum of its own', () => {
    const rows = [
      row({ cluster: 'a', statements: ['Boilerplate.'] }),
      row({ cluster: 'b', statements: ['Boilerplate.'] }),
      row({ cluster: 'a', statements: ['Local.'] }),
      row({ cluster: 'b', statements: [] }),
    ];
    const strata = circulationContrasts(rows, 50);
    expect(strata.map((entry) => entry.stratum)).toEqual(['none', 'mixed', 'all']);
    // Both the local note and the empty pack sit in `none`; if either were scored as `mixed` the
    // stratum's exposure count would move.
    expect(strata[0]?.result?.exposed).toBe(2);
  });

  it('puts a pack that circulates in part into `mixed`', () => {
    const rows = [
      row({ cluster: 'a', statements: ['Boilerplate.'] }),
      row({ cluster: 'b', statements: ['Boilerplate.'] }),
      row({ cluster: 'a', statements: ['Boilerplate.', 'Only here.'] }),
      row({ cluster: 'a', statements: [] }),
      row({ cluster: 'b', statements: ['Local.'] }),
    ];
    const strata = circulationContrasts(rows, 50);
    const mixed = strata.find((entry) => entry.stratum === 'mixed');
    // One statement of two crossed a database boundary, so the share is 0.5 and the case is `mixed`.
    expect(mixed?.result?.exposed).toBe(1);
  });

  it('refuses a stratum no database can split', () => {
    const rows = [row({ cluster: 'a', statements: [] }), row({ cluster: 'b', statements: [] })];
    const strata = circulationContrasts(rows, 20);
    // Every case is in `none`, so only `none` has an exposed side and none has a rest side.
    expect(strata.every((entry) => entry.result === null)).toBe(true);
  });
});

describe('doseOf', () => {
  /** A naive within-cluster fit, computed the slow way, to check the sufficient statistics. */
  function naive(rows: readonly PackCopyRow[], predictors: readonly ((row: PackCopyRow) => number)[]): number[] {
    const design = rows.map((entry) => predictors.map((of) => of(entry)));
    const outcome = rows.map((entry) => gainOf(entry));
    const clusters = [...new Set(rows.map((entry) => entry.cluster))];
    const width = predictors.length;
    const matrix = Array.from({ length: width }, () => new Array<number>(width).fill(0));
    const vector = new Array<number>(width).fill(0);
    for (const cluster of clusters) {
      const at = rows.map((entry, index) => (entry.cluster === cluster ? index : -1)).filter((index) => index >= 0);
      const means = new Array<number>(width).fill(0);
      for (const index of at) for (let column = 0; column < width; column += 1) means[column] = (means[column] as number) + (design[index]?.[column] as number);
      for (let column = 0; column < width; column += 1) means[column] = (means[column] as number) / at.length;
      const outcomeMean = at.reduce((total, index) => total + (outcome[index] as number), 0) / at.length;
      for (const index of at) {
        const centred = (design[index] as number[]).map((value, column) => value - (means[column] as number));
        const residual = (outcome[index] as number) - outcomeMean;
        for (let left = 0; left < width; left += 1) {
          vector[left] = (vector[left] as number) + (centred[left] as number) * residual;
          for (let right = 0; right < width; right += 1) {
            matrix[left]![right] = (matrix[left]?.[right] as number) + (centred[left] as number) * (centred[right] as number);
          }
        }
      }
    }
    return solve(matrix, vector);
  }

  function solve(matrix: number[][], vector: number[]): number[] {
    const size = matrix.length;
    const work = matrix.map((line, at) => [...line, vector[at] as number]);
    for (let pivot = 0; pivot < size; pivot += 1) {
      const lead = work[pivot]?.[pivot] as number;
      for (let row = pivot + 1; row < size; row += 1) {
        const factor = (work[row]?.[pivot] as number) / lead;
        for (let column = pivot; column <= size; column += 1) {
          work[row]![column] = (work[row]?.[column] as number) - factor * (work[pivot]?.[column] as number);
        }
      }
    }
    const answer = new Array<number>(size).fill(0);
    for (let row = size - 1; row >= 0; row -= 1) {
      let total = work[row]?.[size] as number;
      for (let column = row + 1; column < size; column += 1) total -= (work[row]?.[column] as number) * (answer[column] as number);
      answer[row] = total / (work[row]?.[row] as number);
    }
    return answer;
  }

  /**
   * Two databases whose packs vary in size and in whether the gold honours them, so the two
   * predictors are not collinear: `(size, unsupported)` takes the values (1,0), (1,1), (2,1) and
   * (0,0) in each database.
   */
  const rows: readonly PackCopyRow[] = [
    row({ cluster: 'a', statements: ['Use DISTINCT.'], gold: 'SELECT DISTINCT a FROM t', correct: true, withoutMemoryCorrect: false }),
    row({ cluster: 'a', statements: ['Use LIMIT.'], gold: 'SELECT a FROM t', correct: false, withoutMemoryCorrect: true }),
    row({ cluster: 'a', statements: ['Use LIMIT.', 'Match the casing.'], gold: 'SELECT a FROM t', correct: true, withoutMemoryCorrect: true }),
    row({ cluster: 'a', statements: [], gold: 'SELECT a FROM t', correct: true, withoutMemoryCorrect: true }),
    row({ cluster: 'b', statements: ['Use DISTINCT.'], gold: 'SELECT DISTINCT a FROM t', correct: true, withoutMemoryCorrect: false }),
    row({ cluster: 'b', statements: [], gold: 'SELECT a FROM t', correct: true, withoutMemoryCorrect: true }),
    row({ cluster: 'b', statements: ['Use LIMIT.'], gold: 'SELECT a FROM t', correct: false, withoutMemoryCorrect: true }),
    row({ cluster: 'b', statements: ['Use LIMIT.', 'Match the casing.'], gold: 'SELECT a FROM t', correct: true, withoutMemoryCorrect: true }),
  ];
  const predictors = [
    { name: 'statements', of: (entry: PackCopyRow) => entry.statements.length },
    { name: 'unsupported', of: (entry: PackCopyRow) => unsupportedOf(entry) },
  ];

  it('matches a naive within-cluster fit, which is what the sufficient statistics claim', () => {
    const fit = doseOf(rows, predictors, 100);
    const expected = naive(rows, predictors.map((predictor) => predictor.of));
    expect(fit).not.toBeNull();
    expect(fit?.predictors).toEqual(['statements', 'unsupported']);
    expect(fit?.cases).toBe(rows.length);
    expect(fit?.clusters).toBe(2);
    expect(fit?.coefficients[0]).toBeCloseTo((expected[0] as number) * 100, 8);
    expect(fit?.coefficients[1]).toBeCloseTo((expected[1] as number) * 100, 8);
  });

  it('draws the same clusters the generic loop draws, so the interval is the same experiment', () => {
    // The naive bootstrap rebuilds the rows a draw selects and refits; the module reweights the
    // per-cluster cross-products and solves. Same seed, same draw count, same answer or a defect.
    const fit = doseOf(rows, predictors, 200, 777);
    const clusters = [...new Set(rows.map((entry) => entry.cluster))];
    const random = mulberry32(777);
    const samples: number[][] = [[], []];
    for (let draw = 0; draw < 200; draw += 1) {
      const picked: string[] = [];
      for (let at = 0; at < clusters.length; at += 1) picked.push(clusters[Math.floor(random() * clusters.length)] as string);
      const drawn = picked.flatMap((cluster) => rows.filter((entry) => entry.cluster === cluster));
      const fitted = naive(drawn, predictors.map((predictor) => predictor.of));
      samples[0]?.push((fitted[0] as number) * 100);
      samples[1]?.push((fitted[1] as number) * 100);
    }
    for (const [at, values] of samples.entries()) {
      values.sort((left, right) => left - right);
      const low = values[Math.floor(0.025 * (values.length - 1))] as number;
      const high = values[Math.ceil(0.975 * (values.length - 1))] as number;
      expect(fit?.intervals[at]?.low).toBeCloseTo(low, 6);
      expect(fit?.intervals[at]?.high).toBeCloseTo(high, 6);
    }
  });

  it('gives a single-cluster corpus its own value as both bounds', () => {
    const single = rows.filter((entry) => entry.cluster === 'a');
    const fit = doseOf(single, predictors, 50);
    expect(fit?.clusters).toBe(1);
    expect(fit?.intervals[0]?.low).toBeCloseTo(fit?.coefficients[0] as number, 9);
    expect(fit?.intervals[0]?.high).toBeCloseTo(fit?.coefficients[0] as number, 9);
  });

  it('gives a point estimate and no interval when asked for no resamples', () => {
    const fit = doseOf(rows, predictors, 0);
    expect(fit?.coefficients).toHaveLength(2);
    expect(fit?.intervals[0]).toBeNull();
    expect(fit?.intervals[1]).toBeNull();
  });

  it('pivots on the largest remaining entry, so a small lead does not scale the solve', () => {
    // Three predictors whose within-cluster sums of squares rise steeply: the first pivot is the
    // smallest of the three, so the elimination has to swap rows before it can divide. The six
    // design points per database are not collinear, which is what makes the cross-product invertible.
    const shape = [
      { size: 2, correct: true, without: false },
      { size: 0, correct: false, without: true },
      { size: 1, correct: true, without: true },
      { size: 0, correct: true, without: true },
      { size: 0, correct: false, without: false },
      { size: 2, correct: false, without: true },
    ] as const;
    const scaled = ['a', 'b'].flatMap((cluster) =>
      shape.map((point) =>
        row({
          cluster,
          correct: point.correct,
          withoutMemoryCorrect: point.without,
          statements: new Array<string>(point.size).fill('Rule.'),
        }),
      ),
    );
    const fit = doseOf(
      scaled,
      [
        // The first column has almost no variance and the second a great deal, so the off-diagonal
        // entry in column zero is larger than the diagonal and the elimination has to swap.
        { name: 'size', of: (entry) => (entry.statements.length === 2 ? 1 : 0) },
        { name: 'correct', of: (entry) => (entry.correct ? 1000 : 0) },
        { name: 'without', of: (entry) => (entry.withoutMemoryCorrect ? 500 : 0) },
      ],
      50,
    );
    expect(fit).not.toBeNull();
    expect(fit?.coefficients.every((value) => Number.isFinite(value))).toBe(true);
  });

  it('refuses a corpus with no rows or no predictors rather than reporting a zero', () => {
    expect(doseOf([], predictors, 20)).toBeNull();
    expect(doseOf(rows, [], 20)).toBeNull();
  });

  it('refuses a predictor that does not vary inside any cluster', () => {
    // Constant inside every cluster means every column of the demeaned design is zero, so the
    // cross-product is singular and the slope is not identified.
    const flat = doseOf(rows, [{ name: 'constant', of: () => 1 }], 20);
    expect(flat).toBeNull();
  });

  it('counts a draw that cannot be solved rather than turning it into a zero', () => {
    // One cluster carries every case of both kinds, the other carries only zeros; a draw that takes
    // the second twice has no variation left and must be dropped, not averaged in as zero.
    const thin = [
      row({ cluster: 'a', statements: ['Use DISTINCT.'], gold: 'SELECT DISTINCT a FROM t', correct: true, withoutMemoryCorrect: false }),
      row({ cluster: 'a', statements: ['Use LIMIT.'], gold: 'SELECT a FROM t', correct: false, withoutMemoryCorrect: true }),
      row({ cluster: 'a', statements: ['Use LIMIT.', 'Match the casing.'], gold: 'SELECT a FROM t', correct: true, withoutMemoryCorrect: true }),
      row({ cluster: 'a', statements: [], gold: 'SELECT a FROM t', correct: true, withoutMemoryCorrect: true }),
      row({ cluster: 'b', statements: [], gold: 'SELECT a FROM t', correct: true, withoutMemoryCorrect: true }),
      row({ cluster: 'b', statements: [], gold: 'SELECT a FROM t', correct: true, withoutMemoryCorrect: true }),
    ];
    const fit = doseOf(thin, predictors, 200);
    const dropped = fit?.intervals[0]?.dropped ?? 0;
    expect(dropped).toBeGreaterThan(0);
    expect(dropped).toBeLessThanOrEqual(200);
  });
});

describe('filterPriceOf', () => {
  it('drops a statement only when every construct it names is absent from the profile', () => {
    const rows = [
      row({ cluster: 'a', statements: ['Use DISTINCT.', 'Match the casing.'], gold: 'SELECT DISTINCT a FROM t' }),
      row({ cluster: 'a', statements: ['Use LIMIT.'], gold: 'SELECT DISTINCT a FROM t' }),
    ];
    const price = filterPriceOf(rows);
    // `distinct` is in A's profile, `limit` is not, and a statement naming no construct is kept.
    expect(price.deliveredBefore).toBe(3);
    expect(price.deliveredAfter).toBe(2);
    expect(price.casesEmptied).toBe(1);
    expect(price.profiles).toBe(1);
    expect(price.share).toBe(0.05);
  });

  it('honours the profile share it is given', () => {
    const rows = [
      row({ cluster: 'a', statements: ['Use DISTINCT.'], gold: 'SELECT DISTINCT a FROM t' }),
      row({ cluster: 'a', statements: [], gold: 'SELECT a FROM t' }),
    ];
    // `distinct` appears in one of two golds, so a threshold of 0.6 removes the profile entry.
    expect(filterPriceOf(rows, 0.6).deliveredAfter).toBe(0);
    expect(filterPriceOf(rows, 0.5).deliveredAfter).toBe(1);
  });

  it('reads a corpus that delivered nothing as costing nothing', () => {
    const price = filterPriceOf([row({ cluster: 'a' }), row({ cluster: 'b' })]);
    expect(price.deliveredBefore).toBe(0);
    expect(price.deliveredAfter).toBe(0);
    expect(price.casesEmptied).toBe(0);
  });
});

describe('attributionCensus', () => {
  const artefact = {
    per_case: [
      {
        dbId: 'a',
        correct: false,
        withoutMemoryCorrect: true,
        goldSql: 'SELECT a FROM t',
        injected: ['Use DISTINCT.'],
      },
      {
        dbId: 'a',
        correct: true,
        withoutMemoryCorrect: true,
        goldSql: 'SELECT DISTINCT a FROM t',
        injected: [],
      },
      {
        dbId: 'b',
        correct: true,
        withoutMemoryCorrect: true,
        goldSql: 'SELECT a FROM t',
        injected: ['Match the casing.'],
      },
      {
        dbId: 'b',
        correct: true,
        withoutMemoryCorrect: false,
        goldSql: 'SELECT a FROM t',
        injected: [],
      },
    ],
  };

  it('reads every source through the loader it is given', () => {
    const census = attributionCensus([{ name: 'fixture', path: 'x.json' }], () => [
      {
        cluster: 'a',
        correct: false,
        withoutMemoryCorrect: true,
        statements: ['Use DISTINCT.'],
        goldSql: 'SELECT a FROM t',
      },
      {
        cluster: 'a',
        correct: true,
        withoutMemoryCorrect: true,
        statements: [],
        goldSql: 'SELECT DISTINCT a FROM t',
      },
    ]);
    expect(census.id).toBe('poc-pack-attribution');
    expect(census.registered).toBe('ROADMAP.md §R159');
    expect(census.sources).toHaveLength(1);
    expect(census.sources[0]?.n).toBe(2);
    expect(census.sources[0]?.clusters).toBe(1);
    expect(census.sources[0]?.statements).toBe(1);
    expect(census.sources[0]?.unsupported.casesAny).toBe(1);
    expect(census.rule).toContain('within a database');
  });

  it('reports the constructs behind the flag, so the flag cannot be one construct in a coat', () => {
    const census = attributionCensus([{ name: 'fixture', path: 'x.json' }], (path) => {
      expect(path).toBe('x.json');
      return artefact.per_case.map((entry) => ({
        cluster: entry.dbId,
        correct: entry.correct,
        withoutMemoryCorrect: entry.withoutMemoryCorrect,
        statements: entry.injected,
        goldSql: entry.goldSql,
      }));
    });
    const entry = census.sources[0] as AttributionEntry;
    expect(entry.unsupported.byConstruct[0]).toEqual({ construct: 'distinct', cases: 1 });
    expect(entry.unsupported.meanPerCase).toBeCloseTo(0.25, 6);
    // `distinct` can be compared in one database only, so it is screened out but keeps its count.
    expect(entry.screen).toEqual([]);
    expect(entry.unscreened).toBe(2);
  });

  it('carries the filter price of the arm it read', () => {
    const census = attributionCensus([{ name: 'fixture', path: 'x.json' }], () => [
      {
        cluster: 'a',
        correct: true,
        withoutMemoryCorrect: true,
        statements: ['Use LIMIT.'],
        goldSql: 'SELECT a FROM t',
      },
    ]);
    expect(census.sources[0]?.filter.deliveredBefore).toBe(1);
    expect(census.sources[0]?.filter.deliveredAfter).toBe(0);
  });

  it('names the four arms this round reads', () => {
    expect(ATTRIBUTION_SOURCES.map((source) => source.name)).toEqual([
      'bird-train',
      'bird-dev',
      'bird-dev-lexicon',
      'bird-mini',
    ]);
    for (const source of ATTRIBUTION_SOURCES) expect(source.path.startsWith('eval/results/')).toBe(true);
  });
});

describe('the tables', () => {
  const entry: AttributionEntry = {
    source: 'fixture',
    path: 'x.json',
    n: 10,
    clusters: 2,
    statements: 2,
    unscreened: 1,
    ledger: { statements: 2, screened: 1, resolved: 1, expected: 0.05, negative: 1, positive: 0, massAtRiskPp: 0.3 },
    screen: [
      {
        statement: 'A statement long enough to be truncated by the column it is printed in, which is the point of the ellipsis.',
        cases: 4,
        databases: 6,
        comparable: 6,
        att: 4,
        contrast: { low: -5, high: -1, point: -3, dropped: 0 },
        resolved: true,
      },
      { statement: 'Short.', cases: 1, databases: 1, comparable: 1, att: 1, contrast: null, resolved: false },
    ],
    unsupported: {
      any: { exposed: 4, comparable: 2, att: 4, contrast: { low: -5, high: -1, point: -3, dropped: 0 } },
      all: null,
      none: { exposed: 6, comparable: 2, att: 6, contrast: { low: 1, high: 5, point: 3, dropped: 0 } },
      casesAny: 4,
      casesAll: 0,
      meanPerCase: 0.4,
      byConstruct: [{ construct: 'distinct', cases: 4 }],
    },
    circulation: [
      { stratum: 'none', result: null },
      { stratum: 'mixed', result: { exposed: 2, comparable: 1, att: 2, contrast: { low: -9, high: 9, point: 0, dropped: 0 } } },
      { stratum: 'all', result: null },
    ],
    dose: {
      predictors: ['statements', 'unsupported'],
      cases: 10,
      clusters: 2,
      coefficients: [-2.5, -0.5],
      intervals: [
        { low: -4, high: -1, point: -2.5, dropped: 0 },
        { low: -2, high: 1, point: -0.5, dropped: 0 },
      ],
    },
    filter: { share: 0.05, deliveredBefore: 20, deliveredAfter: 16, casesEmptied: 1, profiles: 2 },
  };

  const widths = (lines: readonly string[]): number[] => lines.map((line) => line.length);

  it('aligns the ledger under its header', () => {
    const lines = ledgerLines(entry);
    expect(lines).toHaveLength(2);
    expect(new Set(widths(lines)).size).toBe(1);
    expect(lines[0]).toContain('mass');
    expect(lines[1]).toContain('−0.30pp');
  });

  it('aligns the screen under its header and truncates the statement column', () => {
    const lines = screenLines(entry);
    expect(new Set(widths(lines)).size).toBe(1);
    expect(lines[1]).toContain('…');
    expect(lines[1]).toContain('yes');
    // A statement without an interval prints three em dashes and no verdict.
    expect(lines[2]).toContain('—');
    expect(lines[2]?.trimEnd().endsWith('—')).toBe(true);
  });

  it('aligns the strata under its header and dashes an absent stratum', () => {
    const lines = stratumLines(entry);
    expect(new Set(widths(lines)).size).toBe(1);
    expect(lines.map((line) => line.split(/\s+/)[1])).toEqual([
      'stratum',
      'unsupported-any',
      'unsupported-all',
      'unsupported-none',
      'circ-none',
      'circ-mixed',
      'circ-all',
    ]);
    expect(lines[2]).toContain('—');
  });

  it('aligns the dose under its header and names the predictors it fitted', () => {
    const lines = doseLines(entry);
    expect(new Set(widths(lines)).size).toBe(1);
    expect(lines[1]).toContain('statements');
    expect(lines[1]).toContain('yes');
    expect(lines[2]).toContain('unsupported');
  });

  it('prints nothing for a dose that could not be fitted', () => {
    expect(doseLines({ ...entry, dose: null })).toEqual([]);
  });

  it('aligns the filter price under its header', () => {
    const lines = filterLines(entry);
    expect(new Set(widths(lines)).size).toBe(1);
    expect(lines[1]).toContain('80.0%');
  });

  it('reads a filter price with nothing delivered as zero per cent kept', () => {
    const quiet = filterLines({ ...entry, filter: { share: 0.05, deliveredBefore: 0, deliveredAfter: 0, casesEmptied: 0, profiles: 1 } });
    expect(quiet[1]).toContain('0.0%');
  });

  it('prints a fit whose intervals and names are shorter than its coefficients', () => {
    // A hand-built fit, because `doseOf` always returns one interval per coefficient: this is the
    // printer's contract with a caller that carries fewer, and the table must not throw on it.
    const ragged = doseLines({
      ...entry,
      dose: {
        predictors: ['statements'],
        cases: 4,
        clusters: 2,
        coefficients: [-2.5, -0.5],
        intervals: [{ low: -4, high: -1, point: -2.5, dropped: 0 }],
      },
    });
    expect(ragged[1]).toContain('statements');
    expect(ragged[2]).toContain('x1');
    expect(ragged[2]).toContain('—');
  });
});

describe('clusterBootstrapRatio', () => {
  const units = [
    { cluster: 'a', numerator: 3, denominator: 4 },
    { cluster: 'b', numerator: -1, denominator: 2 },
    { cluster: 'c', numerator: 5, denominator: 6 },
  ];

  it('is the generic loop with the rows already added up', () => {
    const generic = clusterBootstrapStatistic(
      units,
      (unit) => unit.cluster,
      (drawn) => {
        let numerator = 0;
        let denominator = 0;
        for (const unit of drawn) {
          numerator += unit.numerator;
          denominator += unit.denominator;
        }
        return denominator === 0 ? null : numerator / denominator;
      },
      500,
      4242,
    );
    expect(clusterBootstrapRatio(units, 500, 4242)).toEqual(generic);
  });

  it('refuses a sample whose denominator is zero, and counts the draws it lost', () => {
    const empty = [{ cluster: 'a', numerator: 1, denominator: 0 }];
    expect(clusterBootstrapRatio(empty, 10)).toBeNull();
  });

  it('counts a draw that lands only on empty denominators instead of averaging in a zero', () => {
    const mixed = [
      { cluster: 'a', numerator: 1, denominator: 0 },
      { cluster: 'b', numerator: 1, denominator: 2 },
    ];
    const interval = clusterBootstrapRatio(mixed, 200);
    // The point is the ratio over the whole sample, which includes the unit whose denominator is zero:
    // that is `clusterBootstrapStatistic`'s behaviour too, and the two have to agree draw for draw.
    expect(interval?.point).toBeCloseTo(1, 9);
    expect(interval?.dropped).toBeGreaterThan(0);
  });

  it('refuses a corpus with no units', () => {
    expect(clusterBootstrapRatio([], 10)).toBeNull();
  });

  it('gives a single cluster its own ratio as both bounds', () => {
    const one = [{ cluster: 'a', numerator: 2, denominator: 4 }];
    expect(clusterBootstrapRatio(one, 10)).toEqual({ low: 0.5, high: 0.5, point: 0.5, dropped: 0 });
  });

  it('adds the units of a cluster before resampling it', () => {
    const split = [
      { cluster: 'a', numerator: 1, denominator: 2 },
      { cluster: 'a', numerator: 1, denominator: 2 },
      { cluster: 'b', numerator: 0, denominator: 2 },
    ];
    const merged = [
      { cluster: 'a', numerator: 2, denominator: 4 },
      { cluster: 'b', numerator: 0, denominator: 2 },
    ];
    expect(clusterBootstrapRatio(split, 100)).toEqual(clusterBootstrapRatio(merged, 100));
  });
});
