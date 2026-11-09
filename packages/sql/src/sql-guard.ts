/**
 * One statement, in a process that can be killed.
 *
 * Every model prediction in a benchmark lane is executed against a real database, and the statement
 * is arbitrary: a query the model wrote. SQLite will happily spend an hour proving that a three-way
 * cross join has 10^9 rows before returning the first one, and the driver is synchronous — so the
 * whole lane stops, no timer fires, no deadline check runs, and the process looks exactly like a
 * provider that stopped answering.
 *
 * That is not hypothetical. `41226847922`, the first dev-split dispatch, printed its last progress
 * line at 19:17:48 and then nothing for the 118 minutes until its step timeout; judging a fold takes
 * six minutes when the statements behave, and the fold before it took sixty-three.
 *
 * The only interruption available for a synchronous call is the death of the thread running it, and
 * this was measured before it was chosen: terminating a *worker thread* stuck inside the driver takes
 * 50.5 seconds, because V8 can only honour the interrupt when the native call returns, so a deadline
 * of one second still costs a minute. A child process can be killed with `SIGKILL` in 0 ms, and
 * spawning one costs 19 ms — cheaper than the difference between the two designs. So statements run
 * in child processes here, with two bounds:
 *
 *  - **a deadline.** The process is killed when it expires, and the statement is reported as
 *    `deadline: true` rather than as a wrong answer. A query that cannot answer in twenty seconds on
 *    a laptop-sized database is not an answer, but it is also not evidence about the model's
 *    knowledge, so it is counted apart and never folded into accuracy;
 *  - **a row cap.** The statement is wrapped in `SELECT * FROM (…) LIMIT cap + 1` so a runaway result
 *    set cannot exhaust memory on its way to being discarded. Truncation is reported too, because a
 *    truncated result is compared as a different answer and the reader deserves to know which side of
 *    the comparison was cut.
 *
 * A killed child is replaced on the next call: a child holds no state that outlives one statement,
 * which is what makes killing one of them safe.
 */
import { spawn, type ChildProcess } from 'node:child_process';

/**
 * The child program.
 *
 * Written as a source string because it must not be loaded through the bundler or the TypeScript
 * loader: a child that depends on a loader behaves differently under `tsx` than under `node`, and
 * the difference would appear only in the lane. Its own stderr is discarded by the spawn options, so
 * the driver's experimental warning does not end up in a benchmark's log.
 */
const CHILD_SOURCE = `
const { DatabaseSync } = require('node:sqlite');

// Booting a process and loading SQLite is instrument overhead, not statement time. Announcing
// readiness is what lets the parent start the deadline at the statement rather than at the spawn.
process.send({ ready: true });

process.on('message', (task) => {
  const started = Date.now();
  let db;
  try {
    db = new DatabaseSync(task.dbPath, { readOnly: true });
    // The cap is applied inside SQLite so the rows that are never read are never materialised. The
    // extra row is what distinguishes "exactly cap rows" from "more than cap rows".
    const rows = db.prepare('SELECT * FROM (' + task.body + ') LIMIT ' + (task.rowCap + 1)).all();
    const truncated = rows.length > task.rowCap;
    process.send({
      ok: true,
      rows: truncated ? rows.slice(0, task.rowCap) : rows,
      truncated,
      ms: Date.now() - started,
    });
  } catch (error) {
    process.send({ ok: false, error: String((error && error.message) || error), ms: Date.now() - started });
  } finally {
    try { if (db) db.close(); } catch (ignored) { /* the process is one statement long either way */ }
  }
});
`;

export type StatementResult = {
  /** Whether the statement produced a result set inside the deadline. */
  readonly ok: boolean;
  /** Rows, capped. Empty on failure. */
  readonly rows: readonly Record<string, unknown>[];
  /** Whether the cap was reached, so the rows are a prefix rather than the answer. */
  readonly truncated: boolean;
  /** Whether the deadline ended the statement. Exclusive of `ok`. */
  readonly deadline: boolean;
  /** The driver's message on failure, or the deadline's own, or undefined when it ran. */
  readonly error: string | undefined;
  /** Wall clock spent on this statement, including the wait for a free child. */
  readonly ms: number;
};

export type BoundedSqlOptions = {
  /** Wall clock one statement may take. Default 20 s: two orders of magnitude above a good query. */
  readonly deadlineMs?: number;
  /** Rows a statement may return before it is called truncated. Default 10,000. */
  readonly rowCap?: number;
  /** Statements in flight at once. Default 4. */
  readonly workers?: number;
};

type Reply =
  | { readonly ok: true; readonly rows: Record<string, unknown>[]; readonly truncated: boolean; readonly ms: number }
  | { readonly ok: false; readonly error: string; readonly ms: number };

type Slot = {
  readonly child: ChildProcess;
  /** Settles when the child is gone, whatever killed it. Killing a dead child is a no-op on it. */
  readonly exited: Promise<void>;
  /**
   * Settles when the child can answer, or when it dies trying.
   *
   * A deadline that starts before the child is ready measures the machine rather than the query:
   * a 250 ms deadline on a loaded box expired while `node` was still loading SQLite, and the
   * statement was reported as a deadline rather than as the answer it would have given. This
   * promise is what lets `#ask` start its clock at the statement.
   */
  readonly ready: Promise<void>;
  busy: boolean;
  dead: boolean;
};

const DEADLINE = 'statement deadline';
const EXITED = 'the statement process exited';

export class BoundedSql {
  readonly #deadlineMs: number;
  readonly #rowCap: number;
  readonly #width: number;
  readonly #slots: Slot[] = [];
  readonly #waiting: ((slot: Slot) => void)[] = [];
  #statements = 0;
  #deadlines = 0;
  #truncations = 0;
  #closed = false;

  constructor(options: BoundedSqlOptions = {}) {
    this.#deadlineMs = options.deadlineMs ?? 20_000;
    this.#rowCap = options.rowCap ?? 10_000;
    this.#width = Math.max(1, options.workers ?? 4);
  }

  /**
   * What the run has to report beside its scores.
   *
   * A deadline is not a wrong answer and a truncation is not a different query, so neither may be
   * folded into accuracy silently. These three numbers are the only record of how much of a lane's
   * score was decided by the instrument rather than by the model.
   */
  stats(): { statements: number; deadlines: number; truncations: number } {
    return { statements: this.#statements, deadlines: this.#deadlines, truncations: this.#truncations };
  }

  async run(dbPath: string, sql: string): Promise<StatementResult> {
    if (this.#closed) throw new Error('BoundedSql is closed');
    const started = performance.now();
    const body = sql.trim().replace(/;+\s*$/, '');
    if (body === '') {
      // An empty statement never reaches a child: it is a parse failure the lane counts, and paying
      // a process spawn to learn that would make every refused prediction cost 20 ms.
      this.#statements += 1;
      return { ok: false, rows: [], truncated: false, deadline: false, error: 'empty statement', ms: 0 };
    }
    const slot = await this.#acquire();
    this.#statements += 1;
    const reply = await this.#ask(slot, { dbPath, body, rowCap: this.#rowCap });
    if (reply === 'deadline') {
      this.#deadlines += 1;
      this.#retire(slot);
      return {
        ok: false,
        rows: [],
        truncated: false,
        deadline: true,
        error: `${DEADLINE} after ${this.#deadlineMs} ms`,
        ms: performance.now() - started,
      };
    }
    if (reply === 'exited') {
      this.#retire(slot);
      return {
        ok: false,
        rows: [],
        truncated: false,
        deadline: false,
        error: EXITED,
        ms: performance.now() - started,
      };
    }
    this.#release(slot);
    if (!reply.ok) {
      return {
        ok: false,
        rows: [],
        truncated: false,
        deadline: false,
        error: reply.error,
        ms: performance.now() - started,
      };
    }
    // The child already applied the cap; the check here is what keeps the invariant true if the
    // boundary changes on one side only.
    const truncated = reply.truncated || reply.rows.length > this.#rowCap;
    const rows = truncated ? reply.rows.slice(0, this.#rowCap) : reply.rows;
    if (truncated) this.#truncations += 1;
    return { ok: true, rows, truncated, deadline: false, error: undefined, ms: performance.now() - started };
  }

  /** Wait for a free child, spawning one while the pool is below its width. */
  #acquire(): Promise<Slot> {
    const free = this.#slots.find((slot) => !slot.busy && !slot.dead);
    if (free !== undefined) {
      free.busy = true;
      return Promise.resolve(free);
    }
    if (this.#slots.length < this.#width) {
      const slot = this.#spawn();
      slot.busy = true;
      this.#slots.push(slot);
      return Promise.resolve(slot);
    }
    return new Promise<Slot>((resolve) => {
      this.#waiting.push((slot) => {
        slot.busy = true;
        resolve(slot);
      });
    });
  }

  #spawn(): Slot {
    const child = spawn(process.execPath, ['-e', CHILD_SOURCE], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    // Recorded once, at birth, so `close` never has to ask whether a child is still alive: the
    // answer is a promise that is already settled if it is not.
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    const ready = new Promise<void>((resolve) => {
      // The child's first message is its readiness by construction: it sends `ready` before it
      // registers the statement handler, and `#ask` attaches its own listener only after this
      // promise settles, so no reply can be consumed here. Checking the payload instead would add
      // a branch no message can reach.
      const onReady = (): void => resolve();
      child.once('message', onReady);
      // A child that dies before it is ready must not leave a statement waiting on it.
      void exited.then(() => {
        child.off('message', onReady);
        resolve();
      });
    });
    return { child, exited, ready, busy: false, dead: false };
  }

  /**
   * Post one statement and wait for it, for the deadline, or for the process to die.
   *
   * The wait for readiness comes before the timer on purpose. A deadline is a statement about how
   * long an answer may take, and process startup is not part of the answer — counting it made a
   * 250 ms deadline on a loaded machine expire before the child had loaded SQLite.
   */
  async #ask(
    slot: Slot,
    task: { dbPath: string; body: string; rowCap: number },
  ): Promise<Reply | 'deadline' | 'exited'> {
    await slot.ready;
    return new Promise<Reply | 'deadline' | 'exited'>((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (value: Reply | 'deadline' | 'exited'): void => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        slot.child.off('message', onMessage);
        resolve(value);
      };
      const onMessage = (value: Reply): void => finish(value);
      timer = setTimeout(() => finish('deadline'), this.#deadlineMs);
      slot.child.on('message', onMessage);
      // Death is a third outcome and it has to win over the deadline. Without it, `close` — or a
      // child the runtime killed — leaves a statement waiting its full twenty seconds for an answer
      // that cannot come, which is how a shutdown that should be immediate costs a fold.
      void slot.exited.then(() => finish('exited'));
      // The callback rather than an `error` listener: a child that is already gone makes `send` fail
      // with EPIPE, which without a callback is an uncaught exception on a channel nobody is
      // watching, and the statement would then wait out its deadline instead of failing.
      //
      // This is the one branch in the repository that no test takes, and the reason is worth stating
      // rather than hiding behind a coverage percentage. It fires when the channel is gone between
      // `ready` and `send` — a child killed by the OOM killer, or by a host that ran out of file
      // descriptors. Every route to that state inside this process goes through `close()`, which
      // settles `exited` first and therefore resolves this statement on the line above instead; and
      // the child cannot be made to die before it is ready without a spawn seam, which would be a
      // mock of the very thing under test. `AUDIT 34.90` records the decision: the branch stays,
      // because the failure it handles is real and the alternative is an uncaught EPIPE.
      slot.child.send(task, (error) => {
        if (error !== null) finish({ ok: false, error: EXITED, ms: 0 });
      });
    });
  }

  #release(slot: Slot): void {
    slot.busy = false;
    const next = this.#waiting.shift();
    if (next !== undefined) next(slot);
  }

  /** Kill a child whose statement outlived its deadline, and hand the queue a fresh one. */
  #retire(slot: Slot): void {
    slot.dead = true;
    slot.busy = false;
    const index = this.#slots.indexOf(slot);
    if (index !== -1) this.#slots.splice(index, 1);
    slot.child.kill('SIGKILL');
    const next = this.#waiting.shift();
    if (next !== undefined && !this.#closed) {
      const replacement = this.#spawn();
      replacement.busy = true;
      this.#slots.push(replacement);
      next(replacement);
    }
  }

  async close(): Promise<void> {
    this.#closed = true;
    const slots = [...this.#slots];
    this.#slots.length = 0;
    for (const slot of slots) slot.child.kill('SIGKILL');
    await Promise.all(slots.map((slot) => slot.exited));
  }
}
