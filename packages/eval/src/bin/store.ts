/**
 * POC: what the store contained, and what happened when it was shown.
 *
 * Every attribution artefact under the results directory — including the archived ones — carries a
 * per-rule summary: how many rules the distiller kept, how many rule instances reached a prompt, and
 * how many of those repaired an answer versus broke one. This command adds them up and prints the
 * distribution, because the distribution is the answer to a question the accuracy deltas cannot
 * answer: not "did the pack help" but "what is in the pack".
 *
 * It reads files rather than a single artefact because the shape is a property of the store across
 * runs, and one run is a sample of it. Archived runs are included deliberately: an analysis that
 * quietly used only the newest file would be reporting the last run's luck.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { storeReport, type StoreRun } from '@agentix-e/microglia-eval';

type AttributionArtifact = {
  readonly id?: string;
  readonly source_generated_at?: string;
  readonly summary?: {
    readonly rules?: number;
    readonly injectedRules?: number;
    readonly helpful?: number;
    readonly harmful?: number;
    readonly neutral?: number;
    readonly harmfulShare?: number;
  };
};

const RESULTS = process.env['POC_RESULT_DIR'] ?? join(process.cwd(), 'eval', 'results');

/** Every attribution artefact under the results directory, history included. */
function attributionFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      found.push(...attributionFiles(path));
      continue;
    }
    if (!entry.endsWith('.json')) continue;
    if (!entry.includes('attribution')) continue;
    found.push(path);
  }
  return found.sort();
}

function main(): void {
  const files = attributionFiles(RESULTS);
  const runs: StoreRun[] = [];
  for (const file of files) {
    const artifact = JSON.parse(readFileSync(file, 'utf8')) as AttributionArtifact;
    const summary = artifact.summary;
    // An attribution file without a summary is a failed run's placeholder. Skipping it is honest:
    // counting it as a run with zero rules would enter a zero into the mean that no run measured.
    if (summary === undefined) continue;
    // The artefact's `helpful`, `harmful` and `neutral` count rules, not instances: they sum to
    // `injectedRules`. `harmfulShare` is the only instance-weighted number in the summary, and it is
    // carried separately rather than mixed into a total that would silently mix two units.
    runs.push({
      id: artifact.source_generated_at ?? artifact.id ?? file,
      rules: summary.rules ?? 0,
      injectedRules: summary.injectedRules ?? 0,
      helpfulRules: summary.helpful ?? 0,
      harmfulRules: summary.harmful ?? 0,
      neutralRules: summary.neutral ?? 0,
      harmfulInstanceShare: summary.harmfulShare ?? 0,
    });
  }
  if (runs.length === 0) {
    process.stdout.write(
      `[store] no attribution artefact under ${RESULTS}: run pnpm eval:attribute first\n`,
    );
    return;
  }

  const report = storeReport(runs);
  process.stdout.write(
    `[store] ${report.runs} run(s), ${report.rules} stored rule(s); ${report.injectedRules} of them ` +
      `reached a prompt = ${(report.injectedShare * 100).toFixed(1)}% of the store\n` +
      // Rule counts, named as rule counts. The artefact's classes sum to the injected rules, so a
      // reader who takes them for instances reads a claim an order of magnitude stronger.
      `[store] of those rules: ${(report.helpfulShare * 100).toFixed(2)}% net-repaired ` +
      `(${report.helpfulRules}), ${(report.harmfulShare * 100).toFixed(2)}% net-broke ` +
      `(${report.harmfulRules}), ${(report.neutralShare * 100).toFixed(2)}% washed out ` +
      `(${report.neutralRules})\n` +
      `[store] net ${report.net} rule(s); exact sign test p=${report.p.toPrecision(3)}; ` +
      `instance-weighted harmful share across runs ` +
      `${(report.harmfulInstanceRange.low * 100).toFixed(1)}%-` +
      `${(report.harmfulInstanceRange.high * 100).toFixed(1)}%\n`,
  );
  for (const entry of report.perRun) {
    process.stdout.write(
      `[store] ${entry.id}  rules ${entry.rules}  injected ${entry.injectedRules}  ` +
        `+${entry.helpfulRules} / -${entry.harmfulRules} / =${entry.neutralRules}  ` +
        `harmful instances ${(entry.harmfulInstanceShare * 100).toFixed(1)}%\n`,
    );
  }
}

main();
