/**
 * Append-only journal.
 *
 * Two implementations ship: an in-memory one for tests and ephemeral hosts, and
 * a JSONL directory for the embedded case. Neither is a database. The contract
 * is deliberately narrow so a host that already runs Postgres or Cortex can
 * supply its own without changing anything above this layer.
 *
 * Knowledge is written as full snapshots rather than deltas: a snapshot is
 * idempotent, survives a torn append better than a partial patch, and makes
 * `compact()` a filter rather than a replay engine.
 */
import { MicrogliaError } from '../kernel/index.js';
import type { ErasureTombstone, FeedbackEvent, KnowledgeItem, RunRecord } from '../kernel/index.js';
import { mkdir, open, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export type JournalSnapshot = {
  readonly events: readonly FeedbackEvent[];
  readonly runs: readonly RunRecord[];
  readonly knowledge: readonly KnowledgeItem[];
};

export interface Journal {
  load(): Promise<JournalSnapshot>;
  appendEvent(event: FeedbackEvent): Promise<void>;
  appendRun(run: RunRecord): Promise<void>;
  writeKnowledge(item: KnowledgeItem): Promise<void>;
  /**
   * Replace the stored log with exactly this snapshot.
   *
   * Erasure is the one operation a delta cannot express: a deleted row has no
   * patch. Rewriting is therefore part of the journal contract rather than a
   * host concern, and `load()` must return the rewritten state afterwards.
   */
  rewrite(snapshot: JournalSnapshot): Promise<void>;
  /** Record that an erasure happened, never what it contained. */
  appendErasure(tombstone: ErasureTombstone): Promise<void>;
  close(): Promise<void>;
}

export class MemoryJournal implements Journal {
  private events: FeedbackEvent[] = [];
  private runs: RunRecord[] = [];
  private knowledge = new Map<string, KnowledgeItem>();
  private readonly erasures: ErasureTombstone[] = [];

  public load(): Promise<JournalSnapshot> {
    return Promise.resolve({
      events: [...this.events],
      runs: [...this.runs],
      knowledge: [...this.knowledge.values()],
    });
  }

  public appendEvent(event: FeedbackEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }

  public appendRun(run: RunRecord): Promise<void> {
    this.runs.push(run);
    return Promise.resolve();
  }

  public writeKnowledge(item: KnowledgeItem): Promise<void> {
    this.knowledge.set(item.id, item);
    return Promise.resolve();
  }

  public rewrite(snapshot: JournalSnapshot): Promise<void> {
    this.events = [...snapshot.events];
    this.runs = [...snapshot.runs];
    this.knowledge = new Map(snapshot.knowledge.map((item) => [item.id, item]));
    return Promise.resolve();
  }

  public appendErasure(tombstone: ErasureTombstone): Promise<void> {
    // Held in memory for the same reason the log is: a test can assert the
    // tombstone exists without a directory on disk.
    this.erasures.push(tombstone);
    return Promise.resolve();
  }

  public close(): Promise<void> {
    return Promise.resolve();
  }
}

export type JsonlJournalOptions = {
  /** Directory holding `events.jsonl`, `runs.jsonl`, `knowledge.jsonl`. */
  readonly dir: string;
  /** Rewrite the knowledge file on open to drop superseded snapshots. */
  readonly compactOnOpen?: boolean;
};

export class JsonlJournal implements Journal {
  private readonly dir: string;
  private readonly compactOnOpen: boolean;
  private queue: Promise<void> = Promise.resolve();
  private opened = false;

  public constructor(options: JsonlJournalOptions) {
    if (!options.dir) {
      throw new MicrogliaError('MG_E_CONFIG', 'JsonlJournal requires a directory');
    }
    this.dir = options.dir;
    this.compactOnOpen = options.compactOnOpen ?? false;
  }

  public async load(): Promise<JournalSnapshot> {
    await mkdir(this.dir, { recursive: true });
    this.opened = true;
    const events = await readLines<FeedbackEvent>(join(this.dir, 'events.jsonl'), 'events');
    const runs = await readLines<RunRecord>(join(this.dir, 'runs.jsonl'), 'runs');
    const knowledgeLines = await readLines<KnowledgeItem>(
      join(this.dir, 'knowledge.jsonl'),
      'knowledge',
    );
    const latest = new Map<string, KnowledgeItem>();
    for (const item of knowledgeLines) latest.set(item.id, item);
    if (this.compactOnOpen && knowledgeLines.length > latest.size) {
      await this.rewriteKnowledge([...latest.values()]);
    }
    return { events, runs, knowledge: [...latest.values()] };
  }

  public appendEvent(event: FeedbackEvent): Promise<void> {
    return this.enqueue('events.jsonl', event);
  }

  public appendRun(run: RunRecord): Promise<void> {
    return this.enqueue('runs.jsonl', run);
  }

  public writeKnowledge(item: KnowledgeItem): Promise<void> {
    return this.enqueue('knowledge.jsonl', item);
  }

  public rewrite(snapshot: JournalSnapshot): Promise<void> {
    return this.enqueueRewrite(snapshot);
  }

  public appendErasure(tombstone: ErasureTombstone): Promise<void> {
    return this.enqueue('erasures.jsonl', tombstone);
  }

  public async close(): Promise<void> {
    await this.queue;
    this.opened = false;
  }

  private enqueue(file: string, value: unknown): Promise<void> {
    this.queue = this.queue.then(async () => {
      if (!this.opened) {
        throw new MicrogliaError('MG_E_NOT_OPEN', 'Journal is not open');
      }
      const handle = await open(join(this.dir, file), 'a');
      try {
        await handle.write(`${JSON.stringify(value)}\n`);
        // fsync per record: losing a feedback event on crash costs more than a
        // system call, and the volume is tens per minute, not thousands.
        await handle.sync();
      } finally {
        await handle.close();
      }
    });
    return this.queue;
  }

  private enqueueRewrite(snapshot: JournalSnapshot): Promise<void> {
    this.queue = this.queue.then(async () => {
      if (!this.opened) {
        throw new MicrogliaError('MG_E_NOT_OPEN', 'Journal is not open');
      }
      await this.replace(journalPath(this.dir, 'events'), snapshot.events);
      await this.replace(journalPath(this.dir, 'runs'), snapshot.runs);
      await this.replace(journalPath(this.dir, 'knowledge'), snapshot.knowledge);
    });
    return this.queue;
  }

  private async replace(target: string, rows: readonly unknown[]): Promise<void> {
    const temp = `${target}.tmp`;
    // One file at a time, each renamed into place: a crash between the two
    // leaves a store that has erased the events but not the knowledge, which
    // the next `forget` re-derives from the same selector rather than losing data.
    await writeFile(temp, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length === 0 ? '' : '\n'), 'utf8');
    await rename(temp, target);
  }

  private async rewriteKnowledge(items: readonly KnowledgeItem[]): Promise<void> {
    const target = join(this.dir, 'knowledge.jsonl');
    const temp = `${target}.tmp`;
    await writeFile(temp, items.map((item) => JSON.stringify(item)).join('\n') + '\n', 'utf8');
    await rename(temp, target);
  }
}

async function readLines<T>(path: string, label: string): Promise<T[]> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new MicrogliaError('MG_E_STORE_IO', `Cannot read ${label}`, {
      path,
      cause: String(error),
    });
  }
  const out: T[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line || line.trim() === '') continue;
    try {
      out.push(JSON.parse(line) as T);
    } catch (error) {
      // A corrupt line is reported with its number rather than skipped: silently
      // dropping feedback would make the flywheel quietly lossy.
      throw new MicrogliaError('MG_E_STORE_CORRUPT', `Invalid JSON in ${label}`, {
        path,
        line: i + 1,
        cause: String(error),
      });
    }
  }
  return out;
}

/** Exposed for hosts that keep their journal elsewhere and only need the path helper. */
export function journalPath(dir: string, file: 'events' | 'runs' | 'knowledge'): string {
  return join(dir, `${file}.jsonl`);
}

/** Ensure a parent directory exists before a host writes alongside the journal. */
export async function ensureParent(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
}
