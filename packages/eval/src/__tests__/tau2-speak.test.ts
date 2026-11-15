import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { speakLineOf, type RecallTraffic } from '../tau2-speak.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

const traffic = (overrides: Partial<RecallTraffic> = {}): RecallTraffic => ({
  recalls: 168,
  recall_failures: 0,
  recall_empty: 7,
  silent_because: { 'no-leader': 7 },
  ...overrides,
});

describe('the speak line partitions the requests the facade saw', () => {
  it('prints the served, the withheld and the failed, and the reasons behind the withheld', () => {
    const line = speakLineOf(0.05, traffic());
    expect(line).toContain('margin 0.05');
    expect(line).toContain('168 request(s) reached the facade');
    expect(line).toContain('161 served');
    expect(line).toContain('7 withheld');
    expect(line).toContain('no-leader 7');
    expect(line).toContain('0 failed');
  });

  it('says the default is the default, so a zero cannot be read as a settled floor', () => {
    expect(speakLineOf(0, traffic())).toContain('every non-empty pack is served');
  });

  it('names every bucket, in a stable order', () => {
    const line = speakLineOf(
      0.05,
      traffic({
        recall_empty: 9,
        silent_because: { unattributed: 2, 'no-leader': 7 },
      }),
    );
    expect(line).toContain('no-leader 7, unattributed 2');
  });

  it('counts a failure as neither served nor withheld', () => {
    // A request that threw is not a pack the gate refused: the partition would credit the gate with an
    // infrastructure fact.
    const line = speakLineOf(0.05, traffic({ recall_failures: 3, recalls: 170 }));
    expect(line).toContain('160 served');
    expect(line).toContain('3 failed');
  });

  it('omits the parenthetical when nothing was withheld, rather than printing empty brackets', () => {
    const line = speakLineOf(0, traffic({ recall_empty: 0, silent_because: {} }));
    expect(line).toContain('0 withheld, 0 failed');
    expect(line).not.toContain('()');
  });

  it('states that it cannot say, rather than printing zero, when the phase kept no counters', () => {
    for (const absent of [undefined, null]) {
      const line = speakLineOf(0, absent);
      expect(line).toContain('cannot say how many packs the gate withheld');
      expect(line).not.toContain('0 withheld');
    }
  });
});

describe('a margin census is three states, not one zero', () => {
  it('says the phase kept no census rather than printing zeros', () => {
    // Every arm before R123a. A `rivaled 0` here would be a claim about the store that the phase never
    // measured, which is the defect this whole module exists to refuse.
    const line = speakLineOf(0, traffic());
    expect(line).toContain('no margin census reached this phase');
    expect(line).not.toContain('rivaled');
  });

  it('prints the ladder rung by rung, in rung order', () => {
    const line = speakLineOf(
      0,
      traffic({
        rivaled: 118,
        margin_p50: 0.0312,
        margin_ladder: { '0.30': 115, '0.01': 6, '0.05': 24, '0.10': 61 },
      }),
    );
    expect(line).toContain('118 rivaled request(s)');
    expect(line).toContain('p50 0.0312');
    // Numerically sorted, not lexicographically: `0.30` would sort before `0.05` as a string, and a
    // ladder that prints its rungs out of order is a ladder a reader misreads at a glance.
    expect(line).toContain('ladder 0.01 6 / 0.05 24 / 0.10 61 / 0.30 115');
  });

  it('treats a null rivaled count as no census, because that is what the payload now says', () => {
    // R123a's exact payload: the facade answered `{ rendered }`, so `decision` never arrived and the
    // Python half reported `rivaled: 0`. The fix reports `null`, and a line that printed `0 rivaled` here
    // would be repeating the reading the fix exists to prevent.
    const line = speakLineOf(0, traffic({ census: 0, rivaled: null, margin_p50: null, margin_ladder: {} }));
    expect(line).toContain('no margin census reached this phase');
    expect(line).not.toContain('rivaled request(s)');
  });

  it('says a store gave nothing to be contested when the count is a real zero', () => {
    const line = speakLineOf(0, traffic({ census: 164, rivaled: 0, margin_p50: null, margin_ladder: {} }));
    expect(line).toContain('0 rivaled request(s) (164 request(s) carried one)');
    expect(line).toContain('no median');
    expect(line).not.toContain('no margin census');
  });

  it('reports a missing ladder rather than pretending the rungs are empty', () => {
    const line = speakLineOf(0, traffic({ rivaled: 3, margin_p50: 0.004 }));
    expect(line).toContain('no ladder was reported');
  });
});

describe('the reader and the writer agree on the field names', () => {
  // AUDIT 34.154's cheapest check, for the field it was written about. A self-check certifies the
  // function; nothing certified that the *shape* it returns is the shape the reader reads. If the Python
  // side renames `margin_ladder`, the line silently loses the ladder and every local gate stays green.
  const dumped = spawnSync('python3', ['eval/drivers/tau2/selfcheck_agent.py', '--dump-stats'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  const available = dumped.status === 0 && dumped.stdout.trim() !== '';

  // R130 added `recallRepeats`: the count a boundary list is short by, so `len(episodeStarts) + repeats ==
  // recalls` is an identity rather than a hope. R136 added the six fields of the two instruments it buys —
  // the boundary's own text and the three lengths the system column is made of — which is the same list
  // failing in the same direction: a writer that grew fields the reader had not been told about.
  it.skipIf(!available)('carries every field the speak line reads', () => {
    const stats = JSON.parse(dumped.stdout) as Record<string, unknown>;
    expect(Object.keys(stats).sort()).toEqual(
      [
        'boundaryTexts',
        'calls',
        'census',
        'episodeStarts',
        'injectedChars',
        'injectedCharsPerCall',
        'injectedCharsTotal',
        'injectedMessages',
        'margin_ladder',
        'margin_p10',
        'margin_p50',
        'margin_p90',
        'packChars',
        'recallRepeats',
        'recall_empty',
        'recall_failures',
        'recall_url',
        'recalls',
        'rivaled',
        'silent_because',
      ],
    );
  });

  it.skipIf(!available)('prints a line from the payload the driver actually writes', () => {
    const stats = JSON.parse(dumped.stdout) as RecallTraffic;
    const line = speakLineOf(0, stats);
    // The keys, not the numbers: the payload of a fresh module is all zeros, and what is under test is
    // that `rivaled` and `margin_ladder` arrive under the names the line reads them by.
    expect(line).toContain('0 request(s) reached the facade');
    // A module that has served nothing has measured no contest, and says so: `rivaled` is `null` in the
    // payload and the line refuses to turn it into a zero.
    expect(stats.census).toBe(0);
    expect(line).toContain('no margin census reached this phase');
  });
});
