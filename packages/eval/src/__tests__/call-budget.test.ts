import { describe, expect, it } from 'vitest';
import { forecastBudget, type BudgetLedger } from '../call-budget.js';

const ledger = (over: Partial<BudgetLedger>): BudgetLedger => ({
  spent: 0,
  cap: 10_000,
  folds: [],
  totalFolds: 5,
  ...over,
});

describe('forecastBudget', () => {
  it('refuses a cap that the dearest completed fold projects past', () => {
    // The failure this exists for: four folds of an S2 run finished and the fifth exhausted a
    // 4,200-call ceiling at its hundredth question, so forty-seven minutes of calls produced no
    // artefact at all. Nothing in the run could see the wall until it hit it. One fold is enough
    // to see it: the remaining folds repeat the one that just ran.
    const verdict = forecastBudget(
      ledger({ spent: 1150, cap: 4200, folds: [{ fold: 0, calls: 1150 }] }),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.projected).toBe(6210);
  });

  it('reports how many calls the cap is short, not just that it is short', () => {
    // A refusal that says "budget" sends the reader to the workflow file to guess. The number it
    // is short by is the one that decides the next dispatch, so it is computed here rather than
    // left to whoever reads the log.
    const verdict = forecastBudget(
      ledger({ spent: 1150, cap: 4200, folds: [{ fold: 0, calls: 1150 }] }),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.shortfall).toBe(2010);
  });

  it('projects from the dearest fold rather than the mean', () => {
    // Folds are not the same price. The first pays for a cold store, and an arm that learns more
    // rules asks for more corrections. A mean over a cheap fold and a dear one understates the
    // next fold, and understating the projection is what makes the projection useless.
    const cheap = forecastBudget(
      ledger({
        spent: 1700,
        cap: 9000,
        folds: [
          { fold: 0, calls: 1150 },
          { fold: 1, calls: 550 },
        ],
      }),
    );
    // 1700 + ceil(1150 * 3 * 110 / 100) = 5495, whereas a mean of 850 would have said 4505.
    expect(cheap.projected).toBe(5495);
  });

  it('carries a tenth of headroom, because the last fold is not the cheapest', () => {
    // Retries are driven by the endpoint, not by the experiment: the same four-arm configuration
    // cost 5 retries in one fold and 8 in another inside a single run. A projection that assumes
    // the retry rate it has seen so far is exact is wrong on the optimistic side.
    const exact = forecastBudget(
      ledger({ spent: 1000, cap: 9000, folds: [{ fold: 0, calls: 1000 }], safetyPct: 100 }),
    );
    const padded = forecastBudget(
      ledger({ spent: 1000, cap: 9000, folds: [{ fold: 0, calls: 1000 }] }),
    );
    expect(exact.projected).toBe(5000);
    expect(padded.projected).toBe(5400);
  });

  it('lets the run start when no fold has finished', () => {
    // There is nothing to extrapolate from before the first fold, and inventing a prior would
    // refuse configurations that are simply expensive. The check can only be as good as its
    // sample, and this says so by passing rather than by guessing.
    const verdict = forecastBudget(ledger({ spent: 0, cap: 100 }));
    expect(verdict.ok).toBe(true);
    expect(verdict.projected).toBe(0);
  });

  it('reports the remaining room when the projection fits', () => {
    const verdict = forecastBudget(
      ledger({ spent: 1000, cap: 9000, folds: [{ fold: 0, calls: 1000 }], totalFolds: 2 }),
    );
    expect(verdict.ok).toBe(true);
    expect(verdict.projected).toBe(2100);
    expect(verdict.margin).toBe(6900);
  });

  it('accepts a cap the projection exactly reaches', () => {
    // The ceiling is inclusive: the client throws before spending call `cap + 1`, so a run that
    // projects to exactly `cap` completes. Failing here would refuse a run that fits.
    const verdict = forecastBudget(
      ledger({ spent: 1000, cap: 2100, folds: [{ fold: 0, calls: 1000 }], totalFolds: 2 }),
    );
    expect(verdict.ok).toBe(true);
  });

  it('adds nothing once every fold is done', () => {
    const verdict = forecastBudget(
      ledger({
        spent: 5000,
        cap: 9000,
        folds: [
          { fold: 0, calls: 1200 },
          { fold: 1, calls: 1300 },
        ],
        totalFolds: 2,
      }),
    );
    expect(verdict.ok).toBe(true);
    expect(verdict.projected).toBe(5000);
  });

  it('treats a finished run as fitting even when it spent past the cap', () => {
    // The fold that hits the wall throws out of the client, so it is never recorded as completed.
    // A last fold that overshoots slightly can therefore leave `spent` above `cap` with nothing
    // left to project; refusing there would replace the honest error from the client with a
    // forecast about a run that has already ended.
    const verdict = forecastBudget(
      ledger({ spent: 9100, cap: 9000, folds: [{ fold: 0, calls: 9100 }], totalFolds: 1 }),
    );
    expect(verdict.ok).toBe(true);
    expect(verdict.projected).toBe(9100);
  });

  it('ignores folds recorded out of order', () => {
    // The ledger is appended as folds finish, but nothing in the signature depends on that, and a
    // caller that sorts or resumes should not change the answer.
    const verdict = forecastBudget(
      ledger({
        spent: 2000,
        cap: 9000,
        folds: [
          { fold: 2, calls: 300 },
          { fold: 0, calls: 1200 },
          { fold: 1, calls: 500 },
        ],
        totalFolds: 5,
      }),
    );
    expect(verdict.projected).toBe(2000 + 2640);
  });
});

describe('forecastBudget under a ceiling', () => {
  // R74, exactly. Fold 1 cost 5,483 calls, the projection was 29,609, the dispatch had written
  // 28,000, and the run stopped holding a fifth of its own cost. The ceiling is the number that
  // says whether the run is affordable; the cap is the number the operator guessed it would be.
  const r74 = { spent: 5483, cap: 28_000, folds: [{ fold: 0, calls: 5483 }], totalFolds: 5 };

  it('raises its own cap to the projection when the ceiling covers it', () => {
    const verdict = forecastBudget({ ...r74, ceiling: 32_000 });
    expect(verdict.ok).toBe(true);
    expect(verdict.projected).toBe(29_609);
    // The cap handed back is the one the remaining folds must be bought under, and it is the
    // projection rather than the ceiling: authorising headroom nobody measured is not the same
    // decision as authorising the number the folds actually implied.
    expect(verdict.cap).toBe(29_609);
    expect(verdict.resized).toBe(true);
  });

  it('says nothing when the projection fits the cap it was given', () => {
    const verdict = forecastBudget({ ...r74, cap: 32_000 });
    expect(verdict.ok).toBe(true);
    expect(verdict.resized).toBe(false);
    expect(verdict.cap).toBe(32_000);
  });

  it('still refuses when the projection does not fit the ceiling', () => {
    // The ceiling is a commitment about money, so it is the one number that may end a run.
    const verdict = forecastBudget({ ...r74, ceiling: 29_000 });
    expect(verdict.ok).toBe(false);
    expect(verdict.shortfall).toBe(609);
    // A refused run does not hand back a raised cap: there is nothing to authorise.
    expect(verdict.cap).toBe(28_000);
    expect(verdict.resized).toBe(false);
  });

  it('treats an absent ceiling as the cap, which is what every earlier run meant', () => {
    const withoutCeiling = forecastBudget(r74);
    const explicit = forecastBudget({ ...r74, ceiling: 28_000 });
    expect(withoutCeiling).toEqual(explicit);
    expect(withoutCeiling.ok).toBe(false);
  });

  it('will not let a ceiling below the cap shrink the bound', () => {
    // A dispatch that sends ceiling 20,000 and cap 28,000 has contradicted itself. Reading the
    // smaller number as the bound would refuse a run the operator explicitly authorised.
    const verdict = forecastBudget({ ...r74, ceiling: 20_000 });
    expect(verdict.ok).toBe(false);
    expect(verdict.shortfall).toBe(1609);
  });

  it('measures the margin against the ceiling rather than the cap', () => {
    const verdict = forecastBudget({ ...r74, cap: 28_000, ceiling: 40_000 });
    expect(verdict.margin).toBe(40_000 - 29_609);
  });
});

describe('the fold that pays for everything the others read', () => {
  // Two dispatches were killed by the same arithmetic. R77's first: fold 1 cost 1,952 (1,200
  // evaluation, 700 learning, 52 other), the forecast multiplied that fold by five and reported 10,541
  // against a 7,600 ceiling — and the completed run cost 6,946, of which the entire learning pass was
  // 877 calls. R74's first: fold 1 cost 5,483, the forecast reported 29,609 against a 28,000 cap, and
  // the re-run cost 24,465.
  const r77 = { fold: 1, calls: 1_952, learning: 700 };

  it('does not charge a start-up cost to folds that read it from the cache', () => {
    const forecast = forecastBudget({ spent: 1_952, cap: 7_600, folds: [r77], totalFolds: 5 });
    // 1,952 + 4 × 1,252 × 1.1 — inside the ceiling the first dispatch already had.
    expect(forecast.projected).toBe(1_952 + Math.ceil(1_252 * 4 * 1.1));
    expect(forecast.ok).toBe(true);
    expect(forecast.projected).toBeLessThan(6_946 * 1.1);
  });

  it('would have finished R74 for any learning pass above 366 calls', () => {
    // R74's artefact records calls per fold but not learning per fold — the field did not exist — so
    // this states the threshold rather than inventing a measurement. R74's forecast was 29,609, which is
    // 5,483 × (1 + 4 × 1.1): fold 1 charged to four folds that would not pay it. Anything above 366
    // calls of learning in fold 1 brings the projection under the 28,000 the dispatch had, and the pass
    // cost 877 calls in R77, which is built the same way and pays it in the same place.
    const at = (learning: number) =>
      forecastBudget({
        spent: 5_483,
        cap: 28_000,
        folds: [{ fold: 1, calls: 5_483, learning }],
        totalFolds: 5,
      });
    expect(at(365).ok).toBe(false);
    expect(at(366).ok).toBe(true);
  });

  it('keeps the dearest-fold rule over the folds that have no start-up cost', () => {
    // The net cost, not the net of the maximum: a later fold that retries more is still the price the
    // remaining folds are charged, and a *cheaper* later fold does not discount them.
    const folds = [
      { fold: 1, calls: 1_952, learning: 700 },
      { fold: 2, calls: 1_400, learning: 40 },
    ];
    const forecast = forecastBudget({ spent: 3_352, cap: 12_000, folds, totalFolds: 5 });
    expect(forecast.projected).toBe(3_352 + Math.ceil(1_360 * 3 * 1.1));
  });

  it('behaves exactly as before when a fold reports no learning pass', () => {
    const forecast = forecastBudget({
      spent: 1_000,
      cap: 9_000,
      folds: [{ fold: 1, calls: 1_000 }],
      totalFolds: 3,
    });
    expect(forecast.projected).toBe(1_000 + Math.ceil(1_000 * 2 * 1.1));
  });

  it('refuses a fold that reports more learning than it spent, rather than projecting below zero', () => {
    // A negative learning figure cannot be evidence of anything, and letting it through would subtract
    // a cost from the extrapolation and quietly raise the ceiling the run thinks it has.
    const forecast = forecastBudget({
      spent: 500,
      cap: 6_000,
      folds: [{ fold: 1, calls: 500, learning: 900 }],
      totalFolds: 4,
    });
    expect(forecast.projected).toBe(500);
  });
});
