import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { artefactArgument, noArguments } from '../artefact-arg.js';

const fallback = (): string => '/results/default.json';

describe('artefactArgument', () => {
  it('uses the lane default when the caller names nothing', () => {
    expect(artefactArgument([], fallback)).toBe('/results/default.json');
  });

  it('reads the path the caller named', () => {
    expect(artefactArgument(['--bird', 'r68.json'], fallback)).toBe('r68.json');
  });

  it('refuses a flag it does not understand instead of reporting on another file', () => {
    // The regression: `--bird` was accepted by the shell and ignored by `pool.ts`, which then read the
    // newest artefact in the results directory and described a population nobody had chosen.
    expect(() => artefactArgument(['--pool', 'r68.json'], fallback)).toThrow(/unrecognised argument --pool/);
  });

  it('refuses --bird with no path, and --bird followed by another flag', () => {
    expect(() => artefactArgument(['--bird'], fallback)).toThrow(/needs a path/);
    expect(() => artefactArgument(['--bird', '--verbose'], fallback)).toThrow(/needs a path/);
  });

  it('refuses a second path rather than silently taking the first', () => {
    expect(() => artefactArgument(['--bird', 'a.json', 'b.json'], fallback)).toThrow(/unrecognised argument b\.json/);
  });
});

describe('noArguments', () => {
  it('accepts an empty argument list', () => {
    expect(() => noArguments([], 'this reading')).not.toThrow();
  });

  it('refuses a flag it cannot honour, and says why', () => {
    // The third occurrence of this defect: `pnpm eval:arm-pairs --bird r80.json` printed a 350-question
    // table about a different file. The shell accepted the flag, the program ignored it, and the number
    // was plausible.
    expect(() => noArguments(['--bird', 'r80.json'], 'this reading')).toThrow(
      /takes no arguments, and '--bird' was given/,
    );
    expect(() => noArguments(['--bird', 'r80.json'], 'this reading')).toThrow(/silently ignored/);
  });

  it('is enforced by every reader that has no arguments to take', () => {
    // A source-level invariant, because the defect is a *missing call*: a new reader that does not take
    // this guard is the next plausible wrong answer, and nothing else in the suite would notice.
    const dir = 'packages/eval/src/bin';
    const offenders: string[] = [];
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.ts') || file === 'lib.ts') continue;
      const source = readFileSync(`${dir}/${file}`, 'utf8');
      if (!source.includes('birdArtefactPath(')) continue;
      // Three ways to be honest about arguments: take them through the shared parser, refuse them, or
      // read `process.argv` yourself. What is not allowed is to look at none of the three — that is
      // `pool.ts`, `width-share.ts` and `arm-pairs.ts`, each of which printed a plausible table about a
      // file nobody named.
      const honest =
        source.includes('artefactArgument(') ||
        source.includes('widthArguments(') ||
        source.includes('noArguments(') ||
        source.includes('process.argv');
      if (!honest) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
