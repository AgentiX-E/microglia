/**
 * Print the recall knobs a registration's pack mode resolves to.
 *
 * `pack-mode-plan.ts` owns what the two modes mean; this prints the answer in the one form the rest of
 * the lane can carry — a query fragment — so neither the workflow nor the Python agent has to know that
 * "no retrieval" is spelled `anchoring=scope&minCoverage=0`.
 *
 * Prints an empty line for `retrieved`, which is the point: the retrieved arm's request must stay
 * byte-identical to the one every committed artefact was written with, and a fragment that said
 * anything at all would move the lane's history sideways.
 *
 * Usage: TAU_SERVE_ANCHOR=[lexical|scope] pnpm eval:pack-knobs [retrieved|prefix] [per-failure|collapse] ->
 * the fragment on stdout, or
 * the refusal on stderr and a non-zero exit. The refusal is a resolver's own message, not a second one
 * here. The two fragments are joined with `&`: one request carries the place the pack came from and the
 * unit it was written in, and a run that set both would otherwise silently honour the first.
 */
import { knobFragment } from '../pack-knobs.js';

function main(): void {
  const raw = (process.argv[2] ?? '').trim();
  const rawShape = (process.argv[3] ?? '').trim();
  try {
    process.stdout.write(`${knobFragment({ mode: raw, shape: rawShape, anchor: process.env['TAU_SERVE_ANCHOR'] })}\n`);
  } catch (error) {
    process.stderr.write(`[pack-knobs] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

main();
