/**
 * The outbox.
 *
 * A browser tab loses the network at the worst possible moment — while the user is
 * correcting an answer. Dropping that correction loses the only signal the product
 * exists to collect, so a feedback call is written to a queue first and sent when
 * it can be. Each entry keeps its idempotency key, so a retry after an ambiguous
 * failure cannot record the same correction twice.
 */
import type { FeedbackInput, JsonObject } from '@agentix-e/microglia-core';

export type FeedbackPayload = {
  readonly run: {
    readonly task: string;
    readonly input: JsonObject;
    readonly output: JsonObject;
    readonly sessionId?: string;
    readonly model?: string;
    readonly packIds?: readonly string[];
  };
  readonly feedback: FeedbackInput;
};

export type OutboxEntry = {
  readonly key: string;
  readonly payload: FeedbackPayload;
  readonly attempts: number;
};

export type Outbox = {
  list(): readonly OutboxEntry[];
  push(entry: OutboxEntry): void;
  update(key: string, attempts: number): void;
  remove(key: string): void;
};

/** Process-local queue. The default, and what a tab uses if storage is denied. */
export function memoryOutbox(): Outbox {
  const entries: OutboxEntry[] = [];
  return {
    list: () => [...entries],
    push: (entry) => {
      entries.push(entry);
    },
    update: (key, attempts) => {
      const index = entries.findIndex((entry) => entry.key === key);
      if (index >= 0) entries[index] = { ...(entries[index] as OutboxEntry), attempts };
    },
    remove: (key) => {
      const index = entries.findIndex((entry) => entry.key === key);
      if (index >= 0) entries.splice(index, 1);
    },
  };
}

/** The two methods of `localStorage` this needs, so a host can supply its own. */
export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

/**
 * A queue that survives a reload.
 *
 * Storage failures (quota, private mode, a host that disabled it) degrade to the
 * in-memory queue rather than throwing: losing durability is bad, losing the
 * correction is worse.
 */
export function persistedOutbox(storage: StorageLike, key = 'microglia.outbox'): Outbox {
  const read = (): OutboxEntry[] => {
    try {
      const raw = storage.getItem(key);
      if (raw === null) return [];
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? (parsed as OutboxEntry[]) : [];
    } catch {
      return [];
    }
  };
  const write = (entries: readonly OutboxEntry[]): void => {
    try {
      storage.setItem(key, JSON.stringify(entries));
    } catch {
      // Quota or disabled storage: the in-memory copy is still correct for this tab.
    }
  };
  return {
    list: () => read(),
    push: (entry) => write([...read(), entry]),
    update: (entryKey, attempts) =>
      write(read().map((entry) => (entry.key === entryKey ? { ...entry, attempts } : entry))),
    remove: (entryKey) => write(read().filter((entry) => entry.key !== entryKey)),
  };
}
