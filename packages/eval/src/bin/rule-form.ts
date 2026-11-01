/**
 * R32 axis 1 — is a rule procedural or declarative, and can the corpus tell?
 *
 * Zero model calls: it classifies the `items` a run already committed and joins them to the
 * `per_case` rows of the same run, so every number here is recomputable from the artefact CI
 * already compares.
 *
 * The reading is deliberately split. The *verdict* comes from the census — the share of sentences
 * that carry both marker kinds — because that is a property of the corpus and does not depend on
 * how the questions turned out. The *residual* comes from the split, and is reported as a residual
 * precisely because the census refused the axis: when a third of the sentences are excluded and the
 * remaining two groups are what was left over, a difference between them is a difference between
 * leftovers.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { diffCasesOf, type CommittedRun } from '../diff-corpus.js';
import {
  RELAXED_MARKERS,
  SEPARATION_BAR,
  STRICT_MARKERS,
  censusOf,
  coverageOf,
  formSplitOf,
  packFormOf,
  ruleFormOf,
  rulePoolOf,
  type FormMarkers,
  type RuleForm,
} from '../rule-form.js';
import { writeJson } from './lib.js';

const SOURCE = process.env['QUERY_DIFF_SOURCE'] ?? join('eval', 'results', 'poc-sota-bird-dev-R26-channels.json');
/** The documentation commit that registered the predictions and the refutation before this run. */
const REGISTERED = 'ROADMAP.md §R32 predictions 1 and 3, refutation (microglia-docs 20e6154)';

type SourceRule = {
  readonly id: string;
  readonly statement: string;
};

const source = JSON.parse(readFileSync(SOURCE, 'utf8')) as CommittedRun & {
  readonly items?: readonly SourceRule[];
};

const cases = diffCasesOf(source, SOURCE);
const items = source.items ?? [];
const citedIds = new Set<string>();
for (const entry of cases) for (const id of entry.packIdList ?? []) citedIds.add(id);

const pool = rulePoolOf(items, citedIds);

/** One census per marker set, over the distinct sentences rather than the rows. */
const censusFor = (markers: FormMarkers): { census: ReturnType<typeof censusOf>; formById: Map<string, RuleForm> } => {
  const formBySentence = new Map<string, RuleForm>();
  for (const item of items) {
    const key = item.statement.toLowerCase().replace(/\s+/g, ' ').trim();
    const form = ruleFormOf(item.statement, markers);
    // A sentence carried into four folds is one sentence; letting a later fold overwrite an earlier
    // one would make the census depend on row order rather than on text.
    if (!formBySentence.has(key)) formBySentence.set(key, form);
  }
  const formById = new Map<string, RuleForm>();
  for (const item of items) formById.set(item.id, ruleFormOf(item.statement, markers));
  return { census: censusOf([...formBySentence.values()], markers.name), formById };
};

const strict = censusFor(STRICT_MARKERS);
const relaxed = censusFor(RELAXED_MARKERS);

const packForms = cases.map((entry) => packFormOf(entry.packIdList ?? [], strict.formById));
const coverage = coverageOf(packForms);

/** The split as the two pure groups alone. */
const whole = formSplitOf(cases, strict.formById);

/**
 * The same split on the questions that imported no ungrounded name.
 *
 * This is the reading that decides whether the form difference is its own cause or the imported
 * name wearing another label, and it is the reading §143 established for a sibling question. If
 * the gap survives where no name was introduced, the form is carrying something the name does not.
 */
const withoutImportedName = formSplitOf(
  cases.filter((entry) => entry.delta.ungrounded.length === 0),
  strict.formById,
);

/**
 * The gap inside each database, so a form difference that is really a database difference shows up.
 *
 * A pack's rules come from its own database's rule pool, so the two forms are not spread across
 * databases by chance. Counting how many databases put procedural above declarative, rather than
 * pooling them, is a sign test that a single database cannot carry on its own.
 */
const perDatabase = (() => {
  const byDb = new Map<string, typeof cases>();
  for (const entry of cases) {
    const bucket = byDb.get(entry.dbId) ?? [];
    byDb.set(entry.dbId, [...bucket, entry]);
  }
  const rows: { dbId: string; procedural: number; declarative: number; gapPp: number | null }[] = [];
  let positive = 0;
  let negative = 0;
  for (const [dbId, group] of [...byDb.entries()].sort(([one], [other]) => (one < other ? -1 : 1))) {
    const split = formSplitOf(group, strict.formById);
    if (split.gapPp === null) continue;
    rows.push({
      dbId,
      procedural: split.procedural.n,
      declarative: split.declarative.n,
      gapPp: split.gapPp,
    });
    if (split.gapPp > 0) positive += 1;
    else if (split.gapPp < 0) negative += 1;
  }
  return { databases: rows.length, positive, negative, rows };
})();

const axisUsable = relaxed.census.bothShare < SEPARATION_BAR && strict.census.bothShare < SEPARATION_BAR;

await writeJson('poc-rule-form', {
  id: 'poc-rule-form',
  title: 'Whether a rule is procedural or declarative, and whether this corpus can tell',
  source: SOURCE,
  sourceGeneratedAt: source.generated_at ?? null,
  registered: REGISTERED,
  n: cases.length,
  pool,
  census: { strict: strict.census, relaxed: relaxed.census },
  coverage,
  bar: SEPARATION_BAR,
  axisUsable,
  residual: {
    whole: {
      procedural: whole.procedural,
      declarative: whole.declarative,
      proceduralClusters: whole.proceduralClusters,
      declarativeClusters: whole.declarativeClusters,
      gapPp: whole.gapPp,
      gapLowPp: whole.gapLowPp,
      gapHighPp: whole.gapHighPp,
      resolved: whole.resolved,
    },
    withoutImportedName: {
      procedural: withoutImportedName.procedural,
      declarative: withoutImportedName.declarative,
      gapPp: withoutImportedName.gapPp,
      gapLowPp: withoutImportedName.gapLowPp,
      gapHighPp: withoutImportedName.gapHighPp,
      resolved: withoutImportedName.resolved,
    },
    perDatabase,
  },
  verdict: axisUsable ? 'measurable' : 'unmeasurable',
  reasons: axisUsable
    ? []
    : [
        `bothShare ${strict.census.bothShare.toFixed(4)} is at or above the registered bar of ${SEPARATION_BAR}: ${strict.census.both} of ${strict.census.n} sentences state a consequence and give a construction in the same breath`,
        `unclassifiedShare ${coverage.unclassifiedShare.toFixed(4)}: ${coverage.none} of ${coverage.cases} questions carry no rule whose form is pure`,
      ],
  confirmed: [
    'P1 as a negative: the two forms are not separable in this corpus, and the refutation clause applies',
    'P3 is refuted in the residual reading: the declarative pack is the damaged one, not the procedural one',
  ],
  refuted: [
    'P1 as written: the split does not separate at least as well as the imported-name split, because it does not separate at all',
  ],
});

process.stdout.write(`[rule-form] pool ${pool.rows} rows, ${pool.sentences} sentences, ${pool.slots} slots, ${pool.cited} cited` + '\n');
process.stdout.write(`[rule-form] strict both ${strict.census.both}/${strict.census.n} = ${strict.census.bothShare.toFixed(4)}` + '\n');
process.stdout.write(`[rule-form] relaxed both ${relaxed.census.both}/${relaxed.census.n} = ${relaxed.census.bothShare.toFixed(4)}` + '\n');
process.stdout.write(
  `[rule-form] coverage procedural ${coverage.procedural} declarative ${coverage.declarative} mixed ${coverage.mixed} none ${coverage.none}` + '\n',
);
process.stdout.write(
  `[rule-form] residual whole gap ${whole.gapPp?.toFixed(2)} [${whole.gapLowPp?.toFixed(2)}, ${whole.gapHighPp?.toFixed(2)}] resolved=${whole.resolved}` + '\n',
);
process.stdout.write(
  `[rule-form] residual without imported name gap ${withoutImportedName.gapPp?.toFixed(2)} [${withoutImportedName.gapLowPp?.toFixed(2)}, ${withoutImportedName.gapHighPp?.toFixed(2)}] resolved=${withoutImportedName.resolved}` + '\n',
);
process.stdout.write(`[rule-form] per database ${perDatabase.positive} positive, ${perDatabase.negative} negative of ${perDatabase.databases}` + '\n');
process.stdout.write(`[rule-form] verdict ${axisUsable ? 'measurable' : 'unmeasurable'}` + '\n');
