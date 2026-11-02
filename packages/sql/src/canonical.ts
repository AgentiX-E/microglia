/**
 * A result set as a comparable sequence, sorted so row order does not matter.
 *
 * Values are serialised as JSON rather than joined with a separator: a string that
 * contains the separator would otherwise make two different answers look the same.
 * Floats are rounded to six decimals so a difference in the last bit of a division
 * does not read as a wrong answer.
 *
 * This lived in `sota.ts` until stage 3 of the protocol/adapter split. It is here
 * because the function it canonicalises is a **database's** answer: a lane that
 * scores rows must agree with the lane that produced them about what "the same
 * rows" means, and the only way to keep them agreeing is to have one definition
 * that both import. `eval` re-exports the name, so nothing downstream moved.
 */
export function canonicalRows(rows: readonly Record<string, unknown>[]): string[] {
  return rows
    .map((row) =>
      JSON.stringify(
        Object.keys(row)
          .sort()
          .map((key) => {
            const value = row[key];
            if (typeof value === 'number') {
              return Number.isInteger(value) ? value : Number(value.toFixed(6));
            }
            return value === null || value === undefined ? null : String(value);
          }),
      ),
    )
    .sort();
}
