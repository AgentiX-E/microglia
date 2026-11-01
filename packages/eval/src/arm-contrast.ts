/**
 * Reading `--left a --right b` pairs, where getting it wrong is silent.
 *
 * The first version of this parser scanned the argument list once per flag and refused any token that
 * was not the flag it was looking for, so `--left a --right b` threw on `--right` — the tool could only
 * ever accept one arm name. It is a small function and it failed the first time a real command was run
 * against a real artefact, which is the argument for it living in a module with tests rather than in a
 * CLI entry point no coverage instrument reaches.
 *
 * The rules are deliberately narrow. Flags pair in order, a repeat of one flag is accepted because
 * `--left a --left b --right c --right d` is how a shell loop generates a list, and anything else is
 * refused rather than ignored: a silently dropped argument is a contrast the run reported and the
 * reader never saw.
 */

export type ContrastPair = {
  readonly left: string;
  readonly right: string;
};

/**
 * The pairs a command line names, in order.
 *
 * Left and right are read together in a single pass because they are one fact — a contrast has two
 * sides — and reading them in two passes is what allowed the first version to refuse the second flag.
 */
export function parseContrastArgs(argv: readonly string[]): readonly ContrastPair[] {
  const lefts: string[] = [];
  const rights: string[] = [];
  for (let at = 0; at < argv.length; at += 1) {
    const token = argv[at] as string;
    if (!token.startsWith('--')) {
      throw new RangeError(`unexpected argument '${token}'; every argument is --left or --right with a value`);
    }
    const key = token.slice(2);
    if (key !== 'left' && key !== 'right') {
      throw new RangeError(`unknown flag '${token}'; this tool reads --left and --right`);
    }
    const value = argv[at + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new RangeError(`--${key} needs an arm name`);
    }
    (key === 'left' ? lefts : rights).push(value);
    at += 1;
  }
  if (lefts.length === 0) throw new RangeError('give at least one --left arm to pair');
  if (lefts.length !== rights.length) {
    throw new RangeError(`--left given ${lefts.length} time(s) and --right ${rights.length}; they pair in order`);
  }
  return lefts.map((left, at) => ({ left, right: rights[at] as string }));
}
