/**
 * Can this split be measured at all?
 *
 * A precheck, not a run. It loads the split exactly as the lane will — same manifest, same question
 * parser, same pool rule, same selection, same population check — and stops before the first model
 * call. Every failure it can find is a failure the lane would find after paying for it: a question
 * file of 9,428 rows with no `difficulty` field, a database root the resolver does not know, a
 * schema-only SQLite file that would make every runnable query "correct".
 *
 * Why it exists: `ROADMAP.md` §R30 stage 2 registered a prediction that the train dispatch is the
 * one most likely to fail, and the cheapest form of that prediction is this file. The lane had only
 * ever run `dev` and `minidev`, whose manifests share an archive layout; train differs in three
 * ways that no dev run could reveal — 8.9 GB instead of 346 MB, a nested archive with a different
 * name, and question rows with no tier — and two of the three fail *after* the download.
 *
 * It reads a directory, not an archive. Downloading 8.9 GB is the caller's decision and the one
 * step this file cannot make cheaper, so the precheck takes an extracted root (`BIRD_DIR`) and
 * reports what it finds there. `pnpm eval:split-precheck` with `BIRD_DIR` unset uses the cache the
 * lane would have written.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  compareGold,
  dedupeQuestions,
  parseGoldLines,
  parseManifest,
  parseRows,
  poolOf,
  populationOf,
  resolveDatabase,
  SPLITS,
  splitFrom,
  withinDatabases,
  type BirdManifest,
  type Split,
} from '../index.js';

/** The repository root: `src/bin` → `src` → `eval` → `packages` → `.`. */
const REPO = join(import.meta.dirname, '..', '..', '..', '..');
/** The extract cache the lane writes, so a precheck with `BIRD_DIR` unset reads what a run would. */
const CACHE = join(import.meta.dirname, '..', '..', '.cache', 'bird');

/** Where the split's extracted root is, if the caller has one. */
const BIRD_DIR = (process.env['BIRD_DIR'] ?? '').trim();
const OUT_DIR = (process.env['POC_RESULT_DIR'] ?? join(REPO, 'eval', 'results')).trim();
const OUT = join(OUT_DIR, 'poc-split-precheck.json');

type DatabaseReading = {
  readonly dbId: string;
  readonly path: string;
  readonly found: boolean;
  readonly tables: number;
  readonly rows: number;
};

type SplitReading = {
  readonly split: Split;
  readonly manifest: { readonly name: string; readonly version: string; readonly bytes: number; readonly sha256: string };
  readonly root: string;
  readonly questionFile: string;
  readonly questions: number;
  readonly duplicates: number;
  /** After `poolOf`: what the split's own rule keeps. */
  readonly pool: number;
  /** After the manifest's selection: what can actually be scored. */
  readonly selected: number;
  readonly excludedBySelection: number;
  readonly databasesDeclared: number;
  readonly databasesWithQuestions: number;
  readonly databasesUnused: readonly string[];
  readonly databasesMissing: readonly string[];
  readonly databasesEmpty: readonly string[];
  readonly unreadable: number;
  readonly population: readonly DatabaseReading[];
  readonly gold: { readonly present: boolean; readonly agreement: ReturnType<typeof compareGold> | null };
  /** The one line a reader needs: can the lane start? */
  readonly verdict: 'ready' | 'blocked';
  readonly blockedBy: readonly string[];
};

function manifestFor(split: Split): BirdManifest {
  const names: Readonly<Record<Split, string>> = {
    minidev: 'bird-minidev.json',
    dev: 'bird-dev.json',
    train: 'bird-train.json',
  };
  return parseManifest(JSON.parse(readFileSync(join(REPO, 'eval', 'manifests', names[split]), 'utf8')));
}

/** The extracted root, either the one given or the one the lane's cache would hold. */
function rootOf(manifest: BirdManifest): string {
  if (BIRD_DIR !== '') return BIRD_DIR;
  return join(CACHE, manifest.name, manifest.root);
}

/**
 * Read one split, and say what stops it.
 *
 * The order of the checks is the order the lane runs them, so the first blocker reported is the
 * first one a dispatch would have hit.
 */
function readSplit(split: Split): SplitReading {
  const manifest = manifestFor(split);
  const root = rootOf(manifest);
  const questionFile = join(root, manifest.questions);
  const blockedBy: string[] = [];

  if (!existsSync(questionFile)) {
    // Named rather than silently empty: an empty question list produces a run of zero questions
    // whose accuracy is undefined, which reads like a result in a table.
    blockedBy.push(`question file not found: ${questionFile}`);
    return {
      split,
      manifest: { name: manifest.name, version: manifest.version, bytes: manifest.bytes, sha256: manifest.sha256 },
      root,
      questionFile,
      questions: 0,
      duplicates: 0,
      pool: 0,
      selected: 0,
      excludedBySelection: 0,
      databasesDeclared: manifest.databases.length,
      databasesWithQuestions: 0,
      databasesUnused: manifest.databases,
      databasesMissing: [],
      databasesEmpty: [],
      unreadable: 0,
      population: [],
      gold: { present: false, agreement: null },
      verdict: 'blocked',
      blockedBy,
    };
  }

  const parsed = parseRows(readFileSync(questionFile, 'utf8'));
  if (parsed.length === 0) blockedBy.push('the question file parsed to zero rows');
  const deduped = dedupeQuestions(parsed);
  const pool = poolOf(deduped.rows, split);
  const scoped = withinDatabases(pool, manifest.databases);

  // The gold, when the split ships a second copy of it. Read positionally and compared exactly; a
  // mismatch is a blocker because a run built on two disagreeing copies of one answer reports a
  // number about neither.
  const goldFile = join(root, 'train_gold.sql');
  const gold = existsSync(goldFile)
    ? { present: true, agreement: compareGold(parsed, parseGoldLines(readFileSync(goldFile, 'utf8'))) }
    : { present: false, agreement: null };
  if (gold.agreement !== null) {
    if (gold.agreement.questions !== gold.agreement.gold) {
      blockedBy.push(
        `the gold has ${gold.agreement.gold} rows for ${gold.agreement.questions} questions`,
      );
    }
    if (gold.agreement.disagreeing.length > 0) {
      blockedBy.push(`the two copies of the gold disagree (first at row ${gold.agreement.disagreeing[0]?.index})`);
    }
  }

  const used = [...new Set(scoped.rows.map((row) => row.db_id))].sort();
  const declared = new Set(manifest.databases);
  const databasesMissing = used.filter((dbId) => !declared.has(dbId));

  const population: DatabaseReading[] = [];
  const databasesEmpty: string[] = [];
  let unreadable = 0;
  for (const dbId of used) {
    const path = resolveDatabase(root, dbId, manifest.nestedRoot === undefined ? [] : [manifest.nestedRoot]);
    if (!existsSync(path)) {
      unreadable += 1;
      population.push({ dbId, path, found: false, tables: 0, rows: 0 });
      continue;
    }
    const counted = populationOf(path);
    population.push({ dbId, path, found: true, tables: counted.tables, rows: counted.rows });
    if (counted.tables === 0 || counted.rows === 0) databasesEmpty.push(dbId);
  }
  if (unreadable > 0) blockedBy.push(`${unreadable} database file(s) not found under ${root}`);
  if (databasesEmpty.length > 0) blockedBy.push(`${databasesEmpty.length} database(s) hold no rows`);
  if (databasesMissing.length > 0) blockedBy.push(`${databasesMissing.length} database(s) outside the manifest`);

  return {
    split,
    manifest: { name: manifest.name, version: manifest.version, bytes: manifest.bytes, sha256: manifest.sha256 },
    root,
    questionFile,
    questions: parsed.length,
    duplicates: deduped.duplicates,
    pool: pool.length,
    selected: scoped.rows.length,
    excludedBySelection: scoped.dropped,
    databasesDeclared: manifest.databases.length,
    databasesWithQuestions: used.length,
    databasesUnused: scoped.unused,
    databasesMissing,
    databasesEmpty,
    unreadable,
    population,
    gold,
    verdict: blockedBy.length === 0 ? 'ready' : 'blocked',
    blockedBy,
  };
}

const requested = (process.env['SOTA_SPLIT'] ?? '').trim();
const splits: readonly Split[] = requested === '' ? SPLITS : [splitFrom(requested)];
const readings = splits.map(readSplit);

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(
  OUT,
  `${JSON.stringify(
    {
      splits: readings,
      note:
        'A precheck, not a run: no model is called and no accuracy is produced. `selected` is the ' +
        'number of questions the lane can score once the manifest\'s database selection is applied, ' +
        'and `verdict` is `ready` only when every database those questions need exists, opens, and ' +
        'holds rows.',
    },
    null,
    2,
  )}\n`,
);

for (const reading of readings) {
  process.stdout.write(
    `[precheck] ${reading.split}: ${reading.questions} questions, ${reading.selected} selected ` +
      `over ${reading.databasesWithQuestions} databases — ${reading.verdict}\n`,
  );
  for (const reason of reading.blockedBy) process.stdout.write(`[precheck]   blocked: ${reason}\n`);
}
process.stdout.write(`[precheck] wrote ${OUT}\n`);
