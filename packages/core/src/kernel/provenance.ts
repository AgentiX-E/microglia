/**
 * Which tier a signal belongs to.
 *
 * The mapping is by *shape*, not by who sent it: an edit carries a whole corrected
 * artefact and can be re-executed, an outcome is a measurement of one, and the rest
 * are claims. A store that cannot tell those apart is a store where the most
 * articulate user wins.
 */
import type { FeedbackKind, FeedbackSignal, KnowledgePolarity, ProvenanceTier } from './types.js';

export function tierFor(kind: FeedbackKind): ProvenanceTier {
  switch (kind) {
    case 'edit':
      return 'structured-edit';
    case 'outcome':
      return 'outcome';
    case 'preference':
      // A choice between two artefacts is structure about a relation, but it does
      // not say what the right answer was, so it sits with the claims.
      return 'user-text';
    case 'rating':
    case 'clarification':
    case 'abstain':
      return 'user-text';
  }
}

/**
 * Which side of a run a signal sits on.
 *
 * Read from the **signal**, not the kind, and that is the whole point of the function: `kind` names
 * the shape of what arrived, and one shape carries both sides. A `rating` with `value: 'up'` and a
 * `rating` with `value: 'down'` have one kind and two sides, and so do a successful and a failed
 * `outcome`; a store that classified by kind could not tell them apart even in principle.
 *
 * The four remaining kinds are repairs, and the argument is the same for each: an `edit` replaced
 * an artefact, a `preference` rejected one of two, a `clarification` says the answer could not be
 * given as asked, and an `abstain` says it was not given at all. Each is a record of something that
 * did not stand — which is exactly the population a guideline is written from.
 */
export function polarityFor(signal: FeedbackSignal): KnowledgePolarity {
  switch (signal.type) {
    case 'rating':
      return signal.value === 'up' ? 'pass' : 'repair';
    case 'outcome':
      return signal.ok ? 'pass' : 'repair';
    case 'edit':
    case 'preference':
    case 'clarification':
    case 'abstain':
      return 'repair';
  }
}
