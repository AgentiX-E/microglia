/**
 * Canonical JSON and content hashing.
 *
 * Two runs that produced the same knowledge must hash the same, or the
 * evaluation cannot tell "nothing changed" from "everything changed". Key order
 * is therefore normalised recursively and the hash is computed over the
 * canonical form rather than over `JSON.stringify` of whatever object happened
 * to arrive.
 */
import { contentKey } from './ids.js';
import type { Json } from './types.js';

export function canonicalize(value: Json): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) {
        throw new TypeError('Cannot canonicalize a non-finite number');
      }
      return Object.is(value, -0) ? '0' : String(value);
    case 'string':
      return JSON.stringify(value);
    default:
      break;
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalize(entry)).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  const body = keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key] as Json)}`);
  return `{${body.join(',')}}`;
}

export function hashJson(value: Json): string {
  return contentKey(canonicalize(value));
}

export function hashText(value: string): string {
  return contentKey(value);
}

/** Structural equality on the canonical form; safe for nested JSON only. */
export function jsonEqual(a: Json, b: Json): boolean {
  return canonicalize(a) === canonicalize(b);
}
