import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_BAND_WAIT_MINUTES, planBandWait } from '../band-wait.js';

/**
 * The wait is a value, so the two jobs that need it cannot disagree about it.
 *
 * The failure this closes is not arithmetic. `not_before` was twenty lines of `date` inside the BIRD job's
 * step list, and the L4 job — the one that actually pays for an hour of τ² calls — never ran it. Two
 * dispatches were sent on 2026-11-12 naming 04:00, started at 02:01, and were refused by the runner at
 * `--require-off-peak` two minutes later: the wait existed and reached one of the two arms.
 */
describe('planBandWait', () => {
  const at = (iso: string): Date => new Date(iso);

  it('waits not at all when the dispatch named no window', () => {
    const plan = planBandWait(at('2026-11-12T02:01:00Z'), '');
    expect(plan.ok).toBe(true);
    expect(plan.ok && plan.minutes).toBe(0);
  });

  it('names the minutes to a window later today', () => {
    const plan = planBandWait(at('2026-11-12T02:01:00Z'), '04:00');
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.minutes).toBe(119);
    expect(plan.target.toISOString()).toBe('2026-11-12T04:00:00.000Z');
  });

  it("rolls to tomorrow when today's window has already passed", () => {
    // A dispatch at 05:00 naming 04:00 wants the next 04:00. A negative wait would put the target in the
    // past and every later step would run immediately, which is the same outcome as not waiting at all.
    const plan = planBandWait(at('2026-11-12T05:00:00Z'), '04:00', 24 * 60);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.minutes).toBe(23 * 60);
    expect(plan.target.toISOString()).toBe('2026-11-13T04:00:00.000Z');
    // And under the real ceiling the same window is refused rather than slept through: a day is further
    // out than a job can carry, so the answer is no, not a longer sleep.
    expect(planBandWait(at('2026-11-12T05:00:00Z'), '04:00').ok).toBe(false);
  });

  it('refuses a window further out than a job can carry', () => {
    const plan = planBandWait(at('2026-11-12T02:01:00Z'), '23:59');
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reason).toContain('1318 minutes');
    expect(plan.reason).toContain(String(MAX_BAND_WAIT_MINUTES));
  });

  it('refuses a window it cannot read, rather than sleeping on a guess', () => {
    // `date -d` accepts a great deal of English. A workflow that accepted it too would sleep for a window
    // nobody chose, and the run would start at an arbitrary hour with no line saying why.
    for (const bad of ['4:00', '04:00:00', '0400', 'tomorrow', '25:00', '04:60']) {
      const plan = planBandWait(at('2026-11-12T02:01:00Z'), bad);
      expect(plan.ok, bad).toBe(false);
      if (plan.ok) continue;
      expect(plan.reason).toContain('HH:MM');
    }
  });

  it('rounds up, so a partial minute is not a minute of nothing', () => {
    const plan = planBandWait(at('2026-11-12T03:59:30Z'), '04:00');
    expect(plan.ok).toBe(true);
    expect(plan.ok && plan.minutes).toBe(1);
  });
});

/**
 * `eval:wait-band`, the step that does the sleeping.
 *
 * R146. The guard that decides whether a run fits the window used to re-parse `not_before` on its own clock,
 * four minutes after the wait had ended, and read the hour it had just slept to as the next day's — refusing
 * the dispatch it had waited for. The wait step therefore publishes the instant it woke, and the guard
 * consumes that instead of parsing the request twice: one parse, one clock, one answer.
 */
describe('eval:wait-band, the command a workflow step calls', () => {
  it('publishes the instant it woke, for the guard that runs after it', () => {
    const out = join(tmpdir(), `wait-band-${randomUUID()}.txt`);
    writeFileSync(out, '');
    const child = spawnSync('npx', ['tsx', 'packages/eval/src/bin/wait-band.ts'], {
      encoding: 'utf8',
      env: { ...process.env, NOT_BEFORE: '', GITHUB_OUTPUT: out },
    });
    expect(child.status, child.stderr).toBe(0);
    const published = readFileSync(out, 'utf8');
    expect(published).toContain('wait_min=0');
    // An ISO instant rather than an hour: the card's windows are bounded by minutes as well as by hours, so
    // an `HH:MM` would have to be re-read against a date the guard does not have.
    const start = /start_at=(\S+)/.exec(published)?.[1];
    expect(start, published).toBeDefined();
    expect(Number.isNaN(new Date(start ?? '').getTime())).toBe(false);
    // A dispatch with no window runs now, so the instant it publishes is the instant it started.
    expect(Math.abs(new Date(start ?? '').getTime() - Date.now())).toBeLessThan(120_000);
  });
});
