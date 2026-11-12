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
 * Usage: pnpm eval:pack-knobs [retrieved|prefix] -> the fragment on stdout, or the refusal on stderr
 * and a non-zero exit. The refusal is the resolver's own message, not a second one here.
 */
import { resolvePackModePlan } from '../pack-mode-plan.js';

function main(): void {
  const raw = (process.argv[2] ?? '').trim();
  try {
    const plan = resolvePackModePlan(raw === '' ? {} : { TAU_PACK_MODE: raw });
    process.stdout.write(
      `${Object.entries(plan.knobs)
        .map(([name, value]) => `${name}=${value}`)
        .join('&')}\n`,
    );
  } catch (error) {
    process.stderr.write(`[pack-knobs] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

main();
