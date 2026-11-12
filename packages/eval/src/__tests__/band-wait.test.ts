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
