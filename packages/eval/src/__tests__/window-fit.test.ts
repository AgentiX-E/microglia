import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SECONDS_PER_EPISODE, SETUP_MINUTES, windowFit, windowFitLine } from '../window-fit.js';

/**
 * The guard R142's first dispatch paid for.
 *
 * The dispatch was sent at 00:47 UTC, the learn half started at 00:48 and was bought, and the eval phase
 * started at 01:19 — inside the peak window — and was refused by `--require-off-peak`. Nothing had asked
 * whether the run would still be off-peak when it finished. These cases are that question, with the clock as
 * an argument so the answer does not depend on when they run.
 */

/** The card's own windows: 01:00–04:00 and 06:00–10:00 UTC, weekdays only. */
const WINDOWS = [
  { fromHourUtc: 1, toHourUtc: 4 },
  { fromHourUtc: 6, toHourUtc: 10 },
];

function moment(iso: string): Date {
  return new Date(iso);
}

describe('windowFit', () => {
  it('fits a small run in the off-peak stretch before the window opens', () => {
    // 23:00 UTC on a Wednesday: the next peak hour is 01:00, so 120 minutes remain and 100 episodes at the
    // measured rate are 44 — the dispatch this guard exists to allow.
    const fit = windowFit({ now: moment('2026-11-18T23:00:00Z'), episodes: 100, windows: WINDOWS });
    expect(fit.fits).toBe(true);
    expect(fit.minutesRemaining).toBe(120);
    expect(fit.estimatedMinutes).toBe(Math.ceil((100 * SECONDS_PER_EPISODE) / 60) + SETUP_MINUTES);
    expect(fit.windowOpensAt).toBeUndefined();
  });

  it('refuses the dispatch that lost R142 a learn half: 57 + 57 episodes, thirteen minutes to the window', () => {
    // The reproduction, with the run's own numbers: 228 episodes over two arms is 109 minutes against the
    // 120 an 04:00 window offers — and against the 13 minutes left at 00:47 it is a refusal.
    const fit = windowFit({ now: moment('2026-11-18T00:47:00Z'), episodes: 228, windows: WINDOWS });
    expect(fit.fits).toBe(false);
    expect(fit.minutesRemaining).toBe(13);
    expect(fit.estimatedMinutes).toBe(109);
    expect(fit.windowOpensAt).toBe('01:00');
    expect(windowFitLine(fit)).toContain('would cross into the window that opens at 01:00');
  });

  it('refuses a start inside the window with zero minutes left rather than a negative remainder', () => {
    const fit = windowFit({ now: moment('2026-11-18T01:30:00Z'), episodes: 228, windows: WINDOWS });
    expect(fit.fits).toBe(false);
    expect(fit.minutesRemaining).toBe(0);
    expect(fit.windowOpensAt).toBe('04:00');
  });

  it('reads a weekend as having no peak hour at all', () => {
    // The card bills weekdays only, and a guard that walked a single day would refuse every Saturday run.
    const fit = windowFit({ now: moment('2026-11-21T02:00:00Z'), episodes: 228, windows: WINDOWS });
    expect(fit.fits).toBe(true);
    expect(fit.minutesRemaining).toBeGreaterThan(24 * 60);
  });

  it('fits an empty run at setup cost and refuses a negative count', () => {
    const fit = windowFit({ now: moment('2026-11-18T23:00:00Z'), episodes: 0, windows: WINDOWS });
    expect(fit.estimatedMinutes).toBe(SETUP_MINUTES);
    expect(fit.fits).toBe(true);
    expect(() => windowFit({ now: moment('2026-11-18T23:00:00Z'), episodes: -1, windows: WINDOWS })).toThrow(
      /non-negative count/,
    );
  });

  it('refuses to be a guard over a card that states no window', () => {
    // A table with no rows would make every run "fit" forever, which is the failure a zero-length list hides.
    expect(() =>
      windowFit({ now: moment('2026-11-18T23:00:00Z'), episodes: 10, windows: [], weekdaysOnly: false }),
    ).toThrow(/states no peak window/);
  });

  it('takes the card and the measured rate as defaults, so a caller states only what it knows', () => {
    // The workflow step has no rate card and no episode cost to pass: both come from the module, and a default
    // that had never been exercised would be a constant nobody had compared to a run.
    const fit = windowFit({ now: moment('2026-11-18T22:00:00Z'), episodes: 10 });
    expect(fit.fits).toBe(true);
    expect(fit.estimatedMinutes).toBe(Math.ceil((10 * SECONDS_PER_EPISODE) / 60) + SETUP_MINUTES);
    const tuned = windowFit({
      now: moment('2026-11-18T22:00:00Z'),
      episodes: 10,
      secondsPerEpisode: 60,
      setupMinutes: 1,
    });
    expect(tuned.estimatedMinutes).toBe(11);
  });

  it('names an unstated hour rather than printing null on a refusal built by hand', () => {
    // A `WindowFit` is a value a readback can construct (a stored artefact, a fixture); the line must read the
    // same whether or not the hour travelled with it.
    expect(
      windowFitLine({ fits: false, minutesRemaining: 5, estimatedMinutes: 90 }),
    ).toContain('opens at an unstated hour');
  });

  it('says which hour to name in not_before, and says it on the passing side too', () => {
    const refuse = windowFit({ now: moment('2026-11-18T05:30:00Z'), episodes: 228, windows: WINDOWS });
    expect(windowFitLine(refuse)).toContain('Dispatch with not_before: 06:00');
    const allow = windowFit({ now: moment('2026-11-18T22:00:00Z'), episodes: 10, windows: WINDOWS });
    expect(windowFitLine(allow)).toContain('it fits');
  });
});

describe('eval:window-fit, the command a workflow step calls', () => {
  const run = (env: Record<string, string>) => {
    const child = spawnSync('npx', ['tsx', 'packages/eval/src/bin/window-fit.ts'], {
      encoding: 'utf8',
      env: { ...process.env, ...env },
    });
    return { code: child.status ?? 1, out: child.stdout ?? '', err: child.stderr ?? '' };
  };

  it('refuses a dispatch with no caps, because an estimate of zero would fit every window', () => {
    const result = run({ TAU_TRAIN_TASKS: '', TAU_TEST_TASKS: '', NOT_BEFORE: '' });
    expect(result.code).toBe(1);
    expect(result.err).toContain('no episode count to estimate from');
  });

  it('refuses a mistyped window instead of sleeping through it', () => {
    const result = run({ TAU_TRAIN_TASKS: '57', TAU_TEST_TASKS: '57', NOT_BEFORE: '4am' });
    expect(result.code).toBe(1);
    expect(result.err).toContain('not_before must be HH:MM in UTC');
  });

  it('says so and proceeds when peak was authorised deliberately', () => {
    // `TAU_ALLOW_PEAK=1` is a decision somebody made; the command records it beside the run rather than
    // disagreeing with it, and the artefact's own `cost.band` is what grades the bill afterwards.
    const result = run({ TAU_ALLOW_PEAK: '1', TAU_TRAIN_TASKS: '', TAU_TEST_TASKS: '' });
    expect(result.code).toBe(0);
    expect(result.out).toContain('bills this dispatch at peak rate');
  });

  it('refuses a cap that is not a count, rather than estimating from a fraction', () => {
    const result = run({ TAU_TRAIN_TASKS: '12.5', TAU_TEST_TASKS: '57' });
    expect(result.code).not.toBe(0);
    expect(result.err).toContain('not a count of tasks');
  });

  it('estimates from one trial and two arms when the dispatch names neither', () => {
    // Both are multipliers on the episode count, and a missing one silently halves or quarters the estimate —
    // which is how a run that would cross into peak is told it fits.
    const result = run({
      TAU_TRAIN_TASKS: '57',
      TAU_TEST_TASKS: '57',
      TAU_TRIALS: '',
      TAU_WINDOW_ARMS: '',
      TAU_START_AT: '2026-11-18T04:00:00Z',
    });
    expect(result.out).toContain('arms=2 trials=1');
  });

  /**
   * R146. The guard was refused by its own clock.
   *
   * A dispatch naming `not_before: 04:00` slept until 04:00:00 and then ran this step at 04:00:27, where
   * `planBandWait` read `04:00` as the *next* 04:00 — 1440 minutes away — and refused the run it had just
   * waited for. The 2-hour wait was spent, the memory arm was skipped by the implicit `success()`, and the
   * reference arm bought its half anyway. The fix is that the wait step publishes the instant it woke and
   * the guard consumes that instant rather than parsing the request a second time.
   */
  it('takes the start from the clock the wait step woke on, not from a second read of not_before', () => {
    const result = run({
      TAU_TRAIN_TASKS: '57',
      TAU_TEST_TASKS: '57',
      NOT_BEFORE: '04:00',
      TAU_START_AT: '2026-11-18T04:00:00Z',
    });
    // The claim is that nothing was refused. `npx` writes its own warnings to stderr, so emptiness is not
    // the assertion: the marker the workflow fails on is.
    expect(result.err).not.toContain('::error::');
    expect(result.code).toBe(0);
    expect(result.out).toContain('it fits');
  });

  it('refuses a start it cannot read rather than falling back to now', () => {
    // Falling back to "now" is exactly the defect above: the wall clock at the moment of the check is not
    // the instant the run started, and at a window boundary it is on the other side of one.
    const result = run({ TAU_TRAIN_TASKS: '57', TAU_TEST_TASKS: '57', TAU_START_AT: 'half past four' });
    expect(result.code).toBe(1);
    expect(result.err).toContain('TAU_START_AT');
  });

  it('refuses a start the wait step woke on inside the peak window', () => {
    const result = run({ TAU_TRAIN_TASKS: '57', TAU_TEST_TASKS: '57', TAU_START_AT: '2026-11-18T05:30:00Z' });
    expect(result.code).toBe(1);
    expect(result.err).toContain('Dispatch with not_before: 06:00');
  });

  /**
   * The arms read `fits` rather than relying on the implicit `success()`.
   *
   * One arm's condition already named a status function (`!cancelled()`), and GitHub only adds the implicit
   * `success()` when the expression names none — so the refused guard skipped one arm and bought the other.
   * A guard two arms consult explicitly cannot be half-honoured.
   */
  it('publishes fits for the arms to consult, on both answers', () => {
    const fits = join(tmpdir(), `window-fit-${randomUUID()}.txt`);
    writeFileSync(fits, '');
    expect(
      run({ TAU_TRAIN_TASKS: '57', TAU_TEST_TASKS: '57', TAU_START_AT: '2026-11-18T04:00:00Z', GITHUB_OUTPUT: fits })
        .code,
    ).toBe(0);
    expect(readFileSync(fits, 'utf8')).toContain('fits=true');

    const refused = join(tmpdir(), `window-fit-${randomUUID()}.txt`);
    writeFileSync(refused, '');
    expect(
      run({ TAU_TRAIN_TASKS: '57', TAU_TEST_TASKS: '57', TAU_START_AT: '2026-11-18T05:30:00Z', GITHUB_OUTPUT: refused })
        .code,
    ).toBe(1);
    expect(readFileSync(refused, 'utf8')).toContain('fits=false');
  });
});
