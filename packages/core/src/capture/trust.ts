/**
 * Trust is derived from the signal, not from the person.
 *
 * A verified execution failure is stronger evidence than a silent edit, and a
 * silent edit is stronger than a bare thumbs-down. Encoding that ordering once
 * is what keeps the admission thresholds meaningful across hosts: a host cannot
 * accidentally make every click authoritative by passing a different actor id.
 *
 * The numbers are set against `Policy.singleObservationTrust = 0.7`:
 *  - a substantive edit (>= 15% of leaves) activates on its own;
 *  - a small edit or a reasoned thumbs-down needs corroboration;
 *  - an unreasoned thumbs-down never activates alone.
 */
import { clamp01 } from '../kernel/index.js';
import type { FeedbackSignal } from '../kernel/index.js';

export function trustFor(signal: FeedbackSignal): number {
  switch (signal.type) {
    case 'edit': {
      // A one-character fix is often formatting; a third of the document
      // rewritten is a different task. The curve is linear in between.
      return clamp01(0.5 + 0.4 * clamp01(signal.distance / 0.3));
    }
    case 'rating':
      if (signal.value === 'up') return 0.5;
      return signal.reasons.length > 0 ? 0.6 : 0.45;
    case 'outcome':
      // A verified execution result outranks any human edit: it is measured,
      // not judged. Kept below 1 so no single observation is ever certainty.
      return 0.95;
    case 'clarification':
      return 0.85;
    case 'preference':
      return 0.7;
    case 'abstain':
      return 0.4;
  }
}

/** Reasons are curated by the host; an unbounded list is an injection surface. */
export function normaliseReasons(reasons: readonly string[] | undefined): readonly string[] {
  if (!reasons) return [];
  const seen = new Set<string>();
  for (const reason of reasons) {
    const trimmed = reason.trim().slice(0, 64);
    if (trimmed.length > 0) seen.add(trimmed);
    if (seen.size >= 8) break;
  }
  return [...seen];
}
