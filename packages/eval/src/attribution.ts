/**
 * Per-rule attribution over a cross-fitted benchmark artefact.
 *
 * An arm average answers "did the pack help?"; it cannot answer "which rule did
 * the damage?". Both are needed to fix anything: a pack that is net-negative
 * because two of forty rules are wrong is a different problem from one where every
 * rule is slightly harmful, and only the second is an argument against the
 * mechanism.
 *
 * This is association, not causation. A rule credited with a flipped question was
 * present when the question flipped; it did not necessarily cause it, and rules
 * that travel together split the credit arbitrarily. The number is useful for
 * finding candidates to audit, and it is not a causal estimate — which is why the
 * payload says so.
 */
export type AttributionCase = {
  readonly fold: number;
  readonly injected: readonly string[];
  readonly baselineCorrect: boolean;
  readonly treatmentCorrect: boolean;
};

export type AttributionItem = {
  readonly fold: number;
  readonly id: string;
  readonly statement: string;
  /**
   * The condition the rule was stored with, when the artefact records one.
   *
   * Optional because attribution predates the field: an artefact written before
   * iteration 63 has no conditions, and reading absence as "unconditional" would
   * report every rule in those runs as a general rule.
   */
  readonly when?: string | null;
};

export type RuleAttribution = {
  readonly fold: number;
  readonly id: string;
  readonly statement: string;
  /** Whether the artefact recorded an applicability condition for this rule. */
  readonly conditioned: boolean;
  readonly injected: number;
  /** Questions wrong without the pack and right with it. */
  readonly helped: number;
  /** Questions right without the pack and wrong with it. */
  readonly hurt: number;
  readonly net: number;
};

export type AttributionSummary = {
  readonly rules: number;
  readonly injectedRules: number;
  readonly helpful: number;
  readonly harmful: number;
  readonly neutral: number;
  /** Share of injected rule-instances whose rule has a negative net. */
  readonly harmfulShare: number;
  /**
   * The same split, by whether the rule said when it applies.
   *
   * This is what turns the arm comparison into a diagnosis: a pack whose harmful
   * rules are all unconditional and whose helpful rules are all conditioned says the
   * condition is doing the work; a pack where both groups look the same says it is
   * not, however the arm average moved.
   */
  readonly conditioned: {
    readonly injected: number;
    readonly helpful: number;
    readonly harmful: number;
  };
  readonly unconditioned: {
    readonly injected: number;
    readonly helpful: number;
    readonly harmful: number;
  };
  /** The rules that cost the most, worst first. */
  readonly top: readonly RuleAttribution[];
  /**
   * The rules that helped most, best first.
   *
   * `top` alone is a list of suspects, and a report that only ever publishes
   * suspects invites the conclusion that the pack is uniformly bad. The other end
   * of the same table is what says whether the mechanism is worth keeping while the
   * harmful rules are dealt with.
   */
  readonly best: readonly RuleAttribution[];
};

/**
 * Attribute every flip to every rule that was present.
 *
 * Rule ids are folded into the key because a cross-fitted lane resets its id
 * stream per fold: the same id can name two different statements in two folds, and
 * merging them would attribute one fold's damage to the other fold's rule.
 */
type MutableRule = {
  fold: number;
  id: string;
  statement: string;
  conditioned: boolean;
  injected: number;
  helped: number;
  hurt: number;
  net: number;
};

/**
 * Attribute every flip to every rule that was present.
 *
 * Rule ids are folded into the key because a cross-fitted lane resets its id
 * stream per fold: the same id can name two different statements in two folds, and
 * merging them would attribute one fold's damage to the other fold's rule.
 */
/**
 * Worst first, then the most-injected, then by id.
 *
 * Exported and used for both ends of the table: a comparator tested only through
 * `Array.prototype.sort` is verified in whatever order V8 happens to compare its
 * elements, which for two or three items is one direction. Tested directly, both
 * directions are covered and the sort cannot hide a missing tie-break.
 */
export function byNetAscending(a: RuleAttribution, b: RuleAttribution): number {
  if (a.net !== b.net) return a.net - b.net;
  if (a.injected !== b.injected) return b.injected - a.injected;
  if (a.id === b.id) return a.fold - b.fold;
  return a.id < b.id ? -1 : 1;
}

/** Best first, with the same tie-breaks. */
export function byNetDescending(a: RuleAttribution, b: RuleAttribution): number {
  if (a.net !== b.net) return b.net - a.net;
  if (a.injected !== b.injected) return b.injected - a.injected;
  if (a.id === b.id) return a.fold - b.fold;
  return a.id < b.id ? -1 : 1;
}

export function attributeRules(
  cases: readonly AttributionCase[],
  items: readonly AttributionItem[],
): AttributionSummary {
  const byKey = new Map<string, MutableRule>();
  const keyOf = (fold: number, id: string): string => `${fold}\u0000${id}`;
  for (const item of items) {
    byKey.set(keyOf(item.fold, item.id), {
      fold: item.fold,
      id: item.id,
      statement: item.statement,
      conditioned: typeof item.when === 'string' && item.when.length > 0,
      injected: 0,
      helped: 0,
      hurt: 0,
      net: 0,
    });
  }

  for (const entry of cases) {
    const flippedUp = !entry.baselineCorrect && entry.treatmentCorrect;
    const flippedDown = entry.baselineCorrect && !entry.treatmentCorrect;
    for (const id of new Set(entry.injected)) {
      const record = byKey.get(keyOf(entry.fold, id));
      if (record === undefined) continue;
      // Every presence counts, not only the ones that flipped: the share of
      // injections belonging to a harmful rule is what a reader needs to decide
      // whether the pack is mostly noise or mostly fine.
      record.injected += 1;
      if (flippedUp) {
        record.helped += 1;
        record.net += 1;
      } else if (flippedDown) {
        record.hurt += 1;
        record.net -= 1;
      }
    }
  }

  const all: RuleAttribution[] = [...byKey.values()].sort(byNetAscending);
  const injected = all.filter((rule) => rule.injected > 0);
  const harmful = injected.filter((rule) => rule.net < 0);
  const helpful = injected.filter((rule) => rule.net > 0);
  const instances = injected.reduce((sum, rule) => sum + rule.injected, 0);
  const best = all.filter((rule) => rule.net > 0).sort(byNetDescending);

  const split = (group: readonly RuleAttribution[], conditioned: boolean) => {
    const subset = group.filter((rule) => rule.conditioned === conditioned);
    return {
      injected: subset.reduce((sum, rule) => sum + rule.injected, 0),
      helpful: subset.filter((rule) => rule.net > 0).length,
      harmful: subset.filter((rule) => rule.net < 0).length,
    };
  };

  return {
    rules: all.length,
    injectedRules: injected.length,
    helpful: helpful.length,
    harmful: harmful.length,
    neutral: injected.length - helpful.length - harmful.length,
    harmfulShare: instances === 0 ? 0 : harmful.reduce((sum, rule) => sum + rule.injected, 0) / instances,
    conditioned: split(injected, true),
    unconditioned: split(injected, false),
    top: all.slice(0, 20),
    best: best.slice(0, 20),
  };
}
