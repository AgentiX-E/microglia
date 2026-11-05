/**
 * What a τ² correction *means*, as opposed to how far it moved the output.
 *
 * ## The defect this module closes
 *
 * The driver records a failed episode as the reference call **names**
 * (`complete({ actions: string[] })`) and the correction as those names with
 * their arguments (`correctionEdit`). `editDistance` is
 * `ops / (leaves(before) + leaves(after))`, so a tool with many arguments makes
 * the denominator large and the distance small; `trustFor('edit')` maps that to
 * `0.5 + 0.4 × clamp01(distance / 0.3)`. On the real 32-task retail learn split
 * this prices a gold-verified correction anywhere from 0.50 to 0.90 purely by
 * tool arity. `createLlmInterpreter` then writes that number into both
 * `candidate.trust` and `candidate.evidence.weight`, and `scoreKnowledge` adds
 * `weight × logit(trust)` — the same quantity twice, so the penalty is
 * quadratic. `support` clears `minSupport` at trust 0.8, but `confidence` there
 * is 0.4806; activation needs trust 0.89. R44 measured the consequence: 19 of
 * 19 items held as `insufficient-evidence`, 0 active, 0 served.
 *
 * ## Why the hook, and why `1`
 *
 * `evaluation_criteria.actions` is the state the upstream evaluator *requires*.
 * A failing episode is scored against it by the benchmark, not judged by a
 * reviewer, so the observation's strength comes from the verifier rather than
 * from how many leaves the edit moved. `openMicroglia`'s `editSemantics` exists
 * for exactly this: a domain pack states what its own edits mean, and the chart
 * pack already uses it for mark and encoding changes. A full replacement is the
 * honest semantic distance here — an unverified output was replaced by a
 * verified one — and it is the only one of the five measured conditions that
 * admits all 32 items without weakening a threshold.
 *
 * ## Why it is guarded rather than unconditional
 *
 * Returning `undefined` keeps the structural distance as the default for every
 * other event shape. A host that edits a free-form answer, or an action list
 * with no arguments, must not be promoted by a rule written for τ². Both the
 * `after` (the correction) and the `before` (the driver's completion) are
 * checked, so the hook cannot fire on an event the driver did not write.
 */
import type { Json } from '@agentix-e/microglia-core';

/** The shape `correctionEdit` produces: calls with arguments, or a rubric alone. */
export function isGoldVerifiedCorrection(after: Json): boolean {
  if (typeof after !== 'object' || after === null || Array.isArray(after)) return false;
  const record = after as Record<string, unknown>;
  const actions = record['actions'];
  if (!Array.isArray(actions)) return false;
  const expectation = record['expectation'];
  if (expectation !== undefined && typeof expectation !== 'string') return false;
  for (const entry of actions) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return false;
    const action = entry as Record<string, unknown>;
    if (typeof action['name'] !== 'string' || action['name'].length === 0) return false;
    const args = action['arguments'];
    if (typeof args !== 'object' || args === null || Array.isArray(args)) return false;
  }
  // A call-shaped correction needs calls; a rubric-only one needs its statement.
  // An object with neither is not a shape this driver writes.
  return actions.length > 0 || typeof expectation === 'string';
}

/** The shape `complete()` produces: the reference call names, in order. */
function isDriverCompletion(before: Json): boolean {
  if (typeof before !== 'object' || before === null || Array.isArray(before)) return false;
  const actions = (before as Record<string, unknown>)['actions'];
  return Array.isArray(actions) && actions.every((entry) => typeof entry === 'string');
}

/**
 * Semantic edit distance for the τ² lane. `1` for a gold-verified correction
 * against the driver's own completion; `undefined` for everything else, which
 * leaves `editDistance` in charge.
 */
export function tau2EditSemantics(before: Json, after: Json): number | undefined {
  if (!isDriverCompletion(before) || !isGoldVerifiedCorrection(after)) return undefined;
  return 1;
}
