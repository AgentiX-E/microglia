/**
 * Does a rule do anything when it is given twenty chances?
 *
 * Every measurement on the memory axis so far has asked whether a pack of rules helps, and every
 * one of them has come back null: about four fifths of the injected store never changes an answer,
 * the harmful tail is twice the helpful one, and each rule receives roughly **0.25 decisive
 * observations in a whole run**. That last number is the diagnosis this module exists to test. No
 * filter can rank rules on a quarter of an observation each, and no policy can retire a rule that
 * has never been seen to do anything — so the null result is compatible with two opposite
 * conclusions, and they are not equally cheap:
 *
 *  - the store is silent because nothing has been asked of it (a property of the workload), or
 *  - the store is silent because the distillation writes rules that cannot change an answer
 *    (a property of the distiller).
 *
 * The instrument that separates them is density, not accuracy. Hold the rule set fixed, hold the
 * questions fixed, show **one rule at a time** — so attribution is exact instead of being credited
 * to every rule that shared a prompt — and give every rule the same twenty questions from its own
 * database. Then count, per rule, what moved.
 *
 * **What is being read, and at what unit.** A *trial* is one rule on one question, and it is
 * paired: the control is the same question answered without any rule. The treatment unit is the
 * rule, because the intervention is "carry this rule"; the question is the cluster, because one
 * question appears under every rule in its database and those observations are not independent. So
 * the interval is a cluster bootstrap over questions, and the sign test is over rules. A reader who
 * swaps the two would read twenty questions as two hundred independent trials, which is the exact
 * error that makes a null result look like a measurement.
 *
 * **Two ways of being applicable, and the difference matters.** `relevant` is defined with the
 * answer key: at least one of the rule's schema terms appears in the gold query. That is the
 * strongest available notion of "this rule was about this question", and it is deliberately *not*
 * decidable before answering — it is a diagnostic upper bound on what retrieval could know, not a
 * feature a deployment has. `cued` is the decidable half: the same terms appear in the question or
 * its evidence, which is what a lexical retriever can see. A policy is only deployable if it is
 * built from `cued`.
 *
 * Everything below is a function of trials. The lane supplies the trials, this module supplies the
 * reading, and the gates in `densityGates` are what turn the reading into a pre-registered verdict.
 */

import { mcnemarExact } from '@agentix-e/microglia-core';
import { clusterBootstrapCI } from './stats.js';
import type { ValidityGate } from './sota.js';
import type { TemplateCoverage } from './template.js';

/** A stored rule, as the artefact lists it. Only the fields the family needs. */
export type StoredRuleInput = {
  readonly id: string;
  readonly status: string;
  readonly statement: string;
  readonly when: string | null;
  readonly domain: string | null;
};

/** A rule that survived selection: it is active, it names a database, and it says something. */
export type DensityRule = {
  readonly id: string;
  readonly domain: string;
  readonly statement: string;
  readonly when: string | null;
};

/** A question the family can show a rule to, with the control's verdict already measured. */
export type DensityTarget = {
  readonly id: string;
  readonly dbId: string;
  readonly question: string;
  readonly evidence: string;
  readonly goldSql: string;
  /** The same question answered without any rule, which is this target's control. */
  readonly baselineCorrect: boolean;
};

/** One rule on one question. The unit the ledger is built from. */
export type DensityTrial = {
  readonly ruleId: string;
  readonly domain: string;
  readonly targetId: string;
  /** Position in the panel, which is what the fit-half / score-half split is made on. */
  readonly order: number;
  readonly correct: boolean;
  readonly baselineCorrect: boolean;
  /** The rule's vocabulary is in the gold query: applicable, but not decidable in advance. */
  readonly relevant: boolean;
  /** The rule's vocabulary is in the question or its evidence: what a lexical retriever can see. */
  readonly cued: boolean;
};

/**
 * A 32-bit content hash, used only to order things reproducibly.
 *
 * Selection cannot use the store's order: the ids are time-ordered, so the first eight rules of
 * every database would be the eight distilled first, and a family built from them would be a
 * sample of the beginning of the run rather than of the store. Hashing the statement makes the
 * subset a function of what the rules *say*, which is stable across runs, and uniform, which is
 * the property that keeps the sample unbiased.
 */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let at = 0; at < text.length; at += 1) {
    hash ^= text.charCodeAt(at);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Order two entries by the hash of a key, and by id when two keys collide.
 *
 * The id tie-break is not decoration: two rules can say the same thing (the five folds distil
 * overlapping evidence, so duplicates survive), and a comparator that returned zero for them would
 * leave the selection to the store's iteration order — a subset that differs between two runs of the
 * same code, which is the one property this family cannot afford.
 */
function compareByHash(leftKey: string, leftId: string, rightKey: string, rightId: string): number {
  const gap = fnv1a(leftKey) - fnv1a(rightKey);
  return gap !== 0 ? gap : leftId.localeCompare(rightId);
}

/**
 * The fixed rule set: at most `perDb` rules from every database in the store.
 *
 * Per database rather than from the store as a whole, because a rule can only be exercised by
 * questions from the database it names — a global top-N would empty the small databases out of the
 * family and leave their rules unmeasured rather than measured once.
 *
 * A rule that generalised out of its database (`domain === null`) is dropped, not assigned: the
 * transfer probe learned that a rule whose vocabulary is absent from the workspace changes nothing
 * (−0.29pp), and including those rules would add trials that are silent by construction to a
 * measurement about silence.
 */
export function selectDensityRules(
  items: readonly StoredRuleInput[],
  perDb: number,
  domains?: ReadonlySet<string>,
): readonly DensityRule[] {
  const cap = Math.max(0, Math.floor(perDb));
  const byDomain = new Map<string, DensityRule[]>();
  for (const item of items) {
    if (item.status !== 'active') continue;
    if (item.domain === null || item.domain === '') continue;
    if (domains !== undefined && !domains.has(item.domain)) continue;
    if (item.statement.trim() === '') continue;
    const bucket = byDomain.get(item.domain) ?? [];
    bucket.push({
      id: item.id,
      domain: item.domain,
      statement: item.statement,
      when: item.when,
    });
    byDomain.set(item.domain, bucket);
  }
  const selected: DensityRule[] = [];
  for (const domain of [...byDomain.keys()].sort()) {
    const bucket = byDomain.get(domain) as DensityRule[];
    bucket.sort((left, right) =>
      compareByHash(
        `${left.statement}\u0000${left.when ?? ''}`,
        left.id,
        `${right.statement}\u0000${right.when ?? ''}`,
        right.id,
      ),
    );
    selected.push(...bucket.slice(0, cap));
  }
  return selected;
}

/**
 * One panel of questions per database, the same panel for every rule in it.
 *
 * Shared rather than drawn per rule, for two reasons that both buy precision. The control is a
 * property of the question, so a shared panel measures twenty controls instead of one per rule; and
 * every rule in a database is then scored on the same twenty questions, which makes two rules
 * comparable without also comparing the questions they happened to draw.
 *
 * The draw is a hash of the seed and the question id, so the panel is reproducible from the
 * artefact and does not depend on the order the corpus arrived in.
 */
export function targetPanels(
  targets: readonly DensityTarget[],
  panel: number,
  seed: number,
): ReadonlyMap<string, readonly DensityTarget[]> {
  const cap = Math.max(0, Math.floor(panel));
  const byDb = new Map<string, DensityTarget[]>();
  for (const target of targets) {
    const bucket = byDb.get(target.dbId) ?? [];
    bucket.push(target);
    byDb.set(target.dbId, bucket);
  }
  const panels = new Map<string, readonly DensityTarget[]>();
  for (const dbId of [...byDb.keys()].sort()) {
    const bucket = byDb.get(dbId) as DensityTarget[];
    bucket.sort((left, right) => compareByHash(`${seed}:${left.id}`, left.id, `${seed}:${right.id}`, right.id));
    panels.set(dbId, bucket.slice(0, cap));
  }
  return panels;
}

/**
 * The identifiers in a piece of text, lowercased and long enough to be a column.
 *
 * Three characters is the floor because `id`, `n` and `x` are the names a tokeniser cannot tell
 * from prose, and a rule "about `id`" is relevant to every question in the corpus. A term that
 * appears in more than half the targets is not evidence of applicability; the floor is the cheap
 * version of that filter, and it is applied before the schema intersection rather than after.
 */
/** Where one rule is pointed away from home: the rule, the question, and the database it landed in. */
export type ForeignTarget = {
  readonly ruleId: string;
  readonly targetId: string;
  readonly dbId: string;
  /** Position within the rule's foreign panel, which is the trial's `order`. */
  readonly order: number;
};

/**
 * Draw each rule's foreign panel: questions from databases that are not the rule's own.
 *
 * The draw has to be a function of the rule's identity and the question's, never of the order the
 * cases arrive in, or two runs of the same store would measure two different experiments. It also
 * has to spread: a rule shown ten questions that all came from one other database would measure one
 * pair of schemas rather than "away from home". So the target databases are ranked by
 * `hash(ruleId + dbId)`, the questions inside each by `hash(ruleId + id)`, and the panel is taken
 * round-robin across the databases — the first question from each before the second from any.
 *
 * A rule whose panel cannot be filled is filled as far as it goes. The gate counts injections
 * against `rules x panel` and fails when the shortfall is material, which is the only place a short
 * panel should be visible.
 */
export function foreignPanels(
  rules: readonly DensityRule[],
  targets: readonly { readonly id: string; readonly dbId: string }[],
  panel: number,
): readonly ForeignTarget[] {
  const byDb = new Map<string, string[]>();
  for (const target of targets) {
    const bucket = byDb.get(target.dbId) ?? [];
    bucket.push(target.id);
    byDb.set(target.dbId, bucket);
  }
  const out: ForeignTarget[] = [];
  for (const rule of rules) {
    const databases = [...byDb.keys()]
      .filter((dbId) => dbId !== rule.domain)
      .sort((left, right) => compareByHash(`${rule.id}\u0000${left}`, left, `${rule.id}\u0000${right}`, right));
    if (databases.length === 0) continue;
    const ranked = databases.map((dbId) =>
      [...(byDb.get(dbId) as string[])].sort((left, right) =>
        compareByHash(`${rule.id}\u0000${left}`, left, `${rule.id}\u0000${right}`, right),
      ),
    );
    for (let at = 0; at < panel; at += 1) {
      const which = at % databases.length;
      const targetId = (ranked[which] as string[])[Math.floor(at / databases.length)];
      if (targetId === undefined) continue;
      out.push({ ruleId: rule.id, targetId, dbId: databases[which] as string, order: at });
    }
  }
  return out;
}

export function identifierTokens(text: string): ReadonlySet<string> {
  const tokens = new Set<string>();
  for (const match of text.toLowerCase().matchAll(/[a-z_][a-z0-9_]{2,}/g)) tokens.add(match[0]);
  return tokens;
}

/**
 * The rule's vocabulary, restricted to identifiers its own database actually has.
 *
 * The condition (`when`) is deliberately excluded. It is prose about when the rule applies, and it
 * names the very tables whose presence would make the rule look applicable — including it would
 * score a rule as relevant to the cases it was written to exclude.
 */
export function ruleTerms(rule: DensityRule, schema: ReadonlySet<string>): ReadonlySet<string> {
  const terms = new Set<string>();
  for (const token of identifierTokens(rule.statement)) {
    if (schema.has(token)) terms.add(token);
  }
  return terms;
}

/** Whether any of the terms appears in the text. */
export function mentionsTerms(terms: ReadonlySet<string>, text: string): boolean {
  if (terms.size === 0) return false;
  for (const token of identifierTokens(text)) {
    if (terms.has(token)) return true;
  }
  return false;
}

/**
 * The two readings of applicability, from one rule and one question.
 *
 * `relevant` reads the gold query and is therefore an upper bound a deployment cannot reach;
 * `cued` reads only what the question and its evidence say. Reporting both is what makes the
 * difference between "the store is wrong" and "retrieval is blind" a measurement rather than a
 * preference.
 */
export function classify(
  rule: DensityRule,
  schema: ReadonlySet<string>,
  target: { readonly question: string; readonly evidence: string; readonly goldSql: string },
): { readonly relevant: boolean; readonly cued: boolean } {
  const terms = ruleTerms(rule, schema);
  return {
    relevant: mentionsTerms(terms, target.goldSql),
    cued: mentionsTerms(terms, `${target.question}\n${target.evidence}`),
  };
}

/** What one stratum of trials did, at both units. */
export type StratumSummary = {
  /** Rules with at least one trial in this stratum. */
  readonly rules: number;
  /** Rule-injections. A rule shown twice counts twice, and this is not the number of questions. */
  readonly injections: number;
  readonly helped: number;
  readonly harmed: number;
  /** Rules that moved at least one answer in one direction more than the other. */
  readonly discriminating: number;
  /** Share of rules that never moved an answer: the silence, as a proportion. */
  readonly inertShare: number;
  /** Flips per injection, which unlike `inertShare` does not grow with the number of chances. */
  readonly flipRate: number;
  readonly baselineAccuracy: number;
  readonly treatmentAccuracy: number;
  readonly deltaPp: number;
  /** Cluster bootstrap over questions: the effective sample is the panel, not the injections. */
  readonly ciLowPp: number;
  readonly ciHighPp: number;
  /** Exact sign test over the rules whose net effect had a sign. */
  readonly signP: number;
  /** The least-exercised rule in the stratum, so a density claim cannot be made by average. */
  readonly minShown: number;
};

/** A count with its noun, so a gate's reading can be read aloud. */
function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function share(part: number, whole: number): number {
  return whole === 0 ? 0 : part / whole;
}

/**
 * One stratum of the ledger.
 *
 * `inertShare` alone would be misleading: a rule shown twenty times has twenty chances to flip and
 * a rule shown twice has two, so the same underlying behaviour produces very different inertness at
 * different densities. `flipRate` is the density-free counterpart, and the two are reported beside
 * each other for that reason — the first is the roadmap's pre-registered criterion, the second is
 * what decides whether anything changed at all.
 */
export function stratumOf(
  trials: readonly DensityTrial[],
  options: { readonly resamples?: number; readonly seed?: number } = {},
): StratumSummary {
  const perRule = new Map<string, { shown: number; helped: number; harmed: number }>();
  let helped = 0;
  let harmed = 0;
  let baseline = 0;
  let treatment = 0;
  const deltas: number[] = [];
  const clusters: string[] = [];
  for (const trial of trials) {
    const record = perRule.get(trial.ruleId) ?? { shown: 0, helped: 0, harmed: 0 };
    const repaired = trial.correct && !trial.baselineCorrect;
    const broke = !trial.correct && trial.baselineCorrect;
    perRule.set(trial.ruleId, {
      shown: record.shown + 1,
      helped: record.helped + (repaired ? 1 : 0),
      harmed: record.harmed + (broke ? 1 : 0),
    });
    if (repaired) helped += 1;
    if (broke) harmed += 1;
    if (trial.baselineCorrect) baseline += 1;
    if (trial.correct) treatment += 1;
    deltas.push((trial.correct ? 1 : 0) - (trial.baselineCorrect ? 1 : 0));
    clusters.push(trial.targetId);
  }
  let discriminating = 0;
  let positive = 0;
  let negative = 0;
  const shownCounts: number[] = [];
  for (const record of perRule.values()) {
    if (record.helped !== record.harmed) discriminating += 1;
    if (record.helped > record.harmed) positive += 1;
    if (record.harmed > record.helped) negative += 1;
    shownCounts.push(record.shown);
  }
  const interval = clusterBootstrapCI(
    deltas,
    clusters,
    options.resamples ?? 10_000,
    options.seed ?? 7,
  );
  return {
    rules: perRule.size,
    injections: trials.length,
    helped,
    harmed,
    discriminating,
    inertShare: share(perRule.size - discriminating, perRule.size),
    flipRate: share(helped + harmed, trials.length),
    baselineAccuracy: share(baseline, trials.length),
    treatmentAccuracy: share(treatment, trials.length),
    deltaPp: share(treatment - baseline, trials.length) * 100,
    ciLowPp: interval.low * 100,
    ciHighPp: interval.high * 100,
    // Over the rules, not the injections: `helped + harmed === 0` means no rule had a sign, and the
    // honest answer to "is one direction more likely" is then that nothing moved.
    signP: positive + negative === 0 ? 1 : mcnemarExact(positive, negative),
    minShown: shownCounts.length === 0 ? 0 : Math.min(...shownCounts),
  };
}

export type PolicyName = 'always' | 'fitted' | 'cued' | 'oracle';

/** What one rule-selection policy would have scored on the half of the panel it was not fitted on. */
export type PolicyRow = {
  readonly name: PolicyName;
  /** Injections the policy chose to make. */
  readonly shown: number;
  readonly injections: number;
  readonly baselineAccuracy: number;
  readonly treatmentAccuracy: number;
  readonly deltaPp: number;
  readonly ciLowPp: number;
  readonly ciHighPp: number;
  readonly gained: number;
  readonly lost: number;
};

function policyRow(
  name: PolicyName,
  scored: readonly DensityTrial[],
  shownOf: (trial: DensityTrial) => boolean,
  options: { readonly resamples?: number; readonly seed?: number },
): PolicyRow {
  let baseline = 0;
  let treatment = 0;
  let gained = 0;
  let lost = 0;
  let shown = 0;
  const deltas: number[] = [];
  const clusters: string[] = [];
  for (const trial of scored) {
    const shows = shownOf(trial);
    const withRule = shows ? trial.correct : trial.baselineCorrect;
    if (shows) shown += 1;
    if (trial.baselineCorrect) baseline += 1;
    if (withRule) treatment += 1;
    if (withRule && !trial.baselineCorrect) gained += 1;
    if (!withRule && trial.baselineCorrect) lost += 1;
    deltas.push((withRule ? 1 : 0) - (trial.baselineCorrect ? 1 : 0));
    clusters.push(trial.targetId);
  }
  const interval = clusterBootstrapCI(deltas, clusters, options.resamples ?? 10_000, options.seed ?? 7);
  return {
    name,
    shown,
    injections: scored.length,
    baselineAccuracy: share(baseline, scored.length),
    treatmentAccuracy: share(treatment, scored.length),
    deltaPp: share(treatment - baseline, scored.length) * 100,
    ciLowPp: interval.low * 100,
    ciHighPp: interval.high * 100,
    gained,
    lost,
  };
}

/**
 * Four policies, all priced on the half of the panel that was not used to fit them.
 *
 * `always` is the incumbent — carry every rule — and is the number every previous arm in this
 * project paid. `fitted` is the roadmap's per-rule policy: decide on the first half of the panel
 * whether this rule is worth showing, then obey that decision on the second. `cued` is the only
 * deployable one: show the rule when its vocabulary appears in the question, which needs no
 * labels. `oracle` decides on the scoring half itself and is a ceiling, printed so the gap between
 * what is decided and what could be decided is a number rather than an argument.
 *
 * A rule with no trial in the fit half is not shown by `fitted`. That is not a default: a rule that
 * was never seen to help has no evidence to carry it, and hiding it is the conservative reading.
 */
export function policyTable(
  trials: readonly DensityTrial[],
  split: number,
  options: { readonly resamples?: number; readonly seed?: number } = {},
): readonly PolicyRow[] {
  const scored = trials.filter((trial) => trial.order >= split);
  const fitted = trials.filter((trial) => trial.order < split);
  const net = (source: readonly DensityTrial[]): Map<string, number> => {
    const sums = new Map<string, number>();
    for (const trial of source) {
      sums.set(trial.ruleId, (sums.get(trial.ruleId) ?? 0) + trialDelta(trial));
    }
    return sums;
  };
  /**
   * The rules whose net effect on one half was positive, as a set.
   *
   * A set rather than a lookup into the sums, because both decisions are asked only of trials that
   * belong to the half the set was built from: a fallback for `absent` would be a branch no trial
   * could ever take, and a rule that appears in neither half is simply not shown.
   */
  const positiveRules = (source: readonly DensityTrial[]): ReadonlySet<string> => {
    const out = new Set<string>();
    for (const [ruleId, delta] of net(source)) {
      if (delta > 0) out.add(ruleId);
    }
    return out;
  };
  const fittedPositive = positiveRules(fitted);
  const scoredPositive = positiveRules(scored);
  const showsFitted = (trial: DensityTrial): boolean => fittedPositive.has(trial.ruleId);
  const showsOracle = (trial: DensityTrial): boolean => scoredPositive.has(trial.ruleId);
  return [
    policyRow('always', scored, () => true, options),
    policyRow('fitted', scored, showsFitted, options),
    policyRow('cued', scored, (trial) => trial.cued, options),
    policyRow('oracle', scored, showsOracle, options),
  ];
}

/** What one trial did to the answer: +1 repaired, −1 broken, 0 unchanged either way. */
function trialDelta(trial: DensityTrial): number {
  return (trial.correct ? 1 : 0) - (trial.baselineCorrect ? 1 : 0);
}

/** A policy scored by repeated cross-fitting instead of on one half of the panel. */
export type CrossFitRow = {
  /** Folds each rule's panel is cut into: one is held out, the rest fit the rule's sign. */
  readonly folds: number;
  /** How many independent splits were drawn. Every trial is scored once per repeat. */
  readonly repeats: number;
  /** Injections the policy chose to make, summed over repeats. */
  readonly shown: number;
  /** Injections scored, which is every trial once per repeat. */
  readonly injections: number;
  readonly baselineAccuracy: number;
  readonly treatmentAccuracy: number;
  readonly deltaPp: number;
  readonly ciLowPp: number;
  readonly ciHighPp: number;
  readonly gained: number;
  readonly lost: number;
};

/** Folds per split, and splits per reading. Fixed here so a run cannot pick them after seeing one. */
const CROSS_FOLDS = 5;
const CROSS_REPEATS = 10;

/**
 * Cut every rule's panel into `folds` groups, freshly for each repeat.
 *
 * The cut ranks a rule's own trials by a hash of the repeat and the trial's position and takes the
 * rank modulo the fold count: balanced by construction, independent of the order the trials arrive
 * in — the artefact is read back from JSON, and a page of trials that happened to sort differently
 * would otherwise be a different experiment — and different for every repeat, which is the whole
 * reason repeats exist.
 */
function foldOf(trials: readonly DensityTrial[], folds: number, repeat: number): Map<string, number> {
  const byRule = new Map<string, DensityTrial[]>();
  for (const trial of trials) {
    const bucket = byRule.get(trial.ruleId) ?? [];
    bucket.push(trial);
    byRule.set(trial.ruleId, bucket);
  }
  const out = new Map<string, number>();
  for (const [ruleId, group] of byRule) {
    const ranked = [...group].sort((left, right) =>
      compareByHash(
        `${ruleId}\u0000${repeat}\u0000${left.order}`,
        left.targetId,
        `${ruleId}\u0000${repeat}\u0000${right.order}`,
        right.targetId,
      ),
    );
    for (const [rank, trial] of ranked.entries()) {
      out.set(`${ruleId}\u0000${trial.order}`, rank % folds);
    }
  }
  return out;
}

/**
 * The per-rule policy again, but fitted out of fold and scored on every trial.
 *
 * `policyTable`'s `fitted` row is one split: it decides a rule's sign on the first half of the panel
 * and is scored on the second. That is the cheapest honest estimate and it is also the noisiest —
 * the run that measured it found the two halves of the panel were not exchangeable (25 repairs and
 * 25 breaks on the fit halves, 17 and 46 on the scoring halves), so one draw can carry a rule across
 * the decision boundary on ten observations that say little.
 *
 * This repeats the split. Each repeat cuts every rule's panel into `folds` groups, fits the rule's
 * sign on the other groups and scores the held-out one, so every trial is scored exactly once per
 * repeat and no trial ever contributes to the decision made about itself. The result is the same
 * policy asked `repeats` times with the answers averaged, which is what makes an interval over it
 * mean what it says.
 *
 * A rule whose out-of-fold net is zero is not shown. That is the same reading `fitted` obeys: a rule
 * with no evidence for it is not carried.
 */
export function crossFit(
  trials: readonly DensityTrial[],
  options: {
    // `| undefined` because the report forwards its input's optional overrides verbatim, which is
    // how a caller says "use the pre-registered split".
    readonly folds?: number | undefined;
    readonly repeats?: number | undefined;
    readonly resamples?: number | undefined;
    readonly seed?: number | undefined;
    /**
     * How many of each rule's observations the fit may look at, counted from the start of its panel.
     *
     * The cap restricts the evidence, never the scoring: every trial is still scored once per
     * repeat, so two caps are two policies measured on the same injections rather than two samples.
     * That is what makes the curve in `evidenceCurve` a curve and not seven experiments.
     */
    readonly evidenceCap?: number | undefined;
  } = {},
): CrossFitRow {
  const folds = Math.floor(options.folds ?? CROSS_FOLDS);
  const repeats = Math.floor(options.repeats ?? CROSS_REPEATS);
  if (folds < 2) throw new RangeError(`crossFit needs at least 2 folds, got ${folds}`);
  if (repeats < 1) throw new RangeError(`crossFit needs at least 1 repeat, got ${repeats}`);
  const cap = options.evidenceCap ?? Number.POSITIVE_INFINITY;
  if (Math.floor(cap) < 1) throw new RangeError(`crossFit needs at least 1 observation to fit on, got ${cap}`);
  let baseline = 0;
  let treatment = 0;
  let gained = 0;
  let lost = 0;
  let shown = 0;
  const deltas: number[] = [];
  const clusters: string[] = [];
  for (let repeat = 0; repeat < repeats; repeat += 1) {
    const assignment = foldOf(trials, folds, repeat);
    for (let fold = 0; fold < folds; fold += 1) {
      const outOfFold = new Map<string, number>();
      for (const trial of trials) {
        if (trial.order >= cap) continue;
        if (assignment.get(`${trial.ruleId}\u0000${trial.order}`) === fold) continue;
        outOfFold.set(trial.ruleId, (outOfFold.get(trial.ruleId) ?? 0) + trialDelta(trial));
      }
      const positive = new Set<string>();
      for (const [ruleId, delta] of outOfFold) {
        if (delta > 0) positive.add(ruleId);
      }
      for (const trial of trials) {
        if (assignment.get(`${trial.ruleId}\u0000${trial.order}`) !== fold) continue;
        const shows = positive.has(trial.ruleId);
        const withRule = shows ? trial.correct : trial.baselineCorrect;
        if (shows) shown += 1;
        if (trial.baselineCorrect) baseline += 1;
        if (withRule) treatment += 1;
        if (withRule && !trial.baselineCorrect) gained += 1;
        if (!withRule && trial.baselineCorrect) lost += 1;
        // A hidden rule carries the control's verdict, so its delta is zero by construction.
        deltas.push(shows ? trialDelta(trial) : 0);
        clusters.push(trial.targetId);
      }
    }
  }
  const interval = clusterBootstrapCI(deltas, clusters, options.resamples ?? 10_000, options.seed ?? 7);
  return {
    folds,
    repeats,
    shown,
    injections: deltas.length,
    baselineAccuracy: share(baseline, deltas.length),
    treatmentAccuracy: share(treatment, deltas.length),
    deltaPp: share(treatment - baseline, deltas.length) * 100,
    ciLowPp: interval.low * 100,
    ciHighPp: interval.high * 100,
    gained,
    lost,
  };
}

/** One rule's record over the panel, split by half, because a policy may only learn from one. */
export type RuleDensityRow = {
  readonly id: string;
  readonly shown: number;
  readonly helped: number;
  readonly harmed: number;
  /** The first half of the panel: everything a policy is allowed to look at. */
  readonly fitHelped: number;
  readonly fitHarmed: number;
  /** The second half: everything the policy is scored on. */
  readonly scoreHelped: number;
  readonly scoreHarmed: number;
  /** The injections whose question was answered by a query using this rule's vocabulary. */
  readonly relevantShown: number;
  readonly relevantHelped: number;
  readonly relevantHarmed: number;
};

/**
 * The per-rule ledger, which is the only form in which "did this rule do anything" is a question
 * about a rule rather than about a stratum.
 *
 * The two halves are separated here rather than summed, because the sum answers a question nobody
 * can deploy: a policy that decides whether to carry a rule has to decide it from the questions it
 * has seen, and the artefact has to carry the split or the fit cannot be re-examined afterwards.
 */
export function ruleDensityRows(
  rules: readonly DensityRule[],
  trials: readonly DensityTrial[],
  split: number,
): readonly RuleDensityRow[] {
  const byRule = new Map<string, RuleDensityRow>();
  for (const rule of rules) {
    byRule.set(rule.id, {
      id: rule.id,
      shown: 0,
      helped: 0,
      harmed: 0,
      fitHelped: 0,
      fitHarmed: 0,
      scoreHelped: 0,
      scoreHarmed: 0,
      relevantShown: 0,
      relevantHelped: 0,
      relevantHarmed: 0,
    });
  }
  for (const trial of trials) {
    const row = byRule.get(trial.ruleId);
    // A trial whose rule is not in the selected set would mean the lane exercised a rule it never
    // selected, which is a defect rather than a row; it is dropped and the reconciliation gate
    // catches the count.
    if (row === undefined) continue;
    const repaired = trial.correct && !trial.baselineCorrect ? 1 : 0;
    const broke = !trial.correct && trial.baselineCorrect ? 1 : 0;
    const fit = trial.order < split;
    byRule.set(trial.ruleId, {
      ...row,
      shown: row.shown + 1,
      helped: row.helped + repaired,
      harmed: row.harmed + broke,
      fitHelped: row.fitHelped + (fit ? repaired : 0),
      fitHarmed: row.fitHarmed + (fit ? broke : 0),
      scoreHelped: row.scoreHelped + (fit ? 0 : repaired),
      scoreHarmed: row.scoreHarmed + (fit ? 0 : broke),
      relevantShown: row.relevantShown + (trial.relevant ? 1 : 0),
      relevantHelped: row.relevantHelped + (trial.relevant ? repaired : 0),
      relevantHarmed: row.relevantHarmed + (trial.relevant ? broke : 0),
    });
  }
  return [...byRule.values()];
}

/** Whether a rule that looked good on the first half keeps looking good on the second. */
export type SignPersistence = {
  /** Rules whose net effect had a sign on the fit half: the population a policy can choose from. */
  readonly withFitSign: number;
  /** Rules whose net effect had a sign on both halves: the only ones the question applies to. */
  readonly paired: number;
  readonly agreed: number;
  readonly disagreed: number;
  /** Share of the paired rules whose scoring half had the same sign as the fit half. */
  readonly agreement: number;
  /** Exact two-sided test over `agreed` against `disagreed`, or 1 when nothing was paired. */
  readonly p: number;
};

/**
 * Does the half a policy can see predict the half it is scored on?
 *
 * This is R9.3's precondition, and it is cheaper to read from the ledger than from the policy's
 * delta: a policy that gains is a policy whose selection *generalised*, and a policy that gains
 * because the fit half was lucky is one whose sign does not repeat. Asking the per-rule question
 * separately keeps the two apart — the delta says how much a whole policy was worth on one draw of
 * eighty rules, the persistence says whether there was anything to learn.
 */
export function signPersistence(rows: readonly RuleDensityRow[]): SignPersistence {
  let withFitSign = 0;
  let paired = 0;
  let agreed = 0;
  let disagreed = 0;
  for (const row of rows) {
    const fit = row.fitHelped - row.fitHarmed;
    const score = row.scoreHelped - row.scoreHarmed;
    if (fit !== 0) withFitSign += 1;
    if (fit === 0 || score === 0) continue;
    paired += 1;
    if (Math.sign(fit) === Math.sign(score)) agreed += 1;
    else disagreed += 1;
  }
  return {
    withFitSign,
    paired,
    agreed,
    disagreed,
    agreement: share(agreed, paired),
    p: paired === 0 ? 1 : mcnemarExact(disagreed, agreed),
  };
}

/** Everything one density run measured. */
/** The four ways a foreign trial is grouped: all of them, or by what the rule did at home. */
export type TransferKind = 'all' | 'positive' | 'zero' | 'negative';

/** A rule's effect away from home, in the units R9.4 fixed before the dispatch. */
export type TransferRow = {
  readonly kind: TransferKind;
  /** Distinct rules that contributed a trial to this row. */
  readonly rules: number;
  readonly trials: number;
  readonly deltaPp: number;
  readonly ciLowPp: number;
  readonly ciHighPp: number;
  /** Trials the control failed, and the ones the rule then got right: R6's repair rate. */
  readonly repaired: number;
  readonly informative: number;
  readonly repairRate: number;
  /** Trials the control passed, and the ones the rule then broke: the side R6 closed on. */
  readonly broke: number;
  readonly breakable: number;
  readonly breakRate: number;
  /**
   * The same rules on their home questions, so a foreign rate has something to be a fraction of.
   *
   * R6's axis closed on the break rate because a repair rate whose denominator drops every trial
   * the rule damages can only go up. A foreign reading that quotes only the repair rate would
   * repeat that mistake in a new place, so both travel together.
   */
  readonly home: {
    readonly trials: number;
    readonly deltaPp: number;
    readonly repairRate: number;
    readonly breakRate: number;
  };
};

export type TransferReading = {
  /** Targets demanded per rule, which is the count V24 holds the reading to. */
  readonly panel: number;
  readonly rules: number;
  readonly trials: number;
  /** Distinct foreign questions, and the databases they came from. */
  readonly targets: number;
  readonly domains: number;
  /**
   * Distinct rule-database pairs the arm exercised.
   *
   * This is the unit R10's binding is attempted at — one rule meets one schema and either binds or
   * is withheld — and it is the only denominator that can reconcile the attempts the binder made
   * against the attempts that reached the ledger.
   */
  readonly pairs: number;
  /** Injections that landed on the rule's own database: the failure V24 exists to catch. */
  readonly offHome: number;
  readonly overall: TransferRow;
  /**
   * Positive, zero and negative, in that order, as a tuple rather than a list.
   *
   * The three strata always exist — a rule's home net is above, below or at zero — and a caller that
   * had to search for the positive one would be writing a branch that cannot be taken. The tuple
   * says so in the type, so `strata[0]` is the positive stratum without a fallback that never runs.
   */
  readonly strata: readonly [TransferRow, TransferRow, TransferRow];
};

/** The counts a row is made of, so the delta and the two rates share one pass over the trials. */
function countsOf(trials: readonly DensityTrial[]): {
  readonly trials: number;
  readonly repaired: number;
  readonly informative: number;
  readonly broke: number;
  readonly breakable: number;
  readonly delta: number;
} {
  let repaired = 0;
  let informative = 0;
  let broke = 0;
  let breakable = 0;
  let delta = 0;
  for (const trial of trials) {
    delta += trialDelta(trial);
    if (trial.baselineCorrect) {
      breakable += 1;
      if (!trial.correct) broke += 1;
    } else {
      informative += 1;
      if (trial.correct) repaired += 1;
    }
  }
  return { trials: trials.length, repaired, informative, broke, breakable, delta };
}

/** One row of the transfer reading, over the foreign trials and the home trials of the same rules. */
function transferRow(
  kind: TransferKind,
  trials: readonly DensityTrial[],
  homeTrials: readonly DensityTrial[],
  options: { readonly resamples: number; readonly seed: number },
): TransferRow {
  const counts = countsOf(trials);
  const home = countsOf(homeTrials);
  const interval = clusterBootstrapCI(
    trials.map((trial) => trialDelta(trial)),
    trials.map((trial) => trial.targetId),
    options.resamples,
    options.seed,
  );
  return {
    kind,
    rules: new Set(trials.map((trial) => trial.ruleId)).size,
    trials: counts.trials,
    deltaPp: share(counts.delta, counts.trials) * 100,
    ciLowPp: interval.low * 100,
    ciHighPp: interval.high * 100,
    repaired: counts.repaired,
    informative: counts.informative,
    repairRate: share(counts.repaired, counts.informative),
    broke: counts.broke,
    breakable: counts.breakable,
    breakRate: share(counts.broke, counts.breakable),
    home: {
      trials: home.trials,
      deltaPp: share(home.delta, home.trials) * 100,
      repairRate: share(home.repaired, home.informative),
      breakRate: share(home.broke, home.breakable),
    },
  };
}

/**
 * Does a rule that worked at home still work away from home?
 *
 * Every trial in the family before this one put a rule on a question from its own database, so the
 * 1.33pp R9.3 measured is the value of a rule *in its own schema*. A deployment does not have that
 * guarantee: a store that is retrieved across databases puts a rule about `financial` onto a
 * question about `formula_1`, and nothing in this programme has measured what that does. The floor
 * measures the mirror image — a foreign rule on a home question — and earns +0.05pp; this measures
 * the rule's own direction.
 *
 * The strata are the point. A rule that never worked at home cannot "transfer", so the claim is
 * about rules whose in-domain net was positive, and the zero and negative strata are carried beside
 * it to show what the same material does when it was never worth showing. A stratification by the
 * foreign outcome would be circular: it would sort rules by the very number it then reports.
 *
 * A rule with no home trial is placed in the zero stratum rather than dropped. It has no home
 * evidence, which is precisely what zero means here, and dropping it would silently shrink the
 * denominator of every rate in the reading.
 */
export function transferOf(input: {
  readonly trials: readonly DensityTrial[];
  readonly homeTrials: readonly DensityTrial[];
  readonly panel: number;
  readonly resamples?: number;
  readonly seed?: number;
}): TransferReading {
  const options = { resamples: input.resamples ?? 10_000, seed: input.seed ?? 7 };
  const net = new Map<string, number>();
  const domain = new Map<string, string>();
  for (const trial of input.homeTrials) {
    net.set(trial.ruleId, (net.get(trial.ruleId) ?? 0) + trialDelta(trial));
    domain.set(trial.ruleId, trial.domain);
  }
  const kindOf = (ruleId: string): TransferKind => {
    const value = net.get(ruleId) ?? 0;
    if (value > 0) return 'positive';
    return value < 0 ? 'negative' : 'zero';
  };
  const rowOf = (kind: TransferKind): TransferRow => {
    const held = input.trials.filter((trial) => kindOf(trial.ruleId) === kind);
    const rules = new Set(held.map((trial) => trial.ruleId));
    return transferRow(
      kind,
      held,
      input.homeTrials.filter((trial) => rules.has(trial.ruleId)),
      options,
    );
  };
  return {
    panel: input.panel,
    rules: new Set(input.trials.map((trial) => trial.ruleId)).size,
    trials: input.trials.length,
    targets: new Set(input.trials.map((trial) => trial.targetId)).size,
    domains: new Set(input.trials.map((trial) => trial.domain)).size,
    pairs: new Set(input.trials.map((trial) => `${trial.ruleId}\u0000${trial.domain}`)).size,
    // A rule whose home database is unknown cannot land on it, so it is not counted either way.
    offHome: input.trials.filter((trial) => domain.get(trial.ruleId) === trial.domain).length,
    overall: transferRow('all', input.trials, input.homeTrials, options),
    strata: [rowOf('positive'), rowOf('zero'), rowOf('negative')],
  };
}

/** One row of the evidence curve: the policy fitted on the first `cap` observations of each rule. */
export type EvidenceRow = {
  readonly cap: number;
  readonly deltaPp: number;
  readonly ciLowPp: number;
  readonly ciHighPp: number;
  readonly shown: number;
  readonly injections: number;
  readonly gained: number;
  readonly lost: number;
};

/** The caps R9.5 fixed before the dispatch: four observations up to the whole panel. */
const EVIDENCE_CAPS: readonly number[] = [4, 6, 8, 10, 12, 16, 20];

/**
 * The caps a panel can actually be read at.
 *
 * A cap larger than the panel is not a reading, it is the same reading twice, and a panel of two
 * questions has no curve in it at all — so the default list is trimmed to what the panel can
 * support, and a panel too small for two of them falls back to its own two halves rather than
 * reporting a curve of one point.
 */
function capsFor(panel: number): readonly number[] {
  const fits = EVIDENCE_CAPS.filter((cap) => cap <= panel);
  return fits.length >= 2 ? fits : [Math.max(1, Math.floor(panel / 2)), panel];
}

/**
 * How many observations does a rule need before its sign may be believed?
 *
 * The policy is "show the rule when its out-of-fold net is positive", and the fold count decides
 * how much of the panel the fit may see: five folds leave sixteen observations, two folds leave ten
 * and collapse the reading to nothing. So the amount of evidence is a parameter of the policy
 * rather than a property of the workload, and a deployment that distils a rule has to pay for it
 * before it may show the rule at all.
 *
 * Each row caps the fit at the first `cap` observations of every rule and scores the whole panel, so
 * the rows are paired: same injections, same questions, same clusters, one knob. The interval is a
 * bootstrap at a lower resample count than the headline readings — this is seven readings of one
 * panel and four thousand resamples would only make the same interval slower to print.
 */
export function evidenceCurve(
  trials: readonly DensityTrial[],
  options: {
    readonly caps?: readonly number[];
    readonly folds?: number;
    readonly repeats?: number;
    readonly resamples?: number;
    readonly seed?: number;
  } = {},
): readonly EvidenceRow[] {
  const caps = options.caps ?? EVIDENCE_CAPS;
  for (const cap of caps) {
    if (Math.floor(cap) < 1) throw new RangeError(`a cap needs at least 1 observation, got ${cap}`);
  }
  return caps.map((cap) => {
    const row = crossFit(trials, {
      folds: options.folds,
      repeats: options.repeats,
      resamples: options.resamples ?? 2_000,
      seed: options.seed,
      evidenceCap: cap,
    });
    return {
      cap: Math.floor(cap),
      deltaPp: row.deltaPp,
      ciLowPp: row.ciLowPp,
      ciHighPp: row.ciHighPp,
      shown: row.shown,
      injections: row.injections,
      gained: row.gained,
      lost: row.lost,
    };
  });
}

export type DensityReport = {
  /** Questions each rule was shown, fixed before the run. */
  readonly panel: number;
  /** Injections whose call never returned, absent from the ledger and counted here instead. */
  readonly holes: number;
  readonly rules: number;
  readonly targets: number;
  readonly injections: number;
  /** How often the least, the median and the most exercised rule was shown. */
  readonly shown: { readonly min: number; readonly median: number; readonly max: number };
  readonly overall: StratumSummary;
  readonly relevant: StratumSummary;
  readonly irrelevant: StratumSummary;
  readonly cued: StratumSummary;
  /** The wrong-scope control: one foreign rule on the same panel, for the cost of a floor. */
  readonly floor: StratumSummary;
  readonly policies: readonly PolicyRow[];
  /**
   * The same policy fitted out of fold on repeated splits, and the foreign rules fitted the same way.
   *
   * Absent — not zeroed — when the artefact predates this reading. A zeroed row would read as a
   * measurement that came back empty, and the two bars that read it are only meaningful when the
   * cross-fit actually ran.
   */
  readonly crossFit?: { readonly store: CrossFitRow; readonly floor: CrossFitRow };
  /** What a rule that worked at home does on a question from another database: R9.4's reading. */
  readonly transfer?: TransferReading;
  /**
   * R10: what happened when each rule was read as a template and bound against the target schema.
   *
   * Absent when the run showed rules as prose, which is every artefact produced before R10. A zeroed
   * coverage would read as a binding attempt that bound nothing, and the withheld count is the one
   * number this stage's third prediction is stated in.
   */
  readonly templates?: TemplateCoverage;
  /**
   * The cross-fit again with the fit pool capped, from four observations to the whole panel.
   *
   * Absent from artefacts written before the curve existed: it is recomputable from the carried
   * ledger at no cost, but a published report is a record of what was measured, not of what could
   * be, so the field is absent rather than backfilled.
   */
  readonly evidence?: readonly EvidenceRow[];
  /** The ledger itself, so a policy's fit can be re-examined without the trials. */
  readonly perRule: readonly RuleDensityRow[];
  readonly signs: SignPersistence;
};

export type DensityInput = {
  readonly rules: readonly DensityRule[];
  readonly panel: number;
  readonly trials: readonly DensityTrial[];
  readonly floorTrials: readonly DensityTrial[];
  readonly resamples?: number;
  readonly seed?: number;
  readonly folds?: number;
  readonly repeats?: number;
  /** The foreign trials, absent when the run bought no cross-database arm. */
  readonly crossTrials?: readonly DensityTrial[];
  /** Targets demanded per rule on the foreign panel, which is what V24 checks the count against. */
  readonly transferPanel?: number;
  /** Injections the lane planned and never measured, so a short panel can be priced. */
  readonly holes?: number;
  /** R10's coverage, when the foreign arm bound templates instead of showing prose. */
  readonly templates?: TemplateCoverage;
};

/**
 * The reading, from trials to a report.
 *
 * `shown` is computed over the rules that were *selected*, not over the rules that appear in the
 * trials: a rule the lane selected and then never injected is the failure this family must be able
 * to see, and deriving the population from the trials would hide exactly that case.
 */
export function densityReport(input: DensityInput): DensityReport {
  const options = { resamples: input.resamples ?? 10_000, seed: input.seed ?? 7 };
  const split = Math.ceil(input.panel / 2);
  const perRule = ruleDensityRows(input.rules, input.trials, split);
  const counts = new Map<string, number>();
  for (const trial of input.trials) {
    counts.set(trial.ruleId, (counts.get(trial.ruleId) ?? 0) + 1);
  }
  const shownCounts = input.rules.map((rule) => counts.get(rule.id) ?? 0).sort((left, right) => left - right);
  const median = shownCounts.length === 0 ? 0 : (shownCounts[Math.floor((shownCounts.length - 1) / 2)] as number);
  return {
    panel: input.panel,
    holes: input.holes ?? 0,
    rules: input.rules.length,
    targets: new Set(input.trials.map((trial) => trial.targetId)).size,
    injections: input.trials.length,
    shown: {
      min: shownCounts.length === 0 ? 0 : (shownCounts[0] as number),
      median,
      max: shownCounts.length === 0 ? 0 : (shownCounts[shownCounts.length - 1] as number),
    },
    overall: stratumOf(input.trials, options),
    relevant: stratumOf(input.trials.filter((trial) => trial.relevant), options),
    irrelevant: stratumOf(input.trials.filter((trial) => !trial.relevant), options),
    cued: stratumOf(input.trials.filter((trial) => trial.cued), options),
    floor: stratumOf(input.floorTrials, options),
    policies: policyTable(input.trials, split, options),
    crossFit: {
      store: crossFit(input.trials, { ...options, folds: input.folds, repeats: input.repeats }),
      floor: crossFit(input.floorTrials, { ...options, folds: input.folds, repeats: input.repeats }),
    },
    ...(input.crossTrials === undefined
      ? {}
      : {
          transfer: transferOf({
            trials: input.crossTrials,
            homeTrials: input.trials,
            panel: input.transferPanel ?? 0,
            ...options,
          }),
        }),
    ...(input.templates === undefined ? {} : { templates: input.templates }),
    evidence: evidenceCurve(input.trials, { ...options, caps: capsFor(input.panel) }),
    perRule,
    signs: signPersistence(perRule),
  };
}

/**
 * The pre-registered bars, evaluated after the fact and never adjusted.
 *
 * `V19` is the roadmap's R9.2 and `V18` is R9.1's acceptance criterion made computable. They are
 * blocking because each of them, if false, invalidates the family rather than the finding: a family
 * where a rule was shown nineteen times is not the family the stage described, and a family where
 * fewer than three fifths of the rules move anything is too easy (or too wrong) to decide the
 * question the stage exists for. `V20` is a reconciliation and `V21` is the floor, which is a number
 * to report rather than a bar to clear.
 */
export function densityGates(report: DensityReport): readonly ValidityGate[] {
  const discriminateShare = share(report.overall.discriminating, report.rules);
  const strataReconcile =
    report.relevant.injections + report.irrelevant.injections === report.overall.injections &&
    report.overall.injections === report.injections;
  return [
    {
      id: 'V18-density-exercised',
      criterion:
        `every selected rule is shown ${report.panel} times, less at most the calls that never ` +
        `returned and at most 1% of the family`,
      actual:
        `${report.shown.min}-${report.shown.max} per rule (median ${report.shown.median}), ` +
        `${plural(report.holes, 'hole')} in ${report.injections + report.holes}`,
      // A hole is not a design failure and must not be read as one. The gate asks whether every
      // rule got its chances; a returned-call count can be short for a reason that says nothing
      // about the family, and the first R9.4 dispatch was refused over exactly one lost call. Both
      // bounds stay tight: no rule may be short by more than the number of holes, and no more than
      // 1% of the family may be lost, so a run that really did lose its injections still fails.
      pass:
        report.rules > 0 &&
        report.shown.min >= report.panel - report.holes &&
        report.holes <= Math.max(1, Math.ceil((report.injections + report.holes) * 0.01)),
      blocking: true,
    },
    {
      id: 'V19-density-discriminates',
      criterion: 'at least 60% of rules move an answer in one direction more than the other',
      actual: `${(discriminateShare * 100).toFixed(1)}% of ${report.rules} rules`,
      pass: report.rules > 0 && discriminateShare >= 0.6,
      blocking: true,
    },
    {
      id: 'V20-density-reconciles',
      criterion: 'every injection is in exactly one stratum and the rules were shown the panel each',
      actual:
        `${report.overall.injections} injections = ${report.relevant.injections} relevant + ` +
        `${report.irrelevant.injections} irrelevant, ${report.rules} rules x ${report.panel}`,
      pass: strataReconcile,
      blocking: true,
    },
    {
      id: 'V21-density-floor',
      criterion: 'a wrong-scope rule was measured on the same panels',
      actual: `${report.floor.injections} floor injections, ${(report.floor.flipRate * 100).toFixed(1)}% flips`,
      pass: report.floor.injections > 0,
      blocking: false,
    },
    ...(report.crossFit === undefined ? [] : crossFitGates(report.crossFit, report.injections)),
    ...(report.transfer === undefined ? [] : transferGates(report.transfer, report.rules, report.templates)),
    ...(report.evidence === undefined ? [] : [evidenceGate(report.evidence, report.panel)]),
  ];
}

/**
 * R9.4's two bars: one for the bookkeeping, one for the claim.
 *
 * Both are emitted only when the run bought a cross-database arm, for the same reason the cross-fit
 * bars are: a bar that cannot be evaluated is not a failed bar, and the artefacts published before
 * this reading existed still have to be readable.
 *
 * `V24`'s coverage is the injections the family planned: every selected rule on one foreign panel,
 * less the panels the binder withheld. Counted over the rules that reached the ledger instead, a run
 * where seventy-nine rules were selected and one was shown would pass its own coverage bar — which
 * is the failure the bar exists for. Counted over the selection alone, arm B would fail for doing
 * what R10 asks it to do. The withheld count is what separates the two, and `V28` is what keeps that
 * count honest.
 */
function transferGates(
  transfer: TransferReading,
  rules: number,
  templates: TemplateCoverage | undefined,
): readonly ValidityGate[] {
  const stratified = transfer.strata.reduce((sum, row) => sum + row.trials, 0);
  const positive = transfer.strata[0];
  const carried = transfer.rules;
  const coverage = Math.max(0, (rules - (templates?.withheld ?? 0)) * transfer.panel);
  return [
    {
      id: 'V24-density-transfer-covers',
      criterion: 'every injection landed on a database that is not the rule own, and the strata reconcile',
      actual:
        `${transfer.trials} of ${coverage} injection(s) over ${transfer.domains} ` +
        `database(s), ${transfer.offHome} on the rule own`,
      pass:
        transfer.trials > 0 &&
        transfer.offHome === 0 &&
        stratified === transfer.trials &&
        transfer.trials >= Math.floor(coverage * 0.9),
      blocking: true,
    },
    ...(templates === undefined
      ? []
      : [
          {
            id: 'V28-density-withhold-reconciles',
            criterion:
              'every rule the binder read is either carried away from home or reported as withheld',
            actual:
              `${templates.bound} bound + ${templates.slotless} slotless = ${carried} carried, ` +
              `${templates.withheld} withheld of ${transfer.pairs} attempt(s)`,
            // The identity is the whole bar. A binder that drops an attempt without saying so is the
            // failure under test: withholding is a result, losing an attempt is a defect, and from
            // the trials alone the two look identical.
            pass: templates.bound + templates.slotless === transfer.pairs,
            blocking: true,
          },
        ]),
    {
      id: 'V25-density-transfer-holds',
      criterion: 'rules that worked at home earn a positive delta on foreign questions',
      actual:
        `${positive.deltaPp.toFixed(2)}pp [${positive.ciLowPp.toFixed(2)}, ${positive.ciHighPp.toFixed(2)}] ` +
        `over ${positive.trials} injection(s), home ${positive.home.deltaPp.toFixed(2)}pp`,
      pass: positive.deltaPp > 0,
      blocking: false,
    },
  ];
}

/**
 * R9.5's bar is that the curve is a curve.
 *
 * The reading itself is descriptive — there is no threshold a knee has to clear — but a curve whose
 * largest cap equals its smallest is one point printed seven times, and a cap above the panel is the
 * whole-panel reading wearing a different label. Both would look like a measurement in the summary.
 */
function evidenceGate(evidence: readonly EvidenceRow[], panel: number): ValidityGate {
  const caps = evidence.map((row) => row.cap);
  return {
    id: 'V26-density-evidence-curve',
    criterion: 'the curve spans at least two caps, all of them inside the panel',
    actual: `caps ${caps.join(', ')} of a ${panel}-question panel`,
    pass: caps.length >= 2 && Math.min(...caps) < panel && Math.max(...caps) <= panel,
    blocking: true,
  };
}

/**
 * The two bars that read the cross-fit, emitted only when there is a cross-fit to read.
 *
 * Kept apart from `densityGates` because they are the only pair whose inputs can be missing: an
 * artefact produced before R9.3 carries the four single-split policies and nothing to cross-fit, and
 * a gate that cannot be evaluated is not a failed gate.
 */
function crossFitGates(
  cross: { readonly store: CrossFitRow; readonly floor: CrossFitRow },
  injections: number,
): readonly ValidityGate[] {
  return [
    {
      id: 'V22-density-crossfit-covers',
      criterion: 'a repeated split scored every injection once per repeat, from rules fitted out of fold',
      actual:
        `${cross.store.injections} of ${injections * cross.store.repeats} ` +
        `injections scored, ${plural(cross.store.folds, 'fold')} x ` +
        `${plural(cross.store.repeats, 'repeat')}`,
      pass:
        cross.store.folds >= 2 &&
        cross.store.repeats >= 2 &&
        cross.store.injections === injections * cross.store.repeats,
      blocking: true,
    },
    {
      id: 'V23-density-crossfit-beats-floor',
      criterion: 'the cross-fitted selection clears zero and beats foreign rules fitted the same way',
      actual:
        `store ${cross.store.deltaPp.toFixed(2)}pp ` +
        `[${cross.store.ciLowPp.toFixed(2)}, ${cross.store.ciHighPp.toFixed(2)}] vs ` +
        `floor ${cross.floor.deltaPp.toFixed(2)}pp`,
      pass: cross.store.ciLowPp > 0 && cross.store.deltaPp > cross.floor.deltaPp,
      blocking: false,
    },
  ];
}
