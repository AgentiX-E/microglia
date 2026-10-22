/**
 * Integrity: does the store keep its own rules when the log is replayed?
 *
 * MemForm (2026) names five routes by which a memory can be corrupted without
 * planting a false record: **content**, **evidence**, **scope**, **selection**
 * and **path**. Its strongest defence cut attack success by 8.2 points, which is
 * the reason this project treats them as invariants rather than as screening
 * rules. Two of the five are visible only from outside a single write:
 *
 *   - **selection** — curation must be a function of the event log, not of the
 *     order in which the log was written.
 *   - **path** — the same experiences merged in a different order must leave the
 *     same store.
 *
 * Both are properties of a *replay*, so they need a harness: build a store from
 * the log in one order, build it again in another, and compare the states.
 *
 * The harness ships with a **mutation control**, and that is the part that makes
 * it worth anything. A replay harness that only ever prints 1.00 cannot be told
 * apart from one that compares nothing — so the same run also replays the log
 * through a view that returns events newest-first, bypassing the sort that
 * `EmbeddedMemory.listEvents` performs. If the control also scores 1.00, the
 * instrument is insensitive and the report says so instead of claiming a pass.
 */
import { defaultPolicy, fixedClock, hashJson, mulberry32 } from '@agentix-e/microglia-core';
import type {
  FeedbackEvent,
  Json,
  KnowledgeItem,
  Policy,
  RunRecord,
} from '@agentix-e/microglia-core';
import { Microglia } from '@agentix-e/microglia-core/capture';
import type { Interpreter } from '@agentix-e/microglia-core/distill';
import { EmbeddedMemory, MemoryJournal } from '@agentix-e/microglia-core/memory';
import type { MemoryPort } from '@agentix-e/microglia-core/memory';

export type IntegrityCase = {
  readonly events: readonly FeedbackEvent[];
  readonly runs: readonly RunRecord[];
  readonly interpreter: Interpreter;
  readonly namespace: string;
  readonly policy?: Policy;
  /** Any 32-bit integer; the same seed replays the same store. */
  readonly seed: number;
  /** The clock the replay runs at. Fixed, because ids are time-prefixed. */
  readonly now: number;
};

export type Replay = {
  readonly mg: Microglia;
  readonly items: readonly KnowledgeItem[];
  /** Hash of the canonical projection of `items`. */
  readonly state: string;
};

export type IntegrityReport = {
  readonly events: number;
  readonly runs: number;
  readonly items: number;
  readonly orders: number;
  readonly reference: string;
  /** Share of shuffled journal orders that reproduced the reference state. */
  readonly orderInvariance: number;
  /** Share of identical replays that reproduced the reference state. */
  readonly replayDeterminism: number;
  /** Share of *mutated* replays that reproduced the reference state; must be < 1. */
  readonly controlInvariance: number;
  /** True when the control disagrees, i.e. the instrument can detect order. */
  readonly instrumentSensitive: boolean;
};

const DEFAULT_SHUFFLES = 5;

/**
 * Replay the log into a fresh store and return the resulting knowledge.
 *
 * `events` is the *journal insertion order*, not the logical order: the store
 * sorts on read, so passing a shuffled list tests the sort rather than the file.
 */
export async function replayStore(
  test: IntegrityCase,
  events: readonly FeedbackEvent[],
  memory?: (inner: MemoryPort) => MemoryPort,
): Promise<Replay> {
  const store = await EmbeddedMemory.open(new MemoryJournal());
  const view = memory === undefined ? store : memory(store);
  for (const run of test.runs) await view.putRun(run);
  for (const event of events) await view.appendEvent(event);

  const mg = new Microglia({
    app: 'integrity',
    namespace: test.namespace,
    store: view,
    policy: test.policy ?? defaultPolicy,
    clock: fixedClock(test.now),
    random: mulberry32(test.seed),
    interpreter: test.interpreter,
  });
  await mg.distill();
  await mg.curate();
  const items = await view.listKnowledge({ namespace: test.namespace, status: 'all' });
  return { mg, items, state: stateOf(items) };
}

/**
 * The canonical projection compared by the harness.
 *
 * Only the fields a decision depends on, with the infinite sentinels mapped to
 * `null` so the value stays JSON, and evidence reduced to its identity and order.
 * Everything else — ids of merge victims, timestamps of a replay — is either
 * derived from this or deliberately not compared.
 */
export function stateOf(items: readonly KnowledgeItem[]): string {
  const rows = [...items]
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((item) => ({
      id: item.id,
      namespace: item.namespace,
      kind: item.kind,
      status: item.status,
      statusReason: item.statusReason ?? null,
      // Flattened rather than spread: a scope with an explicitly `undefined`
      // dimension would otherwise reach the canonical encoder as a non-JSON
      // value, and "absent" and "undefined" must hash the same anyway.
      scope: [
        item.scope.task,
        item.scope.domain ?? '',
        item.scope.schemaDigest ?? '',
        item.scope.intent ?? '',
        item.scope.field ?? '',
        item.scope.reasonCode ?? '',
      ].join('|'),
      support: round(item.support),
      trust: round(item.trust),
      contradictions: item.contradictions,
      confidence: round(item.confidence),
      applied: item.applied,
      succeeded: item.succeeded,
      tier: item.tier ?? null,
      validUntil: finite(item.validUntil),
      systemUntil: finite(item.systemUntil),
      evidence: [...item.evidence]
        .map((entry) => entry.feedbackId)
        .sort()
        .join(','),
      payload: (item.payload ?? null) as Json,
    }));
  return hashJson(rows as unknown as Json);
}

/**
 * The mutation, as a port: everything delegated, `listEvents` reversed.
 *
 * Reversing the *sorted* result is the strongest form of "the sort was
 * removed", so the control answers the question the invariant actually asks:
 * does reading the log in a different order change the store? Exported because
 * a host debugging an order dependence needs the same instrument, and because
 * an instrument the tests cannot exercise is an instrument nobody has checked.
 */
export function reverseOrderView(inner: MemoryPort): MemoryPort {
  return new EventOrderView(inner);
}

class EventOrderView implements MemoryPort {
  public constructor(private readonly inner: MemoryPort) {}

  public appendEvent(event: FeedbackEvent): Promise<void> {
    return this.inner.appendEvent(event);
  }

  public getEvent(id: string): Promise<FeedbackEvent | undefined> {
    return this.inner.getEvent(id);
  }

  public async listEvents(
    filter?: Parameters<MemoryPort['listEvents']>[0],
  ): Promise<readonly FeedbackEvent[]> {
    return [...(await this.inner.listEvents(filter))].reverse();
  }

  public putRun(run: RunRecord): Promise<void> {
    return this.inner.putRun(run);
  }

  public getRun(id: string): Promise<RunRecord | undefined> {
    return this.inner.getRun(id);
  }

  public putKnowledge(item: KnowledgeItem): Promise<void> {
    return this.inner.putKnowledge(item);
  }

  public getKnowledge(id: string): Promise<KnowledgeItem | undefined> {
    return this.inner.getKnowledge(id);
  }

  public listKnowledge(
    filter?: Parameters<MemoryPort['listKnowledge']>[0],
  ): Promise<readonly KnowledgeItem[]> {
    return this.inner.listKnowledge(filter);
  }

  public search(
    query: Parameters<MemoryPort['search']>[0],
    now?: number,
  ): ReturnType<MemoryPort['search']> {
    return this.inner.search(query, now);
  }

  public stats(): ReturnType<MemoryPort['stats']> {
    return this.inner.stats();
  }

  public close(): Promise<void> {
    return this.inner.close();
  }
}

/**
 * Measure the two replay invariants, and prove the measurement is not vacuous.
 *
 * `replayDeterminism` is not the same question as `orderInvariance`: the first
 * asks whether a replay is reproducible at all (no wall clock, no ambient
 * randomness, no id collision), the second whether it is *order*-free. A store
 * can be perfectly deterministic and still depend on which event arrived first.
 */
export async function runIntegrity(test: IntegrityCase): Promise<IntegrityReport> {
  const shuffles = DEFAULT_SHUFFLES;
  const reference = await replayStore(test, test.events);
  const again = await replayStore(test, test.events);
  // `Number(...)` rather than a ternary: equality is the whole question, and the
  // false arm of a ternary here is a branch nothing but a broken store can reach.
  const determinism = Number(again.state === reference.state);

  const random = mulberry32(test.seed ^ 0x5eed);
  let matched = 0;
  for (let index = 0; index < shuffles; index += 1) {
    const shuffled = shuffle(test.events, random);
    const replay = await replayStore(test, shuffled);
    if (replay.state === reference.state) matched += 1;
  }

  const control = await replayStore(test, test.events, reverseOrderView);
  const controlInvariance = Number(control.state === reference.state);

  return {
    events: test.events.length,
    runs: test.runs.length,
    items: reference.items.length,
    orders: shuffles,
    reference: reference.state,
    orderInvariance: matched / shuffles,
    replayDeterminism: determinism,
    controlInvariance,
    instrumentSensitive: controlInvariance < 1,
  };
}

/** Fisher–Yates over a copy, driven by the injected stream. */
export function shuffle<T>(rows: readonly T[], random: () => number): readonly T[] {
  const out = [...rows];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    const left = out[index] as T;
    const right = out[swap] as T;
    out[index] = right;
    out[swap] = left;
  }
  return out;
}

function finite(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

function round(value: number): number {
  return Math.round(value * 1e9) / 1e9;
}
