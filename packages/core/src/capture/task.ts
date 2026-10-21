/**
 * A task instance.
 *
 * A run is one generation. A task is the job the user was trying to finish, and
 * it may take several generations: the first answer was wrong, the second was
 * edited, the third was accepted. Without this object the store can only diff
 * adjacent edits, which is why a correction learned from one edit recovers a
 * fraction of what stating the rule is worth.
 *
 * The handle owns three invariants and nothing else:
 *
 *   - an attempt number is used once, in order (a skip is a bug, not a choice);
 *   - a terminal decision happens once;
 *   - the decision becomes evidence, attached to the attempt it judges.
 */
import { MicrogliaError } from '../kernel/index.js';
import type { FeedbackEvent, RunRecord, TaskRecord, TaskStatus } from '../kernel/index.js';
import type {
  FeedbackInput,
  FeedbackOptions,
  RunStart,
  TaskDecision,
  TaskOpen,
} from './options.js';
import type { RunHandle } from './run.js';

export interface TaskHost {
  begin(start: RunStart): RunHandle;
  now(): number;
  recordFeedback(
    run: RunRecord,
    input: FeedbackInput,
    options?: FeedbackOptions,
  ): Promise<FeedbackEvent>;
}

/** What `begin` accepts: a run minus the fields the task supplies. */
export type AttemptStart = Omit<RunStart, 'task' | 'taskId' | 'sessionId'> & {
  readonly attempt: number;
};

const MAX_NAME = 120;

export class TaskHandle {
  public readonly id: string;
  public readonly taskType: string;

  private readonly host: TaskHost;
  private readonly openedAt: number;
  private readonly sessionId: string | undefined;
  private readonly attempts = new Set<number>();
  private readonly runs: RunHandle[] = [];
  private closed: TaskRecord | undefined;

  public constructor(host: TaskHost, open: TaskOpen, openedAt: number) {
    if (open.taskId.trim() === '' || open.taskId.length > MAX_NAME) {
      throw new MicrogliaError('MG_E_CONFIG', 'Task id must be 1..120 characters', {
        taskId: open.taskId,
      });
    }
    if (open.taskType.trim() === '' || open.taskType.length > MAX_NAME) {
      throw new MicrogliaError('MG_E_CONFIG', 'Task type must be 1..120 characters', {
        taskType: open.taskType,
      });
    }
    this.host = host;
    this.id = open.taskId;
    this.taskType = open.taskType;
    this.sessionId = open.sessionId;
    this.openedAt = openedAt;
  }

  /** The decision, once taken. Undefined while the task is open. */
  public get record(): TaskRecord | undefined {
    return this.closed;
  }

  /** The attempts opened so far, in order. */
  public get attemptCount(): number {
    return this.attempts.size;
  }

  /**
   * Open the next attempt.
   *
   * The number must be exactly one greater than the last: a reuse would overwrite
   * a generation the user may still need to cite, and a skip would hide one.
   */
  public begin(start: AttemptStart): RunHandle {
    this.assertOpen();
    if (!Number.isInteger(start.attempt) || start.attempt < 1) {
      throw new MicrogliaError('MG_E_CONFIG', 'Attempt must be an integer of at least 1', {
        attempt: start.attempt,
      });
    }
    const expected = this.attempts.size + 1;
    if (start.attempt !== expected) {
      throw new MicrogliaError(
        'MG_E_TASK_CONFLICT',
        `Attempt ${start.attempt} cannot follow attempt ${this.attempts.size}`,
        { taskId: this.id, expected, received: start.attempt },
      );
    }
    const { attempt, ...rest } = start;
    const run = this.host.begin({
      ...rest,
      task: this.taskType,
      taskId: this.id,
      attempt,
      ...(this.sessionId === undefined ? {} : { sessionId: this.sessionId }),
    });
    this.attempts.add(attempt);
    this.runs.push(run);
    return run;
  }

  /**
   * Close the task with a decision.
   *
   * Accepting is positive evidence for whatever the final attempt cited;
   * abandoning and escalating are not. The event is written once, so a retried
   * call cannot double-count a task.
   */
  public async complete(decision: TaskDecision): Promise<TaskRecord> {
    this.assertOpen();
    const final = this.finalRun(decision.finalRunId);
    const committed = final.record;
    if (committed === undefined) {
      throw new MicrogliaError(
        'MG_E_NO_OUTPUT',
        'The final attempt has no output; complete it before deciding the task',
        { taskId: this.id, runId: final.id },
      );
    }
    await this.host.recordFeedback(committed, {
      type: 'outcome',
      ok: decision.status === 'accepted',
      code: decision.reasonCode ?? decision.status,
    });
    const record: TaskRecord = {
      schema: 'microglia.task/1',
      taskId: this.id,
      taskType: this.taskType,
      namespace: committed.namespace,
      ...(this.sessionId === undefined ? {} : { sessionId: this.sessionId }),
      attempts: this.attempts.size,
      status: decision.status,
      finalRunId: final.id,
      ...(decision.reasonCode === undefined ? {} : { reasonCode: decision.reasonCode }),
      openedAt: this.openedAt,
      closedAt: this.host.now(),
    };
    this.closed = record;
    return record;
  }

  private finalRun(runId: string | undefined): RunHandle {
    if (runId === undefined) {
      const last = this.runs[this.runs.length - 1];
      if (last === undefined) {
        throw new MicrogliaError('MG_E_NO_OUTPUT', 'Task has no attempt to decide', {
          taskId: this.id,
        });
      }
      return last;
    }
    const match = this.runs.find((run) => run.id === runId);
    if (match === undefined) {
      throw new MicrogliaError('MG_E_CONFIG', 'finalRunId is not an attempt of this task', {
        taskId: this.id,
        runId,
      });
    }
    return match;
  }

  private assertOpen(): void {
    if (this.closed !== undefined) {
      throw new MicrogliaError('MG_E_TASK_CLOSED', 'Task already has a terminal decision', {
        taskId: this.id,
        status: this.closed.status,
      });
    }
  }
}

/** Re-exported so a host can name the decision's status without importing the kernel. */
export type { TaskStatus };

/** Convenience: the shape a host stores next to its own task row. */
export type TaskSummary = {
  readonly taskId: string;
  readonly taskType: string;
  readonly attempts: number;
  readonly status: TaskStatus | 'open';
  readonly finalRunId?: string;
};
