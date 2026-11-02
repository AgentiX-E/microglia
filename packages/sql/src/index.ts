/**
 * The SQL adapter, and why it is a package rather than a folder.
 *
 * The measurement protocol is scenario-agnostic *by construction* only if the
 * scenario can be removed without rewriting it. Before stage 3 that claim was a
 * paragraph: the gates lived in `protocol`, and next to them sat six modules that
 * could not be used by any lane that was not text-to-SQL, in the same package, with
 * no line saying which was which. The dependency rule `core ← protocol ← sql` is
 * only enforceable if `sql` is a unit, so it is one.
 *
 * What qualifies, and what does not, is decided by one question about a signature:
 * **does the function mention a database?** `exec` opens a SQLite connection and
 * returns rows, `guard` bounds a statement, `diff` reads two statements and says how
 * they differ, `schema-link` matches question words to schema names, `m-schema`
 * renders a schema in M-Schema form, and `value-samples` reads column values. All
 * six take or return SQL text, schema names, or rows.
 *
 * Three neighbours are **not** here, and the reasons are recorded in the coupling
 * ledger that `pnpm eval:coupling` recomputes: `bird-data` loads a dataset and
 * depends on the artefact schema (a protocol type), `link-bind` needs the rule
 * template engine, which is a knowledge representation rather than a SQL one, and
 * `exec-signature` is a measurement signal read by the pool and signal-gate modules.
 * A deferred module with a written reason is a decision; a module that slipped
 * between two packages would be neither.
 */
export * from './canonical.js';
export * from './m-schema.js';
export * from './schema-link.js';
export * from './sql-diff.js';
export * from './sql-exec.js';
export * from './sql-guard.js';
export * from './value-samples.js';
