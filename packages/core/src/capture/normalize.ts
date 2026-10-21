/**
 * Normalisation: host intent in, one immutable event out.
 *
 * The event is the unit of record, not the click. A host can call `edit()` with
 * a whole document; this layer computes the structural delta, the normalised
 * distance, and both hashes, so the exported dataset can be reconstructed
 * without trusting the host to have computed any of it correctly.
 */
import {
  MicrogliaError,
  clamp01,
  diffJson,
  editDistance,
  hashJson,
  redact,
  redactJson,
} from '../kernel/index.js';
import type {
  Actor,
  FeedbackEvent,
  FeedbackSignal,
  Json,
  RunRecord,
} from '../kernel/index.js';
import type { FeedbackInput } from './options.js';
import { normaliseReasons, trustFor } from './trust.js';

export type BuildEventArgs = {
  readonly input: FeedbackInput;
  readonly run: RunRecord;
  readonly namespace: string;
  readonly at: number;
  readonly id: string;
  readonly actor: Actor;
  readonly trustCeiling?: number;
  readonly editSemantics?: (before: Json, after: Json) => number | undefined;
};

export function buildFeedbackEvent(args: BuildEventArgs): FeedbackEvent {
  const { input, run } = args;
  let redactions = 0;

  const signal = toSignal(input, run, (count) => {
    redactions += count;
  }, args.editSemantics);
  const derived = trustFor(signal);
  const ceiling = args.trustCeiling;
  const trust = ceiling === undefined ? derived : Math.min(derived, clamp01(ceiling));

  return {
    schema: 'microglia.feedback/1',
    id: args.id,
    at: args.at,
    namespace: args.namespace,
    sessionId: run.sessionId,
    runId: run.id,
    task: run.task,
    kind: input.type,
    actor: args.actor,
    trust,
    signal,
    provenance: run.provenance,
    redactions,
  };
}

function toSignal(
  input: FeedbackInput,
  run: RunRecord,
  addRedactions: (count: number) => void,
  editSemantics?: (before: Json, after: Json) => number | undefined,
): FeedbackSignal {
  switch (input.type) {
    case 'rating':
      return {
        type: 'rating',
        value: input.value,
        reasons: normaliseReasons(input.reasons),
        ...(input.comment === undefined ? {} : { comment: clean(input.comment, 500, addRedactions) }),
      };

    case 'edit': {
      if (run.output === undefined) {
        throw new MicrogliaError('MG_E_NO_OUTPUT', 'Cannot edit a run with no output', {
          runId: run.id,
        });
      }
      const before = run.output;
      const after = redactJson(input.after);
      addRedactions(countRedactions(input.after, after));
      const ops = diffJson(before, after);
      if (ops.length === 0) {
        throw new MicrogliaError('MG_E_INVALID_SIGNAL', 'Edit does not change the output', {
          runId: run.id,
        });
      }
      const semantic = editSemantics?.(before, after);
      const distance = semantic === undefined ? editDistance(before, after, ops) : semantic;
      return {
        type: 'edit',
        beforeHash: hashJson(before),
        afterHash: hashJson(after),
        ops,
        distance: clamp01(distance),
        after,
      };
    }

    case 'preference':
      requireId(input.chosenRunId, 'chosenRunId');
      requireId(input.rejectedRunId, 'rejectedRunId');
      if (input.chosenRunId === input.rejectedRunId) {
        throw new MicrogliaError('MG_E_INVALID_SIGNAL', 'A preference needs two distinct runs');
      }
      return {
        type: 'preference',
        chosenRunId: input.chosenRunId,
        rejectedRunId: input.rejectedRunId,
        ...(input.criterion === undefined
          ? {}
          : { criterion: clean(input.criterion, 120, addRedactions) }),
      };

    case 'outcome':
      return {
        type: 'outcome',
        ok: input.ok,
        ...(input.code === undefined ? {} : { code: clean(input.code, 64, addRedactions) }),
        ...(input.detail === undefined ? {} : { detail: clean(input.detail, 500, addRedactions) }),
      };

    case 'clarification':
      return {
        type: 'clarification',
        question: clean(input.question, 300, addRedactions),
        answer: clean(input.answer, 1000, addRedactions),
      };

    case 'abstain':
      return { type: 'abstain', reason: clean(input.reason, 200, addRedactions) };
  }
}

function clean(value: string, max: number, addRedactions: (count: number) => void): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new MicrogliaError('MG_E_INVALID_SIGNAL', 'Empty string in feedback');
  }
  const redacted = redact(trimmed.slice(0, max));
  addRedactions(redacted.count);
  return redacted.text;
}

function requireId(value: string, field: string): void {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) {
    throw new MicrogliaError('MG_E_INVALID_SIGNAL', `Invalid ${field}`);
  }
}

/**
 * Count string spans that redaction actually changed.
 *
 * This used to count *structural* changes, which made an edit without any secret
 * report four redactions. The counter is an audit signal, so it must count
 * redactions, not differences.
 */
function countRedactions(before: Json, after: Json): number {
  if (typeof before === 'string' && typeof after === 'string') {
    return before === after ? 0 : 1;
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    let count = 0;
    const common = Math.min(before.length, after.length);
    for (let i = 0; i < common; i += 1) {
      count += countRedactions(before[i] as Json, after[i] as Json);
    }
    return count;
  }
  if (
    before !== null &&
    after !== null &&
    typeof before === 'object' &&
    typeof after === 'object' &&
    !Array.isArray(before) &&
    !Array.isArray(after)
  ) {
    let count = 0;
    for (const key of Object.keys(after)) {
      const left = (before as { [key: string]: Json })[key];
      const right = (after as { [key: string]: Json })[key];
      if (left !== undefined && right !== undefined) count += countRedactions(left, right);
    }
    return count;
  }
  return 0;
}

/**
 * A run's output must be plain JSON; anything else cannot be persisted or diffed.
 *
 * The round-trip is the test: a `BigInt`, a function, or a circular reference all
 * fail inside `stringify`, and `undefined` fails inside `parse`. One `try` covers
 * both, which is why there is no separate check for it.
 */
export function assertJsonOutput(value: Json): void {
  try {
    JSON.parse(JSON.stringify(value)) as Json;
  } catch (error) {
    throw new MicrogliaError('MG_E_INVALID_SIGNAL', 'Output is not serialisable JSON', {
      cause: String(error),
    });
  }
}
