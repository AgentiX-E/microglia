/**
 * The protocol gate: everything an artefact claims, checked from the artefact.
 *
 * Three claims, all offline, all deterministic:
 *
 *  1. **Every pre-registration is one.** A file with a missing refutation section, an unfilled
 *     placeholder, or an id that disagrees with its name is refused here and by the workflow.
 *  2. **The committed run reproduces its own report.** The report beside the fixture artefact
 *     must be byte-identical to the one rendered from the JSON, and the JSON must pass the
 *     published schema. A report that has been edited by hand fails this, which is the point:
 *     prose that cannot drift is the deliverable.
 *  3. **No comparison claims more than its arithmetic.** The cell comparison is recomputed
 *     from the S2 artefact, and the committed record must equal the recomputation — including
 *     the verdict, so "indicative" cannot be upgraded to "reproduced" by editing a file.
 *
 * `--write` regenerates the derived files instead of comparing, so the committed copies and
 * the check that guards them come from one code path.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  compareCell,
  cellGate,
  preregGate,
  readPrereg,
  runArtifactReport,
  validateRunArtifact,
  type CellComparison,
  type RunArtifact,
} from '@agentix-e/microglia-eval';

const ROOT = process.cwd();
const WRITE = process.argv.includes('--write');

type Failure = { readonly check: string; readonly detail: string };

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(join(ROOT, path), 'utf8')) as T;
}

/** Claim 1: every pre-registration in the repository validates. */
function checkPreregistrations(): readonly Failure[] {
  const directory = join(ROOT, 'prereg');
  const files = readdirSync(directory)
    .filter((entry) => entry.endsWith('.md') && entry !== 'TEMPLATE.md')
    .sort();
  const failures: Failure[] = [];
  for (const entry of files) {
    const reading = readPrereg(readFileSync(join(directory, entry), 'utf8'), `prereg/${entry}`);
    const gate = preregGate(reading);
    process.stdout.write(`[protocol] ${gate.ok ? 'pass' : 'FAIL'} prereg/${entry} — ${gate.detail}\n`);
    if (!gate.ok) failures.push({ check: `prereg/${entry}`, detail: gate.detail });
  }
  return failures;
}

/** Claim 2: the committed artefact is valid, and its report is the one it renders. */
function checkReport(artifactPath: string, reportPath: string): readonly Failure[] {
  const artifact = readJson<RunArtifact>(artifactPath);
  const verdict = validateRunArtifact(artifact);
  const failures: Failure[] = [];
  for (const problem of verdict.problems) {
    failures.push({ check: artifactPath, detail: `${problem.path}: ${problem.problem}` });
  }
  const rendered = runArtifactReport(artifact);
  const committedPath = join(ROOT, reportPath);
  if (WRITE) {
    writeFileSync(committedPath, rendered);
    process.stdout.write(`[protocol] wrote ${reportPath}\n`);
    return failures;
  }
  let committed: string;
  try {
    committed = readFileSync(committedPath, 'utf8');
  } catch {
    failures.push({ check: reportPath, detail: 'the report is missing' });
    return failures;
  }
  if (committed !== rendered) {
    const line = firstDifference(committed, rendered);
    failures.push({ check: reportPath, detail: `the committed report differs from the artefact at line ${line}` });
  } else {
    process.stdout.write(`[protocol] pass ${reportPath} — reproduced from ${artifactPath}\n`);
  }
  return failures;
}

function firstDifference(left: string, right: string): number {
  const a = left.split('\n');
  const b = right.split('\n');
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return index + 1;
  }
  return 1;
}

/**
 * Claim 3: the recorded cell comparison equals the one the numbers imply.
 *
 * The estimate comes from the S2 artefact rather than from a fresh run: the comparison is
 * arithmetic over a measurement that already exists, and re-running the benchmark to
 * reproduce arithmetic would be a way of making the check expensive enough to skip.
 */
function checkCells(sourcePath: string, recordPath: string): readonly Failure[] {
  const source = readJson<{
    readonly dataset: string;
    readonly n: { readonly total: number };
    readonly metrics: { readonly accuracy_without_memory: number };
  }>(sourcePath);
  const estimate = { accuracy: source.metrics.accuracy_without_memory, n: source.n.total };
  const split = { name: source.dataset, n: source.n.total };
  const comparison = compareCell({ cell: 'xiyan-deepseek-ddl', estimate, split });
  const gate = cellGate(comparison, estimate, split);
  const record = {
    schema: 'microglia.cell-comparison/1',
    source: sourcePath,
    note:
      'Derived, not measured: recomputed from the committed S2 artefact. A cross-split comparison ' +
      'is indicative by construction and the gate refuses any record that says otherwise.',
    cells: [comparison] satisfies readonly CellComparison[],
  };
  const failures: Failure[] = [];
  if (!gate.ok) failures.push({ check: 'cell-comparison', detail: gate.detail });
  const text = `${JSON.stringify(record, null, 2)}\n`;
  const path = join(ROOT, recordPath);
  if (WRITE) {
    writeFileSync(path, text);
    process.stdout.write(`[protocol] wrote ${recordPath} — ${comparison.verdict} at ${comparison.diffPp}pp\n`);
    return failures;
  }
  let committed: string;
  try {
    committed = readFileSync(path, 'utf8');
  } catch {
    failures.push({ check: recordPath, detail: 'the comparison record is missing; run with --write' });
    return failures;
  }
  if (committed !== text) {
    failures.push({
      check: recordPath,
      detail: `the recorded comparison differs from the arithmetic (${comparison.verdict} at ${comparison.diffPp}pp)`,
    });
  } else {
    process.stdout.write(
      `[protocol] pass ${recordPath} — ${comparison.cell} ${comparison.verdict}: ` +
        `${comparison.oursPp}pp against ${comparison.publishedPp}pp on ${comparison.publishedSplit}\n`,
    );
  }
  return failures;
}

function main(): void {
  const failures = [
    ...checkPreregistrations(),
    ...checkReport('eval/results/poc-plugin-fixture.json', 'eval/results/poc-plugin-fixture.md'),
    ...checkCells('eval/results/poc-sota-bird.json', 'eval/results/poc-cell-comparison.json'),
  ];
  if (failures.length > 0) {
    for (const failure of failures) process.stderr.write(`[protocol] FAIL ${failure.check}: ${failure.detail}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write('[protocol] all claims hold\n');
}

main();
