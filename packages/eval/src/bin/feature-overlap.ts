/**
 * R32 prediction 2: is "the pack added a table" the same finding as "the pack imported a name"?
 *
 * The two features are the closest pair in the query diff. F1 — a generated query names something
 * neither the question nor the baseline query mentions — is the only covariate this project has that
 * clears its own resolution (gap −11.13pp against a 7.61pp half-width). F4 — the query reads a table
 * the baseline did not — sits next to it at −11.28pp and does **not** clear its half-width, which is
 * exactly what a shadow of F1 would look like if the two sets overlapped heavily.
 *
 * So the question is not whether F4 is negative; it is whether F4 is negative *on the questions F1
 * does not cover*. If it is, the pack has two ways of damaging a query and the record has been
 * attributing both to one. If it is not, F4 is F1 counted twice and must not be reported beside it.
 *
 * The bar was registered in `ROADMAP.md` §R32 before these numbers were read: `both / left < 0.5`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  diffCasesOf,
  featureOverlapOf,
  type CommittedRun,
  type FeatureOverlap,
} from '../index.js';
import { writeJson } from './lib.js';

const SOURCE =
  process.env['QUERY_DIFF_SOURCE'] ?? join('eval', 'results', 'poc-sota-bird-dev-R26-channels.json');
const REGISTERED = 'ROADMAP.md §R32 prediction 2';

const run = JSON.parse(readFileSync(SOURCE, 'utf8')) as CommittedRun;
const cases = diffCasesOf(run, SOURCE);

/** The four predicates, named once so the pairs below cannot disagree about what they mean. */
const PREDICATES = {
  /** F1 — an ungrounded name, strict grounding. */
  importedName: (delta: { ungrounded: readonly string[] }): boolean => delta.ungrounded.length > 0,
  /** F4 — a table the baseline did not read. */
  tableAdded: (delta: { tablesAdded: readonly string[] }): boolean => delta.tablesAdded.length > 0,
  /** F5 — at least one added conjunction, the narrowing direction. */
  narrowed: (delta: { conjunctionDelta: number }): boolean => delta.conjunctionDelta > 0,
} as const;

type PairReading = {
  readonly pair: string;
  readonly question: string;
  readonly reading: FeatureOverlap;
};

const pairs: PairReading[] = [
  {
    pair: 'F1/F4',
    question: 'is "the pack added a table" the same finding as "the pack imported a name"?',
    reading: featureOverlapOf(
      'F1',
      'F4',
      cases,
      PREDICATES.importedName as never,
      PREDICATES.tableAdded as never,
    ),
  },
  {
    pair: 'F1/F5',
    question: 'is the narrowing direction (F5, +? pp on its own) a subset of the imported-name set?',
    reading: featureOverlapOf(
      'F1',
      'F5',
      cases,
      PREDICATES.importedName as never,
      PREDICATES.narrowed as never,
    ),
  },
];

/**
 * What the registered criterion concludes, and the one reading that could overturn it.
 *
 * Two questions, not one: *does the second feature overlap the first* (the registered bar) and *is
 * it still harmful where it does not overlap* (the bar that decides whether it is a cause). They have
 * different answers and the difference is the finding, so the verdict is one of three rather than a
 * flag:
 *
 *  - `shadow` — the overlap is at least half, so the second feature is the first counted twice;
 *  - `independent` — the overlap is small *and* the feature is still negative outside it, which is a
 *    second way the pack damages a query;
 *  - `inert` — the overlap is small, and outside it the feature is worth nothing. Not a duplicate,
 *    and not a cause: a label that names a consequence of the mechanism without adding to it.
 */
const verdicts = pairs.map(({ pair, reading }) => {
  const outside = reading.rightOutsideLeft;
  const resolvesOutside =
    outside.deltaPp !== null && outside.halfWidthPp !== null && Math.abs(outside.deltaPp) > outside.halfWidthPp;
  const harmfulOutside = outside.deltaPp !== null && outside.deltaPp < 0 && resolvesOutside;
  const kind = !reading.criterionMet ? 'shadow' : harmfulOutside ? 'independent' : 'inert';
  return {
    pair,
    overlapShare: reading.overlapShare,
    criterionMet: reading.criterionMet,
    // The reading that decides whether a second feature is a second cause: the right feature
    // measured only on the questions the left one does not cover.
    rightOutsideLeftPp: outside.deltaPp,
    rightOutsideLeftHalfWidthPp: outside.halfWidthPp,
    rightOutsideLeftResolves: resolvesOutside,
    rightOutsideLeftN: outside.n,
    kind,
  };
});

const pp = (value: number | null): string => (value === null ? 'n/a' : `${value.toFixed(2)}pp`);
for (const { pair, reading } of pairs) {
  process.stdout.write(
    `[overlap] ${pair}: both ${reading.both}, left-only ${reading.leftOnly}, right-only ${reading.rightOnly} — ` +
      `overlap ${(reading.overlapShare * 100).toFixed(1)}%, right outside left ${pp(reading.rightOutsideLeft.deltaPp)} ` +
      `(n=${reading.rightOutsideLeft.n})\n`,
  );
}
for (const verdict of verdicts) {
  process.stdout.write(
    `[overlap] ${verdict.pair}: criterion ${verdict.criterionMet ? 'met' : 'not met'}; ` +
      `right outside left ${verdict.rightOutsideLeftResolves ? 'resolves' : 'does not resolve'} — ${verdict.kind}\n`,
  );
}

await writeJson('poc-feature-overlap', {
  id: 'poc-feature-overlap',
  title: 'Whether the two closest features in the query diff are one finding or two',
  source: SOURCE,
  registered: REGISTERED,
  n: cases.length,
  pairs,
  verdicts,
  note:
    'A feature can be negative and still be another feature counted twice. The reading that decides ' +
    'it is `rightOutsideLeft` — the second feature measured only on the questions the first does not ' +
    'cover — because a shadow of a negative covariate reads as zero once the shadow is removed.',
});
process.stdout.write(`[overlap] wrote poc-feature-overlap${process.env['POC_RESULT_SUFFIX'] ?? ''}.json\n`);
