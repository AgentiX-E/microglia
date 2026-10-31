/**
 * The protocol gate: everything an artefact claims, checked from the artefact.
 *
 * Four claims, all offline, all deterministic:
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
 *  4. **A pre-registration is the one its run was judged by.** The gate list in the header and
 *     the gate list in the artefact are equal, in both directions, for every committed artefact
 *     that names a file. Neither side can check the other alone; this script holds both.
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
  preregGateAgreement,
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

/**
 * Claim 4: a pre-registration's gate list is the gate list its run emitted.
 *
 * The artefact is the half of the claim the pre-registration cannot see, and `prereg/` is the
 * half the artefact cannot see, so neither a dispatch nor `eval:prereg` can check this on its
 * own. The repository holds both: every committed artefact that names a pre-registration in
 * `config.prereg` is paired with that file here, and the two lists must be equal in both
 * directions. An artefact that names no pre-registration is not a failure — most of them predate
 * the field — but it is not silently counted either.
 */
function checkPreregAgreement(): readonly Failure[] {
  const directory = join(ROOT, 'eval/results');
  const files = readdirSync(directory)
    .filter((entry) => entry.endsWith('.json'))
    .sort();
  const failures: Failure[] = [];
  let paired = 0;
  for (const entry of files) {
    const path = `eval/results/${entry}`;
    let artifact: {
      readonly config?: { readonly prereg?: unknown };
      readonly gates?: readonly { readonly id: string }[];
    };
    try {
      artifact = readJson(path);
    } catch {
      // A file this script cannot parse is a different check's problem; the artefact schema
      // verdict owns it, and refusing here would report one defect twice.
      continue;
    }
    const named = artifact.config?.prereg;
    if (typeof named !== 'string' || named === '') continue;
    paired += 1;
    let source: string;
    try {
      source = readFileSync(join(ROOT, named), 'utf8');
    } catch {
      failures.push({ check: path, detail: `names ${named}, which is not in the repository` });
      continue;
    }
    const reading = readPrereg(source, named);
    if (reading.prereg === undefined) {
      failures.push({
        check: path,
        detail: `${named} is not a pre-registration: ${reading.problems[0]?.problem ?? 'unreadable'}`,
      });
      continue;
    }
    const emitted = (artifact.gates ?? []).map((gate) => gate.id);
    const agreement = preregGateAgreement(reading.prereg, emitted);
    process.stdout.write(`[protocol] ${agreement.ok ? 'pass' : 'FAIL'} ${path} — ${named}: ${agreement.detail}\n`);
    if (!agreement.ok) failures.push({ check: path, detail: `${named}: ${agreement.detail}` });
  }
  if (paired === 0) {
    process.stdout.write('[protocol] skip prereg agreement — no artefact names a pre-registration\n');
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
/**
 * Every BIRD artefact a cell can be derived from, in the order they are reported.
 *
 * Two splits, two rows: the 350-question Mini-Dev run can only ever be `indicative` — its split
 * name differs from the published cell's — and the 1,534-question dev run can be `reproduced`.
 * Keeping both rows is the point. A table that showed only the newer one would erase the reading
 * that motivated the newer one, and a row is only honest if the artefact behind it is still in
 * the repository to be recomputed.
 */
const CELL_SOURCES: readonly { readonly path: string; readonly cell: string }[] = [
  { path: 'eval/results/poc-sota-bird.json', cell: 'xiyan-deepseek-ddl' },
  { path: 'eval/results/poc-sota-bird-dev.json', cell: 'xiyan-deepseek-ddl' },
];

type SourcedComparison = CellComparison & { readonly source: string };

function checkCells(recordPath: string): readonly Failure[] {
  const failures: Failure[] = [];
  const cells: SourcedComparison[] = [];
  for (const source of CELL_SOURCES) {
    let artifact: {
      readonly dataset: string;
      readonly n: { readonly total: number };
      readonly metrics: { readonly accuracy_without_memory: number };
    };
    try {
      artifact = readJson(source.path);
    } catch {
      // A split that has not been run yet is not a failure: the dev artefact exists only after a
      // dispatch that cost 1,534 questions, and a repository that refused to build until then
      // would make the gate a reason not to measure.
      process.stdout.write(`[protocol] skip ${source.path} — no committed run for that split\n`);
      continue;
    }
    const estimate = { accuracy: artifact.metrics.accuracy_without_memory, n: artifact.n.total };
    const split = { name: artifact.dataset, n: artifact.n.total };
    const comparison = compareCell({ cell: source.cell, estimate, split });
    const gate = cellGate(comparison, estimate, split);
    if (!gate.ok) failures.push({ check: source.path, detail: gate.detail });
    cells.push({ ...comparison, source: source.path });
  }

  if (cells.length === 0) {
    failures.push({ check: recordPath, detail: 'no BIRD artefact exists, so no cell can be derived' });
    return failures;
  }

  const record = {
    schema: 'microglia.cell-comparison/1',
    note:
      'Derived, not measured: every row is recomputed from a committed BIRD artefact, and each row ' +
      'names the file it came from. A cross-split comparison is indicative by construction and the ' +
      'gate refuses any record that says otherwise.',
    cells,
  };
  const text = `${JSON.stringify(record, null, 2)}\n`;
  const path = join(ROOT, recordPath);
  const summary = cells.map((cell) => `${cell.verdict} at ${cell.diffPp}pp`).join(', ');
  if (WRITE) {
    writeFileSync(path, text);
    process.stdout.write(`[protocol] wrote ${recordPath} — ${summary}\n`);
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
      detail: `the recorded comparison differs from the arithmetic (${summary})`,
    });
  } else {
    for (const cell of cells) {
      process.stdout.write(
        `[protocol] pass ${cell.source} — ${cell.cell} ${cell.verdict}: ` +
          `${cell.oursPp}pp against ${cell.publishedPp}pp on ${cell.publishedSplit}\n`,
      );
    }
  }
  return failures;
}

function main(): void {
  const failures = [
    ...checkPreregistrations(),
    ...checkPreregAgreement(),
    ...checkReport('eval/results/poc-plugin-fixture.json', 'eval/results/poc-plugin-fixture.md'),
    ...checkCells('eval/results/poc-cell-comparison.json'),
  ];
  if (failures.length > 0) {
    for (const failure of failures) process.stderr.write(`[protocol] FAIL ${failure.check}: ${failure.detail}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write('[protocol] all claims hold\n');
}

main();
