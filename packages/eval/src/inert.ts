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

import { wilsonInterval } from './reproduction.js';

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

/**
 * What a rule that never fired is evidence of, given how few times it was drawn.
 *
 * R77's most actionable number was also its least certain: **113 of 472 rules never changed an answer
 * on any draw they got**, and most of them got three. Three draws is not a verdict — a rule live on half
 * its draws is silent on three of them 12.5% of the time — so "a quarter of the pack is dead weight" is
 * a statement about a sample, not about a pack. This prices that.
 *
 * The estimator is deliberately one parameter. Take the per-draw live rate **of the rules that fired at
 * least once** and ask how many silences a pack of that behaviour would produce:
 *
 *     E[silent] = Σ (1 − p)^draws   over the rules that never fired
 *
 * Rules that never fired are excluded from `p` because including them is circular: nine rules silent on
 * ten draws each would drag a pack-wide rate to 1/92 and then declare all nine of them expected. What
 * survives is a comparison — observed silences against the silences the working rules predict — and an
 * `excess` that is the dead weight the pack can actually be accused of.
 *
 * The assumption is stated because it is doing the work: that a silent rule, if it works at all, works
 * at the rate the rules that fired demonstrated. A pack of two populations — a third that is dead and
 * two thirds that fire on most draws — violates it in the direction that *understates* the excess, since
 * `p` is then an average over the firing population and a matter of taste whether the dead third belongs
 * in it. Understating is the safe direction for a pruning claim, which is what this number exists to
 * price.
 */
export type SilenceReading = {
  /** Rules that never changed an answer. */
  readonly silent: number;
  /** Per-draw live rate over the rules that fired at least once, in `[0, 1]`. */
  readonly workingRate: number;
  /** Silences a pack at that rate would produce on the same draw counts. */
  readonly expectedSilent: number;
  /** `silent − expectedSilent`: how many of them the draw counts cannot explain. */
  readonly excess: number;
  /**
   * The interval `excess` is an estimate *of*, from the rate's own sampling error.
   *
   * The point estimate treats the working rate as known, and it is not: it is a proportion measured on
   * the rules that fired, so a pack whose rate is really 0.45 and a pack whose rate is really 0.55
   * predict different amounts of silence from the same draw counts. `excess` is strictly increasing in
   * the rate — a higher rate makes a silence less likely and therefore more attributable to the rule —
   * so the interval on the excess is the excess evaluated at the rate's own interval, with no
   * simulation and no randomness. A lower bound above zero is the claim that dead weight exists, which
   * is the claim a pruning would act on, and it costs nothing to read.
   */
  readonly excessInterval: { readonly low: number; readonly high: number };
  /** The working rate the interval was computed from. */
  readonly rateInterval: { readonly low: number; readonly high: number };
  /** Draws at which a rule at `workingRate` is silent by chance less than once in twenty; 0 when the rate is. */
  readonly drawsToResolve: number;
  /** Silent rules holding fewer draws than `drawsToResolve`, which are not yet evidence of anything. */
  readonly underPowered: number;
};

/**
 * The draw count a rule needs before silence is evidence, at a given per-draw live rate.
 *
 * 0 when no rule ever fired, because then silence is not a chance event at any sample size and a number
 * would read as "more draws would settle this" when nothing would.
 */
export function drawsToResolve(workingRate: number): number {
  if (!(workingRate > 0)) return 0;
  if (workingRate >= 1) return 1;
  return Math.max(1, Math.ceil(Math.log(0.05) / Math.log(1 - workingRate)));
}

export function silenceReading(rules: readonly RuleInertness[]): SilenceReading {
  const firing = rules.filter((row) => row.live > 0);
  const draws = firing.reduce((sum, row) => sum + row.draws, 0);
  const live = firing.reduce((sum, row) => sum + row.live, 0);
  const workingRate = draws === 0 ? 0 : live / draws;
  const silentRules = rules.filter((row) => row.live === 0);
  // The expected silences at a given rate, so the interval is the same arithmetic at two rates rather
  // than a second estimator carrying its own assumptions.
  const expectedAt = (rate: number): number =>
    silentRules.reduce((sum, row) => sum + (1 - rate) ** row.draws, 0);
  const expectedSilent = expectedAt(workingRate);
  const resolveAt = drawsToResolve(workingRate);
  // The interval is the one `reproduction.ts` uses for a published cell, called with this proportion:
  // one formula in the package, because two Wilson intervals that disagree in the fourth decimal are
  // two numbers a reader has to reconcile. Zero draws has no interval — it is the absence of a
  // measurement, and the estimator refuses `n = 0` rather than reporting certainty.
  const rateInterval = draws > 0 ? wilsonInterval({ accuracy: workingRate, n: draws }) : { low: 0, high: 0 };
  return {
    silent: silentRules.length,
    workingRate,
    expectedSilent,
    excess: silentRules.length - expectedSilent,
    // Monotone in the rate — a higher rate makes silence less likely and therefore more attributable to
    // the rule — so the endpoints are the excess at the rate's own endpoints: a lower bound above zero
    // is "even at the low end of the rate, more silences than chance", which is the claim a pruning
    // needs and the one a point estimate cannot make.
    excessInterval: {
      low: silentRules.length - expectedAt(rateInterval.low),
      high: silentRules.length - expectedAt(rateInterval.high),
    },
    rateInterval,
    drawsToResolve: resolveAt,
    // Zero when the rate is zero, because a rule cannot be under-powered against a bar that no sample
    // size reaches — reporting every silent rule as under-powered there would be a call to spend calls.
    underPowered: resolveAt === 0 ? 0 : silentRules.filter((row) => row.draws < resolveAt).length,
  };
}

/** One rule that needs draws before its silence means anything. */
export type SilenceTarget = {
  readonly rule: string;
  /** Draws it has. */
  readonly draws: number;
  /** Draws it is short of the count at which silence would be chance once in twenty. */
  readonly need: number;
};

/**
 * The draws a top-up would have to buy, rule by rule.
 *
 * R77 left the pack with 113 rules that never fired and 105 of them holding fewer than five draws. This
 * turns "give those more draws" into a purchase order: which rules, how many draws each, and in what
 * order — because a dispatch that can only pay for part of the plan should pay for the rules furthest
 * from a verdict rather than for a random subset of them.
 *
 * Ordered by `need` descending then by name, so two people planning from the same file plan the same
 * draws. `cap` truncates the plan at a budget the caller can pay, and it truncates only from the end of
 * that order.
 *
 * Returns nothing when no rule ever fired: silence is then not a chance event at any sample size, and a
 * purchase order would be a call to spend calls on a question no number of them answers. It returns
 * nothing for a rule that already holds the resolving count for the same reason in reverse — its silence
 * is already evidence, and more draws would confirm rather than inform.
 */
export function silenceTargets(
  rules: readonly RuleInertness[],
  options: { readonly draws: number; readonly cap?: number },
): readonly SilenceTarget[] {
  const wanted = Math.max(0, Math.floor(options.draws));
  const reading = silenceReading(rules);
  if (reading.workingRate <= 0 || wanted === 0) return [];
  const planned = rules
    .filter((row) => row.live === 0 && row.draws < wanted)
    .map((row) => ({ rule: row.rule, draws: row.draws, need: wanted - row.draws }))
    .sort((left, right) => right.need - left.need || left.rule.localeCompare(right.rule));
  const cap = options.cap;
  if (cap === undefined || cap >= planned.reduce((sum, row) => sum + row.need, 0)) return planned;
  // Truncation keeps whole rules for as long as the budget covers them, so the plan never claims a
  // fractional draw of a rule it then reports as targetable.
  const kept: SilenceTarget[] = [];
  let left = Math.max(0, Math.floor(cap));
  for (const row of planned) {
    if (row.need > left) break;
    kept.push(row);
    left -= row.need;
  }
  return kept;
}

/** A plan to buy draws for named rules, as the tool writes it and the lane reads it. */
export type SilencePlan = {
  readonly draws: number;
  readonly targets: readonly SilenceTarget[];
};

/**
 * Read a plan, and refuse anything that is not one.
 *
 * The dangerous failure here is not a malformed file — it is a file that parses into **nothing**. A lane
 * that shrugs at an empty plan spends its calls on whatever rules its own hash chooses and reports the
 * numbers as a top-up of the rules the plan named, which is a dispatch that measured something and
 * claimed something else. So every way of being wrong is an error: no `targets`, a target with no rule,
 * a need of zero (a rule that needs nothing is a planning bug, not a purchase), and the same rule named
 * twice (which would spend its budget twice and report half the coverage).
 */
export function parseSilencePlan(text: string, source: string): SilencePlan {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    // `JSON.parse` throws a `SyntaxError` and nothing else, so the message is stringified rather than
    // narrowed: an `instanceof` check here would be a branch no input can take.
    throw new Error(`${source}: not JSON (${String(error)})`);
  }
  // Structure before values, so a file of the wrong shape reports the shape rather than the first
  // field it fails to find. `[]` is the case that matters: an array is an object to `typeof` and would
  // otherwise be reported as a plan with a bad `draws`, which reads like a typo rather than a wrong file.
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${source}: not a plan object, so it has no targets`);
  }
  const record = raw as { readonly draws?: unknown; readonly targets?: unknown };
  if (!Array.isArray(record.targets)) {
    throw new Error(`${source}: no targets array, so it is not a plan`);
  }
  const draws = record.draws;
  if (typeof draws !== 'number' || !Number.isInteger(draws) || draws <= 0) {
    throw new Error(`${source}: draws must be a positive integer, got ${JSON.stringify(draws)}`);
  }
  const seen = new Set<string>();
  const targets: SilenceTarget[] = [];
  for (const entry of record.targets) {
    if (entry === null || typeof entry !== 'object') throw new Error(`${source}: a target is not an object`);
    const row = entry as { readonly rule?: unknown; readonly draws?: unknown; readonly need?: unknown };
    if (typeof row.rule !== 'string' || row.rule === '') {
      throw new Error(`${source}: a target names no rule`);
    }
    if (typeof row.need !== 'number' || !Number.isInteger(row.need) || row.need <= 0) {
      throw new Error(`${source}: ${row.rule} needs ${JSON.stringify(row.need)} draws, and a need of zero is a planning bug`);
    }
    if (seen.has(row.rule)) throw new Error(`${source}: ${row.rule} is named twice`);
    seen.add(row.rule);
    targets.push({
      rule: row.rule,
      draws: typeof row.draws === 'number' ? row.draws : 0,
      need: row.need,
    });
  }
  return { draws, targets };
}

/** What a run did with the plan it was dispatched under. */
export type PlanCoverage = {
  /** Rules the plan names. */
  readonly rules: number;
  /** Draws the plan asks each of them for. */
  readonly draws: number;
  /** Draws the plan asks for in total. */
  readonly need: number;
  /** Named rules this run's store actually holds, whether or not an arm touched them. */
  readonly present: number;
  /** Named rules the `loo` arm drew from, or `null` if this run did not buy `loo`. */
  readonly given: number | null;
  /** Named rules the `pruned` arm withheld, or `null` if this run did not buy `pruned`. */
  readonly withheld: number | null;
};

/**
 * Report what became of the plan, without letting an arm that was not bought read as a measurement.
 *
 * `given` counts the draws the `loo` arm took, and only that arm increments it. R79 bought `pruned`
 * alone — the arm whose entire purpose is to withhold the plan's rules — and its artefact therefore
 * recorded `given: 0` beside 694 rule placements withheld from 642 packs. **Zero is what a counter
 * nobody increments reads as**, and the sentence it produces ("the plan did not reach this store") is
 * the opposite of what happened. The same shape as R67's arm table: a field that is right when its own
 * arm runs and silently wrong when another one does.
 *
 * So each count is reported only by the arm that can measure it, `null` otherwise, and `present` —
 * which is a property of the store rather than of any arm — is what answers "did the plan reach this
 * run at all". A reader holding two `null`s and a `present` cannot mistake either for zero.
 */
export function planCoverage(
  plan: SilencePlan,
  seen: {
    readonly present: ReadonlySet<string>;
    readonly draws: ReadonlyMap<string, number>;
    readonly withheld: ReadonlySet<string>;
  },
  arms: ReadonlySet<string>,
): PlanCoverage {
  return {
    rules: plan.targets.length,
    draws: plan.draws,
    need: plan.targets.reduce((sum, row) => sum + row.need, 0),
    present: seen.present.size,
    given: arms.has('loo')
      ? plan.targets.filter((row) => (seen.draws.get(row.rule) ?? 0) > 0).length
      : null,
    withheld: arms.has('pruned')
      ? plan.targets.filter((row) => seen.withheld.has(row.rule)).length
      : null,
  };
}

