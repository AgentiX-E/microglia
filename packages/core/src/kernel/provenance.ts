/**
 * Which tier a signal belongs to.
 *
 * The mapping is by *shape*, not by who sent it: an edit carries a whole corrected
 * artefact and can be re-executed, an outcome is a measurement of one, and the rest
 * are claims. A store that cannot tell those apart is a store where the most
 * articulate user wins.
 */
import type { FeedbackKind, ProvenanceTier } from './types.js';

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
