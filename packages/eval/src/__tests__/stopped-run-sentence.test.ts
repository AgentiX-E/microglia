/**
 * One sentence, written by the driver and read by the verifier, pinned in the middle.
 *
 * A run that stops before measurement has no numbers to grade and one thing to say: where the funnel
 * stopped. `packages/eval/src/bin/l4.ts` writes that sentence as the first note of the artefact, and
 * `eval/verifiers/r56_readback.py` relays it into the report instead of re-deriving it — which is the
 * right division, because the driver is the only code that has the funnel in hand.
 *
 * The division has one failure mode, and it is silent: the reader keys on a string literal, so a
 * reworded note in the writer turns the relay into `absent`, and `absent` is a state the report prints
 * on purpose for a run that carries no sentence at all. R56's re-dispatch is the reason this file
 * exists — its artefact *had* the sentence, and the reader printed the funnel as `12 -> 0` and left the
 * question it was written to answer to whoever read it.
 *
 * So the literal is asserted in both files. It is not a test of either implementation; it is the test
 * that the two are still talking about the same sentence.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const WRITER = join(ROOT, 'packages', 'eval', 'src', 'bin', 'l4.ts');
const READER = join(ROOT, 'eval', 'verifiers', '_funnel.py');
const CONSUMERS = [
  join(ROOT, 'eval', 'verifiers', 'r56_readback.py'),
  join(ROOT, 'eval', 'verifiers', 'r58_readback.py'),
];
const SENTENCE = 'The run stopped before any task was scored:';

describe('the sentence a stopped run is described by', () => {
  it('is written by the lane that stopped the run', () => {
    const source = readFileSync(WRITER, 'utf8');
    // The note, not a comment: the interpolation is what makes the reason travel.
    expect(source).toContain(`\`${SENTENCE} \${marker.reason}\``);
  });

  it('is the sentence the verifiers key on', () => {
    const source = readFileSync(READER, 'utf8');
    expect(source).toContain(`STOPPED_PREFIX = "${SENTENCE}"`);
    // And the prefix is used as a prefix, so the reason after it survives into the report.
    expect(source).toContain('text.startswith(STOPPED_PREFIX)');
  });

  it('is stated in exactly two places, and the readers are not one of them', () => {
    // A reader that spelled the sentence itself would be a second copy of the writer's wording, and a
    // reworded note would then be relayed by neither. The two readers import the prefix instead.
    const counts = [WRITER, READER, ...CONSUMERS].map((path) => {
      const source = readFileSync(path, 'utf8');
      return [path, source.split(SENTENCE).length - 1] as const;
    });
    expect(counts.slice(0, 2).map(([, count]) => count)).toEqual([1, 1]);
    for (const [path, count] of counts.slice(2)) {
      expect(count, `${path} imports the prefix rather than restating it`).toBe(0);
    }
  });
});
