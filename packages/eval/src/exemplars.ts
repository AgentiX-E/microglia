/**
 * Worked examples: the nearest training questions and the gold query that answers each.
 *
 * This is the only arm in the record whose content is a *query that is known to be right* rather than
 * a note about a correction. It exists because the largest positive this project has ever measured —
 * `oracle` at +33.14pp — prices exactly that: showing the model something written for a question by
 * someone who knew the answer. `oracle` cannot be deployed (it injects the memory item whose evidence
 * is the question being asked), so the deployable approximation is a neighbour from the same database
 * whose gold query is in the corpus.
 *
 * Three properties are load-bearing and each is a decision rather than an implementation detail:
 *
 * 1. **Same database only.** A gold query names tables that exist in one schema. A neighbour from
 *    another database is not a weaker example, it is an unusable one — `formula_1` has no `schools`
 *    table — and a prompt that shows it teaches the model to invent joins.
 * 2. **The tree's own similarity.** `similarityOf` is what table recall already ranks neighbours
 *    with, so this arm is not a second definition of "nearest". If the retrieval is later replaced by
 *    embeddings, the recall arm and this one move together, which is what makes their two readings
 *    comparable rather than two independent retrieval systems.
 * 3. **Whole exemplars or none.** The block is capped by dropping the *last* exemplars, never by
 *    truncating one mid-statement. A truncated `WHERE` clause is not a shorter lesson, it is a wrong
 *    query that the model is being invited to copy.
 */

import { similarityOf, tokensOf } from './admission.js';

/** One training question and the query that answers it. */
export type ExemplarRow = {
  readonly db: string;
  readonly question: string;
  readonly sql: string;
};

/** The rows one question may draw from, in the order the caller supplied them. */
export type ExemplarPool = readonly { readonly question: string; readonly sql: string }[];

/**
 * The training rows grouped by the database they were asked against.
 *
 * Grouped rather than pooled, for the reason `goldIndex` groups: a table name means nothing outside
 * its own schema. A database with one training question still has a pool of one, and a database with
 * none is a question the arm cannot fire on — which is a state the caller records rather than hides.
 */
export function exemplarIndexOf(rows: readonly ExemplarRow[]): ReadonlyMap<string, ExemplarPool> {
  const index = new Map<string, { question: string; sql: string }[]>();
  for (const row of rows) {
    const entry = { question: row.question, sql: row.sql };
    const bucket = index.get(row.db);
    if (bucket === undefined) index.set(row.db, [entry]);
    else bucket.push(entry);
  }
  return index;
}

/**
 * The `k` nearest training questions of this database.
 *
 * Ties break by the pool's own order, which is the caller's, so a replay of the same run shows the
 * same examples: a prompt whose content depends on sort stability is a prompt that cannot be
 * compared against itself across dispatches. Rows with no lexical overlap are not offered at all —
 * "the three nearest" when nothing is near is three unrelated queries, and an arm that shows them
 * would be measuring noise as if it were guidance.
 */
export function nearestExemplars(
  index: ReadonlyMap<string, ExemplarPool>,
  db: string,
  question: string,
  k: number,
): readonly { readonly question: string; readonly sql: string }[] {
  const pool = index.get(db);
  if (pool === undefined || k <= 0) return [];
  const tokens = tokensOf(question);
  return pool
    .map((entry, order) => ({ entry, order, score: similarityOf(tokens, tokensOf(entry.question)) }))
    .filter((scored) => scored.score > 0)
    .sort((left, right) => right.score - left.score || left.order - right.order)
    .slice(0, k)
    .map((scored) => scored.entry);
}

/** What one question's block turned out to be. */
export type RenderedExemplars = {
  /** The block itself, empty when nothing was kept. */
  readonly text: string;
  readonly kept: number;
  /** Exemplars the budget refused. Non-zero means the block was full, not that it was clipped. */
  readonly dropped: number;
  readonly chars: number;
};

/**
 * Render the block under a character budget.
 *
 * The budget is compared against the *rendered* length, because that is what the model is billed for
 * and what the comparison against `full`'s pack is stated in: two prompts of the same length that
 * contain different things. Counting the exemplars' raw text and then joining them would let the
 * labels and separators — about forty characters each — push the block past the number the
 * registration promised.
 */
export function renderExemplars(
  rows: readonly { readonly question: string; readonly sql: string }[],
  budget: number,
): RenderedExemplars {
  const blocks = rows.map(
    (row) => `Question: ${row.question.trim()}\nSQL: ${row.sql.trim()}`,
  );
  const kept: string[] = [];
  let chars = 0;
  for (const block of blocks) {
    // The separator counts: the first block costs nothing extra, every later one costs two newlines.
    const cost = kept.length === 0 ? block.length : block.length + 2;
    if (chars + cost > budget) break;
    kept.push(block);
    chars += cost;
  }
  return {
    text: kept.join('\n\n'),
    kept: kept.length,
    dropped: blocks.length - kept.length,
    chars,
  };
}

/** What the arm did across a run. */
export type ExemplarSummary = {
  /** Questions the arm was planned for. */
  readonly asked: number;
  /** Questions whose block carried at least one exemplar. */
  readonly fired: number;
  readonly firedShare: number;
  readonly meanChars: number;
  /** Questions whose budget dropped at least one exemplar. */
  readonly droppedQuestions: number;
  readonly droppedShare: number;
  readonly k: number;
  readonly budget: number;
};

/**
 * Summarise the arm's own conduct, so a null cannot be read as a mechanism that never ran.
 *
 * R65 registers two ways the dispatch can fail to be the test it describes: the arm fires on fewer
 * than 80% of questions, or the block hits its cap on more than 5% of them. Both are properties of
 * the *prompt*, measurable from the plan, and neither is visible in an accuracy delta — an arm that
 * fired on half the questions and one that fired on all of them can produce the same number.
 *
 * Shares, not counts, because the two questions the gate asks are about proportions; the counts
 * travel beside them so a reader can see what the proportion was taken over.
 */
export function summariseExemplars(
  renders: readonly RenderedExemplars[],
  k: number,
  budget: number,
): ExemplarSummary {
  const asked = renders.length;
  const fired = renders.filter((render) => render.text !== '').length;
  const droppedQuestions = renders.filter((render) => render.dropped > 0).length;
  const chars = renders.reduce((sum, render) => sum + render.chars, 0);
  const share = (count: number): number => (asked === 0 ? 0 : Number((count / asked).toFixed(4)));
  return {
    asked,
    fired,
    // A share of nothing is reported as zero rather than as `NaN`: an arm that was not planned is a
    // fact about a dispatch, and a field that poisons every downstream average is not.
    firedShare: share(fired),
    meanChars: asked === 0 ? 0 : Number((chars / asked).toFixed(1)),
    droppedQuestions,
    droppedShare: share(droppedQuestions),
    k,
    budget,
  };
}

/** The two shares R65 registers as the conditions under which the run is not the test it describes. */
export const EXEMPLAR_FLOOR = { firedShare: 0.8, droppedShare: 0.05 } as const;

/**
 * The arm's own validity gate, emitted by the lane that measured it.
 *
 * R65 states the void conditions in words — the arm fires on fewer than 80% of questions, or the
 * block hits its cap on more than 5% — and a condition that lives only in a document is a condition
 * somebody has to remember at reading time. Emitting it as a blocking gate makes a dispatch that
 * did not run the mechanism fail as a configuration problem instead of publishing a delta about
 * something else, which is the failure `V6` and `V51` exist to catch for the other arms.
 *
 * Zero questions is a fail rather than a vacuous pass: an arm that was configured and planned
 * nothing is a wiring defect, and the only way to reach that state is for the fold to have dropped
 * it silently.
 */
export function exemplarGate(summary: ExemplarSummary): {
  readonly id: string;
  readonly criterion: string;
  readonly actual: string;
  readonly pass: boolean;
  readonly blocking: boolean;
} {
  return {
    id: 'V75-exemplars-delivered',
    criterion:
      'the arm was planned for at least one question, fired on at least 80% of them, and hit its ' +
      'character cap on at most 5% of them, so the run shows the model examples rather than a ' +
      'heading',
    actual:
      `asked=${String(summary.asked)} fired=${String(summary.fired)} ` +
      `(${(summary.firedShare * 100).toFixed(2)}%) ` +
      `capped=${String(summary.droppedQuestions)} (${(summary.droppedShare * 100).toFixed(2)}%) ` +
      `mean-chars=${summary.meanChars.toFixed(1)} k=${String(summary.k)} budget=${String(summary.budget)}`,
    pass:
      summary.asked > 0 &&
      summary.firedShare >= EXEMPLAR_FLOOR.firedShare &&
      summary.droppedShare <= EXEMPLAR_FLOOR.droppedShare,
    blocking: true,
  };
}
