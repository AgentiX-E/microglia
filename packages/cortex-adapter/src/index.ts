/**
 * Cortex projection adapter.
 *
 * ## What this proves, and what it does not
 *
 * Cortex is not published on npm (verified: every `@agentix-e/cortex-*`
 * package returns 404 from the registry), so this adapter is written against
 * the **structural** `Storage` contract documented in `cortex-core`: a
 * table-oriented KV with `put/get/del/query`. A fake storage in the tests
 * stands in for `SqliteStorage`; nothing here depends on a package that cannot
 * be installed.
 *
 * The projection is deliberate rather than a re-implementation:
 *
 *   microglia KnowledgeItem  ->  cortex MemoryValue   (cognitive layer input)
 *   microglia evidence/scope ->  tags                  (retrieval + audit)
 *   microglia validity       ->  Fact                  (bitemporal projection)
 *
 * Microglia keeps its own journal as the operational source of truth. Cortex
 * receives a projection so its value gates, FSRS scheduling and contradiction
 * resolution can run over the same knowledge — not so that Cortex becomes the
 * feedback ledger, which it has no schema for.
 */
import type { KnowledgeItem } from '@agentix-e/microglia-core';

/**
 * Structural copies of cortex's `MemoryValue` and `Fact`.
 *
 * They are re-declared rather than imported because the packages are not on
 * npm; a structural copy is checked against the documented shape at the call
 * site and cannot drift silently behind a version range that does not exist.
 * When cortex publishes, these become `import type` and the adapter gains a
 * conformance test against the real package.
 */
export type CortexMemoryValue = {
  id: string;
  content: string;
  value: number;
  confidence: number;
  source: string;
  sourceTrust: number;
  type: 'episodic' | 'semantic' | 'procedural';
  tags: string[];
  createdAt: number;
  lastAccessedAt: number;
  stability: number;
  difficulty: number;
};

export type CortexFact = {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  validFrom: number;
  validUntil: number;
  systemFrom: number;
  systemUntil: number;
  source: string;
  sourceTrust: number;
  confidence: number;
};

/** The subset of `cortex-core`'s `Storage` this adapter needs. */
export interface CortexStorage {
  put(table: string, key: string, value: unknown, opts?: { tags?: string[] }): Promise<void>;
  get<T>(table: string, key: string): Promise<T | undefined>;
  del(table: string, key: string): Promise<void>;
  query<T>(table: string, predicate?: { tags?: string[]; limit?: number }): Promise<T[]>;
}

export const CORTEX_MEMORY_TABLE = 'memories';
export const CORTEX_FACT_TABLE = 'facts';

export type ProjectionOptions = {
  readonly storage: CortexStorage;
  /** Source label recorded on every projected memory. Defaults to `microglia`. */
  readonly source?: string;
};

/**
 * Map a knowledge item into cortex's `MemoryValue`.
 *
 * Field choices that matter:
 *  - `value` is the fused confidence, which is what cortex's write gate reads.
 *  - `sourceTrust` is preserved from the item, so quarantine decisions survive
 *    the projection.
 *  - `tags` carry namespace and scope, because cortex's `QueryPredicate` filters
 *    on exact tags and has no notion of our scope object.
 *  - `type` is `semantic` for constraints and `episodic` for exemplars: a rule
 *    is knowledge, a worked example is an experience.
 */
export function toCortexMemory(item: KnowledgeItem, source = 'microglia'): CortexMemoryValue {
  return {
    id: item.id,
    content: item.statement,
    value: item.confidence,
    confidence: item.confidence,
    source,
    sourceTrust: item.trust,
    type: item.kind === 'exemplar' ? 'episodic' : 'semantic',
    tags: tagsOf(item),
    createdAt: item.createdAt,
    lastAccessedAt: item.updatedAt,
    // Cortex's FSRS defaults: one day of stability, mid difficulty. An expired
    // rule is projected at the floor so a consumer that schedules review does
    // not treat it as durable.
    stability: item.validUntil === Infinity ? 1 : 0.5,
    difficulty: 5,
  };
}

export function toCortexFact(item: KnowledgeItem): CortexFact {
  const [subject, predicate] = splitStatement(item.statement);
  return {
    id: `${item.id}:fact`,
    subject,
    predicate,
    object: item.payload === undefined ? item.statement : JSON.stringify(item.payload),
    validFrom: item.validFrom,
    validUntil: item.validUntil,
    systemFrom: item.systemFrom,
    systemUntil: item.systemUntil,
    source: `microglia:${item.kind}`,
    sourceTrust: item.trust,
    confidence: item.confidence,
  };
}

export function tagsOf(item: KnowledgeItem): string[] {
  const scope = item.scope;
  const tags = [
    `ns:${item.namespace}`,
    `task:${scope.task}`,
    `kind:${item.kind}`,
    `status:${item.status}`,
  ];
  if (scope.domain) tags.push(`domain:${scope.domain}`);
  if (scope.schemaDigest) tags.push(`schema:${scope.schemaDigest}`);
  if (scope.intent) tags.push(`intent:${scope.intent}`);
  if (scope.field) tags.push(`field:${scope.field}`);
  if (scope.reasonCode) tags.push(`reason:${scope.reasonCode}`);
  return tags;
}

export class CortexProjection {
  private readonly storage: CortexStorage;
  private readonly source: string;

  public constructor(options: ProjectionOptions) {
    this.storage = options.storage;
    this.source = options.source ?? 'microglia';
  }

  /** Idempotent: projecting the same item twice leaves one memory and one fact. */
  public async project(item: KnowledgeItem): Promise<void> {
    if (!item.namespace) {
      throw new Error('Cannot project knowledge without a namespace');
    }
    await this.storage.put(CORTEX_MEMORY_TABLE, item.id, toCortexMemory(item, this.source), {
      tags: tagsOf(item),
    });
    await this.storage.put(CORTEX_FACT_TABLE, `${item.id}:fact`, toCortexFact(item), {
      tags: tagsOf(item),
    });
  }

  public async projectAll(items: readonly KnowledgeItem[]): Promise<number> {
    for (const item of items) await this.project(item);
    return items.length;
  }

  /** Reads back from cortex's table, proving the projection is inspectable. */
  public read(id: string): Promise<CortexMemoryValue | undefined> {
    return this.storage.get<CortexMemoryValue>(CORTEX_MEMORY_TABLE, id);
  }

  /** Items cortex may act on: those its own write gate would admit. */
  public async admitted(
    namespace: string,
    threshold = 0.5,
  ): Promise<readonly CortexMemoryValue[]> {
    const rows = await this.storage.query<CortexMemoryValue>(CORTEX_MEMORY_TABLE, {
      tags: [`ns:${namespace}`],
    });
    return rows.filter((memory) => memory.value >= threshold);
  }

  public async remove(item: KnowledgeItem): Promise<void> {
    await this.storage.del(CORTEX_MEMORY_TABLE, item.id);
    await this.storage.del(CORTEX_FACT_TABLE, `${item.id}:fact`);
  }
}

function splitStatement(statement: string): [string, string] {
  const dot = statement.indexOf('.');
  const head = dot === -1 ? statement : statement.slice(0, dot);
  const space = head.indexOf(' ');
  if (space === -1) return [head, 'states'];
  return [head.slice(0, space), head.slice(space + 1)];
}
