/**
 * Is the pack about *this* case?
 *
 * Two rounds of this record have now measured what the pack *covers* and found nothing: AM.15 read
 * the pack's lexical coverage of the question against the outcome and got a null, and R31 read
 * whether it names the identifier the query imports and got a null. Both asked how much of the
 * question the memory touches. Neither asked whether the memory says something the answer
 * contradicts, which is the axis the 2026 literature puts the harm on:
 *
 *  - **Coverage-Calibrated Evaluation of Memory Interventions (NeurIPS 2026)** — relevance does not
 *    reveal sign: a similarity score and an LLM judge rank *harmful* cases no better than chance.
 *  - **Obsolete facts in agent memory (FactConsolidation)** — with the prompt frozen, one competing
 *    statement takes accuracy from 100% to 44.6%. Competing content is not noise with a bad score;
 *    it is a different failure.
 *  - **Memory Tax (arXiv 2610.34073)** — most dedicated memory systems lose to raw retrieval, and the
 *    loss is accounted to construction: 11.4–22.6% of sampled facts partially or wholly lost, up to
 *    38.0% never stored.
 *
 * This module asks two questions that a committed artefact can answer without a model call, a gold
 * annotation, or a judge:
 *
 * 1. **Denial.** Does a delivered statement tell the executor *not* to do something the gold query
 *    does? `without DISTINCT`, `not be wrapped in a CAST`, `rather than COUNT(*)`, `left unaliased`.
 *    Each rule below binds a negation cue to a construct within a small phrase, and the construct is
 *    then looked for in the gold's shape. This is the only direction that prose states unambiguously:
 *    a bare mention of `join` is not an instruction to join, but "without joining" is an instruction
 *    not to. That asymmetry is why the census does not attempt the converse reading — "the pack
 *    prescribes X and the gold does not do X" — and says so rather than guessing it.
 *
 * 2. **Circulation.** How far does a statement travel? The statements in the store were distilled
 *    from other cases, and a lesson distilled in `hockey` that arrives in `student_loan` is not a
 *    near-miss of the question, it is content about a schema the case does not have. Circulation is
 *    counted exactly: a statement's spread is the number of **databases** whose cases received it,
 *    and a case's boilerplate share is the fraction of its statements whose spread is at least two.
 *
 * Both readings are outcome-blind. The denial reading looks at the pack and the gold query; the
 * circulation reading looks at the pack and at which other cases received it. Neither reads
 * `correct`, which is what makes the stratification below a test rather than a description: if the
 * harm is carried by denials, the contradicted stratum must be worse than the rest, and if it is
 * carried by circulation, the all-boilerplate stratum must be worse than the singleton stratum.
 *
 * Neither reading can be computed at serve time — the gold is not available then. That is not an
 * objection to measuring: the store *is* available at serve time, so circulation is directly
 * actionable (a filter), and the denial reading prices the mechanism that a filter would be aimed at.
 */
import { sqlShapeOf, tokenizeSql } from '@agentix-e/microglia-sql';
import { clusterBootstrapStatistic, type ResampledInterval } from './stats.js';

/** The constructs a sentence can deny. Fixed here so a table cannot quietly omit one. */
export const CONSTRUCTS = [
  'distinct',
  'cast',
  'select-alias',
  'count-star',
  'order-by',
  'like',
  'round',
  'subquery',
  'limit',
  'join',
  'union',
] as const;

export type ConstructName = (typeof CONSTRUCTS)[number];

/**
 * One denial rule: a cue, a construct, and the phrase that binds them.
 *
 * The patterns are deliberately narrow. A window-based reader — "the cue, then whatever identifier
 * appears within k tokens" — was tried first and bound `a join problem`, `the joined result` and
 * `not DISTINCT from` to constructs the sentence was not denying; on the dev corpus it called 1,092
 * of 1,534 cases contradicted, which is a description of English rather than of the pack. Each
 * pattern here admits only connectives (`using`, `be`, `wrapped in`, an article) between the cue and
 * the construct, so a word that changes the phrase stops the match.
 *
 * `form` names the phrase family, not the match, because two sentences that deny `DISTINCT` with
 * different wording are one finding and the artefact should show one row for them.
 */
export type DenialRule = {
  readonly construct: ConstructName;
  readonly form: string;
  readonly pattern: RegExp;
};

export const DENIAL_RULES: readonly DenialRule[] = [
  {
    construct: 'distinct',
    form: 'not/without DISTINCT',
    pattern:
      /\b(?:not|never|without|avoid(?:s|ing)?|instead of|rather than|excluding)\s+(?:using\s+|use\s+)?(?:the\s+)?distinct\b/gi,
  },
  {
    construct: 'cast',
    form: 'not/without CAST',
    pattern:
      /\b(?:not|never|without|avoid(?:s|ing)?|instead of|rather than)\s+(?:be\s+|being\s+)?(?:wrapped\s+in\s+|wrap\s+in\s+|using\s+|use\s+)?(?:an?\s+)?cast\b/gi,
  },
  {
    construct: 'select-alias',
    form: 'unaliased/without an alias',
    pattern: /\bunaliased\b|\b(?:not|never|without|avoid(?:s|ing)?)\s+(?:an?\s+)?alias\w*\b|\bno\s+alias\b/gi,
  },
  {
    construct: 'count-star',
    form: 'not/rather than COUNT(*)',
    pattern: /\b(?:not|never|without|avoid(?:s|ing)?|instead of|rather than)\s+(?:using\s+)?count\s*\(\s*\*\s*\)/gi,
  },
  {
    construct: 'order-by',
    form: 'not/without ORDER BY',
    pattern: /\b(?:not|never|without|avoid(?:s|ing)?|instead of|rather than)\s+(?:an?\s+)?order(?:s|ed|ing)?\s+by\b/gi,
  },
  {
    construct: 'like',
    form: 'not/without LIKE',
    pattern: /\b(?:not|never|without|avoid(?:s|ing)?|instead of|rather than)\s+(?:an?\s+|using\s+|use\s+)?like\b/gi,
  },
  {
    construct: 'round',
    form: 'not/without ROUND',
    pattern: /\b(?:not|never|without|avoid(?:s|ing)?)\s+(?:using\s+)?round\w*\b/gi,
  },
  {
    construct: 'subquery',
    form: 'not/without a subquery',
    pattern: /\b(?:not|never|without|avoid(?:s|ing)?)\s+(?:an?\s+)?subquer(?:y|ies)\b/gi,
  },
  {
    construct: 'limit',
    form: 'not/without LIMIT',
    pattern: /\b(?:not|never|without|avoid(?:s|ing)?)\s+(?:an?\s+)?limit\b/gi,
  },
  {
    construct: 'join',
    form: 'not/without joining',
    pattern: /\b(?:not|never|without|avoid(?:s|ing)?|instead of|rather than)\s+(?:joining|join)\b/gi,
  },
  {
    construct: 'union',
    form: 'not/without UNION',
    pattern: /\b(?:not|never|without|avoid(?:s|ing)?)\s+(?:an?\s+)?union\b/gi,
  },
];

/** One denial a statement makes, with the phrase that carried it. */
export type Denial = {
  readonly construct: ConstructName;
  readonly form: string;
  /** The matched text, lower-cased: what a reader would quote to check the rule fired correctly. */
  readonly text: string;
  /**
   * True when the sentence carries a subordinator (`when`, `if`, `unless`, `whenever`).
   *
   * Most of this store's denials are conditional — "left unaliased **when** the question does not
   * name an output column label" — and the antecedent is about the question, which the census could
   * compare but does not: parsing an antecedent into a predicate over the question is a second
   * classifier with its own error rate, and a census is only as strong as its weakest reader. So the
   * conditional denials are counted, published, and reported in a second reading rather than mixed
   * into the first.
   */
  readonly conditional: boolean;
  /**
   * True when the sentence is a **warning about the wrong method** rather than a prescription.
   *
   * "Counting rows from the incidents table **without joining** and grouping by case does not measure
   * how many officers were involved" is not advice to avoid joining; it is advice that a particular
   * shortcut fails, and the gold query joins. Read as a prescription, it inverts: the sentence tells
   * the executor to do exactly what the gold does. Half of the first pass's hits were this shape —
   * hand-audited on eight, four were warnings and one bound to the wrong object — which is why the
   * flag exists instead of a wider window: a census whose reader inverts one sentence in two measures
   * the reader.
   *
   * The markers are a closed list of failure predicates. They are not a parser, and the limitation is
   * published with the counts rather than argued away.
   */
  readonly warning: boolean;
};

/** Sentence bounds, so `conditional` is decided inside the proposition the denial lives in. */
const SENTENCE_BREAK = /[.;]\s+/g;
const SUBORDINATORS = /\b(?:when|whenever|if|unless)\b/i;

/**
 * The predicates that turn a sentence into a warning about the wrong method.
 *
 * Closed and short on purpose: every phrase here describes a failure ("does not measure", "inflates",
 * "drops rows"), and a sentence that carries one is telling the executor what *not to try* rather
 * than what to do. A wider list would start scoring ordinary advice as a warning, which moves a
 * sentence from the contradicted stratum to the ignored one without any evidence.
 */
const WARNING_MARKERS =
  /\b(?:does not|do not|will not|cannot|fails? to|is wrong|incorrect|misleading|inflates?|overcounts?|undercounts?|drops? rows|duplicates? rows)\b/i;

/**
 * Whether the sentence holding `at` is conditional.
 *
 * The sentence is found by bracketing the offset between two breaks rather than by splitting and
 * counting characters, because a split loses the offsets and a reader of this function should be
 * able to see that every offset maps to exactly one sentence.
 */
function sentenceAt(statement: string, at: number): string {
  let start = 0;
  let end = statement.length;
  for (const brk of statement.matchAll(SENTENCE_BREAK)) {
    if (brk.index < at) start = brk.index + brk[0].length;
    else {
      end = brk.index;
      break;
    }
  }
  return statement.slice(start, end);
}

/**
 * The denials a statement makes.
 *
 * Every occurrence is reported, because a sentence that says "without DISTINCT" twice has made the
 * denial twice and the count is a count. Duplicates are collapsed where they matter — in the list of
 * contradicted constructs a case publishes — rather than here, where collapsing would hide the
 * arithmetic from a reader checking the total.
 */
export function denialsOf(statement: string): readonly Denial[] {
  const found: Denial[] = [];
  for (const rule of DENIAL_RULES) {
    // A fresh expression per call: `lastIndex` on a shared global regex is state that survives
    // between cases, which is how one sentence silently inherits the previous one's scan position.
    const expression = new RegExp(rule.pattern.source, 'gi');
    for (const match of statement.matchAll(expression)) {
      const sentence = sentenceAt(statement, match.index);
      found.push({
        construct: rule.construct,
        form: rule.form,
        text: match[0].toLowerCase(),
        conditional: SUBORDINATORS.test(sentence),
        warning: WARNING_MARKERS.test(sentence),
      });
    }
  }
  return found;
}

/** Type names that follow `AS` inside a `CAST`, which is not an output alias. */
const TYPE_NAMES: ReadonlySet<string> = new Set([
  'real',
  'integer',
  'text',
  'numeric',
  'blob',
  'varchar',
  'char',
  'date',
  'datetime',
  'boolean',
  'float',
  'double',
  'decimal',
]);

/**
 * The constructs a query *uses*.
 *
 * Read from the shared shape rather than by matching the statement's text, so a construct named
 * inside a string literal is not counted: `WHERE label = 'distinct'` is a value, and a census that
 * counted it would report a denial contradicted by a word.
 *
 * `select-alias` is the one construct `sqlShapeOf` does not separate, because it reports `as` as a
 * token and an alias as neither a column nor a clause. It is read here over the same tokens: an
 * `AS` in the top-level select list, followed by a name that is not a type, is an output alias.
 */
export function constructsOf(sql: string): ReadonlySet<ConstructName> {
  const shape = sqlShapeOf(sql);
  const tokens = tokenizeSql(sql);
  const used = new Set<ConstructName>();
  const clauses = new Set(shape.clauses);
  if (clauses.has('distinct')) used.add('distinct');
  if (clauses.has('order')) used.add('order-by');
  if (clauses.has('like')) used.add('like');
  if (clauses.has('limit')) used.add('limit');
  if (clauses.has('join')) used.add('join');
  if (clauses.has('union')) used.add('union');
  if (shape.subqueries > 0) used.add('subquery');

  for (const [at, token] of tokens.entries()) {
    if (token.kind !== 'word') continue;
    if (token.text === 'cast') used.add('cast');
    if (token.text === 'round' && tokens[at + 1]?.text === '(') used.add('round');
    if (token.text === 'count' && tokens[at + 1]?.text === '(' && tokens[at + 2]?.text === '*') {
      used.add('count-star');
    }
  }

  // The select list ends at the first top-level `from`; an `AS` beyond it names a table or a CTE.
  let selectEnd = tokens.length;
  for (const [at, token] of tokens.entries()) {
    if (token.kind === 'word' && token.text === 'from' && token.depth === 0) {
      selectEnd = at;
      break;
    }
  }
  for (let at = 0; at < selectEnd; at += 1) {
    const token = tokens[at];
    if (token === undefined || token.kind !== 'word' || token.text !== 'as' || token.depth !== 0) continue;
    const next = tokens[at + 1];
    if (next !== undefined && next.kind === 'word' && !TYPE_NAMES.has(next.text)) used.add('select-alias');
  }

  return used;
}

/** What one case's pack denies, and how much of it the gold contradicts. */
export type DenialReading = {
  /** Denials found in the delivered statements, whether or not the gold uses the construct. */
  readonly denials: number;
  /** Of those, the sentences that warn about the wrong method instead of prescribing one. */
  readonly warnings: number;
  /** Prescriptive denials whose construct the gold query uses. */
  readonly hits: number;
  /** Hits in a sentence with no subordinator: the strict reading. */
  readonly strict: number;
  /** The constructs that were both denied and used, with the phrase, sorted for a stable artefact. */
  readonly contradicted: readonly { readonly construct: ConstructName; readonly form: string }[];
};

/**
 * Read one pack against the query that answers the case.
 *
 * A denial of a construct the gold does not use is not a hit, and is not counted as agreement
 * either: the store says "without DISTINCT" and the gold has no `DISTINCT`, which is consistent
 * with the gold but is not evidence the statement was about this case. The census keeps the three
 * counts apart — denials, hits, strict hits — so that a reader can see the denominator.
 */
export function denialReadingOf(
  statements: readonly string[],
  goldSql: string,
): DenialReading {
  const used = constructsOf(goldSql);
  let denials = 0;
  let warnings = 0;
  let hits = 0;
  let strict = 0;
  const contradicted: { construct: ConstructName; form: string }[] = [];
  const seen = new Set<string>();
  for (const statement of statements) {
    for (const denial of denialsOf(statement)) {
      denials += 1;
      if (denial.warning) {
        warnings += 1;
        continue;
      }
      if (!used.has(denial.construct)) continue;
      hits += 1;
      if (!denial.conditional) strict += 1;
      const key = `${denial.construct}\u0000${denial.form}`;
      if (seen.has(key)) continue;
      seen.add(key);
      contradicted.push({ construct: denial.construct, form: denial.form });
    }
  }
  contradicted.sort((left, right) => left.construct.localeCompare(right.construct));
  return { denials, warnings, hits, strict, contradicted };
}

/**
 * How far each statement travels, in databases.
 *
 * The unit is the database and not the case, because every case in one database shares a schema: a
 * statement delivered to two cases in `california_schools` is about a schema those cases have, and
 * the same statement delivered to `hockey` and `student_loan` is about neither. `hockey` and
 * `student_loan` is exactly what the store does — one product-and-cost-history lesson appears in
 * both — which is why the count is per database rather than per case.
 */
export type Spread = {
  readonly cases: number;
  readonly databases: number;
};

export function spreadOf(rows: readonly PackCopyRow[]): ReadonlyMap<string, Spread> {
  const cases = new Map<string, number>();
  const databases = new Map<string, Set<string>>();
  for (const row of rows) {
    for (const statement of new Set(row.statements)) {
      cases.set(statement, (cases.get(statement) ?? 0) + 1);
      const seen = databases.get(statement) ?? new Set<string>();
      seen.add(row.cluster);
      databases.set(statement, seen);
    }
  }
  const spread = new Map<string, Spread>();
  for (const [statement, count] of cases) {
    spread.set(statement, { cases: count, databases: (databases.get(statement) as Set<string>).size });
  }
  return spread;
}

/** One case, as this census reads it. */
export type PackCopyRow = {
  readonly cluster: string;
  readonly correct: boolean;
  readonly withoutMemoryCorrect: boolean;
  /** The statements the pack delivered, deduplicated: a repeated sentence is one statement. */
  readonly statements: readonly string[];
  /** The query that answers the case. Read by the denial axis and by nothing else. */
  readonly goldSql: string;
};

/**
 * The share of a case's statements that reached another database, in [0, 1].
 *
 * `null` when the case received nothing, because a pack of no statements has no composition and
 * scoring it as 0 would put every empty pack in the clean stratum — the direction that flatters the
 * store.
 */
export function boilerplateShareOf(statements: readonly string[], spread: ReadonlyMap<string, Spread>): number | null {
  const unique = [...new Set(statements)];
  if (unique.length === 0) return null;
  let crossed = 0;
  for (const statement of unique) {
    const entry = spread.get(statement);
    if (entry !== undefined && entry.databases >= 2) crossed += 1;
  }
  return crossed / unique.length;
}

/** The three strata the circulation reading uses, fixed so a table cannot add a fourth later. */
export const CIRCULATION_STRATA = ['none', 'mixed', 'all'] as const;
export type CirculationStratum = (typeof CIRCULATION_STRATA)[number];

export function circulationStratumOf(share: number | null): CirculationStratum {
  if (share === null || share === 0) return 'none';
  return share === 1 ? 'all' : 'mixed';
}

/** One case with the two readings that classify it, built once so no predicate re-reads the pack. */
type Entry = {
  readonly row: PackCopyRow;
  readonly reading: DenialReading;
  readonly share: number | null;
  readonly stratum: CirculationStratum;
};

function deltaPpOf(entries: readonly Entry[]): number {
  let net = 0;
  for (const entry of entries) {
    if (entry.row.correct !== entry.row.withoutMemoryCorrect) net += entry.row.correct ? 1 : -1;
  }
  return (net / entries.length) * 100;
}

/** A stratum's delta and its clustered interval; `null` when the stratum is empty. */
function carve(
  entries: readonly Entry[],
  keep: (entry: Entry) => boolean,
  resamples: number,
): { readonly n: number; readonly delta: number | null; readonly interval: ResampledInterval | null } {
  const subset = entries.filter(keep);
  if (subset.length === 0) return { n: 0, delta: null, interval: null };
  return {
    n: subset.length,
    delta: deltaPpOf(subset),
    interval: clusterBootstrapStatistic(subset, (entry) => entry.row.cluster, (drawn) => deltaPpOf(drawn), resamples),
  };
}

/**
 * The gap between two strata, with a clustered interval over the whole corpus.
 *
 * Resampling inside a stratum would answer a different question: the draws would be conditioned on
 * a label the stratification derived from the same rows, and the interval would be too narrow
 * because it never sees a corpus in which the strata have different sizes. So the resampling unit
 * is the corpus — clusters are drawn, both strata are recomputed in the draw, and a draw that loses
 * one of them is dropped and counted.
 */
function carveGap(
  entries: readonly Entry[],
  left: (entry: Entry) => boolean,
  right: (entry: Entry) => boolean,
  resamples: number,
): ResampledInterval | null {
  return clusterBootstrapStatistic(
    entries,
    (entry) => entry.row.cluster,
    (drawn) => {
      const a = drawn.filter(left);
      const b = drawn.filter(right);
      if (a.length === 0 || b.length === 0) return null;
      return deltaPpOf(a) - deltaPpOf(b);
    },
    resamples,
  );
}

/** One source's census: the denial reading and the circulation reading over the same rows. */
export type CopyCensus = {
  readonly source: string;
  readonly n: number;
  readonly clusters: number;
  /** Delivered statements, deduplicated within a case and then across the corpus. */
  readonly statements: number;
  /** Statements delivered to at least two databases: the ones that are not about this schema. */
  readonly circulating: number;
  readonly withDenial: number;
  /** Denial sentences across the corpus, and how many of them were warnings about the wrong method. */
  readonly denials: number;
  readonly warnings: number;
  readonly withHit: number;
  readonly withStrict: number;
  readonly deniedDelta: number | null;
  readonly deniedInterval: ResampledInterval | null;
  readonly cleanDelta: number | null;
  readonly cleanInterval: ResampledInterval | null;
  readonly denialGap: ResampledInterval | null;
  readonly strictGap: ResampledInterval | null;
  readonly circulation: readonly {
    readonly stratum: CirculationStratum;
    readonly n: number;
    readonly delta: number | null;
    readonly interval: ResampledInterval | null;
  }[];
  readonly circulationGap: ResampledInterval | null;
  /** The constructs denied and found in the gold, summed over cases, most frequent first. */
  readonly contradicted: readonly { readonly construct: ConstructName; readonly cases: number }[];
  readonly statement: string;
};

const RESAMPLES = 2_000;

function assertRows(rows: readonly PackCopyRow[], source: string): void {
  if (rows.length === 0) throw new Error(`${source} carries no cases`);
  for (const row of rows) {
    if (typeof row.cluster !== 'string' || row.cluster === '') {
      throw new Error(`${source} has a case without a database, so it has no cluster`);
    }
    if (typeof row.correct !== 'boolean' || typeof row.withoutMemoryCorrect !== 'boolean') {
      throw new Error(`${source} has a case that does not carry both arms' outcomes`);
    }
  }
}

export function copyCensusOf(
  source: string,
  rows: readonly PackCopyRow[],
  resamples = RESAMPLES,
): CopyCensus {
  assertRows(rows, source);
  const spread = spreadOf(rows);
  const entries: Entry[] = rows.map((row) => {
    const share = boilerplateShareOf(row.statements, spread);
    return {
      row,
      reading: denialReadingOf(row.statements, row.goldSql),
      share,
      stratum: circulationStratumOf(share),
    };
  });

  const contradictions = carve(entries, (entry) => entry.reading.hits > 0, resamples);
  const rest = carve(entries, (entry) => entry.reading.hits === 0, resamples);

  const counts = new Map<ConstructName, number>();
  for (const entry of entries) {
    for (const construct of new Set(entry.reading.contradicted.map((item) => item.construct))) {
      counts.set(construct, (counts.get(construct) ?? 0) + 1);
    }
  }

  const census: Omit<CopyCensus, 'statement'> = {
    source,
    n: rows.length,
    clusters: new Set(rows.map((row) => row.cluster)).size,
    statements: spread.size,
    circulating: [...spread.values()].filter((entry) => entry.databases >= 2).length,
    withDenial: entries.filter((entry) => entry.reading.denials > 0).length,
    denials: entries.reduce((sum, entry) => sum + entry.reading.denials, 0),
    warnings: entries.reduce((sum, entry) => sum + entry.reading.warnings, 0),
    withHit: contradictions.n,
    withStrict: entries.filter((entry) => entry.reading.strict > 0).length,
    deniedDelta: contradictions.delta,
    deniedInterval: contradictions.interval,
    cleanDelta: rest.delta,
    cleanInterval: rest.interval,
    denialGap: carveGap(entries, (entry) => entry.reading.hits > 0, (entry) => entry.reading.hits === 0, resamples),
    strictGap: carveGap(entries, (entry) => entry.reading.strict > 0, (entry) => entry.reading.strict === 0, resamples),
    circulation: CIRCULATION_STRATA.map((stratum) => ({
      stratum,
      ...carve(entries, (entry) => entry.stratum === stratum, resamples),
    })),
    circulationGap: carveGap(
      entries,
      (entry) => entry.stratum === 'all',
      (entry) => entry.stratum === 'none',
      resamples,
    ),
    contradicted: [...counts.entries()]
      .map(([construct, cases]) => ({ construct, cases }))
      .sort((left, right) => right.cases - left.cases || left.construct.localeCompare(right.construct)),
  };

  return { ...census, statement: statementOf(census) };
}

function pp(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}pp`;
}

function bounds(interval: ResampledInterval): string {
  return `[${pp(interval.low)}, ${pp(interval.high)}]`;
}

/** The point estimate of an interval that may not exist, for the gap rows of the table. */
function pointOf(interval: ResampledInterval | null): number | null {
  return interval === null ? null : interval.point;
}

function statementOf(census: Omit<CopyCensus, 'statement'>): string {
  // The two readings are named separately so that a census with one usable contrast cannot be read
  // as if it had two. `carve` returns a delta and an interval together or neither.
  const denial =
    census.deniedDelta === null || census.deniedInterval === null || census.cleanDelta === null || census.cleanInterval === null
      ? 'no denial contrast: one of the strata is empty'
      : `${census.withHit} of ${census.n} cases carry a denial the gold contradicts, at ${pp(census.deniedDelta)} ${bounds(census.deniedInterval)} against ${pp(census.cleanDelta)} ${bounds(census.cleanInterval)}`;
  const circulation =
    census.circulationGap === null
      ? 'no circulation contrast'
      : `the all-boilerplate stratum sits ${pp(census.circulationGap.point)} from the singleton stratum ${bounds(census.circulationGap)}`;
  return `${census.source}: ${denial}; ${circulation}.`;
}

/**
 * Every stratum of every source, in long form: one row per stratum.
 *
 * Long rather than wide because the delta carries an interval: a wide table of four intervals is
 * four eighteen-character cells and no reader can line them up, while a long one has a column per
 * number and can be diffed against a previous round line by line.
 */
const COPY_WIDTHS = [30, 12, 6, 9, 9, 9] as const;

function cell(value: string, width: number, left = false): string {
  return left ? value.padEnd(width) : value.padStart(width);
}

/** A delta with its interval, or an em dash where the stratum does not exist. */
function pairOf(delta: number | null, interval: ResampledInterval | null): string[] {
  if (delta === null || interval === null) {
    return [cell('—', COPY_WIDTHS[3]), cell('—', COPY_WIDTHS[4]), cell('—', COPY_WIDTHS[5])];
  }
  return [
    cell(pp(delta), COPY_WIDTHS[3]),
    cell(pp(interval.low), COPY_WIDTHS[4]),
    cell(pp(interval.high), COPY_WIDTHS[5]),
  ];
}

function rowOf(source: string, stratum: string, n: number | null, delta: number | null, interval: ResampledInterval | null): string {
  return [
    cell(source, COPY_WIDTHS[0], true),
    cell(stratum, COPY_WIDTHS[1], true),
    cell(n === null ? '—' : String(n), COPY_WIDTHS[2]),
    ...pairOf(delta, interval),
  ].join(' ');
}

export const COPY_HEADER = [
  cell('source', COPY_WIDTHS[0], true),
  cell('stratum', COPY_WIDTHS[1], true),
  cell('n', COPY_WIDTHS[2]),
  cell('delta', COPY_WIDTHS[3]),
  cell('low', COPY_WIDTHS[4]),
  cell('high', COPY_WIDTHS[5]),
].join(' ');

/**
 * The rows of one source: the two readings' strata, the gaps between them, and the circulation
 * composition. A reader diffing two rounds diffs these lines.
 */
export function copyLines(census: CopyCensus): readonly string[] {
  const lines = [
    rowOf(census.source, 'contradicted', census.withHit, census.deniedDelta, census.deniedInterval),
    rowOf(census.source, 'else', census.n - census.withHit, census.cleanDelta, census.cleanInterval),
    rowOf(census.source, 'denial-gap', null, pointOf(census.denialGap), census.denialGap),
    rowOf(census.source, 'strict-gap', null, pointOf(census.strictGap), census.strictGap),
  ];
  for (const entry of census.circulation) {
    lines.push(rowOf(census.source, entry.stratum, entry.n, entry.delta, entry.interval));
  }
  lines.push(
    rowOf(census.source, 'circ-gap', null, pointOf(census.circulationGap), census.circulationGap),
  );
  return lines;
}

/** The composition table: what the store holds, before any outcome is read. */
export const COMPOSITION_HEADER = [
  cell('source', COPY_WIDTHS[0], true),
  cell('n', 6),
  cell('clus', 5),
  cell('stmts', 6),
  cell('xdb', 5),
  cell('denial', 7),
  cell('warn', 6),
  cell('hit', 5),
  cell('strict', 7),
].join(' ');

export function compositionLine(census: CopyCensus): string {
  return [
    cell(census.source, COPY_WIDTHS[0], true),
    cell(String(census.n), 6),
    cell(String(census.clusters), 5),
    cell(String(census.statements), 6),
    cell(String(census.circulating), 5),
    cell(String(census.withDenial), 7),
    cell(String(census.warnings), 6),
    cell(String(census.withHit), 5),
    cell(String(census.withStrict), 7),
  ].join(' ');
}

function objectAt(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${where} is not an object`);
  }
  return value as Record<string, unknown>;
}

function arrayField(value: unknown, key: string, where: string): readonly unknown[] {
  const field = objectAt(value, where)[key];
  if (!Array.isArray(field)) throw new Error(`${where} carries no ${key} array`);
  return field;
}

/**
 * A BIRD arm, read from the `per_case` rows every arm already commits.
 *
 * The `injected` field is the pack as the model received it, which is the only record of the
 * delivered text that survives: the store itself is rebuilt per run, so a census that read the
 * store would describe this afternoon's store rather than the one whose outcomes are in the file.
 */
export function packCopyRowsOf(artefact: unknown, source: string): PackCopyRow[] {
  return arrayField(artefact, 'per_case', source).map((row, at) => {
    const entry = objectAt(row, `${source}.per_case[${String(at)}]`);
    const cluster = entry['dbId'];
    const correct = entry['correct'];
    const without = entry['withoutMemoryCorrect'];
    const gold = entry['goldSql'];
    const injected = entry['injected'];
    if (typeof cluster !== 'string' || cluster === '') {
      throw new Error(`${source}.per_case[${String(at)}] carries no dbId, so it has no cluster`);
    }
    if (typeof correct !== 'boolean' || typeof without !== 'boolean') {
      throw new Error(`${source}.per_case[${String(at)}] does not carry both arms' outcomes`);
    }
    if (typeof gold !== 'string' || gold === '') {
      throw new Error(`${source}.per_case[${String(at)}] carries no goldSql, so the denial axis has nothing to read`);
    }
    if (!Array.isArray(injected)) {
      throw new Error(`${source}.per_case[${String(at)}] carries no injected statements, so the pack is unknown`);
    }
    return {
      cluster,
      correct,
      withoutMemoryCorrect: without,
      statements: injected.map((statement) => {
        if (typeof statement !== 'string') {
          throw new Error(`${source}.per_case[${String(at)}] carries a statement that is not text`);
        }
        return statement;
      }),
      goldSql: gold,
    };
  });
}

/** One arm of the census: where its rows come from. */
export type CopySource = {
  readonly name: string;
  readonly path: string;
};

/**
 * The arms this repository can read without a dispatch.
 *
 * Two grains of the same 1,534 questions are kept apart rather than merged: the lexicon grain is a
 * different store with different statements, and pooling them would average two packs.
 */
export const COPY_SOURCES: readonly CopySource[] = [
  { name: 'bird-train', path: 'eval/results/poc-sota-bird-train.json' },
  { name: 'bird-dev', path: 'eval/results/poc-sota-bird-dev-R26-channels.json' },
  { name: 'bird-dev-lexicon', path: 'eval/results/poc-sota-bird-dev-R37-lexicon-grain.json' },
  { name: 'bird-mini', path: 'eval/results/poc-sota-bird-R63-recall-order.json' },
];

export type CopyEntry = CopyCensus & { readonly path: string };

export type CopyCensusSet = {
  readonly id: string;
  readonly registered: string;
  readonly resamples: number;
  readonly seed: number;
  readonly rule: string;
  readonly sources: readonly CopyEntry[];
};

/**
 * The rule, in the artefact rather than in a report.
 *
 * A reader who disagrees with a stratum has to be able to see which predicate produced it. The two
 * predicates are written out here in English and implemented in the two functions above; the
 * artefact quotes this string so the rule travels with the numbers.
 */
export const COPY_RULE =
  'denial: a statement that negates a construct it binds within one phrase, where the gold query uses that construct; circulation: a statement delivered to cases in at least two databases, scored per case as the share of its statements that circulate';

/**
 * Every source, read through `load`.
 *
 * `load` is injected for the same reason the exchange census injects it: a module that opens files
 * is a module whose arithmetic can only be checked against the artefacts that happen to be
 * committed, and the refusals below are most of what needs checking.
 */
export function packCopyCensus(
  sources: readonly CopySource[],
  load: (path: string) => unknown,
  resamples = RESAMPLES,
): CopyCensusSet {
  return {
    id: 'poc-pack-copy',
    registered: 'ROADMAP.md §R158',
    resamples,
    seed: 12345,
    rule: COPY_RULE,
    sources: sources.map((source) => ({
      ...copyCensusOf(source.name, packCopyRowsOf(load(source.path), source.name), resamples),
      path: source.path,
    })),
  };
}
