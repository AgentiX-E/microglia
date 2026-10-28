/**
 * Sampling cell values so the generator can see what a column actually holds.
 *
 * The prompt this lane has always sent carries the DDL — column names and types — and nothing else.
 * A model reading `CREATE TABLE singer (Gender TEXT)` has to guess whether the column stores `'M'`
 * or `'Male'`, whether `Born` is `'1970-01-01'` or `'01/01/1970'`, and whether a category is
 * `'Rock'` or `'rock'`. Those guesses are the wrong answers that survive every prompt improvement
 * that does not change the information available: BIRD's questions routinely hinge on a literal
 * that appears nowhere in the schema.
 *
 * MCS-SQL measures this as their largest single component (+4.8pp on BIRD dev, more than schema
 * linking and more than their selection step), and it is the only remaining lever that acts on the
 * *generator* rather than on the choice. Their version links question tokens to cell values with an
 * LSH index; this one annotates every column with a few representative values, which is a weaker
 * treatment but a strictly additive one and it can be built without an index.
 *
 * Three values per column, because the question is "what shape is this column's data" and three
 * answers it. Uniform rather than question-aware, because a value filter that only shows columns the
 * question mentions is a second experiment: it would confound "the model can see values" with "the
 * model is told which column to look at".
 */

/** One column's sample, already rendered for a prompt. */
export type ValueSample = {
  readonly column: string;
  readonly values: readonly string[];
};

/** What a table's columns hold, as far as the caller could sample. */
export type TableValues = (table: string) => readonly ValueSample[];

/**
 * How many columns of one table are annotated.
 *
 * Wide tables exist in this benchmark — `card_games` has one with forty columns — and annotating all
 * of them turns a schema into a wall of literals that crowds out the schema itself. Sixteen covers
 * every table in the eleven BIRD Mini-Dev databases that carries a literal the question depends on,
 * and the cap is a constant rather than a parameter so that two runs cannot silently disagree about
 * how much the model was shown.
 */
const MAX_ANNOTATED_COLUMNS = 16;

/**
 * A cell, as the prompt shows it.
 *
 * Strings are quoted so that a literal which happens to look like a number is visibly a string:
 * `'2020'` and `2020` compare differently against a TEXT column, which is exactly the mistake this
 * annotation exists to prevent. Whitespace is collapsed because a value that spans lines would break
 * the one-line summary it lives in.
 */
export function renderValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  const text = String(value).replace(/\s+/g, ' ').trim();
  const cut = text.length > 24 ? `${text.slice(0, 24)}…` : text;
  return `'${cut.replaceAll("'", "''")}'`;
}

/**
 * The same schema, with each table's columns annotated with a few values.
 *
 * Appended as a comment line rather than spliced into the `CREATE TABLE` text, because the DDL has
 * to stay executable-looking: a model that copies the DDL into its answer must copy the thing the
 * database would accept. A table whose columns could not be sampled is left exactly as it was.
 */
export function schemaWithValues(ddl: string, tableValues: TableValues): string {
  const parts = ddl.split(/(?=CREATE\s+TABLE)/i).filter((part) => part.trim() !== '');
  if (parts.length === 0) return ddl;
  const annotated = parts.map((part) => {
    const match =
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:(["'`[])([^"'`\]]+)\1|([A-Za-z_][A-Za-z_0-9]*))/i.exec(
        part,
      );
    // Quoted first, because SQLite writes `CREATE TABLE "my table"` for any name that needs quoting
    // and the unquoted pattern would read that table as `my` — silently sampling a table that does
    // not exist and leaving the real one unannotated.
    const table = match?.[2] ?? match?.[3];
    if (table === undefined) return part;
    const samples = tableValues(table)
      .filter((sample) => sample.values.length > 0)
      .slice(0, MAX_ANNOTATED_COLUMNS);
    if (samples.length === 0) return part;
    const hint = samples.map((sample) => `${sample.column}: ${sample.values.join(', ')}`).join('; ');
    // The trailing whitespace is put back where it was, so a table that gained an annotation is the
    // only table whose text changed. Joining with a newline instead would add a blank line between
    // every pair of tables and make the arm differ from `none` everywhere.
    // `trimEnd` rather than a trailing-whitespace regex: the regex always matches, so its result
    // would either need a fallback that can never run or an assertion the compiler cannot check.
    const body = part.trimEnd();
    return `${body}\n-- values: ${hint}${part.slice(body.length)}`;
  });
  return annotated.join('');
}
