/**
 * Micro-ablations: what each module contributes, measured in isolation.
 *
 * The arm study varies one policy knob at a time over the whole corpus, which is
 * the wrong instrument for three of the modules. Credit assignment only binds
 * when a rule is cited repeatedly and keeps failing; diversification only binds
 * when the store holds paraphrases of one claim; contradiction resolution only
 * binds when two trusted claims disagree. None of those conditions occurs in a
 * clean corpus, so an arm that switched them off would report zero and look like
 * evidence that they do not matter.
 *
 * Each function below builds the smallest workload in which the module does bind,
 * and reports the state with and without it. The numbers are stored in the study
 * artefact beside the arms, so every claim about a module traces back to the
 * experiment that produced it.
 */
import { openMicroglia, type Microglia } from '@agentix-e/microglia-capture';
import {
  mmrSelect,
  steppingClock,
  mulberry32,
  type Json,
} from '@agentix-e/microglia-core';
import { chartEditDistance, chartInterpreter } from '@agentix-e/microglia-nl2charts';
import { EmbeddedMemory, MemoryJournal } from '@agentix-e/microglia-memory';

const AT = 1_700_000_000_000;
const TASK = 'chart.recommend';
const NAMESPACE = 'acme';
const INPUT = { domain: 'sales', intent: 'trend', field: 'revenue', categoryCount: 4 };
const SCOPE = { domain: 'sales', intent: 'trend' };

async function tinyHost(
  overrides: { credit?: boolean } = {},
): Promise<{ mg: Microglia; store: EmbeddedMemory }> {
  const store = await EmbeddedMemory.open(new MemoryJournal());
  const mg = await openMicroglia({
    app: 'microglia-ablation',
    namespace: NAMESPACE,
    store,
    interpreter: chartInterpreter,
    editSemantics: chartEditDistance,
    // A stepping clock: each event needs a distinct timestamp, or a second
    // distillation run would see `since` equal to the previous event and skip it.
    clock: steppingClock(AT, 1),
    random: mulberry32(11),
    ...overrides,
  });
  return { mg, store };
}

async function learn(
  mg: Microglia,
  mark: 'line' | 'scatter',
  options: { resolveContradictions?: boolean } = {},
): Promise<void> {
  const run = mg.begin({ task: TASK, input: INPUT });
  await run.complete({ mark: 'bar', x: 'order_date', y: 'revenue', aggregate: 'sum' });
  await run.edit({ mark, x: 'order_date', y: 'revenue', aggregate: 'sum' } as Json);
  await mg.distill(options);
}

export type CreditAblation = {
  /** Failures reported against the rule after it was learned. */
  readonly failures: number;
  /** Whether the rule is still injected at the end, when credit is applied. */
  readonly injectedWith: boolean;
  /** Whether the rule is still injected at the end, when credit is ignored. */
  readonly injectedWithout: boolean;
  readonly statusWith: string;
  readonly statusWithout: string;
};

/**
 * Does credit assignment stop a rule that keeps failing?
 *
 * One rule is learned, then cited in `failures` runs that all report failure. A
 * store that counts applications and successes withdraws the rule from the next
 * prompt; a store that only accumulates claims keeps injecting it. The metric is
 * injection, not the status name: what harms the user is being shown a rule that
 * has been wrong every time it was used.
 */
export async function creditAblation(failures = 4): Promise<CreditAblation> {
  const measure = async (credit: boolean): Promise<{ injected: boolean; status: string }> => {
    const { mg, store } = await tinyHost({ credit });
    await learn(mg, 'line');

    for (let index = 0; index < failures; index += 1) {
      const pack = await mg.recall({ task: TASK, text: 'trend of revenue', scope: SCOPE });
      const run = mg.begin({ task: TASK, input: INPUT, pack });
      await run.complete({ mark: 'line', x: 'order_date', y: 'revenue', aggregate: 'sum' });
      await run.outcome(false);
    }

    const pack = await mg.recall({ task: TASK, text: 'trend of revenue', scope: SCOPE });
    const items = await store.listKnowledge({ namespace: NAMESPACE, status: 'all' });
    await mg.close();
    return { injected: pack.ids.length > 0, status: items[0]?.status ?? 'missing' };
  };

  const withCredit = await measure(true);
  const withoutCredit = await measure(false);
  return {
    failures,
    injectedWith: withCredit.injected,
    injectedWithout: withoutCredit.injected,
    statusWith: withCredit.status,
    statusWithout: withoutCredit.status,
  };
}

export type DiversityAblation = {
  /** Distinct claims in the pack when redundancy is penalised. */
  readonly distinctWith: number;
  /** Distinct claims in the pack when ranking is by relevance alone. */
  readonly distinctWithout: number;
  /** Claims the pack carried. */
  readonly size: number;
};

const DISTINCT_CLAIMS = [
  'prefer monthly grain',
  'exclude cancelled orders',
  'label the y axis with units',
] as const;

const CLAIM_TEXT = (index: number): string =>
  index < 12
    ? `For a trend question over revenue, use a line chart rather than a bar chart (variant ${index}).`
    : `For a trend question over revenue, ${DISTINCT_CLAIMS[index - 12] as string}.`;

/**
 * Does diversification buy coverage, or only reorder the same claim?
 *
 * Twelve paraphrases of one lesson outrank three distinct lessons, so a pack of
 * four filled by relevance alone carries one lesson four times. With redundancy
 * penalised it should carry the distinct lessons instead — which is the whole
 * reason to pay for MMR before spending the character budget.
 */
export async function diversityAblation(size = 4): Promise<DiversityAblation> {
  // Equal relevance isolates the module: with relevance held constant the only
  // thing that can reorder the pack is the redundancy term, so the difference
  // between the two runs is the diversification itself.
  const candidates = Array.from({ length: 15 }, (_, index) => ({
    item: index < 12 ? 'paraphrase' : DISTINCT_CLAIMS[index - 12] as string,
    relevance: 1,
    text: CLAIM_TEXT(index),
  }));

  const selected = (lambda: number): readonly string[] =>
    mmrSelect(candidates, size, lambda).map((topic) => topic);

  return {
    distinctWith: new Set(selected(0.75)).size,
    distinctWithout: new Set(selected(1)).size,
    size: selected(0.75).length,
  };
}

export type ContradictionAblation = {
  /** Active rules when a second claim demotes the first. */
  readonly activeWith: number;
  /** Active rules when both claims survive. */
  readonly activeWithout: number;
  /** Prompt characters the pack spends on the conflict. */
  readonly charsWith: number;
  readonly charsWithout: number;
};

/**
 * Contradiction resolution, read as prompt economy.
 *
 * Two trusted claims about the same scope cannot both be right. Resolving the
 * conflict leaves one active rule; tolerating it leaves both, and both are then
 * injected into every prompt that matches the scope. The effect is counted in
 * active rules and prompt characters rather than accuracy: with two conflicting
 * rules the reader's answer depends on the tie-break, not on how many it saw.
 */
export async function contradictionAblation(): Promise<ContradictionAblation> {
  const measure = async (resolveContradictions: boolean) => {
    const { mg, store } = await tinyHost();
    await learn(mg, 'line');
    await learn(mg, 'scatter', { resolveContradictions });
    const items = await store.listKnowledge({ namespace: NAMESPACE, status: 'all' });
    const pack = await mg.recall({ task: TASK, text: 'trend of revenue', scope: SCOPE });
    await mg.close();
    return {
      active: items.filter((item) => item.status === 'active').length,
      chars: pack.rendered.length,
    };
  };

  const withResolution = await measure(true);
  const without = await measure(false);
  return {
    activeWith: withResolution.active,
    activeWithout: without.active,
    charsWith: withResolution.chars,
    charsWithout: without.chars,
  };
}
