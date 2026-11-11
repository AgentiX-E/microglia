/**
 * Which artefact a reading is pointed at, and a refusal to guess when the caller names two.
 *
 * `pnpm eval:pool --bird r68.json` printed "this artefact predates the pool field" and read the newest
 * file in `eval/results` instead: `pool.ts` never looked at `process.argv`, so the flag was accepted by
 * the shell, ignored by the program, and the reading described a population the caller had not chosen.
 * A wrong-file read that says something plausible is worse than a crash — it is the same defect class
 * as the arm table that reported two arms a dispatch never bought, and it has now cost two readbacks
 * (`eval:inert` in R78's iteration, this one).
 *
 * So the argument parser is strict: `--bird` takes a path, and **anything else is an error**. A reading
 * that is handed a flag it does not understand stops, rather than reporting on whatever the directory
 * scan happens to pick.
 */
export function artefactArgument(argv: readonly string[], fallback: () => string): string {
  if (argv.length === 0) return fallback();
  const at = argv.indexOf('--bird');
  if (at === -1) {
    throw new Error(`unrecognised argument ${argv[0]}: this reading takes --bird <artefact>`);
  }
  const path = argv[at + 1];
  if (path === undefined || path.startsWith('--')) {
    throw new Error('--bird needs a path, and the next argument is another flag');
  }
  const rest = argv.filter((_, index) => index !== at && index !== at + 1);
  if (rest.length > 0) {
    throw new Error(`unrecognised argument ${rest[0]}: this reading takes --bird <artefact> only`);
  }
  return path;
}
