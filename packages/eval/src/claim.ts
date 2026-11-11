/**
 * What a committed artefact is allowed to claim.
 *
 * Every lane in this repository writes its result to a JSON file under `eval/results` or
 * `bench/results`, and those files are committed: they are the derivation behind numbers the
 * documents quote. `pnpm check` runs the lanes, so it rewrites them — and six of them carried a wall
 * clock or a host's speed, which made the gate dirty the tree on every run. That went unnoticed until
 * an experiment's commit arrived with **279 lines of a sandbox's latency** in it, which is how this
 * module came to exist: not because the numbers were wrong, but because a reader could not tell them
 * from evidence.
 *
 * The rule it enforces is small and it is the whole point:
 *
 * > An artefact records a claim about the code. The hour it ran and the speed of the machine that ran
 * > it are not claims about the code, and a file that carries them is not reproducible by anyone.
 *
 * Stripping is by **exact key name at any depth**, not by pattern. A pattern is how `p95_budget_ms`
 * — a threshold the study *claims* — would be deleted as if it were a measurement, and the census
 * that produced this list is also the reason it is a list: of the forty timing-shaped keys in the
 * committed corpus, exactly six were observed changing between two runs of the same code.
 */
export const VOLATILE_KEYS: readonly string[] = [
  /** When the lane ran. The dispatch's own record is the authority on that. */
  'ranAt',
  /** The bench study's per-arm latency, in milliseconds, on whichever machine ran it. */
  'p50Ms',
  'p95Ms',
  'p99Ms',
  /** The same measurement in the snake-case lanes. */
  'p50_ms',
  'p95_ms',
  'p99_ms',
  /** The delivery lane's worst-case round trip, which is a measurement of the host's scheduler. */
  'slowest_ms',
];

const VOLATILE: ReadonlySet<string> = new Set(VOLATILE_KEYS);

/** Where a volatile value was found, so the sidecar says which arm's latency it was. */
export type VolatilePath = string;

export type ClaimSplit = {
  /** The artefact as it should be committed: no clock, no host timings. */
  readonly claim: unknown;
  /** What was removed, keyed by its path in the original document. */
  readonly volatile: Readonly<Record<VolatilePath, unknown>>;
};

/**
 * Split a lane's result into the part that is a claim and the part that is a measurement of the run.
 *
 * Recursive, because the timings that actually churned sat three levels down inside an array of arms
 * (`arms[0].latency.p50Ms`); a top-level strip would have missed every one of them and the gate would
 * have stayed dirty while looking fixed. Paths are JSON-pointer-ish but readable — `arms[0].p50Ms` —
 * because the sidecar is meant to be read by a person asking "which arm was slow".
 *
 * The input is never mutated: a lane that keeps using its own object after writing it must not find
 * its latency silently missing.
 */
export function splitClaim(value: unknown): ClaimSplit {
  const volatile: Record<string, unknown> = {};
  const claim = walk(value, '', volatile);
  return { claim, volatile };
}

function walk(value: unknown, path: string, out: Record<string, unknown>): unknown {
  if (Array.isArray(value)) {
    return value.map((entry, index) => walk(entry, `${path}[${index}]`, out));
  }
  if (value === null || typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const at = path === '' ? key : `${path}.${key}`;
    if (VOLATILE.has(key)) {
      out[at] = entry;
      continue;
    }
    result[key] = walk(entry, at, out);
  }
  return result;
}

/**
 * The names of every volatile key still present, found rather than assumed.
 *
 * The migration that introduced `splitClaim` rewrote the committed corpus once, and a corpus is
 * exactly the thing that grows back: a new lane writes `ranAt` because every lane does, its file is
 * committed, and the invariant is quietly false again. This is the check that reads the files
 * instead of trusting the walk, and it is what `eval:claim-check` calls.
 */
export function volatileKeysIn(value: unknown): readonly VolatilePath[] {
  const found: string[] = [];
  visit(value, '', found);
  return found;
}

function visit(value: unknown, path: string, out: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => visit(entry, `${path}[${index}]`, out));
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const at = path === '' ? key : `${path}.${key}`;
    if (VOLATILE.has(key)) out.push(at);
    visit(entry, at, out);
  }
}
