/**
 * The switch that decides what the pack is made of, tested where it is resolved.
 *
 * Three things are asserted and each is a way the arm could stop being the arm:
 *
 *  * **Unset is `rendered`**, because that is the body every artefact in this repository was produced under. A
 *    resolver whose default were `guidance` would re-read the whole record as an experiment it never ran.
 *  * **A spelling nobody implements is a refusal**, not a fallback. A dispatch that named `per-request` would
 *    otherwise run the block arm and publish it under the transient arm's name, and both artefacts would be
 *    self-consistent documents — this is the defect the floor, form, unit, shape and rotation switches were all
 *    moved into the registration to close.
 *  * **The agent's variable is spelled in one place.** The Python half reads `MICROGLIA_GUIDANCE`; a driver that
 *    spelled it at its call site and a workflow that spelled something else would be two switches, one of which
 *    does nothing, and the failure would look exactly like a mechanism that did not work.
 */
import { describe, expect, it } from 'vitest';
import { guidanceEnvOf, resolveServeBodyPlan, SERVE_BODIES } from '../serve-body.js';

describe('resolveServeBodyPlan', () => {
  it('is the block arm when nobody said anything, and says so', () => {
    expect(resolveServeBodyPlan({})).toEqual({ body: 'rendered', declared: false });
    // Empty is absence rather than a value: the workflow renders an unset header as an empty string, which is
    // what every dispatch without a registration sends.
    expect(resolveServeBodyPlan({ TAU_SERVE_BODY: '' })).toEqual({ body: 'rendered', declared: false });
    expect(resolveServeBodyPlan({ TAU_SERVE_BODY: '   ' })).toEqual({ body: 'rendered', declared: false });
  });

  it('carries the two bodies, trimmed, and remembers that a registration named one', () => {
    expect(resolveServeBodyPlan({ TAU_SERVE_BODY: 'guidance' })).toEqual({ body: 'guidance', declared: true });
    expect(resolveServeBodyPlan({ TAU_SERVE_BODY: ' rendered ' })).toEqual({ body: 'rendered', declared: true });
    // `declared` is the difference between an arm that relies on the default and one that states it — the same
    // distinction R202 needed for `rotation`, where a declared `none` and a silence produced the same key.
    expect(SERVE_BODIES).toEqual(['rendered', 'guidance']);
  });

  it('refuses a body it cannot serve, before the first model call', () => {
    expect(() => resolveServeBodyPlan({ TAU_SERVE_BODY: 'per-request' })).toThrow(RangeError);
    expect(() => resolveServeBodyPlan({ TAU_SERVE_BODY: 'per-request' })).toThrow(
      "TAU_SERVE_BODY is 'per-request', which is not one of rendered, guidance",
    );
  });
});

describe('guidanceEnvOf', () => {
  it('turns the agent on for the transient arm and leaves the environment alone otherwise', () => {
    expect(guidanceEnvOf({ body: 'guidance', declared: true })).toEqual({ MICROGLIA_GUIDANCE: '1' });
    // Not `{ MICROGLIA_GUIDANCE: '' }`: an empty value is a variable that exists and says nothing, and the agent
    // would have to decide what that means. Absence is the statement.
    expect(guidanceEnvOf({ body: 'rendered', declared: false })).toEqual({});
    expect(Object.keys(guidanceEnvOf({ body: 'rendered', declared: true }))).toHaveLength(0);
  });
});
