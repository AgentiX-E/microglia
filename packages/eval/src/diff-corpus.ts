/**
 * Turning a committed BIRD run into per-question query differences.
 *
 * The three readings that follow from a run — the query diff, the mediation and the gate's
 * stability — all begin the same way, and the fourth (the overlap between two features) begins that
 * way too. The step is small enough to copy and too load-bearing to copy: every reading in this line
 * is a statement about the *same* 1,534 differences, so two constructions of them that drifted apart
 * by one field would put two slightly different corpora under two numbers that are quoted together.
 *
 * `per_case` is the only field read, and a run without it is an error rather than an empty corpus —
 * an empty corpus produces every downstream reading as a zero, and a zero that means "no data"
 * reads exactly like a zero that means "no effect".
 */
import { diffQueries } from './sql-diff.js';
import type { DiffCase } from './query-diff.js';

/** The per-question record a run writes, as much of it as these readings use. */
export type QueryCaseRecord = {
  readonly id: string;
  readonly dbId: string;
  readonly question: string;
  readonly evidence?: string;
  readonly predictedSql: string;
  readonly baselineSql: string;
  readonly correct: boolean;
  readonly withoutMemoryCorrect: boolean;
  readonly difficulty?: string;
  /** The reference query, which is what the answer required rather than what was produced. */
  readonly goldSql?: string;
  readonly packIdList?: readonly string[];
  /** The rendered rule text the model read, when the lane stored it (R31 onwards). */
  readonly injected?: readonly string[];
};

export type CommittedRun = {
  readonly per_case?: readonly QueryCaseRecord[];
  readonly items?: readonly unknown[];
  readonly generated_at?: string;
};

/**
 * Every question in a run, with the two queries and their difference.
 *
 * `evidence` is passed through because the strict grounding rule reads it: a name in the external
 * knowledge block is not a name the model invented, and a corpus constructed without it would count
 * those as ungrounded.
 */
export function diffCasesOf(run: CommittedRun, source = 'the artefact'): readonly DiffCase[] {
  const rows = run.per_case;
  if (rows === undefined || rows.length === 0) {
    throw new Error(`${source} carries no per_case rows to classify`);
  }
  return rows.map((entry) => ({
    id: entry.id,
    dbId: entry.dbId,
    delta: diffQueries(entry.baselineSql, entry.predictedSql, entry.question, entry.evidence ?? ''),
    correct: entry.correct,
    withoutMemoryCorrect: entry.withoutMemoryCorrect,
    question: entry.question,
    ...(entry.evidence === undefined ? {} : { evidence: entry.evidence }),
    ...(entry.packIdList === undefined ? {} : { packIdList: entry.packIdList }),
    ...(entry.goldSql === undefined ? {} : { goldSql: entry.goldSql }),
    ...(entry.difficulty === undefined ? {} : { difficulty: entry.difficulty }),
  }));
}
