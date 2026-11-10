/**
 * How much of the pack changes any answer at all.
 *
 * Every question this lane has asked about its memory has been a question about *direction*: does a
 * pack help, hurt, or neither. R74 closed that one — the per-rule verdict is two thirds regression
 * artifact and the residue projects to +0.35pp against a ±0.4pp interval — and left a more basic
 * question standing, which is whether the rules do anything.
 *
 * The evidence that they might not is R74's own artefact: with one rule withheld, **4,074 of its 7,829
 * questions produced byte-identical SQL**. But R74 ran at T = 0.7, where the same prompt can produce the
 * same query twice by chance, so that number is a mixture of inertness and coincidence and cannot be
 * separated from the file it came from.
 *
 * At T = 0 it is not a statistic. A deterministic decoder given two prompts that differ by one rule
 * returns the same query **if and only if** the rule did not matter, so the reading is a count. This
 * module does the counting: pair-level inertness, per-rule inertness over the draws each rule got, and
 * how concentrated the live answers are — because a 540-rule pack in which 30 rules do all the work is
 * a different instrument from one where the work is spread, whatever the pack-level delta says.
 *
 * Comparison is on the statement text after whitespace is collapsed, and nothing else. Case folding is
 * reported separately rather than folded in: `select 1` and `SELECT 1` are the same query to SQLite and
 * a count that treated them as different answers would report inertness lower than it is, while a count
 * that treated `WHERE a = 'X'` and `WHERE a = 'x'` as the same would report it higher. Both readings
 * travel; the choice is the reader's and it is visible.
 */

/** One question: what the full pack produced, and what the pack without one rule produced. */
export type InertPair = {
  readonly id: string;
  /** The rule the second statement was produced without, or `null` when nothing was withheld. */
  readonly rule: string | null;
  readonly full: string;
  readonly without: string;
};

export type RuleInertness = {
  readonly rule: string;
  /** Questions on which this rule was the one withheld. */
  readonly draws: number;
  /** Of those, the ones whose statement changed. */
  readonly live: number;
};

export type InertReading = {
  /** Pairs where both sides produced a statement, which is the only population a comparison has. */
  readonly pairs: number;
  readonly live: number;
  readonly inert: number;
  /** `inert / pairs`, in `[0, 1]`; zero when there is nothing to compare. */
  readonly inertShare: number;
  /** Pairs whose statement differs only by case, counted as live in the main reading. */
  readonly caseOnly: number;
  /** Questions with something withheld but no statement on one side: a failure, not an inert answer. */
  readonly unmeasured: number;
  /** Questions with nothing withheld, which carry no information about any rule. */
  readonly unwithheld: number;
  /** Every rule ever withheld, by draws descending, then by name for a stable order. */
  readonly rules: readonly RuleInertness[];
  /** Rules whose every draw left the statement untouched. */
  readonly whollyInert: number;
  /**
   * The share of live answers produced by the busiest tenth of the rules.
   *
   * A pack whose live answers concentrate in a few rules is a pack with a long tail of text nobody acts
   * on, and the tail is what a distillation prompt should stop writing.
   */
  readonly liveConcentration: number;
};

/**
 * Collapse whitespace and drop a trailing semicolon.
 *
 * Deliberately not a normaliser: it does not touch case, aliases, quoting, parentheses or ordering.
 * Whitespace is the one difference that cannot be a difference in meaning, and a statement that differs
 * by anything else is a statement a reader has to see.
 */
export function normaliseSql(text: string): string {
  return text.replace(/\s+/g, ' ').trim().replace(/;$/, '').trimEnd();
}

const liveUnder = (pair: InertPair, foldCase: boolean): boolean => {
  const left = normaliseSql(pair.full);
  const right = normaliseSql(pair.without);
  return foldCase ? left.toLowerCase() !== right.toLowerCase() : left !== right;
};

/** The quantile of a sorted-ascending array, nearest-rank. */
function quantile(sorted: readonly number[], share: number): number {
  if (sorted.length === 0) return 0;
  const at = Math.min(sorted.length - 1, Math.max(0, Math.ceil(share * sorted.length) - 1));
  return sorted[at] as number;
}

export function inertReading(pairs: readonly InertPair[]): InertReading {
  let live = 0;
  let inert = 0;
  let caseOnly = 0;
  let unmeasured = 0;
  let unwithheld = 0;
  const byRule = new Map<string, { draws: number; live: number }>();

  for (const pair of pairs) {
    if (pair.rule === null) {
      unwithheld += 1;
      continue;
    }
    const full = normaliseSql(pair.full);
    const without = normaliseSql(pair.without);
    if (full === '' || without === '') {
      // A statement that did not parse is a failure to answer, not an answer the rule left alone.
      // Counting it as inert would report a pack as doing nothing on the evidence of calls that never
      // returned a query.
      unmeasured += 1;
      continue;
    }
    const entry = byRule.get(pair.rule) ?? { draws: 0, live: 0 };
    entry.draws += 1;
    if (liveUnder(pair, false)) {
      live += 1;
      entry.live += 1;
      if (!liveUnder(pair, true)) caseOnly += 1;
    } else {
      inert += 1;
    }
    byRule.set(pair.rule, entry);
  }

  const compared = live + inert;
  const rules = [...byRule.entries()]
    .map(([rule, entry]) => ({ rule, draws: entry.draws, live: entry.live }))
    .sort((left, right) => right.draws - left.draws || left.rule.localeCompare(right.rule));
  const whollyInert = rules.filter((row) => row.live === 0).length;

  // Concentration: the busiest tenth of the rules, by live answers. Ties are broken by the same order
  // the table prints, so two runs of the same file cannot report two shares.
  const byLive = [...rules].sort((left, right) => right.live - left.live || left.rule.localeCompare(right.rule));
  const top = Math.max(1, Math.ceil(byLive.length / 10));
  const topLive = byLive.slice(0, top).reduce((sum, row) => sum + row.live, 0);
  const liveConcentration = live === 0 ? 0 : topLive / live;

  return {
    pairs: compared,
    live,
    inert,
    inertShare: compared === 0 ? 0 : inert / compared,
    caseOnly,
    unmeasured,
    unwithheld,
    rules,
    whollyInert,
    liveConcentration,
  };
}

/**
 * The distribution of per-rule live shares, for a pack whose rules got few draws each.
 *
 * A rule withheld ten times and live none of them is evidence; a rule withheld once and live once is
 * not evidence of anything except that it was drawn. Both are in `rules`; this groups them so a reader
 * can see which kind the pack is made of.
 */
export function liveShareBuckets(
  rules: readonly RuleInertness[],
  edges: readonly number[] = [0, 0.01, 0.25, 0.5, 0.75, 1],
): readonly { readonly atLeast: number; readonly below: number; readonly rules: number }[] {
  const shareOfRule = (row: RuleInertness): number => (row.draws === 0 ? 0 : row.live / row.draws);
  const last = edges[edges.length - 1] ?? 1;
  const out: { atLeast: number; below: number; rules: number }[] = [];
  for (let index = 0; index < edges.length - 1; index += 1) {
    const low = edges[index] as number;
    const high = edges[index + 1] as number;
    // The final edge is closed on both sides, so a rule that changed every answer is not dropped from a
    // distribution that claims to cover every rule. Built by counting rather than by patching the
    // array afterwards: the earlier version incremented the last bucket in place, which is a mutation
    // inside a type that promises not to have one.
    const count = rules.filter((row) => {
      const share = shareOfRule(row);
      return share >= low && (index === edges.length - 2 ? share <= last : share < high);
    }).length;
    out.push({ atLeast: low, below: high, rules: count });
  }
  return out;
}

/** The median and quantiles of draws per rule, which bound what any per-rule sentence may claim. */
export function drawSpread(rules: readonly RuleInertness[]): {
  readonly rules: number;
  readonly median: number;
  readonly p90: number;
  readonly max: number;
} {
  const draws = rules.map((row) => row.draws).sort((left, right) => left - right);
  return {
    rules: rules.length,
    median: quantile(draws, 0.5),
    p90: quantile(draws, 0.9),
    max: draws.length === 0 ? 0 : (draws[draws.length - 1] as number),
  };
}
