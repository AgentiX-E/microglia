/**
 * How wide the rules in a store are.
 *
 * ## The hypothesis this instrument exists for
 *
 * Four 2026 results say the same thing from four directions, and none of them is about size:
 * a store hurts when its rules travel further than the interaction that produced them.
 * *The Memory Trap* (Liang et al., arXiv 2611.07554) finds benign sessions producing notes that
 * govern high-stakes ones in **35–81%** of episodes, and names the requirement: record the scope a
 * memory was formed in and refuse to apply it outside. *Useful Memories Become Faulty* (arXiv
 * 2605.12978) isolates the mechanism — abstraction **strips the applicability conditions** — and
 * shows an episodic-only control matching the consolidators. *More Memory, Worse Agents* (arXiv
 * 2610.27406) calls the loop *error reproduction*. *MemDev-Bench* (arXiv 2610.27524) attributes
 * failures to "reusing memory without reassessing its applicability".
 *
 * Microglia already carries `KnowledgeScope`, so the field is not missing. The question this module
 * asks is what the field **contains**: `scopeMatches` treats an absent dimension as a wildcard, so a
 * record that declares nothing beyond its task matches every request on every other dimension. That
 * is a defensible reading of a *specificity* problem and an indefensible reading of a *silence* —
 * the same distinction R110 had to draw for `polarity`, where "absent" means unclassified and never
 * `pass`.
 *
 * ## What it does not do
 *
 * It counts. It does not decide that a broad rule is wrong, because a broad rule can be correct —
 * `when` is the condition, and the condition is a separate field. What it prices is the **share of
 * the store that has nothing to say about where it applies**, which is the number any scope arm has
 * to move before it can claim a mechanism.
 *
 * ## Why the caller has to declare what the dump carried
 *
 * A dump is a projection, and this project has already paid once for reading a projection's silence
 * as a value (AUDIT 34.135: every τ² record read as a success because one `kind` defaulted). A dump
 * that carries `domain` and not `field` cannot be used to say anything about `field`, so the carried
 * list is an argument rather than a default, and a missing list is `unavailable` rather than zero.
 */
import type { StoreDumpItem } from './retrospect-store.js';

/** The dimensions a `KnowledgeScope` can declare, in the order the type declares them. */
export const SCOPE_DIMS = ['domain', 'schemaDigest', 'intent', 'field', 'reasonCode'] as const;

export type ScopeDim = (typeof SCOPE_DIMS)[number];

/** One dimension's two counts, kept together so a reader cannot report one without the other. */
export type DimCounts = { readonly declared: number; readonly open: number };

export type ScopeCensus = {
  /**
   * `empty` is a reading, not a failure: a dump with no records has no scope to describe.
   * `unavailable` is a refusal: the dump did not say what it carried.
   */
  readonly state: 'read' | 'empty' | 'unavailable';
  readonly sentence: string;
  readonly records: number;
  /** Records with a scope object that names a task, and can therefore be placed. */
  readonly scoped: number;
  /** Records with no scope object at all. Unknown, never wide. */
  readonly unscoped: number;
  /** Records with a scope object that names no task, so even the outermost dimension is unreadable. */
  readonly malformed: number;
  readonly declared: Readonly<Record<ScopeDim, number>>;
  readonly open: Readonly<Record<ScopeDim, number>>;
  /** Readable records by declared-dimension count, 1 (task only) to 6 (every dimension). */
  readonly bySpecificity: Readonly<Record<number, number>>;
  /** The widest a microglia scope can be: a task and nothing else. */
  readonly broad: number;
  /** `broad / scoped`, or 0 when nothing is readable. Reported as a share, never as a percentage claim. */
  readonly broadShare: number;
};

const zeroDims = (): Record<ScopeDim, number> => ({
  domain: 0,
  schemaDigest: 0,
  intent: 0,
  field: 0,
  reasonCode: 0,
});

function share(part: number, whole: number): number {
  return whole === 0 ? 0 : part / whole;
}

/**
 * Narrow a dump's declared dimension list to the dimensions this build knows.
 *
 * A dump may name a dimension a later build added; ignoring it is forward-compatible, while
 * refusing the whole list would make one unknown name unreadable for every other dimension. An
 * absent or empty list stays empty, which the census reads as `unavailable` — the dump did not say
 * what it carried, and silence is not "all of them".
 */
export function carriedDims(raw: readonly string[] | undefined): readonly ScopeDim[] {
  if (raw === undefined) return [];
  return SCOPE_DIMS.filter((dim) => raw.includes(dim));
}

/**
 * Read the width of a store's rules.
 *
 * `carried` is required and is the whole point: a caller that does not know which dimensions the
 * dump carried cannot ask this question, and answering it anyway is how a projection's silence
 * becomes a finding.
 */
export function scopeCensus(
  items: readonly StoreDumpItem[],
  options: { readonly carried: readonly ScopeDim[] },
): ScopeCensus {
  const carried = options.carried;
  if (carried.length === 0) {
    return {
      state: 'unavailable',
      sentence:
        'the dump does not say which scope dimensions it carried, so a dimension it omitted and a ' +
        'dimension no record declared are the same reading',
      records: items.length,
      scoped: 0,
      unscoped: 0,
      malformed: 0,
      declared: zeroDims(),
      open: zeroDims(),
      bySpecificity: {},
      broad: 0,
      broadShare: 0,
    };
  }

  let scoped = 0;
  let unscoped = 0;
  let malformed = 0;
  let broad = 0;
  const declared = zeroDims();
  const open = zeroDims();
  const bySpecificity: Record<number, number> = {};

  for (const item of items) {
    const scope = item.scope;
    if (scope === undefined || scope === null || typeof scope !== 'object') {
      unscoped += 1;
      continue;
    }
    if (typeof scope.task !== 'string' || scope.task.trim() === '') {
      malformed += 1;
      continue;
    }
    scoped += 1;
    let count = 1;
    for (const dim of carried) {
      if (scope[dim] === undefined) {
        open[dim] += 1;
      } else {
        declared[dim] += 1;
        count += 1;
      }
    }
    bySpecificity[count] = (bySpecificity[count] ?? 0) + 1;
    if (count === 1) broad += 1;
  }

  if (scoped === 0) {
    return {
      state: 'empty',
      sentence:
        `the dump holds ${items.length} record(s) and none of them carries a readable scope, so ` +
        'there is nothing to say about how wide its rules are',
      records: items.length,
      scoped,
      unscoped,
      malformed,
      declared,
      open,
      bySpecificity,
      broad,
      broadShare: 0,
    };
  }

  const widestOpen = carried
    .map((dim) => ({ dim, share: share(open[dim], scoped) }))
    .sort((a, b) => b.share - a.share);
  const first = widestOpen[0]!;
  const skipped =
    unscoped + malformed === 0
      ? ''
      : `; ${unscoped} record(s) carry no scope at all and ${malformed} name no task, counted and not read`;
  return {
    state: 'read',
    sentence:
      `${broad} of ${scoped} readable record(s) declare nothing beyond their task ` +
      `(${share(broad, scoped).toFixed(4)}), the widest dimension left open is \`${first.dim}\` at ` +
      `${first.share.toFixed(4)}${skipped}`,
    records: items.length,
    scoped,
    unscoped,
    malformed,
    declared,
    open,
    bySpecificity,
    broad,
    broadShare: share(broad, scoped),
  };
}
