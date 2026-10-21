/**
 * Structural diff over JSON.
 *
 * Array semantics are index-based with explicit insert/remove for length
 * changes. That is deliberate: a chart specification is an ordered list of
 * encodings, and an edit that moves `y` from index 1 to index 0 is a change of
 * meaning that an LCS-based "no change" verdict would hide. Domain packs can
 * override this with a semantic diff, and the chart pack does exactly that for
 * mark and encoding changes.
 */
import { jsonEqual } from './hash.js';
import type { CorrectionOp, Json, JsonPath } from './types.js';

function isPlainObject(value: Json): value is { [key: string]: Json } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function diffInto(before: Json, after: Json, path: JsonPath, out: CorrectionOp[]): void {
  if (jsonEqual(before, after)) return;

  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of [...keys].sort()) {
      const hasBefore = Object.prototype.hasOwnProperty.call(before, key);
      const hasAfter = Object.prototype.hasOwnProperty.call(after, key);
      const childPath = [...path, key];
      if (hasBefore && !hasAfter) {
        out.push({ op: 'remove', path: childPath, before: before[key] as Json });
      } else if (!hasBefore && hasAfter) {
        out.push({ op: 'insert', path: childPath, after: after[key] as Json });
      } else {
        diffInto(before[key] as Json, after[key] as Json, childPath, out);
      }
    }
    return;
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    const common = Math.min(before.length, after.length);
    for (let i = 0; i < common; i += 1) {
      diffInto(before[i] as Json, after[i] as Json, [...path, i], out);
    }
    // Removals descend so that each splice index is still valid when it runs;
    // ascending removals shift the tail left and skip the last element.
    for (let i = before.length - 1; i >= common; i -= 1) {
      out.push({ op: 'remove', path: [...path, i], before: before[i] as Json });
    }
    for (let i = common; i < after.length; i += 1) {
      out.push({ op: 'insert', path: [...path, i], after: after[i] as Json });
    }
    return;
  }

  out.push({ op: 'set', path, before, after });
}

export function diffJson(before: Json, after: Json): readonly CorrectionOp[] {
  const out: CorrectionOp[] = [];
  diffInto(before, after, [], out);
  return out;
}

/** Number of leaf changes; the numerator of the normalised edit distance. */
export function opCount(ops: readonly CorrectionOp[]): number {
  return ops.length;
}

/**
 * Normalised distance in [0, 1].
 *
 * `changed / max(1, changed + unchangedLeaves)` — bounded, symmetric for the
 * cases we care about, and cheap. It is not a metric and is never reported as
 * one; it exists to rank corrections by how much the user had to do.
 */
export function editDistance(
  before: Json,
  after: Json,
  ops: readonly CorrectionOp[] = diffJson(before, after),
): number {
  const changed = ops.length;
  if (changed === 0) return 0;
  const leaves = countLeaves(before) + countLeaves(after);
  return Math.min(1, changed / Math.max(1, leaves));
}

export function countLeaves(value: Json): number {
  if (value === null || typeof value !== 'object') return 1;
  if (Array.isArray(value)) {
    return value.reduce<number>((sum, entry) => sum + countLeaves(entry), 0);
  }
  const keys = Object.keys(value);
  if (keys.length === 0) return 1;
  return keys.reduce<number>((sum, key) => sum + countLeaves(value[key] as Json), 0);
}

type Container = Json[] | { [key: string]: Json };

function isContainer(value: Json): value is Container {
  return typeof value === 'object' && value !== null;
}

/** Apply a diff to a value, producing a new value. Used to verify round-trips. */
export function applyOps(before: Json, ops: readonly CorrectionOp[]): Json {
  let root: Json = structuredClone(before);
  for (const change of ops) {
    if (change.path.length === 0) {
      if (change.op === 'remove') return null;
      root = structuredClone(change.after);
      continue;
    }
    const parent = resolveParent(root, change.path);
    const key = change.path[change.path.length - 1];
    if (key === undefined) continue;
    if (Array.isArray(parent)) {
      if (typeof key !== 'number') continue;
      if (change.op === 'remove') parent.splice(key, 1);
      else if (change.op === 'insert') parent.splice(key, 0, structuredClone(change.after));
      else parent[key] = structuredClone(change.after);
    } else {
      const name = typeof key === 'string' ? key : String(key);
      if (change.op === 'remove') delete parent[name];
      else parent[name] = structuredClone(change.after);
    }
  }
  return root;
}

function resolveParent(root: Json, path: JsonPath): Container {
  let node: Json = root;
  for (let i = 0; i < path.length - 1; i += 1) {
    const key = path[i];
    if (!isContainer(node)) {
      throw new TypeError(`Path ${path.join('.')} does not resolve`);
    }
    node = Array.isArray(node)
      ? (node[key as number] as Json)
      : ((node as { [key: string]: Json })[key as string] as Json);
  }
  if (!isContainer(node)) {
    throw new TypeError(`Path ${path.join('.')} has a non-container parent`);
  }
  return node;
}
