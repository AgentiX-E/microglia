/**
 * An eval arm, stated as the product's own configuration plus the one thing it changes.
 *
 * ## The split this removes
 *
 * R197a gave the product a `serve-profile` and made `createServer` spread it. The eval side was left alone:
 * `tau2-driver.ts` still built its own `openMicroglia({...})` argument list, and `ablation` its own. The two
 * argument lists agreed because somebody kept them in agreement, which is not a mechanism — a treatment arm
 * built by hand can differ from the shipped profile in *two* fields, be reported as one, and the artefact would
 * say nothing about the second. Then the product ships the profile, the paper quotes the arm, and the two
 * numbers describe two programs.
 *
 * So an arm is now **derived**: `serveOptions()` first, then the fields the dispatch actually names, each with
 * the reading or the variable that named it. Two properties follow from the type rather than from discipline:
 *
 *  - no field can be set outside this function, because the driver spreads its result instead of writing its own
 *    keys — a knob added to the call site fails to reach the host;
 *  - every field that moved is *named*, with a reason, and printed beside the run. An arm that moved two fields
 *    is readable as an arm that moved two, which is the whole difference between an experiment and a habit.
 *
 * ## Why a moved field needs a reason and an unmoved one is kept
 *
 * `reason` is not documentation. The record exists so that a hundred rounds later the question "why is this arm
 * not the product" has an answer in the artefact rather than in a commit message. A field named with the same
 * value the profile ships is kept as `unmoved` rather than dropped: the dispatch *asked* for it, and an arm that
 * asked for the default is a different statement from one that never mentioned it — the second cannot be told
 * from a driver too old to know the knob exists.
 *
 * ## What this does not decide
 *
 * The profile's values. An arm that moves `speakMargin` today is a policy question (R123's rung lost), not a
 * binding question: this module makes the delta visible and priced, it does not choose it.
 */
import {
  SERVE_PROFILE,
  SERVE_PROFILE_FIELDS,
  serveOptions,
  type ServeField,
  type ServeOptionValues,
  type ServeProfile,
} from '@agentix-e/microglia-core';

/** The values a field can be moved to, with `undefined` removed: "unset" is the profile, not an override. */
export type ServeValue = {
  readonly [K in ServeField]: NonNullable<ServeOptionValues[K]>;
}[ServeField];

/** One field a dispatch named, and the thing that named it. */
export type ServeOverride = {
  readonly field: ServeField;
  readonly value: ServeValue;
  /**
   * Where the value comes from — a variable, a registration, a reading.
   *
   * Prose rather than an id because the causes are heterogeneous: `TAU_PACK_BUDGET` is a dispatch parameter and
   * `R53's three-level note` is an experiment. Both answer "why is this arm not the product", which is the one
   * question the field has to answer.
   */
  readonly reason: string;
};

export type ArmServe = {
  /** What the arm passes to `openMicroglia`: the profile, then the overrides. */
  readonly options: ServeOptionValues;
  /** The fields this arm moved, in profile order. */
  readonly moved: readonly ServeOverride[];
  /** Fields the dispatch named at the value the profile already ships. */
  readonly unmoved: readonly ServeField[];
};

/** The order a report prints: the profile's, so two arms are read down the same column. */
function sortByField(overrides: readonly ServeOverride[]): readonly ServeOverride[] {
  return [...overrides].sort(
    (left, right) => SERVE_PROFILE_FIELDS.indexOf(left.field) - SERVE_PROFILE_FIELDS.indexOf(right.field),
  );
}

/**
 * The arm's options: the profile, overlaid by the fields the dispatch named.
 *
 * Two refusals, both about an arm that cannot say what it is: the same field named twice (two reasons, one value,
 * and no way to tell which the run was), and an override with no reason (a moved field nobody can account for —
 * the defect this module exists to make impossible).
 */
export function armServeOf(
  overrides: readonly ServeOverride[] = [],
  profile: ServeProfile | undefined = undefined,
): ArmServe {
  const base = profile ?? SERVE_PROFILE;
  const options: Record<string, unknown> = { ...serveOptions(base) };
  const moved: ServeOverride[] = [];
  const unmoved: ServeField[] = [];
  const seen = new Set<ServeField>();
  for (const override of overrides) {
    if (seen.has(override.field)) {
      throw new Error(`arm names '${override.field}' twice: one arm, one value, one reason`);
    }
    seen.add(override.field);
    if (override.reason.trim() === '') {
      throw new Error(`arm moves '${override.field}' without a reason; a moved field must say what moved it`);
    }
    // The profile's own value is the comparison, and `null` is a value: a dispatch that names `note: null` has
    // asked for the renderer's default, which is a statement even when the default does not move.
    const shipped = (base as Readonly<Record<string, unknown>>)[override.field];
    if (override.value === shipped) {
      unmoved.push(override.field);
      continue;
    }
    options[override.field] = override.value;
    moved.push(override);
  }
  return { options: options as ServeOptionValues, moved: sortByField(moved), unmoved };
}

function render(value: unknown): string {
  if (value === null) return 'null (default)';
  return typeof value === 'string' ? value : String(value);
}

/**
 * One line, printed before the run: what this arm is, relative to the product.
 *
 * Printed rather than only recorded because the alternative is a log line that says "memory arm" and an artefact
 * whose knobs the reader has to diff by hand — which is how the product and the arm drifted apart in the first
 * place.
 */
export function armServeLine(arm: ArmServe): string {
  if (arm.moved.length === 0) {
    const named =
      arm.unmoved.length === 0
        ? ''
        : ` (named at the shipped value: ${arm.unmoved.join(', ')} — the dispatch asked, nothing moved)`;
    return `arm = the product's profile${named}`;
  }
  const deltas = arm.moved.map((override) => `${override.field} ${render(override.value)} (${override.reason})`);
  return `arm = profile + ${deltas.join(' + ')}`;
}
