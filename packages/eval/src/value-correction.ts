/**
 * The one sentence a second attempt needs when the first one used a spelling this database does not.
 *
 * R64 measured the retry line for the first time: 20 of the 98 rejected questions were repaired
 * (20.41%), worth +1.30pp on the dev split, with nothing regressed. Two facts from the same run say
 * where the rest of that line is. Nineteen of the twenty repairs came out of the `empty` bucket, and
 * of the 89 empty results, 32 read *exactly the gold tables* and filtered on a value the database
 * does not spell that way. `WHERE County = 'Alameda County'` against a column holding `'Alameda'` is
 * not a reasoning failure, and no amount of re-reading the question fixes it: the model has never
 * been shown the column's contents.
 *
 * So this module produces one block, at zero model calls, from evidence the attempt itself carries
 * plus a read of the database: every literal the failed query used that appears in no distinct value
 * of any column it could have meant, with the spelling the column actually holds.
 *
 * Three constraints, each of which has cost this record a dispatch when it was missing:
 *
 *  - **No model call.** The block is computed from the attempt's own text and the database's own
 *    rows. A mechanism that changes only what the second prompt says does not change the bill, which
 *    is what lets R66 be registered at 98 calls rather than 1,534.
 *  - **Whole lines or nothing.** A block truncated mid-line ends in a quotation mark that closes
 *    nothing, and a reader cannot tell a dropped spelling from a truncated one. `renderExemplars`
 *    learned this first; the budget is enforced the same way here.
 *  - **Like is compared with like.** A string literal is compared against columns that hold text and
 *    a numeric literal against columns that hold numbers. Without that rule the nearest value to
 *    `LIMIT 10` is always *some* number, and the block fills with lines that are arithmetic rather
 *    than evidence.
 */

/** One column's distinct values, already read from the database by the caller. */
export type ColumnValues = {
  readonly table: string;
  readonly column: string;
  readonly values: readonly string[];
};

export type ValueCorrectionInput = {
  /** The statement whose literals are being checked — the attempt that failed, not the question. */
  readonly sql: string;
  readonly columns: readonly ColumnValues[];
};

export type ValueCorrectionOptions = {
  /** Characters the rendered block may occupy. */
  readonly budget?: number;
  /** How many alternative spellings one line may name. */
  readonly nearest?: number;
};

export type ValueCorrection = {
  /** The block, empty when nothing was worth saying. */
  readonly text: string;
  /** Distinct literals the attempt contained, after comments and paging clauses were removed. */
  readonly literals: number;
  /** Lines the block holds. */
  readonly lines: number;
  /** Lines that a budget or a type mismatch kept out. */
  readonly dropped: number;
};

/** R66's registered budget: 600 characters, the same order as the memory pack it is compared with. */
export const VALUE_BLOCK_BUDGET = 600;

/** R66's registered width: the three closest spellings. */
export const VALUE_NEAREST = 3;

/** A block wider than this is not an explanation, so the literals are considered closest-first. */
const MAX_LITERALS = 8;

/** A single-character number is a threshold far more often than it is a typo. */
const MIN_NUMERIC_LENGTH = 2;

type Literal = { readonly text: string; readonly numeric: boolean };

/** A value as the comparison sees it: case and internal spacing folded, nothing else changed. */
function normalise(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Whether a column's value is a number, which decides what it may be compared against. */
function numeric(text: string): boolean {
  return /^-?\d+(?:\.\d+)?$/.test(text.trim());
}

/**
 * The literals a statement contains, in the order they appear, without duplicates.
 *
 * Comments are removed first, because a commented-out condition is not something the query did.
 * String literals are then taken out of the text before numbers are scanned, so a date inside a
 * string is one string literal rather than three numbers. `LIMIT` and `OFFSET` are removed because
 * a page size is a property of the query rather than a value the database is expected to hold, and
 * the nearest number to `10` is always some number — that line would be arithmetic dressed as
 * evidence.
 */
export function sqlLiterals(sql: string): readonly string[] {
  const withoutComments = sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
  const strings: string[] = [];
  const withoutStrings = withoutComments.replace(/'((?:[^']|'')*)'/g, (_, inner: string) => {
    strings.push(inner.replaceAll("''", "'"));
    return ' ? ';
  });
  const numbers = (
    withoutStrings.replace(/\b(limit|offset)\s+\d+/gi, ' ').match(/-?\d+(?:\.\d+)?/g) ?? []
  ).filter((text) => text.replace(/^-/, '').length >= MIN_NUMERIC_LENGTH);
  const seen = new Set<string>();
  const out: Literal[] = [];
  for (const text of [...strings, ...numbers]) {
    if (text.trim() === '' || seen.has(text)) continue;
    seen.add(text);
    out.push({ text, numeric: numeric(text) });
  }
  return out.map((literal) => literal.text);
}

/**
 * Levenshtein distance over normalised text, two rows at a time.
 *
 * Normalised rather than raw, because `'Male'` and `'male'` are the same spelling with different
 * case and a distance of six would rank a genuinely different value above the one the model meant.
 * The comparison that decides whether a line is emitted is *not* normalised: SQLite's `=` is
 * case-sensitive on text, so `'male'` against a column holding `'Male'` returns no rows and is
 * exactly the failure this block exists to report.
 */
export function editDistance(a: string, b: string): number {
  const left = normalise(a);
  const right = normalise(b);
  if (left === right) return 0;
  if (left === '') return right.length;
  if (right === '') return left.length;
  let previous = Array.from({ length: right.length + 1 }, (_, at) => at);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      const substitution = (previous[column - 1] as number) + (left[row - 1] === right[column - 1] ? 0 : 1);
      current[column] = Math.min(
        (previous[column] as number) + 1,
        (current[column - 1] as number) + 1,
        substitution,
      );
    }
    previous = current;
  }
  return previous[right.length] as number;
}

/** The closest spellings of one literal in one column's values, nearest first. */
export function nearestValues(
  literal: string,
  values: readonly string[],
  count: number = VALUE_NEAREST,
): readonly string[] {
  return [...values]
    .map((value) => ({ value, distance: editDistance(literal, value) }))
    .sort((left, right) => left.distance - right.distance || left.value.length - right.value.length)
    .slice(0, Math.max(0, count))
    .map((entry) => entry.value);
}

/**
 * The block, built one whole line at a time until the budget refuses the next one.
 *
 * The column chosen for a literal is the one whose closest value is closest overall: several columns
 * can hold a near miss, and the nearest of them is the best single explanation available without the
 * answer key. Its next two spellings ride in the same line, so three values cost one line rather
 * than three.
 */
export function valueCorrections(
  input: ValueCorrectionInput,
  options: ValueCorrectionOptions = {},
): ValueCorrection {
  const budget = options.budget ?? VALUE_BLOCK_BUDGET;
  const nearest = options.nearest ?? VALUE_NEAREST;
  const literals = sqlLiterals(input.sql);
  const lines: string[] = [];
  let dropped = 0;
  let used = 0;

  for (const literal of literals) {
    if (lines.length >= MAX_LITERALS) {
      dropped += 1;
      continue;
    }
    const kind = numeric(literal);
    let best: { readonly column: ColumnValues; readonly closest: readonly string[] } | undefined;
    let exact = false;
    for (const column of input.columns) {
      const candidates = column.values.filter((value) => numeric(value) === kind);
      if (candidates.length === 0) continue;
      if (candidates.some((value) => value === literal)) {
        exact = true;
        break;
      }
      const closest = nearestValues(literal, candidates, nearest);
      if (closest.length === 0) continue;
      if (
        best === undefined ||
        editDistance(literal, closest[0] as string) < editDistance(literal, best.closest[0] as string)
      ) {
        best = { column, closest };
      }
    }
    if (exact || best === undefined) continue;
    const [first, ...rest] = best.closest as [string, ...string[]];
    const alternatives = rest.length === 0 ? '' : ` (also ${rest.map((value) => `'${value}'`).join(', ')})`;
    const line =
      `you wrote '${literal}'; the column ${best.column.table}.${best.column.column} ` +
      `holds '${first}'${alternatives}`;
    // No de-duplication step, deliberately: `sqlLiterals` already reports each literal once, and a
    // line starts with the literal it is about, so two identical lines cannot be constructed. A set
    // here was a branch that could not be taken, which is a line the coverage report would have to
    // be told to ignore and a reader would have to re-derive.
    if (used + line.length + 1 > budget) {
      dropped += 1;
      continue;
    }
    lines.push(line);
    used += line.length + 1;
  }

  return {
    text: lines.join('\n'),
    literals: literals.length,
    lines: lines.length,
    dropped,
  };
}

/** One retried question, reduced to what the summary needs. */
export type ValueRow = {
  readonly reason: 'no-query' | 'error' | 'empty';
  /** Lines the block held for this question, zero when it said nothing. */
  readonly lines: number;
  /** Characters the block occupied. */
  readonly chars: number;
  /** Lines a budget or a type mismatch kept out. */
  readonly dropped: number;
};

export type ValueSummary = {
  /** Retries whose first attempt returned no rows: the population the mechanism is aimed at. */
  readonly asked: number;
  readonly fired: number;
  readonly firedShare: number;
  /** Retries that failed to execute, and how many of them carried a block. */
  readonly errors: number;
  readonly firedOnErrors: number;
  readonly lines: number;
  readonly meanChars: number;
  readonly droppedLines: number;
};

/**
 * The arm's delivery, counted over the population it acts on.
 *
 * `asked` counts only the empty retries because that is the void condition R66 wrote: a block that
 * fires on execution errors is a block that is explaining something other than a value, and a rate
 * computed over both would hide a mechanism that never once spoke about a spelling. The error
 * column is reported beside it rather than gated, because R66 predicts the block leaves those alone
 * and a prediction is not a validity condition.
 *
 * A share over nothing is zero rather than `NaN`: an empty population is a wiring defect that the
 * gate already fails, and a `NaN` would travel into the artefact as `null` in JSON and read as
 * "not measured".
 */
export function summariseValues(rows: readonly ValueRow[]): ValueSummary {
  const empty = rows.filter((row) => row.reason === 'empty');
  const firedRows = empty.filter((row) => row.lines > 0);
  const chars = firedRows.reduce((total, row) => total + row.chars, 0);
  return {
    asked: empty.length,
    fired: firedRows.length,
    firedShare: empty.length === 0 ? 0 : firedRows.length / empty.length,
    errors: rows.filter((row) => row.reason === 'error').length,
    firedOnErrors: rows.filter((row) => row.reason === 'error' && row.lines > 0).length,
    lines: rows.reduce((total, row) => total + row.lines, 0),
    meanChars: firedRows.length === 0 ? 0 : chars / firedRows.length,
    droppedLines: rows.reduce((total, row) => total + row.dropped, 0),
  };
}

/** R66's void condition, as a number: the block has to fire on at least 30% of the empty retries. */
export const VALUE_FLOOR = { firedShare: 0.3 } as const;

/**
 * The arm's own validity gate.
 *
 * R66's refutation names "the arm fires on fewer than 30% of the empty results" as a void condition,
 * and a condition that lives only in a document is one somebody has to remember at reading time.
 * Emitting it as a blocking gate makes a dispatch that measured an empty block fail as a wiring
 * defect instead of publishing a delta about nothing — the same rule `V75` applies to R65.
 */
export function valueGate(summary: ValueSummary): {
  readonly id: string;
  readonly criterion: string;
  readonly actual: string;
  readonly pass: boolean;
  readonly blocking: boolean;
} {
  return {
    id: 'V76-values-delivered',
    criterion:
      'the arm retried at least one empty result and the block fired on at least 30% of them, so the ' +
      'run shows the model a spelling rather than a heading',
    actual:
      `asked=${String(summary.asked)} fired=${String(summary.fired)} ` +
      `(${(summary.firedShare * 100).toFixed(2)}%) lines=${String(summary.lines)} ` +
      `mean-chars=${summary.meanChars.toFixed(1)} dropped-lines=${String(summary.droppedLines)} ` +
      `errors=${String(summary.errors)}/${String(summary.firedOnErrors)}`,
    pass: summary.asked > 0 && summary.firedShare >= VALUE_FLOOR.firedShare,
    blocking: true,
  };
}
