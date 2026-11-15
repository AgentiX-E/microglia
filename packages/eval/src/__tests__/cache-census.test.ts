import { describe, expect, it } from 'vitest';
import {
  CACHE_CENSUS_STATES,
  PREFIX_BROKEN,
  PREFIX_HONOURED,
  cacheCensusVerdict,
  premiumSplitOf,
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

describe('a share above 1 is the denominator, not the provider', () => {
  it('refuses the attribution when the credited tokens exceed what the census counted as seen', () => {
    // R134's two arms: 1.4752 and 2.2639. Both were classified `prefix-honoured` and both printed
    // "the provider credited 226.4% of the 1880-token prefix it had seen, and ... the 420 uncached
    // tokens a call are the turn's own material, not the memory's". A share above 100% of what a
    // provider was shown is not a cache that held extra; it is a denominator that stops two messages
    // short. The conclusion drawn from it was mine, in AUDIT 34.166, and it was wrong.
    const verdict = cacheCensusVerdict(
      measured({ prefix_coverage: 2.2639, cached_tokens_per_call: 4_255, uncached_tokens_per_call: 420 }),
    );
    expect(verdict.state).toBe('prefix-undercounted');
    expect(verdict.repair).toBe('unmeasured');
    expect(verdict.sentence).toContain('226.4%');
    expect(verdict.sentence).toContain('more than it was shown');
    expect(verdict.sentence).toContain('cannot be attributed from this reading');
    // The claim that made 34.166 wrong is not printed at all.
    expect(verdict.sentence).not.toContain("the turn's own material");
  });

  it('keeps a share of exactly 1 as held, because 1.0 is a prefix that was fully counted', () => {
    // The guard is above the honest case by construction, not at it: an arm whose two newest messages
    // were exactly the ones the census excludes reports 1.0 and is held.
    expect(cacheCensusVerdict(measured({ prefix_coverage: 1 })).state).toBe('prefix-honoured');
    expect(cacheCensusVerdict(measured({ prefix_coverage: 1.03 })).state).toBe(
      'prefix-undercounted',
    );
  });
});

describe('the split, once the census reports one', () => {
  it('states the four columns the prompt is made of, which is a composition not an attribution', () => {
    // R135. The memory arm's own numbers: 5,376 prompt tokens a call, and the four columns that add up to
    // it. R134's artefact had two of them under one name (`prefix_tokens` was system plus history) and the
    // premium was attributed to a column nobody had isolated.
    const verdict = cacheCensusVerdict(
      measured({
        prefix_coverage: 0.72,
        prompt_tokens_per_call: 5_376,
        system_tokens_per_call: 1_613,
        conversation_tokens_per_call: 988,
        tools_tokens_per_call: 1_569,
        residual_tokens_per_call: 1_206,
      }),
    );
    expect(verdict.sentence).toContain('5376 prompt tokens a call');
    expect(verdict.sentence).toContain('1613 were system');
    expect(verdict.sentence).toContain('988 conversation');
    expect(verdict.sentence).toContain('1569 tool schemas');
    expect(verdict.sentence).toContain('1206 framing');
    // The five columns are the whole prompt: a composition that did not add up would be the
    // residual-of-a-residual defect one layer out.
    expect(1_613 + 988 + 1_569 + 1_206).toBe(5_376);
  });

  it('omits the composition when one column is missing, because half a sum is not a sum', () => {
    // An arm that reports the split but not the tools cannot be composed, and printing the three it has
    // would leave a remainder looking like framing. Absence, not zero.
    const verdict = cacheCensusVerdict(
      measured({
        prefix_coverage: 0.9,
        prompt_tokens_per_call: 4_000,
        system_tokens_per_call: 1_000,
        conversation_tokens_per_call: 900,
      }),
    );
    expect(verdict.sentence).not.toContain('prompt tokens a call');
  });

  it('leaves the split out rather than inventing a zero for an arm that predates it', () => {
    // Every artefact before R135 has no split. Printing "0 were system" would be an absence read as a
    // measurement -- the defect this module's own docstring is about.
    const verdict = cacheCensusVerdict(measured());
    expect(verdict.sentence).not.toContain('were system');
    expect(verdict.sentence).not.toContain('prompt tokens a call');
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
        cacheCensusVerdict(measured({ prefix_coverage: 2.2639 })),
      ].map((verdict) => verdict.state),
    );
    expect([...produced].sort()).toEqual([...CACHE_CENSUS_STATES].sort());
  });
});

describe('the premium, split into what the block can and cannot explain', () => {
  // The five arms of PROGRESS 185, as the artefacts report them. These are committed numbers: the
  // decomposition below is the sentence the round published, and a change to any constant in
  // `cache-census.ts` has to move them.
  const arms = {
    r93Reference: { calls: 2_726, uncachedTokens: 1_112_267, servedChars: 0 },
    r101Scaffold: { calls: 2_660, uncachedTokens: 1_100_517, servedChars: 0 },
    r93Memory: { calls: 2_667, uncachedTokens: 4_087_772, servedChars: 1_745 },
    r99Memory: { calls: 2_646, uncachedTokens: 4_235_349, servedChars: 1_986 },
  };

  it('prices the wrapper at five tokens a call, which is one percent of the memory premium', () => {
    // R101's scaffold arm is the same agent class with an empty pack: 413.7 uncached tokens a call
    // against the reference's 408.0. The wrapper is not free, it is *indistinguishable* — 5.7 tokens
    // on a 1,124.7 premium — and the difference matters, because "costs nothing" would still be true
    // if an agent class cost twenty tokens a call and nobody had multiplied it by 2,660.
    const split = premiumSplitOf({ control: arms.r93Reference, treatment: arms.r101Scaffold });
    expect(split?.perCall).toBeCloseTo(5.7, 1);
    expect(split?.blockShare[0]).toBe(0);
    expect(split?.sentence).toContain('0 served character(s)');
  });

  it('refuses a premium that is not one, rather than reporting a share of a negative', () => {
    expect(
      premiumSplitOf({
        control: { calls: 100, uncachedTokens: 50_000 },
        treatment: { calls: 100, uncachedTokens: 40_000, servedChars: 1_000 },
      }),
    ).toBeNull();
  });

  it('bounds the block and leaves the rest to the turn', () => {
    const split = premiumSplitOf({ control: arms.r93Reference, treatment: arms.r93Memory });
    expect(split).not.toBeNull();
    // 1,532.7 against 408.0 uncached tokens a call, each arm divided by its own calls.
    expect(split?.perCall).toBeCloseTo(1_124.7, 1);
    // 1,745 characters: 436.3 tokens at 4.0 characters each, 498.6 at 3.5.
    expect(split?.blockTokens[0]).toBeCloseTo(436.25, 2);
    expect(split?.blockTokens[1]).toBeCloseTo(498.57, 2);
    expect(split?.blockShare[0]).toBeCloseTo(0.388, 3);
    expect(split?.blockShare[1]).toBeCloseTo(0.443, 3);
    // And therefore more than half of the premium is not the pack at all.
    expect(split?.flatPerCall[0]).toBeCloseTo(626.1, 0);
    expect(split?.flatPerCall[1]).toBeCloseTo(688.4, 0);
    expect(split?.sentence).toContain('the pack does not contain');
  });

  it('prices a bigger pack without pretending its size is the whole premium', () => {
    // R99 served 241 more characters than R93 and paid 67.9 more uncached tokens a call: the
    // size-dependent slope is 0.2819, and the flat component barely moves. Both arms are the same
    // mechanism at two sizes, which is what makes the slope a measurement rather than a coincidence.
    const small = premiumSplitOf({ control: arms.r93Reference, treatment: arms.r93Memory });
    const large = premiumSplitOf({ control: arms.r93Reference, treatment: arms.r99Memory });
    expect(large!.perCall - small!.perCall).toBeCloseTo(67.9, 1);
    expect(
      (large!.perCall - small!.perCall) / (arms.r99Memory.servedChars - arms.r93Memory.servedChars),
    ).toBeCloseTo(0.2819, 3);
    // The flat component moves by 10 tokens when the pack grows by 241 characters, i.e. it is not
    // tracking the pack: it is the arm's own turn, and it is the majority of both premiums.
    expect(Math.abs(large!.flatPerCall[0] - small!.flatPerCall[0])).toBeLessThan(25);
  });

  it('refuses to divide by an arm that made no call', () => {
    // A rate over no calls is not a rate, and a premium computed from one would be infinite.
    expect(
      premiumSplitOf({
        control: { calls: 0, uncachedTokens: 0 },
        treatment: { calls: 0, uncachedTokens: 500, servedChars: 100 },
      }),
    ).toBeNull();
    const split = premiumSplitOf({
      control: { calls: 0, uncachedTokens: 0 },
      treatment: { calls: 10, uncachedTokens: 500, servedChars: 100 },
    });
    expect(split?.perCall).toBeCloseTo(50, 6);
  });
});
