/**
 * Print the BIRD lane this dispatch buys, and say why.
 *
 * The workflow cannot evaluate a testable function inside an `if:`, so the decision lives in
 * `lane-scope.ts` and this command is only the adapter: it reads the dispatch's own environment, reads
 * the registration if one is named, and writes `bird=` and `reason=` to `$GITHUB_OUTPUT`. A job gated on
 * the output is then a job whose gate is unit-tested, which no workflow expression in this repository is.
 *
 * Usage (as the `scope` job runs it):
 *
 *   EVENT=workflow_dispatch BIRD_INPUT='' SPLIT=minidev PREREG=R61-floor pnpm --silent eval:lane-scope
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { laneScope, preregFileOf } from '../lane-scope.js';
import { readPrereg } from '../prereg.js';

function fail(message: string): void {
  process.stderr.write(`[lane-scope] ${message}\n`);
  process.exitCode = 1;
}

/** Whether the named registration declares a `recallFloor`, or undefined when none is named. */
function floorDeclaration(id: string | undefined): boolean | undefined {
  if (id === undefined || id === '') return undefined;
  const file = preregFileOf(id);
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    // A registration that cannot be read is a configuration error the lane's own `Require a
    // pre-registration` step reports with the fix in the message. Guessing a scope from a missing file
    // would buy or skip a seventeen-minute lane on the strength of a typo.
    fail(`no such pre-registration: ${file}`);
    return undefined;
  }
  const reading = readPrereg(text, file);
  if (reading.prereg === undefined) {
    fail(
      `${file} does not parse: ${reading.problems.map((p) => `${p.where}: ${p.problem}`).join('; ')}`,
    );
    return undefined;
  }
  return reading.prereg.recallFloor !== undefined;
}

function main(): void {
  // `EVENT` has no default on purpose. The one thing this command must not do is answer "scheduled" to
  // a dispatch whose event was not passed, because that is the branch that turns the lane on.
  const event = process.env['EVENT'];
  if (event === undefined || event === '') {
    fail('EVENT is not set: pass github.event_name, since the default branch buys a lane');
    return;
  }
  const declares = floorDeclaration(process.env['PREREG']);
  if (process.exitCode === 1) return;
  const scope = laneScope({
    event,
    bird: process.env['BIRD_INPUT'] ?? '',
    split: process.env['SPLIT'] ?? '',
    ...(declares === undefined ? {} : { declaresRecallFloor: declares }),
  });
  const output = process.env['GITHUB_OUTPUT'];
  const lines = `bird=${scope.bird ? 'true' : 'false'}\nreason=${scope.reason}\n`;
  if (output === undefined || output === '') {
    process.stdout.write(lines);
    return;
  }
  // Appending rather than writing: several steps in this workflow share one output file, and a
  // `writeFileSync` here silently erases whatever the step before it recorded.
  process.stdout.write(`[lane-scope] ${scope.bird ? 'BIRD' : 'no BIRD'}: ${scope.reason}\n`);
  appendFileSync(output, lines);
}

main();
