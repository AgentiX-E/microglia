/**
 * Which of the three arms a dispatch is.
 *
 * ## Why a third one exists
 *
 * R93 ran the benchmark's own forty held-out retail tasks in one dispatch, twice: once behind this
 * project's agent and once behind τ²'s stock one. The wrapper-plus-pack arm scored `pass^4` 0.700
 * and the no-memory arm scored 0.725, a paired delta of −2.50pp that the sample could not resolve
 * (MDE 21.02pp, exact McNemar p = 1.0000). What that delta *is* remains unread, because the two arms
 * differ in two things at once: the pack the wrapper was served, and the wrapper itself. The stock
 * agent has no facade, no recall call, no `<rules>` block and no tool-name guard; an arm that carries
 * all four and receives zero rules is the only object that separates them.
 *
 * So the three arms are:
 *
 *  - `memory` — the wrapper over a store distilled from the learn half. Every published τ² arm.
 *  - `reference` — τ²'s own `llm_agent`, same tasks, same model, no store. The control half of every
 *    pair.
 *  - `scaffold` — the wrapper over a store that is **empty by construction**: no learn episodes, no
 *    distillation, no rules, and the whole delivery path intact. The wrapper's own cost, measured
 *    rather than assumed. R101 is the registration that buys it.
 *
 * ## The two rules this resolver keeps
 *
 *  1. **Unset means what it always meant.** Before this module `TAU_MEMORY=false` was the reference
 *     arm and anything else was the memory arm, and every committed artefact was produced that way.
 *     The default has to reproduce that mapping byte for byte or the lane's history stops being
 *     comparable to its future.
 *  2. **Two arms at once is a refusal, not a precedence.** `TAU_MEMORY=false` beside a scaffold
 *     request names the stock agent *and* the wrapper, which is not a run any registration describes.
 *     Picking one silently would produce an artefact whose `arm` disagrees with the dispatch that
 *     bought it, and that disagreement is unfalsifiable after the fact because the losing variable
 *     left no trace.
 */
export type Tau2ArmKind = 'memory' | 'reference' | 'scaffold';

export const TAU2_ARM_KINDS: readonly Tau2ArmKind[] = ['memory', 'reference', 'scaffold'];

/**
 * The one value `TAU_SCAFFOLD` accepts.
 *
 * A word rather than `true`, because the interesting question is not *whether* the store is empty but
 * *why*: a switch called `true` would be indistinguishable from an accident, and this arm's entire
 * claim is that the emptiness was declared before the first episode rather than discovered after it.
 */
export const SCAFFOLD_EMPTY_PACK = 'empty-pack';

export function resolveArmKind(
  env: Readonly<Record<string, string | undefined>>,
): Tau2ArmKind {
  const scaffold = (env['TAU_SCAFFOLD'] ?? '').trim();
  const memoryOff = (env['TAU_MEMORY'] ?? 'true') === 'false';
  if (scaffold === '') return memoryOff ? 'reference' : 'memory';
  if (scaffold !== SCAFFOLD_EMPTY_PACK) {
    throw new Error(
      `TAU_SCAFFOLD must be unset or '${SCAFFOLD_EMPTY_PACK}', not '${scaffold}': ` +
        'an arm whose store is empty by accident is the defect this switch declares, and a ' +
        'spelling that resolves to the memory arm would measure the pack it claims to remove',
    );
  }
  if (memoryOff) {
    throw new Error(
      'TAU_SCAFFOLD and TAU_MEMORY=false name two different arms — the wrapper over an empty ' +
        'store, and the stock agent over no store — so a dispatch that sets both is asking for a ' +
        'run neither of them describes',
    );
  }
  return 'scaffold';
}

/** Whether this arm's store is empty because the arm says so, which two gates invert on. */
export function declaresEmptyStore(kind: Tau2ArmKind): boolean {
  return kind === 'scaffold';
}
