/**
 * ROSE-VEC: a public set of expert-adjudicated NL2SQL verdicts.
 *
 * The set exists because Execution Accuracy cannot be used as the reference in a
 * calibration study. EX compares a prediction's result rows against one gold query's
 * rows, so it marks a correct query wrong whenever the two express the same intent
 * differently, and marks a wrong one right whenever the two happen to collide on the
 * rows of one database. On this set EX agrees with the experts less than half as
 * often, above chance, as the metric it is supposed to validate.
 *
 * What the file carries, per row: the question, the prediction a real system emitted,
 * the gold query, and a boolean the annotators agreed on. What it does not carry is
 * the databases, which live in BIRD Mini-Dev and are pinned separately. This module
 * owns only the part that can be checked without either: the parse, the label
 * rebuild from the annotators' own files, and the row comparison EX is defined as.
 *
 * Two facts about the provenance matter enough to state in code rather than prose:
 *
 *   - the `label` field is a *consensus* label, kept only where two annotators voted
 *     independently and agreed, so the set is smaller than the annotations it came
 *     from and cannot be used to estimate how often annotators disagree;
 *   - the annotators' raw files are published next to it, which is why this module can
 *     rebuild the consensus and report the committee's agreement against itself.
 */
import type { JudgedPair } from './agreement.js';

export type RoseVecRow = {
  readonly questionId: string;
  readonly dbId: string;
  readonly question: string;
  readonly predictedSql: string;
  readonly goldSql: string;
  /** The committee's verdict: does the prediction answer the question? */
  readonly label: boolean;
  readonly evidence: string | undefined;
  readonly reason: string | undefined;
};

export type RoseVecErrorReason =
  | 'not-an-array'
  | 'bad-row'
  | 'bad-question-id'
  | 'bad-label'
  | 'missing-field';

export class RoseVecError extends Error {
  readonly reason: RoseVecErrorReason;
  readonly index: number;

  constructor(reason: RoseVecErrorReason, index: number, detail: string) {
    super(`ROSE-VEC ${reason} at row ${index}: ${detail}`);
    this.name = 'RoseVecError';
    this.reason = reason;
    this.index = index;
  }
}

function field(row: Record<string, unknown>, key: string, index: number): string {
  const value = row[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new RoseVecError('missing-field', index, `"${key}" must be a non-empty string`);
  }
  return value;
}

/**
 * The published file, validated.
 *
 * A row without a boolean label is rejected rather than defaulted. The whole point of
 * the set is the label; a silent `false` there would turn "unlabelled" into "wrong"
 * and depress every criterion measured against it by however many rows were broken.
 */
export function parseRoseVec(raw: unknown): RoseVecRow[] {
  if (!Array.isArray(raw)) throw new RoseVecError('not-an-array', -1, 'expected an array of rows');
  return raw.map((entry, index) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new RoseVecError('bad-row', index, 'expected an object');
    }
    const row = entry as Record<string, unknown>;
    const id = row['question_id'];
    if (typeof id !== 'number' && typeof id !== 'string') {
      throw new RoseVecError('bad-question-id', index, 'question_id must be a number or string');
    }
    const label = row['label'];
    if (typeof label !== 'boolean') {
      throw new RoseVecError('bad-label', index, 'label must be a boolean');
    }
    const evidence = row['evidence'];
    const reason = row['reason_1'] ?? row['reason'];
    return {
      questionId: String(id),
      dbId: field(row, 'db_id', index),
      question: field(row, 'question', index),
      predictedSql: field(row, 'predicted_sql', index),
      goldSql: field(row, 'gold_sql', index),
      label,
      evidence: typeof evidence === 'string' && evidence.trim() !== '' ? evidence : undefined,
      reason: typeof reason === 'string' && reason.trim() !== '' ? reason : undefined,
    };
  });
}

/**
 * One annotator's verdicts, keyed by question id.
 *
 * Their files repeat the row's text, but only the id and the label are read here:
 * taking the text as well would let two files disagree about the same question
 * without anyone noticing, and the set this rebuilds exists to check that they do not.
 */
export function parseRater(raw: unknown): Map<string, boolean> {
  if (!Array.isArray(raw)) throw new RoseVecError('not-an-array', -1, 'expected an array of rows');
  const verdicts = new Map<string, boolean>();
  raw.forEach((entry, index) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new RoseVecError('bad-row', index, 'expected an object');
    }
    const row = entry as Record<string, unknown>;
    const id = row['question_id'];
    if (typeof id !== 'number' && typeof id !== 'string') {
      throw new RoseVecError('bad-question-id', index, 'question_id must be a number or string');
    }
    const label = row['label'];
    if (typeof label !== 'boolean') {
      throw new RoseVecError('bad-label', index, 'label must be a boolean');
    }
    verdicts.set(String(id), label);
  });
  return verdicts;
}

/**
 * Row-set equality, which is what EX is.
 *
 * Order is irrelevant and duplicates collapse, because EX asks whether the two queries
 * returned the same *set* of rows — that is the definition ROSE's own baseline
 * implements, and matching it is what makes a number computed here comparable to a
 * number published there. Cells are compared by JSON encoding so that the string
 * `"null"`, the null value, and the number zero stay distinct: SQLite returns all
 * three, and a comparison that folded them would pass queries that return the wrong
 * column of the right shape.
 */
export function rowsEqual(predicted: readonly (readonly unknown[])[], gold: readonly (readonly unknown[])[]): boolean {
  const left = new Set(predicted.map(encodeRow));
  const right = new Set(gold.map(encodeRow));
  if (left.size !== right.size) return false;
  for (const key of left) if (!right.has(key)) return false;
  return true;
}

function encodeRow(row: readonly unknown[]): string {
  return JSON.stringify(row);
}

/**
 * The rows as judged pairs, with the criterion's verdict supplied by the caller.
 *
 * A row the criterion declined to score is dropped, not counted as a disagreement:
 * an unexecutable prediction is a fact about the run, and folding it into the
 * confusion matrix would make a crashed database look like a disagreement about SQL.
 */
export function judgedPairs(
  rows: readonly RoseVecRow[],
  measured: ReadonlyMap<string, boolean>,
): { readonly pairs: readonly JudgedPair[]; readonly unscored: readonly string[] } {
  const pairs: JudgedPair[] = [];
  const unscored: string[] = [];
  for (const row of rows) {
    const verdict = measured.get(row.questionId);
    if (verdict === undefined) {
      unscored.push(row.questionId);
      continue;
    }
    pairs.push({ reference: row.label, measured: verdict });
  }
  return { pairs, unscored };
}

/**
 * Rebuild the consensus label from the annotators' files.
 *
 * `undefined` where fewer than two annotators saw the item or where they disagreed.
 * Returning the majority instead would manufacture a reference the published set
 * deliberately does not contain, and would hide exactly the discordance this rebuild
 * is run to find.
 */
export function consensusOf(raters: readonly ReadonlyMap<string, boolean>[]): Map<string, boolean> {
  const votes = new Map<string, boolean[]>();
  for (const rater of raters) {
    for (const [id, verdict] of rater) {
      const bucket = votes.get(id);
      if (bucket === undefined) votes.set(id, [verdict]);
      else bucket.push(verdict);
    }
  }
  const consensus = new Map<string, boolean>();
  for (const [id, bucket] of votes) {
    if (bucket.length < 2) continue;
    const first = bucket[0] as boolean;
    if (bucket.every((vote) => vote === first)) consensus.set(id, first);
  }
  return consensus;
}

/**
 * Items where the published label and the rebuild disagree.
 *
 * Should be empty. A non-empty list means either the published set kept a row the
 * annotators did not agree on, or the rebuild read the wrong field — and both are
 * findings about the data that no amount of downstream modelling can fix.
 */
export function labelDisputes(
  rows: readonly RoseVecRow[],
  consensus: ReadonlyMap<string, boolean>,
): readonly RoseVecRow[] {
  return rows.filter((row) => {
    const rebuilt = consensus.get(row.questionId);
    return rebuilt !== undefined && rebuilt !== row.label;
  });
}
