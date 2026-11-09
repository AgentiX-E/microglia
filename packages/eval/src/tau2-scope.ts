/**
 * R62 — which trajectories teach: the ones that went wrong, or all of them.
 *
 * ## Why this is a switch and not a rewrite
 *
 * Three rounds moved every knob the corroboration pass has and support stayed at two: R60 raised the
 * tracer's ceiling from three to six (37 claims, median 3, max 4, nothing at support 3), R61 swept the
 * merge floor over 36 grid points with complete linkage (45 claims, and **the largest group at any
 * point is two**). The floor was never the constraint, the linkage was never the constraint, and the
 * ceiling stopped being one in R60.
 *
 * What is left is that there is no third member to find. Fourteen of the 57 learning tasks fail, and
 * they produce the whole store; the other 43 **pass on the first attempt** and teach nothing, because
 * `teachingOf` returns `undefined` for a pass and is right to: a store built from every failure is the
 * store the fold paid for.
 *
 * The population is therefore the only lever standing, and it is one word wide.
 *
 * ## What each value means, exactly
 *
 *  - `edited` — one record per failed-and-then-repaired task. **Every published arm measures this**,
 *    and an unset variable means this, because an upgrade must not change what a published number
 *    measured.
 *  - `all` — the repaired tasks *and* every task that passed, asked for the rule its successful
 *    trajectory follows. The record omits the reference trajectory, because the attempt **is** the
 *    reference, and states the rubric as checks *met* rather than checks failed.
 *
 * ## Why a misspelt value refuses the run
 *
 * The same argument as `resolveDistillUnit`'s, and it is the opposite of `resolveDistillForm`'s: a
 * form whose name is misspelt still measures *a* form and the artefact says which one ran, while a
 * scope whose name is misspelt measures the control and reports the control's numbers under a
 * treatment's name. This runs at module load, before the first model call.
 */
export type DistillScope = 'edited' | 'all';

export function resolveDistillScope(raw: string | undefined = process.env['TAU_DISTILL_SCOPE']): DistillScope {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === '' || value === 'edited') return 'edited';
  if (value === 'all') return 'all';
  throw new RangeError(
    `TAU_DISTILL_SCOPE must be unset, 'edited' or 'all'; received '${String(raw)}'`,
  );
}
