/**
 * Ask the committed record where the imported name came from.
 *
 * This is the R31 measurement. It reads one committed artefact, writes one, calls no model, opens
 * no database and records no clock, which is what lets the workflow recompute it and compare byte
 * for byte instead of trusting the committed copy.
 *
 * The registration it executes is `ROADMAP.md` §R31 in the documentation repository, committed
 * before this file existed. It is the second half of §140: that round found the covariate, and this
 * one asks whether the covariate's premise — *the pack put the name there* — is true.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  corpusOf,
  importSourceOf,
  mediationOf,
  mentionsOf,
  type CommittedArtefact,
  type MediationEntry,
} from '@agentix-e/microglia-eval';
import { writeJson } from './lib.js';

const SOURCE = process.env['MEDIATION_SOURCE'] ?? join('eval', 'results', 'poc-sota-bird-dev-R26-channels.json');
/**
 * The documentation section this reading answers.
 *
 * `ROADMAP.md` §R31 registered a *store rebuild* — add `names` to `LearnedItem` and re-measure the
 * admission filter's recall. This file answers its premise first, from the record, because the
 * record already holds the pack's text: if the pack does not name the identifier, a field that
 * names it more precisely cannot help. The criteria were written before the numbers were read, and
 * the one criterion that was tightened after the first run is disclosed in `AUDIT.md` §27 rather
 * than presented as having been there all along.
 */
const REGISTERED = 'ROADMAP.md §R31-precondition';

const artefact = JSON.parse(readFileSync(SOURCE, 'utf8')) as CommittedArtefact;
const corpus = corpusOf(artefact);
const entries: readonly MediationEntry[] = corpus.mediation;

const primary = mediationOf(entries, 'exact');
const generous = mediationOf(entries, 'flattened');

/**
 * The names the model reaches for that no rule named.
 *
 * Sorted by count then name so the list is stable, and reported because it is the descriptive
 * counterpart of the criteria: `M3` says the pack supplies the name in a minority of cases, and
 * this table says which names it fails to supply. A vocabulary dominated by one database's columns
 * is a different finding from one spread across all eleven.
 */
function unattributed(reading: typeof primary): readonly { readonly name: string; readonly count: number; readonly databases: readonly string[] }[] {
  const counts = new Map<string, { count: number; databases: Set<string> }>();
  for (const entry of entries) {
    // A question is in one bucket, and every one of its names failed to match — `importSourceOf`
    // returns `pack` as soon as a single name matches — so the bucket decides for the whole list.
    const source = importSourceOf(entry.delta.ungrounded, entry.packText, entry.executed, reading.detector);
    if (source !== 'schema' && source !== 'unverifiable') continue;
    for (const name of entry.delta.ungrounded) {
      const slot = counts.get(name) ?? { count: 0, databases: new Set<string>() };
      slot.count += 1;
      slot.databases.add(entry.dbId);
      counts.set(name, slot);
    }
  }
  return [...counts.entries()]
    .sort((left, right) => (right[1].count === left[1].count ? (left[0] < right[0] ? -1 : 1) : right[1].count - left[1].count))
    .slice(0, 25)
    .map(([name, slot]) => ({ name, count: slot.count, databases: [...slot.databases].sort() }));
}

await writeJson('poc-pack-mediation', {
  id: 'poc-pack-mediation',
  title: 'Where the imported name came from: the pack, the schema, or a statement that never ran',
  source: SOURCE,
  sourceGeneratedAt: corpus.generatedAt,
  registered: REGISTERED,
  corpus: {
    cases: corpus.cases.length,
    importing: primary.importing,
    notImporting: primary.notImporting,
    reconstructedPackText: corpus.reconstructed,
    withoutPackText: corpus.withoutPackText,
  },
  primary,
  generous,
  unattributed: unattributed(primary),
  /**
   * What this reading cannot decide, stated rather than left to a reader.
   *
   * The record carries the pack's text and the query it produced, and nothing in between: a rule
   * that says "the county column" and a model that writes `County Name` are indistinguishable from
   * a rule that says nothing and a model that guessed, because the text either contains the name
   * or it does not. The generous detector closes the spelling gap and neither detector closes the
   * synonym gap, which is why `M4` is a bound rather than a second measurement.
   */
  unmeasured: [
    {
      category: 'synonym',
      registered: 'a rule that names the concept without naming the column',
      reason: 'the record stores the pack text and the query, not the model’s reading of either',
      nearest: 'M4 (flattened detector)',
      difference: 'M4 forgives spelling and punctuation; "county" against `County Name` is a synonym, not a spelling',
    },
    {
      category: 'pruned-name',
      registered: 'a table or column the rule named that the schema had pruned',
      reason: 'per_case stores schemaTables as counts; the lane now records the names (R30 stage 1b), and the committed record predates it',
      nearest: 'M2 (the schema bucket)',
      difference: 'M2 says the query named a real column the question did not; it does not say whether that column reached the prompt',
    },
  ],
  notes: [
    'The three buckets are exhaustive by construction: a question whose query imported a name is attributed to the pack when the pack text carries the name, to the schema when it does not and the query executed, and to unverifiable otherwise. "Executed" is what licenses calling the name real — a statement that ran cannot have named a column the table does not have — and a statement that failed does not license the opposite, which is why the third bucket is not called invented.',
    'M1 and M2 are the mechanism test and M3/M4 are the availability test. A mechanism that acts on 5% of the flagged questions is a curiosity; the product statement §140 licensed needs the pack to be the source in enough of them for a filter to have something to refuse.',
    'The exact detector under-credits the pack on spacing and punctuation; the flattened detector over-credits it on short names inside longer words. M3 reads the lower bound and M4 the upper bound, and a pair that straddles 30% is a finding about the threshold rather than about the pack.',
    'Nothing here re-reads the gold SQL or the scorer. The attribution is a substring test between two strings the model itself saw and produced.',
  ],
});

const pct = (value: number | null, digits = 2): string => (value === null ? 'n/a' : value.toFixed(digits));
process.stdout.write(
  `[mediation] ${corpus.cases.length} cases, ${primary.importing} importing an ungrounded name ` +
    `(pack text reconstructed for ${corpus.reconstructed}, absent for ${corpus.withoutPackText})\n`,
);
for (const row of primary.strata) {
  process.stdout.write(
    `[mediation] ${row.source.padEnd(12)} n=${String(row.cell.n).padStart(4)} ` +
      `(${(row.share * 100).toFixed(1)}%) ${String(row.cell.helped).padStart(3)}+/${String(row.cell.harmed).padStart(3)}- ` +
      `delta=${pct(row.cell.deltaPp).padStart(7)}pp destroyed=${pct(row.cell.harmedPerCorrectPp).padStart(6)}% ` +
      `base=${pct(row.cell.baselineAccuracy * 100, 1)}%\n`,
  );
}
process.stdout.write(
  `[mediation] by name: ${primary.byName.exact} of ${primary.byName.total} named by the pack ` +
    `(${((primary.byName.exact / Math.max(1, primary.byName.total)) * 100).toFixed(1)}%), ` +
    `${primary.byName.flattened} once spelling is forgiven\n`,
);
process.stdout.write(
  `[mediation] the gate's +${primary.contribution.total.toFixed(2)}pp comes ${primary.contribution.pack.toFixed(2)}pp ` +
    `from pack-named questions, ${primary.contribution.schema.toFixed(2)}pp from questions the pack never named, ` +
    `${primary.contribution.unverifiable.toFixed(2)}pp from statements that never ran\n`,
);
for (const criterion of primary.criteria) {
  process.stdout.write(`[mediation] ${criterion.ok ? 'pass' : 'FAIL'} ${criterion.code} — ${criterion.actual}\n`);
}
const mechanism = primary.criteria.find((entry) => entry.code === 'M3');
const availability = primary.criteria.find((entry) => entry.code === 'M1');
process.stdout.write(
  `[mediation] ${
    primary.statementWithdrawn
      ? `the product statement is withdrawn: availability ${availability?.ok === true ? 'holds' : 'fails'}, mechanism ${
          mechanism?.ok === true ? 'holds' : 'does not clear its own resolution'
        }`
      : 'the product statement stands: the pack supplies the name often enough and the questions it supplies it for are the damaged ones'
  }\n`,
);
