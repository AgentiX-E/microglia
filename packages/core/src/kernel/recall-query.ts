/**
 * `/v1/recall`'s query, parsed in one place.
 *
 * The route used to build the query inline, one `=== undefined ? {} : ...` per knob, and it forwarded
 * three of the five `RecallQuery` accepts. `minEvidence` — the floor on independent corrections a rule
 * needs before it may be injected — and `anchoring` — whether a scope-matched rule needs a lexical
 * anchor — were described in the kernel's own type comments, honoured by `buildPack` and by the store,
 * and unreachable from the one surface every benchmark driver actually calls. A capability that exists
 * below the wire and not on it is the same defect as a field a projection drops, one layer up, and it
 * is the layer nobody's tests were looking at.
 *
 * So the field list lives here, once, and the route spreads it. A sixth knob added to `RecallQuery`
 * arrives as a compile error in this file rather than as a silence on the wire.
 *
 * The values are validated rather than coerced. `Number('abc')` is `NaN`, `NaN <= 5` is false, and a
 * pack built under a `NaN` limit serves nothing — which reads downstream as "the store had no match",
 * the exact confusion `suppressed` was added to end. A typo has to be an error, not a silence.
 *
 * Every problem is reported rather than the first, because the caller is reading a URL they wrote.
 */
import type { RecallQuery, ShapeMode } from './types.js';
import { SHAPE_MODES } from './types.js';

/** What the route needs from the request besides the knobs, all already read. */
export type RecallFixed = Pick<RecallQuery, 'task' | 'text'> & {
  // `NonNullable` because an indexed access carries `undefined` into the type, and under
  // `exactOptionalPropertyTypes` a `scope?: X | undefined` is not assignable to a `scope?: X`.
  readonly scope?: NonNullable<RecallQuery['scope']>;
};

export type RecallParsed =
  | { readonly query: Omit<RecallQuery, 'namespace'> }
  | { readonly error: string };

const ANCHORINGS: readonly string[] = ['lexical', 'scope'];

/**
 * The route's query, or every reason it cannot be built.
 *
 * `get` is the request's own accessor, so this is testable without an HTTP server and the route keeps
 * owning its status codes. Absent keys stay absent rather than becoming defaults: each of these fields
 * has a documented meaning for "the caller said nothing", and inventing a value here would replace the
 * pack layer's own policy with this file's.
 */
export function recallQueryOf(get: (name: string) => string | undefined, fixed: RecallFixed): RecallParsed {
  const problems: string[] = [];

  /** A knob that has to be a whole number the predicate accepts, or `undefined` and a problem. */
  const whole = (name: string, accepts: (value: number) => boolean, why: string): number | undefined => {
    const raw = get(name);
    if (raw === undefined) return undefined;
    const value = Number(raw);
    if (!Number.isInteger(value) || !accepts(value)) {
      problems.push(`${name} is ${why}`);
      return undefined;
    }
    return value;
  };

  const budget = whole('budget', (value) => value >= 1, 'not a positive integer of characters');
  const limit = whole('limit', (value) => value >= 1, 'not a positive integer of items');
  // The floor the corroboration gate reads. 1 is "one correction is enough", the default every caller
  // had before the field existed; 0 has no meaning — it would admit a rule with no evidence at all —
  // so it is refused rather than rounded up.
  const minEvidence = whole('minEvidence', (value) => value >= 1, 'not a positive count of corrections');
  // The in-episode arm's watermark: only claims learned from strictly earlier attempts may be served.
  // Attempts are 1-based, so 1 — not 0 — is the first attempt, and a negative bound is refused rather
  // than read as "no watermark", because it would silently match every item and present as a store
  // that taught nothing.
  const before = whole('before', (value) => value >= 1, 'not an attempt number');

  const rawCoverage = get('minCoverage');
  let minCoverage: number | undefined;
  if (rawCoverage !== undefined) {
    const value = Number(rawCoverage);
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      problems.push('minCoverage is not a share between 0 and 1');
    } else {
      minCoverage = value;
    }
  }

  const rawAnchoring = get('anchoring');
  if (rawAnchoring !== undefined && !ANCHORINGS.includes(rawAnchoring)) {
    problems.push(`anchoring is not one of ${ANCHORINGS.join(', ')}`);
  }

  // The unit this request wants. R109's switch, and the same rule as every other name here: a spelling
  // that is not one of the two would render a pack whose unit nobody declared, which is precisely the
  // confound the arm exists to remove.
  const rawShape = get('shape');
  if (rawShape !== undefined && !SHAPE_MODES.includes(rawShape as ShapeMode)) {
    problems.push(`shape is not one of ${SHAPE_MODES.join(', ')}`);
  }

  if (problems.length > 0) return { error: problems.join('; ') };

  return {
    query: {
      ...fixed,
      ...(budget === undefined ? {} : { budget }),
      ...(limit === undefined ? {} : { limit }),
      ...(minEvidence === undefined ? {} : { minEvidence }),
      ...(minCoverage === undefined ? {} : { minCoverage }),
      ...(rawAnchoring === undefined ? {} : { anchoring: rawAnchoring as 'lexical' | 'scope' }),
      ...(before === undefined ? {} : { before }),
      ...(rawShape === undefined ? {} : { shape: rawShape as ShapeMode }),
    },
  };
}
