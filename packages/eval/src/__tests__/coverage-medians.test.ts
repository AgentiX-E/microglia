/**
 * TDD for the coverage median, written before the reading exists.
 *
 * ## The defect this names
 *
 * R54's third prediction is "coverage p50 at least 12%". The committed verifier,
 * `eval/verifiers/r51_readback.py`, grades it against
 * `tau2.coverage.nonzeroQuantiles.p50` and R49 read `4.7%`, R51 `4.88%`,
 * R47's committed histogram `0.04545`. So the subject of that phrase is not
 * undefined — it is the median over the pairs that cleared zero, and it is
 * defined by where the field sits rather than by anything the artefact says.
 *
 * What is missing is the other population. R47's histogram read 750 zeros in
 * 2,188 injected pairs, so the median over **every** delivered pair is that
 * population's 24th non-zero percentile, about `0.027` — half the graded number,
 * and nowhere in the file. The zeros were delivered: the model saw those rules.
 * A bar met on the survivors is therefore compatible with a delivery that is
 * eight-tenths unrelated, which is precisely the state R54 exists to tell apart
 * from a distiller that names the situation. A registration cannot ask for the
 * delivered median if the instrument does not commit it.
 *
 * The repair is not more prose, it is a reduction of the same observations that
 * returns both medians under two distinct names, committed beside the histogram
 * so a registration can name one and a reader cannot mistake the other for it.
 * This is the same defect class as R12's admission, R13's ledger and R16's
 * gates: a quantity whose definition lives in a reader's head rather than in a
 * field.
 *
 * ## Why both are kept
 *
 * Neither is the "right" median. The non-zero median is the one a floor is
 * chosen from, because a floor acts on the pairs that survived the cut — and it
 * is the one the 12% bar has been read against. The all-pairs median is the one
 * that describes what the model actually saw, because the zeros were delivered.
 * Printing one and not the other is how a population of eight-tenths unrelated
 * rules reports a healthy median.
 *
 * Every case uses the real `tokenize` and `queryCoverage` from the kernel — no
 * mock and no synthetic coverage numbers — and the drift guard compares the
 * new reading against `coverageHistogram`, which is the quantity already
 * committed in every artefact since R46.
 */
import { describe, expect, it } from 'vitest';
import {
  coverageHistogram,
  coverageMedians,
  type UseObservation,
} from '../tau2-use-census.js';

/** A ten-content-term question, so a document holding k of them covers k/10. */
const TEN = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet';

const terms = (count: number): string => TEN.split(' ').slice(0, count).join(' ');

/** One observation with an explicit document list; `statements` mirrors it. */
function observed(documents: readonly string[], query = TEN): UseObservation {
  return { query, statements: documents, documents };
}

describe('coverageMedians — one phrase, two populations', () => {
  it('separates the all-pairs median from the non-zero one', () => {
    // Two zero-coverage pairs and one at 0.1. The median over all three is
    // zero; the median over the surviving one is 0.1. A registration that
    // says "p50" without naming which is grading two different experiments
    // that differ by everything that matters.
    const medians = coverageMedians([
      observed(['refund']),
      observed(['refund']),
      observed([terms(1)]),
    ]);
    expect(medians.pairs).toBe(3);
    expect(medians.zeroPairs).toBe(2);
    expect(medians.medianAllPairs).toBe(0);
    expect(medians.medianNonzero).toBeCloseTo(0.1, 12);
  });

  it('takes the upper median, so a two-pair population is its second element', () => {
    // `quantileOf` has always indexed `floor(p * n)`, which for p = 0.5 and
    // n = 2 is element 1. Documented here because a reader who interpolates
    // between the middle pair would get 0.15 and conclude the reading is
    // wrong. The upper median is the convention the floor grid already uses,
    // and one convention for both medians is worth more than the interpolated
    // central value nobody's floor consumes.
    const medians = coverageMedians([observed([terms(1)]), observed([terms(2)])]);
    expect(medians.medianNonzero).toBeCloseTo(0.2, 12);
  });

  it('interpolates nothing on four ordered pairs', () => {
    const medians = coverageMedians([
      observed([terms(1)]),
      observed([terms(2)]),
      observed([terms(3)]),
      observed([terms(4)]),
    ]);
    // floor(4 * 0.5) = 2 → the third smallest, 0.3, not the mean of 0.2 and 0.3.
    expect(medians.medianNonzero).toBeCloseTo(0.3, 12);
    expect(medians.medianAllPairs).toBeCloseTo(0.3, 12);
  });

  it('reports zero rather than NaN when every pair is zero', () => {
    const medians = coverageMedians([
      observed(['refund']),
      observed(['complaint']),
    ]);
    expect(medians.pairs).toBe(2);
    expect(medians.zeroPairs).toBe(2);
    expect(medians.medianAllPairs).toBe(0);
    expect(medians.medianNonzero).toBe(0);
    expect(Number.isNaN(medians.medianNonzero)).toBe(false);
  });

  it('reports zero rather than NaN when nothing was injected', () => {
    const medians = coverageMedians([]);
    expect(medians).toEqual({ pairs: 0, zeroPairs: 0, medianAllPairs: 0, medianNonzero: 0 });
  });

  it('excludes a content-free question from both populations', () => {
    // `queryCoverage` returns 0 when the question has no content term, and
    // that zero is a statement about the question, not about the rule. The
    // histogram has always excluded these packs; the median has to agree.
    const medians = coverageMedians([
      observed([terms(3)], 'the of and to'),
      observed([terms(1)]),
      observed([terms(2)]),
    ]);
    expect(medians.pairs).toBe(2);
    // Upper median of {0.1, 0.2} is 0.2 — the point is the population of two,
    // not the value of the reading.
    expect(medians.medianNonzero).toBeCloseTo(0.2, 12);
  });

  it('excludes a request whose pack was empty', () => {
    const medians = coverageMedians([observed([]), observed([terms(2)]), observed([terms(4)])]);
    expect(medians.pairs).toBe(2);
    expect(medians.medianNonzero).toBeCloseTo(0.4, 12);
  });

  it('reads the condition-plus-statement document when the observation carries one', () => {
    // The whole point of `documents`: a rule recalled by its condition is
    // scored on its condition. Here the statement is irrelevant and the
    // condition is the question, so the honest reading is 1.0.
    const medians = coverageMedians([
      { query: TEN, statements: ['unrelated prose'], documents: [TEN] },
    ]);
    expect(medians.medianNonzero).toBe(1);
    expect(medians.zeroPairs).toBe(0);
  });

  it('cannot drift from the histogram it shares a population with', () => {
    // The drift guard. `coverageHistogram` is the committed instrument; the
    // median reading must be the same number for the same observations, and
    // the same population count. If a future change touches one reduction and
    // not the other, this fails rather than the registration.
    const observations = [
      observed([terms(1)]),
      observed([terms(1), 'refund', terms(5)]),
      observed(['refund']),
      observed([terms(2), terms(7)]),
      observed([], 'the of and'),
      observed([]),
      observed([terms(10)]),
      observed(['complaint', terms(3)]),
    ];
    const histogram = coverageHistogram(observations);
    const medians = coverageMedians(observations);
    // Hand-counted from the fixture: ten measured pairs, three of them zero.
    // Spelled out rather than derived from the function under test, because a
    // guard that recomputes its own subject cannot catch a population error.
    expect(medians.pairs).toBe(10);
    expect(medians.zeroPairs).toBe(3);
    expect(medians.medianAllPairs).toBeCloseTo(0.2, 12);
    expect(medians.pairs).toBe(histogram.measuredPairs);
    expect(medians.medianNonzero).toBeCloseTo(0.3, 12);
    expect(medians.medianNonzero).toBeCloseTo(histogram.nonzeroQuantiles.p50, 12);
    // And the population identity the retention curve rests on still holds.
    expect(histogram.measuredPairs + histogram.unmeasurablePairs).toBe(
      observations.reduce((total, observation) => total + observation.statements.length, 0),
    );
  });
});
