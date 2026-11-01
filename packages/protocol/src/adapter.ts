/**
 * The five-method contract a scenario implements to be measured by the shared protocol.
 *
 * ## Why the contract is this small
 *
 * A protocol that knows how a lane parses and scores is a protocol that knows the lane, and this
 * repository has already built one of those: six thousand lines inside a single binary, with the
 * decisions — the prompt, the gate thresholds, the arm parser — as the least covered part of the
 * tree. The split that fixed it was "everything decidable is pure and lives outside the CLI". This
 * contract is the second split, and it is the same idea applied between scenarios rather than between
 * layers: the protocol owns what every run has, the adapter owns what only its scenario has.
 *
 * ## What each method is load-bearing for
 *
 * | method | the failure it prevents |
 * |---|---|
 * | `load` | a fold partition computed over a list that changed order between arms |
 * | `prompt` | a renderer that learns a scenario's vocabulary, and becomes unportable |
 * | `parse` | a malformed reply recorded as a wrong answer, or as a crash that takes a fold with it |
 * | `score` | a protocol that has to know what correctness means, which is a second copy of the lane |
 * | `strata` | a stratum conditioned on an outcome, which measures regression to the mean |
 *
 * ## The one property that is enforced rather than asked for
 *
 * `strata` receives a task and nothing else. An outcome-blind stratifier is a rule this record has
 * stated in prose twice and broken zero times by discipline; making the signature carry it is the
 * difference between a rule and a habit. There is no argument to pass an arm's result through.
 */

import type { ValidityGate } from './gates.js';

/**
 * A scenario, reduced to what the protocol needs.
 *
 * Three type parameters rather than one, because the protocol must not be able to name a scenario's
 * types: `Task` is whatever the lane scores, `Candidate` is whatever it parses a reply into, and
 * `Pack` is whatever it renders — deliberately unconstrained, so this module imports nothing.
 */
export interface LaneAdapter<Task, Candidate, Pack> {
  /**
   * The tasks this lane scores, in a stable order.
   *
   * Stable matters more than sorted: every fold partition downstream is computed over this array's
   * indices, so a loader that returns tasks in a different order between the two arms of a contrast
   * silently pairs a question with another question's answer.
   */
  load(): Promise<readonly Task[]>;

  /**
   * The prompt for one task.
   *
   * Rendering belongs to the adapter because the pack's placement in a prompt is a property of the
   * scenario — a SQL lane puts it above the schema, a chart lane puts it above the table labels — and
   * a protocol that rendered would have to grow one branch per scenario.
   */
  prompt(task: Task, pack: Pack): string;

  /**
   * A reply that cannot be read is not a wrong answer.
   *
   * Returning `undefined` is how the lane says "the model did not answer in a form I can score", and
   * it is a distinct outcome from scoring false: the parse-rate gate separates them, and a lane that
   * throws instead converts the first into a crash that takes the fold with it.
   */
  parse(raw: string): Candidate | undefined;

  /**
   * Whether one candidate is correct for one task.
   *
   * Only the lane can answer this — it executes the query, or matches the tool call, or reads the
   * judgement — and that is precisely why the protocol is scenario-agnostic: it never learns what
   * correctness means, only whether the caller said yes.
   */
  score(task: Task, candidate: Candidate): Promise<boolean>;

  /**
   * The outcome-blind strata a claim may be restricted to.
   *
   * Reads the task and nothing else. A stratum defined by an arm's outcome — "the questions the hint
   * rescued" — pulls that arm's rate down inside the stratum, and part of any difference measured
   * there is regression to the mean. The signature is the enforcement.
   */
  strata(task: Task): readonly string[];
}

/**
 * A gate contributed by a scenario rather than by the protocol.
 *
 * Same shape as a protocol gate on purpose: a reader of an artefact must not be able to tell which
 * layer a gate came from, because the artefact is a single claim about a single run. The distinction
 * exists for the code, not for the report.
 */
export type ScenarioGate = ValidityGate;

/**
 * Merge a scenario's gates into the protocol's, in publication order.
 *
 * The scenario's gates are appended and then sorted by `inGateOrder`, which places known ids where the
 * protocol publishes them and leaves an unknown id at the end. Merging rather than concatenating is
 * what keeps a lane's own gates from displacing `V1` from the first line of every report.
 */
export function mergeGates(
  protocol: readonly ValidityGate[],
  scenario: readonly ScenarioGate[],
  order: (gates: readonly ValidityGate[]) => ValidityGate[],
): ValidityGate[] {
  return order([...protocol, ...scenario]);
}

/**
 * Whether a gate list stops a run.
 *
 * Separated from the list itself because two readers need different answers: a publisher refuses to
 * publish anything when a blocking gate fails, while a report shows every gate including the advisory
 * ones. Folding this into the gate object would make `pass` mean two things.
 */
export function blockingFailure(gates: readonly ValidityGate[]): ValidityGate | undefined {
  return gates.find((gate) => gate.blocking && !gate.pass);
}
