/**
 * Read `poc-l4-facade-notes.json` back into its three states.
 *
 * The workflow needs one line and one decision, and that decision is not a `node -e`
 * expression: `readNotedFacadeArtifact` is a tested production rule that refuses a missing,
 * unknown or malformed state rather than defaulting it to MEASURED.
 *
 *   MEASURED         three levels were compared over one store. The deltas, intervals, p-
 *                    values and the pack-identity control are printed.
 *   IDENTITY_BROKEN  the arms served different items, so they differed in something the
 *                    registration did not name. Blocking: no delta is quoted.
 *   NO_DELIVERY      no arm ever served a pack. A warning, not a pass and not a failure.
 *
 * A dispatch that never registered the arm has no artefact. That is the single-note path,
 * not a failure, and is reported as such.
 *
 * Usage: pnpm eval:note-facade-readback
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readNotedFacadeArtifact } from '@agentix-e/microglia-eval';

const RESULTS = process.env['POC_RESULT_DIR'] ?? join(process.cwd(), 'eval', 'results');
const SUFFIX = (process.env['POC_RESULT_SUFFIX'] ?? '').trim();
const PATH = join(RESULTS, `poc-l4-facade-notes${SUFFIX === '' ? '' : `-${SUFFIX}`}.json`);

function summaryLine(text: string): void {
  const path = process.env['GITHUB_STEP_SUMMARY'];
  if (path !== undefined && path.trim() !== '') {
    // Additive: the L4 job writes other sections into the same file.
    appendFileSync(path, `${text}\n`);
  }
}

function main(): void {
  if (!existsSync(PATH)) {
    process.stdout.write('[note-facade-readback] no three-level note artefact for this arm\n');
    summaryLine('### Note levels\n\nNo three-level note artefact was written for this arm.');
    return;
  }

  let back: ReturnType<typeof readNotedFacadeArtifact>;
  try {
    back = readNotedFacadeArtifact(JSON.parse(readFileSync(PATH, 'utf8')) as unknown);
  } catch (error) {
    const message = (error as Error).message;
    process.stderr.write(`[note-facade-readback] refused: ${message}\n`);
    process.stderr.write(`::error::three-level note artefact is unreadable: ${message}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`[note-facade-readback] ${back.state}: ${back.summary}\n`);
  const table = back.arms
    .map(
      (arm) =>
        `| \`${arm.note}\` | ${(arm.pass4 * 100).toFixed(2)}% | ${String(arm.servedPacks)} | ` +
        `${arm.itemsPerRequest.toFixed(3)} |`,
    )
    .join('\n');
  const contrasts =
    back.contrasts.length === 0
      ? 'No contribution is reported.'
      : back.contrasts
          .map(
            (contrast) =>
              `\`${contrast.arm}\` against the standard arm: \`${contrast.deltaPp.toFixed(2)}pp\` ` +
              `[\`${contrast.ciLowPp.toFixed(2)}\`, \`${contrast.ciHighPp.toFixed(2)}\`] ` +
              `at p=\`${contrast.p.toFixed(4)}\` over \`${String(contrast.paired)}\` paired tasks.`,
          )
          .join('\n\n');
  summaryLine(
    [
      `### Note levels — \`${back.state}\``,
      '| Level | pass^4 | served packs | items/request |',
      '| --- | --- | --- | --- |',
      table,
      '',
      contrasts,
      '',
      `Pack identity: \`${String(back.identity.mismatched)}\` mismatch over ` +
        `\`${String(back.identity.compared)}\` shared request(s).`,
      '',
      `> ${back.summary}`,
    ].join('\n'),
  );

  if (back.state === 'IDENTITY_BROKEN') {
    process.stderr.write(
      '::error::the three note levels served different items: the arms differed in more than ' +
        'the sentence, and no delta from this run is interpretable\n',
    );
    process.exitCode = 1;
    return;
  }
  if (back.state === 'NO_DELIVERY') {
    process.stderr.write(
      '::warning::no note arm served a pack: the treatment never arrived and no contribution is claimed\n',
    );
  }
}

main();
