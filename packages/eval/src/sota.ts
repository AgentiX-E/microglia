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
/** Bumped whenever the prompt text changes; a result without it is unreproducible. */
export const PROMPT_VERSION = 'sql-prompt/2';

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

/** BIRD answers are compared as unordered multisets, the standard EX metric. */
export function matches(predicted: readonly string[], gold: readonly string[]): boolean {
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
  | 'gated'
  | 'duplicate'
  | 'wrong-scope'
  | 'stated'
  | 'oracle';

export const OPTIONAL_ARMS: readonly Exclude<SqlArm, 'none' | 'full'>[] = [
  'full-narrow',
  'gated',
  'duplicate',
  'wrong-scope',
  'stated',
  'oracle',
];

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
    if (!(OPTIONAL_ARMS as readonly string[]).includes(trimmed)) {
      throw new RangeError(`Unknown arm '${trimmed}'; known arms are ${OPTIONAL_ARMS.join(', ')}`);
    }
    wanted.add(trimmed as Exclude<SqlArm, 'none' | 'full'>);
  }
  return wanted;
}

export type PromptInput = {
  readonly question: string;
  readonly evidence: string;
  readonly ddl: string;
  /** The rendered pack, or '' when the arm injects nothing. */
  readonly pack: string;
  /** Whether the arm states the workspace convention explicitly. */
  readonly stated: boolean;
  readonly convention: ConventionSpec | undefined;
};

export function promptFor(input: PromptInput): string {
  return [
    'You write one SQLite query that answers the question exactly.',
    'Return the SQL only, in a ```sql fence, with no explanation.',
    'Use only the tables and columns in the schema. Prefer explicit JOINs. Do not invent columns.',
    `Schema:\n${input.ddl}`,
    input.evidence ? `Evidence (may be wrong; it is external knowledge):\n${input.evidence}` : '',
    input.stated && input.convention !== undefined ? `Workspace convention:\n- ${input.convention.sentence}` : '',
    input.pack === '' ? '' : `Workspace conventions learned from earlier corrections:\n${input.pack}`,
    `Question: ${input.question}`,
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
