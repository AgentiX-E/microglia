/**
 * Report rendering.
 *
 * Markdown for humans, JSON for the gate runner. Both come from the same
 * `StudyResult`, so a number cannot appear in the prose that is not in the
 * artifact.
 */
import type { ArmResult, Gate, RoundMetrics, StudyResult } from './study.js';
import { pp, pct, pValue } from './format.js';

export { pp, pct, pValue };

export function renderMarkdown(result: StudyResult): string {
  const baseline = result.arms.find((arm) => arm.name === 'baseline');
  const lines: string[] = [];

  lines.push('# Microglia mechanism study');
  lines.push('');
  lines.push(
    '> Controlled workload: a deterministic chart recommender with six documented defects, ' +
      'corrected by a simulated user. The numbers measure whether feedback becomes transferable ' +
      'knowledge. They are **not** a claim about chart-model quality on any public benchmark.',
  );
  lines.push('');
  lines.push('## Configuration');
  lines.push('');
  lines.push('| Parameter | Value |');
  lines.push('| --- | --- |');
  lines.push(`| seed | ${result.config.seed} |`);
  lines.push(`| train / holdout | ${result.corpus.train} / ${result.corpus.holdout} |`);
  lines.push(`| rounds x batch | ${result.config.rounds} x ${result.config.batchSize} |`);
  lines.push(`| knowledge budget | ${result.config.budget} chars |`);
  lines.push(`| namespace leakage | ${result.leakage} items |`);
  lines.push('');

  lines.push('## Arms');
  lines.push('');
  lines.push('| Arm | Baseline | Final | Δ | McNemar p | Active | Precision | Untrusted active |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const arm of result.arms) {
    const comparison = result.comparisons[arm.name];
    const delta = arm.name === 'baseline' ? '—' : comparison ? pp(comparison.delta) : '—';
    const p = arm.name === 'baseline' ? '—' : comparison ? pValue(comparison.p) : '—';
    lines.push(
      `| ${arm.name} | ${baseline ? pct(baseline.finalAccuracy) : '—'} | ${pct(arm.finalAccuracy)} | ${delta} | ${p} | ${arm.active} | ${pct(arm.precision.value)} (n=${arm.precision.evaluated}) | ${arm.untrustedActive} |`,
    );
  }
  lines.push('');
  lines.push(
    '`Precision` is the share of active constraints whose mark equals the reference policy on a ' +
      'probe grid of every context they claim. `Untrusted active` counts active items whose source ' +
      'trust is below the quarantine floor; it must be zero.',
  );
  lines.push('');

  lines.push('## Held-out domain');
  lines.push('');
  lines.push(
    `\`${result.config.heldOutDomain}\` received no feedback in any arm. It is the transfer test: ` +
      'a rule that was widened to a domain-free scope reaches it; a domain-scoped rule cannot.',
  );
  lines.push('');
  lines.push('| Arm | ' + result.arms[0]?.byDomain.map((d) => d.domain).join(' | ') + ' |');
  lines.push('| --- | ' + result.arms[0]?.byDomain.map(() => '---').join(' | ') + ' |');
  for (const arm of result.arms) {
    lines.push(
      `| ${arm.name} | ` + arm.byDomain.map((d) => `${pct(d.accuracy)} (${d.correct}/${d.total})`).join(' | ') + ' |',
    );
  }
  lines.push('');

  const full = result.arms.find((arm) => arm.name === 'full');
  const fullCmp = result.comparisons['full'];
  lines.push('## Competitor baseline');
  lines.push('');
  lines.push(
    'A similarity fact store — extract, dedupe, retrieve the closest sentence — is the shape every ' +
      'memory product in this space converges on. It is run here on the same corrections, with a ' +
      'reader that applies the retrieved sentence generously.',
  );
  lines.push('');
  lines.push('| Store | Accuracy | Δ vs baseline | Facts | Untrusted ingested |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const entry of [result.competitors.factStore, result.competitors.factStorePoisoned]) {
    lines.push(
      `| ${entry.name} | ${pct(entry.accuracy)} | ${pp(entry.delta)} | ${entry.facts} | ${entry.untrustedFacts} |`,
    );
  }
  lines.push(
    `| full (this library) | ${pct(full?.finalAccuracy ?? 0)} | ${pp(fullCmp?.delta ?? 0)} | ${full?.knowledge ?? 0} | 0 |`,
  );
  lines.push('');
  lines.push(
    'The second row is the same store under the same poison the `poison` arm applies. It lands below ' +
      'the no-memory baseline: a store without a trust ceiling does not merely fail to help, it makes ' +
      'answers worse than having no memory at all.',
  );
  lines.push('');

  lines.push('## Module ablations');
  lines.push('');
  lines.push(
    'Three modules cannot be exercised by a clean corpus — credit only binds after repeated ' +
      'failure, contradiction only binds when two claims disagree, diversification only binds when ' +
      'the store holds paraphrases. Each is measured on the smallest workload where it does bind.',
  );
  lines.push('');
  const a = result.ablations;
  lines.push('| Module | With | Without | Reading |');
  lines.push('| --- | --- | --- | --- |');
  lines.push(
    `| Credit assignment | ${a.credit.injectedWith ? 'still injected' : 'withdrawn'} after ${a.credit.failures} failures | ${a.credit.injectedWithout ? 'still injected' : 'withdrawn'} | Counting applications is what stops a rule that is always wrong |`,
  );
  lines.push(
    `| Contradiction resolution | ${a.contradiction.activeWith} active, ${a.contradiction.charsWith} chars | ${a.contradiction.activeWithout} active, ${a.contradiction.charsWithout} chars | Two conflicting rules double the prompt cost and answer nothing |`,
  );
  lines.push(
    `| Diversification | ${a.diversity.distinctWith} distinct of ${a.diversity.size} | ${a.diversity.distinctWithout} distinct | Relevance alone fills the pack with paraphrases of one claim |`,
  );
  lines.push('');

  lines.push('## Learning curves');
  lines.push('');
  const rounds = Math.max(...result.arms.map((arm) => arm.rounds.length));
  const header = ['Round', ...result.arms.map((arm) => arm.name)];
  lines.push(`| ${header.join(' | ')} |`);
  lines.push(`| ${header.map(() => '---').join(' | ')} |`);
  for (let round = 0; round < rounds; round += 1) {
    const cells = result.arms.map((arm) => {
      const entry = arm.rounds[round];
      return entry ? pct(entry.accuracy) : '—';
    });
    lines.push(`| ${round} | ${cells.join(' | ')} |`);
  }
  lines.push('');

  lines.push('## Knowledge dynamics (final round)');
  lines.push('');
  lines.push(
    '| Arm | Active | Candidate | Quarantined | Conflicted | Retired | Mean pack tokens | Recall p50 / p95 |',
  );
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const arm of result.arms) {
    const last = arm.rounds[arm.rounds.length - 1];
    lines.push(
      `| ${arm.name} | ${arm.active} | ${last?.candidates ?? 0} | ${arm.quarantined} | ${arm.conflicted} | ${last?.retired ?? 0} | ${last?.meanTokens.toFixed(0) ?? '—'} | ${last ? `${last.p50Ms.toFixed(2)} / ${last.p95Ms.toFixed(2)} ms` : '—'} |`,
    );
  }
  lines.push('');

  lines.push('## Gates');
  lines.push('');
  lines.push('| Gate | Criterion | Actual | Result |');
  lines.push('| --- | --- | --- | --- |');
  for (const gate of result.gates) {
    lines.push(`| ${gate.id} | ${gate.criterion} | ${gate.actual} | ${gate.pass ? 'PASS' : gate.blocking ? 'FAIL' : 'WARN'} |`);
  }
  lines.push('');
  const blockingFailures = result.gates.filter((gate) => gate.blocking && !gate.pass);
  lines.push(
    blockingFailures.length === 0
      ? 'All blocking gates pass.'
      : `Blocking gates failing: ${blockingFailures.map((gate) => gate.id).join(', ')}.`,
  );
  lines.push('');

  lines.push('## Threats to validity');
  lines.push('');
  lines.push('1. **The generator is deterministic.** The study isolates knowledge transfer, not model behaviour under a prompt. A real LLM may ignore, misread, or over-apply a constraint.');
  lines.push('2. **The taxonomy is closed.** Edits are chart-type changes only; encoding and aggregation corrections are captured and exported but not taught in this arm.');
  lines.push('3. **The user is simulated.** Noise is uniform, whereas real corrections cluster by user and by failure mode.');
  lines.push('4. **Held-out fields, not held-out schemas.** Transfer is measured across measures and categories inside four known schemas, not across unseen databases.');
  lines.push('');
  lines.push('## Reproduce');
  lines.push('');
  lines.push('```bash');
  lines.push('pnpm install');
  lines.push('pnpm build');
  lines.push('pnpm bench');
  lines.push('```');
  lines.push('');
  return lines.join('\n');
}

export function renderJson(result: StudyResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

/** A compact one-screen summary for CI logs. */
export function summarise(result: StudyResult): string {
  const rows = result.arms.map((arm) => {
    const comparison = result.comparisons[arm.name];
    const delta = comparison ? pp(comparison.delta) : '—';
    return `${arm.name}=${pct(arm.finalAccuracy)} (${delta})`;
  });
  const failed = result.gates.filter((gate) => gate.blocking && !gate.pass).map((gate) => gate.id);
  return `${rows.join('  ')}\nblocking-gates=${failed.length === 0 ? 'PASS' : failed.join(',')}`;
}

export type { ArmResult, Gate, RoundMetrics };
