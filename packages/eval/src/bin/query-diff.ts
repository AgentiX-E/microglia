/**
 * Classify what the pack did to the query, over every committed case, and report what separates.
 *
 * This is the R30 stage 1 measurement. It reads one committed artefact and writes one, calls no
 * model, opens no database and records no clock, which is what lets the workflow recompute it and
 * compare byte for byte instead of trusting the committed copy.
 *
 * The registration it executes is `ROADMAP.md` §R30 in the documentation repository, committed
 * before this file existed. Two of its four predictions are answerable here; the other two are
 * about a run that costs ~14,000 calls and are not.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  cellOf,
  contextTokens,
  diffQueries,
  featureOf,
  gateReadingOf,
  isGrounded,
  kindOf,
  readQueryDiff,
  type CellReading,
  type DiffCase,
  type DiscordantReading,
  type KindReading,
} from '@agentix-e/microglia-eval';
import { writeJson } from './lib.js';

const SOURCE = process.env['QUERY_DIFF_SOURCE'] ?? join('eval', 'results', 'poc-sota-bird-dev-R26-channels.json');
/** The documentation commit that registered the predictions and the refutation before this run. */
const REGISTERED = 'ROADMAP.md §R30 (microglia-docs 20e6154)';

type SourceCase = {
  readonly id: string;
  readonly fold: number;
  readonly dbId: string;
  readonly question: string;
  readonly evidence?: string | null;
  readonly goldSql?: string;
  readonly predictedSql: string;
  readonly baselineSql: string;
  readonly correct: boolean;
  readonly withoutMemoryCorrect: boolean;
  readonly difficulty?: string;
  readonly schemaTables?: { readonly kept: number; readonly total: number; readonly pruned: boolean };
  readonly packIdList?: readonly string[];
};

type SourceRule = {
  readonly id: string;
  readonly fold: number;
  readonly statement: string;
  readonly when?: string | null;
};

const source = JSON.parse(readFileSync(SOURCE, 'utf8')) as {
  readonly per_case?: readonly SourceCase[];
  readonly items?: readonly SourceRule[];
  readonly generated_at?: string;
};
const rows = source.per_case;
if (rows === undefined || rows.length === 0) {
  throw new Error(`${SOURCE} carries no per_case rows to classify`);
}

const cases: DiffCase[] = rows.map((entry) => ({
  id: entry.id,
  dbId: entry.dbId,
  delta: diffQueries(entry.baselineSql, entry.predictedSql, entry.question, entry.evidence),
  correct: entry.correct,
  withoutMemoryCorrect: entry.withoutMemoryCorrect,
}));

/** Labels in a fixed order so the artefact does not reorder itself when a count changes. */
const KIND_ORDER = ['unchanged', 'reworded', 'imported-name', 'narrowed', 'widened', 'reshaped', 'rewritten'];
const kinds: KindReading[] = KIND_ORDER.map((kind) => {
  const members = cases.filter((entry) => kindOf(entry.delta) === kind);
  return { kind, cell: cellOf(members), share: members.length / cases.length };
});

const relation = {
  unchanged: cases.filter((entry) => entry.delta.relation === 'unchanged').length,
  reworded: cases.filter((entry) => entry.delta.relation === 'reworded').length,
  edited: cases.filter((entry) => entry.delta.relation === 'edited').length,
};

const features = [
  featureOf(
    'F1',
    'memory query introduces a name that neither the baseline query nor the question contains (strict grounding)',
    cases,
    (delta) => delta.ungrounded.length > 0,
  ),
  featureOf(
    'F2',
    'the same, under morphological grounding — a question word of three letters is a prefix of the name',
    cases,
    (delta) => delta.ungroundedLoose.length > 0,
  ),
  featureOf(
    'F3',
    'memory query introduces a name that the question does contain (the comparison half of F1)',
    cases,
    (delta) => delta.ungrounded.length === 0 && delta.grounded.length > 0,
  ),
  featureOf(
    'F4',
    'memory query adds a table the baseline did not read',
    cases,
    (delta) => delta.tablesAdded.length > 0,
  ),
  featureOf(
    'F5',
    'memory query adds at least one conjunction, which is the narrowing direction',
    cases,
    (delta) => delta.conjunctionDelta > 0,
  ),
  featureOf(
    'F6',
    'the pack changed the query at all',
    cases,
    (delta) => delta.relation !== 'unchanged',
  ),
];

const discordant = cases.filter((entry) => entry.correct !== entry.withoutMemoryCorrect);
const bucketCounts: Record<string, number> = {
  unexplained: discordant.filter((entry) => entry.delta.ungrounded.length === 0).length,
};
for (const entry of discordant) {
  if (entry.delta.ungrounded.length === 0) continue;
  const kind = kindOf(entry.delta);
  bucketCounts[kind] = (bucketCounts[kind] ?? 0) + 1;
}
const largest = Object.entries(bucketCounts).sort((left, right) =>
  right[1] === left[1] ? (left[0] < right[0] ? -1 : 1) : right[1] - left[1],
)[0] as [string, number];
const discordantReading: DiscordantReading = {
  total: discordant.length,
  importing: discordant.length - bucketCounts['unexplained']!,
  unexplained: bucketCounts['unexplained']!,
  unexplainedShare: discordant.length === 0 ? 0 : bucketCounts['unexplained']! / discordant.length,
  largestBucket: largest[0],
  largestCount: largest[1],
};

const gates = [gateReadingOf(cases, 'strict'), gateReadingOf(cases, 'morphological')];
const reading = readQueryDiff({ cases, kinds, features, discordant: discordantReading, gates });

/**
 * Six features were tested, so one p-value below 0.05 is not five-hundredths of evidence.
 *
 * F1 and F2 are the same hypothesis under two grounding rules, so the family is five distinct
 * questions rather than six, and the threshold is `0.05 / 5`. Reported rather than applied: the
 * registered criterion `Q1` names a 0.05 bar and lowering it after the fact would be a criterion
 * rewritten to fit its result. Both numbers travel, and `survivors` is what a reader should use.
 */
const FAMILY = 5;
const bonferroniAlpha = 0.05 / FAMILY;
const multiplicity = {
  familySize: FAMILY,
  alpha: 0.05,
  bonferroniAlpha,
  survivors: features.filter((entry) => entry.fisherP < bonferroniAlpha).map((entry) => entry.code),
};

/** How often each imported name appears. Sorted by count then name, so the list is stable. */
const vocabulary = (() => {
  const counts = new Map<string, number>();
  for (const entry of cases) {
    for (const name of entry.delta.ungrounded) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => (right[1] === left[1] ? (left[0] < right[0] ? -1 : 1) : right[1] - left[1]))
    .slice(0, 20)
    .map(([name, count]) => ({ name, count }));
})();

/**
 * Identifiers a rule's text names, under a detector that can only see two spellings.
 *
 * A rule says `Free Meal Count (K-12)` in backticks or `atom_id` in snake case, and both are
 * unmistakably schema names. It also says "a numeric code column" and "the filter column", which
 * are unmistakably not — and nothing separates "reputation" spelled as a bare English word from
 * "reputation" spelled as a column. So the detector is deliberately narrow and its coverage is
 * reported beside its result: **14.0% of the 1,066 committed rules name at least one identifier**,
 * and the other 86% are invisible to it.
 *
 * That narrowness is the honest limit of the probe below, and it is why the probe is a probe. The
 * fix — a `names` field written at distillation time — is what R31 registers.
 */
function namedIdentifiers(text: string): readonly string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/`([^`]{2,60})`/g)) found.add((match[1] as string).trim().toLowerCase());
  for (const match of text.matchAll(/\b[a-z][a-z0-9]*_[a-z0-9_]+\b/g)) found.add(match[0].toLowerCase());
  return [...found];
}

/**
 * A rule's identity, which is the pair and not the id.
 *
 * The `id` an `items` row carries is reused across folds: `k_01hf7uaqrd_550r9` names four
 * unrelated rules in folds 0 to 3, one of them about numeric literals in `california_schools` and
 * another about integer division in `toxicology`. Keying a lookup by `id` alone therefore collapses
 * 1,066 rows into 229 keys and answers with whichever fold was read last, so every rule-text
 * reading below was being taken over the wrong sentences. The fold is what makes the lookup exact.
 */
const ruleKey = (fold: number, id: string): string => `${fold}:${id}`;
const ruleById = new Map((source.items ?? []).map((entry) => [ruleKey(entry.fold, entry.id), entry]));
const ruleNames = (fold: number, id: string): readonly string[] => {
  const rule = ruleById.get(ruleKey(fold, id));
  if (rule === undefined) return [];
  return namedIdentifiers(`${rule.statement} ${rule.when ?? ''}`);
};

/**
 * Does the pack's *text* name an identifier the question does not, before any query exists?
 *
 * This is the pre-treatment version of `F1`, and the only version of the gate that could ship
 * without a second generation: an admission filter that never lets such a rule in. Whether it is
 * the same question is an empirical matter, and the agreement table below answers it.
 */
const ruleLevel = (() => {
  const byId = new Map(cases.map((entry) => [entry.id, entry]));
  const flags = rows.map((entry) => {
    const context = contextTokens(entry.question, entry.evidence);
    const names = (entry.packIdList ?? []).flatMap((id) => ruleNames(entry.fold, id));
    const query = byId.get(entry.id);
    return {
      ruleFlag: names.some((name) => !isGrounded(name, context, 'strict')),
      queryFlag: query !== undefined && query.delta.ungrounded.length > 0,
    };
  });
  const withRule = cases.filter((_, at) => flags[at]?.ruleFlag === true);
  const withoutRule = cases.filter((_, at) => flags[at]?.ruleFlag !== true);
  const both = flags.filter((entry) => entry.ruleFlag && entry.queryFlag).length;
  const queryOnly = flags.filter((entry) => !entry.ruleFlag && entry.queryFlag).length;
  const ruleOnly = flags.filter((entry) => entry.ruleFlag && !entry.queryFlag).length;
  const allRules = source.items ?? [];
  const namedRules = allRules.filter((entry) => ruleNames(entry.fold, entry.id).length > 0).length;
  return {
    rules: allRules.length,
    rulesNaming: namedRules,
    namingShare: allRules.length === 0 ? 0 : namedRules / allRules.length,
    /**
     * The same share over the distinct sentences rather than the rows.
     *
     * `rules` counts rows across five folds, and a row is one fold's copy of a rule, so the row
     * count is about four times the number of rules a single run ever holds. The two shares are
     * reported together because they answer different questions — how much of the *pool* names an
     * identifier, and how much of what a *run sees* does — and here they agree, which is worth
     * knowing rather than assuming.
     */
    sentences: new Set(allRules.map((entry) => entry.statement.toLowerCase().replace(/\s+/g, ' ').trim())).size,
    sentencesNaming: new Set(
      allRules
        .filter((entry) => ruleNames(entry.fold, entry.id).length > 0)
        .map((entry) => entry.statement.toLowerCase().replace(/\s+/g, ' ').trim()),
    ).size,
    present: cellOf(withRule),
    absent: cellOf(withoutRule),
    agreement: {
      both,
      queryOnly,
      ruleOnly,
      neither: flags.length - both - queryOnly - ruleOnly,
      precision: both + ruleOnly === 0 ? null : both / (both + ruleOnly),
      recall: both + queryOnly === 0 ? null : both / (both + queryOnly),
    },
  };
})();

await writeJson('poc-query-diff', {
  id: 'poc-query-diff',
  title: 'What the pack did to the query, and whether it separates help from harm',
  // No `ranAt`: a classification makes no call and has no run time of its own, only the timestamp of
  // the measurement it re-reads. A clock here would also make the artefact impossible to recompute
  // byte for byte, which is the one check that keeps it honest.
  source: SOURCE,
  sourceGeneratedAt: source.generated_at ?? null,
  registered: REGISTERED,
  n: cases.length,
  relation,
  kinds,
  features,
  discordant: discordantReading,
  gates,
  multiplicity,
  ruleLevel,
  vocabulary,
  criteria: reading.criteria,
  confirmed: reading.confirmed,
  refuted: reading.refuted,
  /**
   * The registered third category, and why it is absent rather than approximated.
   *
   * `ROADMAP.md` §R30 asks for "a table or column the rule named that the schema had pruned". The
   * record this file re-reads stores the schema candidate as `schemaTables: { kept, total, pruned }`
   * — three numbers — so the category cannot be evaluated on it. F4 is adjacent and is not the same
   * question: it says a *table was added*, not that the pack named one the pruning removed.
   * Substituting it would answer a different question under the same name, which is the defect this
   * project has spent a round removing elsewhere. The lane now writes `keptNames`, `prunedTables`
   * and `prunedColumns` beside the counts (R30 stage 1b), so the category becomes readable on the
   * next dispatch — this record predates the field, and a reading cannot borrow it retroactively.
   */
  unmeasured: [
    {
      category: 'pruned-name',
      registered: 'a table or column the rule named that the schema had pruned',
      reason:
        'the committed record predates the name fields; per_case carries schemaTables as counts (kept, total, pruned) only',
      nearest: 'F4',
      difference: 'F4 measures a table added to the query, not a name the pruning removed from the schema',
    },
  ],
  notes: [
    'The classifier reads the two candidate queries, the question and the evidence — the same inputs the model saw — and never the gold SQL, the gold result or the scorer. A covariate that peeked would separate help from harm by construction.',
    'F1 reads the emitted query and is therefore post-treatment: it can describe what happened but it cannot be applied before a query exists. ruleLevel is the pre-treatment version — does the pack text name an identifier the question does not — and it is the only form of the gate that could ship as an admission filter without a second generation. It is reported separately from features because it is a different hypothesis with a different implementation cost, not a seventh variant of F1.',
    'Six features were tested and two survive a Bonferroni threshold of 0.05/5; F1 and F2 are one hypothesis under two grounding rules, so the family is five and not six. The registered criterion Q1 names 0.05 and is left at 0.05 — the adjusted threshold travels beside it rather than replacing it, because a bar lowered after the result is not a bar.',
    'F1 is the primary test. F2 repeats it under a looser grounding rule so that the choice of rule is visible: a separation that survives both is not an artefact of the tokeniser, and one that survives only F1 is.',
    'harmedPerCorrectPp is the stratified rate: damage as a share of questions the no-memory arm already answered correctly. Stratifying on a pre-treatment outcome removes the difficulty confound, because both groups are compared inside a fixed baseline outcome. The importing group is the harder one and still loses, so the confound points against the finding rather than for it.',
    'Q5 is an in-sample estimate and is labelled as such. The filter was chosen by looking at these 1,534 questions; stage 2 buys the sample that can confirm it, and until then the gate is a measurement, not a shipped behaviour.',
    'Cases whose two queries are identical cannot flip by construction, so the 129 discordant cases all come from the edited half. That is a property of the record, not a finding, and it is why every rate here is also reported over the whole corpus rather than over the edited subset.',
    'A group with no discordant pair has an infinite minimum detectable difference rather than a missing one, and JSON renders infinity as null. The 692 questions the pack left untouched are the only place it occurs; helped + harmed === 0 is what distinguishes it from an empty group.',
    'Regression is exact rather than modelled: for a discarded question the no-pack query and its outcome are already columns in the record, so the gated arm reads them instead of predicting them.',
  ],
});

const pct = (value: number | null, digits = 2): string => (value === null ? 'n/a' : value.toFixed(digits));
process.stdout.write(
  `[query-diff] ${cases.length} cases: ${relation.unchanged} unchanged, ${relation.reworded} reworded, ${relation.edited} edited\n`,
);
for (const row of kinds) {
  process.stdout.write(
    `[query-diff] ${row.kind.padEnd(13)} n=${String(row.cell.n).padStart(4)} ` +
      `${String(row.cell.helped).padStart(3)}+/${String(row.cell.harmed).padStart(3)}- ` +
      `delta=${pct(row.cell.deltaPp).padStart(7)}pp ±${pct(row.cell.halfWidthPp, 2).padStart(5)} ` +
      `base=${pct(row.cell.baselineAccuracy * 100, 1)}%\n`,
  );
}
for (const feature of features) {
  process.stdout.write(
    `[query-diff] ${feature.code} n=${String(feature.present.n).padStart(4)} ` +
      `delta=${pct(feature.present.deltaPp).padStart(7)}pp vs ${pct(feature.absent.deltaPp).padStart(7)}pp ` +
      `gap=${pct(feature.gapPp).padStart(7)}pp ±${pct(feature.gapHalfWidthPp, 2).padStart(5)} ` +
      `clustered[${pct(feature.clusterLowPp)}, ${pct(feature.clusterHighPp)}] p=${feature.fisherP.toFixed(4)} ` +
      `${feature.resolves ? 'RESOLVES' : 'under its own resolution'}\n`,
  );
}
for (const gate of gates) {
  process.stdout.write(
    `[query-diff] gate/${gate.mode} discards ${gate.discarded} (${(gate.discardedShare * 100).toFixed(1)}%): ` +
      `${pct(gate.measured.deltaPp)}pp → ${pct(gate.gated.deltaPp)}pp, ` +
      `mde ${pct(gate.gated.minDetectablePp)}pp, p=${gate.p.toFixed(4)}\n`,
  );
}
const share = (value: number | null): string => (value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`);
const point = (value: number | null): string => (value === null ? 'n/a' : value.toFixed(2));
process.stdout.write(
  `[query-diff] rule-level: ${ruleLevel.present.n} of ${cases.length} flagged ` +
    `(${((ruleLevel.present.n / cases.length) * 100).toFixed(1)}%), delta ${point(ruleLevel.present.deltaPp)}pp ` +
    `vs ${point(ruleLevel.absent.deltaPp)}pp; agreement with F1 both=${ruleLevel.agreement.both} ` +
    `queryOnly=${ruleLevel.agreement.queryOnly} ruleOnly=${ruleLevel.agreement.ruleOnly} ` +
    `precision=${share(ruleLevel.agreement.precision)} recall=${share(ruleLevel.agreement.recall)}; ` +
    `${ruleLevel.rulesNaming} of ${ruleLevel.rules} rules name anything at all\n`,
);
process.stdout.write(
  `[query-diff] multiplicity: ${multiplicity.familySize} hypotheses, Bonferroni alpha ${bonferroniAlpha.toFixed(5)}, ` +
    `survivors ${multiplicity.survivors.join(',') || 'none'}\n`,
);
for (const criterion of reading.criteria) {
  process.stdout.write(`[query-diff] ${criterion.ok ? 'pass' : 'FAIL'} ${criterion.code} — ${criterion.actual}\n`);
}
process.stdout.write(
  `[query-diff] ${reading.refuted ? 'refuted' : 'not refuted'}: confirmed ${reading.confirmed.join(',') || 'none'}\n`,
);
