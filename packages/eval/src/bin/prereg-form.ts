/**
 * Emit the distiller form a pre-registration fixes, or refuse the dispatch that would run another one.
 *
 * R56's treatment is a single switch, and until now the only way to set it was `vars.TAU_DISTILL_FORM`
 * — a repository variable. A variable is global: it is one experiment's setting applied to every queued
 * dispatch, two forms cannot be run side by side, and a forgotten value keys a run that its registration
 * never described. The record has closed this shape twice (the model in R68, the thinking regime in R84)
 * and this is the third instance of the same defect, found by writing the registration for the switch.
 *
 * Both arguments are passed in because neither representation may overwrite the other in silence: the
 * variable is what the workflow would run, the header is what the experiment says it runs, and a stated
 * disagreement is a refusal rather than a note. An unset variable is not a second opinion.
 *
 * The fourth value in the same script is the teaching population (R62's switch), because a fifth script
 * would be a fifth place for the three refusals to drift apart.
 *
 * Usage: pnpm eval:prereg-form prereg/<id>.md [configured-form] [configured-unit] [configured-scope]
 *        [configured-claims] [configured-pack-mode] [configured-pack-shape]
 *   -> prints one `key=value` line per switch and exits 0, or prints the reason and exits 1.
 */
import { readFileSync } from 'node:fs';
import { distillFormProblem, readPrereg, switchOverride } from '../prereg.js';

function refuse(message: string): void {
  process.stderr.write(`[prereg-form] ${message}\n`);
  process.exitCode = 1;
}

function main(): void {
  const file = process.argv[2];
  if (file === undefined) {
    refuse(
      'usage: pnpm eval:prereg-form prereg/<id>.md [form] [unit] [scope] [trace-claims] [pack-mode] [pack-shape]',
    );
    return;
  }
  const configured = process.argv[3] ?? '';
  const configuredUnit = (process.argv[4] ?? '').trim() === 'trace' ? 'trace' : 'correction';
  const reading = readPrereg(readFileSync(file, 'utf8'), file);
  if (reading.prereg === undefined) {
    for (const problem of reading.problems) refuse(`at ${problem.where}: ${problem.problem}`);
    return;
  }
  const declaredUnit = reading.prereg.distillUnit;
  // The switches are the registration's; the variables below are only what a dispatch with no
  // registration would run. A disagreement is therefore a notice, not a refusal -- see
  // `switchOverride` for the run this cost.
  const notices: string[] = [];
  const note = (name: string, declared: string | number | undefined, configured: string | null): void => {
    const line = switchOverride(name, declared, configured);
    if (line !== undefined) notices.push(line);
  };
  // A stated disagreement is refused rather than resolved by preference: the variable is what the
  // workflow would run, the header is what the experiment says it runs, and a silent win for either
  // one is how a run ends up published under a registration it does not execute.
  note('unit', declaredUnit, process.argv[4] ?? null);
  // The unit that will actually run, which is what decides whether the form can take effect at all.
  const unit = declaredUnit ?? configuredUnit;
  const declared = reading.prereg.distillForm;
  const problem = distillFormProblem(configured, declared, unit);
  if (problem !== undefined) {
    refuse(problem);
    return;
  }
  // Two lines rather than one token, for `prereg-scenario`'s reason: the workflow reads each into its
  // own variable and an expression that split a string would be a parser in YAML. The header wins when
  // it names a value, because the checks above have already refused the case where the two disagree;
  // empty means the variable stands, exactly as it did before this script existed.
  const declaredScope = reading.prereg.distillScope;
  note('scope', declaredScope, process.argv[5] ?? null);
  const declaredClaims = reading.prereg.traceClaims;
  note('claims', declaredClaims, process.argv[6] ?? null);
  // R55.1's switch, and the seventh of the family. A prefix arm renders every admitted entry into the
  // system prompt; a retrieved arm serves 1.42 items through a pack. The two are not interchangeable, so
  // a dispatch that would run the other one under this registration's name is refused here rather than
  // discovered in the readback.
  const declaredMode = reading.prereg.packMode;
  note('mode', declaredMode, process.argv[7] ?? null);
  // R109's switch, the eighth of the family. The unit a pack is written in is a property of the
  // experiment, exactly as the place it is served from is: a registration that fixes one unit and a
  // dispatch whose variable says the other would publish one arm under the other's name.
  const declaredShape = reading.prereg.packShape;
  note('shape', declaredShape, process.argv[8] ?? null);
  process.stdout.write(
    `unit=${declaredUnit ?? ''}\nform=${declared ?? ''}\nscope=${declaredScope ?? ''}\n` +
      `claims=${declaredClaims === undefined ? '' : String(declaredClaims)}\n` +
      `mode=${declaredMode ?? ''}\n` +
      `shape=${declaredShape ?? ''}\n` +
      // One line, `;`-joined, because the workflow reads each value with `sed -n 's/^key=//p'` and an
      // expression that split a list would be a parser in YAML. Empty when every switch agrees.
      `overrides=${notices.join('; ')}\n`,
  );
}

main();
