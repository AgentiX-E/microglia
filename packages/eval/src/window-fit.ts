/**
 * Whether a dispatch fits in the off-peak window it is about to be billed in.
 *
 * R142's first dispatch is the reason this file exists. It was sent at 00:47 UTC, thirteen minutes before the
 * peak window opened at 01:00, and the τ² runner's `--require-off-peak` is checked **per phase** rather than
 * per run: the learn half started at 00:48 and was paid for, the eval phase started at 01:19 and was refused.
 * The run cost its learn half and produced no reading — `$0.1617` for a store nobody scored — and nothing
 * anywhere said the dispatch was too late in the window to finish in it.
 *
 * `planBandWait` answers "how long until the window", and `isPeak` answers "is it peak now". Neither answers
 * the question a dispatch actually has: **will this run still be inside the window when it finishes?** That is
 * arithmetic over an estimate and the remaining minutes, and it belongs in a function for the reason every
 * guard in this lane does — a check written inline in a workflow step is a check no test can call.
 *
 * ## The estimate, and why it is a measured number rather than a guess
 *
 * R141's job ran its 74 learn and 40 held-out episodes in 49 minutes and its 40 control episodes in 15, which
 * is 26 seconds an episode for a memory arm (learn, distill and evaluate) and 22 for the memory-free one. The
 * constant here is 26 — the slower of the two, applied to every episode, so the estimate errs toward refusing
 * a dispatch that would have fitted rather than toward the failure this file was written for. A margin covers
 * the checkout, the environment and the provider probe, none of which scales with the episode count.
 *
 * ## What it does not do
 *
 * It does not wait. Waiting is `planBandWait`'s job and the dispatch states its window with `not_before`; a
 * guard that sleeps would hide a dispatch that named no window behind a two-hour job. It also does not price
 * the run: a dispatch that fits is one that will be billed off-peak, and what it costs is `cost.ts`'s answer
 * to a different question.
 */
import { RATE_CARD, isPeak, nextOffPeak, type PeakWindow } from './cost.js';

/** Seconds an episode costs, measured on R141's pair. Documented above, not tuned. */
export const SECONDS_PER_EPISODE = 26;

/** Minutes of checkout, environment and probe that do not scale with the episode count. */
export const SETUP_MINUTES = 10;

export type WindowFit = {
  /** Whether the run is expected to finish before the window closes. */
  readonly fits: boolean;
  /** Minutes of off-peak left from the moment the run would start. */
  readonly minutesRemaining: number;
  /** Minutes the run is expected to take, setup included. */
  readonly estimatedMinutes: number;
  /**
   * The hour the guard is waiting for, as UTC `HH:MM`, when the run does not fit.
   *
   * Absent when it fits, and present when it does not: a refusal that says "not now" and not "at 04:00" is a
   * refusal the operator overrides, which is how a run gets dispatched at double price twice.
   */
  readonly windowOpensAt?: string;
};

/** `HH:MM` UTC, so a refusal can be pasted into `not_before` without arithmetic. */
function clockOf(moment: Date): string {
  return `${String(moment.getUTCHours()).padStart(2, '0')}:${String(moment.getUTCMinutes()).padStart(2, '0')}`;
}

/**
 * Minutes until the next peak hour begins, from a moment that is off-peak.
 *
 * Seven days of hours rather than one day's: a Friday evening is followed by a weekend with no peak at all,
 * and a guard that walked only 24 hours would report a window that opens on Saturday morning and is not
 * billed. The loop is bounded by a week for the same reason `nextOffPeak` is.
 */
function minutesUntilPeak(
  now: Date,
  windows: readonly PeakWindow[],
  weekdaysOnly: boolean,
): number {
  for (let minutes = 0; minutes <= 7 * 24 * 60; minutes += 1) {
    const candidate = new Date(now.getTime() + minutes * 60_000);
    if (isPeak(candidate, windows, weekdaysOnly)) return minutes;
  }
  // Unreachable while the card states at least one window, and named rather than returned as `Infinity`:
  // a run that "always fits" because the table was empty is the failure mode a zero window would hide.
  throw new RangeError('the rate card states no peak window, so no run can be out of one');
}

export function windowFit(input: {
  /** When the run would start, which is the dispatch time plus whatever `not_before` named. */
  readonly now: Date;
  readonly episodes: number;
  readonly windows?: readonly PeakWindow[];
  readonly weekdaysOnly?: boolean;
  readonly secondsPerEpisode?: number;
  readonly setupMinutes?: number;
}): WindowFit {
  const windows = input.windows ?? RATE_CARD.peakWindows;
  const weekdaysOnly = input.weekdaysOnly ?? RATE_CARD.peakWeekdaysOnly;
  const seconds = input.secondsPerEpisode ?? SECONDS_PER_EPISODE;
  const setup = input.setupMinutes ?? SETUP_MINUTES;
  if (!Number.isFinite(input.episodes) || input.episodes < 0) {
    throw new RangeError(`episodes must be a non-negative count, received ${String(input.episodes)}`);
  }
  const estimatedMinutes = Math.ceil((input.episodes * seconds) / 60) + setup;
  if (isPeak(input.now, windows, weekdaysOnly)) {
    // A dispatch whose start is inside the window cannot fit any run: the first phase would be refused, and
    // the honest reading is zero minutes left rather than a negative remainder.
    const opens = nextOffPeak(input.now, windows, weekdaysOnly);
    return {
      fits: false,
      minutesRemaining: 0,
      estimatedMinutes,
      windowOpensAt: clockOf(opens),
    };
  }
  const minutesRemaining = minutesUntilPeak(input.now, windows, weekdaysOnly);
  if (estimatedMinutes <= minutesRemaining) {
    return { fits: true, minutesRemaining, estimatedMinutes };
  }
  const opening = new Date(input.now.getTime() + minutesRemaining * 60_000);
  return {
    fits: false,
    minutesRemaining,
    estimatedMinutes,
    windowOpensAt: clockOf(opening),
  };
}

/**
 * One line, whether or not the run fits.
 *
 * Printed on success as well as refusal: "the window has 120 minutes and this run needs 99" is the reading
 * that lets the next dispatch be sized deliberately rather than by luck, and a line that only exists on
 * failure is a line nobody learns from.
 */
export function windowFitLine(fit: WindowFit): string {
  if (fit.fits) {
    return (
      `off-peak window: ${String(fit.minutesRemaining)} minute(s) left, ` +
      `this run is estimated at ${String(fit.estimatedMinutes)} — it fits`
    );
  }
  return (
    `off-peak window: ${String(fit.minutesRemaining)} minute(s) left against an estimate of ` +
    `${String(fit.estimatedMinutes)} — the run would cross into the window that opens at ` +
    `${fit.windowOpensAt ?? 'an unstated hour'}, and ` +
    `\`--require-off-peak\` is checked per phase, so the half it paid for would be lost. ` +
    `Dispatch with not_before: ${fit.windowOpensAt ?? 'HH:MM'}`
  );
}
