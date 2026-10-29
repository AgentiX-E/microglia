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
): readonly DensityRule[] {
  const cap = Math.max(0, Math.floor(perDb));
  const byDomain = new Map<string, DensityRule[]>();
  for (const item of items) {
    if (item.status !== 'active') continue;
    if (item.domain === null || item.domain === '') continue;
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
      const delta =
        (trial.correct && !trial.baselineCorrect ? 1 : 0) - (!trial.correct && trial.baselineCorrect ? 1 : 0);
      sums.set(trial.ruleId, (sums.get(trial.ruleId) ?? 0) + delta);
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

/** Everything one density run measured. */
export type DensityReport = {
  /** Questions each rule was shown, fixed before the run. */
  readonly panel: number;
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
};

export type DensityInput = {
  readonly rules: readonly DensityRule[];
  readonly panel: number;
  readonly trials: readonly DensityTrial[];
  readonly floorTrials: readonly DensityTrial[];
  readonly resamples?: number;
  readonly seed?: number;
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
  const counts = new Map<string, number>();
  for (const trial of input.trials) {
    counts.set(trial.ruleId, (counts.get(trial.ruleId) ?? 0) + 1);
  }
  const shownCounts = input.rules.map((rule) => counts.get(rule.id) ?? 0).sort((left, right) => left - right);
  const median = shownCounts.length === 0 ? 0 : (shownCounts[Math.floor((shownCounts.length - 1) / 2)] as number);
  return {
    panel: input.panel,
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
    policies: policyTable(input.trials, Math.ceil(input.panel / 2), options),
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
      criterion: `every selected rule is shown at least ${report.panel} times`,
      actual: `${report.shown.min}-${report.shown.max} per rule (median ${report.shown.median})`,
      pass: report.rules > 0 && report.shown.min >= report.panel,
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
  ];
}
