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
  corroborationShare,
  defaultPolicy,
  observationsOf,
  newId,
  mulberry32,
  resolvePolicy,
  systemClock,
} from '../kernel/index.js';
import type {
  Clock,
  ErasureReport,
  ErasureSelector,
  FeedbackEvent,
  FeedbackSignal,
  Json,
  KnowledgePack,
  Policy,
  RandomSource,
  RecallQuery,
  RunRecord,
} from '../kernel/index.js';
import type { MemoryPort, MemoryStats } from '../memory/index.js';
import type { DistillCandidate } from '../kernel/index.js';
import { buildPack } from '../apply/index.js';
import {
  distill as distillLog,
  ruleInterpreter,
  type DistillReport,
  type Interpreter,
} from '../distill/index.js';
import { diagnose } from './doctor.js';
import { buildDataset, toJsonl } from './export.js';
import { buildFeedbackEvent } from './normalize.js';
import { curateKnowledge, type CurationOptions, type CurationReport } from './curate.js';
import type {
  Diagnosis,
  ExportFormat,
  FeedbackInput,
  FeedbackOptions,
  MicrogliaOptions,
  RunStart,
  TaskOpen,
} from './options.js';
import { RunHandle, type RunHost } from './run.js';
import { TaskHandle } from './task.js';

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
  private readonly corroborationFloor: number | undefined;
  /**
   * Cached corroboration share, invalidated by anything that changes the knowledge.
   *
   * `recall` is on the request path, and re-reading the whole store on every request to
   * answer a question that only changes when the store does would be a per-request tax
   * for a per-distillation fact.
   */
  private corroborationCache: { readonly version: number; readonly share: number } | undefined;
  private knowledgeVersion = 0;
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
    this.corroborationFloor = options.corroborationFloor;
    if (
      this.corroborationFloor !== undefined &&
      (!Number.isFinite(this.corroborationFloor) ||
        this.corroborationFloor < 0 ||
        this.corroborationFloor > 1)
    ) {
      throw new MicrogliaError('MG_E_CONFIG', 'corroborationFloor must be in [0, 1]', {
        corroborationFloor: this.corroborationFloor,
      });
    }
  }

  /** Convenience factory; identical to `new Microglia(options)`. */
  public static async open(options: MicrogliaOptions): Promise<Microglia> {
    return new Microglia(options);
  }

  /**
   * Open a task instance.
   *
   * The task groups attempts, and its terminal decision becomes evidence for the
   * last attempt. A host that does not need the grouping keeps calling `begin`
   * directly, and its runs behave exactly as before.
   */
  public openTask(open: TaskOpen): TaskHandle {
    this.assertOpen();
    return new TaskHandle(this, open, this.clock.now());
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
  public async recall(query: Omit<RecallQuery, 'namespace'>): Promise<KnowledgePack> {
    this.assertOpen();
    const silenced = await this.cannotCorroborate();
    const pack = await buildPack(
      { ...query, namespace: this.namespace },
      {
        memory: this.store,
        budget: query.budget ?? this.budget,
        // A rule confident enough to be injected is confident enough to overrule a
        // recorded absence; below that, the absence speaks and the rule does not.
        absenceFloor: this.policy.activationThreshold,
        // A store that cannot corroborate its own rules cannot help, and this is how it
        // declines rather than injecting anyway: the floor is raised to two observations
        // for the duration of this request.
        ...(silenced ? { minEvidence: 2 } : {}),
        ...(this.tag === undefined ? {} : { tag: this.tag }),
      },
    );
    // An empty pack for a reason is not the same as an empty pack for no reason, and a
    // host that cannot tell them apart will read this silence as a retrieval failure.
    return silenced && pack.ids.length === 0
      ? { ...pack, suppressed: 'uncorroborated-store' as const }
      : pack;
  }

  /** Whether the configured floor silences this store, cached per knowledge version. */
  private async cannotCorroborate(): Promise<boolean> {
    if (this.corroborationFloor === undefined) return false;
    const cached = this.corroborationCache;
    if (cached !== undefined && cached.version === this.knowledgeVersion) {
      return cached.share < this.corroborationFloor;
    }
    const { share } = await this.corroboration();
    this.corroborationCache = { version: this.knowledgeVersion, share };
    return share < this.corroborationFloor;
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
    // A run from another namespace is not this host's to annotate. Without this the
    // event would be written under *this* namespace while citing a foreign run id,
    // and the next distillation would read that run through this tenant's
    // interpreter — one workspace's content becoming another's knowledge, which is
    // the boundary `putRun` already guards at the write end.
    if (run.namespace !== this.namespace) {
      throw new MicrogliaError('MG_E_NAMESPACE_MISMATCH', 'Feedback cites a run from another namespace', {
        expected: this.namespace,
        actual: run.namespace,
        runId: run.id,
      });
    }
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
    // The corroboration share can only change when knowledge changes, and feedback is
    // the first half of that: it may not add a rule yet, but the next distillation will.
    this.knowledgeVersion += 1;
    return event;
  }

  /**
   * Curate the store: merge what is the same, optionally retire what is useless.
   *
   * Deterministic and dry-runnable, because a curated store has to be comparable
   * with an uncurated one. Pruning is off unless asked: a rule with no observed
   * outcome is unmeasured, not useless.
   */
  public async curate(options: CurationOptions = {}): Promise<CurationReport> {
    this.assertOpen();
    const report = await curateKnowledge(this.store, this.policy, this.clock.now(), {
      namespace: this.namespace,
      ...options,
    });
    // Curation retires items, and a retired rule cannot corroborate anything - so the
    // cached share is stale even when nothing was written.
    this.knowledgeVersion += 1;
    return report;
  }

  /**
   * Erase the records a selector covers, then re-derive what cited them.
   *
   * The namespace is not a parameter: it is the facade's, always. An `actorHash`
   * alone would otherwise erase that person in every tenant the store holds, and
   * a deletion request that reaches further than the request did is a worse bug
   * than the data it was meant to remove.
   */
  public async forget(selector: ErasureSelector = {}): Promise<ErasureReport> {
    this.assertOpen();
    const report = await this.store.forget(
      { ...selector, namespace: this.namespace },
      this.policy,
      this.clock.now(),
    );
    this.knowledgeVersion += 1;
    return report;
  }

  public async distill(
    options: {
      since?: number;
      limit?: number;
      generalize?: boolean;
      resolveContradictions?: boolean;
      /**
       * Veto a claim before it is stored.
       *
       * A host-level filter, not a policy: the rule that a procedure may not name a table is a
       * property of what this store is for, and a prompt that asks for it is a request rather than
       * a guarantee.
       */
      accept?: (candidate: DistillCandidate) => boolean;
      /**
       * Which interpreter failures are about the run rather than the event.
       *
       * Forwarded rather than decided here: the interpreter is the host's own code, so the host
       * is the only layer that can recognise a spent budget or an expired deadline coming back
       * out of it.
       */
      fatal?: (error: unknown) => boolean;
    } = {},
  ): Promise<DistillReport> {
    this.assertOpen();
    const report = await distillLog({
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
      ...(options.accept === undefined ? {} : { accept: options.accept }),
      ...(options.fatal === undefined ? {} : { fatal: options.fatal }),
    });
    this.knowledgeVersion += 1;
    return report;
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

  /**
   * How much of this workspace has been told the same thing twice.
   *
   * The measurement that decides whether the mechanism can help at all, made available
   * before anyone turns the pack on: on the workloads measured here the share and the
   * effect move together, and a share near zero means the corrections do not recur, so a
   * pack built from them is noise. Cheap — one pass over the knowledge, no model call.
   */
  public async corroboration(): Promise<{
    readonly active: number;
    readonly corroborated: number;
    readonly share: number;
  }> {
    this.assertOpen();
    const items = await this.store.listKnowledge({ namespace: this.namespace, status: 'all' });
    return corroborationShare(
      items.map((item) => ({ status: item.status, observations: observationsOf(item) })),
    );
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
