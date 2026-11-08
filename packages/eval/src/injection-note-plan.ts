/**
 * The pack-note arm, resolved once per dispatch.
 *
 * R53 varies one sentence: the note a knowledge block opens with. Same store, same recall,
 * same items, same order — so the switch has to be the only thing that differs between the
 * arms, and that gives this module two jobs and one refusal:
 *
 *  1. **Unset means `standard`.** Every committed artefact was produced by a renderer that
 *     had one note, so the default must render byte-identically or the lane's history stops
 *     being comparable to its future. This is the same rule `resolveWriteAdmissionPlan`
 *     follows, for the same reason.
 *  2. **A set value must be one of three names.** There is no spelling of "on" that quietly
 *     means something else, and no number: the level is a word because the thing being varied
 *     is a word.
 *  3. **The level is recorded in the artefact.** R53's third refutation says that a run which
 *     cannot say which level it ran measured nothing — two runs of one level would read as
 *     three arms. `note` is carried into `poc-l4*.json` beside the recall plan for exactly
 *     that reason.
 */
import type { NoteMode } from '@agentix-e/microglia-core/apply';

export type InjectionNotePlan = {
  readonly mode: NoteMode;
  /**
   * Whether this dispatch *is* the arm.
   *
   * `standard` is both the default and one of the three levels, so a plan that merely
   * resolved to `standard` could mean either "this run is the standard arm" or "nobody set
   * the switch". The artefact has to record which, because a readback that cannot tell them
   * apart cannot tell an arm from a control.
   */
  readonly declared: boolean;
};

export const INJECTION_NOTE_LEVELS: readonly NoteMode[] = ['none', 'standard', 'hardened'];

export function resolveInjectionNotePlan(
  env: Readonly<Record<string, string | undefined>>,
): InjectionNotePlan {
  const raw = (env['TAU_INJECTION_NOTE'] ?? '').trim();
  if (raw === '') return { mode: 'standard', declared: false };
  if (!INJECTION_NOTE_LEVELS.includes(raw as NoteMode)) {
    throw new Error(
      `TAU_INJECTION_NOTE must be unset or one of ${INJECTION_NOTE_LEVELS.join(', ')}, not '${raw}': ` +
        'an unknown spelling would run a pack that reports a level it did not render',
    );
  }
  return { mode: raw as NoteMode, declared: true };
}
