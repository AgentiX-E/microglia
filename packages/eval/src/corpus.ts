/**
 * Read a committed public-benchmark artefact into the shape the offline readings consume.
 *
 * Every reading this project computes after a dispatch is arithmetic over one JSON file, and each
 * of them used to carry its own copy of the same four lines: find `per_case`, map the fields, join
 * the rules. Two copies of a join drift, and the drift is invisible because both versions keep
 * producing numbers. This module is the one join.
 *
 * Two decisions are made here rather than in each reader, and both are recorded in the loaded
 * corpus rather than left to be re-derived:
 *
 *  - **What the pack's text was.** `injected` holds `${statement} ${when}` for every item that
 *    reached the prompt, written by the lane that wrote the prompt. It is the literal text the
 *    model read, so it is preferred. An artefact from before that field existed carries only the
 *    ids, and those are resolved against `items` — the same text reconstructed from the store,
 *    which is a *different* claim (what the item says now) and is marked as such by
 *    `packTextSource` so a reader can tell which one it has.
 *  - **What "the name existed" means.** `execOk === true` says the emitted query ran, and a query
 *    that ran cannot have named a column the schema does not have. `execOk === false` does **not**
 *    say the name was invented — a statement can fail to execute for a dozen reasons that have
 *    nothing to do with its identifiers — so the three-way reading needs that third bucket and
 *    must not collapse it into "invented". An artefact with no `execOk` at all leaves every case
 *    in that bucket, which is why the count is reported rather than assumed.
 */
import type { DiffCase } from './query-diff.js';
import { diffQueries, type QueryDelta } from '@agentix-e/microglia-sql';

/** One case as the lane wrote it. Every field is optional except the ones a diff needs. */
export type CommittedCase = {
  readonly id: string;
  readonly dbId: string;
  readonly question: string;
  readonly evidence?: string | null;
  readonly predictedSql: string;
  readonly baselineSql: string;
  readonly correct: boolean;
  readonly withoutMemoryCorrect: boolean;
  /** Whether the emitted query executed. Absent means the artefact predates the field. */
  readonly execOk?: boolean | null;
  /** The pack's rendered text, item by item: `${statement} ${when ?? ''}`. */
  readonly injected?: readonly string[] | null;
  readonly packIdList?: readonly string[] | null;
};

/** One learned item, as the store committed it. */
export type CommittedRule = {
  readonly id: string;
  readonly statement: string;
  readonly when?: string | null;
};

export type CommittedArtefact = {
  readonly per_case?: readonly CommittedCase[] | null;
  readonly items?: readonly CommittedRule[] | null;
  readonly generated_at?: string | null;
};

/** Which of the two sources the pack text came from. */
export type PackTextSource = 'injected' | 'reconstructed' | 'none';

/** The two projections of one artefact: the diff inputs, and the diff plus its provenance. */
export type LoadedCorpus = {
  readonly cases: readonly DiffCase[];
  readonly mediation: readonly MediationEntry[];
  readonly generatedAt: string | null;
  /** How many of the cases had their pack text rebuilt from the store rather than read. */
  readonly reconstructed: number;
  /** Cases with no pack text at all, which no attribution can say anything about. */
  readonly withoutPackText: number;
};

/** A case with the two extra columns the mediation needs: what the pack said, and whether it ran. */
export type MediationEntry = {
  readonly id: string;
  readonly dbId: string;
  readonly delta: QueryDelta;
  readonly correct: boolean;
  readonly withoutMemoryCorrect: boolean;
  readonly packText: string;
  readonly packTextSource: PackTextSource;
  readonly executed: boolean;
};

/**
 * The pack text for one case, and where it came from.
 *
 * `injected` wins when it is present and non-empty. An empty array is not the same as an absent
 * one — it means the lane looked and the prompt carried no rule, which is a real population on this
 * corpus (45.1% of dev is untouched by the pack) — so an empty `injected` falls through to the
 * ids only when there are ids to resolve.
 */
export function packTextOf(
  entry: CommittedCase,
  rules: ReadonlyMap<string, CommittedRule>,
): { readonly text: string; readonly source: PackTextSource } {
  const injected = entry.injected ?? [];
  if (injected.length > 0) return { text: injected.join('\n'), source: 'injected' };
  const ids = entry.packIdList ?? [];
  const parts: string[] = [];
  for (const id of ids) {
    const rule = rules.get(id);
    if (rule === undefined) continue;
    parts.push(`${rule.statement} ${rule.when ?? ''}`.trim());
  }
  if (parts.length === 0) return { text: '', source: 'none' };
  return { text: parts.join('\n'), source: 'reconstructed' };
}

/**
 * Project a committed artefact into everything the offline readings need.
 *
 * Throws on an artefact with no `per_case` rows rather than returning an empty corpus. An empty
 * corpus manufactures a hundred well-formed zeroes — every rate `null`, every criterion `false`,
 * every artefact written — and a run that silently measured nothing is the failure mode this
 * project has spent the most rounds removing.
 */
export function corpusOf(artefact: CommittedArtefact): LoadedCorpus {
  const rows = artefact.per_case;
  if (rows === undefined || rows === null || rows.length === 0) {
    throw new Error('The artefact carries no per_case rows to read');
  }
  const rules = new Map<string, CommittedRule>();
  for (const rule of artefact.items ?? []) rules.set(rule.id, rule);

  const cases: DiffCase[] = [];
  const mediation: MediationEntry[] = [];
  let reconstructed = 0;
  let withoutPackText = 0;
  for (const row of rows) {
    const delta = diffQueries(row.baselineSql, row.predictedSql, row.question, row.evidence);
    cases.push({
      id: row.id,
      dbId: row.dbId,
      delta,
      correct: row.correct,
      withoutMemoryCorrect: row.withoutMemoryCorrect,
    });
    const pack = packTextOf(row, rules);
    if (pack.source === 'reconstructed') reconstructed += 1;
    if (pack.source === 'none') withoutPackText += 1;
    mediation.push({
      id: row.id,
      dbId: row.dbId,
      delta,
      correct: row.correct,
      withoutMemoryCorrect: row.withoutMemoryCorrect,
      packText: pack.text,
      packTextSource: pack.source,
      executed: row.execOk === true,
    });
  }
  return {
    cases,
    mediation,
    generatedAt: artefact.generated_at ?? null,
    reconstructed,
    withoutPackText,
  };
}
