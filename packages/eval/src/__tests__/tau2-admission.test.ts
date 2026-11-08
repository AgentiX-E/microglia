/**
 * R45 — admission is a statement about the evidence, not about the edit.
 *
 * R44 read `insufficient-evidence=19` on a store of 19 and could not say which
 * half of that reason fired. The three-condition guard written in R43 used one
 * action with empty arguments; the real τ² retail corpus carries 5–12 actions
 * with 1–5 arguments each. These tests use the *real* corpus: the exact tasks
 * the R44 dispatch learned from, extracted verbatim from the file the label
 * census fingerprinted, with both sha256 values recorded so the population can
 * be reconstructed. No model call, no mock, no synthetic action list.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import {
  MicrogliaError,
  mulberry32,
  steppingClock,
  type Json,
} from '@agentix-e/microglia-core';
import { EmbeddedMemory, MemoryJournal } from '@agentix-e/microglia-core/memory';
import { openMicroglia, trustFor } from '@agentix-e/microglia-core/capture';
import { createLlmInterpreter, ruleInterpreter } from '@agentix-e/microglia-core/distill';
import {
  createKnowledgeItem,
  decideStatus,
  defaultPolicy,
  diffJson,
  editDistance,
  resolvePolicy,
  scoreKnowledge,
  type DistillCandidate,
  type KnowledgeItem,
} from '@agentix-e/microglia-core/kernel';
import { correctionEdit } from '../tau2.js';
import { resilientInterpreter, stampDomain } from '../tau2-distill.js';
import { stoppedRun } from '../stopped-run.js';
import { isGoldVerifiedCorrection, tau2EditSemantics } from '../tau2-admission.js';
import { storeCensus } from '../tau2-instrument.js';

type FixtureTask = {
  readonly id: string;
  readonly actions: readonly { readonly name: string; readonly arguments: Record<string, Json> }[];
};
type Fixture = {
  readonly source: { readonly sha256: string; readonly bytes: number; readonly split: string };
  readonly tasks: readonly FixtureTask[];
};

const FIXTURE_PATH = join(process.cwd(), 'eval/fixtures/tau2-retail-learn-actions.json');
const fixtureBytes = readFileSync(FIXTURE_PATH);
const fixture = JSON.parse(fixtureBytes.toString('utf8')) as Fixture;

const itemFor = (trust: number, id: string): KnowledgeItem =>
  createKnowledgeItem(
    {
      namespace: 'tau2',
      kind: 'procedure',
      scope: { task: 'tau2.act', domain: 'retail' },
      statement: 'A request of this shape is resolved by the reference calls.',
      evidence: { feedbackId: `fb_${id}`, runId: `run_${id}`, at: 1, weight: trust, taskId: id },
      trust,
      dedupeKey: `k_${id}`,
      tier: 'structured-edit',
    } as unknown as DistillCandidate,
    defaultPolicy,
    1,
    `k_${id}`,
  );

const structural = (task: FixtureTask): { distance: number; trust: number; item: KnowledgeItem } => {
  const before = { actions: task.actions.map((a) => a.name) } as Json;
  const after = {
    actions: task.actions.map((a) => ({ name: a.name, arguments: { ...a.arguments } })),
  } as unknown as Json;
  const ops = diffJson(before, after);
  const distance = editDistance(before, after, ops);
  const trust = trustFor({ type: 'edit', distance } as never);
  return { distance, trust, item: itemFor(trust, task.id) };
};

const activeCount = (policy = defaultPolicy): number =>
  fixture.tasks.filter((task) => {
    const { trust } = structural(task);
    const item = { ...itemFor(trust, task.id), support: trust } as KnowledgeItem;
    return decideStatus({ ...item, confidence: scoreKnowledge(item, policy, 1) }, policy, 1).status === 'active';
  }).length;

describe('the corpus the R44 dispatch actually learned from', () => {
  it('is the censused file and the dispatched split, with both hashes recorded', () => {
    expect(fixture.source.sha256).toBe('76e1fa649a359bef2d2fd30eae834b99d261d84e2e5d364856f6632fdf778dfd');
    expect(fixture.source.bytes).toBe(328166);
    expect(createHash('sha256').update(fixtureBytes).digest('hex')).toBe(
      'b5e49bb793731ec107754452e70e608c54b309c54f3be2ad049c82ffb40c87a0',
    );
    expect(fixtureBytes.length).toBe(28749);
    expect(fixture.tasks).toHaveLength(32);
  });

  it('holds 31 of 32 items as candidates under the structural distance', () => {
    const rows = fixture.tasks.map(structural);
    const held = rows.filter((row) => row.item.status === 'candidate');
    expect(held).toHaveLength(31);
    expect(rows.filter((row) => row.item.statusReason === 'insufficient-evidence')).toHaveLength(31);
    expect(rows.filter((row) => row.item.confidence >= 0.6)).toHaveLength(1);
    expect(Math.min(...rows.map((row) => row.trust))).toBeCloseTo(0.5, 4);
    expect(Math.max(...rows.map((row) => row.trust))).toBeCloseTo(0.9, 4);
  });

  it('shows confidence is the failing half, sixteen times over', () => {
    const rows = fixture.tasks.map(structural);
    expect(rows.filter((row) => row.item.support >= 0.8 && row.item.confidence < 0.6)).toHaveLength(16);
    expect(rows.filter((row) => row.item.support < 0.8)).toHaveLength(15);
    // weight === trust, so scoreKnowledge's penalty is quadratic: support clears
    // at 0.8 but confidence there is still below the 0.6 activation threshold.
    expect(itemFor(0.8, 't').confidence).toBeCloseTo(0.4806, 4);
    expect(itemFor(0.89, 't').confidence).toBeCloseTo(0.6013, 4);
    expect(itemFor(0.9, 't').confidence).toBeCloseTo(0.6165, 4);
  });

  it('rejects every threshold lever and selects the evidence input', () => {
    expect(activeCount()).toBe(1);
    expect(activeCount(resolvePolicy({ activationThreshold: 0.45 }))).toBe(17);
    expect(activeCount(resolvePolicy({ minSupport: 0.5 }))).toBe(1);
    expect(activeCount(resolvePolicy({ singleObservationTrust: 0.99 }))).toBe(1);
    // gold-verified semantic distance: trust 0.9 on every task, no threshold touched.
    expect(fixture.tasks.map(() => itemFor(0.9, 't').status)).not.toContain('candidate');
  });
});

/** One real episode through the capture, distillation and admission chain. */
const episode = async (
  task: FixtureTask,
  options: { readonly editSemantics?: (before: Json, after: Json) => number | undefined } = {},
): Promise<KnowledgeItem> => {
  const store = await EmbeddedMemory.open(new MemoryJournal());
  const llm = createLlmInterpreter({
    llm: {
      complete: () =>
        Promise.resolve(
          JSON.stringify([
            {
              kind: 'procedure',
              statement: `The reference calls for task ${task.id} resolve the request.`,
              scope: {},
            },
          ]),
        ),
    },
  });
  const host = await openMicroglia({
    app: 'microglia-l4',
    namespace: 'tau2',
    store,
    interpreter: stampDomain(
      resilientInterpreter(llm, ruleInterpreter, { fatal: stoppedRun }).interpreter,
      'retail',
    ),
    budget: 1200,
    clock: steppingClock(1_700_000_000_000, 1),
    random: mulberry32(7),
    ...(options.editSemantics === undefined ? {} : { editSemantics: options.editSemantics }),
  });
  const statement = `A request of this shape is resolved by the reference calls for ${task.id}.`;
  const handle = host.begin({
    task: 'tau2.act',
    input: { question: task.id, domain: 'retail', schemaDigest: 'retail' },
    model: 'deepseek-chat',
    promptVersion: 'tau2/1',
  });
  await handle.complete({ actions: task.actions.map((action) => action.name) });
  await handle.edit(
    correctionEdit({
      taskId: task.id,
      statement,
      actions: task.actions.map((action) => ({ name: action.name, arguments: action.arguments })),
    }),
    { note: statement },
  );
  await host.distill({ generalize: false, fatal: stoppedRun });
  const [item] = await store.listKnowledge({});
  if (item === undefined) throw new MicrogliaError('MG_E_STORE_IO', 'the episode wrote no item');
  return item;
};

describe('tau2EditSemantics', () => {
  it('names a gold-verified correction as a full replacement', () => {
    const task = fixture.tasks[0] as FixtureTask;
    const before = { actions: task.actions.map((a) => a.name) } as Json;
    const after = {
      actions: task.actions.map((a) => ({ name: a.name, arguments: { ...a.arguments } })),
    } as unknown as Json;
    expect(isGoldVerifiedCorrection(after)).toBe(true);
    expect(tau2EditSemantics(before, after)).toBe(1);
  });

  it('also recognises a rubric-only correction, which names no calls', () => {
    expect(tau2EditSemantics({ actions: [] } as Json, { actions: [], expectation: 'the order is cancelled' } as Json)).toBe(1);
  });

  it('falls back to the structural distance for every other edit shape', () => {
    for (const after of [
      { actions: ['cancel_pending_order'] },
      { actions: [{ name: 'cancel_pending_order' }] },
      { actions: [{ name: 'cancel_pending_order', arguments: 'not-an-object' }] },
      { note: 'a bare note' },
      { actions: [], expectation: 42 },
      'a string instead of an object',
    ] as unknown as Json[]) {
      expect(isGoldVerifiedCorrection(after)).toBe(false);
      expect(tau2EditSemantics({ actions: [] } as Json, after)).toBeUndefined();
    }
  });

  it('does not promote an edit whose before side is not the driver completion', () => {
    const after = { actions: [{ name: 'x', arguments: {} }] } as unknown as Json;
    expect(tau2EditSemantics({ output: 'a free-form answer' } as Json, after)).toBeUndefined();
  });
});

describe('the repair in the real pipeline', () => {
  it('admits the corpus task the structural distance held most strongly', async () => {
    // Only call-shaped corrections suffer: `correctionEdit` gives a no-call task
    // an `expectation`, which is a full replacement even under the structural
    // distance (R43's third guard condition). The defect is in tasks with
    // arguments, and the worst of those is the population this test must fix.
    const rows = fixture.tasks
      .filter((task) => task.actions.length > 0)
      .map((task) => ({ task, ...structural(task) }));
    const worst = rows.reduce((a, b) => (a.distance <= b.distance ? a : b));
    const control = await episode(worst.task);
    expect(control.status).toBe('candidate');
    expect(control.statusReason).toBe('insufficient-evidence');

    const treated = await episode(worst.task, { editSemantics: tau2EditSemantics });
    expect(treated.status).toBe('active');
    expect(treated.statusReason).toBe('confidence-cleared');
    expect(treated.trust).toBeCloseTo(0.9, 6);
    expect(treated.support).toBeCloseTo(0.9, 6);
    expect(treated.confidence).toBeCloseTo(0.6165, 4);
  });

  it('does not break a rubric-only correction, which was active before the repair', async () => {
    // A no-call correction was never held by the structural distance: adding an
    // `expectation` to an empty call list is a full replacement at distance 1.
    // The hook must leave that result alone rather than changing a working case.
    const empty = fixture.tasks.find((task) => task.actions.length === 0) ?? {
      id: 'rubric-only',
      actions: [],
    };
    const control = await episode(empty);
    expect(control.status).toBe('active');
    expect(control.trust).toBeCloseTo(0.9, 6);
    const treated = await episode(empty, { editSemantics: tau2EditSemantics });
    expect(treated.status).toBe('active');
    expect(treated.trust).toBeCloseTo(0.9, 6);
    expect(treated.confidence).toBeCloseTo(control.confidence, 6);
  });
});

describe('storeCensus admission telemetry', () => {
  it('reports the three means and the number held by confidence alone', () => {
    const census = storeCensus(
      [
        {
          status: 'active',
          scope: { domain: 'retail' },
          statusReason: 'confidence-cleared',
          trust: 0.9,
          support: 0.9,
          confidence: 0.6165,
        },
        {
          status: 'candidate',
          scope: { domain: 'retail' },
          statusReason: 'insufficient-evidence',
          trust: 0.803,
          support: 0.803,
          confidence: 0.4841,
        },
      ],
      'retail',
    );
    expect(census.admission.measured).toBe(2);
    expect(census.admission.trustMin).toBeCloseTo(0.803, 4);
    expect(census.admission.trustMax).toBeCloseTo(0.9, 4);
    expect(census.admission.trustMean).toBeCloseTo(0.8515, 4);
    expect(census.admission.confidenceMax).toBeCloseTo(0.6165, 4);
    expect(census.admission.supportOnly).toBe(1);
  });

  it('reports an empty population without inventing numbers', () => {
    const census = storeCensus([{ status: 'candidate', scope: { domain: 'retail' } }], 'retail');
    expect(census.admission).toEqual({
      measured: 0,
      trustMin: 0,
      trustMax: 0,
      trustMean: 0,
      supportMin: 0,
      supportMax: 0,
      supportMean: 0,
      confidenceMin: 0,
      confidenceMax: 0,
      confidenceMean: 0,
      supportOnly: 0,
    });
    expect(census.reasons).toEqual({});
  });
});

describe('the shapes a τ² correction may take', () => {
  it('refuses an action that names no tool', () => {
    // A call-shaped correction whose tool name is the empty string is not a call: it would
    // price as a call and teach nothing, and the admission rule is the only place that can
    // say so before the store holds it.
    expect(
      tau2EditSemantics(
        { actions: [{ name: '', arguments: {} }] },
        { actions: [{ name: 'cancel_pending_order', arguments: { order_id: '1' } }] },
      ),
    ).toBeUndefined();
  });

  it('refuses a completion whose entries are not tool names', () => {
    expect(
      tau2EditSemantics(
        { actions: [42] },
        { actions: [{ name: 'cancel_pending_order', arguments: {} }] },
      ),
    ).toBeUndefined();
  });
});
