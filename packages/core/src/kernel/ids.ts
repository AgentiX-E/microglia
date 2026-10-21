/**
 * Identifier generation.
 *
 * A monotonic-time prefix plus randomness gives sortable ids without a
 * dependency, and the injected random source keeps a replay deterministic.
 * Determinism is not cosmetic here: the evaluation harness compares two arms on
 * the same inputs, and an id that changes per run makes every artifact diff
 * unreadable.
 */
export type RandomSource = () => number;

/** mulberry32 — 32-bit, seedable, and adequate for ids and bootstrap resampling. */
export function mulberry32(seed: number): RandomSource {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

function encodeBase32(value: number, length: number): string {
  let out = '';
  let n = value;
  for (let i = 0; i < length; i += 1) {
    out = ALPHABET[n % 32] + out;
    n = Math.floor(n / 32);
  }
  return out;
}

/**
 * `prefix_time_random`, e.g. `fb_01j9z3k4m2_7f3a9c`.
 *
 * 48 bits of millisecond time then 24 bits of randomness: two events in the same
 * millisecond collide with probability 2^-24 per pair, and ids sort by time,
 * which is what makes an append-only log readable without an index.
 */
export function newId(prefix: string, now: number, random: RandomSource): string {
  const time = Math.max(0, Math.floor(now)).toString(32).padStart(10, '0');
  const rand = Math.floor(random() * 0x1000000);
  return `${prefix}_${time}_${encodeBase32(rand, 5)}`;
}

/** A stable, human-auditable content key. Used for dedupe, never for security. */
export function contentKey(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i += 1) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x85ebca6b);
  }
  return ((h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0')).slice(
    0,
    16,
  );
}
