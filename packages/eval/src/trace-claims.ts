/**
 * How many claims one trace may teach, resolved once per dispatch.
 *
 * ## Why this is a switch and not a constant
 *
 * R58 capped the trace form at three claims because three was a guess that fit the prompt's length.
 * R59 measured what the guess produced: **31 claims from 14 corrections, 2.21 each, against a cap of
 * three** — so the cap was within one claim of the mean and was certainly binding on the corrections
 * that reached it. The published competitive record keeps roughly five guidelines per learning task
 * from a full trajectory; this lane keeps about half a claim per task. Whether the ceiling or the
 * episode is the constraint is a question about a number, and a constant cannot be varied to ask it.
 *
 * ## What the value means, and what it does not
 *
 * The ceiling is passed to the interpreter, where it becomes *both* the sentence the model reads and
 * the count the parser keeps (`traceCeilingLine` in the distiller). It does not promise yield: a
 * trace with one failed assertion may support one claim whatever the ceiling is, and a run at six
 * that yields 2.2 is the finding that the episode, not the cap, is the constraint.
 *
 * Unset means **three**, which is what every committed trace artefact was produced with. A run that
 * changes the ceiling is a different treatment and has to say so — the number travels into the
 * artefact as `traceClaims`, because two runs at different ceilings are two experiments and a store
 * cannot say which one built it.
 */
export type TraceClaimsPlan = {
  /** The most claims one trace may yield. */
  readonly ceiling: number;
  /**
   * Whether this dispatch set the ceiling, as opposed to inheriting the default.
   *
   * Three is both the default and a value a run can choose, so a plan that merely resolved to three
   * could mean either. The artefact records which, because a readback that cannot tell them apart
   * cannot tell an arm from a control.
   */
  readonly declared: boolean;
};

/** The default, and the value every committed trace artefact ran at. */
export const DEFAULT_TRACE_CLAIMS = 3;

/**
 * The range a ceiling may take.
 *
 * The floor is one because a trace that may teach nothing is a trace the prompt is not asking a
 * question of. The ceiling of eight is the pack limit: a store is served eight items at most, so a
 * single trace that claims more than a whole pack's worth of rules is claiming more than any request
 * could ever use, and the extra claims would be noise in every pair count the recurrence reading
 * makes.
 */
export const TRACE_CLAIM_RANGE = { min: 1, max: 8 } as const;

/** The switch, and the wall clock's own source when no environment is given. */
export const TRACE_CLAIMS_ENV = 'TAU_TRACE_CLAIMS';

export function resolveTraceClaims(
  env: Readonly<Record<string, string | undefined>> = process.env,
): TraceClaimsPlan {
  const raw = (env[TRACE_CLAIMS_ENV] ?? '').trim();
  if (raw === '') return { ceiling: DEFAULT_TRACE_CLAIMS, declared: false };
  // `Number('3.5')` is 3.5 and `Number('three')` is NaN: both are refused rather than rounded,
  // because a ceiling of 3.5 is a number the parser cannot apply and the prompt cannot state.
  const ceiling = Number(raw);
  if (!Number.isInteger(ceiling) || ceiling < TRACE_CLAIM_RANGE.min || ceiling > TRACE_CLAIM_RANGE.max) {
    throw new Error(
      `${TRACE_CLAIMS_ENV} must be an integer in ${String(TRACE_CLAIM_RANGE.min)}..${String(
        TRACE_CLAIM_RANGE.max,
      )}, not '${raw}': a ceiling the prompt states and the parser cannot apply would report a yield ` +
        'that no run measured',
    );
  }
  return { ceiling, declared: true };
}
