import { describe, expect, it } from 'vitest';
import { createKnowledgeItem, defaultPolicy } from '@agentix-e/microglia-core';
import type { DistillCandidate } from '@agentix-e/microglia-core';
import type { CortexMemoryValue, CortexStorage } from '../cortex.js';
import {
  CORTEX_FACT_TABLE,
  CORTEX_MEMORY_TABLE,
  CortexProjection,
  tagsOf,
  toCortexFact,
  toCortexMemory,
} from '../cortex.js';

const at = 1_700_000_000_000;

class FakeCortexStorage implements CortexStorage {
  public readonly tables = new Map<string, Map<string, { value: unknown; tags: string[] }>>();

  public put(
    table: string,
    key: string,
    value: unknown,
    opts?: { tags?: string[] },
  ): Promise<void> {
    const bucket = this.tables.get(table) ?? new Map();
    bucket.set(key, { value, tags: opts?.tags ?? [] });
    this.tables.set(table, bucket);
    return Promise.resolve();
  }

  public get<T>(table: string, key: string): Promise<T | undefined> {
    return Promise.resolve(this.tables.get(table)?.get(key)?.value as T | undefined);
  }

  public del(table: string, key: string): Promise<void> {
    this.tables.get(table)?.delete(key);
    return Promise.resolve();
  }

  public query<T>(table: string, predicate?: { tags?: string[]; limit?: number }): Promise<T[]> {
    const required = predicate?.tags ?? [];
    const rows = [...(this.tables.get(table)?.values() ?? [])]
      .filter((row) => required.every((tag) => row.tags.includes(tag)))
      .map((row) => row.value as T);
    return Promise.resolve(predicate?.limit === undefined ? rows : rows.slice(0, predicate.limit));
  }
}

function item(overrides: Partial<DistillCandidate> = {}, id = 'k_1') {
  const candidate: DistillCandidate = {
    namespace: 'acme',
    kind: 'constraint',
    scope: { task: 'chart.recommend', domain: 'sales', intent: 'trend' },
    statement: 'For a trend question over revenue. Use a line chart.',
    payload: { when: { intent: 'trend' }, then: { mark: 'line' } },
    evidence: { feedbackId: 'fb_1', runId: 'run_1', at, weight: 0.9 },
    trust: 0.9,
    dedupeKey: id,
    ...overrides,
  };
  return createKnowledgeItem(candidate, defaultPolicy, at, id);
}

describe('projection mapping', () => {
  it('preserves confidence, trust, type, and scope tags', () => {
    const memory = toCortexMemory(item());
    expect(memory.id).toBe('k_1');
    expect(memory.value).toBeCloseTo(memory.confidence, 10);
    expect(memory.sourceTrust).toBe(0.9);
    expect(memory.type).toBe('semantic');
    expect(memory.tags).toContain('ns:acme');
    expect(memory.tags).toContain('domain:sales');
    expect(memory.tags).toContain('intent:trend');
  });

  it('marks an exemplar as episodic and an expired rule as short-lived', () => {
    const exemplar = toCortexMemory(item({ kind: 'exemplar' }));
    expect(exemplar.type).toBe('episodic');

    const expired = toCortexMemory({ ...item(), validUntil: at - 1 });
    expect(expired.stability).toBe(0.5);
  });

  it('projects bitemporal validity into a fact', () => {
    const fact = toCortexFact(item());
    expect(fact.validFrom).toBe(at);
    expect(fact.validUntil).toBe(Infinity);
    expect(fact.systemUntil).toBe(Infinity);
    expect(fact.source).toBe('microglia:constraint');
    expect(fact.object).toContain('line');
  });

  it('derives a subject and predicate from a statement without a space', () => {
    const fact = toCortexFact({ ...item(), statement: 'Rule.' });
    expect(fact.predicate).toBe('states');
  });

  it('includes every constrained scope dimension exactly once', () => {
    const tags = tagsOf({
      ...item(),
      scope: {
        task: 'chart.recommend',
        domain: 'sales',
        intent: 'trend',
        field: 'revenue',
        reasonCode: 'wrong_chart_type',
        schemaDigest: 'd1',
      },
    });
    expect(new Set(tags).size).toBe(tags.length);
    expect(tags).toContain('field:revenue');
    expect(tags).toContain('reason:wrong_chart_type');
    expect(tags).toContain('schema:d1');
  });
});

describe('projection lifecycle', () => {
  it('writes both a memory and a fact, and reads them back', async () => {
    const storage = new FakeCortexStorage();
    const projection = new CortexProjection({ storage });
    await projection.project(item());

    const memory = await projection.read('k_1');
    expect(memory?.source).toBe('microglia');
    expect(await storage.get(CORTEX_FACT_TABLE, 'k_1:fact')).toBeDefined();
  });

  it('admits only rows above the threshold in the requested namespace', async () => {
    const storage = new FakeCortexStorage();
    const projection = new CortexProjection({ storage });
    await projection.projectAll([
      item({}, 'k_high'),
      { ...item({}, 'k_low'), confidence: 0.2 },
      item({ namespace: 'other' }, 'k_other'),
    ]);

    const admitted = await projection.admitted('acme', 0.5);
    expect(admitted.map((row) => row.id)).toEqual(['k_high']);
  });

  it('removes both projections', async () => {
    const storage = new FakeCortexStorage();
    const projection = new CortexProjection({ storage });
    const knowledge = item();
    await projection.project(knowledge);
    await projection.remove(knowledge);
    expect(await projection.read(knowledge.id)).toBeUndefined();
    expect(await storage.get(CORTEX_FACT_TABLE, `${knowledge.id}:fact`)).toBeUndefined();
  });

  it('refuses to project an item without a namespace', async () => {
    const projection = new CortexProjection({ storage: new FakeCortexStorage() });
    await expect(projection.project({ ...item(), namespace: '' })).rejects.toThrow(/namespace/);
  });

  it('counts a batch projection', async () => {
    const projection = new CortexProjection({ storage: new FakeCortexStorage() });
    expect(await projection.projectAll([item({}, 'a'), item({}, 'b')])).toBe(2);
  });

  it('keeps the memory table addressable by the documented constant', async () => {
    const storage = new FakeCortexStorage();
    await new CortexProjection({ storage }).project(item());
    expect(storage.tables.get(CORTEX_MEMORY_TABLE)?.size).toBe(1);
  });
});

describe('type compatibility', () => {
  it('produces a value assignable to cortex MemoryValue', () => {
    const memory: CortexMemoryValue = toCortexMemory(item());
    expect(typeof memory.stability).toBe('number');
    expect(memory.difficulty).toBeGreaterThanOrEqual(1);
  });
});
