/**
 * The things the τ² lane's learning half needs from its model interpreter.
 *
 * ## Why this is not `combineInterpreters`
 *
 * `combineInterpreters` is a composition: it runs every interpreter it is given, and an interpreter
 * that throws ends the batch event with that error. Its docstring called the second argument a
 * "generic fallback", which is what this lane read, and what the R41 dispatch proved it is not — the
 * model interpreter threw on all thirty-two corrections, the rule interpreter that would have
 * produced a negative lesson never ran, and the arm evaluated a store with nothing in it.
 *
 * The lane cannot simply adopt "run the rules when the model fails" as a blanket policy, either. A
 * pack of generic negative lessons is a *different treatment* from a pack of distilled procedures,
 * and a run that silently swapped one for the other would report the substitution as the memory's
 * effect. So the fallback here is conditional on the failure being this event's rather than the
 * run's, which is what `stoppedRun` decides.
 *
 * ## What the record gets
 *
 * `faults()` is the count of events the model did not answer and the rules did — named, per code,
 * so the arm's artefact can say "12 of 32 corrections were distilled by the fallback" instead of
 * "the store has 32 rules in it". Without that count the two substrates are indistinguishable from
 * outside, which is the defect this module exists to close.
 *
 * ## What the second export is for
 *
 * `stampDomain` closes the other half of the same door: a store whose items carry a domain the
 * recall path never asks in. Its symptom is a pack of zero items beside fourteen stored ones, which
 * is a number that names no cause until both facts sit in one sentence.
 */
import type { Interpreter } from '@agentix-e/microglia-core/distill';
import { MicrogliaError } from '@agentix-e/microglia-core';
import { stoppedRun } from './stopped-run.js';

export type InterpreterFaults = {
  /** Events the primary interpreter threw on. */
  readonly events: number;
  /** The code of each such failure, in order, or `unknown` for a non-`MicrogliaError`. */
  readonly reasons: readonly string[];
};

export type ResilientInterpreter = {
  readonly interpreter: Interpreter;
  readonly faults: () => InterpreterFaults;
};

/** The `MG_E_*` code a thrown value carries, when it carries one. */
function codeOf(error: unknown): string {
  return error instanceof MicrogliaError ? error.code : 'unknown';
}

export function resilientInterpreter(
  primary: Interpreter,
  fallback: Interpreter,
  options: { readonly fatal?: (error: unknown) => boolean } = {},
): ResilientInterpreter {
  const fatal = options.fatal ?? stoppedRun;
  let events = 0;
  const reasons: string[] = [];

  const interpreter: Interpreter = async (context) => {
    try {
      return await primary(context);
    } catch (error) {
      events += 1;
      reasons.push(codeOf(error));
      // A failure of the run rather than of the event: rethrown so the caller's `fatal` predicate
      // can stop the run, and never answered by the fallback, because a store built underneath an
      // outage is a store nobody can attribute.
      if (fatal(error)) throw error;
      try {
        return await fallback(context);
      } catch {
        // The fallback failing too is not a second fact: a rule interpreter that cannot answer an
        // event is usually a consequence of whatever broke upstream, and the first error is the one
        // that describes it.
        throw error;
      }
    }
  };
  // Forwarded rather than dropped: the primary is the interpreter that pays for round trips, and a
  // wrapper that hid its `prefetch` would turn a batched prompt into one prompt per event.
  if (primary.prefetch !== undefined) {
    interpreter.prefetch = primary.prefetch;
  }

  return { interpreter, faults: () => ({ events, reasons: [...reasons] }) };
}

/**
 * Stamp the host's observed domain onto every claim an interpreter returns.
 *
 * `parseScope` keeps the task from the event — the model cannot rename it — but takes `domain` from
 * the model's own JSON. The prompt forbids a guess and nothing validates one, so a claim can be
 * stored under a spelling no reader will ever ask in: recall filters items by `scope.task` *and*
 * `scope.domain`, and an item whose domain is `retail domain` or `retail_domain` is stored, counted
 * by `V44` (it has a domain), and unreachable. The pack is then empty for every question, which the
 * record reports as `0.00 rules/question` beside a store of fourteen items — a number that names no
 * cause, because the two facts live in different fields and neither explains the other.
 *
 * The host is the only party that observes the scenario, so its spelling wins, and it wins as an
 * override rather than a default: a model that answers `airline` for a run that learned in `retail`
 * has produced an item this lane will never serve, and leaving that value in place would file a
 * modelling mistake under "the memory does not work".
 *
 * `prefetch` is forwarded for the reason `resilientInterpreter` forwards it: what this wraps is the
 * interpreter that pays for round trips, and a wrapper that dropped `prefetch` would turn a batched
 * prompt into one prompt per event.
 */
export function stampDomain(interpreter: Interpreter, domain: string): Interpreter {
  const stamped: Interpreter = async (context) =>
    (await interpreter(context)).map((candidate) => ({
      ...candidate,
      scope: { ...candidate.scope, domain },
    }));
  if (interpreter.prefetch !== undefined) {
    stamped.prefetch = interpreter.prefetch;
  }
  return stamped;
}
