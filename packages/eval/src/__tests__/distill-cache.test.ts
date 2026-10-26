import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DistillCache } from '../distill-cache.js';

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'distill-cache-'));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe('DistillCache', () => {
  it('keys on the model, the prompt version and the prompt together', () => {
    const base = DistillCache.keyOf('m', 'v1', 'p');
    expect(DistillCache.keyOf('m', 'v1', 'p')).toBe(base);
    expect(DistillCache.keyOf('other', 'v1', 'p')).not.toBe(base);
    expect(DistillCache.keyOf('m', 'v2', 'p')).not.toBe(base);
    expect(DistillCache.keyOf('m', 'v1', 'q')).not.toBe(base);
  });

  it('does not let a field boundary be forged by concatenation', () => {
    // Without a separator, ("a","bc") and ("ab","c") would produce the same key.
    expect(DistillCache.keyOf('a', 'bc', 'x')).not.toBe(DistillCache.keyOf('ab', 'c', 'x'));
  });

  it('counts a hit and a miss apart, because the ratio is what says the cache works', () => {
    const cache = DistillCache.load(undefined);
    expect(cache.get('k')).toBeUndefined();
    cache.set('k', 'reply');
    expect(cache.get('k')).toBe('reply');
    expect(cache.stats).toEqual({ hits: 1, misses: 1, size: 1 });
  });

  it('survives a round trip through disk', () => {
    const path = join(directory, 'cache.json');
    const first = DistillCache.load(path);
    first.set('k', 'reply');
    first.save();
    expect(DistillCache.load(path).get('k')).toBe('reply');
  });

  it('reports zero hits on a fresh load rather than inheriting the writer counts', () => {
    const path = join(directory, 'cache.json');
    const first = DistillCache.load(path);
    first.set('k', 'reply');
    first.save();
    expect(DistillCache.load(path).stats).toEqual({ hits: 0, misses: 0, size: 1 });
  });

  it('treats a missing file as an empty cache', () => {
    const cache = DistillCache.load(join(directory, 'absent.json'));
    expect(cache.stats.size).toBe(0);
  });

  it('treats an empty path as no cache at all, and saving it writes nothing', () => {
    const cache = DistillCache.load('');
    cache.set('k', 'reply');
    cache.save();
    expect(cache.stats.size).toBe(1);
    expect(existsSync(join(directory, 'undefined'))).toBe(false);
  });

  it('ignores a corrupt file instead of refusing to start', () => {
    // The cache is an optimisation; a truncated one must not become an availability
    // dependency for the benchmark.
    const path = join(directory, 'cache.json');
    writeFileSync(path, '{"k": "trunc', 'utf8');
    expect(DistillCache.load(path).stats.size).toBe(0);
  });

  it('ignores entries that are not strings, and a file that is not an object', () => {
    const path = join(directory, 'cache.json');
    writeFileSync(path, JSON.stringify({ good: 'reply', bad: 7, worse: { a: 1 } }), 'utf8');
    const cache = DistillCache.load(path);
    expect(cache.get('good')).toBe('reply');
    expect(cache.get('bad')).toBeUndefined();
    writeFileSync(path, '[1,2,3]', 'utf8');
    expect(DistillCache.load(path).stats.size).toBe(0);
    writeFileSync(path, 'null', 'utf8');
    expect(DistillCache.load(path).stats.size).toBe(0);
  });

  it('writes atomically, so an interrupted save cannot leave a partial file', () => {
    const path = join(directory, 'nested', 'cache.json');
    mkdirSync(join(directory, 'nested'), { recursive: true });
    const cache = DistillCache.load(path);
    cache.set('k', 'reply');
    cache.save();
    expect(existsSync(`${path}.partial`)).toBe(false);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ k: 'reply' });
  });

  it('sorts the keys it writes, so two identical caches are byte-identical', () => {
    const path = join(directory, 'cache.json');
    const cache = DistillCache.load(path);
    cache.set('b', 'two');
    cache.set('a', 'one');
    cache.save();
    expect(readFileSync(path, 'utf8')).toBe('{"a":"one","b":"two"}');
  });

  it('lets a later reply replace an earlier one for the same key', () => {
    const cache = DistillCache.load(undefined);
    cache.set('k', 'first');
    cache.set('k', 'second');
    expect(cache.get('k')).toBe('second');
    expect(cache.stats).toEqual({ hits: 1, misses: 0, size: 1 });
  });
});
