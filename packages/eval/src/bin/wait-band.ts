/**
 * Sleep until the window a dispatch named, in the one place both jobs can call.
 *
 * The arithmetic is `planBandWait`'s and is tested there. This is the clock: it prints the plan before it
 * sleeps, counts down in minutes rather than one long sleep so a job that dies waiting says how far it got,
 * and exits non-zero when the window is further out than a job can carry.
 */
import { appendFileSync } from 'node:fs';
import { planBandWait } from '../band-wait.js';

function sleep(seconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, seconds * 1000);
}

function main(): number {
  const plan = planBandWait(new Date(), process.env['NOT_BEFORE'] ?? '');
  if (!plan.ok) {
    process.stdout.write(`::error::${plan.reason}\n`);
    return 1;
  }
  // The two deadline checks in the workflow subtract this from the job limit, and they read it from the
  // step's output rather than recomputing the wait: two implementations of "how long did we sleep" would
  // disagree the first time one of them changed.
  const out = process.env['GITHUB_OUTPUT'];
  if (out !== undefined) appendFileSync(out, `wait_min=${String(plan.minutes)}\n`);
  if (plan.minutes === 0) {
    process.stdout.write(`[wait-band] no window named, running now\n`);
    return 0;
  }
  process.stdout.write(
    `waiting ${String(plan.minutes)} minute(s) for ${plan.target.toISOString()}; ` +
      `it is ${new Date().toISOString()} now\n`,
  );
  for (let minute = 1; minute <= plan.minutes; minute += 1) {
    sleep(60);
    if (minute % 15 === 0) {
      process.stdout.write(`waited ${String(minute)}/${String(plan.minutes)} minute(s)\n`);
    }
  }
  process.stdout.write(`[wait-band] awake at ${new Date().toISOString()}\n`);
  return 0;
}

process.exitCode = main();
