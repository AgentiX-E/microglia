/**
 * R32 axis 3 — is the damage a property of an ambiguous question?
 *
 * The last of the three candidate mechanisms, and the only one that had not been read. The first
 * was the pack's table set, which turned out to be the imported name counted twice. The second was
 * the rule's form, which turned out to be unclassifiable. This one asks whether a question that
 * does not say which columns it needs is the kind of question a pack damages — the ambiguity being
 * resolved by a rule that names a column, and resolved wrongly.
 *
 * The prediction is that damage concentrates where coverage is low. **It does not**: the band that
 * names none of its required columns is destroyed at a rate six times lower than the band that
 * names all of them, and the pattern holds inside the two difficulty strata large enough to read.
 *
 * Zero model calls. Everything here is a classification of the committed run against the reference
 * query it carries.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { diffCasesOf, type CommittedRun } from '../diff-corpus.js';
import { referentSplitOf, type ReferentBucket, type ReferentStratum } from '../referent.js';
import { writeJson } from './lib.js';

const SOURCE = process.env['QUERY_DIFF_SOURCE'] ?? join('eval', 'results', 'poc-sota-bird-dev-R26-channels.json');
/** The documentation commit that registered R32's third axis before this reading existed. */
const REGISTERED = 'ROADMAP.md §R32 candidate 3 (microglia-docs 20e6154)';

const source = JSON.parse(readFileSync(SOURCE, 'utf8')) as CommittedRun;
const cases = diffCasesOf(source, SOURCE);

const shape = (strata: readonly ReferentStratum[]): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const stratum of strata) {
    out[stratum.bucket] = {
      n: stratum.cell.n,
      helped: stratum.cell.helped,
      harmed: stratum.cell.harmed,
      deltaPp: stratum.cell.deltaPp,
      halfWidthPp: stratum.cell.halfWidthPp,
      baselineAccuracy: stratum.cell.baselineAccuracy,
      harmedPerCorrectPp: stratum.cell.harmedPerCorrectPp,
      helpedPerWrongPp: stratum.cell.helpedPerWrongPp,
    };
  }
  return out;
};

const overall = referentSplitOf(cases);
const labels = [...new Set(cases.map((entry) => entry.difficulty).filter((label): label is string => label !== undefined))].sort();
const byDifficulty = labels.map((difficulty) => ({
  difficulty,
  strata: referentSplitOf(cases, { difficulty }),
}));

/**
 * The band the prediction named, against the band at the other end.
 *
 * The two conditional rates are what the comparison has to use. The raw deltas differ by 6.2pp
 * across the four bands, but so do the baseline accuracies — 57.3% where the question names nothing
 * against 67.4% where it names everything — and a question that starts correct has more to lose.
 * `harmedPerCorrectPp` removes that: it asks what share of the already-correct queries the pack
 * broke.
 */
const band = (bucket: ReferentBucket): ReferentStratum | undefined =>
  overall.find((stratum) => stratum.bucket === bucket);
const none = band('none');
const all = band('all');

const verdict =
  none === undefined || all === undefined || none.cell.harmedPerCorrectPp === null || all.cell.harmedPerCorrectPp === null
    ? 'unmeasured'
    : none.cell.harmedPerCorrectPp > all.cell.harmedPerCorrectPp
      ? 'confirmed'
      : 'refuted';

await writeJson('poc-referent', {
  id: 'poc-referent',
  title: 'Whether an ambiguous question is the kind a pack damages',
  source: SOURCE,
  sourceGeneratedAt: (source as { generated_at?: string }).generated_at ?? null,
  registered: REGISTERED,
  n: cases.length,
  buckets: ['none', 'few', 'most', 'all'],
  overall: shape(overall),
  byDifficulty: byDifficulty.map((entry) => ({ difficulty: entry.difficulty, strata: shape(entry.strata) })),
  verdict,
  reading:
    verdict === 'refuted'
      ? 'the band that names none of its columns is the least damaged, not the most'
      : verdict === 'confirmed'
        ? 'the band that names none of its columns is the most damaged'
        : 'one of the end bands is empty and nothing is compared',
});

const report = (label: string, strata: readonly ReferentStratum[]): void => {
  for (const stratum of strata) {
    if (stratum.cell.n === 0) continue;
    const destroyed = stratum.cell.harmedPerCorrectPp;
    process.stdout.write(
      `[referent] ${label.padEnd(12)} ${stratum.bucket.padEnd(5)} n=${String(stratum.cell.n).padStart(4)} ` +
        `delta=${(stratum.cell.deltaPp ?? 0).toFixed(2).padStart(6)}pp ` +
        `base=${(stratum.cell.baselineAccuracy * 100).toFixed(1)}% ` +
        `destroyed=${destroyed === null ? '   n/a' : destroyed.toFixed(2).padStart(6)}%\n`,
    );
  }
};
report('all', overall);
for (const entry of byDifficulty) report(entry.difficulty, entry.strata);
process.stdout.write(`[referent] verdict ${verdict} — ${none?.cell.harmedPerCorrectPp?.toFixed(2) ?? 'n/a'}% destroyed where nothing is named\n`);
