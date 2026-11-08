import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pairedVerdict, type PairedVerdictInput } from '../paired-verdict.js';
import { revertRule, type PairedReading } from '../l4-revert.js';

/**
 * R50: `l4-paired` blocks on harm, and a reading the sample cannot resolve is
 * reported as UNRESOLVED rather than as a failure of the memory.
 *
 * The three real readings below are the ones this lane has actually produced,
 * with the numbers its artefacts print. R49 is the dispatch that exposed the
 * defect: -4.00pp at a minimum detectable difference of 13.73pp, graded FAIL by
 * a gate whose pass condition could not have been met by any effect of the size
 * the memory could plausibly have.
 */
const FIXTURE = join(process.cwd(), 'eval/fixtures/tau2-l4-paired-readings.json');
const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
  readonly readings: readonly {
    readonly id: string;
    readonly run: string;
    readonly l4Paired: PairedReading;
    readonly servedPacks: number;
    /** Null where the run predates the field; the expected state is invariant to it. */
    readonly detectablePp: number | null;
    readonly expected: {
      readonly fires: boolean;
      readonly branch: string;
      readonly state: string;
      readonly claim: string | null;
    };
  }[];
};

const input = (over: Partial<PairedVerdictInput> = {}): PairedVerdictInput => ({
  deltaPp: 0,
  p: 1,
  paired: 50,
  servedPacks: 100,
  detectablePp: 5,
  ...over,
});

describe('pairedVerdict — the R49 reading, which is why this function exists', () => {
  it('reports UNRESOLVED for -4.00pp at an MDE of 13.73pp, and makes no claim', () => {
    const verdict = pairedVerdict({
      deltaPp: -4,
      p: 0.6875,
      paired: 50,
      servedPacks: 949,
      detectablePp: 13.73,
    });
    expect(verdict.state).toBe('UNRESOLVED');
    expect(verdict.claim).toBeNull();
    // The harm rule still ran, and still cleared: -4pp at p=0.69 with a served
    // pack fires neither of its branches. UNRESOLVED is not HARM.
    expect(verdict.harm.fires).toBe(false);
    expect(verdict.harm.branch).toBe('clear');
    expect(verdict.reason).toContain('13.73pp');
    expect(verdict.excludedAbovePp).toBe(13.73);
  });

  it('reads the bound into the reason, so "nothing concluded" also says what was excluded', () => {
    const verdict = pairedVerdict(input({ deltaPp: 1.5, p: 0.42, detectablePp: 9 }));
    expect(verdict.state).toBe('UNRESOLVED');
    expect(verdict.reason).toContain('no effect larger than 9.00pp');
  });
});

describe('pairedVerdict — HARM is the R45 rule, called rather than copied', () => {
  it('agrees with revertRule on every committed reading', () => {
    expect(fixture.readings.length).toBeGreaterThanOrEqual(3);
    for (const row of fixture.readings) {
      // Rows written before the pair reported a resolution get `Infinity` here,
      // and the loop below re-reads each of them at a resolution that *would*
      // change the verdict if the state depended on it. R47 (+12pp, p=0.109) and
      // R48 (-6pp, served) do not, which is why their expectation is stated.
      const resolutions = row.detectablePp === null ? [Infinity, 1, 13.73] : [row.detectablePp];
      for (const detectablePp of resolutions) {
        const verdict = pairedVerdict({
          deltaPp: row.l4Paired.deltaPp,
          p: row.l4Paired.p,
          paired: row.l4Paired.paired,
          servedPacks: row.servedPacks,
          detectablePp,
        });
        const direct = revertRule(row.l4Paired, row.servedPacks);
        expect(verdict.harm).toEqual(direct);
        expect(verdict.harm.fires).toBe(row.expected.fires);
        expect(verdict.harm.branch).toBe(row.expected.branch);
        expect(verdict.state).toBe(row.expected.state);
        expect(verdict.claim).toBe(row.expected.claim);
      }
    }
  });

  it('fires on a significantly negative delta even when it is larger than nothing', () => {
    const verdict = pairedVerdict(input({ deltaPp: -1.2, p: 0.01, detectablePp: 0.5 }));
    expect(verdict.state).toBe('HARM');
    expect(verdict.claim).toContain('costs accuracy');
    expect(verdict.reason).toContain('significantly negative');
  });

  it('fires on the below-bar branch without significance, because the bar does not require it', () => {
    const verdict = pairedVerdict(input({ deltaPp: -6, p: 0.45, servedPacks: 965, detectablePp: 13 }));
    expect(verdict.state).toBe('HARM');
    expect(verdict.harm.branch).toBe('below-bar-with-served-pack');
  });

  it('does not fire on -6pp when nothing was served: an empty pack cannot have hurt through its content', () => {
    const verdict = pairedVerdict(input({ deltaPp: -6, p: 0.45, servedPacks: 0, detectablePp: 13 }));
    expect(verdict.state).toBe('UNRESOLVED');
    expect(verdict.harm.branch).toBe('clear');
  });
});

describe('pairedVerdict — BENEFIT needs the resolution, not only the p-value', () => {
  it('claims a benefit only when the effect reaches the minimum detectable difference', () => {
    const verdict = pairedVerdict(input({ deltaPp: 14, p: 0.001, detectablePp: 13.73 }));
    expect(verdict.state).toBe('BENEFIT');
    expect(verdict.claim).toContain('+14.00pp');
    expect(verdict.claim).toContain('13.73pp');
  });

  it('treats delta == detectable as reaching it, so the boundary is not a coin flip', () => {
    const verdict = pairedVerdict(input({ deltaPp: 8, p: 0.01, detectablePp: 8 }));
    expect(verdict.state).toBe('BENEFIT');
  });

  it('refuses a benefit that is significant but below the resolution bar', () => {
    const verdict = pairedVerdict(input({ deltaPp: 4, p: 0.002, detectablePp: 13.73, servedPacks: 949 }));
    expect(verdict.state).toBe('UNRESOLVED');
    expect(verdict.claim).toBeNull();
  });

  it('refuses a benefit that clears the resolution bar but not the significance bar', () => {
    const verdict = pairedVerdict(input({ deltaPp: 20, p: 0.2, detectablePp: 13.73 }));
    expect(verdict.state).toBe('UNRESOLVED');
  });

  it('refuses a zero delta at either resolution', () => {
    expect(pairedVerdict(input({ deltaPp: 0, p: 1, detectablePp: 1 })).state).toBe('UNRESOLVED');
    expect(pairedVerdict(input({ deltaPp: 0, p: 1, detectablePp: 40 })).state).toBe('UNRESOLVED');
  });
});

describe('pairedVerdict — an unestimable resolution excludes nothing, and says so', () => {
  it('never claims a benefit when no task changed hands', () => {
    const verdict = pairedVerdict(input({ deltaPp: 0, p: 1, detectablePp: Infinity }));
    expect(verdict.state).toBe('UNRESOLVED');
    expect(verdict.excludedAbovePp).toBe(Infinity);
    expect(verdict.reason).toContain('excludes nothing');
  });

  it('still reports harm when the harm branch fires on an unestimable resolution', () => {
    const verdict = pairedVerdict(input({ deltaPp: -7, p: 0.3, servedPacks: 5, detectablePp: Infinity }));
    expect(verdict.state).toBe('HARM');
  });
});

describe('pairedVerdict — a broken instrument is refused, not graded', () => {
  it('refuses a non-finite delta', () => {
    expect(() => pairedVerdict(input({ deltaPp: Number.NaN }))).toThrow('deltaPp must be finite');
  });

  it('refuses a NaN resolution even though Infinity is a legal one', () => {
    expect(() => pairedVerdict(input({ detectablePp: Number.NaN }))).toThrow(
      'detectablePp must be a number',
    );
  });

  it('refuses a zero or negative resolution', () => {
    expect(() => pairedVerdict(input({ detectablePp: 0 }))).toThrow(
      'detectablePp must be positive',
    );
    expect(() => pairedVerdict(input({ detectablePp: -1 }))).toThrow(
      'detectablePp must be positive',
    );
  });

  it('refuses the readings revertRule refuses, rather than softening them', () => {
    expect(() => pairedVerdict(input({ p: 1.5 }))).toThrow('p is out of range');
    expect(() => pairedVerdict(input({ paired: 0 }))).toThrow('positive paired count');
    expect(() => pairedVerdict(input({ servedPacks: -1 }))).toThrow('non-negative');
  });
});
