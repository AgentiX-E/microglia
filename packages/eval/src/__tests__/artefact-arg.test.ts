import { describe, expect, it } from 'vitest';
import { artefactArgument } from '../artefact-arg.js';

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
