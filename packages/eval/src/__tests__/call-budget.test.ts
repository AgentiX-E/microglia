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
