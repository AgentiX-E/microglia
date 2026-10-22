/**
 * What changed, stated as an event a host can act on.
 *
 * The delivery contract (§17.21) names four event types and one ordering rule:
 * ordered per `(taskType, seq)`, at-least-once, with `id` for de-duplication. The
 * ordering is the part that matters — a host that receives "retired" before
 * "admitted" for the same rule would unlearn something it never learned — so
 * sequence is assigned by the sender, per task type, and delivery is serialised.
 *
 * Two of the four are *derived* from the store, because the store already holds
 * what they describe: a rule that appeared, a rule that was rewritten, a rule
 * that stopped applying. `task.completed` is not derivable — the task table is the
 * host's, by design — so it is built from the record the host already holds when
 * it closes a task. A library that invented a task table to emit one event type
 * would be building a second product.
 */
import type { KnowledgeItem, TaskRecord } from '../kernel/index.js';

export type DeliveryType =
  | 'knowledge.admitted'
  | 'knowledge.superseded'
  | 'knowledge.retired'
  | 'task.completed';

/** The part of a rule a receiver needs to display or index it. */
export type DeliveryItem = {
  readonly id: string;
  readonly kind: string;
  readonly statement: string;
  readonly trust: number;
};

export type DraftEvent = {
  readonly type: DeliveryType;
  readonly namespace: string;
  readonly taskType: string;
  readonly item: DeliveryItem;
  readonly reason: string;
  readonly at: number;
};

export type DeliveryEvent = DraftEvent & {
  readonly id: string;
  /** Monotonic per task type, assigned by the dispatcher. */
  readonly seq: number;
};

/** What the sender remembers about one rule between two runs. */
export type KnowledgeSnapshot = {
  readonly status: string;
  readonly updatedAt: number;
};

const REASONS: Readonly<Record<DeliveryType, string>> = {
  'knowledge.admitted': 'admitted',
  'knowledge.superseded': 'rewritten',
  'knowledge.retired': 'no longer applies',
  'task.completed': 'task settled',
};

function itemOf(entry: KnowledgeItem): DeliveryItem {
  return { id: entry.id, kind: entry.kind, statement: entry.statement, trust: entry.trust };
}

/**
 * The events a store change implies.
 *
 * `previous` is the snapshot the sender took last time; an absent key means "not
 * seen before". Only transitions a receiver can act on are emitted: a rule that
 * is still a candidate has not been admitted, and a rule whose evidence merely
 * grew is the same rule.
 *
 * Ordering is `(updatedAt, id)` so a batch replayed from the same store produces
 * the same sequence — a delivery log that reshuffles on restart cannot be
 * de-duplicated by a receiver that already saw half of it.
 */
export function knowledgeEvents(options: {
  readonly namespace: string;
  readonly taskType: string;
  readonly previous: Readonly<Record<string, KnowledgeSnapshot>>;
  readonly current: readonly KnowledgeItem[];
  /** Falls back to the item's own `updatedAt` when the caller has no clock. */
  readonly at?: number;
}): readonly DraftEvent[] {
  const drafts: { readonly draft: DraftEvent; readonly order: number }[] = [];

  for (const entry of options.current) {
    const before = options.previous[entry.id];
    const at = options.at ?? entry.updatedAt;
    const isActive = entry.status === 'active';
    const wasActive = before?.status === 'active';

    if (isActive && before === undefined) {
      drafts.push({
        order: entry.updatedAt,
        draft: {
          type: 'knowledge.admitted',
          namespace: options.namespace,
          taskType: options.taskType,
          item: itemOf(entry),
          reason: REASONS['knowledge.admitted'],
          at,
        },
      });
      continue;
    }
    if (isActive && wasActive && before.updatedAt !== entry.updatedAt) {
      drafts.push({
        order: entry.updatedAt,
        draft: {
          type: 'knowledge.superseded',
          namespace: options.namespace,
          taskType: options.taskType,
          item: itemOf(entry),
          reason: REASONS['knowledge.superseded'],
          at,
        },
      });
      continue;
    }
    if (entry.status === 'retired' && before !== undefined && before.status !== 'retired') {
      drafts.push({
        order: entry.updatedAt,
        draft: {
          type: 'knowledge.retired',
          namespace: options.namespace,
          taskType: options.taskType,
          item: itemOf(entry),
          reason: REASONS['knowledge.retired'],
          at,
        },
      });
    }
  }

  // A rule that disappeared from the store was erased, not retired: erasure is
  // the one change a delivery log must *not* describe, because an event naming
  // deleted data would outlive it. Absence is therefore not iterated here.

  return drafts
    .sort((a, b) => a.order - b.order || (a.draft.item.id < b.draft.item.id ? -1 : 1))
    .map((entry) => entry.draft);
}

/** The `task.completed` event a host publishes when it closes a task. */
export function taskCompleted(record: TaskRecord, at?: number): DraftEvent {
  return {
    type: 'task.completed',
    namespace: record.namespace,
    taskType: record.taskType,
    item: {
      id: record.taskId,
      kind: 'task',
      statement: `${record.status} after ${record.attempts} attempt(s)`,
      trust: 0,
    },
    reason: record.reasonCode ?? record.status,
    at: at ?? record.closedAt,
  };
}

/** The snapshot to carry into the next call, so a restart does not replay history. */
export function snapshotOf(items: readonly KnowledgeItem[]): Record<string, KnowledgeSnapshot> {
  const snapshot: Record<string, KnowledgeSnapshot> = {};
  for (const entry of items) snapshot[entry.id] = { status: entry.status, updatedAt: entry.updatedAt };
  return snapshot;
}
