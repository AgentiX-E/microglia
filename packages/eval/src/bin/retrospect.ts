/**
 * Build a review batch from a store an experiment already wrote.
 *
 * Two refusals are deliberate. A corpus with no repair in it produces no batch — a corpus of
 * successes has nothing to consolidate, and synthesising proposals from it is how a pass record
 * becomes a confident rule. A cluster whose members carry no condition produces no proposal either,
 * because a guideline's trigger is the intersection of its sources' and an empty intersection is
 * the one thing the witness will not accept.
 *
 * The side of each record is **read from the store** (R110), not guessed from its kind. Until the
 * store carried `polarity`, this program mapped `exemplar` and `procedure` to successes, and every
 * record the τ² lane produces is one of those — so a store of pure repairs read as a store of pure
 * successes and the pipeline refused to run. The reader is in `retrospect-store.ts` and it counts
 * what it could not classify instead of filling the gap in.
 *
 * The proposals here are the **deterministic** ones: the shared trigger, the medoid's claim, no
 * model in the path. That is the arm as well as the fallback — if a model-written guideline cannot
 * beat a merge that copies a sentence, the model's contribution is the selection rather than the
 * prose, and the review console should be about grouping.
 */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  buildBatch,
  clusterCensusOf,
  clusterSources,
  deterministicProposal,
  DEFAULT_CLUSTER_OPTIONS,
  DEFAULT_RETROSPECT_POLICY,
  CHAIN_COHESION_FLOOR,
  summaryOf,
} from '@agentix-e/microglia-core/retrospect';
import type { ProvenanceCensus } from '../tau2-provenance.js';
import { readStoreDump, reconcileSides, refusalOf, storeDumpItems } from '../retrospect-store.js';
import { carriedDims, scopeCensus, universalityCensus } from '../scope-census.js';

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

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const from = flag(argv, '--from');
  const out = flag(argv, '--out');
  if (from === undefined || out === undefined) {
    throw new Error(
      'usage: retrospect --from <artefact.json> --out <batch.json> [--threshold 0.6] [--min-sources 2] ' +
        '[--carried domain,intent]',
    );
  }
  const raw = JSON.parse(await readFile(resolve(from), 'utf8')) as Record<string, unknown>;
  const dump = storeDumpItems(raw, from);
  const reading = readStoreDump(dump.items, 'unknown');
  // R113: how wide the rules are, read from the same dump and printed before the batch is built.
  // It refuses when the dump did not declare what it carried, and a refusal here is a reading of
  // the document rather than a fault in it — the batch below does not depend on the answer.
  // A dump written before R113 does not declare what it projected, and a reader that asked it would
  // be reading a silence as a list. The operator can state it instead, with a reason that is
  // auditable against the build that wrote the dump — `--carried domain` is a claim about a commit,
  // not an inference from the JSON.
  const carriedFlag = flag(argv, '--carried');
  const carried = carriedFlag === undefined ? carriedDims(dump.scopeDims) : carriedDims(carriedFlag.split(','));
  const scope = scopeCensus(dump.items, { carried });
  // The population every 2026 memory-harm result is about: a rule with no condition and no scope
  // dimension. Counted from the same dump, so the census and the batch describe one document.
  const universal = universalityCensus(dump.items, { carried });
  const refusal = refusalOf(reading, from);
  if (refusal !== undefined) throw new Error(`${refusal}. Nothing to consolidate.`);

  const threshold = numberFlag(argv, '--threshold', DEFAULT_CLUSTER_OPTIONS.threshold);
  const policy = { ...DEFAULT_RETROSPECT_POLICY, minSources: numberFlag(argv, '--min-sources', 2) };
  // R110: the store's own sides are checked against the artefact's run-level census **before** a
  // batch is written, because the two are independent reads of one fact and a disagreement means one
  // of them is wrong — a wrong side is a wrong corpus, and a corpus is what the reviewer is shown.
  // `unavailable` is not a refusal: a document that cannot support the comparison is not a document
  // that contradicts itself.
  const runCensus = (raw['tau2'] as Record<string, unknown> | undefined)?.['provenance'] as
    | ProvenanceCensus
    | undefined;
  const sides = reconcileSides(reading, {
    ...(runCensus === undefined ? {} : { census: runCensus }),
    omitted: dump.omitted,
  });
  if (sides.state === 'disagree') throw new Error(`refusing the batch: ${sides.sentence}`);

  const repairs = reading.sources.filter((source) => source.outcome === 'repair');
  const clusters = clusterSources(repairs, { ...DEFAULT_CLUSTER_OPTIONS, threshold });
  const proposals = clusters.map(deterministicProposal);
  // The M1 reading, taken from the same objects the batch is built from rather than recomputed by a
  // reader: fragmentation is the share of repairs no cluster reached, which is where lexical
  // clustering's known cost shows up, and `chained` counts the clusters single-link pulled together.
  const census = clusterCensusOf(reading.sources, clusters, CHAIN_COHESION_FLOOR);
  const batch = buildBatch({
    id: `retrospect-${Date.now().toString(36)}`,
    createdAt: Date.now(),
    namespace: String((raw['namespace'] as string | undefined) ?? 'microglia'),
    policy,
    corpus: reading.sources,
    proposals,
    census,
  });

  await mkdir(dirname(resolve(out)), { recursive: true });
  await writeFile(resolve(out), `${JSON.stringify(batch, null, 1)}\n`, 'utf8');
  const summary = summaryOf(batch);
  process.stdout.write(
    [
      `store      ${reading.total} record(s): ${reading.repairs} repair(s), ${reading.passes} pass(es), ` +
        `${reading.unclassified} with no side${reading.skipped === 0 ? '' : `, ${reading.skipped} unreadable`}`,
      `sides      ${sides.state.toUpperCase()} — ${sides.sentence}`,
      `scope      ${scope.state.toUpperCase()} — ${scope.sentence}`,
      `universal  ${universal.state.toUpperCase()} — ${universal.sentence}`,
      `clusters   ${clusters.length} at threshold ${threshold}${clusters.length === 0 ? ' — no two repairs share a condition' : ''}`,
      `census     fragmentation ${census.fragmentation.toFixed(3)} (${census.orphans}/${census.repairs} repair(s) no cluster claims), ` +
        `chained ${census.chained}/${census.clusters} under ${CHAIN_COHESION_FLOOR}, mean cohesion ${census.meanCohesion.toFixed(3)}`,
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
