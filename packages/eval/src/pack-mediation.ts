/**
 * Where the imported name came from: the pack, the schema, or a statement that never ran.
 *
 * §140 ended twenty-eight rounds of flat covariates by finding one that separates: on the 1,534
 * dev questions the pack's damage sits almost entirely where the emitted query names something the
 * question does not — 155 questions, −11.13pp against a 7.61pp half-width, a 7.8× damage rate. The
 * product statement it licensed was narrow: *a rule may not put a name into the query that the
 * question does not contain*.
 *
 * That statement contains an unmeasured premise, and it is the premise the whole thing rests on.
 * A name in the emitted query came from **somewhere**, and there are two candidates:
 *
 *  - the pack's text said the column — a rule about county-versus-city columns is followed by a
 *    query that writes `County Name`, and the filter §140 proposes would have to catch that rule;
 *  - the model read the `CREATE TABLE` statements and chose a real column the question never asked
 *    for — in which case the pack is being blamed for the model's own prior, nothing in the pack
 *    can be filtered, and the gate §140 estimated is unfalsifiable however large the sample.
 *
 * Nothing in the record distinguishes them, and the difference is readable at zero cost: the lane
 * stores the pack's rendered text per question (`injected`) and the query it produced
 * (`predictedSql`). If the name is in the text, the pack supplied it. If it is not, and the query
 * executed — so the name resolved against the schema — then the model supplied it.
 *
 * ## Why two detectors and what each one biases towards
 *
 * A rule can name a column two ways. It can quote it — `Free Meal Count (K-12)` in backticks — and
 * then `exact` finds it. It can also say "the county column" while the query writes `County Name`,
 * and then `exact` misses it while the generous `flattened` detector (both sides stripped of every
 * non-alphanumeric character, then a substring test) catches `countyname` against
 * "thecountycolumn" — no, it does not, and that is the point: neither detector can bridge
 * *county* to *County Name*. What `flattened` does bridge is spelling: `raceid` against "race id",
 * `atom_id` against "the atom id". So `exact` under-credits the pack on spacing and punctuation,
 * and `flattened` over-credits it on short names that appear inside longer words. One is a lower
 * bound and one is an upper bound, and the share that decides the criterion is read from the lower
 * bound while the upper bound is reported beside it.
 *
 * ## The third bucket is not "invented"
 *
 * A name that is in neither the pack nor a query that ran is *unverifiable*: a statement that
 * failed to execute may have named a real column and failed on something else entirely, and
 * BIRD's 1,534 questions contain a long tail of functions, date formats and ambiguities that fail
 * for reasons having nothing to do with an identifier. Collapsing that bucket into "the model
 * invented a column" would attribute a cause the record does not carry, which is the defect §138
 * spent a round removing from a different reading.
 */
import { cellOf, readingOf, type CellReading, type DiffCase, type FeatureReading } from './query-diff.js';
import type { MediationEntry } from './corpus.js';

/** How a name in the pack's text is matched. See the module comment for the direction of each bias. */
export type MentionDetector = 'exact' | 'flattened';

/** Whether a name appears in a text, under both detectors. */
export type NameMention = {
  /** Whole-word match on the lower-cased text: the lower bound on what the pack said. */
  readonly exact: boolean;
  /** Match after both sides lose every non-alphanumeric character: the upper bound. */
  readonly flattened: boolean;
};

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Lower-case and drop everything that is not a letter or a digit. */
const flatten = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * Test one imported name against the text the model read.
 *
 * The empty name returns `false` for both rather than throwing. It cannot come from the tokeniser,
 * which never emits one, but the function is exported and a caller that passed one would otherwise
 * get `true` from `flattened` — `''.includes('')` is true — and count every question as
 * attributable to the pack.
 */
export function mentionsOf(name: string, packText: string): NameMention {
  const flattened = flatten(name);
  if (flattened.length === 0) return { exact: false, flattened: false };
  const lowered = packText.toLowerCase();
  const exact = new RegExp(`(^|[^a-z0-9])${escapeRegExp(name.toLowerCase())}([^a-z0-9]|$)`).test(lowered);
  return { exact, flattened: flatten(lowered).includes(flattened) };
}

/** Where the name a query imported came from, as far as the record can tell. */
export type ImportSource = 'pack' | 'schema' | 'unverifiable';

/**
 * Attribute one question's imported names.
 *
 * `null` when the query imported nothing: a question with no ungrounded name is not a question
 * about attribution, and counting it as "the schema did it" would put it in a stratum that
 * measures something else. One name from the pack is enough to call the question `pack`, because
 * the filter §140 proposes acts per rule and a rule that named a name is a rule that could be
 * refused — a mixed question is caught by the stricter reading rather than the looser one.
 */
export function importSourceOf(
  names: readonly string[],
  packText: string,
  executed: boolean,
  detector: MentionDetector = 'exact',
): ImportSource | null {
  if (names.length === 0) return null;
  for (const name of names) {
    if (mentionsOf(name, packText)[detector]) return 'pack';
  }
  return executed ? 'schema' : 'unverifiable';
}

/** One bucket of the three-way split. */
export type MediationStratum = {
  readonly source: ImportSource;
  readonly cell: CellReading;
  /** Share of the importing questions, which is the number that decides whether a bucket is a story. */
  readonly share: number;
};

export type MediationCriterion = {
  readonly code: string;
  readonly criterion: string;
  readonly actual: string;
  readonly ok: boolean;
};

/** How many names, not questions, each detector attributes to the pack. */
export type NameCounts = {
  readonly total: number;
  readonly exact: number;
  readonly flattened: number;
};

/**
 * How much of the gate's improvement each bucket is responsible for, in percentage points of delta.
 *
 * The decomposition is exact and additive: the improvement a gate buys is `−Σ signed / n` over the
 * questions it discards, so splitting that sum by attribution answers *whose damage the filter is
 * recovering* without a second model. It is the number the product decision needs: an admission
 * filter can only refuse rules, so it can only ever collect the `pack` column, and knowing that
 * column is a third of the total is what turns "the gate works" into "the gate works, and the form
 * of it that could run before generation would collect a third of it".
 */
export type Contribution = {
  readonly pack: number;
  readonly schema: number;
  readonly unverifiable: number;
  readonly total: number;
};

export type MediationReading = {
  readonly corpus: number;
  readonly importing: number;
  readonly notImporting: number;
  readonly detector: MentionDetector;
  readonly strata: readonly MediationStratum[];
  /** `pack − schema`, the difference between the two buckets that can be attributed. */
  readonly split: FeatureReading;
  readonly byName: NameCounts;
  readonly contribution: Contribution;
  readonly criteria: readonly MediationCriterion[];
  /**
   * Whether §140's product statement has to be withdrawn.
   *
   * The statement is *a rule may not put a name into the query that the question does not contain*,
   * and it has two premises: that the pack's text supplies the name often enough for a filter to
   * reach it, and that a question it supplies the name for is damaged more than one it does not.
   * It is withdrawn when either premise fails, and the two failures mean different things — an
   * availability failure says the filter is too small to matter, a mechanism failure says the
   * filter is aimed at the wrong object.
   */
  readonly statementWithdrawn: boolean;
};

/** The share of importing questions a statement needs before it can be called a mechanism. */
export const PACK_SHARE_FLOOR = 0.3;

/**
 * Read the three-way split and decide whether §140's statement survives.
 *
 * The criteria are registered in `ROADMAP.md` §R31, written before this file existed. Two are about
 * *availability* — can a filter that reads rules see the name at all — and two about *mechanism* —
 * is a question the pack named a column for damaged more than one it did not:
 *
 *  - `M1` the pack's text supplies the name in at least 30% of the flagged questions, under the
 *    lower-bound detector;
 *  - `M2` it supplies it in at least 60% once spelling differences are forgiven, so `M1` is not a
 *    verdict about punctuation;
 *  - `M3` the pack-named bucket is damaged more than the schema bucket, **and the difference clears
 *    its own 95% half-width**. The resolution clause is not decoration: a point comparison of
 *    36.36% against 34.04% with a 14.74pp interval around the gap is the same number whether the
 *    two buckets are identical or 25 points apart, and calling that a mechanism is the mistake
 *    every flat covariate in this record was made of;
 *  - `M4` the pack-named bucket carries at least half of what the gate buys, which is what it would
 *    collect if the filter ran before generation instead of after it.
 */
export function mediationOf(
  entries: readonly MediationEntry[],
  detector: MentionDetector = 'exact',
  resamples = 10_000,
): MediationReading {
  const importing = entries.filter((entry) => entry.delta.ungrounded.length > 0);
  const buckets: Record<ImportSource, DiffCase[]> = { pack: [], schema: [], unverifiable: [] };
  for (const entry of importing) {
    const source = importSourceOf(entry.delta.ungrounded, entry.packText, entry.executed, detector);
    // `importSourceOf` returns `null` only for an empty name list, and every entry here has one,
    // so the guard is a narrowing rather than an arm: a question cannot reach this loop unflagged.
    if (source !== null) buckets[source].push(entry);
  }
  const order: readonly ImportSource[] = ['pack', 'schema', 'unverifiable'];
  const strata: MediationStratum[] = order.map((source) => ({
    source,
    cell: cellOf(buckets[source], resamples),
    share: importing.length === 0 ? 0 : buckets[source].length / importing.length,
  }));
  const split = readingOf(
    'M3',
    'the pack names the identifier the query imported, against the query importing one the pack never named',
    buckets.pack,
    buckets.schema,
    resamples,
  );

  const counts: NameCounts = (() => {
    let total = 0;
    let exact = 0;
    let flattened = 0;
    for (const entry of importing) {
      for (const name of entry.delta.ungrounded) {
        total += 1;
        const mention = mentionsOf(name, entry.packText);
        if (mention.exact) exact += 1;
        if (mention.flattened) flattened += 1;
      }
    }
    return { total, exact, flattened };
  })();

  // The gate's improvement is `−Σ signed / n` over the discarded questions, so each bucket's share
  // of it is that bucket's own signed sum over the same denominator. Additive by construction, and
  // the reading asserts the identity in a test rather than trusting it.
  const contributionOf = (rows: readonly DiffCase[]): number => {
    if (entries.length === 0) return 0;
    let signed = 0;
    for (const row of rows) signed += (row.correct ? 1 : 0) - (row.withoutMemoryCorrect ? 1 : 0);
    return (-signed / entries.length) * 100;
  };
  const contribution: Contribution = {
    pack: contributionOf(buckets.pack),
    schema: contributionOf(buckets.schema),
    unverifiable: contributionOf(buckets.unverifiable),
    total: contributionOf(importing),
  };

  const packShare = importing.length === 0 ? 0 : buckets.pack.length / importing.length;
  // The generous detector's share is a per-question re-attribution, not a rescaling of `byName`:
  // a question is attributable as soon as one of its names is, and a mean over names would let one
  // many-named question outvote forty single-named ones.
  const generousShare =
    importing.length === 0
      ? 0
      : importing.filter(
          (entry) => importSourceOf(entry.delta.ungrounded, entry.packText, entry.executed, 'flattened') === 'pack',
        ).length / importing.length;

  const pp = (value: number | null): string => (value === null ? 'n/a' : value.toFixed(2));
  const packHarmed = split.present.harmedPerCorrectPp;
  const schemaHarmed = split.absent.harmedPerCorrectPp;
  const packDelta = split.present.deltaPp;
  const schemaDelta = split.absent.deltaPp;
  const mechanismResolves =
    split.resolves && packHarmed !== null && schemaHarmed !== null && packHarmed > schemaHarmed;
  const packShareOfGain = contribution.total === 0 ? 0 : contribution.pack / contribution.total;

  const criteria: MediationCriterion[] = [
    {
      code: 'M1',
      criterion: `The pack's text supplies the name in at least ${(PACK_SHARE_FLOOR * 100).toFixed(0)}% of the flagged questions (exact detector)`,
      actual: `${buckets.pack.length} of ${importing.length} (${(packShare * 100).toFixed(1)}%)`,
      ok: packShare >= PACK_SHARE_FLOOR,
    },
    {
      code: 'M2',
      criterion: 'It supplies it in at least 60% once spelling is forgiven, so M1 is not a verdict about punctuation',
      actual: `${(generousShare * 100).toFixed(1)}% under the flattened detector; ${counts.exact} of ${counts.total} names`,
      ok: generousShare >= 0.6,
    },
    {
      code: 'M3',
      criterion: 'The pack-named bucket is damaged more than the schema bucket, and the difference clears its own half-width',
      actual:
        packHarmed === null || schemaHarmed === null
          ? `unmeasured: pack ${pp(packHarmed)}%, schema ${pp(schemaHarmed)}%`
          : `destroyed ${packHarmed.toFixed(2)}% vs ${schemaHarmed.toFixed(2)}%; delta ${pp(packDelta)}pp vs ${pp(schemaDelta)}pp, gap ${pp(split.gapPp)}pp ±${pp(split.gapHalfWidthPp)}`,
      ok: mechanismResolves,
    },
    {
      code: 'M4',
      criterion: 'The pack-named bucket carries at least half of what the gate buys, so the same filter running before generation would collect it',
      actual: `${contribution.pack.toFixed(2)}pp of ${contribution.total.toFixed(2)}pp (${(packShareOfGain * 100).toFixed(1)}%)`,
      ok: contribution.total !== 0 && packShareOfGain >= 0.5,
    },
  ];

  return {
    corpus: entries.length,
    importing: importing.length,
    notImporting: entries.length - importing.length,
    detector,
    strata,
    split,
    byName: counts,
    contribution,
    criteria,
    statementWithdrawn: !mechanismResolves || packShare < PACK_SHARE_FLOOR,
  };
}
