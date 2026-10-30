/**
 * Score any generator against a self-contained case file, and write an artefact a stranger can check.
 *
 * The input is one JSON document: some databases as DDL plus rows, some questions with their
 * gold SQL, and a generator module path. Everything the run needs is in that file, so a third
 * party does not have to install a benchmark, download an archive, or read our loader to
 * reproduce a number — the CLI builds the databases in a temporary directory, executes the
 * gold to get the expected rows, asks the generator once per case, executes its answer, and
 * scores the pair.
 *
 * Three properties are deliberate:
 *
 *  1. **Gold executes or the run refuses to start.** A case whose gold SQL throws would be
 *     scored against nothing, and a run that silently drops those cases reports an accuracy
 *     over a set it never stated.
 *  2. **An unexecutable answer is wrong, not missing.** It stays in the denominator of the
 *     answer rate, which is the gate that separates "the model cannot write SQL" from "the
 *     generator is broken".
 *  3. **The artefact is validated before it is written.** A file that fails its own schema
 *     never reaches disk, so a committed artefact is always a valid one.
 *
 * Usage:
 *   tsx packages/eval/src/bin/plugin-run.ts \
 *     --cases eval/cases/fixture.json \
 *     --plugin eval/plugins/keyword-router.mjs \
 *     --prereg R8.1-offline-fixture \
 *     --out eval/results/poc-plugin-fixture.json \
 *     --report eval/results/poc-plugin-fixture.md
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  loadGenerator,
  readPrereg,
  preregGate,
  runArtifactJson,
  runArtifactReport,
  runGenerator,
  validateRunArtifact,
  type PluginCase,
  type ResultComparison,
  type Scorer,
} from '@agentix-e/microglia-eval';
import { executeQuery } from '@agentix-e/microglia-eval';

type CaseFile = {
  readonly id: string;
  readonly comparison?: ResultComparison;
  readonly databases: readonly {
    readonly dbId: string;
    readonly ddl: readonly string[];
    readonly rows: readonly string[];
  }[];
  readonly cases: readonly {
    readonly id: string;
    readonly dbId: string;
    readonly question: string;
    readonly evidence?: string;
    readonly goldSql: string;
  }[];
};

function argument(name: string, fallback?: string): string {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1 || process.argv[index + 1] === undefined) {
    if (fallback !== undefined) return fallback;
    throw new Error(`missing --${name}`);
  }
  return process.argv[index + 1] as string;
}

async function main(): Promise<void> {
  const root = process.cwd();
  const casesPath = argument('cases');
  const pluginPath = argument('plugin');
  const preregId = argument('prereg');
  const outPath = argument('out');
  const reportPath = argument('report');
  const concurrency = Number(argument('concurrency', '1'));
  const now = argument('now', new Date().toISOString());

  const file = JSON.parse(readFileSync(casesPath, 'utf8')) as CaseFile;
  const comparison: ResultComparison = file.comparison ?? 'multiset';

  // One directory for the databases, removed afterwards: the run leaves no state behind, so
  // two runs of the same case file cannot differ because of what an earlier one created.
  const workspace = mkdtempSync(join(tmpdir(), 'microglia-plugin-'));
  try {
    const paths = new Map<string, string>();
    const ddlOf = new Map<string, string>();
    for (const database of file.databases) {
      const path = join(workspace, `${database.dbId}.sqlite`);
      const db = new DatabaseSync(path);
      for (const statement of [...database.ddl, ...database.rows]) db.exec(statement);
      db.close();
      paths.set(database.dbId, path);
      ddlOf.set(database.dbId, database.ddl.join('\n'));
    }

    const cases: PluginCase[] = file.cases.map((entry) => {
      const path = paths.get(entry.dbId);
      if (path === undefined) throw new Error(`case ${entry.id} names unknown database ${entry.dbId}`);
      const gold = executeQuery(path, entry.goldSql);
      if (!gold.ok) {
        throw new Error(`gold SQL for ${entry.id} does not execute: ${gold.error ?? 'unknown'}`);
      }
      return {
        id: entry.id,
        dbId: entry.dbId,
        question: entry.question,
        evidence: entry.evidence ?? '',
        ddl: ddlOf.get(entry.dbId) ?? '',
        gold: gold.canonical,
      };
    });

    const score: Scorer = (sql, item) => {
      const path = paths.get(item.dbId);
      if (path === undefined) return undefined;
      const outcome = executeQuery(path, sql);
      return outcome.ok ? outcome.canonical : undefined;
    };

    const loaded = await loadGenerator(pluginPath, { cwd: root });
    const preregSource = readFileSync(join(root, 'prereg', `${preregId}.md`), 'utf8');
    const reading = readPrereg(preregSource, `prereg/${preregId}.md`);
    const gate = preregGate(reading);
    if (!gate.ok) {
      process.stderr.write(`[plugin] ${gate.detail}\n`);
      process.exitCode = 1;
      return;
    }

    const artifact = await runGenerator({
      generator: loaded.generator,
      source: loaded.source,
      insidePackage: loaded.insidePackage,
      cases,
      score,
      comparison,
      concurrency,
      prereg: { id: preregId, resolved: reading.prereg !== undefined },
      id: argument('id', file.id),
      now: now.endsWith('Z') && now.includes('T') ? now : new Date(now).toISOString(),
    });

    const verdict = validateRunArtifact(artifact);
    if (!verdict.ok) {
      for (const problem of verdict.problems) {
        process.stderr.write(`[plugin] ${problem.path}: ${problem.problem}\n`);
      }
      process.exitCode = 1;
      return;
    }

    writeFileSync(join(root, outPath), runArtifactJson(artifact));
    writeFileSync(join(root, reportPath), runArtifactReport(artifact));

    const failed = artifact.gates.filter((entry) => !entry.ok);
    process.stdout.write(
      `[plugin] ${artifact.id}: ${artifact.metrics.correct}/${artifact.metrics.n} correct ` +
        `(${(100 * artifact.metrics.accuracy).toFixed(2)}%, 95% CI ` +
        `${(100 * artifact.metrics.low).toFixed(2)}–${(100 * artifact.metrics.high).toFixed(2)}%)\n`,
    );
    for (const entry of artifact.gates) {
      process.stdout.write(`[plugin] ${entry.code} ${entry.name}: ${entry.ok ? 'pass' : 'FAIL'} — ${entry.detail}\n`);
    }
    process.stdout.write(`[plugin] wrote ${relative(root, join(root, outPath))} and ${reportPath}\n`);
    if (failed.length > 0) process.exitCode = 1;
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`[plugin] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
