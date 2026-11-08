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
 * Every failed task's attempt, keyed by task id.
 *
 * A task with several trials contributes the one with the lowest reward, because that is the attempt
 * the correction was learned from. An unscored trial is ranked last rather than first: it teaches
 * nothing about the failure, and it is kept only when it is the only attempt there is.
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
 */
export function traceOf(
  trace: TaskTrace,
  reference: { readonly expected: readonly string[]; readonly rubric?: readonly string[] },
): Record<string, Json> {
  const rubric = reference.rubric ?? [];
  return {
    trace: {
      attempt: trace.attempt.map((call) => call.detail),
      expected: [...reference.expected],
      ...(rubric.length === 0 ? {} : { rubric: [...rubric] }),
      omitted: trace.omitted,
    },
  };
}

export type DistillUnit = 'correction' | 'trace';

/**
 * Which unit this dispatch distils, defaulting to the one every published arm measured.
 *
 * An unrecognised value is refused rather than read as the default, and that is a deliberate
 * difference from `resolveDistillForm`: a form whose name is misspelt still measures *a* form and the
 * artefact says which one ran, while a unit whose name is misspelt measures the control and reports
 * the control's numbers under a treatment's name. The refusal happens before the first model call.
 */
export function resolveDistillUnit(raw = process.env['TAU_DISTILL_UNIT']): DistillUnit {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === '' || value === 'correction') return 'correction';
  if (value === 'trace') return 'trace';
  throw new RangeError(
    `TAU_DISTILL_UNIT must be unset, 'correction' or 'trace'; received '${String(raw)}'`,
  );
}
