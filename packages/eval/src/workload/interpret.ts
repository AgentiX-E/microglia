/**
 * The chart interpreter: one structured edit, one scoped lesson.
 *
 * This is the domain pack's whole contribution to the flywheel. It is written
 * against the *shape* of the interpreter contract rather than importing it, so
 * the pack stays a leaf that depends only on core; a host can use it with any
 * version of the pipeline that passes `{ event, run }`.
 */
import { dedupeKeyOf } from '@agentix-e/microglia-core';
import type {
  DistillCandidate,
  FeedbackEvent,
  Json,
  RunRecord,
} from '@agentix-e/microglia-core';
import {
  assertChartSpec,
  classifyChartEdit,
  describeChartEdit,
  isChartSpec,
  type ChartIntent,
  type QueryFeatures,
} from './chart.js';

export type ChartInterpretContext = {
  readonly event: FeedbackEvent;
  readonly run: RunRecord | undefined;
};

export function chartInterpreter(
  context: ChartInterpretContext,
): readonly DistillCandidate[] {
  const { event, run } = context;
  if (event.signal.type !== 'edit') return [];
  if (!run || run.output === undefined) return [];
  if (!isChartSpec(run.output) || !isChartSpec(event.signal.after)) return [];

  const features = featuresOf(run);
  if (!features) return [];

  const edit = classifyChartEdit(assertChartSpec(run.output), assertChartSpec(event.signal.after));
  if (!edit) return [];

  const lesson = describeChartEdit(edit, features);
  if (!lesson) return [];

  return [
    {
      namespace: event.namespace,
      kind: 'constraint',
      scope: lesson.scope,
      statement: lesson.statement,
      payload: lesson.payload as unknown as Json,
      evidence: {
        feedbackId: event.id,
        runId: event.runId,
        at: event.at,
        weight: event.trust,
      },
      trust: event.trust,
      // The same function the distiller uses, so a host can look a candidate up
      // by the key the store will actually apply.
      dedupeKey: dedupeKeyOf({
        namespace: event.namespace,
        kind: 'constraint',
        scope: lesson.scope,
        statement: lesson.statement,
      }),
    },
  ];
}

/**
 * Read the query features from the run.
 *
 * These are recorded by the host at generation time, not inferred from prose.
 * A pack that guessed them from the question text would be re-deriving the
 * host's own parse in a second place, and the two would disagree.
 */
export function featuresOf(run: RunRecord): QueryFeatures | undefined {
  const input = run.input;
  const domain = asString(input['domain']);
  const intent = asString(input['intent']);
  const field = asString(input['field']);
  if (!domain || !intent || !field) return undefined;
  if (!isIntent(intent)) return undefined;
  const categoryCount = asNumber(input['categoryCount']);
  const grain = asString(input['grain']);
  return {
    domain,
    intent,
    field,
    ...(categoryCount === undefined ? {} : { categoryCount }),
    ...(grain === 'day' || grain === 'month' || grain === 'quarter' ? { grain } : {}),
  };
}

function asString(value: Json | undefined): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asNumber(value: Json | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isIntent(value: string): value is ChartIntent {
  return (
    value === 'trend' ||
    value === 'comparison' ||
    value === 'composition' ||
    value === 'distribution' ||
    value === 'correlation' ||
    value === 'matrix' ||
    value === 'ranking'
  );
}
