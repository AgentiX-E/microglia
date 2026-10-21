/**
 * The fallback interpreter: what can be learned without a domain pack.
 *
 * A thumbs-down with a reason, or a failed execution with an error code, is a
 * *negative* lesson. It says "this fails", not "do that instead". Storing it as
 * such is the honest representation: it can steer a prompt away from a failure
 * mode, and it cannot pretend to know the fix.
 */
import { contentKey } from '../kernel/index.js';
import type { DistillCandidate, FeedbackEvent } from '../kernel/index.js';
import type { Interpreter } from './types.js';

const TRUST = {
  explicitReason: 0.55,
  outcomeCode: 0.6,
  clarification: 0.8,
} as const;

export function ruleBasedCandidates(event: FeedbackEvent): readonly DistillCandidate[] {
  const { signal } = event;
  const out: DistillCandidate[] = [];

  if (signal.type === 'rating' && signal.value === 'down' && signal.reasons.length > 0) {
    for (const reason of signal.reasons) {
      out.push({
        namespace: event.namespace,
        kind: 'negative',
        scope: { task: event.task, reasonCode: reason },
        statement: `Answers in this task are rejected for: ${reason}. Avoid that failure mode.`,
        payload: { reason },
        evidence: {
          feedbackId: event.id,
          runId: event.runId,
          at: event.at,
          weight: TRUST.explicitReason,
        },
        trust: Math.min(event.trust, TRUST.explicitReason),
        dedupeKey: contentKey(`negative|${event.task}|${reason}`),
      });
    }
  }

  if (signal.type === 'outcome' && !signal.ok && signal.code) {
    out.push({
      namespace: event.namespace,
      kind: 'negative',
      scope: { task: event.task, reasonCode: signal.code },
      statement: `Calls in this task fail with ${signal.code}. Avoid outputs that trigger it.`,
      payload: { code: signal.code },
      evidence: {
        feedbackId: event.id,
        runId: event.runId,
        at: event.at,
        weight: TRUST.outcomeCode,
      },
      trust: Math.min(event.trust, TRUST.outcomeCode),
      dedupeKey: contentKey(`outcome|${event.task}|${signal.code}`),
    });
  }

  if (signal.type === 'clarification') {
    // A clarification is the user teaching the system what a word means. It is
    // scoped to the task rather than to the field because the event carries no
    // schema reference; a domain pack should interpret it with one.
    out.push({
      namespace: event.namespace,
      kind: 'lexicon',
      scope: { task: event.task },
      statement: `"${signal.question}" is clarified as: ${signal.answer}`,
      payload: { question: signal.question, answer: signal.answer },
      evidence: {
        feedbackId: event.id,
        runId: event.runId,
        at: event.at,
        weight: TRUST.clarification,
      },
      trust: Math.min(event.trust, TRUST.clarification),
      dedupeKey: contentKey(`clarification|${event.task}|${signal.question}`),
    });
  }

  return out;
}

/** Adapter for the default `Interpreter` slot. */
export const ruleInterpreter: Interpreter = (context) => ruleBasedCandidates(context.event);

/**
 * Compose interpreters: the domain pack first, then the generic fallback.
 *
 * Order matters only for determinism; candidates are deduped by claim, not by
 * position. A host that supplies a chart interpreter still gets negative
 * lessons from ratings and clarifications.
 */
export function combineInterpreters(...interpreters: readonly Interpreter[]): Interpreter {
  return async (context) => {
    const out = [];
    for (const interpreter of interpreters) {
      out.push(...(await interpreter(context)));
    }
    return out;
  };
}
