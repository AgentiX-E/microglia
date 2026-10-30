/**
 * A generator that is not ours, and does not import from this repository.
 *
 * This file exists to make one claim testable: a module outside `packages/eval` can be
 * scored by the harness without anybody editing the harness. It is a keyword router of the
 * kind a text-to-SQL baseline would have shipped in 2019 — pick the table the question
 * names, count its rows, project every column when asked to list something — and it is
 * wrong in the two ways that class of system is wrong: it ignores filters ("from Sweden")
 * and it over-projects (`SELECT *` where the question asks for one column).
 *
 * That makes it a useful fixture rather than a toy. The committed run artefact scores it at
 * a number fixed in `prereg/R8.1-offline-fixture.md` before the run, so a change in the
 * harness that moves the score is visible as a failing gate rather than as a plausible new
 * number, and the errors it makes are the errors the report has to render honestly.
 *
 * It is a `.mjs` file with no imports on purpose: the contract is the whole interface, and a
 * generator that needs our types to compile is not a third-party generator.
 */

const TABLES = ['customer', 'orders', 'book', 'loan'];

/** The table the question names, or undefined when it names none of them. */
function tableOf(question) {
  const lower = question.toLowerCase();
  return TABLES.find((table) => lower.includes(table.replace(/s$/, '')));
}

export default {
  contract: 'candidate-generator/1',
  name: 'keyword-router',
  version: '1.0.0',
  generate(request) {
    const question = request.question.toLowerCase();
    const table = tableOf(question);
    if (table === undefined) {
      return { sql: "SELECT 'no table matched' AS error" };
    }
    if (question.includes('how many')) {
      return { sql: `SELECT count(*) FROM ${table}` };
    }
    if (question.includes('list') || question.includes('every')) {
      return { sql: `SELECT * FROM ${table}` };
    }
    return { sql: `SELECT * FROM ${table} LIMIT 5` };
  },
};
