/**
 * A corrected label, applied to a corpus that is pinned and must stay pinned.
 *
 * Jin, Choi, Zhu and Kang (*Pervasive Annotation Errors Break Text-to-SQL Benchmarks and
 * Leaderboards*, PVLDB 19(5), 2026) put Mini-Dev's annotation error rate at 52.8% and published
 * corrected labels for all 498 of its SQLite questions. This repository's archive is pinned at
 * `v1-2024-06-20`, so the correction cannot simply be installed: a corpus that changes under a
 * published number is the one thing the pin exists to prevent, and 43.1% of the transfer slice's gold
 * queries differ.
 *
 * So the correction is a *revision* — a named file, with its own digest, that a dispatch either applies
 * or does not, and whose application is recorded in the artefact. Two things then have to be true at
 * once:
 *
 *  - the pinned corpus keeps its identity, because the revision names the rows it touches and leaves
 *    every other row alone;
 *  - a row it touches is *scored* under the corrected label, which is what the reviewers' evidence is
 *    about.
 *
 * ## The rows it cannot touch
 *
 * The corrected release is the `sql_only` variant, which by its own description keeps the questions and
 * replaces only the gold. It keeps *its* questions. **67 of this repository's 350 transfer questions
 * have different text in it**, which places the pin two revisions behind the file the correction was
 * built on — BIRD's own 2026 release realigned Mini-Dev's ids to 0–499 and revised the questions again.
 * On 44 of those 67 the gold moved as well.
 *
 * The file's provenance is checkable without the network, and this is the check: the dataset card
 * states that `evidence` is null for question ids **1507** and **1528**, and those are exactly the two
 * null rows in it. A file that had been built by a different pipeline would not reproduce that pair.
 *
 * Grading an answer to question A against the label of question B is not a relabelling. Those rows are
 * **dropped and named**, because keeping them scores one corpus revision as another, and silently
 * keeping the vendor label would report a number the reviewers' evidence says is wrong. What a run
 * loses is the population; what it gains is a denominator it can defend.
 */
import { createHash } from 'node:crypto';
import type { BirdRow } from './bird-rows.js';

export type GoldRevisionEntry = {
  readonly questionId: number;
  readonly dbId: string;
  readonly sql: string;
  readonly question: string;
};

/** A row the revision cannot score, with the two texts that disagree. */
export type RevisionDrop = {
  readonly id: string;
  readonly pinnedQuestion: string;
  readonly correctedQuestion: string;
};

export type GoldRevisionReading = {
  /** The file the entries were read from, as the artefact should name it. */
  readonly source: string;
  /** SHA-256 of the file's bytes, so two revisions can be told apart. */
  readonly digest: string;
  /** Entries in the file. */
  readonly entries: number;
  /** Rows whose gold the revision replaced with a different statement. */
  readonly applied: number;
  /** Rows the revision agrees with, which is evidence the two files describe one benchmark. */
  readonly unchanged: number;
  /** Rows it names that this corpus does not have. */
  readonly unmatched: number;
  /** Rows it names whose question text disagrees: dropped rather than scored. */
  readonly dropped: readonly RevisionDrop[];
};

export class GoldRevisionError extends Error {
  constructor(message: string, readonly detail: string) {
    super(message);
    this.name = 'GoldRevisionError';
  }
}

const key = (dbId: string, questionId: number | string): string => `${dbId}#${String(questionId)}`;

/** The revision's own digest, over the text exactly as it was read. */
export function revisionDigest(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * Read the corrected-label file.
 *
 * The shape is the published one: an array of `{ question_id, db_id, question, SQL }`. `question_id` is
 * a **string** in that file and a number in the corpus, so it is normalised here rather than at every
 * comparison — the mixed comparison is how a joint of 498 entries matches nothing and reports an empty
 * revision as a clean one.
 *
 * A duplicate id is refused. Two entries for one key means the file disagrees with itself about the
 * gold, and there is no defensible way to pick between them — the same stance the loader takes on a
 * corpus whose ids collide.
 */
export function parseGoldRevision(text: string, source: string): readonly GoldRevisionEntry[] {
  const parsed = JSON.parse(text) as unknown;
  if (!Array.isArray(parsed)) {
    throw new GoldRevisionError(`${source} is not an array of corrected rows`, 'gold-revision-shape');
  }
  const out: GoldRevisionEntry[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of parsed.entries()) {
    if (raw === null || typeof raw !== 'object') {
      throw new GoldRevisionError(`${source}: row ${String(index)} is not an object`, 'gold-revision-row');
    }
    const record = raw as Record<string, unknown>;
    const questionId = record['question_id'];
    const dbId = record['db_id'];
    const sql = record['SQL'];
    const question = record['question'];
    if (
      (typeof questionId !== 'string' && typeof questionId !== 'number') ||
      typeof dbId !== 'string' ||
      typeof sql !== 'string' ||
      typeof question !== 'string'
    ) {
      throw new GoldRevisionError(
        `${source}: row ${String(index)} needs question_id, db_id, question and SQL`,
        'gold-revision-field',
      );
    }
    const id = key(dbId, questionId);
    if (seen.has(id)) {
      throw new GoldRevisionError(`${source}: '${id}' is corrected twice`, 'gold-revision-duplicate');
    }
    seen.add(id);
    out.push({ questionId: Number(questionId), dbId, sql, question });
  }
  return out;
}

export type GoldRevisionResult = {
  /** The rows a run may score: every row the revision could label. */
  readonly rows: readonly BirdRow[];
  /** The rows it could not, with both question texts. */
  readonly dropped: readonly BirdRow[];
  readonly reading: GoldRevisionReading;
};

/**
 * Replace the gold of every row the revision can label, and drop the ones it cannot.
 *
 * A row the revision does not name keeps its pinned gold. That is not a fallback: the correction's own
 * description is that it corrected 498 questions and this corpus has 498, so a row it does not name was
 * reviewed and left alone, and its vendor label is the reviewed one.
 *
 * Comparison is on trimmed text. The two files were written by different pipelines — the corpus carries
 * the archive's own JSON, the revision a re-serialisation of it — so whitespace at the edges is a fact
 * about the writer, while a different sentence is a fact about the question.
 */
export function reviseGold(
  rows: readonly BirdRow[],
  entries: readonly GoldRevisionEntry[],
  source: string,
  digest: string,
): GoldRevisionResult {
  const byKey = new Map<string, GoldRevisionEntry>();
  for (const entry of entries) byKey.set(key(entry.dbId, entry.questionId), entry);

  const kept: BirdRow[] = [];
  const dropped: BirdRow[] = [];
  const drops: RevisionDrop[] = [];
  let applied = 0;
  let unchanged = 0;
  const matched = new Set<string>();

  for (const row of rows) {
    const id = key(row.db_id, row.question_id);
    const entry = byKey.get(id);
    if (entry === undefined) {
      kept.push(row);
      continue;
    }
    matched.add(id);
    if (row.question.trim() !== entry.question.trim()) {
      dropped.push(row);
      drops.push({
        id,
        pinnedQuestion: row.question.slice(0, 160),
        correctedQuestion: entry.question.slice(0, 160),
      });
      continue;
    }
    if (row.SQL.trim() === entry.sql.trim()) {
      unchanged += 1;
      kept.push(row);
      continue;
    }
    applied += 1;
    kept.push({ ...row, SQL: entry.sql });
  }

  return {
    rows: kept,
    dropped,
    reading: {
      source,
      digest,
      entries: entries.length,
      applied,
      unchanged,
      unmatched: entries.length - matched.size,
      dropped: drops,
    },
  };
}
