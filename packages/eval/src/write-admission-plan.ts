/**
 * The write-side admission knob, resolved once per dispatch.
 *
 * U6 asks whether the store should refuse a write it has effectively already
 * made. Turning that into a dispatchable arm needs one switch and one rule about
 * what a value may be, and this module is both:
 *
 *  1. **Unset means off.** Every committed artefact before this switch was
 *     produced by a store that accepted every claim, so the default has to be
 *     that store — otherwise an upgrade silently invalidates the comparisons the
 *     lane's history is made of.
 *  2. **A set value must be a name, not a number.** `neighbours` selects the
 *     decision implemented in `kernel/admission.ts`; there is no second mode and
 *     no spelling of "on" that quietly means something else.
 *  3. **A parameter is either valid or the dispatch stops.** The threshold that
 *     decides "these are the same rule" cannot default its way into a run: an
 *     unparseable value is thrown at module load, before a single model call, so
 *     a typo cannot become a result.
 */
import { WRITE_ADMISSION_THRESHOLD, type WriteAdmissionOptions } from '@agentix-e/microglia-core';

export type WriteAdmissionMode = 'off' | 'neighbours';

export type WriteAdmissionPlan = {
  readonly mode: WriteAdmissionMode;
  /** Passed verbatim to the distiller; empty when the mode is off. */
  readonly options: WriteAdmissionOptions;
};

/** The one value that enables the arm. Anything else is either off or an error. */
export const WRITE_ADMISSION_MODE = 'neighbours';

export function resolveWriteAdmissionPlan(
  env: Readonly<Record<string, string | undefined>>,
): WriteAdmissionPlan {
  const raw = (env['TAU_WRITE_ADMISSION'] ?? '').trim();
  if (raw === '' || raw === 'off') return { mode: 'off', options: {} };
  if (raw !== WRITE_ADMISSION_MODE) {
    throw new Error(
      `TAU_WRITE_ADMISSION must be unset, 'off' or '${WRITE_ADMISSION_MODE}', not '${raw}': an unknown ` +
        'spelling would run a store that reports a mode it did not apply',
    );
  }
  const thresholdRaw = (env['TAU_WRITE_ADMISSION_THRESHOLD'] ?? '').trim();
  if (thresholdRaw === '') return { mode: 'neighbours', options: {} };
  const threshold = Number(thresholdRaw);
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) {
    throw new Error(
      `TAU_WRITE_ADMISSION_THRESHOLD must be in (0, 1], not '${thresholdRaw}': the threshold decides ` +
        `which claims are one rule, and the published default is ${String(WRITE_ADMISSION_THRESHOLD)}`,
    );
  }
  return { mode: 'neighbours', options: { threshold } };
}
