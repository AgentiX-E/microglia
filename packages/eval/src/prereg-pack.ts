/**
 * The ceiling and the budget, checked against each other.
 *
 * `prereg.ts` parses both numbers and refuses neither, because it is read by jobs that run before the
 * build and cannot reach the renderer that measures capacity — an invariant `prereg-imports.test.ts`
 * enforces by walking the import closure. This module is where the two numbers meet, and it exists as
 * its own file rather than inside the reader for exactly that reason.
 *
 * What it checks is the coupling R88 shipped without: `maxStatementChars` renders one item through the
 * real renderer at the real options, so the capacity is measured rather than derived, and a record
 * written above it is a record the pack will drop at render. That drop reads as "nothing was relevant"
 * in every artefact this lane has produced — the fifth absence, and the only one of the five that was
 * invisible to the store, the write and the reader alike.
 *
 * The limit is deliberate: the check fires only when a registration states **both** numbers. Every arm
 * published before `packBudget` existed ran at 1,200 and stated nothing, and a validator that refused
 * them retroactively would be editing finished runs rather than preventing the next mistake. Those runs
 * get the capacity in their dispatch log instead (`prereg-caps` prints it on stderr).
 */
import { maxStatementChars } from '@agentix-e/microglia-core/apply';
import type { Prereg } from './prereg.js';
import { rawLogItemShape } from './tau2-rawlog.js';
import { DEFAULT_PACK_BUDGET } from './tau2-pack.js';

export type PackCouplingProblem = {
  readonly where: string;
  readonly problem: string;
};

/** The budget a registration's pack actually ran with: its own, or the lane's. */
export function packBudgetOf(prereg: Pick<Prereg, 'packBudget'>): number {
  return prereg.packBudget ?? DEFAULT_PACK_BUDGET;
}

/** The characters one record in this arm's shape can state and still render, at this registration's pack. */
export function recordCapacityOf(prereg: Pick<Prereg, 'packBudget'>): number {
  return maxStatementChars({ budget: packBudgetOf(prereg) }, rawLogItemShape);
}

/**
 * Refuse a ceiling the declared pack cannot carry.
 *
 * Returned rather than thrown so a caller can decide: `prereg-caps` refuses the dispatch, the test over
 * every registration reports all of them at once rather than the first.
 */
export function packCouplingProblems(
  prereg: Pick<Prereg, 'rawCeiling' | 'packBudget'>,
): readonly PackCouplingProblem[] {
  if (prereg.rawCeiling === undefined || prereg.packBudget === undefined) return [];
  const capacity = recordCapacityOf(prereg);
  if (prereg.rawCeiling <= capacity) return [];
  return [
    {
      where: "header 'rawCeiling'",
      problem:
        `${String(prereg.rawCeiling)} exceeds the ${String(capacity)} characters a ` +
        `${String(prereg.packBudget)}-character pack can carry, so records above ${String(capacity)} ` +
        'would be written and never rendered',
    },
  ];
}
