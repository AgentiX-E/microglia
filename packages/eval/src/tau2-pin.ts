/**
 * Freezing the store, so that two arms can differ by one variable.
 *
 * R90's readback named a defect that had been present since the first correction arm and had been
 * invisible because every arm changed something at the same time: **the store is built from whichever
 * learn tasks failed**, the learn half is one trial per task, and one trial of a sampled model is a
 * draw. R89 wrote 12 corrections from the retail learn half; R90 wrote 15 from the same 57 tasks at the
 * same one trial, and only 8 task ids survived in both. So R90's registration said "one variable" —
 * the guard — while two variables moved, and its `pass^4` of 0.6316 against R89's 0.7018 could not be
 * attributed to either. The intervals overlapped; the arithmetic did not settle it.
 *
 * The fix is not statistical. A correction's *content* is a function of the task and nothing else:
 * `taskCorrection` reads `evaluation_criteria.actions`, which is data the corpus publishes. The only
 * thing the learn half decides is **which tasks taught a lesson**, and that is a list. Pin the list and
 * the store is deterministic — same 15 records, same 172 values, same 1,825-character mean pack — and a
 * run that skips the learn half costs 57 episodes less than one that rebuilds it.
 *
 * ## Why a pinned list rather than a pinned document
 *
 * The obvious alternative is to store the previous run's `learn.json` and feed it back. It is 57
 * simulations, the artefact that carries it is 20 MB, and every field in it except `id` and `reward` is
 * ignored by the write. A list of ids is small enough to read in a diff, which matters because the list
 * *is* the treatment: a reviewer can see the store a registration prices without running anything.
 *
 * ## What this module refuses
 *
 * A pin whose ids are not in the corpus is an error, not a warning. An id that silently misses makes
 * the store smaller than the registration says while every counter downstream still reads as a
 * measurement — the same failure mode as a percentage computed on an unstated denominator. The module
 * also refuses to pin a distiller that reads traces: a trace arm's corrections are written from an
 * attempt this lane would no longer have, so the pin would be a store built from evidence that does not
 * exist. Both refusals are `L4ParseError`s carrying a reason a run can print.
 */
import { L4ParseError } from './l4.js';
import { parseTauTasks, type TauTask } from './tau2.js';

/** The failures a store is rebuilt from, and where they were read. */
export type StorePin = {
  /** The arm the list came from, for the artefact's own provenance line. */
  readonly source: string;
  /** Qualified task ids (`retail/15`), so a list can be audited without the driver's split in hand. */
  readonly failures: readonly string[];
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Read a pin document.
 *
 * `{"source": "...", "failures": ["retail/15", ...]}`. The source is optional and defaults to a
 * sentence rather than to an empty string, because an artefact that says its store was pinned and not
 * *what* it was pinned to cannot be audited at all.
 */
export function parseStorePin(document: unknown): StorePin {
  const record = asRecord(document);
  if (record === undefined) {
    throw new L4ParseError('unreadable-json', 'a store pin is not an object');
  }
  const raw = record['failures'];
  if (!Array.isArray(raw)) {
    throw new L4ParseError('missing-tasks', 'a store pin has no `failures` array');
  }
  if (raw.length === 0) {
    throw new L4ParseError('bad-entry', 'a store pin names no failures: an empty store is not a pin');
  }
  const failures: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string' || entry.length === 0) {
      throw new L4ParseError('bad-entry', 'a store pin names a failure that is not a task id');
    }
    // Duplicates are refused rather than deduplicated: two entries for one task is a list somebody
    // edited by hand, and the count is what the store's size is read against.
    if (failures.includes(entry)) {
      throw new L4ParseError('bad-entry', `a store pin names ${entry} twice`);
    }
    failures.push(entry);
  }
  const source = typeof record['source'] === 'string' && record['source'].length > 0
    ? record['source']
    : 'an arm this pin does not name';
  return { source, failures };
}

/**
 * Wrap a τ² corpus into the shape `parseTauTasks` reads.
 *
 * Upstream publishes a bare list at `data/tau2/domains/<domain>/tasks.json` and writes a `{tasks: [...]}`
 * document at run time. Both carry the same entries, so the wrapper is the whole difference and the
 * refusal is for the third possibility — a file that is neither.
 */
export function tasksDocumentOf(corpus: unknown): { readonly tasks: readonly unknown[] } {
  if (Array.isArray(corpus)) return { tasks: corpus };
  const record = asRecord(corpus);
  const tasks = record?.['tasks'];
  if (Array.isArray(tasks)) return { tasks };
  throw new L4ParseError(
    'missing-tasks',
    'the task corpus is neither a bare list nor a document with a `tasks` array',
  );
}

/**
 * The rewards a pinned list implies: a named failure scores zero, everything else passes.
 *
 * The threshold is τ²'s own — an episode either satisfies the criteria or it does not — and pinning
 * cannot express partial credit, which is why a pin is refused for a corpus scored on one. The
 * unknown-id check is the reason this is a function rather than a `map.set` at the call site: a typo in
 * a hand-edited list would otherwise shrink the store while every counter still read as measured.
 */
export function pinRewards(
  tasks: readonly TauTask[],
  failures: readonly string[],
): ReadonlyMap<string, number> {
  const known = new Set(tasks.map((task) => task.id));
  const unknown = failures.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new L4ParseError(
      'bad-entry',
      `a store pin names ${String(unknown.length)} task(s) this corpus does not hold: ${unknown.slice(0, 3).join(', ')}`,
    );
  }
  const failed = new Set(failures);
  return new Map(tasks.map((task) => [task.id, failed.has(task.id) ? 0 : 1]));
}

/** The tasks a pin applies to, the rewards it implies, and the pin itself for the artefact. */
export type PinnedLearn = {
  readonly tasks: readonly TauTask[];
  readonly rewards: ReadonlyMap<string, number>;
  readonly pin: StorePin;
  /** How many of the pinned failures this split actually holds, which is what the store is sized on. */
  readonly failures: number;
};

/**
 * Build the learn half from a corpus and a pin, without running a single episode.
 *
 * `split` is the train half the plan already decided; a pin entry outside it is dropped rather than
 * refused, because a registration may legitimately pin a list drawn against a wider corpus and the
 * question it asks is about the tasks this run learns from. The count that matters is returned.
 */
export function pinnedLearn(
  corpus: unknown,
  pin: StorePin,
  split: readonly string[],
  domain: string,
): PinnedLearn {
  const tasks = parseTauTasks(tasksDocumentOf(corpus));
  const inSplit = new Set(split);
  const qualifying = tasks.filter((task) => inSplit.has(task.id));
  if (qualifying.length === 0) {
    throw new L4ParseError(
      'missing-tasks',
      `the corpus holds none of the ${String(split.length)} task(s) this split learns from`,
    );
  }
  const prefix = `${domain}/`;
  const local = pin.failures.map((id) => (id.startsWith(prefix) ? id.slice(prefix.length) : id));
  // Priced against the whole corpus, so a misspelled id is an error rather than a smaller store; the
  // split is applied afterwards, so an entry for a task this run does not learn from is simply not part
  // of the learn half.
  const scored = pinRewards(tasks, local);
  // Filtered rather than re-derived: `pinRewards` returns a reward for every task in the corpus, so the
  // split's half is a subset of it and there is no key this map can be missing.
  const rewards = new Map([...scored].filter(([id]) => inSplit.has(id)));
  const failures = local.filter((id) => inSplit.has(id)).length;
  return { tasks: qualifying, rewards, pin, failures };
}
