/**
 * Number formatting for every artefact the study emits.
 *
 * Two renderers used to carry their own copy of these, which is how a report and
 * a gate can disagree about the same delta by a rounding step. One module, one
 * convention: a rate is a percentage, a difference is percentage points with an
 * explicit sign.
 */

/** A rate: `0.3179` → `"31.79%"`. */
export function pct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

/** A difference: `0.6821` → `"+68.21pp"`, `-0.25` → `"-25.00pp"`. */
export function pp(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${(value * 100).toFixed(2)}pp`;
}

/** A p-value, with the smallest representable value named rather than rounded to zero. */
export function pValue(p: number): string {
  return p < 1e-4 ? '<0.0001' : p.toFixed(4);
}
