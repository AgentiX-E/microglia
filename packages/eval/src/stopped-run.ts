/**
 * Which model failures end a run instead of becoming a data point.
 *
 * The lanes wrap every prompt in a `try` so that one unanswered question is one unanswered question
 * rather than a lost sample. That is the right shape for a prompt and the wrong shape for a run: a
 * spent budget, an expired deadline, an account with no credit and an endpoint that has stopped
 * answering are all conditions under which every remaining call fails the same way, and a lane that
 * treats them as data publishes a number describing an outage.
 *
 * The predicate lives here rather than inside one lane because two lanes now need the same answer,
 * and the third to need it should not write a fourth copy. `MG_E_STORE_IO` is deliberately *not* in
 * the list: it is what the client throws for a single prompt that failed after every attempt, which
 * is exactly the case the caller's `try` exists to absorb.
 */
import { MicrogliaError } from '@agentix-e/microglia-core';

export function stoppedRun(error: unknown): boolean {
  if (!(error instanceof MicrogliaError)) return false;
  return (
    error.code === 'MG_E_BUDGET_EXCEEDED' ||
    error.code === 'MG_E_PROVIDER_FAILED' ||
    error.code === 'MG_E_DEADLINE' ||
    // A refused key or a model id the endpoint does not serve arrives as a configuration failure.
    // Continuing past it asks the same wrong question for the rest of the sample.
    error.code === 'MG_E_CONFIG'
  );
}
