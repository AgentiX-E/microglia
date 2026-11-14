/**
 * What a store dump says about the side each record came from.
 *
 * ## Why the side is read and not guessed
 *
 * The retrospection lane consolidates *corrections* into guidelines. A store that cannot say
 * which records came from a correction therefore cannot feed it, and every earlier dump on this
 * lane was exactly that store: `kind` is what the distiller's model chose to write, not which side
 * of a run the record came from, so a mapping from `kind` to a side is a guess. It is worse than a
 * guess: τ²'s distiller writes `exemplar` for a correction and for a success alike, so the mapping
 * that read `exemplar` and `procedure` as successes read **every real record** as one, and the
 * pipeline refused to build a batch rather than reporting a store of pure failures.
 *
 * The field that fixes it is `polarity` on the item, written by the distiller from the event's own
 * signal — see `polarityFor` in the core. This module reads it, counts what it could not read, and
 * refuses to invent the rest.
 *
 * ## Two instruments, and what the check between them is worth
 *
 * The artefact also carries R62's `provenance` census, which attributes each item to the teaching
 * records behind it by joining `EvidenceRef.runId`. That is a second, independent read of the same
 * fact, and `reconcileSides` compares them.
 *
 * The comparison is honest about its own strength: for a fully labelled store the arithmetic holds
 * by construction, because the field's two populations partition the items and the census's three
 * do too. What it actually tests is the **inequality** — the field may not record fewer repairs
 * than the join knows about — and the **count** — both instruments must be describing the same
 * store. A side that reads a correction as a success fails the first; a dump capped by
 * `storeItems.limit`, or an artefact paired with the wrong store, fails the second. Those are the
 * two ways this field can silently go wrong.
 */
import type { RetrospectSource } from '@agentix-e/microglia-core/retrospect';
import type { ProvenanceCensus } from './tau2-provenance.js';

/**
 * One record as a dump carries it.
 *
 * Every field is optional because this is untrusted JSON from a file: a store written by an older
 * build has no `polarity`, a hand-built fixture may have no `scope`, and a record missing an id or
 * a statement cannot be used at all. The reader counts each of those cases separately rather than
 * filling them in.
 */
export type StoreDumpItem = {
  readonly id?: string;
  readonly kind?: string;
  /** The side the distiller recorded, absent on every dump written before the field existed. */
  readonly polarity?: 'repair' | 'pass';
  readonly statement?: string;
  readonly when?: string;
  readonly confidence?: number;
  readonly trust?: number;
  readonly createdAt?: number;
  /**
   * The store's own scope, as the sample carried it.
   *
   * Every dimension is optional because the sample is a projection: a dump written before the
   * scope census existed carried task, domain and intent only. A reader that fills in an unlisted
   * dimension has invented the value it was asked for — see `scopeCensus`, which refuses rather
   * than defaults when it is not told what the dump carried.
   */
  readonly scope?: {
    readonly task?: string;
    readonly domain?: string;
    readonly schemaDigest?: string;
    readonly intent?: string;
    readonly field?: string;
    readonly reasonCode?: string;
  };
};

/** The store a document carries, and how much of it the document left out. */
export type StoreDump = {
  readonly items: readonly StoreDumpItem[];
  /**
   * Records the artefact's sample did not carry.
   *
   * `storeItems` is capped by `limit`, so a dump of a large store is a sample of it. That is fine
   * for reading sides and fatal for comparing against a census over the whole store, which is why
   * the number travels with the items instead of being rediscovered by a reader.
   */
  readonly omitted: number;
  /**
   * Which scope dimensions the dump's projection carried, when the writer said so.
   *
   * Absent on every dump written before R113, and absent is not "all of them": a projection that
   * kept `domain` and dropped `field` produces the same records as a store in which no record ever
   * declared a field. The scope census refuses rather than guesses when this is missing.
   */
  readonly scopeDims?: readonly string[];
};

export type StoreReading = {
  readonly total: number;
  /** The records a batch can be built from, in dump order. */
  readonly sources: readonly RetrospectSource[];
  readonly repairs: number;
  readonly passes: number;
  /** Records that carry no side. Not successes: unlabelled. */
  readonly unclassified: number;
  /** Records with no id or no statement, which no batch can cite. */
  readonly skipped: number;
};

function finite(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function sideOf(item: StoreDumpItem): 'repair' | 'pass' | undefined {
  return item.polarity === 'repair' || item.polarity === 'pass' ? item.polarity : undefined;
}

/**
 * Classify a dump's records by side.
 *
 * The two populations are separated here and only here: a pass record can contradict a guideline
 * and may never be used to write one, so a record whose side is unknown belongs to neither.
 */
export function readStoreDump(
  items: readonly StoreDumpItem[],
  fallbackTask: string,
): StoreReading {
  const sources: RetrospectSource[] = [];
  let unclassified = 0;
  let skipped = 0;
  for (const item of items) {
    if (typeof item.id !== 'string' || typeof item.statement !== 'string') {
      skipped += 1;
      continue;
    }
    const side = sideOf(item);
    if (side === undefined) {
      unclassified += 1;
      continue;
    }
    const scope = item.scope ?? {};
    const when = typeof item.when === 'string' && item.when.trim() !== '' ? item.when : undefined;
    sources.push({
      id: item.id,
      statement: item.statement,
      ...(when === undefined ? {} : { when }),
      task: scope.task ?? scope.domain ?? fallbackTask,
      // Distinct-task identity: the narrowest declared scope, the same convention the store's own
      // support counter uses.
      taskId: scope.intent ?? scope.domain ?? scope.task ?? item.id,
      outcome: side,
      confidence: finite(item.confidence) ?? finite(item.trust) ?? 0.5,
      at: finite(item.createdAt) ?? 0,
    });
  }
  return {
    total: items.length,
    sources,
    repairs: sources.filter((source) => source.outcome === 'repair').length,
    passes: sources.filter((source) => source.outcome === 'pass').length,
    unclassified,
    skipped,
  };
}

/**
 * Why a batch cannot be built, when it cannot.
 *
 * The sentence names which of the two causes it is, because they call for opposite fixes: an
 * all-success store is a run that taught nothing (change the population), and an unlabelled store
 * is a dump that cannot answer the question (change the dump). Reporting one silence for both is
 * how a store of pure repairs reads as a store of pure successes and a lane is closed for the
 * wrong reason.
 */
export function refusalOf(reading: StoreReading, from: string): string | undefined {
  if (reading.repairs > 0) return undefined;
  const counts =
    `${from} holds ${reading.total} record(s) and none of them is a repair: ` +
    `${reading.repairs} repair, ${reading.passes} pass, ${reading.unclassified} with no side recorded`;
  const skipped =
    reading.skipped === 0 ? '' : `; ${reading.skipped} could not be read (no id, or no statement)`;
  const why =
    reading.unclassified > 0
      ? '; the dump does not record which side each record came from, so an unlabelled store and an ' +
        'all-success store are the same reading'
      : '; every record that carries a side is a success, so the run distilled only successes and ' +
        'there is nothing to consolidate';
  return `${counts}${skipped}${why}`;
}

export type SideReconciliation = {
  readonly state: 'agree' | 'disagree' | 'unavailable';
  readonly sentence: string;
};

/**
 * Whether the store's own sides and the artefact's run-level census describe one store.
 *
 * Unavailable is not a soft pass. Each of the three reasons names a document that cannot support
 * the check: no census, a capped sample, or records the field cannot classify.
 */
export function reconcileSides(
  reading: StoreReading,
  options: {
    readonly census?: Pick<ProvenanceCensus, 'itemsEditedOnly' | 'itemsPassedOnly' | 'itemsMixed'>;
    readonly omitted?: number;
  },
): SideReconciliation {
  const census = options.census;
  if (census === undefined) {
    return {
      state: 'unavailable',
      sentence: 'the artefact carries no provenance census, so the sides have nothing to be checked against',
    };
  }
  const omitted = options.omitted ?? 0;
  if (omitted > 0) {
    return {
      state: 'unavailable',
      sentence: `the sample omits ${omitted} record(s), and a capped dump cannot be compared to a census over the whole store`,
    };
  }
  if (reading.unclassified > 0) {
    return {
      state: 'unavailable',
      sentence: `${reading.unclassified} record(s) carry no side, so the census counts items the store cannot attribute`,
    };
  }
  const items = census.itemsEditedOnly + census.itemsPassedOnly + census.itemsMixed;
  if (items !== reading.total) {
    return {
      state: 'disagree',
      sentence: `the two instruments disagree: the store holds ${reading.total} record(s) and the census accounts for ${items}`,
    };
  }
  if (reading.repairs < census.itemsEditedOnly || reading.passes < census.itemsPassedOnly) {
    return {
      state: 'disagree',
      sentence:
        `the two instruments disagree: the store records ${reading.repairs} repair(s) and ` +
        `${reading.passes} pass(es), and the census knows of ${census.itemsEditedOnly} and ` +
        `${census.itemsPassedOnly} — a side that reads a correction as something else is a mapping ` +
        'defect on the write path',
    };
  }
  return {
    state: 'agree',
    sentence:
      `${reading.repairs} repair(s) and ${reading.passes} pass(es) against the census's ` +
      `${census.itemsEditedOnly} edited-only, ${census.itemsPassedOnly} passed-only and ` +
      `${census.itemsMixed} mixed`,
  };
}

/**
 * Find the store inside a document.
 *
 * An l4 artefact nests it under `tau2.storeItems`; a bare dump is an array. A document with
 * neither is refused rather than read as an empty store, because an empty store and an artefact
 * that never wrote one produce the same batch: none.
 */
export function storeDumpItems(raw: unknown, from: string): StoreDump {
  const document = raw as Record<string, unknown> | null;
  const nested = (document?.['tau2'] as Record<string, unknown> | undefined)?.['storeItems'];
  for (const container of [document, nested]) {
    if (Array.isArray(container)) return { items: container as readonly StoreDumpItem[], omitted: 0 };
    const record = container as Record<string, unknown> | null | undefined;
    const items = record?.['items'];
    if (!Array.isArray(items)) continue;
    const omitted = record?.['omitted'];
    const dims = record?.['scopeDims'];
    return {
      items: items as readonly StoreDumpItem[],
      omitted: typeof omitted === 'number' && Number.isFinite(omitted) ? Math.max(0, omitted) : 0,
      // Carried as written when it is a list of strings, and dropped otherwise: a malformed
      // declaration is the same reading as no declaration, and a reader that repaired it would be
      // inventing the very boundary the field exists to state.
      ...(Array.isArray(dims) && dims.every((dim) => typeof dim === 'string')
        ? { scopeDims: dims as readonly string[] }
        : {}),
    };
  }
  throw new Error(`${from} is not a store dump: no item array found`);
}
