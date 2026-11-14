/**
 * The one correction the distiller is asked about before an arm pays for its learn half.
 *
 * ## Why this exists
 *
 * R104's dispatch ran 74 learn episodes, produced fifteen corrections, asked the distiller about
 * all fifteen, and got **nothing** back — fifteen empty replies, no throw, no dropped claim. The
 * funnel said so in one sentence and the run stopped. That sentence cost the learn half (§R111),
 * and it is the second time this lane has paid for a full learning phase to discover something one
 * model call would have said: R41 scored 36.0 from a store that held nothing, which is the same
 * fact at the other end of the pipeline.
 *
 * A provider probe answers "does the endpoint reply at all" — it sends *"reply with the single word
 * ready"*. A model that is reachable, cheap and unable to write a claim passes that probe and fails
 * the arm. The question this module asks is the actual one: **given this arm's prompt form and
 * population, does the distiller produce a claim from a correction that states one?**
 *
 * ## What it is not
 *
 * It is not a gate on the arm's corrections: it uses a fixture, so an arm whose own corrections are
 * unlearnable still passes the pre-flight and still fails at the funnel. That is the limit, and it
 * is the right one — a gate that read the arm's corrections would have to run the learn half to
 * obtain them, which is the cost it exists to avoid.
 *
 * ## Why the ban is not part of it
 *
 * The tool-name ban is a *treatment*: it refuses claims that name the scenario's actions. The
 * pre-flight asks whether the model can write a claim at all, so it runs the arm's interpreter with
 * the arm's form and population and without the arm's ban — an interpreter built before the
 * corrections exist, because the ban's inventory is built from them.
 */
import type { FeedbackEvent, InterpretContext, Interpreter, RunRecord } from '@agentix-e/microglia-core/distill';
import { MicrogliaError } from '@agentix-e/microglia-core';

/** The scenario the fixture is written in. The prompt's register depends on it. */
export const PREFLIGHT_TASK = 'retail';

/**
 * A retail correction that unambiguously states a rule.
 *
 * The wrong attempt cancels a *pending order* for a delivered purchase; the correction returns the
 * items of the *delivered* order instead. Any interpreter asked to say what generalises has
 * something to say: the order's state decides which tool applies. A distiller that returns nothing
 * here has returned nothing about a correction, and the arm it would have run is not measurable.
 *
 * Written as a literal rather than as a fixture file because it is a *prompt input*, not data: the
 * property worth testing is that it reaches the model through the arm's own form, and a JSON file
 * would put a second parser between the test and that property.
 */
export function preflightContext(now = 1_700_000_000_000): InterpretContext {
  const runId = 'run_preflight_1';
  const action = (name: string, args: Record<string, string>): string =>
    `${name}(${Object.entries(args)
      .map(([key, value]) => `${key}=${value}`)
      .join(', ')})`;
  const attempt = [action('get_order_details', { order_id: 'W1' })].concat([
    action('cancel_pending_order', { order_id: 'W1', reason: 'no longer needed' }),
  ]);
  const expected = [
    action('get_order_details', { order_id: 'W1' }),
    action('return_delivered_order_items', { order_id: 'W1', item_ids: '["i1"]' }),
  ];
  const run: RunRecord = {
    schema: 'microglia.run/1',
    id: runId,
    at: now,
    namespace: 'microglia-l4',
    sessionId: 'session_preflight',
    task: PREFLIGHT_TASK,
    taskId: 'preflight',
    attempt: 1,
    input: {
      question: 'I want to return the headphones from order W1 and be refunded.',
      taskId: 'preflight',
      domain: PREFLIGHT_TASK,
      schemaDigest: PREFLIGHT_TASK,
      // The attempt and the reference trajectory, in the shape the lane writes them: the difference
      // between the two is the lesson, and it is a difference only a trace or an edit can show.
      attempt,
      expected,
      rubric: ['The agent returns the delivered items instead of cancelling a pending order.'],
    },
    output: { actions: ['get_order_details', 'cancel_pending_order'] },
    provenance: { model: 'preflight', promptVersion: 'tau2/1', knowledgeIds: [] },
    feedbackIds: ['fb_preflight_1'],
  };
  const event: FeedbackEvent = {
    schema: 'microglia.feedback/1',
    id: 'fb_preflight_1',
    at: now,
    namespace: 'microglia-l4',
    sessionId: 'session_preflight',
    runId,
    task: PREFLIGHT_TASK,
    taskId: 'preflight',
    attempt: 1,
    kind: 'edit',
    actor: { type: 'user' },
    trust: 0.9,
    signal: {
      type: 'edit',
      beforeHash: 'sha256:preflight-before',
      afterHash: 'sha256:preflight-after',
      ops: [
        {
          op: 'set',
          path: ['actions'],
          before: ['get_order_details', 'cancel_pending_order'],
          after: ['get_order_details', 'return_delivered_order_items'],
        },
      ],
      distance: 1 / 3,
      after: { actions: expected },
      note:
        'The order was delivered, so the items have to be returned. Cancelling a pending order is ' +
        'the wrong operation for a delivered one, whatever the customer asked for.',
    },
    provenance: { model: 'preflight', promptVersion: 'tau2/1', knowledgeIds: [] },
    redactions: 0,
  };
  return { event, run };
}

/** What one pre-flight correction produced. */
export type PreflightVerdict =
  | { readonly state: 'answered'; readonly candidates: number; readonly chars: number }
  | { readonly state: 'empty'; readonly chars: number; readonly preview: string }
  | { readonly state: 'error'; readonly code: string; readonly sample: string };

/** The verdict, with the sentence a refusal carries. */
export type PreflightReading = PreflightVerdict & { readonly reason: string };

/** The `MG_E_*` code a thrown value carries, when it carries one. */
function codeOf(error: unknown): string {
  return error instanceof MicrogliaError ? error.code : 'unknown';
}

/** A bounded quote of what was actually returned, so a refusal can be read without the run. */
export function previewOf(reply: string): string {
  return reply.trim().slice(0, 200);
}

/**
 * Turn one interpreter call into a verdict.
 *
 * Separated from the call so the three outcomes are testable without a provider: `answered` is the
 * only state that lets an arm proceed, and the two refusals differ in kind — an empty reply says the
 * instrument cannot write a claim, an error says it did not answer.
 */
export function classifyPreflight(
  outcome:
    | { readonly ok: true; readonly candidates: readonly unknown[]; readonly reply: string }
    | { readonly ok: false; readonly code: string; readonly sample: string },
): PreflightReading {
  if (!outcome.ok) {
    return {
      state: 'error',
      code: outcome.code,
      sample: outcome.sample,
      reason:
        `the distiller threw on the pre-flight correction (${outcome.code}): ${outcome.sample}`,
    };
  }
  if (outcome.candidates.length === 0) {
    return {
      state: 'empty',
      chars: outcome.reply.length,
      preview: previewOf(outcome.reply),
      reason:
        'the distiller was asked one correction that states a rule and returned no claim: ' +
        `the reply was ${String(outcome.reply.length)} character(s), "${previewOf(outcome.reply)}"`,
    };
  }
  return {
    state: 'answered',
    candidates: outcome.candidates.length,
    chars: outcome.reply.length,
    reason: `the distiller wrote ${String(outcome.candidates.length)} claim(s) from one correction`,
  };
}

/**
 * Ask the interpreter about the fixture, once.
 *
 * The reply is not available from the `Interpreter` port — it returns candidates — so an empty
 * verdict's preview is the empty string unless the caller wraps its model seam to keep the reply.
 * The driver does exactly that for the arm's own events; here the count is what the verdict needs,
 * and a preview of the reply is only used when a caller supplies one.
 */
export async function runDistillPreflight(
  interpreter: Interpreter,
  options: { readonly context?: InterpretContext; readonly replyOf?: (context: InterpretContext) => string } = {},
): Promise<PreflightReading> {
  const context = options.context ?? preflightContext();
  try {
    const candidates = await interpreter(context);
    return classifyPreflight({
      ok: true,
      candidates,
      reply: options.replyOf?.(context) ?? '',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return classifyPreflight({
      ok: false,
      code: codeOf(error),
      sample: message.slice(0, 200),
    });
  }
}
