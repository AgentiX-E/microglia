import { describe, expect, it } from 'vitest';
import { memoryOutbox, persistedOutbox, type StorageLike } from '../outbox.js';

const entry = (key: string) => ({
  key,
  attempts: 0,
  payload: {
    run: { task: 't', input: {}, output: {} },
    feedback: { type: 'outcome' as const, ok: true },
  },
});

/** A storage that behaves like a browser's, so the queue is tested without one. */
function storage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

describe('in-memory outbox', () => {
  it('queues, updates, removes, and lists a copy', () => {
    const outbox = memoryOutbox();
    outbox.push(entry('a'));
    outbox.push(entry('b'));
    expect(outbox.list().map((item) => item.key)).toEqual(['a', 'b']);
    outbox.update('a', 2);
    expect(outbox.list()[0]?.attempts).toBe(2);
    outbox.update('missing', 1);
    outbox.remove('a');
    outbox.remove('missing');
    expect(outbox.list().map((item) => item.key)).toEqual(['b']);
  });
});

describe('persisted outbox', () => {
  it('survives a new instance over the same storage', () => {
    const store = storage();
    const first = persistedOutbox(store);
    first.push(entry('a'));
    const second = persistedOutbox(store);
    expect(second.list().map((item) => item.key)).toEqual(['a']);
    second.update('a', 3);
    expect(persistedOutbox(store).list()[0]?.attempts).toBe(3);
    second.remove('a');
    expect(persistedOutbox(store).list()).toEqual([]);
  });

  it('treats unreadable storage as an empty queue', () => {
    const broken = storage({ 'microglia.outbox': 'not json' });
    expect(persistedOutbox(broken).list()).toEqual([]);
    const wrongShape = storage({ 'microglia.outbox': '{"a":1}' });
    expect(persistedOutbox(wrongShape).list()).toEqual([]);
  });

  it('keeps working when storage refuses to write', () => {
    const full: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    };
    const outbox = persistedOutbox(full);
    expect(() => outbox.push(entry('a'))).not.toThrow();
    expect(outbox.list()).toEqual([]);
  });
});

describe('the outbox ledger', () => {
  it('ignores an update for a key it does not hold', () => {
    // Retries race with a flush that already succeeded. An update for a gone key
    // must not resurrect it, and must not throw inside a retry loop.
    const outbox = memoryOutbox();
    const payload = { run: { task: 't', input: {}, output: {} }, feedback: { type: 'rating', value: 'up' } };
    outbox.push({ key: 'k1', payload, attempts: 0 });
    outbox.update('absent', 5);
    expect(outbox.list().map((entry) => entry.key)).toEqual(['k1']);
    outbox.update('k1', 2);
    expect(outbox.list()[0]?.attempts).toBe(2);
  });
});
describe('the persisted outbox', () => {
  it('ignores an update for a key it does not hold', () => {
    const memory = new Map<string, string>();
    const storage: StorageLike = {
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => void memory.set(key, value),
      removeItem: (key) => void memory.delete(key),
    };
    const outbox = persistedOutbox(storage);
    const payload = { run: { task: 't', input: {}, output: {} }, feedback: { type: 'rating', value: 'up' } };
    outbox.push({ key: 'k1', payload, attempts: 0 });
    outbox.update('absent', 9);
    expect(outbox.list()).toHaveLength(1);
    expect(outbox.list()[0]?.attempts).toBe(0);
    outbox.update('k1', 3);
    expect(outbox.list()[0]?.attempts).toBe(3);
  });
});
