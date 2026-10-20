/**
 * `Microglia` — the composition root.
 *
 * Everything the host touches goes through this object, and every dependency is
 * injected: the store, the clock, the random source, the domain interpreter.
 * That is what makes the same code run in a browser tab, a Node process, and a
 * deterministic replay in CI.
 */
import {
  MicrogliaError,
  applyOutcome,
  defaultPolicy,
  newId,
  mulberry32,
  resolvePolicy,
  systemClock,
} from '@agentix-e/microglia-core';
import type {
  Clock,
  FeedbackEvent,
  FeedbackSignal,
  Json,
  KnowledgePack,
  Policy,
  RandomSource,
  RecallQuery,
  RunRecord,
} from '@agentix-e/microglia-core';
import type { MemoryPort, MemoryStats } from '@agentix-e/microglia-memory';
import { buildPack } from '@agentix-e/microglia-apply';
import {
  distill as distillLog,
  ruleInterpreter,
  type DistillReport,
  type Interpreter,
} from '@agentix-e/microglia-distill';
import { diagnose } from './doctor.js';
import { buildDataset, toJsonl } from './export.js';
import { buildFeedbackEvent } from './normalize.js';
import type {
  Diagnosis,
  ExportFormat,
  FeedbackInput,
  FeedbackOptions,
  MicrogliaOptions,
  RunStart,
} from './options.js';
import { RunHandle, type RunHost } from './run.js';

const NAMESPACE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

export class Microglia implements RunHost {
  public readonly app: string;
  public readonly namespace: string;
  public readonly policy: Policy;
  public readonly store: MemoryPort;

  private readonly clock: Clock;
  private readonly random: RandomSource;
  private readonly interpreter: Interpreter;
  private readonly budget: number;
  private readonly tag: string | undefined;
  private readonly creditEnabled: boolean;
  private readonly editSemantics:
    | ((before: Json, after: Json) => number | undefined)
    | undefined;
  private readonly credited = new Map<string, Set<string>>();
  private closed = false;

  public constructor(options: MicrogliaOptions) {
    if (!options.app || options.app.length > 64) {
      throw new MicrogliaError('MG_E_CONFIG', 'app must be 1..64 characters');
    }
    if (!NAMESPACE_PATTERN.test(options.namespace)) {
      throw new MicrogliaError(
        'MG_E_NAMESPACE_MISMATCH',
        'namespace must match [A-Za-z0-9][A-Za-z0-9._:-]{0,63}',
        { namespace: options.namespace },
      );
    }
    if (!options.store) {
      throw new MicrogliaError('MG_E_CONFIG', 'A memory store is required');
    }
    this.app = options.app;
    this.namespace = options.namespace;
    this.policy = resolvePolicy(options.policy ?? defaultPolicy);
    this.store = options.store;
    this.clock = options.clock ?? systemClock;
    this.random = options.random ?? Math.random;
    this.interpreter = options.interpreter ?? ruleInterpreter;
    this.budget = options.budget ?? this.policy.defaultBudget;
    this.tag = options.tag;
    this.creditEnabled = options.credit ?? true;
    this.editSemantics = options.editSemantics;
  }

  /** Convenience factory; identical to `new Microglia(options)`. */
  public static async open(options: MicrogliaOptions): Promise<Microglia> {
    return new Microglia(options);
  }

  public begin(start: RunStart): RunHandle {
    this.assertOpen();
    return new RunHandle(this, start);
  }

  /**
   * Recall the knowledge relevant to one query.
   *
   * The pack is what the host injects; its `ids` are what the run cites, and
   * therefore what can later be credited or blamed.
   */
  public recall(query: Omit<RecallQuery, 'namespace'>): Promise<KnowledgePack> {
    this.assertOpen();
    return buildPack(
      { ...query, namespace: this.namespace },
      {
        memory: this.store,
        budget: query.budget ?? this.budget,
        ...(this.tag === undefined ? {} : { tag: this.tag }),
      },
    );
  }

  public nextId(prefix: string): string {
    return newId(prefix, this.clock.now(), this.random);
  }

  public now(): number {
    return this.clock.now();
  }

  public async persistRun(run: RunRecord): Promise<void> {
    this.assertOpen();
    if (run.namespace !== this.namespace) {
      throw new MicrogliaError('MG_E_NAMESPACE_MISMATCH', 'Run belongs to another namespace', {
        expected: this.namespace,
        actual: run.namespace,
      });
    }
    await this.store.putRun(run);
  }

  public async recordFeedback(
    run: RunRecord,
    input: FeedbackInput,
    options: FeedbackOptions = {},
  ): Promise<FeedbackEvent> {
    this.assertOpen();
    const at = options.at ?? this.clock.now();
    const event = buildFeedbackEvent({
      input,
      run,
      namespace: this.namespace,
      at,
      id: newId('fb', at, this.random),
      actor: options.actor ?? { type: 'user' },
      ...(options.trustCeiling === undefined ? {} : { trustCeiling: options.trustCeiling }),
      ...(this.editSemantics === undefined ? {} : { editSemantics: this.editSemantics }),
    });
    await this.store.appendEvent(event);
    if (this.creditEnabled) await this.credit(run, event, at);
    return event;
  }

  public async distill(
    options: {
      since?: number;
      limit?: number;
      generalize?: boolean;
      resolveContradictions?: boolean;
    } = {},
  ): Promise<DistillReport> {
    this.assertOpen();
    return distillLog({
      memory: this.store,
      policy: this.policy,
      clock: this.clock,
      random: this.random,
      interpreter: this.interpreter,
      ...(options.since === undefined ? {} : { since: options.since }),
      ...(options.limit === undefined ? {} : { limit: options.limit }),
      ...(options.generalize === undefined ? {} : { generalize: options.generalize }),
      ...(options.resolveContradictions === undefined
        ? {}
        : { resolveContradictions: options.resolveContradictions }),
    });
  }

  public async exportDataset(
    format: ExportFormat,
    options: { task?: string; since?: number } = {},
  ): Promise<ReturnType<typeof buildDataset>> {
    this.assertOpen();
    return buildDataset(format, {
      memory: this.store,
      namespace: this.namespace,
      ...(options.task === undefined ? {} : { task: options.task }),
      ...(options.since === undefined ? {} : { since: options.since }),
    });
  }

  public async exportJsonl(format: ExportFormat): Promise<string> {
    const rows = await this.exportDataset(format);
    return toJsonl(rows, { app: this.app, namespace: this.namespace, format });
  }

  public doctor(): Promise<Diagnosis> {
    this.assertOpen();
    return diagnose({
      memory: this.store,
      namespace: this.namespace,
      policy: this.policy,
      now: this.clock.now(),
    });
  }

  public stats(): Promise<MemoryStats> {
    return this.store.stats();
  }

  public async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.store.close();
  }

  /**
   * Credit assignment.
   *
   * One signal per (run, knowledge item), taken from the first feedback the run
   * receives. A second correction on the same run teaches new knowledge; it does
   * not re-score the same evidence, because a host that fires both a thumbs-down
   * and an edit would otherwise count one failure twice.
   */
  private async credit(run: RunRecord, event: FeedbackEvent, at: number): Promise<void> {
    const outcome = creditOf(event.signal);
    if (outcome === undefined) return;
    const ids = run.provenance.knowledgeIds;
    if (ids.length === 0) return;

    let already = this.credited.get(run.id);
    if (!already) {
      already = new Set<string>();
      this.credited.set(run.id, already);
    }

    for (const id of ids) {
      if (already.has(id)) continue;
      const item = await this.store.getKnowledge(id);
      if (!item) continue;
      await this.store.putKnowledge(applyOutcome(item, outcome, this.policy, at));
      already.add(id);
    }
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new MicrogliaError('MG_E_NOT_OPEN', 'Microglia is closed');
    }
  }
}

/**
 * What a signal says about the knowledge that was in the prompt.
 *
 * `undefined` means "no opinion": a clarification teaches vocabulary, and an
 * abstention says the model had too little evidence — neither is evidence that
 * the injected rules were wrong.
 */
export function creditOf(signal: FeedbackSignal): boolean | undefined {
  switch (signal.type) {
    case 'rating':
      return signal.value === 'up';
    case 'edit':
      return false;
    case 'outcome':
      return signal.ok;
    case 'clarification':
    case 'abstain':
    case 'preference':
      return undefined;
  }
}

/** A helper for hosts that need a deterministic stream in tests and replays. */
export function seededRandom(seed: number): RandomSource {
  return mulberry32(seed);
}
