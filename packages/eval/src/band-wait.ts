/**
 * How long a dispatch waits for the off-peak window, as a value.
 *
 * The provider bills two bands and peak is exactly double: R77 ran at 23:19 UTC for $0.531 and R78 ran the
 * same experiment at 03:19 UTC for $1.111, 95% of it at peak. `not_before: HH:MM` exists so a dispatch that
 * is ready is *queued* for the window instead of being dispatched twice, and it lived as twenty lines of
 * `date` arithmetic inside one workflow step.
 *
 * That was one copy for two jobs. The L4 job never ran it — the wait lived in the BIRD job's step list — so
 * two dispatches on 2026-11-12 waited for nothing, woke no one, and were refused by the τ² runner at
 * `--require-off-peak` two minutes after they were sent. The arithmetic moves here, where it is a function
 * with a clock and a test, and both jobs call the same one.
 *
 * The ceiling is a limit rather than a preference: the job limit is 340 minutes and the run needs its own
 * deadline after the wait, so a window further out than four hours is refused by name instead of being slept
 * through and killed.
 */
export type BandWait =
  | { readonly ok: true; readonly minutes: number; readonly target: Date }
  | { readonly ok: false; readonly reason: string };

/** The longest wait a job may spend, in minutes, before it must refuse instead. */
export const MAX_BAND_WAIT_MINUTES = 240;

/** `HH:MM`, 24-hour, UTC. Anything else is refused: a mistyped window is a silent two-hour sleep. */
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * The wait a dispatch named, from the clock it was sent at.
 *
 * An empty `notBefore` is a dispatch that named no window: the wait is zero and the caller proceeds, which
 * keeps every pre-existing dispatch exactly where it was. A time already past today means *tomorrow* — the
 * window is a wall clock, and a dispatch at 05:00 naming 04:00 wants the next 04:00, not a negative wait.
 */
export function planBandWait(
  now: Date,
  notBefore: string,
  maxMinutes: number = MAX_BAND_WAIT_MINUTES,
): BandWait {
  const wanted = notBefore.trim();
  if (wanted === '') return { ok: true, minutes: 0, target: new Date(now.getTime()) };
  const match = HHMM.exec(wanted);
  if (match === null) {
    return { ok: false, reason: `not_before must be HH:MM in UTC, received '${wanted}'` };
  }
  const target = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      Number(match[1]),
      Number(match[2]),
      0,
      0,
    ),
  );
  if (target.getTime() <= now.getTime()) target.setUTCDate(target.getUTCDate() + 1);
  const minutes = Math.ceil((target.getTime() - now.getTime()) / 60_000);
  if (minutes > maxMinutes) {
    return {
      ok: false,
      reason:
        `not_before ${wanted} is ${String(minutes)} minutes away; this lane waits at most ` +
        `${String(maxMinutes)}, because the job limit is 340 and the run needs its own deadline after the wait`,
    };
  }
  return { ok: true, minutes, target };
}
