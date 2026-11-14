/**
 * Build a review batch from a store an experiment already wrote.
 *
 * Two refusals are deliberate. A store with no repair records produces no batch — a corpus of
 * successes has nothing to consolidate, and synthesising proposals from it is how a pass
 * record becomes a confident rule. A cluster whose members carry no condition produces no
 * proposal either, because a guideline's trigger is the intersection of its sources' and an
 * empty intersection is the one thing the witness will not accept.
 *
 * The proposals here are the **deterministic** ones: the shared trigger, the medoid's claim,
 * no model in the path. That is the arm as well as the fallback — if a model-written
 * guideline cannot beat a merge that copies a sentence, the model's contribution is the
 * selection rather than the prose, and the review console should be about grouping.
 */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  buildBatch,
  clusterSources,
  deterministicProposal,
  DEFAULT_CLUSTER_OPTIONS,
  DEFAULT_RETROSPECT_POLICY,
  summaryOf,
  type RetrospectSource,
} from '@agentix-e/microglia-core/retrospect';

type StoreItem = {
  readonly id?: string;
  readonly kind?: string;
  /** Per-item polarity, when the dump carries one. Neither τ² artefact does yet. */
  readonly polarity?: 'repair' | 'pass';
  readonly statement?: string;
  readonly when?: string;
  readonly confidence?: number;
  readonly trust?: number;
  readonly createdAt?: number;
  readonly scope?: { readonly task?: string; readonly domain?: string; readonly intent?: string };
};

function flag(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index < 0 ? undefined : argv[index + 1];
}

function numberFlag(argv: readonly string[], name: string, fallback: number): number {
  const raw = flag(argv, name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number, not '${raw}'`);
  return value;
}

/**
 * Polarity, from the field if the dump carries one and from `kind` if it does not.
 *
 * Neither artifact this lane has produced carries the field, and every record in both is an
 * `exemplar` — 15 of them distilled from corrections and 58 from successes. So the store knows
 * *how strong* each record's evidence is and not *which side* it came from, which is enough to
 * rank a pack and not enough to consolidate one. That is an instrumentation gap rather than a
 * missing feature here: the dump needs a per-item polarity, and until it has one a batch built
 * from a real artefact would call the whole store a success and refuse to run.
 */
function outcomeOf(item: StoreItem): 'repair' | 'pass' {
  if (item.polarity === 'repair' || item.polarity === 'pass') return item.polarity;
  return item.kind === 'exemplar' || item.kind === 'procedure' ? 'pass' : 'repair';
}

function sourcesFrom(items: readonly StoreItem[], fallbackTask: string): RetrospectSource[] {
  return items
    .filter((item): item is StoreItem & { id: string; statement: string } =>
      typeof item.id === 'string' && typeof item.statement === 'string',
    )
    .map((item) => {
      const scope = item.scope ?? {};
      const task = scope.task ?? scope.domain ?? fallbackTask;
      return {
        id: item.id,
        statement: item.statement,
        ...(item.when === undefined ? {} : { when: item.when }),
        task,
        // Distinct-task identity: the narrowest declared scope, as `sourcesOf` reads it.
        taskId: scope.intent ?? scope.domain ?? scope.task ?? item.id,
        outcome: outcomeOf(item),
        confidence: item.confidence ?? item.trust ?? 0.5,
        at: item.createdAt ?? 0,
      } satisfies RetrospectSource;
    });
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const from = flag(argv, '--from');
  const out = flag(argv, '--out');
  if (from === undefined || out === undefined) {
    throw new Error('usage: retrospect --from <artefact.json> --out <batch.json> [--threshold 0.6] [--min-sources 2]');
  }
  const raw = JSON.parse(await readFile(resolve(from), 'utf8')) as Record<string, unknown>;
  // An l4 artefact nests the store under `tau2.storeItems.items`; a bare dump is an array.
  const containers = [raw, (raw['tau2'] as Record<string, unknown> | undefined)?.['storeItems']];
  const items = containers
    .map((container) => {
      if (Array.isArray(container)) return container as StoreItem[];
      const nested = (container as Record<string, unknown> | undefined)?.['items'];
      return Array.isArray(nested) ? (nested as StoreItem[]) : undefined;
    })
    .find((candidate) => candidate !== undefined);
  if (items === undefined) throw new Error(`${from} is not a store dump: no item array found`);

  const sources = sourcesFrom(items, 'unknown');
  const repairs = sources.filter((source) => source.outcome === 'repair');
  if (repairs.length === 0) {
    const kinds = [...new Set(sources.length === 0 ? [] : items.map((item) => item.kind ?? '?'))].join(', ');
    throw new Error(
      `the store holds ${sources.length} record(s) and none of them is a repair (kinds: ${kinds}); ` +
        'nothing to consolidate. Either the run distilled only successes, or the dump carries no ' +
        'per-item polarity and every record reads as one — both are refusals rather than empty batches',
    );
  }

  const threshold = numberFlag(argv, '--threshold', DEFAULT_CLUSTER_OPTIONS.threshold);
  const policy = { ...DEFAULT_RETROSPECT_POLICY, minSources: numberFlag(argv, '--min-sources', 2) };
  const clusters = clusterSources(sources, { ...DEFAULT_CLUSTER_OPTIONS, threshold });
  const proposals = clusters.map(deterministicProposal);
  const batch = buildBatch({
    id: `retrospect-${Date.now().toString(36)}`,
    createdAt: Date.now(),
    namespace: String((raw['namespace'] as string | undefined) ?? 'microglia'),
    policy,
    corpus: sources,
    proposals,
  });

  await mkdir(dirname(resolve(out)), { recursive: true });
  await writeFile(resolve(out), `${JSON.stringify(batch, null, 1)}\n`, 'utf8');
  const summary = summaryOf(batch);
  process.stdout.write(
    [
      `store      ${sources.length} record(s): ${repairs.length} repair(s), ${sources.length - repairs.length} pass(es)`,
      `clusters   ${clusters.length} at threshold ${threshold}${clusters.length === 0 ? ' — no two repairs share a condition' : ''}`,
      `batch      ${out} (${summary.total} candidate(s))`,
      ...clusters.map((cluster) => {
        const item = batch.items.find((entry) => entry.proposal.id === `gp_${cluster.id.slice(3)}`);
        const verdict = item?.admissibility.state ?? 'absent';
        return `  ${cluster.id}  ${verdict.padEnd(12)} ${cluster.members.length} member(s), cohesion ${cluster.cohesion}  "${cluster.seedTrigger}"`;
      }),
    ].join('\n') + '\n',
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`retrospect: ${(error as Error).message}\n`);
  process.exitCode = 1;
});
