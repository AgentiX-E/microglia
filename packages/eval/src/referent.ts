/**
 * R32's third axis — is the question one the schema can answer two ways?
 *
 * The first two axes are closed and both closed negatively: the table-set feature was the imported
 * name counted twice, and the rule's form cannot be classified because most sentences are both
 * forms at once. What neither of those can rule out is that the damage is a property of the
 * *question* rather than of the pack — a question that does not say which column it wants, where a
 * rule that names one resolves the ambiguity and is wrong half the time.
 *
 * The measure is how much of what the answer required the question actually said. The reference
 * query names the columns it needs; the question either mentions them or leaves them to be
 * inferred. `coverage` is the share of the reference query's columns that the question — or the
 * benchmark's external-knowledge block, which a solver may also read — names outright.
 *
 * **This is not a measure of difficulty, and the strata are here to prove it.** A question that
 * names nothing it needs is plausibly also a harder one, and a harder question is worse under any
 * interference. Every reading is therefore taken inside the benchmark's own difficulty label, so a
 * coverage effect that is really a difficulty effect shows up as the same effect in every stratum
 * and is reported as such rather than as a finding.
 */
import { contextTokens, isGrounded, sqlShapeOf } from '@agentix-e/microglia-sql';
import { cellOf, type CellReading, type DiffCase } from './query-diff.js';

/** How much of what the answer required the question said, in four bands. */
export type ReferentBucket = 'none' | 'few' | 'most' | 'all';

/** One question's referent reading, and the columns it was computed from. */
export type ReferentReading = {
  readonly columns: number;
  readonly mentioned: number;
  readonly coverage: number;
  readonly bucket: ReferentBucket;
};

/**
 * The band a coverage falls into.
 *
 * The cut points are 0, 1/2 and 1 rather than thirds: the question either named none of the
 * columns, some of them, most of them, or all of them, and a third is a rounder description of
 * "some" than any other round number.
 */
export function bucketOf(coverage: number): ReferentBucket {
  if (coverage <= 0) return 'none';
  if (coverage < 0.5) return 'few';
  if (coverage < 1) return 'most';
  return 'all';
}

/**
 * How much of the reference query's column list the question names.
 *
 * Star projections are dropped: `SELECT *` requires no column, so counting its expansion would
 * report a question as silent about columns it never needed to name. A reference query with no
 * columns left after that is `all` at coverage 1 — it required nothing, so the question omitted
 * nothing — which keeps an empty denominator out of the average rather than making it a zero.
 */
export function referentOf(
  goldSql: string,
  question: string,
  evidence?: string | null,
): ReferentReading {
  const context = contextTokens(question, evidence ?? null);
  const columns = [...new Set(sqlShapeOf(goldSql).columns)].filter((name) => name !== '*');
  const mentioned = columns.filter((name) => isGrounded(name, context, 'strict'));
  const coverage = columns.length === 0 ? 1 : mentioned.length / columns.length;
  return { columns: columns.length, mentioned: mentioned.length, coverage, bucket: bucketOf(coverage) };
}

/** One band's reading, and how many questions it holds. */
export type ReferentStratum = {
  readonly bucket: ReferentBucket;
  readonly cell: CellReading;
};

/** Every band, always in the same order, including the ones the corpus does not populate. */
const BUCKETS: readonly ReferentBucket[] = ['none', 'few', 'most', 'all'];

/**
 * The effect of the pack in each band, optionally inside a difficulty label.
 *
 * `difficulty` is applied as a filter rather than as a second dimension because the run's labels
 * are three coarse bands and crossing them with four would leave cells too small to resolve
 * anything — which is the failure mode this function's caller is most likely to hit, so the caller
 * reports each label separately rather than the product.
 */
export function referentSplitOf(
  cases: readonly DiffCase[],
  options: { readonly difficulty?: string; readonly resamples?: number } = {},
): readonly ReferentStratum[] {
  const resamples = options.resamples ?? 10_000;
  const scoped =
    options.difficulty === undefined
      ? cases
      : cases.filter((entry) => entry.difficulty === options.difficulty);
  // A record keyed by the four bands rather than a map: every band has an entry by construction, so
  // there is no lookup that can miss and no empty-list fallback to leave untested.
  const entries: Record<ReferentBucket, DiffCase[]> = { none: [], few: [], most: [], all: [] };
  for (const entry of scoped) {
    if (entry.goldSql === undefined) continue;
    const reading = referentOf(entry.goldSql, entry.question ?? '', entry.evidence);
    entries[reading.bucket].push(entry);
  }
  return BUCKETS.map((bucket) => ({ bucket, cell: cellOf(entries[bucket], resamples) }));
}
