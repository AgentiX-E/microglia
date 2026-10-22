/**
 * POC-28 — do the integrity invariants hold on a replayed log?
 *
 * MemForm's five formation routes are the reason this lane exists. Two of them
 * are only observable across a replay: **selection** (curation must be a
 * function of the log, not of the order it was written) and **path** (the same
 * experiences merged in a different order must leave the same store).
 *
 * The run builds 1,000 events, then:
 *
 *   1. replays the log in five shuffled insertion orders and compares the
 *      resulting stores against the reference — order invariance must be 1.00;
 *   2. replays the reference twice and compares — replay determinism must be
 *      1.00, which is what proves no wall clock or ambient randomness leaked in;
 *   3. replays through a view that returns events newest-first, bypassing the
 *      sort — this **must** differ. A harness whose control also passes is
 *      measuring nothing, so the run fails if the control agrees;
 *   4. renames the schema digest mid-stream and asks for knowledge under the new
 *      digest, counting how many stale-schema items reached the pack. It must be
 *      zero, and a positive control under the old digest must find some, or the
 *      probe is looking at an empty store.
 *
 *   5. erases ten items by id and ten task instances by task, then checks that
 *      nothing erased can be retrieved or cited — POC-28b, the deletion
 *      obligation D20 exists for.
 */
import { mulberry32, type DistillCandidate, type FeedbackEvent, type RunRecord } from '@agentix-e/microglia-core';
import { replayStore, runIntegrity, type IntegrityCase } from '@agentix-e/microglia-eval';
import { DEEPSEEK_MODEL } from './lib.js';
import { writeResult } from './lib.js';

const AT = 1_760_000_000_000;
const EVENTS = 1_000;
const TASKS = 60;
const DOMAINS = ['sales', 'hr', 'finance', 'ops', 'support'] as const;
const INTENTS = ['trend', 'comparison', 'composition', 'distribution'] as const;
const MARKS = ['line', 'bar', 'area'] as const;
const TASK = 'chart.recommend';
/** The column rename: everything after this index is written under a new digest. */
const RENAME_AT = 600;

type Claim = { readonly intent: string; readonly mark: string; readonly domain: string };

/** What a workspace would have answered, before the user corrected it. */
function claimFor(index: number, random: () => number): Claim {
  const domain = DOMAINS[index % DOMAINS.length] as string;
  const intent = INTENTS[Math.floor(random() * INTENTS.length)] as string;
  // A stable preference per domain, with one correction in ten pointing at a
  // different mark: the noise is what makes merging and contradiction real.
  const preferred = MARKS[DOMAINS.indexOf(domain as (typeof DOMAINS)[number]) % MARKS.length] as string;
  const mark = random() < 0.1 ? (MARKS[Math.floor(random() * MARKS.length)] as string) : preferred;
  return { intent, mark, domain };
}

function digestFor(index: number): string {
  return index < RENAME_AT ? 'schema-v1' : 'schema-v2';
}

function buildCorpus(): { events: FeedbackEvent[]; runs: RunRecord[] } {
  const random = mulberry32(20261022);
  const events: FeedbackEvent[] = [];
  const runs: RunRecord[] = [];
  for (let index = 0; index < EVENTS; index += 1) {
    const claim = claimFor(index, random);
    const at = AT + index * 1_000;
    const runId = `run_${index}`;
    const taskId = `t_${index % TASKS}`;
    runs.push({
      schema: 'microglia.run/1',
      id: runId,
      at,
      namespace: 'acme',
      sessionId: 's1',
      task: TASK,
      taskId,
      attempt: 1,
      input: { domain: claim.domain, intent: claim.intent },
      output: { mark: 'bar' },
      provenance: { schemaDigest: digestFor(index), knowledgeIds: [] },
      feedbackIds: [],
    });
    events.push({
      schema: 'microglia.feedback/1',
      id: `fb_${index}`,
      at,
      namespace: 'acme',
      sessionId: 's1',
      runId,
      task: TASK,
      taskId,
      attempt: 1,
      kind: 'edit',
      actor: { type: 'user' },
      trust: 0.9,
      signal: {
        type: 'edit',
        beforeHash: 'a',
        afterHash: 'b',
        ops: [],
        distance: 0.5,
        after: { mark: claim.mark },
      },
      provenance: { knowledgeIds: [] },
      redactions: 0,
    });
  }
  return { events, runs };
}

/**
 * A chart interpreter over the run's own input.
 *
 * The domain is deliberately *not* in the statement or the payload: the claim is
 * "for a trend question, use a line chart", and the domain lives only in scope.
 * That is what gives generalisation something to widen, and it is what MemForm's
 * scope route attacks.
 */
function interpreter(context: { event: FeedbackEvent; run: RunRecord | undefined }): readonly DistillCandidate[] {
  const input = (context.run?.input ?? {}) as { domain?: string; intent?: string };
  const output = (context.run?.output ?? {}) as { mark?: string };
  const corrected = (context.event.signal.type === 'edit'
    ? context.event.signal.after
    : {}) as { mark?: string };
  const mark = corrected.mark ?? output.mark ?? 'line';
  const intent = input.intent ?? 'trend';
  const domain = input.domain ?? 'sales';
  return [
    {
      namespace: context.event.namespace,
      kind: 'constraint',
      scope: {
        task: context.event.task,
        domain,
        intent,
        schemaDigest: context.run?.provenance.schemaDigest,
      },
      statement: `For ${intent} questions, use a ${mark} chart.`,
      payload: { when: { intent }, then: { mark } },
      evidence: {
        feedbackId: context.event.id,
        runId: context.event.runId,
        at: context.event.at,
        ...(context.event.taskId === undefined ? {} : { taskId: context.event.taskId }),
        weight: 0.9,
      },
      trust: 0.9,
      dedupeKey: `${intent}|${mark}`,
    },
  ];
}

const corpus = buildCorpus();
const test: IntegrityCase = {
  events: corpus.events,
  runs: corpus.runs,
  interpreter,
  namespace: 'acme',
  seed: 7,
  now: AT + EVENTS * 1_000,
};

const report = await runIntegrity(test);

/** How many items of each status the reference replay produced. */
const reference = await replayStore(test, corpus.events);
const statuses = new Map<string, number>();
for (const item of reference.items) {
  statuses.set(item.status, (statuses.get(item.status) ?? 0) + 1);
}

const newDigest = await reference.mg.recall({
  task: TASK,
  text: 'for trend questions use a line chart',
  scope: { schemaDigest: 'schema-v2' },
});
const oldDigest = await reference.mg.recall({
  task: TASK,
  text: 'for trend questions use a line chart',
  scope: { schemaDigest: 'schema-v1' },
});

const digestOf = new Map(reference.items.map((item) => [item.id, item.scope.schemaDigest]));
const staleInjected = newDigest.ids.filter((id) => digestOf.get(id) !== 'schema-v2').length;

/**
 * POC-28b — erasure.
 *
 * A deletion obligation arrives in two shapes: a host that knows the ids (a user
 * asked for their record to go) and a host that knows the task (a task was
 * withdrawn). Both must leave nothing that recall can still cite.
 */
const doomed = reference.items.slice(0, 10).map((item) => item.id);
const erasedById = await reference.mg.forget({ ids: doomed });

const tasksToErase = [
  ...new Set(corpus.events.map((entry) => entry.taskId).filter((id): id is string => id !== undefined)),
].slice(0, 10);
const cascade = { events: 0, runs: 0, knowledge: 0, rescored: 0 };
for (const taskId of tasksToErase) {
  const erased = await reference.mg.forget({ taskId });
  cascade.events += erased.events;
  cascade.runs += erased.runs;
  cascade.knowledge += erased.knowledge;
  cascade.rescored += erased.rescored;
}

const survivors = await reference.mg.recall({
  task: TASK,
  text: 'for trend questions use a line chart',
});
const retrieved = await Promise.all(doomed.map((id) => reference.mg.store.getKnowledge(id)));
const resurrected = retrieved.filter((item) => item !== undefined).length;
const citedErased = survivors.ids.filter((id) => doomed.includes(id)).length;
const eventsLeft = (await reference.mg.store.listEvents({ namespace: 'acme' })).length;

const gates = [
  { id: 'order-invariance', pass: report.orderInvariance === 1, actual: report.orderInvariance, criterion: '= 1.00' },
  { id: 'replay-determinism', pass: report.replayDeterminism === 1, actual: report.replayDeterminism, criterion: '= 1.00' },
  { id: 'instrument-sensitive', pass: report.instrumentSensitive, actual: report.controlInvariance, criterion: 'control < 1.00' },
  { id: 'stale-schema-injection', pass: staleInjected === 0, actual: staleInjected, criterion: '= 0' },
  { id: 'probe-not-empty', pass: oldDigest.ids.length > 0, actual: oldDigest.ids.length, criterion: '> 0' },
  { id: 'erased-by-id', pass: erasedById.knowledge === 10, actual: erasedById.knowledge, criterion: '= 10' },
  { id: 'erasure-unreachable', pass: resurrected === 0, actual: resurrected, criterion: '= 0' },
  { id: 'erasure-not-cited', pass: citedErased === 0, actual: citedErased, criterion: '= 0' },
  { id: 'erasure-cascade', pass: cascade.events > 0, actual: cascade.events, criterion: '> 0' },
  {
    id: 'erasure-bounded',
    pass: eventsLeft === EVENTS - cascade.events,
    actual: eventsLeft,
    criterion: `= ${EVENTS - cascade.events}`,
  },
];

await writeResult({
  id: 'poc-integrity',
  title: 'POC-28 — replay invariants (order, determinism, schema drift) and erasure',
  ranAt: new Date().toISOString(),
  model: 'none',
  n: EVENTS,
  calls: 0,
  metrics: {
    events: report.events,
    items: report.items,
    order_invariance: report.orderInvariance,
    replay_determinism: report.replayDeterminism,
    control_invariance: report.controlInvariance,
    instrument_sensitive: report.instrumentSensitive ? 1 : 0,
    stale_schema_injected: staleInjected,
    old_digest_retrievable: oldDigest.ids.length,
    erased_items: erasedById.knowledge,
    erased_events: cascade.events,
    erased_knowledge_cascade: cascade.knowledge,
    erased_rescored: cascade.rescored,
    events_remaining: eventsLeft,
    resurrected_after_erasure: resurrected,
    active_items: statuses.get('active') ?? 0,
    candidate_items: statuses.get('candidate') ?? 0,
    retired_items: statuses.get('retired') ?? 0,
    gates_passed: gates.filter((gate) => gate.pass).length,
  },
  notes: [
    `Interpreter: deterministic chart interpreter over run input; ${EVENTS} events, ${TASKS} task instances, digest renamed at event ${RENAME_AT}.`,
    'Order invariance replays the same events in five shuffled journal orders; the store sorts on read, so a pass means the sort is load-bearing rather than incidental.',
    'The control replays through a view that returns events newest-first. It must disagree, or the harness cannot detect order dependence and the reported 1.00 is vacuous.',
    'Erasure (D20) is measured here rather than asserted: ten items by id, then ten task instances by task. Nothing erased may be retrievable, and the pack may not cite it.',
    `No model calls: distillation is the deterministic rule path, so the lane costs nothing to re-run (${DEEPSEEK_MODEL} is not used).`,
  ],
  samples: gates,
});

for (const gate of gates) {
  process.stdout.write(`  ${gate.pass ? 'PASS' : 'FAIL'} ${gate.id} ${gate.actual} (${gate.criterion})\n`);
}
if (gates.some((gate) => !gate.pass)) process.exit(1);
