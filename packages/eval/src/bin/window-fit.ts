/**
 * Refuse a τ² dispatch that cannot finish inside the off-peak window it starts in.
 *
 * R142's first dispatch was sent thirteen minutes before the peak hour and lost its learn half: the runner's
 * `--require-off-peak` is evaluated per phase, so the half that started off-peak was paid for and the half
 * that started at 01:19 was refused. The arithmetic that would have caught it is `windowFit`; this is the
 * command a workflow step calls, and it takes its inputs from the same registration caps the arm runs under.
 *
 *     NOT_BEFORE=04:00 TAU_TRAIN_TASKS=57 TAU_TEST_TASKS=57 pnpm --silent eval:window-fit
 *
 * Three states, and the third is why it exits non-zero rather than printing a warning:
 *
 * - **fits** — the estimate is below the remaining off-peak minutes. Printed with both numbers.
 * - **does not fit** — refused with the hour to name in `not_before`, because a guard that refuses without
 *   saying when is a guard an operator overrides.
 * - **peak was authorised** — `TAU_ALLOW_PEAK=1` is the repository variable the lane already reads, and a
 *   dispatch under it is billed at double price deliberately. This command says so and proceeds; it does not
 *   silently disagree with a decision somebody made.
 */
import { planBandWait } from '../band-wait.js';
import { windowFit, windowFitLine } from '../window-fit.js';

function count(name: string): number {
  const raw = (process.env[name] ?? '').trim();
  if (raw === '') return 0;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} is '${raw}', which is not a count of tasks`);
  }
  return value;
}

const allowPeak = (process.env['TAU_ALLOW_PEAK'] ?? '').trim() === '1';
if (allowPeak) {
  process.stdout.write('off-peak window: not checked — TAU_ALLOW_PEAK=1 bills this dispatch at peak rate\n');
} else {
  const now = new Date();
  const wait = planBandWait(now, (process.env['NOT_BEFORE'] ?? '').trim());
  if (!wait.ok) {
    process.stderr.write(`::error::${wait.reason}\n`);
    process.exit(1);
  }
  const start = wait.target;
  const trainTasks = count('TAU_TRAIN_TASKS');
  const testTasks = count('TAU_TEST_TASKS');
  // One trial per task per arm unless the registration says otherwise, and one arm per side of the pair.
  const trials = Math.max(1, count('TAU_TRIALS') || 1);
  const arms = Math.max(1, count('TAU_WINDOW_ARMS') || 2);
  const episodes = (trainTasks + testTasks) * trials * arms;
  if (episodes === 0) {
    // A dispatch that names no caps has no estimate, and an estimate of zero would fit every window. Refusing
    // is the only reading that does not turn "the caps are missing" into "the run is free".
    process.stderr.write(
      '::error::TAU_TRAIN_TASKS and TAU_TEST_TASKS are both zero, so this dispatch has no episode count to estimate from; the registration must pin both caps\n',
    );
    process.exit(1);
  }
  const fit = windowFit({ now: start, episodes });
  process.stdout.write(`${windowFitLine(fit)}\n`);
  process.stdout.write(`episodes=${String(episodes)} arms=${String(arms)} trials=${String(trials)}\n`);
  if (!fit.fits) {
    process.stderr.write(`::error::${windowFitLine(fit)}\n`);
    process.exit(1);
  }
}
