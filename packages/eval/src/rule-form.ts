/**
 * What form a committed rule is written in, and whether that form can group questions.
 *
 * R32's first axis asks whether a rule is *procedural* — it tells the model how to build the query
 * — or *declarative* — it says what the answer depends on. The distinction only measures anything
 * if the two forms are separable in the corpus, so the first job here is not to classify but to
 * find out whether a classification can exist at all.
 *
 * It can, and the answer is not the one the registration expected. Nearly every rule does both at
 * once: `A query that joins a one-to-many table and filters on an aggregate of the many side must
 * deduplicate the projected entity column, because each matching child row otherwise produces a
 * duplicate parent row` states a consequence (the `because` clause) and gives a construction (the
 * `must deduplicate`) in the same sentence. The share of rules that carry both marker kinds is
 * reported as `bothShare`, and the bar that decides whether the axis is usable is the one R32
 * prediction 2 already registered for a different purpose: **fewer than half**.
 *
 * Two marker sets are exported. `STRICT` is the reading of record and leaves out relation words
 * such as `when` and `which`, which almost every rule opens with and which would count a sentence
 * as declarative for having a subordinate clause. `RELAXED` is the first attempt, kept because a
 * verdict that changes when the markers change is not a verdict, and reporting both is cheaper
 * than arguing about which one is right.
 *
 * Registered in `ROADMAP.md` §R32 prediction 1 and refutation.
 */
import { mulberry32 } from '@agentix-e/microglia-core';
import { cellOf, type CellReading, type DiffCase } from './query-diff.js';

/** The four classes a rule's text can fall into. `both` and `unmarked` are the failure modes. */
export type RuleForm = 'both' | 'procedural' | 'declarative' | 'unmarked';

/** A word list plus the name it is reported under, so a reading can say which one produced it. */
export type FormMarkers = {
  readonly name: string;
  readonly declarative: readonly RegExp[];
  readonly procedural: readonly RegExp[];
};

/**
 * The markers of record.
 *
 * Declarative markers are verbs that assert a state or a consequence — what a query *returns*,
 * what a value *is*, what two forms are *equivalent* to. Procedural markers are verbs that
 * instruct a construction — what a query *must* do, what it *requires*, what it *joins* or
 * *filters* on.
 *
 * Deliberately absent: `when`, `which`, `so`, `that`. Every rule in this corpus is a conditional,
 * so any of them would fire on nearly the whole set and turn the census into a constant.
 */
export const STRICT_MARKERS: FormMarkers = {
  name: 'strict',
  declarative: [
    /\breturns?\b/,
    /\byields?\b/,
    /\bproduc(e|es|ed)\b/,
    /\bis\b/,
    /\bare\b/,
    /\bequivalent\b/,
    /\bmeans?\b/,
    /\bindicat(e|es|ed)\b/,
    /\bbecause\b/,
    /\bno rows\b/,
    /\bcarries\b/,
    /\bholds?\b/,
    /\bcontain(s|ed)?\b/,
    /\bfail(s|ed)?\b/,
    /\bbreaks?\b/,
    /\bwrong\b/,
    /\bconflict/,
  ],
  procedural: [
    /\bmust\b/,
    /\brequires?\b/,
    /\bshould\b/,
    /\buse[sd]?\b/,
    /\busing\b/,
    /\bjoin(s|ing|ed)?\b/,
    /\bfilter(s|ing|ed)?\b/,
    /\bselect(s|ing|ed)?\b/,
    /\bproject(s|ing|ed)?\b/,
    /\bgroup(s|ing|ed)?\b/,
    /\border(s|ing|ed)?\b/,
    /\baggregat/,
    /\bcast(s|ing)?\b/,
    /\bapply\b/,
    /\bdeduplicat/,
  ],
};

/**
 * The first attempt, kept for the sensitivity read.
 *
 * It adds `when`, `which` and `so` to the declarative side. Those three are what moved the census
 * from 58.7% to 63.5% both, and neither number clears the bar, which is the point of keeping it.
 */
export const RELAXED_MARKERS: FormMarkers = {
  name: 'relaxed',
  declarative: [...STRICT_MARKERS.declarative, /\bwhen\b/, /\bwhich\b/, /\bso\b/],
  procedural: STRICT_MARKERS.procedural,
};

/** R32 prediction 2's bar, reused: below half the axis is usable, at or above half it is not. */
export const SEPARATION_BAR = 0.5;

/** Lowercase and collapse whitespace, so two renderings of one sentence compare equal. */
function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Which form a rule's text is written in.
 *
 * A rule that fires both marker kinds is `both` rather than being decided by marker count: the
 * count would be an artefact of sentence length, and the question the axis asks is whether the two
 * forms are *distinct*, which a sentence carrying both answers in the negative.
 */
export function ruleFormOf(text: string, markers: FormMarkers = STRICT_MARKERS): RuleForm {
  const padded = ` ${normalise(text)} `;
  const declarative = markers.declarative.some((pattern) => pattern.test(padded));
  const procedural = markers.procedural.some((pattern) => pattern.test(padded));
  if (declarative && procedural) return 'both';
  if (declarative) return 'declarative';
  if (procedural) return 'procedural';
  return 'unmarked';
}

/** The shape of the committed rule pool: how many rows it holds, and what those rows are. */
export type RulePool = {
  /** Rows in the artefact. One row is one fold's copy of a rule, so this is not a count of rules. */
  readonly rows: number;
  /** Distinct `statement` strings. This is the count a sentence-level claim is about. */
  readonly sentences: number;
  /** Distinct `id` values. Reused across folds, so an id is a slot rather than a rule. */
  readonly slots: number;
  /** Distinct slots that at least one question's pack actually cited. */
  readonly cited: number;
};

/**
 * Count the pool four ways, because the numbers differ by a factor of the fold count.
 *
 * Every earlier round of this record described `1,066 committed rules`. There are 1,066 *rows*, and
 * they are 271 sentences over 229 id slots — an id is reused across folds and names an unrelated
 * rule in each, so it identifies a slot and not a statement — of which 220 slots are ever cited by
 * a question. A single run therefore carries about 210 rules, not 1,066, and a per-rule share
 * computed over the row count describes the pool rather than anything a model saw.
 */
export function rulePoolOf(
  items: readonly { readonly id: string; readonly statement: string }[],
  citedIds: ReadonlySet<string>,
): RulePool {
  const sentences = new Set<string>();
  const slots = new Set<string>();
  const citedSlots = new Set<string>();
  for (const item of items) {
    sentences.add(normalise(item.statement));
    slots.add(item.id);
    if (citedIds.has(item.id)) citedSlots.add(item.id);
  }
  return { rows: items.length, sentences: sentences.size, slots: slots.size, cited: citedSlots.size };
}

/** The distribution of forms over the distinct statements. */
export type FormCensus = {
  readonly markers: string;
  readonly n: number;
  readonly both: number;
  readonly procedural: number;
  readonly declarative: number;
  readonly unmarked: number;
  /** `both / n` — the share the axis has to stay under. */
  readonly bothShare: number;
  /** `(procedural + declarative) / n` — the share that can be put into a two-group comparison. */
  readonly pureShare: number;
};

export function censusOf(forms: readonly RuleForm[], markers: string): FormCensus {
  let both = 0;
  let procedural = 0;
  let declarative = 0;
  let unmarked = 0;
  for (const form of forms) {
    if (form === 'both') both += 1;
    else if (form === 'procedural') procedural += 1;
    else if (form === 'declarative') declarative += 1;
    else unmarked += 1;
  }
  const n = forms.length;
  return {
    markers,
    n,
    both,
    procedural,
    declarative,
    unmarked,
    bothShare: n === 0 ? 0 : both / n,
    pureShare: n === 0 ? 0 : (procedural + declarative) / n,
  };
}

/** What a question's pack is, once `both` and `unmarked` rules are dropped. */
export type PackForm = 'procedural' | 'declarative' | 'mixed' | 'none';

/**
 * The form of a whole pack, not of one rule.
 *
 * A pack holds several rules and they can disagree. `mixed` is its own bucket rather than being
 * assigned to whichever class is larger: assigning it would turn a tie into a vote, and the vote's
 * outcome would be decided by pack size rather than by the rules' form.
 */
export function packFormOf(ids: readonly string[], formById: ReadonlyMap<string, RuleForm>): PackForm {
  let procedural = false;
  let declarative = false;
  for (const id of ids) {
    const form = formById.get(id);
    if (form === 'procedural') procedural = true;
    else if (form === 'declarative') declarative = true;
    if (procedural && declarative) return 'mixed';
  }
  if (procedural) return 'procedural';
  if (declarative) return 'declarative';
  return 'none';
}

/** How the questions distribute over the four pack forms. */
export type FormCoverage = {
  readonly cases: number;
  readonly procedural: number;
  readonly declarative: number;
  readonly mixed: number;
  readonly none: number;
  /** `none / cases` — the share the axis cannot speak about at all. */
  readonly unclassifiedShare: number;
};

export function coverageOf(forms: readonly PackForm[]): FormCoverage {
  let procedural = 0;
  let declarative = 0;
  let mixed = 0;
  let none = 0;
  for (const form of forms) {
    if (form === 'procedural') procedural += 1;
    else if (form === 'declarative') declarative += 1;
    else if (form === 'mixed') mixed += 1;
    else none += 1;
  }
  const cases = forms.length;
  return {
    cases,
    procedural,
    declarative,
    mixed,
    none,
    unclassifiedShare: cases === 0 ? 0 : none / cases,
  };
}

/**
 * One resample of a group's delta, drawing whole databases rather than whole questions.
 *
 * The drawn databases are pooled and the delta taken over all their questions, which is what makes
 * the resample an estimate of the *same* quantity `cellOf` reports. Averaging the databases' own
 * means instead would weight a ten-question database like a hundred-question one and move the
 * interval away from a point estimate it is supposed to bracket — a version of this function did
 * exactly that and shifted the lower bound of a gap by 0.44pp.
 *
 * `Math.max(1, …)` rather than a guard: the caller returns on an empty group, so the division is
 * already safe, and a branch that cannot be taken is a branch nobody has tested.
 */
function resampleDelta(group: readonly DiffCase[], random: () => number): number {
  const byCluster = new Map<string, number[]>();
  for (const entry of group) {
    const bucket = byCluster.get(entry.dbId) ?? [];
    bucket.push((entry.correct ? 1 : 0) - (entry.withoutMemoryCorrect ? 1 : 0));
    byCluster.set(entry.dbId, bucket);
  }
  const groups = [...byCluster.values()];
  let total = 0;
  let count = 0;
  for (let draw = 0; draw < groups.length; draw += 1) {
    const bucket = groups[Math.floor(random() * groups.length)] as number[];
    for (const value of bucket) {
      total += value;
      count += 1;
    }
  }
  return total / Math.max(1, count);
}

/** The two-group contrast, with an interval on the difference rather than on either group. */
export type FormSplit = {
  readonly procedural: CellReading;
  readonly declarative: CellReading;
  /** How many databases each group draws from. A group drawn from one cannot vary. */
  readonly proceduralClusters: number;
  readonly declarativeClusters: number;
  /** `procedural.deltaPp - declarative.deltaPp`, in percentage points. */
  readonly gapPp: number | null;
  readonly gapLowPp: number | null;
  readonly gapHighPp: number | null;
  /** Whether the interval on the gap excludes zero *and* both groups had more than one database. */
  readonly resolved: boolean;
};

/** How many distinct databases a group spans. */
function clusterCountOf(group: readonly DiffCase[]): number {
  return new Set(group.map((entry) => entry.dbId)).size;
}

/**
 * The difference between the two forms, with the interval taken on the difference.
 *
 * The two groups are disjoint, so their intervals cannot be subtracted; asking whether one interval
 * covers the other's point estimate answers a different question and answers it too generously.
 * Each resample draws both groups independently from their own databases and keeps the difference,
 * which is the quantity the registration is about.
 *
 * A group with no questions returns a `null` gap rather than a zero: zero would read as "the two
 * forms do not differ", and the honest reading of one empty group is that they were not compared.
 *
 * **A group confined to one database resolves nothing, whatever its interval says.** The resample
 * draws databases, so a group with one database is redrawn as itself every time and its interval
 * collapses to a point — the gap then looks resolved because the uncertainty became invisible, not
 * because it went away. `resolved` therefore also requires two databases in each group, and the
 * counts are reported beside it so a reader can see which condition failed.
 */
export function formSplitOf(
  cases: readonly DiffCase[],
  formById: ReadonlyMap<string, RuleForm>,
  resamples = 10_000,
  seed = 20261101,
): FormSplit {
  const byForm = (want: PackForm): DiffCase[] =>
    cases.filter((entry) => packFormOf(entry.packIdList ?? [], formById) === want);
  const procedural = byForm('procedural');
  const declarative = byForm('declarative');
  const leftCell = cellOf(procedural, resamples);
  const rightCell = cellOf(declarative, resamples);
  const proceduralClusters = clusterCountOf(procedural);
  const declarativeClusters = clusterCountOf(declarative);
  if (leftCell.deltaPp === null || rightCell.deltaPp === null) {
    return {
      procedural: leftCell,
      declarative: rightCell,
      proceduralClusters,
      declarativeClusters,
      gapPp: null,
      gapLowPp: null,
      gapHighPp: null,
      resolved: false,
    };
  }
  const random = mulberry32(seed);
  const gaps: number[] = [];
  for (let i = 0; i < resamples; i += 1) {
    const left = resampleDelta(procedural, random);
    const right = resampleDelta(declarative, random);
    gaps.push(left - right);
  }
  gaps.sort((one, other) => one - other);
  const low = gaps[Math.floor(0.025 * (gaps.length - 1))] as number;
  const high = gaps[Math.floor(0.975 * (gaps.length - 1))] as number;
  const excludesZero = (low > 0 && high > 0) || (low < 0 && high < 0);
  return {
    procedural: leftCell,
    declarative: rightCell,
    proceduralClusters,
    declarativeClusters,
    gapPp: leftCell.deltaPp - rightCell.deltaPp,
    gapLowPp: low * 100,
    gapHighPp: high * 100,
    resolved: excludesZero && proceduralClusters > 1 && declarativeClusters > 1,
  };
}
