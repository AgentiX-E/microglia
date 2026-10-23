/**
 * POC: which rules did the damage?
 *
 * An arm average says whether the pack helped; it cannot say whether the pack was
 * uniformly mediocre or mostly fine with a few harmful rules. That distinction
 * decides the fix — a retrieval change, a distillation change, or abandoning the
 * hypothesis — so it is computed from the artefact's per-case rows rather than
 * argued about.
 *
 * Reads `<results>/poc-sota-bird.json` and writes `poc-sota-attribution.json` beside
 * it, where `<results>` is `POC_RESULT_DIR` when set and `eval/results` otherwise —
 * the same rule every other lane follows, so the workflow's own steps can find both.
 * Association only: a rule present when a question flipped did not necessarily
 * cause the flip, and rules injected together share the credit.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { attributeRules, type AttributionCase, type AttributionItem } from '@agentix-e/microglia-eval';

type CaseRow = {
  readonly fold: number;
  readonly packIdList: readonly string[];
  readonly withoutMemoryCorrect: boolean;
  readonly correct: boolean;
};

type ItemRow = {
  readonly fold: number;
  readonly id: string;
  readonly statement: string;
};

type Artifact = {
  readonly per_case: readonly CaseRow[];
  readonly items: readonly ItemRow[];
  readonly n?: { readonly eval?: number };
  readonly generated_at?: string;
};

const RESULTS = process.env['POC_RESULT_DIR'] ?? join(process.cwd(), 'eval', 'results');

function main(): void {
  const artifact = JSON.parse(
    readFileSync(join(RESULTS, 'poc-sota-bird.json'), 'utf8'),
  ) as Artifact;

  const cases: AttributionCase[] = artifact.per_case.map((row) => ({
    fold: row.fold,
    injected: row.packIdList,
    baselineCorrect: row.withoutMemoryCorrect,
    treatmentCorrect: row.correct,
  }));
  const items: AttributionItem[] = artifact.items.map((row) => ({
    fold: row.fold,
    id: row.id,
    statement: row.statement,
  }));

  const summary = attributeRules(cases, items);
  const output = {
    id: 'poc-sota-attribution',
    source_artifact: 'poc-sota-bird.json',
    source_generated_at: artifact.generated_at ?? null,
    n: cases.length,
    summary,
  };
  writeFileSync(join(RESULTS, 'poc-sota-attribution.json'), `${JSON.stringify(output, null, 2)}\n`);

  process.stdout.write(
    `[attribution] ${summary.injectedRules} of ${summary.rules} rules were ever injected; ` +
      `${summary.harmful} harmful, ${summary.helpful} helpful, ${summary.neutral} neutral; ` +
      `${(summary.harmfulShare * 100).toFixed(1)}% of injections belong to a harmful rule\n`,
  );
  for (const rule of summary.top.slice(0, 5)) {
    process.stdout.write(
      `[attribution] fold ${rule.fold} net=${rule.net} injected=${rule.injected} :: ${rule.statement.slice(0, 110)}\n`,
    );
  }
}

main();
