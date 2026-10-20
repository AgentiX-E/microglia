/**
 * Time is a dependency, not an ambient fact.
 *
 * Value, validity and retirement all read the clock. A test that cannot pin the
 * clock cannot assert on any of them, and a replay that reads wall time cannot
 * reproduce yesterday's decision.
 */
export type Clock = {
  now(): number;
};

export const systemClock: Clock = {
  now: () => Date.now(),
};

export function fixedClock(at: number): Clock {
  let current = at;
  return {
    now: () => current,
  };
}

/** A clock that advances by a fixed step on every read; useful for ordered logs. */
export function steppingClock(start: number, stepMs = 1): Clock {
  let current = start;
  return {
    now: () => {
      const value = current;
      current += stepMs;
      return value;
    },
  };
}
