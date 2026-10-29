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
    runs.push({
      id: artifact.source_generated_at ?? artifact.id ?? file,
      rules: summary.rules ?? 0,
      injected: summary.injectedRules ?? 0,
      helpful: summary.helpful ?? 0,
      harmful: summary.harmful ?? 0,
      neutral: summary.neutral ?? 0,
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
    `[store] ${report.runs} run(s), ${report.rules} stored rule(s), ${report.injected} injected ` +
      `instance(s) = ${(report.injectedShare * 100).toFixed(1)}% of the store ever reached a prompt\n` +
      `[store] of the instances that reached a prompt: ` +
      `${(report.helpfulShare * 100).toFixed(2)}% repaired the answer ` +
      `(${report.helpful}), ${(report.harmfulShare * 100).toFixed(2)}% broke it (${report.harmful}), ` +
      `${(report.neutralShare * 100).toFixed(2)}% changed nothing (${report.neutral})\n` +
      `[store] net ${report.net} instance(s) = ${(report.netShare * 100).toFixed(2)}pp of the ` +
      `injected population; exact McNemar p=${report.p.toPrecision(3)}\n`,
  );
  for (const entry of report.perRun) {
    const share = entry.injected === 0 ? 0 : entry.harmful / entry.injected;
    process.stdout.write(
      `[store] ${entry.id}  rules ${entry.rules}  injected ${entry.injected}  ` +
        `+${entry.helpful} / -${entry.harmful} / =${entry.neutral}  ` +
        `broken ${(share * 100).toFixed(1)}%\n`,
    );
  }
}

main();
