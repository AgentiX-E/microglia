/**
 * The parts of the S2 lane that are pure.
 *
 * The lane itself is a CLI (`bin/sota-bird.ts`): it downloads 764 MiB, opens
 * eleven SQLite databases, and spends a few thousand model calls. None of that is
 * testable in a unit suite, so everything that is *decidable* lives here instead —
 * how a reply is parsed, how a result set is canonicalised, what the prompt says,
 * which arms exist, and what each validity gate requires. The CLI composes these
 * with I/O.
 *
 * This split is not cosmetic. The first version kept all of it in the CLI, which
 * `vitest` excludes, so the prompt, the gate thresholds, and the arm parser had
 * no tests at all — a lane whose *decisions* were the least covered part of the
 * repository.
 */
import { comparePaired } from './stats.js';

/** Bumped whenever the prompt text changes; a result without it is unreproducible. */
export const PROMPT_VERSION = 'sql-prompt/3';

/**
 * A house convention the workspace can impose.
 *
 * Both members are transformations the *schema cannot reveal*: no column says
 * "divide by a thousand" and none says "round to ten". That is the property every
 * measurement in this repository that moved accuracy has in common, and it is why
 * these, rather than a random style preference, are the convention candidates.
 */
export type ConventionSpec = {
  /** What the workspace says it accepts, in one sentence. */
  readonly sentence: string;
  /** The value the workspace would report for a raw answer. */
  readonly transform: (value: number) => number;
  /** The gold query rewritten to report the way the workspace reports. */
  readonly sql: (body: string) => string;
  /**
   * Whether the convention is defined for this raw value.
   *
   * Deliberately total. An earlier `thousands` restricted itself to values of at
   * least a thousand, which reads sensible and is wrong for the experiment: the
   * protocol defines its subset as "gold is one row with one numeric column", and
   * the extra filter cut the qualifying set below the floor the protocol needs,
   * so the lane refused to run at all. A convention that reports in thousands is
   * defined for 5 (0.005) as much as for 5,000,000.
   */
  readonly applies: (value: number) => boolean;
};

export const HOUSE_CONVENTIONS = {
  thousands: {
    sentence: 'This workspace reports numeric answers in thousands, rounded to three decimals.',
    transform: (value: number): number => Math.round((value / 1000) * 1000) / 1000,
    sql: (body: string): string => `SELECT ROUND((${body}) / 1000.0, 3)`,
    applies: (): boolean => true,
  },
  round10: {
    sentence: 'This workspace reports every numeric answer rounded to the nearest ten.',
    transform: (value: number): number => Math.round(value / 10) * 10,
    sql: (body: string): string => `SELECT ROUND((${body}) / 10.0) * 10`,
    applies: (): boolean => true,
  },
} as const satisfies Record<string, ConventionSpec>;

export type ConventionName = keyof typeof HOUSE_CONVENTIONS;

/** The named convention, or undefined for the ordinary execution-accuracy lane. */
export function conventionOf(name: string): ConventionName | undefined {
  const trimmed = name.trim();
  if (trimmed === '') return undefined;
  if (!Object.hasOwn(HOUSE_CONVENTIONS, trimmed)) return undefined;
  return trimmed as ConventionName;
}

/** The convention's judgement on a numeric answer, at the stated precision. */
export function judgeScalar(value: number | undefined, expected: number | undefined): boolean {
  if (value === undefined || expected === undefined) return false;
  return Math.abs(value - expected) < 1e-6;
}

/** The correction a user would make: the same query, reported the way the workspace reports. */
export function reportedSql(sql: string, spec: ConventionSpec | undefined): string {
  if (spec === undefined) return sql;
  const body = sql.replace(/;\s*$/, '').trim();
  return spec.sql(body);
}

/**
 * Pull one statement out of a model reply.
 *
 * A fence is authoritative when present. Without one, the first line that starts a
 * statement is used, after leading `--` and block comments are stripped: a model
 * that prefixes a comment has still answered, and treating that as a parse failure
 * would understate the arm.
 */
export function extractSql(raw: string): string | undefined {
  const fenced = /```(?:sql)?\s*([\s\S]*?)```/i.exec(raw);
  const body = (fenced?.[1] ?? raw).trim();
  if (body === '') return undefined;
  const stripped = body.replace(/^(?:\s*(?:--[^\n]*\n|\/\*[\s\S]*?\*\/))*\s*/, '');
  const fromStart = /^(select|with)\b[\s\S]*/i.exec(stripped)?.[0];
  const fromLine = /(?:^|\n)\s*((?:select|with)\b[\s\S]*)/i.exec(stripped)?.[1];
  const statement = fromStart ?? fromLine;
  return statement?.replace(/;[\s\n]*$/, '').trim();
}

/**
 * A result set as a comparable sequence, sorted so row order does not matter.
 *
 * Values are serialised as JSON rather than joined with a separator: a string that
 * contains the separator would otherwise make two different answers look the same.
 * Floats are rounded to six decimals so a difference in the last bit of a division
 * does not read as a wrong answer.
 */
export function canonicalRows(rows: readonly Record<string, unknown>[]): string[] {
  return rows
    .map((row) =>
      JSON.stringify(
        Object.keys(row)
          .sort()
          .map((key) => {
            const value = row[key];
            if (typeof value === 'number') {
              return Number.isInteger(value) ? value : Number(value.toFixed(6));
            }
            return value === null || value === undefined ? null : String(value);
          }),
      ),
    )
    .sort();
}

/**
 * How two result sets are compared.
 *
 * The distinction is not academic: on ROSE-VEC's 322 adjudicated predictions the two
 * readings of the same execution disagree on **52 items (16.1%)**, and the multiset
 * reading calls 129 correct predictions wrong where the set reading calls 87. `set`
 * collapses duplicate rows, so a query that returns the right values a different number
 * of times passes; `multiset` keeps them, so it fails. Neither is "the" execution
 * accuracy — BIRD's official scorer is the multiset reading, ROSE's published baseline
 * is the set reading — which is why the name has to travel with the number.
 */
export type ResultComparison = 'multiset' | 'set';

/**
 * BIRD answers are compared as unordered multisets by default, the standard EX metric.
 *
 * `set` is offered because it is the definition under which a criterion agrees with
 * expert adjudication most closely (kappa 0.4717 against 0.2995 on ROSE-VEC), and a lane
 * that can only produce one of the two cannot tell whether a delta came from the arms or
 * from the criterion.
 */
export function matches(
  predicted: readonly string[],
  gold: readonly string[],
  comparison: ResultComparison = 'multiset',
): boolean {
  if (comparison === 'set') {
    const left = new Set(predicted);
    const right = new Set(gold);
    if (left.size !== right.size) return false;
    for (const value of left) if (!right.has(value)) return false;
    return true;
  }
  if (predicted.length !== gold.length) return false;
  for (const [index, value] of gold.entries()) {
    if (predicted[index] !== value) return false;
  }
  return true;
}

export type SqlArm =
  | 'none'
  | 'full'
  /** The same corrections, distilled without scope widening: an arm, not a dispatch. */
  | 'full-narrow'
  /**
   * The same items as `full`, rendered without their applicability condition.
   *
   * The shape ablation. Iteration 62 measured that the retriever cannot tell a
   * harmful rule from a helpful one (median cosine 0.232 against 0.228, p = 0.86),
   * so what a rule says about *when* it applies became the candidate explanation.
   * `full` renders that condition in front of the claim; `full-plain` renders the
   * same ids with the plain note. Both are scored against the same `none` arm on
   * the same questions, so the difference is one field of text rather than the
   * run-to-run noise of two dispatches.
   */
  | 'full-plain'
  /**
   * Only rules corroborated by at least two independent corrections.
   *
   * Every harmful rule in iterations 61-63 was activated by a *single* observation, and
   * the store has always recorded how many observations a claim has - the pack has
   * simply never filtered on it. This arm does, because it is the one quality axis that
   * is measured rather than inferred: no text, no similarity, no model judgement, just
   * the count of independent corrections behind the rule.
   *
   * Deliberately not a pack control for V6: an empty pack at this threshold is a
   * legitimate result ("nothing in this corpus was corroborated twice"), not a broken
   * control, and failing the run on it would prevent publishing the finding.
   */
  | 'full-corroborated'
  /**
   * The same pack, moved after the question.
   *
   * `full` renders schema, evidence, pack, question. Every result this project has published
   * was produced under that order, and the order was never a variable. Recency is the one
   * position effect with a consistent sign in the literature, and it costs one arm to find
   * out whether the 2–5pp is partly an artefact of putting the rule before the question.
   * It also gives `full-anchored` a control with the same order, so the anchoring test is
   * one difference rather than two.
   */
  | 'full-late'
  /**
   * The pack as an objection to the model's own draft, in a second call.
   *
   * The failure being attacked is imitation: a retrieved record shapes the answer before the
   * question has been read. A model cannot be instructed out of that (ICML 2025 measures every
   * natural-language intervention failing), but it can be given its own answer to imitate
   * instead. Costs two calls per question — the draft and the revision — and reports the
   * revision, which is the answer the arm is claiming.
   */
  | 'full-anchored'
  /**
   * The pack restricted to rules whose statement names a table or column of this database.
   *
   * Across 1,320 rules distilled from BIRD, 77% name nothing in the schema: they are prose
   * about meaning that a reader cannot check against the catalogue. Of the 21.5% that do name
   * a table, 77% name one the question's own answer uses. This arm asks whether *checkable*
   * rules behave differently from the pack as a whole — which is the content half of "the
   * memory is wrong", as opposed to the selection half every earlier arm attacked.
   */
  | 'full-grounded'
  /**
   * The pack is never shown before the first answer, only after a failure.
   *
   * Every arm so far puts guidance in front of the question, and iteration 80 measured what
   * that costs: about 1.7pp per rule injected, independent of what the rules say. This arm
   * follows the shape of a real correction loop instead — answer, notice the answer did not
   * work, retry with the experience in hand — so the pack is spent only on the questions that
   * failed, and only when there is something to explain.
   *
   * The failure signal is the only one available without the answer key: the query does not
   * execute, or it executes and returns nothing. That is what a deployed system can see.
   */
  | 'full-onretry'
  /**
   * The same corrections, distilled into an account of the failure instead of a rule.
   *
   * Every memory this project has measured stores a declarative rule: "questions that name
   * a race join results to races on raceId". The literature that reports gains stores
   * something else. ExpeL (arXiv 2308.10144) extracts insights by *comparing* failed and
   * successful attempts, and ReasoningBank (arXiv 2509.25140) reports that failure-derived
   * memories are where the guardrails come from. A rule says what is true; a repair says
   * what went wrong, why, what fixed it, and when that fix generalises.
   *
   * The pair exists in this lane already and has never been used as content: `output` is
   * the first attempt, `signal.after` is the correction, and the lane now also records how
   * the two results differed. This arm feeds exactly that pair to a distiller asked for a
   * contrastive account. Same timing as `full`, so the difference is the content.
   */
  | 'full-repair'
  /**
   * The repair account, spent only on a failed first answer.
   *
   * The content half and the timing half of the same hypothesis, together: if a repair
   * note is what a retry loop can act on, this is the arm that should beat both of its
   * parents. If it does not, the two effects are not additive and the interaction is the
   * finding.
   */
  | 'full-repair-onretry'
  /**
   * The retry, with no memory at all.
   *
   * The control that makes `full-onretry` readable. That arm's +1.14pp was measured
   * against `none`, and a second attempt — even a blind one — is itself a treatment: the
   * model sees its own failed query and a failure message it did not have before. Without
   * this arm the difference between "retrying helps" and "the memory helps a retry" is
   * unmeasurable, and the first published version of the retry result could not tell them
   * apart.
   */
  | 'retry-blank'
  /**
   * The same number of rules, chosen at random from the same pack.
   *
   * Without it, `full-grounded` differs from `full` in two things at once: which rules and how
   * many. Iteration 66 found no dose response, but a null there does not license a two-variable
   * experiment here — the control is one arm and it makes the comparison single.
   */
  | 'full-sampled'
  /**
   * The anchored arm, with the conservative default replaced by the condition check.
   *
   * Iteration 78's anchored arm recovered the pack's 4pp loss and gained almost nothing
   * (2 and 6 questions against `full`'s 10 and 11), because "change only what it justifies"
   * gives a wrong draft every benefit of the doubt. This arm keeps the order, the block and
   * the second call, and asks the model to apply an item whose `when` condition holds even
   * where the draft disagrees — the one part of a rule that speaks about this question
   * rather than about the question that taught it.
   */
  | 'full-anchored-conditional'
  /**
   * The same pack after utility-based deletion.
   *
   * Xiong et al. (arXiv 2505.16067) report that a retrieved record is followed closely
   * enough to propagate its error, and that deleting by observed utility beats deleting
   * by age: selective addition plus history-based deletion recovers about 10 points over
   * naive growth. The arm runs the pack over the fold's learn rows, credits a rule with a
   * failure when the answer it was injected into was wrong, and retires the rules so
   * credited before any held-out question is scored.
   */
  | 'full-validated'
  /**
   * The same pack, with the model asked to *decide* applicability before answering.
   *
   * Iterations 63 and 64 showed that a rule can carry its condition and that the model
   * reads it, and that the answer still does not change for the better. What no arm has
   * tested is the difference between reading a condition and being required to return a
   * decision about it: MemHarness's critique step, where the model states whether a
   * memory applies before it is allowed to use it. One extra instruction, no extra call,
   * so the comparison with `full` isolates the requirement rather than the protocol.
   */
  | 'critique'
  | 'gated'
  | 'duplicate'
  | 'wrong-scope'
  | 'stated'
  | 'oracle'
  /**
   * The same pack, cut to a measured number of characters.
   *
   * Every arm so far varied either which claims were injected or how many. The one quantity that
   * has moved with accuracy in every comparison is the *size of the block*: one rule of about
   * 250 characters and one repair note of about 450 both cost accuracy, and 1.86 short rules
   * cost more than 1.00 long ones by about the same margin. These arms make that the independent
   * variable: same store, same retrieval, same question, a character budget the pack layer
   * enforces. `full` is the 1,200-character point.
   */
  | 'chars-150'
  | 'chars-300'
  | 'chars-600'
  | 'chars-900'
  /**
   * The no-memory arm, asked twice.
   *
   * The prompt is byte-identical to `none`, so every difference between the two is noise: the
   * provider is not deterministic at temperature 0, and this lane has been reporting effects
   * smaller than that difference. Measured on the dose run that motivated the arm: 4 questions
   * gained and 1 lost, +0.86pp, between two identical prompts — larger than the "memory helps a
   * retry" effect this project reported three times.
   *
   * An arm that measures the instrument rather than the treatment. It costs one call per
   * question and it is the only honest way to say whether a difference of one question means
   * anything.
   */
  | 'none-replica'
  /**
   * The pack restricted to rules that name something the *question* names.
   *
   * The relevance audit found that 210 of 350 packs named nothing the answer uses, and that the
   * 140 which did scored 43.6% against a 53.4% baseline: a rule sharing vocabulary with the
   * answer is followed, not weighed. The obvious repair is to keep only rules that share
   * vocabulary with the *question* — the entities the user actually said — and to inject nothing
   * when none does. It is the same store, the same recall and one filter, and it is the arm the
   * audit says should be tried before any claim about retrieval is made.
   */
  | 'full-asked'
  /**
   * The same corrections, stated as procedures with no case in them.
   *
   * The relevance audit's conclusion is that the nouns are the problem: a pack that names an
   * entity of the answer is followed and costs 2.6-2.8pp, a pack that names nothing is ignored and
   * costs nothing, and the longer the explanation the larger the loss. So the next form removes
   * the nouns: "when a question counts entities across a one-to-many join, aggregate after
   * filtering, because the join multiplies rows" has no table in it, nothing for the model to map
   * onto this question, and nothing to reproduce.
   *
   * This is the shape ExpeL's insights and ReasoningBank's strategies take, and the one form this
   * project has never tried. Enforced, not requested: the lane's `accept` filter refuses any
   * candidate naming a table or column of the database it was learned from.
   */
  | 'full-procedural'
  /**
   * The procedural pack, cut to one item's worth of characters.
   *
   * The case-bearing pack has a measured dose: nothing under one item, 3.1pp at one item, the same
   * at two. The procedural pack has one point — 1.76 items, 1,064 characters, +0.86pp — and one
   * point cannot separate "procedures are cheap" from "procedures are cheap at this size". At 600
   * characters the pack carries one procedure where it carried two.
   */
  | 'chars-proc-600'
  /**
   * The retry, retrieving the procedure by the *failure* rather than by the question.
   *
   * Every retrievable note in this project is found by comparing it to the question, and the
   * question does not say what failed. A note learned from "it returned nothing" is stored with
   * `scope.reasonCode = no-rows`, and at retry the same classifier runs on the failure the database
   * just produced, so the recall key is the failure instead of the topic.
   *
   * This is the arm the three misgivings about this memory design converge on: the content is a
   * procedure (no case to imitate), the moment is after a failure (no first impression to displace),
   * and the key is the thing that actually varies (what went wrong).
   */
  | 'retry-keyed'
  /**
   * Three draws at a non-zero temperature, chosen by the largest agreeing group.
   *
   * The axis this project never varied. Every memory arm and every baseline has been one draw at
   * temperature 0, and the noise floor measured with an identical prompt (`none-replica`, 3-6
   * discordant questions) is the same size as every effect reported so far. Selection among several
   * draws is what the systems above 70% on the leaderboards do — CHASE-SQL with a selection model,
   * XiYan-SQL by voting — and it is measurable on this protocol for the cost of the extra draws.
   *
   * Three rather than five first, because the prefix of a five-draw sample *is* a three-draw sample:
   * one pass of five supplies both arms, so the curve over the number of draws costs nothing extra.
   */
  | 'sample-3'
  /** Five draws, largest agreeing group. The other end of the same pass. */
  | 'sample-5'
  /**
   * The same five draws, and the first one.
   *
   * The control that separates temperature from selection. Without it, any difference between
   * `sample-5` and `none` is attributable to either.
   */
  | 'sample-5-first'
  /**
   * The same five draws, one of them at random.
   *
   * The second control, and the harder one to argue with: a finite sample of a distribution contains
   * a better draw than its first element more often than chance, so "more candidates help" and "the
   * selector helps" produce the same sign. Only this arm says which.
   */
  | 'sample-5-random'
  /**
   * The best a selector could have done on the same five draws.
   *
   * Reads the answer key and is not deployable. It exists because the two failures it separates are
   * confused constantly: "the candidates were there and the choice was wrong" and "the candidates
   * were never there" call for opposite work. CHASE-SQL reports that gap as 14 points on BIRD
   * (self-consistency 68.84, upper bound 82.79), which is the largest quantity in their table and
   * the reason they built a selection model at all.
   *
   * Costs no calls: every draw is scored anyway so the chosen one can be measured.
   */
  | 'sample-5-oracle';

/**
 * Every optional arm, as a table keyed by the union itself.
 *
 * A plain array would let a new `SqlArm` variant exist without a string to select it —
 * which is exactly what happened: `full-validated` was added to a lane's local copy of
 * the union, the lane's `ARMS.has('full-validated')` compiled, and `parseArms` rejected
 * the name at runtime. A `Record` over the union makes the omission a compile error, and
 * deriving the array from it means the two cannot drift again.
 */
const OPTIONAL_ARM_TABLE: Record<Exclude<SqlArm, 'none' | 'full'>, true> = {
  'full-narrow': true,
  'full-plain': true,
  'full-corroborated': true,
  'full-grounded': true,
  'full-sampled': true,
  'full-onretry': true,
  'full-repair': true,
  'full-repair-onretry': true,
  'retry-blank': true,
  'full-late': true,
  'full-anchored': true,
  'full-anchored-conditional': true,
  'full-validated': true,
  critique: true,
  gated: true,
  duplicate: true,
  'wrong-scope': true,
  stated: true,
  oracle: true,
  'chars-150': true,
  'chars-300': true,
  'chars-600': true,
  'chars-900': true,
  'none-replica': true,
  'full-asked': true,
  'full-procedural': true,
  'chars-proc-600': true,
  'retry-keyed': true,
  'sample-3': true,
  'sample-5': true,
  'sample-5-first': true,
  'sample-5-random': true,
  'sample-5-oracle': true,
};

export const OPTIONAL_ARMS: readonly Exclude<SqlArm, 'none' | 'full'>[] = Object.keys(
  OPTIONAL_ARM_TABLE,
) as readonly Exclude<SqlArm, 'none' | 'full'>[];

/**
 * Parse `SOTA_ARMS`.
 *
 * `none` and `full` are not optional: they are the comparison the whole lane
 * exists to make, so a caller cannot switch them off by omission.
 */
export function parseArms(raw: string | undefined): Set<SqlArm> {
  const wanted = new Set<SqlArm>(['none', 'full']);
  for (const name of (raw ?? OPTIONAL_ARMS.join(',')).split(',')) {
    const trimmed = name.trim();
    if (trimmed === '') continue;
    // `none` and `full` are always measured, and saying so explicitly is the natural way to write
    // an arm list: a dispatch that named them was rejected as "Unknown arm 'full'" after the job
    // had already installed, built and restored its cache. Redundant is not wrong, and a parser
    // that refuses the obvious invocation is a parser that will be worked around.
    if (trimmed === 'none' || trimmed === 'full') continue;
    if (!(OPTIONAL_ARMS as readonly string[]).includes(trimmed)) {
      throw new RangeError(`Unknown arm '${trimmed}'; known arms are ${OPTIONAL_ARMS.join(', ')}`);
    }
    wanted.add(trimmed as Exclude<SqlArm, 'none' | 'full'>);
  }
  return wanted;
}

/**
 * One control arm, compared to `full` on the questions both answered.
 *
 * Every arm in this lane was previously described by its delta against `none`, and
 * the difference between two arms was read as the difference of two deltas. That
 * point estimate is exact - both are measured on the same questions against the same
 * baseline - but its interval was not: two intervals against a shared baseline say
 * nothing about the difference between the arms, and this project has already
 * published one comparison that was wrong by a factor of two for exactly that
 * reason. Pairing the arms directly gives the difference an interval and a p-value.
 */
export type ArmPair = {
  readonly arm: string;
  /** `arm - full`, in percentage points; negative means the arm did worse. */
  readonly deltaPp: number;
  readonly ciLowPp: number;
  readonly ciHighPp: number;
  readonly p: number;
  readonly n: number;
  /** Questions `full` got right and this arm got wrong. */
  readonly lost: number;
  /** Questions this arm got right and `full` got wrong. */
  readonly gained: number;
};

export type ArmRow = {
  readonly full: boolean;
  readonly arms: Readonly<Record<string, boolean | undefined>>;
};

/**
 * Every optional arm present in the rows, paired against `full`.
 *
 * Only questions where the arm actually answered are paired: an arm that was not
 * configured for a case has no outcome, and treating its absence as a failure would
 * invent one.
 */
export function armPairsAgainstFull(
  rows: readonly ArmRow[],
  seed = 7,
  resamples = 10_000,
): readonly ArmPair[] {
  const names = new Set<string>();
  for (const row of rows) {
    for (const [name, value] of Object.entries(row.arms)) {
      if (value !== undefined) names.add(name);
    }
  }
  const pairs: ArmPair[] = [];
  for (const name of [...names].sort()) {
    // No guard for the empty case: `names` was built from the rows themselves and only from
    // entries whose value is defined, so every name here has at least one row. The guard
    // that used to sit on this line could not be reached, and an unreachable branch in a
    // comparison function is a branch nobody has ever exercised.
    const scored = rows.filter((row) => row.arms[name] !== undefined);
    const comparison = comparePaired(
      scored.map((row) => row.full),
      scored.map((row) => row.arms[name] === true),
      seed,
      resamples,
    );
    pairs.push({
      arm: name,
      deltaPp: comparison.delta * 100,
      ciLowPp: comparison.deltaCI.low * 100,
      ciHighPp: comparison.deltaCI.high * 100,
      p: comparison.p,
      n: comparison.n,
      lost: comparison.lost,
      gained: comparison.gained,
    });
  }
  return pairs;
}

/**
 * The two things a pack can contain.
 *
 * `rule` is a declarative claim about the workspace; `repair` is an account of one
 * failure — what the attempt did, why it was wrong, what fixed it. The distinction is the
 * content half of the experiment, so it is a type rather than a convention: a lane that
 * grows a third form has to name it here and say which label it renders under.
 */
export type PackKind = 'rule' | 'repair';

const PACK_LABEL: Record<PackKind, string> = {
  rule: 'Workspace conventions learned from earlier corrections:',
  repair: 'Repairs of earlier failures, each with the reason it was wrong and the change that fixed it:',
};

export type PromptInput = {
  readonly question: string;
  readonly evidence: string;
  readonly ddl: string;
  /** The rendered pack, or '' when the arm injects nothing. */
  readonly pack: string;
  /** Whether the arm states the workspace convention explicitly. */
  readonly stated: boolean;
  readonly convention: ConventionSpec | undefined;
  /**
   * Whether the prompt requires an applicability decision per item before the query.
   *
   * A requirement, not a suggestion: the instruction names the output shape and says
   * the query may only use the items marked `apply`. Asking the model to *remember* a
   * condition is what the `when` field already does; asking it to *return* one is a
   * different task, and the difference is what this arm measures.
   */
  readonly critique?: boolean;
  /**
   * What the block is, in the prompt's own words.
   *
   * A repair note and a rule are different objects, and calling a repair note a
   * "convention" would ask the reader to apply a story about a failure as if it were a
   * fact about the workspace. The default is the rule wording, unchanged, because every
   * published number was produced with it and a silent re-wording would move the baseline
   * under the comparison.
   */
  readonly packKind?: PackKind;
  /**
   * Where the pack sits relative to the question.
   *
   * `before` is what every published number was produced under: schema, evidence, pack,
   * then the question. `after` puts the question first and the pack last, which is the
   * only change in the `full-late` arm and exists so that the anchoring arm has a control
   * with the same order. Position is a confound that costs one line to hold fixed and a
   * whole iteration to discover afterwards.
   */
  readonly packPosition?: 'before' | 'after';
};

export function promptFor(input: PromptInput): string {
  const packBlock =
    input.pack === '' ? '' : `${PACK_LABEL[input.packKind ?? 'rule']}\n${input.pack}`;
  const critiqueBlock =
    input.pack === '' || input.critique !== true
      ? ''
      : 'Before writing the query, decide for each item in that block whether it applies to this question. ' +
        'Write one line per item, in the form `<id>: apply` or `<id>: skip`, followed by one clause of reasoning. ' +
        'Then write the query, and use only the items you marked apply.';
  const question = `Question: ${input.question}`;
  const before = input.packPosition !== 'after';
  return [
    'You write one SQLite query that answers the question exactly.',
    'Return the SQL only, in a ```sql fence, with no explanation.',
    'Use only the tables and columns in the schema. Prefer explicit JOINs. Do not invent columns.',
    `Schema:\n${input.ddl}`,
    input.evidence ? `Evidence (may be wrong; it is external knowledge):\n${input.evidence}` : '',
    input.stated && input.convention !== undefined ? `Workspace convention:\n- ${input.convention.sentence}` : '',
    ...(before ? [packBlock] : [question, packBlock]),
    critiqueBlock,
    ...(before ? [question] : []),
  ]
    .filter((line) => line !== '')
    .join('\n\n');
}

/**
 * The generated SQL for a question, remembered across folds.
 *
 * Cross-fitting evaluates every question exactly once, but *learns* from the other
 * k−1 folds — so the same question's learning-pass generation is requested once
 * per fold it appears in, four times at k=5. Those requests are identical: the
 * prompt is built from the question, its evidence, and the schema, none of which a
 * memory can change, and the call is made at temperature 0. Asking four times pays
 * four times for one answer and, if the endpoint is flaky, turns one failure into
 * four identical failures.
 *
 * The cache is therefore a *deduplication of identical work*, not a shortcut: it
 * is keyed by the question id, it stores the reply text before parsing, and a
 * failure is stored as a failure so the retry policy is not silently re-run in a
 * later fold.
 */
export class GenerationCache {
  private readonly entries = new Map<string, string>();
  private hits = 0;
  private misses = 0;

  public has(key: string): boolean {
    return this.entries.has(key);
  }

  public get(key: string): string | undefined {
    return this.entries.get(key);
  }

  public set(key: string, reply: string): void {
    this.entries.set(key, reply);
  }

  /** A hit is a call not made; the counts travel with the artefact. */
  public count(hit: boolean): void {
    if (hit) this.hits += 1;
    else this.misses += 1;
  }

  public get stats(): { readonly hits: number; readonly misses: number; readonly size: number } {
    return { hits: this.hits, misses: this.misses, size: this.entries.size };
  }
}

export type ValidityGate = {
  readonly id: string;
  readonly criterion: string;
  readonly actual: string;
  readonly pass: boolean;
  readonly blocking: boolean;
};

export type GateInput = {
  /** Mean rules injected per question on the memory arm. */
  readonly meanPackIds: number;
  readonly partition: {
    readonly evaluated: number;
    readonly total: number;
    readonly duplicated: number;
    readonly leaked: number;
  };
  readonly parseRate: number;
  readonly goldExecRate: number;
  /** Smallest effect the sample could resolve at 80% power, in percentage points. */
  readonly detectablePp: number;
  readonly packControls: readonly { readonly arm: string; readonly meanPackIds: number }[];
  readonly channelBest: { readonly arm: string; readonly deltaPp: number } | undefined;
  /** Share of calls that failed after exhausting retries, in [0, 1]. */
  readonly callFailureRate: number;
  readonly calls: number;
  readonly callFailures: number;
  /**
   * Present only when the run teaches a house convention.
   *
   * The S2b protocol fixes a floor before the result is read: below a hundred
   * qualifying questions the run is a direction, not a verdict, and the verdict
   * gate is not applied. Making the floor a gate that is *recorded* rather than a
   * silent `if` is what stops "we ran it anyway" from becoming "we found".
   */
  readonly subset?: { readonly qualifying: number; readonly minimum: number };
  /**
   * Share of qualifying questions whose gold query, rewritten to report the way
   * the workspace reports, produces the expected value.
   *
   * This is the convention lane's counterpart to `goldExecRate`: without it, a
   * scoring bug and a model that cannot follow the convention look identical, and
   * both look like "the mechanism does not work".
   */
  readonly conventionExecRate?: number;
  /**
   * How many injected rules carried an applicability condition.
   *
   * The shape experiment's validity condition. `full` and `full-plain` differ only
   * in that field, so a run in which the distiller produced no condition has two
   * identical arms and a delta of zero that means nothing. Recording it as a gate
   * makes "the model declined to say when" visible instead of indistinguishable
   * from "the condition does not help".
   */
  readonly packConditions?: { readonly injected: number; readonly withCondition: number };
  /**
   * Absolute accuracy of the strongest channel control, when the protocol names a
   * ceiling for it.
   *
   * The S2b protocol requires the oracle arm to reach 90%: an oracle that cannot
   * make the model produce the accepted answer at all means the lane is measuring
   * the model's output format, not its use of knowledge. V7 asks whether the
   * channel *responds*; this asks whether it is *usable*, and both have to hold.
   */
  readonly channelCeiling?: number;
};

/**
 * The instrument-validity gates.
 *
 * These do not ask whether the mechanism worked. They ask whether the run can
 * support *any* claim: the pack was non-empty, the split was a partition, the
 * model answered, the dataset executed, the controls injected something, the
 * channel works, and the endpoint answered reliably enough for the outcome to be
 * about knowledge rather than about an outage.
 *
 * V5 is advisory on purpose: a sample that cannot resolve a 6pp effect still
 * reports what it saw, and refusing to publish it would encourage exactly the
 * sample-size shopping the gate exists to prevent.
 */
export function buildValidityGates(input: GateInput): ValidityGate[] {
  const gates: ValidityGate[] = [
    {
      id: 'V1-pack-not-empty',
      criterion: 'the memory arm injected at least one rule per question on average',
      actual: `${input.meanPackIds.toFixed(2)} rules/question`,
      pass: input.meanPackIds > 0,
      blocking: true,
    },
    {
      id: 'V2-fold-partition',
      criterion: 'every question is evaluated exactly once, by a memory that never learned from it',
      actual:
        `${input.partition.evaluated}/${input.partition.total} questions, ` +
        `${input.partition.duplicated} duplicates, ${input.partition.leaked} leaks`,
      pass:
        input.partition.duplicated === 0 &&
        input.partition.leaked === 0 &&
        input.partition.evaluated === input.partition.total,
      blocking: true,
    },
    {
      id: 'V3-parse-rate',
      criterion: 'at least 90% of replies contain a statement',
      actual: `${(input.parseRate * 100).toFixed(2)}%`,
      pass: input.parseRate >= 0.9,
      blocking: true,
    },
    {
      id: 'V4-gold-executable',
      criterion: 'at least 99% of gold queries execute, or the dataset is not usable',
      actual: `${(input.goldExecRate * 100).toFixed(2)}%`,
      pass: input.goldExecRate >= 0.99,
      blocking: true,
    },
    {
      id: 'V5-resolution',
      criterion: 'the sample can resolve a 6pp effect at 80% power',
      // A sample in which no question changed hands has no variance to estimate, so
      // the minimum detectable difference is not large — it does not exist. Printing
      // "Infinitypp" reads like a bug in the arithmetic; saying what it means is the
      // same failure with an explanation attached.
      actual: Number.isFinite(input.detectablePp)
        ? `minimum detectable ${input.detectablePp.toFixed(2)}pp`
        : 'not estimable: no question changed hands',
      pass: Number.isFinite(input.detectablePp) && input.detectablePp <= 6,
      blocking: false,
    },
    {
      id: 'V6-controls-inject',
      criterion: 'every pack-based control arm injected at least one rule on average',
      actual:
        input.packControls
          .map((entry) => `${entry.arm}: ${entry.meanPackIds.toFixed(2)} rules/question`)
          .join(', ') || 'no pack-based controls configured',
      pass: input.packControls.every((entry) => entry.meanPackIds > 0),
      blocking: true,
    },
    {
      id: 'V7-channel',
      criterion: 'a stated control moves accuracy by at least 10pp',
      actual:
        input.channelBest === undefined
          ? 'no channel control was run'
          : `${input.channelBest.deltaPp.toFixed(2)}pp with the ${input.channelBest.arm} control`,
      pass: input.channelBest === undefined ? true : input.channelBest.deltaPp >= 10,
      blocking: true,
    },
    {
      id: 'V8-call-reliability',
      criterion: 'at most 2% of calls failed after retries, so the outcome is about knowledge',
      actual: `${(input.callFailureRate * 100).toFixed(2)}% (${input.callFailures}/${input.calls} calls)`,
      pass: input.callFailureRate <= 0.02,
      blocking: true,
    },
  ];
  if (input.packConditions !== undefined) {
    const { injected, withCondition } = input.packConditions;
    const share = injected === 0 ? 0 : withCondition / injected;
    gates.push({
      id: 'V12-shape-present',
      criterion: 'at least 50% of injected rules state when they apply, or the two shapes are the same pack',
      actual: `${withCondition}/${injected} injected rule(s) carried a condition (${(share * 100).toFixed(1)}%)`,
      pass: share >= 0.5,
      blocking: false,
    });
  }
  if (input.subset !== undefined) {
    gates.push({
      id: 'V9-subset-size',
      criterion: `at least ${input.subset.minimum} qualifying questions, or the result is a direction rather than a verdict`,
      actual: `${input.subset.qualifying} qualifying question(s)`,
      pass: input.subset.qualifying >= input.subset.minimum,
      blocking: false,
    });
  }
  if (input.channelCeiling !== undefined) {
    gates.push({
      id: 'V11-channel-ceiling',
      criterion: 'the strongest channel control reaches 90% accuracy, or the lane cannot express its answer',
      actual: `${(input.channelCeiling * 100).toFixed(2)}%`,
      pass: input.channelCeiling >= 0.9,
      blocking: true,
    });
  }
  if (input.conventionExecRate !== undefined) {
    gates.push({
      id: 'V10-convention-executable',
      criterion: 'at least 99% of rewritten gold queries report the value the convention expects',
      actual: `${(input.conventionExecRate * 100).toFixed(2)}%`,
      pass: input.conventionExecRate >= 0.99,
      blocking: true,
    });
  }
  return gates;
}

/**
 * The second-call prompt: the model audits its own draft against the pack.
 *
 * Why this arm exists at all. Injecting a retrieved rule into a cold prompt costs 2–5pp on
 * BIRD (iterations 71–76), and the loss survives every explanation tried: the criterion, the
 * ranking, the shape, the dose, the scope, a required decision, corroboration, and retiring
 * a third of the store. Two papers say why the survival is expected. Xiong et al.
 * (arXiv 2505.16067) describe *experience-following*: a similar input produces a similar
 * output because the model imitates the retrieved record rather than reasoning from the
 * question. "Unable to Forget" (ICML 2025) measures interference as a causal variable
 * independent of context length, and finds that every natural-language intervention —
 * including "ignore the irrelevant history" and chain-of-thought — fails to remove it.
 *
 * A model that imitates the rule cannot be talked out of imitating it, but it can be given
 * something else to imitate: its own answer. Asking for the query first and the rule second
 * makes the rule an objection to a draft rather than a template for one. That is a
 * structural difference, which is the only kind the interference result leaves room for.
 *
 * The framing is deliberately permissive. "Change only what a rule justifies, and return the
 * draft unchanged if none applies" makes doing nothing the default, because the measured
 * failure is not a model that ignores good rules — it is a model that follows bad ones.
 */
export type AnchorInput = {
  readonly question: string;
  readonly evidence: string;
  readonly ddl: string;
  /** The model's own answer without any pack. Empty when that call failed. */
  readonly draft: string;
  readonly pack: string;
};

/**
 * How firmly the revision should act on a convention it is shown.
 *
 * `conservative` makes "unchanged" the default and gives the model no reason to touch a
 * draft it already produced, which is what recovered the 4pp loss in iteration 78 — and
 * what forfeited the 10 questions where a rule would have fixed a wrong draft.
 *
 * `conditional` keeps the same order and the same block, and changes one sentence: an item
 * whose `when` condition holds for the question is to be applied even where the draft
 * disagrees. The condition is the only part of a rule that speaks about *this* question
 * rather than about the question that taught it, so it is the only basis on which a
 * revision can be asked to act against its own draft without asking it to imitate.
 */
export type AnchorMode = 'conservative' | 'conditional';

const ANCHOR_INSTRUCTION: Record<AnchorMode, string> = {
  conservative:
    'Those conventions were learned from other questions and may not apply to this one. ' +
    'If none applies, return the first attempt unchanged. ' +
    'If one applies, change only what it justifies and keep everything else.',
  conditional:
    'Each item may carry a "when" condition. Check that condition against the question above. ' +
    'If it holds, apply that item even where the first attempt disagrees with it, and change nothing else. ' +
    'If no item carries a condition that holds, return the first attempt unchanged.',
};

export function anchorPromptFor(input: AnchorInput, mode: AnchorMode = 'conservative'): string {
  return [
    'You revise one SQLite query that answers the question below.',
    'Return the SQL only, in a ```sql fence, with no explanation.',
    `Schema:\n${input.ddl}`,
    input.evidence ? `Evidence (may be wrong; it is external knowledge):\n${input.evidence}` : '',
    `Question: ${input.question}`,
    `A first attempt at this question:\n${input.draft}`,
    input.pack === '' ? '' : `Conventions learned from earlier corrections:\n${input.pack}`,
    // The instruction refers to a block that may not be there. With no pack the arm would
    // be asking the model to weigh nothing, which is a different question.
    input.pack === '' ? '' : ANCHOR_INSTRUCTION[mode],
  ]
    .filter((line) => line !== '')
    .join('\n\n');
}

/**
 * The retry prompt: the model has already answered, the answer failed, and now it sees the pack.
 *
 * The difference from `anchorPromptFor` is what the second call is *for*. Anchoring asks the
 * model to audit a draft it may have got right; this asks it to explain a failure, which is the
 * only moment at which a rule about a past mistake is evidence rather than a suggestion. The
 * failure is stated in the terms the system observed — no rows, or an execution error — because
 * inventing a diagnosis for the model would make the arm measure the diagnosis.
 */
export type RetryInput = {
  readonly question: string;
  readonly evidence: string;
  readonly ddl: string;
  readonly attempt: string;
  /** What the database said: `no rows` or the driver's message. */
  readonly failure: string;
  readonly pack: string;
  /** What the pack holds; the empty pack renders identically either way. */
  readonly packKind?: PackKind;
};

const RETRY_LABEL: Record<PackKind, string> = {
  rule: 'Conventions learned from earlier corrections:',
  repair: 'Repairs of earlier failures, each with the reason it was wrong and the change that fixed it:',
};

/**
 * What to do with the block, which depends on what the block is.
 *
 * A rule is a claim to check against the failure; a repair is a story whose ending is a
 * change to try. The second asks for more than "does this apply" — it asks whether this
 * failure is the one that was repaired, which is the question the whole retry arm exists
 * to put to the model.
 */
const RETRY_INSTRUCTION: Record<PackKind, string> = {
  rule:
    'Check whether one of those conventions explains the failure. If one does, apply it. ' +
    'If none does, write a different query that answers the question.',
  repair:
    'Each item states a failure, why it was wrong, and the change that fixed it. ' +
    'Check whether one of those failures is this failure. If one is, apply the same change. ' +
    'If none is, write a different query that answers the question.',
};

export function retryPromptFor(input: RetryInput): string {
  const kind = input.packKind ?? 'rule';
  return [
    'You fix one SQLite query that answers the question below.',
    'Return the SQL only, in a ```sql fence, with no explanation.',
    `Schema:\n${input.ddl}`,
    input.evidence ? `Evidence (may be wrong; it is external knowledge):\n${input.evidence}` : '',
    `Question: ${input.question}`,
    `An earlier attempt at this question:\n${input.attempt}`,
    `That attempt did not work: ${input.failure}`,
    input.pack === '' ? '' : `${RETRY_LABEL[kind]}\n${input.pack}`,
    input.pack === '' ? '' : RETRY_INSTRUCTION[kind],
  ]
    .filter((line) => line !== '')
    .join('\n\n');
}

/**
 * How the attempt's result differed from the correction's, in words the distiller can use.
 *
 * A rule distiller is told the correction and left to guess why the attempt was wrong; a
 * repair distiller cannot be, because "why it was wrong" is the content being learned. The
 * only grounded source for that is the two results side by side, so the lane measures them
 * and states the difference: a failure message, a row count, a column list, or — when both
 * agree on shape — the fact that only the values differ.
 *
 * Deliberately shape-only. The values themselves are the answer to the question being
 * learned from, and a note that quotes them would be a restatement of one case dressed as
 * a lesson. Row counts and column names are schema vocabulary; the numbers inside are not.
 */
export type ResultShape = {
  readonly ok: boolean;
  readonly error?: string;
  readonly rows: number;
  readonly columns: readonly string[];
};

export function mismatchNote(attempt: ResultShape, correction: ResultShape): string {
  if (!attempt.ok) {
    // The driver's own message, because a paraphrase would be a diagnosis and this note
    // is evidence: "no such column: t2.raceId" tells the distiller which relation was
    // invented, while "the join was wrong" tells it what we already suspected.
    return `it failed: ${attempt.error ?? 'the driver gave no message'}`;
  }
  if (!correction.ok) {
    return 'it ran but returned the wrong rows';
  }
  if (attempt.rows !== correction.rows) {
    // "No rows" is said in the words the retry uses. The learning pass and the retry loop classify
    // the same failure, and a vocabulary that says "0 rows" on one side and "no rows" on the other
    // is two vocabularies: measured, the failure key found nothing on 22 of 22 retries because no
    // note had ever been filed under `no-rows`.
    if (attempt.rows === 0) {
      return `it returned no rows, where the corrected query returns ${correction.rows}`;
    }
    return `it returned ${attempt.rows} rows where the corrected query returns ${correction.rows}`;
  }
  if (attempt.columns.join('\u0000') !== correction.columns.join('\u0000')) {
    return (
      `it returned columns [${attempt.columns.join(', ')}] ` +
      `where the corrected query returns [${correction.columns.join(', ')}]`
    );
  }
  return 'it returned the corrected query\'s columns and row count, but different values';
}

/**
 * The retry arms, measured on the questions that were retried.
 *
 * A population delta is the wrong statistic for a conditional treatment: only the
 * questions whose first answer failed can move, which on this benchmark is 41 of 350, so
 * an effect that fixes a third of them reads as +2pp and its interval spans zero. The
 * subset comparison answers the question the arm was built to ask — of the questions that
 * failed, how many did the repair loop recover — and it costs one filter.
 *
 * Reported alongside the population delta rather than instead of it: the subset number is
 * conditional on a post-treatment variable (the first answer's failure), which is exactly
 * what makes it informative and exactly what makes it uninterpretable as a headline.
 */
export type RetrySubsetRow = {
  readonly arm: string;
  readonly n: number;
  readonly withoutMemoryAccuracy: number;
  readonly accuracy: number;
  readonly deltaPp: number;
  readonly ciLowPp: number;
  readonly ciHighPp: number;
  readonly p: number;
  readonly gained: number;
  readonly lost: number;
};

export function retrySubset(
  cases: readonly {
    readonly retried: boolean;
    readonly withoutMemoryCorrect: boolean;
    readonly arms: Readonly<Record<string, boolean | undefined>>;
  }[],
  seed = 7,
  resamples = 10_000,
): readonly RetrySubsetRow[] {
  const retried = cases.filter((item) => item.retried);
  if (retried.length === 0) return [];
  const names = new Set<string>();
  for (const item of retried) {
    for (const [name, value] of Object.entries(item.arms)) {
      if (value !== undefined) names.add(name);
    }
  }
  const rows: RetrySubsetRow[] = [];
  for (const name of [...names].sort()) {
    const scored = retried.filter((item) => item.arms[name] !== undefined);
    const comparison = comparePaired(
      scored.map((item) => item.withoutMemoryCorrect),
      scored.map((item) => item.arms[name] === true),
      seed,
      resamples,
    );
    rows.push({
      arm: name,
      n: comparison.n,
      withoutMemoryAccuracy: comparison.baselineAccuracy,
      accuracy: comparison.treatmentAccuracy,
      deltaPp: comparison.delta * 100,
      ciLowPp: comparison.deltaCI.low * 100,
      ciHighPp: comparison.deltaCI.high * 100,
      p: comparison.p,
      gained: comparison.gained,
      lost: comparison.lost,
    });
  }
  return rows;
}

/**
 * The identifiers a SQL statement actually uses.
 *
 * Not a parser: the tokens minus the reserved words, lowercased. It exists to answer one
 * question the lane could not answer before — is the rule that was put in front of this
 * question *about* anything the answer involves — and a token set is enough for that.
 */
export function sqlIdentifiers(sql: string): ReadonlySet<string> {
  const reserved = new Set([
    'select', 'from', 'where', 'group', 'by', 'order', 'having', 'join', 'inner', 'left',
    'right', 'outer', 'full', 'on', 'as', 'and', 'or', 'not', 'in', 'is', 'null', 'count',
    'sum', 'avg', 'min', 'max', 'distinct', 'case', 'when', 'then', 'else', 'end', 'limit',
    'offset', 'union', 'all', 'desc', 'asc', 'like', 'between', 'with', 'cast', 'round',
    'abs', 'int', 'real', 'text', 'nulls', 'first', 'last', 'exists', 'cast', 'strftime',
  ]);
  const out = new Set<string>();
  for (const token of sql.match(/[A-Za-z_][A-Za-z_0-9]*/g) ?? []) {
    const lower = token.toLowerCase();
    if (!reserved.has(lower)) out.add(lower);
  }
  return out;
}

/** Whether a claim's text names one of the identifiers. */
export function mentionsAny(text: string, identifiers: ReadonlySet<string>): boolean {
  const haystack = text.toLowerCase();
  for (const identifier of identifiers) {
    if (identifier.length < 3) continue;
    const at = haystack.indexOf(identifier);
    if (at === -1) continue;
    // Whole-token match: `race` inside `races` is a different word about a different table.
    const before = at === 0 ? '' : haystack[at - 1] ?? '';
    const after = haystack[at + identifier.length] ?? '';
    if (!/[a-z0-9_]/.test(before) && !/[a-z0-9_]/.test(after)) return true;
  }
  return false;
}

/**
 * Retrieval relevance, and what accuracy does inside each half.
 *
 * The question this answers is the one the whole line of work depends on and had never asked:
 * when a pack arrives, is it about the question? Measured on run 40506721172, 210 of 350 packs
 * named nothing the gold query uses — a question about oxygen atoms in molecules received a note
 * about parsing lap times — and the 140 that did named something scored **43.6%** against a
 * 53.4% baseline, while the off-topic half scored 54.8%.
 *
 * Which is the opposite of the reading one wants from a relevance metric, and the reason it has
 * to be measured rather than assumed: a rule that shares vocabulary with the answer is not a
 * rule the model can use, it is a rule the model follows.
 *
 * `identifiers` comes from the gold query because the measurement may look at the answer; the
 * pack never can.
 */
export type RelevanceSplit = {
  readonly packs: number;
  readonly onTopic: number;
  readonly offTopic: number;
  readonly onTopicAccuracy: number;
  readonly offTopicAccuracy: number;
  readonly onTopicBaseline: number;
  readonly offTopicBaseline: number;
};

export function relevanceSplit(
  cases: readonly {
    readonly correct: boolean;
    readonly withoutMemoryCorrect: boolean;
    readonly goldSql: string;
    readonly injected: readonly string[];
  }[],
): RelevanceSplit {
  let packs = 0;
  let onTopic = 0;
  let onRight = 0;
  let onBase = 0;
  let offTopic = 0;
  let offRight = 0;
  let offBase = 0;
  for (const item of cases) {
    if (item.injected.length === 0) continue;
    packs += 1;
    const identifiers = sqlIdentifiers(item.goldSql);
    const on = item.injected.some((text) => mentionsAny(text, identifiers));
    if (on) {
      onTopic += 1;
      onRight += item.correct ? 1 : 0;
      onBase += item.withoutMemoryCorrect ? 1 : 0;
    } else {
      offTopic += 1;
      offRight += item.correct ? 1 : 0;
      offBase += item.withoutMemoryCorrect ? 1 : 0;
    }
  }
  return {
    packs,
    onTopic,
    offTopic,
    onTopicAccuracy: onTopic === 0 ? 0 : onRight / onTopic,
    offTopicAccuracy: offTopic === 0 ? 0 : offRight / offTopic,
    onTopicBaseline: onTopic === 0 ? 0 : onBase / onTopic,
    offTopicBaseline: offTopic === 0 ? 0 : offBase / offTopic,
  };
}

/**
 * The kind of failure, from the words a deployment actually has.
 *
 * A retry is triggered by one of two things — the query did not run, or it ran and returned
 * nothing — and a note learned from a failure is only usable if it is retrieved by *that*, not by
 * the question. The question does not say what failed; the failure does.
 *
 * The vocabulary is deliberately small and closed. Every kind here is a distinction the database or
 * the driver makes, so the classifier can be a pure function of the text and cannot drift with a
 * model's mood:
 *
 *   missing-column / missing-table / syntax / no-rows / no-query / other
 *
 * `no-rows` is the one that matters most: it is both a retry trigger and the most common shape of a
 * wrong answer, so a note learned from "it returned nothing" is exactly the note a retry needs.
 */
export type FailureKind =
  | 'missing-column'
  | 'missing-table'
  | 'syntax'
  | 'no-rows'
  | 'no-query'
  | 'row-count'
  | 'columns'
  | 'values'
  | 'other';

export function failureKind(failure: string): FailureKind {
  const text = failure.toLowerCase();
  if (text.includes('no such column') || text.includes('no column named')) return 'missing-column';
  if (text.includes('no such table')) return 'missing-table';
  if (text.includes('syntax error') || text.includes('near "')) return 'syntax';
  if (text.includes('returned no rows') || text.includes('returned nothing')) return 'no-rows';
  if (text.includes('no query') || text.includes('did not contain a query')) return 'no-query';
  // The mismatch notes the learning pass records for an answer that ran and was still wrong.
  // The column note also contains "where the corrected query returns", so it is read first: a
  // classifier whose answer depends on the order of its own branches has to say so.
  if (text.includes('returned columns')) return 'columns';
  if (text.includes('where the corrected query returns')) return 'row-count';
  if (text.includes('different values')) return 'values';
  return 'other';
}
