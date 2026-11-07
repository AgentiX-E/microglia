/**
 * Read `poc-l4-facade-pair.json` back into its three terminal states.
 *
 * The workflow needs one line and one decision, and that decision is not a
 * `node -e` expression: `readFacadePairArtifact` is a tested production rule
 * that refuses a missing, unknown or malformed state rather than defaulting it
 * to PAIRED. A defaulted readback is how a run that never measured becomes a
 * result.
 *
 *   PAIRED              a contribution was measured. The interval, p-value,
 *                       paired count and delivered population are printed.
 *   REFUSED_CROSS_RUN   the design was violated (two dispatches, two stores).
 *                       This is a blocking error: no number is quoted.
 *   NO_MEASUREMENT      the instrument did not measure. A warning, not a
 *                       green pass and not a failed measurement.
 *
 * A dispatch that never registered a pair has no artefact. That is the
 * single-facade path, not a failure, and is reported as such.
 *
 * Usage: pnpm eval:facade-pair-readback
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readFacadePairArtifact } from '@agentix-e/microglia-eval';

const RESULTS = process.env['POC_RESULT_DIR'] ?? join(process.cwd(), 'eval', 'results');
const SUFFIX = (process.env['POC_RESULT_SUFFIX'] ?? '').trim();
const PATH = join(RESULTS, `poc-l4-facade-pair${SUFFIX === '' ? '' : `-${SUFFIX}`}.json`);

function summaryLine(text: string): void {
  const path = process.env['GITHUB_STEP_SUMMARY'];
  if (path !== undefined && path.trim() !== '') {
    // Deliberately additive: the L4 job writes other sections into the same
    // file, and a readback must not erase what the arms reported.
    appendFileSync(path, `${text}\n`);
  }
}

function main(): void {
  if (!existsSync(PATH)) {
    process.stdout.write('[facade-pair-readback] no paired-facade artefact: single-facade dispatch\n');
    summaryLine('### Paired facade\n\nNo paired-facade artefact: this dispatch ran one facade.');
    return;
  }

  let back: ReturnType<typeof readFacadePairArtifact>;
  try {
    back = readFacadePairArtifact(JSON.parse(readFileSync(PATH, 'utf8')) as unknown);
  } catch (error) {
    const message = (error as Error).message;
    process.stderr.write(`[facade-pair-readback] refused: ${message}\n`);
    process.stderr.write(`::error::paired-facade artefact is unreadable: ${message}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`[facade-pair-readback] ${back.state}: ${back.summary}\n`);
  const body =
    back.state === 'PAIRED'
      ? [
          `Floor \`${back.floor}\` contributed \`${back.deltaPp?.toFixed(2)}pp\` ` +
            `[${back.ciLowPp?.toFixed(2)}, ${back.ciHighPp?.toFixed(2)}] ` +
            `at p=\`${back.p?.toFixed(4)}\` over \`${back.paired}\` paired tasks.`,
          `Served packs: \`${back.servedPacks.floored}\` floored, \`${back.servedPacks.asIs}\` as-is. ` +
            `Treatment delivered: \`${back.treatmentDelivered}\`.`,
        ].join('\n\n')
      : `No contribution is reported. \`${back.state}\` is ${back.state === 'NO_MEASUREMENT' ? 'a broken instrument' : 'a broken design'}, not a result.`;
  summaryLine(`### Paired facade — \`${back.state}\`\n\n${body}\n\n> ${back.summary}`);

  if (back.state === 'REFUSED_CROSS_RUN') {
    process.stderr.write(`::error::the paired facades are a cross-run comparison: ${back.summary}\n`);
    process.exitCode = 1;
    return;
  }
  if (back.state === 'NO_MEASUREMENT') {
    process.stderr.write('::warning::the paired facades produced no measurement; no contribution is claimed\n');
    return;
  }
  if (!back.treatmentDelivered) {
    process.stderr.write(
      '::warning::the paired delta is a zero-delta pair of two untreated arms: the floored facade served no pack\n',
    );
  }
}

main();
