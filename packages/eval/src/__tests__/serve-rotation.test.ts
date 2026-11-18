/**
 * How far one item may travel, and what the phase reads when it is bounded.
 *
 * The readings these tests pin are the ones a registration has to be graded on: the cap the phase resolved
 * to, the maximum any item actually took, whether the pack still answered every request, and how many
 * requests were starved because the rotation had spent the store. Each of them is a place where a plausible
 * implementation reports a treatment it did not run — a cap of zero read as "no item travelled", a starved
 * request counted as an empty store, an unrendered pack charged to the item that was not in it.
 */
import { describe, expect, it } from 'vitest';
import {
  reconcileServeRotation,
  readRotationLedger,
  resolveServeRotationPlan,
  rotationCapOf,
  rotationLine,
  rotationModeOf,
  rotationsOf,
  SERVE_ROTATIONS,
  ServeRotationLedger,
} from '../serve-rotation.js';

describe('resolveServeRotationPlan', () => {
  it('leaves the driver excluding nothing when nobody names a policy', () => {
    // Rule one of this family: every committed artefact ran with a request that carried no exclusion, and an
    // undeclared policy has to be the same run rather than the same policy spelled differently.
    expect(resolveServeRotationPlan({})).toEqual({ declared: false });
    expect(resolveServeRotationPlan({ TAU_SERVE_ROTATION: '' })).toEqual({ declared: false });
    expect(resolveServeRotationPlan({ TAU_SERVE_ROTATION: '  ' })).toEqual({ declared: false });
  });

  it('lets a registration declare the identity, which is not the same act as saying nothing', () => {
    // The arm that names `off` is the control for a rotation arm, and a readback that could not tell the two
    // apart would grade a dispatch on which key its header happened to omit.
    expect(resolveServeRotationPlan({ TAU_SERVE_ROTATION: 'off' })).toEqual({ mode: 'off', declared: true });
    expect(resolveServeRotationPlan({ TAU_SERVE_ROTATION: 'fair-share' })).toEqual({
      mode: 'fair-share',
      declared: true,
    });
  });

  it('refuses a spelling it cannot run, before the first episode is paid for', () => {
    // An unknown mode would run the identity and report a treatment, which is the one failure this resolver
    // exists to make impossible.
    expect(() => resolveServeRotationPlan({ TAU_SERVE_ROTATION: 'round-robin' })).toThrow(
      `TAU_SERVE_ROTATION must be unset or one of ${SERVE_ROTATIONS.join(', ')}, not 'round-robin'`,
    );
  });
});

describe('rotationCapOf', () => {
  it('takes the fair share of the requests over the servable items', () => {
    // R143's official fold: forty requests, eleven servable items. The cap is four, and eleven items at four
    // renders cover forty-four requests — enough to answer the phase without any item travelling further.
    expect(rotationCapOf({ requests: 40, servable: 11 })).toEqual({ cap: 4, requests: 40, servable: 11 });
    expect(rotationCapOf({ requests: 74, servable: 11 })).toEqual({ cap: 7, requests: 74, servable: 11 });
  });

  it('rounds up, because a cap that rounds down cannot cover the phase it is a share of', () => {
    expect(rotationCapOf({ requests: 41, servable: 11 }).cap).toBe(4);
    expect(rotationCapOf({ requests: 44, servable: 11 }).cap).toBe(4);
    expect(rotationCapOf({ requests: 45, servable: 11 }).cap).toBe(5);
  });

  it('never falls below one, so a store larger than the phase still serves it', () => {
    // Three hundred items against forty requests: the fair share is a seventh of a render, and a zero here
    // would silently disable the memory instead of measuring a spread over a store that has more than enough.
    expect(rotationCapOf({ requests: 40, servable: 300 }).cap).toBe(1);
  });

  it('reports zero when there is nothing to share, and says which nothing it was', () => {
    // The two empty cases are different findings — a phase that asked nothing and a store that could serve
    // nothing — so the reading keeps both counts rather than a single zero.
    expect(rotationCapOf({ requests: 0, servable: 11 })).toEqual({ cap: 0, requests: 0, servable: 11 });
    expect(rotationCapOf({ requests: 40, servable: 0 })).toEqual({ cap: 0, requests: 40, servable: 0 });
    expect(rotationCapOf({ requests: -5, servable: 2 })).toEqual({ cap: 0, requests: 0, servable: 2 });
    expect(rotationCapOf({ requests: 3.7, servable: 2.2 })).toEqual({ cap: 2, requests: 3, servable: 2 });
  });
});

describe('ServeRotationLedger', () => {
  const cap = (requests: number, servable: number): number => rotationCapOf({ requests, servable }).cap;

  it('excludes an item only once it has taken its full share', () => {
    // The boundary is the whole policy: an item at `cap - 1` renders may still travel, one at `cap` may not.
    // Nine requests over three items is a cap of three, so the third render is the last one allowed.
    const ledger = new ServeRotationLedger(rotationCapOf({ requests: 9, servable: 3 }));
    expect(cap(9, 3)).toBe(3);
    ledger.record(['k_a']);
    ledger.record(['k_a']);
    expect(ledger.next().exclude).toEqual([]);
    ledger.record(['k_a']);
    expect(ledger.next().exclude).toEqual(['k_a']);
  });

  it('reports the ids in id order, so two runs of one phase print the same line', () => {
    // Two requests over two items is a cap of one, so a single render takes an item to its share.
    const ledger = new ServeRotationLedger(rotationCapOf({ requests: 2, servable: 2 }));
    ledger.record(['k_b']);
    ledger.record(['k_a']);
    expect(ledger.next().exclude).toEqual(['k_a', 'k_b']);
  });

  it('counts a request as starved only when every servable item had travelled', () => {
    const ledger = new ServeRotationLedger(rotationCapOf({ requests: 4, servable: 2 }));
    // Two items at a cap of two: four renders, in two packs, is the whole budget.
    ledger.record(['k_a', 'k_b']);
    ledger.record(['k_a', 'k_b']);
    // Both items are at their cap, so the next request can only be answered by an empty pack — which is the
    // count that separates a spent rotation from an empty store.
    expect(ledger.next()).toEqual({ exclude: ['k_a', 'k_b'], starved: true });
    expect(ledger.next()).toEqual({ exclude: ['k_a', 'k_b'], starved: true });
    expect(ledger.reading().starved).toBe(2);
  });

  it('does not count a request as starved when the store merely had nothing to say', () => {
    // An empty pack charges nothing, so a phase whose store answered one request in ten must not read as a
    // rotation that spent the store: the ledger counts renders, not requests.
    const ledger = new ServeRotationLedger(rotationCapOf({ requests: 10, servable: 2 }));
    for (let index = 0; index < 10; index += 1) ledger.next();
    expect(ledger.reading()).toEqual({
      cap: 5,
      requests: 10,
      servable: 2,
      distinct: 0,
      renders: 0,
      exhausted: [],
      starved: 0,
      maxRenders: 0,
    });
  });

  it('charges nothing and excludes nothing when the cap is zero', () => {
    // A store that can serve nothing and a phase that asks nothing both resolve to zero, and a ledger that
    // started counting there would report renders against a store that was never asked.
    const ledger = new ServeRotationLedger(rotationCapOf({ requests: 0, servable: 0 }));
    ledger.record(['k_a', 'k_b']);
    expect(ledger.next()).toEqual({ exclude: [], starved: false });
    expect(ledger.reading().renders).toBe(0);
    expect(ledger.reading().distinct).toBe(0);
  });

  it('charges every id a pack carried, which is one id per item and not one per line', () => {
    // A folded pack renders one line for several items; the question the cap answers is how often an *item*
    // was put in front of an episode, so both ids are charged to the same request.
    const ledger = new ServeRotationLedger(rotationCapOf({ requests: 4, servable: 2 }));
    ledger.record(['k_a', 'k_b']);
    const reading = ledger.reading();
    expect(reading.renders).toBe(2);
    expect(reading.distinct).toBe(2);
    expect(reading.maxRenders).toBe(1);
  });

  it('reports the maximum any item took, which is how a cap that never bound is visible', () => {
    // `max 3` under `cap 4` is the reading that says the ranking never reached the cap: the arm ran, and it
    // ran as the control. Print the cap alone and that dispatch reads as a treatment.
    const ledger = new ServeRotationLedger(rotationCapOf({ requests: 40, servable: 11 }));
    ledger.record(['k_a']);
    ledger.record(['k_a']);
    const reading = ledger.reading();
    expect(reading.cap).toBe(4);
    expect(reading.maxRenders).toBe(2);
    expect(reading.exhausted).toEqual([]);
    expect(reading.requests).toBe(0);
  });
});

describe('rotationModeOf', () => {
  it('reads a stated mode as itself, including the identity', () => {
    // The pool compares this string, so `off` and `fair-share` must stay two values: an arm that declared the
    // control is not an arm that never heard of the switch.
    expect(rotationModeOf({ mode: 'off' })).toBe('off');
    expect(rotationModeOf({ mode: 'fair-share' })).toBe('fair-share');
  });

  it('reads an absent block as no policy at all, which is every artefact before the switch', () => {
    expect(rotationModeOf(undefined)).toBe('none');
  });

  it('reads a block without a mode as the policy that writes one', () => {
    // R152's own artefact: the reading was written before the report carried the policy, and the only policy
    // that writes a block is the one that acted. A reader that called this `none` would pool the first
    // rotation fold with a run that never bounded anything.
    expect(rotationModeOf({ cap: 4, servable: 11 })).toBe('fair-share');
    expect(rotationModeOf({ mode: 'round-robin' })).toBe('fair-share');
  });
});

describe('rotationsOf', () => {
  it('reads the items a pack carried, not the text it rendered', () => {
    // The ids and never `rendered`: a folded pack's one line can stand for four items, and the cap is a
    // statement about items.
    expect(rotationsOf({ ids: ['k_a', 'k_b'] })).toEqual(['k_a', 'k_b']);
  });
});

describe('rotationLine', () => {
  const reading = (overrides: Partial<Parameters<typeof rotationLine>[0]> = {}) => ({
    cap: 4,
    requests: 40,
    servable: 11,
    distinct: 10,
    renders: 40,
    exhausted: ['k_a'],
    starved: 0,
    maxRenders: 4,
    ...overrides,
  });

  it('states the cap, the maximum and the spread in one sentence', () => {
    expect(rotationLine(reading())).toBe(
      'serve rotation: cap 4 per item from 40 request(s) over 11 servable item(s); max 4, ' +
        '40 render(s) over 10 item(s), 1 exhausted',
    );
  });

  it('names the starved requests only when there are any', () => {
    expect(rotationLine(reading({ starved: 3 }))).toContain(', 1 exhausted, 3 starved request(s)');
    expect(rotationLine(reading())).not.toContain('starved');
  });

  it('distinguishes a store that can serve nothing from a phase that asked nothing', () => {
    // Both resolve to a cap of zero and they are different findings: one is a floor that retired everything,
    // the other is a dispatch that stopped before it served.
    expect(rotationLine(reading({ cap: 0, servable: 0 }))).toBe(
      'serve rotation: absent (the store can serve nothing, so no share exists)',
    );
    expect(rotationLine(reading({ cap: 0, requests: 0, servable: 11 }))).toBe(
      'serve rotation: absent (no request was made; fair share over 11 item(s) is unmeasured)',
    );
  });
});

describe('the block against the ledger it kept', () => {
  // R152 shipped a block built from a snapshot taken before the loop: `requests: 0`, `renders: 0`, `maxRenders: 0`
  // beside a log line saying forty renders over fourteen items. The ledger was in the same file, unread. These
  // cases pin the reader that compares them, and the reason each field is or is not reachable from it.
  const ledger = [['k_a'], ['k_a'], ['k_a'], ['k_b'], [], []];

  it('reads the four counts a ledger can account for', () => {
    expect(readRotationLedger(ledger)).toEqual({
      requests: 6,
      renders: 4,
      distinct: 2,
      maxRenders: 3,
      emptyRequests: 2,
    });
  });

  it('agrees with a block the same arithmetic produced', () => {
    const reconciled = reconcileServeRotation(
      { mode: 'fair-share', cap: 3, requests: 6, renders: 4, distinct: 2, maxRenders: 3, exhausted: ['k_a'], starved: 0 },
      ledger,
    );
    expect(reconciled.problems).toEqual([]);
    expect(reconciled.checked).toContain('exhausted');
  });

  it('names the field that disagrees, with both numbers', () => {
    // The exact shape of the defect: a snapshot taken before the phase reports nothing served.
    const reconciled = reconcileServeRotation({ mode: 'fair-share', cap: 3, requests: 0, renders: 0, maxRenders: 0 }, ledger);
    expect(reconciled.problems).toEqual([
      'requests: the block says 0, the ledger accounts for 6',
      'renders: the block says 0, the ledger accounts for 4',
      'maxRenders: the block says 0, the ledger accounts for 3',
    ]);
  });

  it('checks `exhausted` only when the block states the cap it is a function of', () => {
    // Without a cap there is no rung to derive the list at, and a comparison against a guess would invent the
    // defect it reports rather than find one.
    const withoutCap = reconcileServeRotation({ exhausted: ['k_b'] }, ledger);
    expect(withoutCap.problems).toEqual([]);
    expect(withoutCap.unchecked).toContain('exhausted');
    const withCap = reconcileServeRotation({ cap: 3, exhausted: ['k_b'] }, ledger);
    expect(withCap.problems).toEqual([
      "exhausted: the block names 1 item(s), the ledger's cap of 3 exhausts 1",
    ]);
    const zeroCap = reconcileServeRotation({ cap: 0, exhausted: [] }, ledger);
    expect(zeroCap.problems).toEqual([]);
  });

  it('bounds `starved` from above rather than deriving it, because an empty pack has two causes', () => {
    // A request whose pack was empty is either a spent rotation or a store with nothing to say, and the ledger
    // holds the same empty list for both — so the strongest claim it can support is a ceiling.
    expect(reconcileServeRotation({ starved: 2 }, ledger).problems).toEqual([]);
    expect(reconcileServeRotation({ starved: 3 }, ledger).problems).toEqual([
      'starved: the block says 3, the ledger holds 2 empty request(s)',
    ]);
    expect(reconcileServeRotation({ starved: 0 }, ledger).checked).toContain('starved (bounded above)');
  });

  it('says which fields it cannot reach, and never that they agree', () => {
    const reconciled = reconcileServeRotation({ mode: 'off', cap: 3 }, ledger);
    // The policy is the one field no ledger holds: this is why R152's fold could not be repaired at $0.
    expect(reconciled.unchecked).toEqual(['mode', 'cap', 'servable']);
    expect(reconciled.checked).toEqual(['requests', 'renders', 'distinct', 'maxRenders']);
    expect(reconciled.problems).toEqual([]);
  });

  it('compares nothing against nothing, rather than passing an absent field off as agreement', () => {
    const reconciled = reconcileServeRotation({}, []);
    expect(reconciled.problems).toEqual([]);
    expect(reconciled.checked).toEqual(['requests', 'renders', 'distinct', 'maxRenders']);
  });
});
