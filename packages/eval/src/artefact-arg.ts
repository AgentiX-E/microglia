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

/**
 * A reading that takes no arguments refuses them, rather than reading whatever the scan picks.
 *
 * Eight readers in this package take no arguments on purpose: they describe the artefact that
 * `chooseArtefact` selects, which is the newest one in the results directory. The hazard is that the
 * *shell* accepts anything: `pnpm eval:arm-pairs --bird r80.json` ran, ignored the flag, and printed a
 * 350-question table about a different file — a plausible answer to a question nobody asked, which is the
 * third time this defect class has cost a readback (see `artefactArgument` for the first two).
 *
 * A reader that cannot honour an argument must say so. This is deliberately a refusal and not a
 * pass-through: making these readers accept `--bird` would be a feature, and a feature is a decision with
 * tests, not something to grow by accident the next time someone types a flag out of habit.
 */
export function noArguments(argv: readonly string[], what: string): void {
  if (argv.length === 0) return;
  throw new Error(
    `${what} takes no arguments, and '${argv[0]}' was given: it reads the artefact the directory ` +
      'scan picks, so naming a file would be silently ignored rather than honoured',
  );
}
