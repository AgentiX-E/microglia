/**
 * Reading a benchmark question file, in one place.
 *
 * This was a private pair of functions inside `sota-bird.ts` until a second lane needed them: the
 * split precheck loads the same files to answer a different question — *can this split be measured
 * at all* — and the honest way to answer it is with the parser the measurement will use. Two
 * copies of a JSON reader is how a precheck passes on files the lane then fails to read.
 *
 * The shape is not ours. BIRD ships `dev.json` as an array, Hugging Face mirrors the same data as
 * JSON Lines, and converted exports wrap the array in `{data: [...]}`. A parser that assumes one
 * shape reads zero rows from the others and reports an empty benchmark rather than an error, which
 * is why all three are accepted and why an unrecognised shape is not silently empty.
 */
import { hashJson } from '@agentix-e/microglia-core/kernel';

export type BirdRow = {
  readonly question_id: number;
  readonly db_id: string;
  readonly question: string;
  readonly evidence: string;
  readonly SQL: string;
  readonly difficulty: string;
};

/**
 * One record, or `undefined` when it is not a question.
 *
 * `difficulty` defaults to the empty string rather than being required: `train.json` has no such
 * field on any of its 9,428 rows, and a reader that refused those rows would report an empty
 * out-of-sample set. `isSimple('')` answers no, so an absent tier is never filtered away.
 */
export function normaliseRow(raw: Record<string, unknown>, index: number): BirdRow | undefined {
  const question = raw['question'];
  const sql = raw['SQL'] ?? raw['sql'] ?? raw['query'] ?? raw['gold_sql'];
  const db = raw['db_id'] ?? raw['database'] ?? raw['db'];
  if (typeof question !== 'string' || typeof sql !== 'string' || typeof db !== 'string')
    return undefined;
  if (question.trim() === '' || sql.trim() === '') return undefined;
  return {
    question_id: typeof raw['question_id'] === 'number' ? raw['question_id'] : index,
    db_id: db,
    question,
    evidence: typeof raw['evidence'] === 'string' ? raw['evidence'] : '',
    SQL: sql,
    difficulty: typeof raw['difficulty'] === 'string' ? raw['difficulty'] : '',
  };
}

/** Every question in a file, in file order, skipping records that are not questions. */
export function parseRows(text: string): BirdRow[] {
  const trimmed = text.trim();
  const records: unknown[] = [];
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) records.push(...parsed);
    else if (
      parsed !== null &&
      typeof parsed === 'object' &&
      Array.isArray((parsed as { data?: unknown }).data)
    ) {
      records.push(...(parsed as { data: unknown[] }).data);
    } else records.push(parsed);
  } catch {
    for (const line of trimmed.split('\n')) {
      if (line.trim() === '') continue;
      try {
        records.push(JSON.parse(line) as unknown);
      } catch {
        // A truncated final line is not a reason to lose the rest of the file.
      }
    }
  }
  const rows: BirdRow[] = [];
  for (const [index, record] of records.entries()) {
    if (record === null || typeof record !== 'object') continue;
    const row = normaliseRow(record as Record<string, unknown>, index);
    if (row !== undefined) rows.push(row);
  }
  return rows;
}

/**
 * The gold statements in `train_gold.sql`, and the database each belongs to.
 *
 * BIRD's train split ships its gold twice: inside `train.json` as `SQL`, and again as a
 * tab-separated `<sql>\t<db_id>` file whose rows are aligned with the question file by position.
 * Two copies of one answer is a chance to check them against each other, and this split is the only
 * one where that check exists — dev and Mini-Dev carry the SQL inline and nothing beside it.
 *
 * The alignment is positional, so a file with the wrong number of rows is refused rather than
 * zipped against the questions: an off-by-one would compare every question to its neighbour's gold
 * and produce a run whose accuracy is a number about nothing.
 */
export function parseGoldLines(text: string): { readonly sql: string; readonly dbId: string }[] {
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const at = line.lastIndexOf('\t');
      if (at < 0) return { sql: line.trim(), dbId: '' };
      return { sql: line.slice(0, at).trim(), dbId: line.slice(at + 1).trim() };
    });
}

/** How many question rows and gold rows disagree, and the first few that do. */
export type GoldAgreement = {
  readonly questions: number;
  readonly gold: number;
  readonly compared: number;
  readonly disagreeing: readonly {
    readonly index: number;
    readonly question_sql: string;
    readonly gold_sql: string;
  }[];
};

/**
 * Compare the two copies of the gold, positionally.
 *
 * The comparison is exact on whitespace-trimmed text and nothing else. Normalising case or
 * collapsing spaces would hide the only failure this check can catch — a file that was rebuilt
 * from a different revision — and the point is to catch that, not to be generous with it.
 */
export function compareGold(
  rows: readonly BirdRow[],
  gold: readonly { readonly sql: string; readonly dbId: string }[],
  samples = 5,
): GoldAgreement {
  const compared = Math.min(rows.length, gold.length);
  const disagreeing: { index: number; question_sql: string; gold_sql: string }[] = [];
  for (let at = 0; at < compared; at += 1) {
    const row = rows[at] as BirdRow;
    const line = gold[at] as { sql: string; dbId: string };
    if (row.SQL.trim() === line.sql) continue;
    if (disagreeing.length < samples) {
      disagreeing.push({
        index: at,
        question_sql: row.SQL.slice(0, 160),
        gold_sql: line.sql.slice(0, 160),
      });
    }
  }
  return { questions: rows.length, gold: gold.length, compared, disagreeing };
}

/**
 * A digest of the questions a run actually read, not of the file it read them from.
 *
 * BIRD shipped a Mini-Dev update with corrected annotations on 2026-10-28, and expert review of the
 * previous one put the annotation error rate at 52.8% (`Pervasive Annotation Errors Break Text-to-SQL
 * Benchmarks and Leaderboards`, Jin et al., January 2026). A corpus that changes under a published
 * number is the one thing this repository cannot tolerate, and the archive is pinned by `sha256` for
 * exactly that reason — but `loadDataset` has a second path, for an operator who points `BIRD_DIR` at
 * a directory without the question file, and that path reads a URL. So the artefact needs a reading of
 * the *content*: two runs whose digests agree measured one corpus whatever they were handed, and two
 * whose digests differ cannot be compared even if the file name and the row count match.
 *
 * The gold SQL is inside the digest on purpose. It is what an annotation correction changes, and a
 * digest over the questions alone would be identical across the two releases.
 *
 * Order is not part of the corpus. Rows are sorted by database and id before hashing, because the
 * fold assignment sorts them anyway and a loader that returned the same questions in file order versus
 * id order would otherwise look like a different benchmark.
 */
export function questionsDigest(rows: readonly BirdRow[]): string {
  const lines = rows
    .map((row) => [row.db_id, String(row.question_id), row.question, row.evidence, row.SQL])
    .sort((left, right) => {
      const byDb = String(left[0]).localeCompare(String(right[0]));
      if (byDb !== 0) return byDb;
      return Number(left[1]) - Number(right[1]);
    });
  return hashJson(lines);
}
