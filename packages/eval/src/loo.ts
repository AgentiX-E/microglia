/**
 * What one rule is worth, when the choice to withhold it is random.
 *
 * `attribution.ts` reports 267 harmful, 236 helpful and 1,206 neutral rules over 1,709 ever injected,
 * and every one of those verdicts is observational: a rule is scored on the questions it *happened*
 * to be retrieved for. Retrieval compares a rule to the question, so a rule that fires on hard
 * questions and stays quiet on easy ones reads as harmful whatever it says — the sign is confounded
 * with the difficulty of the population that drew it.
 *
 * R74's `loo` arm is the cheapest design that removes the confound: every question is asked twice,
 * once with the pack `full` renders and once with exactly one rule withheld, and the withheld rule is
 * chosen by hashing the question's own text. Within a question the other rules are held fixed, so the
 * difference is attributable; across the split, a rule is withheld on a random subset of the
 * questions that drew it, so the pooled difference is an *unconfounded* verdict on whatever group of
 * rules is being read — harmful, helpful, one-item packs, three-item packs.
 *
 * Three things this file is careful about.
 *
 * **The pairs are the population.** A question whose pack was empty has nothing to withhold, so its
 * two arms are the same prompt twice and its difference is the provider's nondeterminism. It is
 * counted and excluded rather than averaged in, and the count is printed, because a reader that
 * silently drops 5% of the split is a reader that cannot be checked.
 *
 * **The classes are computed, not read from a file.** The rule ledger below is the same arithmetic
 * `attribution.ts` performs — a rule's net is the flips it was present for — recomputed here so the
 * reading joins one artefact to itself. A reading that depended on a second file written by a
 * different stage is a reading that cannot be reproduced from the run.
 *
 * **A rule's class is fixed by the whole split, not by the pair.** Classifying a rule from the pair
 * that withheld it would let the outcome choose the treatment group.
 */
import { comparePaired, type PairedResult } from './stats.js';

/** One question, as the `loo` reading needs it. */
export type LooRow = {
  readonly fold: number;
  /** The `loo` arm's verdict for this question. */
  readonly correct: boolean;
  /** The `full` arm's verdict for the same question, which is the paired baseline. */
  readonly injectedCorrect: boolean;
  /** The rule this question withheld, or null when it ran the arm and had nothing to withhold. */
  readonly dropped: string | null;
  /** Every rule the `full` arm injected here. */
  readonly packIds: readonly string[];
};

/** What one rule did on the questions that injected it. */
export type RuleVerdict = {
  readonly rule: string;
  readonly injected: number;
  readonly gained: number;
  readonly lost: number;
  /** Gained minus lost: the observational verdict R74 exists to test. */
  readonly net: number;
};

/** Harmful, helpful or neutral, by the rule's own observational net over the whole split. */
export type RuleClass = 'harmful' | 'helpful' | 'neutral';

/**
 * The observational ledger, one row per rule ever injected.
 *
 * This is `attribution.ts`'s arithmetic without its reporting: a rule gains a question when the
 * question was wrong without memory and right with it, and loses one in the other direction. Rules
 * are unordered in the result because the reading only joins by id.
 */
export function observationalLedger(
  rows: readonly Pick<LooRow, 'injectedCorrect' | 'packIds'>[],
  withoutMemory: readonly boolean[],
): readonly RuleVerdict[] {
  const tally = new Map<string, { injected: number; gained: number; lost: number }>();
  rows.forEach((row, index) => {
    const baseline = withoutMemory[index] === true;
    for (const rule of row.packIds) {
      const entry = tally.get(rule) ?? { injected: 0, gained: 0, lost: 0 };
      entry.injected += 1;
      if (row.injectedCorrect && !baseline) entry.gained += 1;
      if (!row.injectedCorrect && baseline) entry.lost += 1;
      tally.set(rule, entry);
    }
  });
  return [...tally.entries()]
    .map(([rule, entry]) => ({ rule, ...entry, net: entry.gained - entry.lost }))
    .sort((left, right) => left.net - right.net || left.rule.localeCompare(right.rule));
}

/** The class a rule's own net puts it in. Zero is neutral, and it is the largest class by far. */
export function ruleClassOf(verdict: Pick<RuleVerdict, 'net'>): RuleClass {
  if (verdict.net < 0) return 'harmful';
  if (verdict.net > 0) return 'helpful';
  return 'neutral';
}

/** A paired reading over a subset of the split. */
export type LooReading = {
  readonly name: string;
  readonly pairs: number;
  readonly withheld: number;
  readonly reading: PairedResult;
};

/**
 * The whole-split reading, on the pairs that had a rule to withhold.
 *
 * `withheld` is the number of rules actually removed, which is one per pair by construction, and it
 * is reported rather than assumed because an arm that silently withheld nothing is an arm that
 * measured the provider's nondeterminism.
 */
export function looOverall(rows: readonly LooRow[]): {
  readonly pairs: number;
  readonly nothingToWithhold: number;
  readonly reading: PairedResult;
} {
  const pairs = rows.filter((row) => row.dropped !== null);
  return {
    pairs: pairs.length,
    nothingToWithhold: rows.length - pairs.length,
    reading: comparePaired(
      pairs.map((row) => row.injectedCorrect),
      pairs.map((row) => row.correct),
      7,
      10_000,
    ),
  };
}

/**
 * The readings R74's branches are decided on: by rule class, and by how many rules the pack held.
 *
 * Class is the question the project has been unable to answer — are the rules `attribution` calls
 * harmful harmful when the selection is random — and pack size is the question R25 opened and never
 * closed, because `chars-N` arms cut on characters and the per-question rule count is what the pack
 * layer actually controls.
 */
export function looGroups(
  rows: readonly LooRow[],
  withoutMemory: readonly boolean[],
): readonly LooReading[] {
  const ledger = observationalLedger(rows, withoutMemory);
  const classOf = new Map(ledger.map((verdict) => [verdict.rule, ruleClassOf(verdict)]));
  const byClass = new Map<RuleClass, LooRow[]>();
  const bySize = new Map<string, LooRow[]>();
  // Append into the array the map already holds rather than rebuilding it: `map.set(key, [...(get(key)
  // ?? []), row])` carries a fallback that can never be taken on the first row only, and a fallback
  // that cannot be taken is either dead code or a hole a reader has to re-derive.
  const append = <K>(map: Map<K, LooRow[]>, key: K, row: LooRow): void => {
    const held = map.get(key);
    if (held === undefined) map.set(key, [row]);
    else held.push(row);
  };
  for (const row of rows) {
    if (row.dropped === null) continue;
    // A rule that was withheld but never injected anywhere in the split has no ledger verdict. It is
    // counted `neutral` here and `unseen` by `looCrossFitted`, and the difference is deliberate rather
    // than an oversight: this table is the pooled one R77 published, and relabelling its rows now would
    // silently change numbers that are already in the record.
    append(byClass, classOf.get(row.dropped) ?? 'neutral', row);
    append(bySize, String(Math.min(row.packIds.length, 3)), row);
  }
  const order: readonly RuleClass[] = ['harmful', 'helpful', 'neutral'];
  const read = (name: string, segment: readonly LooRow[]): LooReading => {
    const pairs = segment.filter((row) => row.dropped !== null);
    return {
      name,
      pairs: pairs.length,
      withheld: pairs.length,
      reading: comparePaired(
        pairs.map((row) => row.injectedCorrect),
        pairs.map((row) => row.correct),
        7,
        10_000,
      ),
    };
  };
  // Iterating the entries rather than the class order is what removes the second unreachable fallback:
  // `order.filter(has).map(get ?? [])` asks the map the same question twice, and the `[]` is there only
  // because the type system cannot see that the filter answered it.
  const classes = order.flatMap((name) => {
    const segment = byClass.get(name);
    return segment === undefined ? [] : [read(name, segment)];
  });
  const sizes = [...bySize.entries()]
    .sort(([left], [right]) => Number(left) - Number(right))
    .map(([size, segment]) => read(`${size === '3' ? '3+' : size} rule(s)`, segment));
  return [...classes, ...sizes];
}

/**
 * How concentrated the withholding was, which bounds what any per-rule verdict can claim.
 *
 * With 1.86 rules per question and 1,709 rules in play, a rule is drawn about ten times. That is a
 * distribution and not an estimate, and this table is what says so out loud: a `harmful` group of 267
 * rules carrying 1,180 pairs averages 4.4 draws each, so the group's delta is trustworthy and any
 * individual rule's is not.
 */
export function looDraws(rows: readonly LooRow[]): {
  readonly withheld: number;
  readonly rules: number;
  readonly median: number;
  readonly max: number;
  readonly mean: number;
} {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.dropped === null) continue;
    counts.set(row.dropped, (counts.get(row.dropped) ?? 0) + 1);
  }
  const draws = [...counts.values()].sort((left, right) => left - right);
  const total = draws.reduce((sum, value) => sum + value, 0);
  return {
    withheld: total,
    rules: draws.length,
    median: draws.length === 0 ? 0 : (draws[Math.floor(draws.length / 2)] ?? 0),
    max: draws.length === 0 ? 0 : (draws[draws.length - 1] ?? 0),
    mean: draws.length === 0 ? 0 : total / draws.length,
  };
}

/**
 * The class table with the rule's class decided on folds the effect is not measured on.
 *
 * `looGroups` assigns a rule's class from every question in the split and then measures the withheld
 * effect on those same questions, which is a regression to the mean wearing a causal claim's clothes:
 * a question where `full` happened to fail is a question whose rules were classified `harmful`, and a
 * second draw (`loo`) on that question is expected to do better whether or not the rule mattered. The
 * class table's +2.37pp on harmful rules and −2.84pp on helpful ones were therefore not evidence of
 * anything until the two halves were separated.
 *
 * Here they are: a question's withheld rule is classified using **only the other folds**, and the
 * effect is measured on the question's own fold. A rule's class is then a property of the five sixths
 * of the split the question did not come from, and the paired difference on the remaining sixth has no
 * reason to regress — except through the rule.
 *
 * A rule that appears in one fold only has no other-fold evidence, and it is counted as `unseen` and
 * excluded from the class readings rather than called neutral: neutral is a measurement (net zero on
 * evidence) and unseen is the absence of one, which is the distinction R71 spent a whole registration
 * on.
 */
export function looCrossFitted(
  rows: readonly LooRow[],
  withoutMemory: readonly boolean[],
  folds = 5,
): { readonly readings: readonly LooReading[]; readonly unseen: number } {
  const byFold = new Map<number, number[]>();
  rows.forEach((row, index) => {
    const fold = Number.isInteger(row.fold) ? row.fold % folds : 0;
    byFold.set(fold, [...(byFold.get(fold) ?? []), index]);
  });

  const bucket: Record<RuleClass, { held: boolean[]; full: boolean[] }> = {
    harmful: { held: [], full: [] },
    helpful: { held: [], full: [] },
    neutral: { held: [], full: [] },
  };
  let unseen = 0;

  for (const [fold, indices] of byFold) {
    // The ledger needs every row of the other folds, including those with nothing withheld: a rule's
    // net is computed from the questions that injected it, and dropping the withheld rows from the
    // denominator would understate every rule's exposure.
    const others = rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => (Number.isInteger(row.fold) ? row.fold % folds : 0) !== fold);
    const ledger = observationalLedger(
      others.map(({ row }) => row),
      others.map(({ index }) => withoutMemory[index] === true),
    );
    const classOf = new Map(ledger.map((verdict) => [verdict.rule, ruleClassOf(verdict)]));

    for (const index of indices) {
      const row = rows[index];
      if (row === undefined || row.dropped === null) continue;
      const label = classOf.get(row.dropped);
      if (label === undefined) {
        unseen += 1;
        continue;
      }
      bucket[label].held.push(row.correct);
      bucket[label].full.push(row.injectedCorrect);
    }
  }

  const order: readonly RuleClass[] = ['harmful', 'helpful', 'neutral'];
  const readings = order
    .filter((label) => bucket[label].held.length > 0)
    .map((label) => ({
      name: `${label} (cross-fitted)`,
      pairs: bucket[label].held.length,
      withheld: bucket[label].held.length,
      reading: comparePaired(bucket[label].full, bucket[label].held, 7, 10_000),
    }));
  return { readings, unseen };
}
