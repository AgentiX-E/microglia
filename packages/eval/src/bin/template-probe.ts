/**
 * R10's and R11's price, read before either is paid.
 *
 * Both stages' kill conditions are stated over a share of the family withheld as unbindable: *if more
 * than 60% is withheld, the measurement is about the binder and not about transfer, and no verdict is
 * issued.* That is a sentence about schemas and questions, and both are available offline — so the
 * number can be had for zero model calls instead of 2,600, and a construction that cannot bind is
 * refused before it is dispatched rather than after.
 *
 * What this command reads: every rule the artefact carries (its statement and the database it was
 * learned in), the questions of the split it measured, the tables and columns of each database, and
 * the two binders. It reads no answer and no model, so it cannot say whether a bound rule helps; it
 * can say whether there is anything to show.
 *
 * **Two censuses, because there are two binders.** R10 compares names against the whole target
 * schema; R11 compares a table slot against the tables the *question* links, and a column slot
 * against the columns of the table it bound to. The second reads questions where the first reads only
 * schemas, so the two are reported apart: `poc-template-census.json` is R10's record and
 * `poc-template-linked-census.json` is R11's.
 *
 * It exits zero whatever either census says, because a construction rejected by its own
 * pre-registered condition is a result and not a build failure.
 */
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import {
  bindingCensus,
  dedupeQuestions,
  linkTargetOf,
  linkedCensus,
  parseManifest,
  poolOf,
  resolveDatabase,
  schemaIndex,
  schemaSql,
  splitFrom,
  tableShapes,
  type CensusRule,
  type LinkedQuestion,
  type LinkTarget,
  type SchemaNames,
  type TableShape,
} from '@agentix-e/microglia-eval';
import { birdArtefactPath, writeJson } from './lib.js';

type Artifact = {
  readonly items?: readonly { readonly id: string; readonly statement?: string; readonly domain?: string | null }[];
};

type Row = {
  readonly db_id: string;
  readonly question_id: number;
  readonly question: string;
  readonly evidence?: string;
  readonly SQL: string;
  readonly difficulty: string;
};

const REPO = process.cwd();
const SPLIT = splitFrom(process.env['SOTA_SPLIT']);
const MANIFEST = join(REPO, 'eval', 'manifests', SPLIT === 'dev' ? 'bird-dev.json' : 'bird-minidev.json');
const DB_DIR = process.env['BIRD_DB_DIR'] ?? join(process.cwd(), 'eval', 'fixtures', 'bird-minidev');

/** The share above which a stage issues no verdict, fixed in the pre-registration before this existed. */
const KILL_SHARE = 0.6;

/** Where the questions sit, under the layouts a vendor archive and a hand extraction produce. */
function questionsPath(name: string): string | undefined {
  const candidates = [
    join(DB_DIR, name),
    join(DB_DIR, 'MINIDEV', name),
    join(DB_DIR, 'minidev', 'MINIDEV', name),
    join(DB_DIR, 'dev_20240627', name),
  ];
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  return undefined;
}

/** Percent with one decimal, the form every lane in this repository prints a share in. */
function share(part: number, whole: number): string {
  return `${part}/${whole}=${(whole === 0 ? 0 : (part / whole) * 100).toFixed(1)}%`;
}

async function main(): Promise<void> {
  const artifact = JSON.parse(readFileSync(birdArtefactPath(), 'utf8')) as Artifact;
  const stored = artifact.items ?? [];
  if (stored.length === 0) {
    process.stdout.write(
      '[template] this artefact carries no store: the binder has nothing to read, which is a reading\n' +
        '[template] about the run and not about the construction\n',
    );
    return;
  }

  const rules: CensusRule[] = stored
    .filter((item): item is typeof item & { statement: string } => typeof item.statement === 'string')
    .map((item) => ({ id: item.id, statement: item.statement, domain: item.domain ?? null }));

  // The databases the store covers, kept only if this machine has them: a census over schemas that
  // cannot be opened would report a binder failure that is really a missing file.
  const claimed = [...new Set(rules.map((rule) => rule.domain).filter((id): id is string => id !== null))].sort();
  const paths = new Map<string, string>();
  const missing: string[] = [];
  for (const dbId of claimed) {
    const path = resolveDatabase(DB_DIR, dbId);
    if (existsSync(path)) paths.set(dbId, path);
    else missing.push(dbId);
  }
  if (paths.size < 2) {
    process.stdout.write(
      `[template] ${paths.size} of ${claimed.length} database(s) readable under ${DB_DIR}; a binder needs\n` +
        '[template] one to read the rule in and a different one to bind it against, so there is nothing to\n' +
        '[template] measure here. Set BIRD_DB_DIR to an extracted copy of the split this artefact measured.\n',
    );
    return;
  }

  const names = new Map<string, SchemaNames>();
  for (const [dbId, path] of paths) {
    const index = schemaIndex(path);
    names.set(dbId, { tables: index.tables, columns: index.columns });
  }
  const census = bindingCensus(rules, [...paths.keys()], (dbId) => names.get(dbId) as SchemaNames);

  process.stdout.write(
    `[template] ${census.rules} rule(s) against ${paths.size} database(s): ` +
      `${census.homeless} homeless, ${census.unplaced} unplaced, ` +
      `${census.rulesBound + census.rulesSlotless + census.rulesWithheld} attempted` +
      `${census.duplicates === 0 ? '' : ` (${census.duplicates} entry(s) named a rule already counted)`}\n`,
  );
  if (missing.length > 0) {
    process.stdout.write(`[template] not on this machine: ${missing.join(', ')}\n`);
  }
  const attempted = census.rulesBound + census.rulesSlotless + census.rulesWithheld;
  process.stdout.write(
    `[template] rules: ${share(census.rulesBound, attempted)} bound, ` +
      `${share(census.rulesSlotless, attempted)} slotless, ` +
      `${share(census.rulesWithheld, attempted)} withheld\n`,
  );
  const coverage = census.coverage;
  process.stdout.write(
    `[template] attempts: ${share(coverage.bound, coverage.bound + coverage.slotless + coverage.withheld)} bound, ` +
      `${share(coverage.slotless, coverage.bound + coverage.slotless + coverage.withheld)} slotless, ` +
      `${share(coverage.withheld, coverage.bound + coverage.slotless + coverage.withheld)} withheld ` +
      `over ${coverage.rules} rule(s)\n`,
  );
  for (const blocker of coverage.blockers.slice(0, 10)) {
    process.stdout.write(
      `[template] blocker: ${blocker.kind} '${blocker.name}' stopped ${blocker.attempts} attempt(s)\n`,
    );
  }
  // The verdict this command exists to reach. It is stated as the pre-registration states it — over
  // rules — and it names what the run would have measured instead of what it would have shown.
  process.stdout.write(
    census.withheldShare > KILL_SHARE
      ? `[template] ${(census.withheldShare * 100).toFixed(1)}% of the attempted family is withheld, above the ` +
          `${(KILL_SHARE * 100).toFixed(0)}% the pre-registration fixes as its kill condition: an arm-B dispatch ` +
          'would measure the binder and not the hypothesis, so no verdict is issued from it\n'
      : `[template] ${(census.withheldShare * 100).toFixed(1)}% withheld, inside the pre-registration's ` +
          `${(KILL_SHARE * 100).toFixed(0)}% condition: arm B can be dispatched and read as a test of transfer\n`,
  );
  // The number goes into an artefact before it goes into a sentence. A census quoted only from a
  // terminal is a claim nobody can recompute, and this project has spent three iterations on what
  // happens to those.
  await writeJson('poc-template-census', {
    id: 'poc-template-census',
    source: basename(birdArtefactPath()),
    binder: 'name-jaccard',
    databases: [...paths.keys()],
    rules: census.rules,
    duplicates: census.duplicates,
    homeless: census.homeless,
    unplaced: census.unplaced,
    bound: census.rulesBound,
    slotless: census.rulesSlotless,
    withheld: census.rulesWithheld,
    withheld_share: Number(census.withheldShare.toFixed(4)),
    attempts: {
      bound: census.coverage.bound,
      slotless: census.coverage.slotless,
      withheld: census.coverage.withheld,
    },
    blockers: census.coverage.blockers.slice(0, 20),
    kill_share: KILL_SHARE,
    verdict: census.withheldShare > KILL_SHARE ? 'refused' : 'dispatchable',
    generated_at: new Date().toISOString(),
  });

  await censusByLink(rules, paths);
}

/**
 * R11's census: the same rules, the same databases, and the questions the split scores.
 *
 * A rule is now attempted once per *foreign question* rather than once per foreign database, because
 * the binder reads the question's links and two questions in one database link different tables. The
 * attempt is the unit the arm spends a call on, so it is the unit the kill condition is stated over;
 * the rule share is reported beside it because R10's 66.8% was stated that way and the two stages
 * have to be comparable.
 */
async function censusByLink(
  rules: readonly CensusRule[],
  paths: ReadonlyMap<string, string>,
): Promise<void> {
  const manifest = parseManifest(JSON.parse(readFileSync(MANIFEST, 'utf8')));
  const path = questionsPath(manifest.questions);
  if (path === undefined) {
    process.stdout.write(
      `[template] no ${manifest.questions} under ${DB_DIR}: R11's census reads questions, and without\n` +
        '[template] them the link is undefined. Set BIRD_DB_DIR to the extracted split, or BIRD_QUESTIONS\n' +
        '[template] to the file itself.\n',
    );
    return;
  }
  const raw = JSON.parse(readFileSync(path, 'utf8')) as readonly Row[];
  const deduped = dedupeQuestions(raw);
  const rows = poolOf(deduped.rows, SPLIT);
  const questions: LinkedQuestion[] = rows.map((row) => ({
    id: `${row.db_id}#${row.question_id}`,
    dbId: row.db_id,
    question: row.question,
    evidence: row.evidence ?? '',
  }));

  const shapes = new Map<string, readonly TableShape[]>();
  const shapesOf = (dbId: string): readonly TableShape[] => {
    const hit = shapes.get(dbId);
    if (hit !== undefined) return hit;
    const file = paths.get(dbId) ?? resolveDatabase(DB_DIR, dbId);
    const read = existsSync(file) ? tableShapes(file) : [];
    shapes.set(dbId, read);
    return read;
  };
  const links = new Map<string, LinkTarget>();
  const linkOf = (question: LinkedQuestion): LinkTarget => {
    const hit = links.get(question.id);
    if (hit !== undefined) return hit;
    const file = paths.get(question.dbId) ?? resolveDatabase(DB_DIR, question.dbId);
    const target = existsSync(file)
      ? linkTargetOf(shapesOf(question.dbId), schemaSql(file), question.question, question.evidence)
      : { tables: [], anchors: new Set<string>() };
    links.set(question.id, target);
    return target;
  };

  const linked = linkedCensus(rules, questions, shapesOf, linkOf);
  const attempted = linked.rulesBound + linked.rulesSlotless + linked.rulesWithheld;
  const coverage = linked.coverage;
  const total = coverage.bound + coverage.slotless + coverage.withheld;
  process.stdout.write(
    `[template] R11: ${linked.rules} rule(s) against ${linked.questions} question(s) of ${manifest.name}` +
      ` (${linked.homeless} homeless, ${linked.unplaced} unplaced, ${linked.duplicates} duplicate entry(s))\n`,
  );
  process.stdout.write(
    `[template] R11 rules: ${share(linked.rulesBound, attempted)} bound, ` +
      `${share(linked.rulesSlotless, attempted)} slotless, ${share(linked.rulesWithheld, attempted)} withheld\n`,
  );
  process.stdout.write(
    `[template] R11 attempts: ${share(coverage.bound, total)} bound, ${share(coverage.slotless, total)} slotless, ` +
      `${share(coverage.withheld, total)} withheld over ${coverage.rules} rule(s)\n`,
  );
  for (const blocker of coverage.blockers.slice(0, 10)) {
    process.stdout.write(
      `[template] R11 blocker: ${blocker.kind} '${blocker.name}' stopped ${blocker.attempts} attempt(s)\n`,
    );
  }
  for (const reason of coverage.reasons) {
    process.stdout.write(
      `[template] R11 why: ${reason.reason} stopped ${share(reason.attempts, coverage.withheld)} of the withheld\n`,
    );
  }
  process.stdout.write(
    linked.withheldShare > KILL_SHARE
      ? `[template] R11: ${(linked.withheldShare * 100).toFixed(1)}% of attempts are withheld, above the ` +
          `${(KILL_SHARE * 100).toFixed(0)}% kill condition: the arm would measure the binder, so no verdict is issued\n`
      : `[template] R11: ${(linked.withheldShare * 100).toFixed(1)}% of attempts withheld, inside the ` +
          `${(KILL_SHARE * 100).toFixed(0)}% condition: arm B can be dispatched and read as a test of transfer\n`,
  );
  await writeJson('poc-template-linked-census', {
    id: 'poc-template-linked-census',
    source: basename(birdArtefactPath()),
    split: SPLIT,
    binder: 'link-role',
    questions_source: basename(path),
    questions: linked.questions,
    databases: [...paths.keys()],
    rules: linked.rules,
    duplicates: linked.duplicates,
    homeless: linked.homeless,
    unplaced: linked.unplaced,
    rules_bound: linked.rulesBound,
    rules_slotless: linked.rulesSlotless,
    rules_withheld: linked.rulesWithheld,
    rules_withheld_share: Number(linked.rulesWithheldShare.toFixed(4)),
    withheld_share: Number(linked.withheldShare.toFixed(4)),
    attempts: { bound: coverage.bound, slotless: coverage.slotless, withheld: coverage.withheld },
    blockers: coverage.blockers.slice(0, 20),
    withheld_by: coverage.reasons,
    kill_share: KILL_SHARE,
    verdict: linked.withheldShare > KILL_SHARE ? 'refused' : 'dispatchable',
    generated_at: new Date().toISOString(),
  });
}

await main();
