/**
 * R58 — the trace, and the switch that asks for it.
 *
 * ## Why the unit had to move
 *
 * `taskCorrection` renders one failed learning task as one sentence, and the distiller writes one
 * rule from it. Two consequences follow, and both are measured rather than argued: the rule can only
 * be as specific as the sentence (so `when` ends up naming the tools — R54, R56), and one sentence
 * carries one claim, so no two tasks can produce the same item and `supportTasks` is 1 by
 * construction (R55.0: `{1: 7}`).
 *
 * A trace is the object that contains what a correction does not: what the agent actually did, in
 * order, beside what the reference trajectory does. The difference between the two is the lesson,
 * and it is visible only when both are in front of the reader. τ² already writes it — the learning
 * half's document carries `simulations[].messages` — and nothing in this lane had ever read it.
 *
 * ## What this module is careful about
 *
 *  - **Which trial.** A task contributes a correction because it failed, so the trace that teaches is
 *    the failing attempt. Reading the first trial would explain a failure with a success.
 *  - **Which calls.** Assistant messages only, and only calls that carry a name: a reader that
 *    invented a name from a malformed entry would put a tool into the prompt's inventory that the
 *    ban then refuses every candidate for.
 *  - **How much.** The attempt is bounded, and the count that did not fit travels with the payload.
 *    A prompt that shows eight of twenty calls without saying so is a prompt whose reader believes
 *    it saw the attempt.
 */
import type { Json } from '@agentix-e/microglia-core';

/** One call from a trace, rendered as a line a person — or a distiller — can act on. */
export type TraceCall = {
  readonly name: string;
  readonly detail: string;
};

/** One failed task's attempt, as the learning document recorded it. */
export type TaskTrace = {
  readonly taskId: string;
  readonly trial: number;
  readonly attempt: readonly TraceCall[];
  /** `reward_info.reward`, or absent when the trial was never scored. */
  readonly reward?: number;
  /** Calls the attempt held beyond the cap. */
  readonly omitted: number;
};

/** How many calls of one attempt the prompt may see. */
export const TRACE_CALL_CAP = 12;

/** How many characters of one call's arguments survive. */
const DETAIL_CAP = 240;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** `name(key="value", …)`, which is how the rest of this lane renders a call. */
function detailOf(name: string, args: unknown): string {
  const record = asRecord(args);
  if (record === undefined) {
    // A scalar argument, or a string that is not JSON. Both are what the call carried, and rendering
    // the name alone would drop the only record of it — the same defect as a truncated attempt
    // reported without its count.
    if (args === undefined) return name;
    const rendered = typeof args === 'string' ? JSON.stringify(args) : String(args);
    const line = `${name}(${rendered})`;
    return line.length <= DETAIL_CAP ? line : `${line.slice(0, DETAIL_CAP - 1)}…`;
  }
  const parts = Object.entries(record).map(([key, value]) => {
    const rendered = typeof value === 'string' ? JSON.stringify(value) : JSON.stringify(value) ?? 'null';
    return `${key}=${rendered}`;
  });
  const line = `${name}(${parts.join(', ')})`;
  return line.length <= DETAIL_CAP ? line : `${line.slice(0, DETAIL_CAP - 1)}…`;
}

/**
 * The calls in a message list, in order.
 *
 * Two shapes are accepted because τ²'s own writer has produced both across versions: the call's name
 * at the top level of the entry, and the OpenAI shape with it under `function`. Arguments may be an
 * object or a JSON string, and a string that does not parse is kept as a string rather than dropped
 * — it is still the argument the call was made with.
 */
export function parseTraceCalls(messages: unknown): readonly TraceCall[] {
  if (!Array.isArray(messages)) return [];
  const out: TraceCall[] = [];
  for (const entry of messages) {
    const message = asRecord(entry);
    if (message === undefined || message['role'] !== 'assistant') continue;
    const calls = message['tool_calls'];
    if (!Array.isArray(calls)) continue;
    for (const raw of calls) {
      const call = asRecord(raw);
      if (call === undefined) continue;
      const nested = asRecord(call['function']);
      const named = typeof call['name'] === 'string' ? call['name'] : nested?.['name'];
      if (typeof named !== 'string' || named.trim() === '') continue;
      const args = call['arguments'] ?? nested?.['arguments'];
      let parsed: unknown = args;
      if (typeof args === 'string') {
        try {
          parsed = JSON.parse(args);
        } catch {
          parsed = args;
        }
      }
      out.push({ name: named.trim(), detail: detailOf(named.trim(), parsed) });
    }
  }
  return out;
}

function rewardOf(simulation: Record<string, unknown>): number | undefined {
  const info = asRecord(simulation['reward_info']);
  const reward = info?.['reward'];
  return typeof reward === 'number' && Number.isFinite(reward) ? reward : undefined;
}

/**
 * Every task's attempt, keyed by task id.
 *
 * A task with several trials contributes the one with the lowest reward, because that is the attempt
 * the record is about. An unscored trial is ranked last rather than first: it teaches nothing about
 * the failure, and it is kept only when it is the only attempt there is.
 *
 * R62 reads this map under both provenances, and the same rule serves both: for a task that failed,
 * the lowest reward is the failing attempt a repair is learned from; for a task that passed every
 * trial, the lowest reward is still a pass. The two cannot disagree in this lane because the learning
 * phase runs **one trial per task** — so a task whose best reward clears the threshold is a task whose
 * only reward clears it. That is a property of the driver's own call (`trials: 1`), not of this
 * function: a lane that ran the learning half at several trials would need the ranking to follow the
 * provenance, and the paragraph is here so that whoever does it knows which assumption moved.
 */
export function tracesOf(document: unknown, cap = TRACE_CALL_CAP): ReadonlyMap<string, TaskTrace> {
  const root = asRecord(document);
  const simulations = root?.['simulations'];
  if (!Array.isArray(simulations)) return new Map();
  const traces = new Map<string, TaskTrace>();
  for (const raw of simulations) {
    const simulation = asRecord(raw);
    if (simulation === undefined) continue;
    const taskId = simulation['task_id'];
    if (typeof taskId !== 'string' || taskId === '') continue;
    const calls = parseTraceCalls(simulation['messages']);
    const trial = typeof simulation['trial'] === 'number' ? simulation['trial'] : 0;
    const reward = rewardOf(simulation);
    const candidates = traces.get(taskId);
    const ranked = (value: number | undefined): number => (value === undefined ? Number.POSITIVE_INFINITY : value);
    if (candidates !== undefined && ranked(candidates.reward) <= ranked(reward)) continue;
    traces.set(taskId, {
      taskId,
      trial,
      attempt: calls.slice(0, cap),
      ...(reward === undefined ? {} : { reward }),
      omitted: Math.max(0, calls.length - cap),
    });
  }
  return traces;
}

/**
 * The payload the distiller reads, from one trace and the reference half the task document holds.
 *
 * Assembled here rather than in the driver because it is the unit's *shape*, and a shape written at
 * the call site is a shape two call sites disagree about. `rubric` is omitted when the task states
 * none: an empty list would read as "the rubric was empty", which is a different fact from "this
 * task is scored on calls alone".
 *
 * R62 adds the third shape. A record made from a task that **passed** has no reference to compare
 * against — the attempt *is* the reference — so it carries `rubricMet: true` and no `expected` list.
 * Supplying both is refused rather than resolved in a caller's favour: a payload that says "here is
 * what should have happened instead" beside "nothing should have happened instead" is a contradiction
 * the model would have to guess about, and a guess inside a prompt is a measurement nobody declared.
 */
export function traceOf(
  trace: TaskTrace,
  reference: {
    readonly expected?: readonly string[];
    readonly rubric?: readonly string[];
    readonly met?: boolean;
  },
): Record<string, Json> {
  const rubric = reference.rubric ?? [];
  if (reference.met === true) {
    if (reference.expected !== undefined) {
      throw new RangeError(
        'a passing trace states the trajectory that met its checks and no reference trajectory; ' +
          'both were supplied',
      );
    }
    return {
      trace: {
        attempt: trace.attempt.map((call) => call.detail),
        rubricMet: true,
        ...(rubric.length === 0 ? {} : { rubric: [...rubric] }),
        omitted: trace.omitted,
      },
    };
  }
  return {
    trace: {
      attempt: trace.attempt.map((call) => call.detail),
      expected: [...(reference.expected ?? [])],
      ...(rubric.length === 0 ? {} : { rubric: [...rubric] }),
      omitted: trace.omitted,
    },
  };
}

/**
 * What one dispatch distils: the object the store is made of.
 *
 * `correction` and `trace` are two abstractions of the same episode — one sentence about a failed
 * task, or up to three claims about an attempt at one. `raw` (R85) is the episode itself: the
 * question, the calls it should have made, and their arguments, written verbatim and with no model
 * call. It is the control the two preprints in `tau2-rawlog.ts` measure the abstractions against.
 */
export type DistillUnit = 'correction' | 'trace' | 'raw';

/**
 * Which unit this dispatch distils, defaulting to the one every published arm measured.
 *
 * An unrecognised value is refused rather than read as the default, and that is a deliberate
 * difference from `resolveDistillForm`: a form whose name is misspelt still measures *a* form and the
 * artefact says which one ran, while a unit whose name is misspelt measures the control and reports
 * the control's numbers under a treatment's name. The refusal happens before the first model call.
 */
/**
 * Whether this dispatch runs the store's recurrence pass on its unit.
 *
 * `consolidateKnowledge` has run only under `distillUnit: trace` since R58, and every arm since R104 runs
 * `correction` — so the store has kept one item per correction while its own censuses priced 39-53 claims
 * with support up to 5. R121's treatment is one variable: the same lane with the pass enabled.
 *
 * Default `false`, which is exactly what every artefact committed before this resolver existed ran: the
 * trace unit keeps its pass and the correction unit keeps its absence, so no past number is
 * reinterpreted. An unrecognised value is refused for `resolveDistillUnit`'s reason — a misspelt switch
 * that silently measured the control would publish the control under the treatment's name, and the
 * refusal happens before the first model call.
 */
export function resolveConsolidation(raw = process.env['TAU_CONSOLIDATE']): boolean {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === '' || value === 'false') return false;
  if (value === 'true') return true;
  throw new RangeError(`TAU_CONSOLIDATE must be unset, 'true' or 'false'; received '${String(raw)}'`);
}

/**
 * Which key the recurrence pass uses to decide two items are about the same thing.
 *
 * R121 answered the question the hard way. The pass's default key is `scopeKey(item.scope)`, which includes
 * `scope.intent` — a phrase the distiller writes per episode — so a store of 64 items fell into **60**
 * buckets and **4 of 2,016** pairs were ever tested; `merged` was 0 and every refusal counter was 0 with it.
 * `routine` supplies the key the fold and the merge census already share (`actionShapeOf`, the correction's
 * tool sequence), which makes the three numbers one function of one object.
 *
 * Default `scope`, which is exactly what every artefact committed before this resolver ran, so no past
 * reading is reinterpreted. An unrecognised value is refused before the first model call, for the reason
 * `resolveConsolidation` refuses one: a misspelt switch that fell back to the default would publish the
 * control under the treatment's name.
 */
export type ConsolidationKey = 'scope' | 'routine';

export function resolveConsolidationKey(raw = process.env['TAU_CONSOLIDATE_KEY']): ConsolidationKey {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === '') return 'scope';
  if (value === 'scope' || value === 'routine') return value;
  throw new RangeError(
    `TAU_CONSOLIDATE_KEY must be unset, 'scope' or 'routine'; received '${String(raw)}'`,
  );
}

/**
 * How far ahead of its runner-up the best candidate must be for the pack to speak at all.
 *
 * The lane has served a pack on **every** request for twelve rounds, and `served 162 of 162` was read as a
 * coverage figure. It is a default: `buildPack` keeps every hit at floor 0, so no request was able to be
 * refused. The first relevance rung that withholds anything withholds 87 of 162 requests, which is why the
 * question this resolver carries is not a threshold — it is whether the store held *an* answer or several.
 *
 * Unset means 0, the world every artefact committed before this resolver ran: a pack whose store returned
 * anything is served. A positive value is the treatment. A negative, NaN or empty-but-not-empty value is
 * refused before the first model call, for `resolveConsolidation`'s reason — a misread switch that fell back
 * to 0 would publish the control under the treatment's name.
 */
/**
 * Whether the arm records the margin census without gating on it. R123a's one switch.
 *
 * The margin between a store's top two candidates is a property of the store, so a rung that withholds
 * 15-35% of one store's requests can withhold all of another's. Recording the distribution costs nothing —
 * the pack computes the margin anyway — and it is what makes the rung **choosable** rather than guessed:
 * the ladder in the artefact prices every rung at once, on the store the next arm will serve.
 *
 * Unset and `0` are the same fact (no census), and both are distinct from `1`. Any other value is refused
 * before the first model call for `resolveSpeakMargin`'s reason: a misread switch that fell back to "off"
 * would leave an arm reporting `rivaled: 0` and invite the reader to conclude the store had no rivals.
 */
export function resolveSpeakCensus(raw = process.env['TAU_SPEAK_CENSUS']): boolean {
  const value = (raw ?? '').trim();
  if (value === '' || value === '0') return false;
  if (value === '1') return true;
  throw new RangeError(`TAU_SPEAK_CENSUS must be unset, '0' or '1'; received '${String(raw)}'`);
}

export function resolveSpeakMargin(raw = process.env['TAU_SPEAK_MARGIN']): number {
  const value = (raw ?? '').trim();
  if (value === '') return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new RangeError(
      `TAU_SPEAK_MARGIN must be unset or a finite number >= 0; received '${String(raw)}'`,
    );
  }
  return parsed;
}

export function resolveDistillUnit(raw = process.env['TAU_DISTILL_UNIT']): DistillUnit {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === '' || value === 'correction') return 'correction';
  if (value === 'trace') return 'trace';
  if (value === 'raw') return 'raw';
  throw new RangeError(
    `TAU_DISTILL_UNIT must be unset, 'correction', 'trace' or 'raw'; received '${String(raw)}'`,
  );
}
