/**
 * What the pack is made of at serve time: the block the store rendered, or one sentence written for the
 * request and discarded.
 *
 * ## The reading this exists for
 *
 * R200 closed the identity `inert = served − repaired − broke` and found **78.7%** of served packs changed
 * nothing. R201 then moved the *dose* — a margin that withholds a share of packs — and the inert share did not
 * follow: at rung 0.01 the gate kept 22 of 26 repairs and prevented 6 of 36 breaks, which is exactly
 * proportional to the corpus, so the gate is a cost knob and not a mechanism. Both rounds moved *whether* and
 * *how much* the memory speaks. Neither moved *what it says*.
 *
 * The largest published effect in the memory literature is about exactly that. *More Memory, Worse Agents*
 * measured stored lessons at 49.0%, raw logs at 53.5%, and per-task guidance built from those logs and thrown
 * away after one task at **59.9%** over nine benchmark/model settings: the durable artefact is the defect.
 * This record has the first two (R93's raw store at `pass^4` 0.700, R99's at 0.625, against lesson stores at
 * 0.561–0.702) and had never built the third.
 *
 * ## What the switch decides
 *
 * `rendered` — every arm before R204 — injects the block the facade served, unchanged, on the first turn of
 * an episode, and the same block rides every turn of it.
 *
 * `guidance` reads the same records and makes **one** model call per served episode: the block and the
 * request go to the arm's own model, one sentence comes back, and the sentence is what the prompt carries.
 * Nothing is written back, so the store is the same size at the end of the phase as at the start — the one
 * property that separates this arm from every lesson arm in the record.
 *
 * The distinction is recorded rather than inferred, and recorded at the *producer*, for R202's reason: a
 * serving policy that the pool key cannot see is two treatments under one name, which is how `rotation` was
 * lost between R152 and R202.
 */

export type ServeBody = 'rendered' | 'guidance';

export const SERVE_BODIES: readonly ServeBody[] = ['rendered', 'guidance'];

export type ServeBodyPlan = {
  /** The body this dispatch serves. Total for a pack-serving arm: every arm served something. */
  readonly body: ServeBody;
  /** Whether a registration said so, which is different from a dispatch that never heard of the switch. */
  readonly declared: boolean;
};

/**
 * The body a dispatch asked for.
 *
 * Unset means `rendered`, and that is not a default chosen for convenience: it is the body every artefact
 * committed before this module was written was produced under, so an arm that says nothing keeps running the
 * arm its predecessors ran. A spelling outside the two names is refused before the first model call, because
 * an unknown body would run the block arm and publish it under the transient arm's name.
 */
export function resolveServeBodyPlan(env: Readonly<Record<string, string | undefined>>): ServeBodyPlan {
  const raw = (env['TAU_SERVE_BODY'] ?? '').trim();
  if (raw === '') return { body: 'rendered', declared: false };
  if (!SERVE_BODIES.includes(raw as ServeBody)) {
    throw new RangeError(
      `TAU_SERVE_BODY is '${raw}', which is not one of ${SERVE_BODIES.join(', ')}: a body this driver cannot ` +
        'serve would run the block arm and report the transient one',
    );
  }
  return { body: raw as ServeBody, declared: true };
}

/**
 * The variables the agent reads when the transient arm is on, and nothing at all when it is off.
 *
 * One name, spelled here, because the agent is a different process and a different language: a driver that
 * spelled `MICROGLIA_GUIDANCE` at its call site and a workflow that spelled something else would be two
 * switches, one of which does nothing.
 *
 * The model is deliberately *not* passed. The agent falls back to `TAU_MODEL`, which is the id the run already
 * resolved for its own calls, and a second variable would let a dispatch buy a summariser the arm's own
 * episodes did not run on — a different experiment wearing the same header.
 */
export function guidanceEnvOf(plan: ServeBodyPlan): Readonly<Record<string, string>> {
  return plan.body === 'guidance' ? { MICROGLIA_GUIDANCE: '1' } : {};
}
