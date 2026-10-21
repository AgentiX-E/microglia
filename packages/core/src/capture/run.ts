/**
 * A run handle.
 *
 * The handle owns one generation attempt and its feedback. It is not a builder:
 * `complete()` writes the run exactly once, and feedback after that point is
 * attributed to the same immutable record. Making the run immutable is what
 * lets a correction cite the output it corrected, years later.
 */
import { MicrogliaError, redactJson } from '../kernel/index.js';
import type { FeedbackEvent, Json, JsonObject, RunRecord } from '../kernel/index.js';
import type { FeedbackInput, FeedbackOptions, RunStart } from './options.js';
import { assertJsonOutput } from './normalize.js';

export interface RunHost {
  readonly namespace: string;
  readonly app: string;
  nextId(prefix: string): string;
  now(): number;
  persistRun(run: RunRecord): Promise<void>;
  recordFeedback(
    run: RunRecord,
    input: FeedbackInput,
    options?: FeedbackOptions,
  ): Promise<FeedbackEvent>;
}

export class RunHandle {
  public readonly id: string;
  public readonly task: string;
  public readonly at: number;
  public readonly sessionId: string;

  private readonly host: RunHost;
  private readonly start: RunStart;
  private output: Json | undefined;
  private committed: RunRecord | undefined;
  private composedProvenance: RunRecord['provenance'];

  public constructor(host: RunHost, start: RunStart) {
    if (!start.task || start.task.length > 120) {
      throw new MicrogliaError('MG_E_CONFIG', 'Run task must be 1..120 characters');
    }
    this.host = host;
    this.start = start;
    this.task = start.task;
    this.id = host.nextId('run');
    this.at = host.now();
    this.sessionId = start.sessionId ?? 'default';
    this.composedProvenance = this.buildProvenance();
  }

  public get record(): RunRecord | undefined {
    return this.committed;
  }

  /** Persist the generated output. Idempotence is enforced, not implied. */
  public async complete(output: Json, meta?: JsonObject): Promise<RunRecord> {
    if (this.committed) {
      throw new MicrogliaError('MG_E_RUN_COMMITTED', 'Run has already been completed', {
        runId: this.id,
      });
    }
    assertJsonOutput(output);
    this.output = redactJson(output);
    const record: RunRecord = {
      schema: 'microglia.run/1',
      id: this.id,
      at: this.at,
      namespace: this.host.namespace,
      sessionId: this.sessionId,
      task: this.start.task,
      ...(this.start.taskId === undefined ? {} : { taskId: this.start.taskId }),
      ...(this.start.attempt === undefined ? {} : { attempt: this.start.attempt }),
      ...(this.start.parentRunId === undefined ? {} : { parentRunId: this.start.parentRunId }),
      input: redactJson(this.start.input) as JsonObject,
      output: this.output,
      provenance:
        meta === undefined
          ? this.composedProvenance
          : {
              ...this.composedProvenance,
              metadata: { ...(this.composedProvenance.metadata ?? {}), ...meta },
            },
      feedbackIds: [],
    };
    await this.host.persistRun(record);
    this.committed = record;
    return record;
  }

  public async feedback(
    input: FeedbackInput,
    options?: FeedbackOptions,
  ): Promise<FeedbackEvent> {
    if (!this.committed) {
      throw new MicrogliaError(
        'MG_E_NO_OUTPUT',
        'Call complete() before recording feedback; a correction must cite an output',
        { runId: this.id },
      );
    }
    return this.host.recordFeedback(this.committed, input, options);
  }

  /** A structural edit; the diff and distance are computed by the library. */
  public edit(after: Json, options?: FeedbackOptions & { note?: string }) {
    return this.feedback(
      { type: 'edit', after, ...(options?.note === undefined ? {} : { note: options.note }) },
      options,
    );
  }

  public rate(
    value: 'up' | 'down',
    reasons?: readonly string[],
    options?: FeedbackOptions & { comment?: string },
  ) {
    return this.feedback(
      {
        type: 'rating',
        value,
        ...(reasons === undefined ? {} : { reasons }),
        ...(options?.comment === undefined ? {} : { comment: options.comment }),
      },
      options,
    );
  }

  public outcome(ok: boolean, code?: string, detail?: string, options?: FeedbackOptions) {
    return this.feedback(
      {
        type: 'outcome',
        ok,
        ...(code === undefined ? {} : { code }),
        ...(detail === undefined ? {} : { detail }),
      },
      options,
    );
  }

  public clarify(question: string, answer: string, options?: FeedbackOptions) {
    return this.feedback({ type: 'clarification', question, answer }, options);
  }

  public abstain(reason: string, options?: FeedbackOptions) {
    return this.feedback({ type: 'abstain', reason }, options);
  }

  private buildProvenance(): RunRecord['provenance'] {
    const start = this.start;
    return {
      ...(start.model === undefined ? {} : { model: start.model }),
      ...(start.promptVersion === undefined ? {} : { promptVersion: start.promptVersion }),
      ...(start.appVersion === undefined ? {} : { appVersion: start.appVersion }),
      ...(start.domainPack === undefined ? {} : { domainPack: start.domainPack }),
      ...(start.schemaDigest === undefined ? {} : { schemaDigest: start.schemaDigest }),
      knowledgeIds: start.pack?.ids ?? [],
      ...(start.pack === undefined ? {} : { retrievalHash: start.pack.hash }),
      ...(start.metadata === undefined ? {} : { metadata: start.metadata }),
    };
  }
}
