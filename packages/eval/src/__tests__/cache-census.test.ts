import { describe, expect, it } from 'vitest';
import {
  CACHE_CENSUS_STATES,
  PREFIX_BROKEN,
  PREFIX_HONOURED,
  cacheCensusVerdict,
  type PhaseCacheCensus,
} from '../cache-census.js';

/** The census R93's memory arm would have reported, on the numbers PROGRESS 179 derived. */
const measured = (over: Partial<PhaseCacheCensus> = {}): PhaseCacheCensus => ({
  measured: true,
  calls_with_messages: 2_667,
  chars_per_token: 3.86,
  prefix_tokens: 4_120,
  last_tokens: 1_424,
  cached_tokens_per_call: 4_959,
  uncached_tokens_per_call: 1_533,
  prefix_coverage: 0.96,
  first_call: { messages: 3, chars: 5_100, prompt_tokens: 1_321, cached_tokens: 0 },
  ...over,
});

describe('a census that says the prefix was held', () => {
  it('names the turn as the repair rather than the memory', () => {
    const verdict = cacheCensusVerdict(measured());
    expect(verdict.state).toBe('prefix-honoured');
    expect(verdict.repair).toBe('the-turn');
    // The sentence has to carry the three numbers that make the claim checkable: what was credited,
    // what the prefix was, and what the newest message was. A verdict sentence that says "cached
    // well" is a verdict nobody can re-derive.
    expect(verdict.sentence).toContain('96.0%');
    expect(verdict.sentence).toContain('4120-token prefix');
    expect(verdict.sentence).toContain('1424 tokens');
    expect(verdict.sentence).toContain('1533 uncached tokens a call');
    expect(verdict.coverage).toBe(0.96);
    expect(verdict.uncachedPerCall).toBe(1_533);
    expect(verdict.tailPerCall).toBe(1_424);
  });

  it('reads the threshold itself as held, because a floor that excludes its own value is a fence', () => {
    expect(cacheCensusVerdict(measured({ prefix_coverage: PREFIX_HONOURED })).state).toBe(
      'prefix-honoured',
    );
    expect(cacheCensusVerdict(measured({ prefix_coverage: PREFIX_HONOURED - 0.0001 })).state).toBe(
      'prefix-partial',
    );
  });
});

describe('a census that says the prefix was not held', () => {
  it('names the prefix as the repair', () => {
    const verdict = cacheCensusVerdict(measured({ prefix_coverage: 0.08 }));
    expect(verdict.state).toBe('prefix-broken');
    expect(verdict.repair).toBe('the-prefix');
    expect(verdict.sentence).toContain('8.0%');
    expect(verdict.sentence).toContain('re-billing a prefix it believes is cached');
  });

  it('separates a partial boundary from a broken one, because the two have different repairs', () => {
    // A boundary that moves on some calls is a cadence; a boundary that never holds is a placement.
    // Both read as "expensive", and only the coverage says which.
    const partial = cacheCensusVerdict(measured({ prefix_coverage: 0.6 }));
    expect(partial.state).toBe('prefix-partial');
    expect(partial.sentence).toContain('60.0%');
    expect(partial.sentence).toContain('a boundary that moves rather than a size');
    expect(cacheCensusVerdict(measured({ prefix_coverage: PREFIX_BROKEN })).state).toBe(
      'prefix-partial',
    );
    expect(cacheCensusVerdict(measured({ prefix_coverage: PREFIX_BROKEN - 0.01 })).state).toBe(
      'prefix-broken',
    );
  });
});

describe('an unmeasured census, which is not a reading of zero', () => {
  it('reads an absent census as absent', () => {
    for (const absent of [undefined, null]) {
      const verdict = cacheCensusVerdict(absent);
      expect(verdict.state).toBe('unmeasured');
      expect(verdict.repair).toBe('unmeasured');
      expect(verdict.coverage).toBeNull();
      expect(verdict.sentence).toContain('no per-call census');
    }
  });

  it('carries the phase reason when the phase gave one', () => {
    const verdict = cacheCensusVerdict({
      measured: false,
      calls_with_messages: 0,
      reason: 'no first call',
    });
    expect(verdict.state).toBe('unmeasured');
    expect(verdict.sentence).toContain('no first call');
    expect(verdict.sentence).toContain('could not census');
  });

  it('explains an unmeasured phase that gave no reason, using the count it did see', () => {
    // The distinction that matters: a phase whose callback saw 2,667 prompts and produced no census
    // is a defect, and a phase that saw none is a different instrument. Both are unmeasured, and the
    // sentence has to let a reader tell them apart.
    const verdict = cacheCensusVerdict({ measured: false, calls_with_messages: 2_667 });
    expect(verdict.state).toBe('unmeasured');
    expect(verdict.sentence).toContain('2667 call(s) carried messages');
  });

  it('refuses to call a phase with no prefix a measurement of zero coverage', () => {
    // Every call carried one or two messages, so there is no material the provider provably saw
    // before this call. Reporting 0.0 here would say the cache failed when the phase never offered
    // it anything to hold.
    const verdict = cacheCensusVerdict(measured({ prefix_coverage: null, prefix_tokens: 0 }));
    expect(verdict.state).toBe('unmeasured');
    expect(verdict.sentence).toContain('long enough to have a prefix');
  });

  it('treats a non-finite coverage as unmeasured rather than as a broken prefix', () => {
    // A NaN arrives from a division by a zero ratio, and `NaN < 0.35` is false, so a classifier that
    // only compared would fall through to `prefix-partial` and report a mechanism it never measured.
    const verdict = cacheCensusVerdict(measured({ prefix_coverage: Number.NaN }));
    expect(verdict.state).toBe('unmeasured');
  });

  it('states a prefix it was not told as zero rather than as NaN in its own sentence', () => {
    // `prefix_tokens` is absent on a phase whose callback counted calls but not characters. The
    // coverage still stands — it came from the same subtraction — and the sentence must not print
    // `NaN-token prefix`, which a reader would file as an instrument fault rather than as a detail.
    const verdict = cacheCensusVerdict(
      measured({ prefix_tokens: undefined, prefix_coverage: 0.9 }),
    );
    expect(verdict.state).toBe('prefix-honoured');
    expect(verdict.sentence).toContain('0-token prefix');
  });

  it('refuses a non-finite tail too, because half a census is not a measurement', () => {
    // `Number.isFinite` is the second half of the guard and the half a `??` would miss: a NaN arrives
    // from a division by a zero ratio and survives every `undefined` check on the way here.
    const verdict = cacheCensusVerdict(measured({ last_tokens: Number.NaN }));
    expect(verdict.tailPerCall).toBeNull();
    expect(verdict.sentence).toContain('0 tokens');
  });

  it('reports a missing tail as unknown rather than as zero tokens', () => {
    const verdict = cacheCensusVerdict(
      measured({ last_tokens: undefined, uncached_tokens_per_call: undefined }),
    );
    expect(verdict.state).toBe('prefix-honoured');
    expect(verdict.tailPerCall).toBeNull();
    expect(verdict.uncachedPerCall).toBeNull();
    expect(verdict.sentence).toContain('0 tokens');
  });
});

describe('the state list', () => {
  it('names every state the classifier can return, and no others', () => {
    const produced = new Set(
      [
        cacheCensusVerdict(undefined),
        cacheCensusVerdict({ measured: false }),
        cacheCensusVerdict(measured()),
        cacheCensusVerdict(measured({ prefix_coverage: 0.6 })),
        cacheCensusVerdict(measured({ prefix_coverage: 0.05 })),
      ].map((verdict) => verdict.state),
    );
    expect([...produced].sort()).toEqual([...CACHE_CENSUS_STATES].sort());
  });
});
