import { describe, expect, it } from 'vitest';
import { CircuitBreaker, backoffMs, mapPool } from '../concurrency.js';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('mapPool', () => {
  it('keeps results aligned with their input positions', async () => {
    const items = [5, 3, 1, 4, 2];
    // Deliberately inverted delays: the third item finishes first.
    const results = await mapPool(items, 3, async (value) => {
      await sleep(value * 2);
      return value * 10;
    });
    expect(results).toEqual([50, 30, 10, 40, 20]);
  });

  it('runs at most `limit` workers at once', async () => {
    let active = 0;
    let peak = 0;
    const items = Array.from({ length: 20 }, (_, index) => index);
    await mapPool(items, 4, async () => {
      active += 1;
      peak = Math.max(peak, active);
      await sleep(2);
      active -= 1;
    });
    expect(peak).toBe(4);
  });

  it('does not start more workers than there is work', async () => {
    let peak = 0;
    let active = 0;
    await mapPool([1, 2], 8, async () => {
      active += 1;
      peak = Math.max(peak, active);
      await sleep(2);
      active -= 1;
    });
    expect(peak).toBe(2);
  });

  it('returns an empty array for empty input, whatever the limit', async () => {
    await expect(mapPool([], 4, async () => 1)).resolves.toEqual([]);
    await expect(mapPool([], 1, async () => 1)).resolves.toEqual([]);
  });

  it('rejects a limit that cannot be a pool size', async () => {
    await expect(mapPool([1], 0, async () => 1)).rejects.toThrow(RangeError);
    await expect(mapPool([1], -2, async () => 1)).rejects.toThrow(RangeError);
    await expect(mapPool([1], 1.5, async () => 1)).rejects.toThrow(RangeError);
  });

  it('stops issuing work after the first failure and rethrows it', async () => {
    const started: number[] = [];
    const items = Array.from({ length: 20 }, (_, index) => index);
    await expect(
      mapPool(items, 2, async (value) => {
        started.push(value);
        if (value === 3) throw new Error('boom');
        await sleep(2);
        return value;
      }),
    ).rejects.toThrow('boom');
    // With two runners, the failure stops the pool after at most one further
    // claim: the runner that was already in flight. It never reaches item 4.
    expect(started.length).toBeGreaterThanOrEqual(3);
    expect(started.length).toBeLessThanOrEqual(4);
    expect(started).not.toContain(4);
  });

  it('reports the first failure rather than the last', async () => {
    await expect(
      mapPool([1, 2], 1, async (value) => {
        await sleep(1);
        throw new Error(`failure-${value}`);
      }),
    ).rejects.toThrow('failure-1');
  });

  it('passes the index alongside the item', async () => {
    const seen: string[] = [];
    await mapPool(['a', 'b'], 2, async (item, index) => {
      seen.push(`${index}:${item}`);
      return item;
    });
    expect(seen.sort()).toEqual(['0:a', '1:b']);
  });
});

describe('backoffMs', () => {
  it('doubles the window with each attempt when the jitter is zero', () => {
    const none = (): number => 0;
    expect(backoffMs(1, 500, none)).toBe(500);
    expect(backoffMs(2, 500, none)).toBe(1000);
    expect(backoffMs(3, 500, none)).toBe(2000);
  });

  it('spreads retries by up to half the window', () => {
    const full = (): number => 1;
    expect(backoffMs(1, 500, full)).toBe(750);
    expect(backoffMs(2, 500, full)).toBe(1500);
  });

  it('treats attempt 0 as the first attempt rather than as a negative exponent', () => {
    expect(backoffMs(0, 500, () => 0)).toBe(500);
  });

  it('honours a different base', () => {
    expect(backoffMs(1, 40, () => 0)).toBe(40);
    expect(backoffMs(2, 40, () => 0)).toBe(80);
  });
});

describe('CircuitBreaker', () => {
  it('refuses a threshold that cannot trip', () => {
    expect(() => new CircuitBreaker(0)).toThrow(RangeError);
    expect(() => new CircuitBreaker(2.5)).toThrow(RangeError);
  });

  it('trips on the threshold-th consecutive failure', () => {
    const breaker = new CircuitBreaker(3);
    expect(breaker.record(false)).toBe(true);
    expect(breaker.record(false)).toBe(true);
    expect(breaker.record(false)).toBe(false);
    expect(breaker.streak).toBe(3);
  });

  it('resets on a success, so intermittent failures never trip it', () => {
    const breaker = new CircuitBreaker(2);
    expect(breaker.record(false)).toBe(true);
    expect(breaker.record(true)).toBe(true);
    expect(breaker.streak).toBe(0);
    expect(breaker.record(false)).toBe(true);
    expect(breaker.record(false)).toBe(false);
  });

  it('stays tripped while failures continue', () => {
    const breaker = new CircuitBreaker(1);
    expect(breaker.record(false)).toBe(false);
    expect(breaker.record(false)).toBe(false);
    expect(breaker.streak).toBe(2);
  });
});
