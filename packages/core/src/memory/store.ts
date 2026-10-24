/**
 * The store: one journal, three maps, one lexical index.
 *
 * Every read is served from memory after `open()`. That is the right trade for
 * the target deployment — one host process, tens of thousands of corrections,
 * not millions — and it makes retrieval deterministic and fast without a
 * second cache to invalidate.
 */
import {
  MicrogliaError,
  bm25Score,
  contentKey,
  scopeMatches,
  specificity,
  tierFor,
  tokenize,
  withoutEvidence,
} from '../kernel/index.js';
import type {
  ErasureReport,
  ErasureSelector,
  ErasureTombstone,
  FeedbackEvent,
  KnowledgeItem,
  Policy,
  ProvenanceTier,
  RecallQuery,
  RunRecord,
} from '../kernel/index.js';
import { LexicalIndex } from './lexical-index.js';
import type { Journal } from './journal.js';
import type {
  EventFilter,
  KnowledgeFilter,
  MemoryPort,
  MemoryStats,
  SearchHit,
} from './port.js';

const DEFAULT_LIMIT = 8;

export class EmbeddedMemory implements MemoryPort {
  private readonly journal: Journal;
  private readonly events = new Map<string, FeedbackEvent>();
  private readonly runs = new Map<string, RunRecord>();
  private readonly knowledge = new Map<string, KnowledgeItem>();
  private index = new LexicalIndex();
  private closed = false;

  private constructor(journal: Journal) {
    this.journal = journal;
  }

  public static async open(journal: Journal): Promise<EmbeddedMemory> {
    const store = new EmbeddedMemory(journal);
    const snapshot = await journal.load();
    for (const event of snapshot.events) {
      assertSchema(event.schema, 'microglia.feedback/1', 'event', event.id);
      store.events.set(event.id, event);
    }
    for (const run of snapshot.runs) {
      assertSchema(run.schema, 'microglia.run/1', 'run', run.id);
      store.runs.set(run.id, run);
    }
    for (const item of snapshot.knowledge) {
      assertSchema(item.schema, 'microglia.knowledge/1', 'knowledge', item.id);
      store.indexKnowledge(rehydrateKnowledge(item));
    }
    return store;
  }

  public async appendEvent(event: FeedbackEvent): Promise<void> {
    this.assertOpen();
    if (this.events.has(event.id)) return;
    await this.journal.appendEvent(event);
    this.events.set(event.id, event);
  }

  public getEvent(id: string): Promise<FeedbackEvent | undefined> {
    return Promise.resolve(this.events.get(id));
  }

  public listEvents(filter: EventFilter = {}): Promise<readonly FeedbackEvent[]> {
    const limit = filter.limit ?? Number.POSITIVE_INFINITY;
    const out = [...this.events.values()]
      .filter((event) => {
        if (filter.namespace !== undefined && event.namespace !== filter.namespace) return false;
        if (filter.runId !== undefined && event.runId !== filter.runId) return false;
        if (filter.sessionId !== undefined && event.sessionId !== filter.sessionId) return false;
        if (filter.since !== undefined && event.at < filter.since) return false;
        return true;
      })
      .sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
    return Promise.resolve(out.slice(0, limit));
  }

  public async putRun(run: RunRecord): Promise<void> {
    this.assertOpen();
    if (this.runs.has(run.id)) return;
    await this.journal.appendRun(run);
    this.runs.set(run.id, run);
  }

  public getRun(id: string): Promise<RunRecord | undefined> {
    return Promise.resolve(this.runs.get(id));
  }

  public async putKnowledge(item: KnowledgeItem): Promise<void> {
    this.assertOpen();
    this.assertNamespace(item);
    await this.journal.writeKnowledge(item);
    this.indexKnowledge(item);
  }

  public getKnowledge(id: string): Promise<KnowledgeItem | undefined> {
    return Promise.resolve(this.knowledge.get(id));
  }

  public listKnowledge(filter: KnowledgeFilter = {}): Promise<readonly KnowledgeItem[]> {
    const limit = filter.limit ?? Number.POSITIVE_INFINITY;
    const status = filter.status ?? 'all';
    const out = [...this.knowledge.values()]
      .filter((item) => {
        if (filter.namespace !== undefined && item.namespace !== filter.namespace) return false;
        if (filter.task !== undefined && item.scope.task !== filter.task) return false;
        if (status !== 'all' && item.status !== status) return false;
        return true;
      })
      .sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : 1));
    return Promise.resolve(out.slice(0, limit));
  }

  /**
   * Rank = 0.65 * normalised BM25 + 0.35 * confidence + a small specificity
   * bonus. The weights are stated rather than learned because a host must be
   * able to explain why a rule reached the prompt.
   */
  public search(query: RecallQuery): Promise<readonly SearchHit[]> {
    const limit = query.limit ?? DEFAULT_LIMIT;
    const queryTokens = tokenize(query.text);
    const candidateIds =
      queryTokens.length === 0
        ? new Set(this.knowledge.keys())
        : this.index.candidates(queryTokens);

    /**
     * Scope is an index, not merely a filter.
     *
     * A structured caller knows the intent, domain, and field of the question
     * even when the question text does not contain those words. Relying on BM25
     * alone would drop exactly the rules that generalised out of a domain —
     * they no longer carry the domain token — which is the opposite of what the
     * flywheel is for. When a scope is supplied, every item that satisfies it
     * becomes a candidate and is ranked on confidence when it has no lexical
     * overlap.
     */
    if (query.scope && (query.anchoring ?? 'scope') === 'scope') {
      for (const [id, item] of this.knowledge) {
        if (item.status !== 'active') continue;
        if (item.namespace !== query.namespace) continue;
        if (item.scope.task !== query.task) continue;
        if (scopeMatches(item.scope, query)) candidateIds.add(id);
      }
    }

    const scored: { item: KnowledgeItem; lexical: number }[] = [];
    let maxLexical = 0;
    for (const id of candidateIds) {
      const item = this.knowledge.get(id);
      if (!item) continue;
      if (item.namespace !== query.namespace) continue;
      if (item.status !== 'active') continue;
      if (!scopeMatches(item.scope, query)) continue;
      const lexical = bm25Score(
        queryTokens,
        this.index.tokensOf(id),
        this.index.lengthOf(id),
        this.index.averageLength(),
        (token) => this.index.documentFrequency(token),
        this.index.documentCount(),
      );
      if (lexical > maxLexical) maxLexical = lexical;
      scored.push({ item, lexical });
    }

    const hits: SearchHit[] = scored.map(({ item, lexical }) => {
      const normalized = maxLexical === 0 ? 0 : lexical / maxLexical;
      const score =
        0.65 * normalized + 0.35 * item.confidence + 0.02 * (specificity(item.scope) - 1);
      return { item, lexical, score };
    });

    hits.sort((a, b) => b.score - a.score || (a.item.id < b.item.id ? -1 : 1));
    // Time enters through `confidence`, which `distill` computes at write time
    // against an injected clock. Search is therefore a pure function of stored
    // state, and replaying the same store returns the same pack.
    return Promise.resolve(hits.slice(0, limit));
  }

  /**
   * Erase by selector, then re-derive every claim that cited the erased events.
   *
   * Three things happen, in this order, and the order is the design: the events
   * and runs go, the claims that cited them are rebuilt from the evidence that
   * survives (losing their tier if the promotion rested on an erased outcome),
   * and a tombstone records that a selector was applied. The tombstone never
   * carries a statement or a payload — a record of the erased data would defeat
   * the erasure it documents.
   */
  public async forget(
    selector: ErasureSelector,
    policy: Policy,
    at: number,
  ): Promise<ErasureReport> {
    this.assertOpen();
    const explicit = new Set(selector.ids ?? []);
    if (
      explicit.size === 0 &&
      selector.taskId === undefined &&
      selector.actorHash === undefined
    ) {
      throw new MicrogliaError('MG_E_CONFIG', 'forget requires ids, taskId or actorHash');
    }
    const inScope = (namespace: string): boolean =>
      selector.namespace === undefined || selector.namespace === namespace;

    const erasedEvents = [...this.events.values()].filter(
      (event) =>
        inScope(event.namespace) &&
        (explicit.has(event.id) ||
          (selector.taskId !== undefined && event.taskId === selector.taskId) ||
          (selector.actorHash !== undefined && event.actor.idHash === selector.actorHash)),
    );
    const eventIds = new Set(erasedEvents.map((event) => event.id));
    const erasedRuns = [...this.runs.values()].filter(
      (run) =>
        inScope(run.namespace) &&
        (explicit.has(run.id) ||
          (selector.taskId !== undefined && run.taskId === selector.taskId)),
    );

    // The tier of each *surviving* event, so a claim that keeps an outcome keeps
    // the promotion that outcome earned, and one whose outcome was erased does not.
    const tiers = new Map<string, ProvenanceTier>();
    for (const event of this.events.values()) {
      if (!eventIds.has(event.id)) tiers.set(event.id, tierFor(event.kind));
    }

    const removedKnowledge: string[] = [];
    let rescored = 0;
    for (const item of [...this.knowledge.values()]) {
      const cited = item.evidence.some((entry) => eventIds.has(entry.feedbackId));
      if (!inScope(item.namespace)) continue;
      if (!explicit.has(item.id) && !cited) continue;
      if (explicit.has(item.id)) {
        removedKnowledge.push(item.id);
        this.knowledge.delete(item.id);
        this.index.remove(item.id);
        continue;
      }
      const next = withoutEvidence(item, eventIds, tiers, policy, at);
      if (next.evidence.length === 0) {
        removedKnowledge.push(item.id);
        this.knowledge.delete(item.id);
        this.index.remove(item.id);
        continue;
      }
      await this.journal.writeKnowledge(next);
      this.indexKnowledge(next);
      rescored += 1;
    }

    for (const event of erasedEvents) this.events.delete(event.id);
    for (const run of erasedRuns) this.runs.delete(run.id);

    await this.journal.rewrite({
      events: [...this.events.values()],
      runs: [...this.runs.values()],
      knowledge: [...this.knowledge.values()],
    });

    const tombstone: ErasureTombstone = {
      schema: 'microglia.erasure/1',
      id: contentKey(
        `erasure|${at}|${[...eventIds].sort().join(',')}|${erasedRuns
          .map((run) => run.id)
          .sort()
          .join(',')}|${removedKnowledge.sort().join(',')}`,
      ),
      at,
      ...(selector.namespace === undefined ? {} : { namespace: selector.namespace }),
      selector,
      erased: {
        events: erasedEvents.map((event) => event.id),
        runs: erasedRuns.map((run) => run.id),
        knowledge: removedKnowledge,
      },
    };
    await this.journal.appendErasure(tombstone);

    return {
      events: erasedEvents.length,
      runs: erasedRuns.length,
      knowledge: removedKnowledge.length,
      rescored,
      tombstone: tombstone.id,
    };
  }

  public stats(): Promise<MemoryStats> {
    let active = 0;
    for (const item of this.knowledge.values()) if (item.status === 'active') active += 1;
    return Promise.resolve({
      events: this.events.size,
      runs: this.runs.size,
      knowledge: this.knowledge.size,
      active,
    });
  }

  public async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.journal.close();
  }

  private indexKnowledge(item: KnowledgeItem): void {
    this.knowledge.set(item.id, item);
    this.index.add(item.id, `${item.statement} ${item.kind} ${scopeText(item)}`);
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new MicrogliaError('MG_E_NOT_OPEN', 'Memory store is closed');
    }
  }

  private assertNamespace(item: KnowledgeItem): void {
    if (!item.namespace) {
      throw new MicrogliaError('MG_E_NAMESPACE_MISMATCH', 'Knowledge item has no namespace', {
        id: item.id,
      });
    }
  }
}

/**
 * Schema validation on load.
 *
 * An older or newer journal is a migration problem, not a parsing problem. The
 * store refuses to operate on a shape it does not understand rather than
 * silently ignoring fields it cannot interpret.
 */
function assertSchema(actual: string, expected: string, kind: string, id: string): void {
  if (actual !== expected) {
    throw new MicrogliaError('MG_E_SCHEMA_VERSION', `Unsupported ${kind} schema`, {
      id,
      expected,
      actual,
    });
  }
}

/**
 * JSON has no `Infinity`: a persisted `validUntil` comes back as `null`.
 *
 * Without this mapping, `validityDecay` subtracts `null` and produces `NaN`,
 * which propagates into `confidence` and silently makes every reloaded rule
 * inactive. The round-trip is therefore part of the contract, and it is tested.
 */
export function rehydrateKnowledge(item: KnowledgeItem): KnowledgeItem {
  return {
    ...item,
    validUntil: item.validUntil === null ? Infinity : item.validUntil,
    systemUntil: item.systemUntil === null ? Infinity : item.systemUntil,
  };
}

function scopeText(item: KnowledgeItem): string {
  const scope = item.scope;
  return [scope.domain, scope.intent, scope.field, scope.reasonCode].filter(Boolean).join(' ');
}
