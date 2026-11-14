/**
 * Read `poc-l4-facade-shapes.json` back into its four states.
 *
 * The workflow needs one line and one decision, and that decision is not a `node -e` expression:
 * `readShapeArmArtifact` is a tested production rule that refuses a missing, unknown or malformed state
 * rather than defaulting it to MEASURED.
 *
 *   MEASURED            both units ran over one store. The delta, its interval, its p-value and the
 *                       containment control are printed, with the characters each unit cost.
 *   CONTAINMENT_BROKEN  the treatment pack was not the control pack under the fold, so the arms differed
 *                       in something the registration did not name. Blocking: no delta is quoted.
 *   NO_DELIVERY         no arm ever served a pack. A warning, not a pass and not a failure.
 *   NO_TREATMENT        both arms served packs and the fold removed nothing. A warning, and a different
 *                       finding from the one above: it is about the store's recurrence, not the unit.
 *
 * A dispatch that never registered the arm has no artefact. That is the single-unit path, not a failure,
 * and is reported as such.
 *
 * Usage: pnpm eval:shape-arm-readback
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readShapeArmArtifact } from '@agentix-e/microglia-eval';

const RESULTS = process.env['POC_RESULT_DIR'] ?? join(process.cwd(), 'eval', 'results');
const SUFFIX = (process.env['POC_RESULT_SUFFIX'] ?? '').trim();
const PATH = join(RESULTS, `poc-l4-facade-shapes${SUFFIX === '' ? '' : `-${SUFFIX}`}.json`);

function summaryLine(text: string): void {
  const path = process.env['GITHUB_STEP_SUMMARY'];
  if (path !== undefined && path.trim() !== '') {
    // Additive: the L4 job writes other sections into the same file.
    appendFileSync(path, `${text}\n`);
  }
}

function main(): void {
  if (!existsSync(PATH)) {
    process.stdout.write('[shape-arm-readback] no two-unit artefact for this arm\n');
    summaryLine('### Pack unit\n\nNo two-unit artefact was written for this arm.');
    return;
  }

  let back: ReturnType<typeof readShapeArmArtifact>;
  try {
    back = readShapeArmArtifact(JSON.parse(readFileSync(PATH, 'utf8')) as unknown);
  } catch (error) {
    const message = (error as Error).message;
    process.stderr.write(`[shape-arm-readback] refused: ${message}\n`);
    process.stderr.write(`::error::two-unit artefact is unreadable: ${message}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`[shape-arm-readback] ${back.state}: ${back.summary}\n`);
  const table = back.arms
    .map(
      (arm) =>
        `| \`${arm.shape}\` | ${(arm.pass4 * 100).toFixed(2)}% | ${String(arm.servedPacks)} | ` +
        `${arm.itemsPerRequest.toFixed(3)} | ${arm.charsPerRequest.toFixed(0)} | ` +
        `${String(arm.folded)} |`,
    )
    .join('\n');
  const contrasts =
    back.contrasts.length === 0
      ? 'No contribution is reported.'
      : back.contrasts
          .map(
            (contrast) =>
              `\`${contrast.arm}\` against \`${contrast.baseline}\`: \`${contrast.deltaPp.toFixed(2)}pp\` ` +
              `[\`${contrast.ciLowPp.toFixed(2)}\`, \`${contrast.ciHighPp.toFixed(2)}\`] ` +
              `at p=\`${contrast.p.toFixed(4)}\` over \`${String(contrast.paired)}\` paired tasks.`,
          )
          .join('\n\n');
  summaryLine(
    [
      `### Pack unit — \`${back.state}\``,
      '| Unit | pass^4 | served packs | items/request | chars/request | folded |',
      '| --- | --- | --- | --- | --- | --- |',
      table,
      '',
      contrasts,
      '',
      `Containment: \`${String(back.containment.mismatched)}\` mismatch over ` +
        `\`${String(back.containment.compared)}\` shared request(s), ` +
        `\`${String(back.containment.excluded)}\` excluded for a cut pack.`,
      '',
      `> ${back.summary}`,
    ].join('\n'),
  );

  if (back.state === 'CONTAINMENT_BROKEN') {
    process.stderr.write(
      '::error::the treatment pack was not the control pack under the fold: the arms differed in ' +
        'more than the unit, and no delta from this run is interpretable\n',
    );
    process.exitCode = 1;
    return;
  }
  if (back.state === 'NO_DELIVERY') {
    process.stderr.write(
      '::warning::no unit arm served a pack: the treatment never arrived and no contribution is claimed\n',
    );
    return;
  }
  if (back.state === 'NO_TREATMENT') {
    process.stderr.write(
      '::warning::the fold removed nothing on this store: the unit was registered and never applied, ' +
        'which is a finding about the store and not about the unit\n',
    );
  }
}

main();
