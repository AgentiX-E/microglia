/**
 * Whether the provider held the prefix an arm believed it had already sent.
 *
 * R93 and R99 were billed 2.17× the control on identical tasks, and PROGRESS 179 put 99.9% of that
 * premium in the uncached column. The probe of PROGRESS 181 then refused the placement theory: a
 * 1,497-token block costs **31** uncached tokens a call wherever it sits, so a cached block cannot be
 * a cache an arm destroys. What was left was a number with no mechanism — roughly 1.1k extra miss
 * tokens on each of sixteen calls — and the phase totals cannot separate the two mechanisms that
 * produce it, because both appear as the same subtraction:
 *
 *  - **the turn grew**: each call appends an assistant message and a tool result, and a memory arm
 *    whose rule changes the action mix returns larger observations. The prefix is held; the new
 *    material is simply bigger. The repair is the agent, not the pack.
 *  - **the prefix is re-billed**: something in front of the conversation changes between calls, so
 *    the provider's cache ends early and every call pays again for material the lane thinks is
 *    stable. The repair is the cadence or the boundary.
 *
 * One number separates them and the lane has been throwing it away: the provider already reports
 * `prompt_cache_hit_tokens` per call, and the callback already holds the messages it sent. Put the
 * two side by side and the question answers itself — **`prefix_coverage`** is the share of the
 * material the provider provably saw in an earlier request that it actually credited.
 *
 * ## Why this module is not another `cache-placement`
 *
 * `cache-placement.ts` classifies a *probe*: four placements, a synthetic block, a series it built
 * itself. This one classifies an *arm*: whatever the run sent, read off the run's own callbacks, with
 * no synthetic text anywhere. The probe answers "where should the block go" and answered it; this
 * answers "why is this arm's bill what it is", which the probe cannot because the probe never has an
 * agent in it.
 *
 * ## The thresholds are the probe's reading, not a preference
 *
 * `cache-placement` measured the provider crediting 1,466 of a 1,497-token prefix on a warm call:
 * a coverage of **0.98**. A prefix the provider holds is therefore held almost exactly, and anything
 * below 0.85 is a prefix that is not being held. 0.35 is the floor of "held at all" — under it, the
 * lane is paying for material it believes is cached, and the mechanism is the boundary.
 */

/**
 * The census one phase reports, in the field names its callback wrote.
 *
 * Snake case on purpose: these come off a JSON object produced by `eval/drivers/tau2/run_split.py`,
 * and a renamed copy in TypeScript would be the second vocabulary for one measurement.
 */
export type PhaseCacheCensus = {
  readonly measured: boolean;
  /** Calls whose messages the callback saw. Zero on a phase that reports totals only. */
  readonly calls_with_messages?: number;
  /** Characters per token, measured on the one call the provider had never seen. */
  readonly chars_per_token?: number;
  /** Mean tokens of material the provider provably saw in an earlier request, per call. */
  readonly prefix_tokens?: number;
  /** Mean tokens of the newest message, per call: the turn's own material. */
  readonly last_tokens?: number;
  readonly cached_tokens_per_call?: number;
  readonly uncached_tokens_per_call?: number;
  /** Credited over provably-seen. Absent when no call was long enough to have a prefix. */
  readonly prefix_coverage?: number | null;
  /** Why there is no census, when the phase says why. */
  readonly reason?: string;
  readonly first_call?: {
    readonly messages: number;
    readonly chars: number;
    readonly prompt_tokens: number;
    readonly cached_tokens: number;
  };
};

/** The four readings. `unmeasured` is a state, not an error: a phase can legitimately lack one. */
export const CACHE_CENSUS_STATES = [
  'prefix-honoured',
  'prefix-partial',
  'prefix-broken',
  'unmeasured',
] as const;

export type CacheCensusState = (typeof CACHE_CENSUS_STATES)[number];

/** Above this share of the prefix, the provider is holding it. The probe measured 0.98. */
export const PREFIX_HONOURED = 0.85;

/** Below this, it is not holding it at all, and the reading is about the boundary. */
export const PREFIX_BROKEN = 0.35;

export type CacheCensusVerdict = {
  readonly state: CacheCensusState;
  readonly coverage: number | null;
  /** Mean uncached tokens a call, which is the number the whole decomposition is about. */
  readonly uncachedPerCall: number | null;
  /** Mean tokens of newest message a call — the candidate explanation for `uncachedPerCall`. */
  readonly tailPerCall: number | null;
  /** What the reading points a repair at. `none` when the arm is not paying for a prefix. */
  readonly repair: 'the-turn' | 'the-prefix' | 'unmeasured';
  readonly sentence: string;
};

/**
 * The verdict for one arm's census.
 *
 * Total over every shape the census can arrive in: absent, unmeasured, measured without a prefix,
 * and the three covered ranges. A classifier with a branch that cannot be reached is a branch nobody
 * has read, so every state below is produced by a committed test.
 */
export function cacheCensusVerdict(census: PhaseCacheCensus | undefined | null): CacheCensusVerdict {
  if (census === undefined || census === null) {
    return unmeasured('the phase reported no per-call census, so its bill cannot be attributed');
  }
  if (census.measured !== true) {
    return unmeasured(
      census.reason === undefined
        ? `${String(census.calls_with_messages ?? 0)} call(s) carried messages, which is not a census`
        : `the phase could not census its calls: ${census.reason}`,
    );
  }
  const coverage = census.prefix_coverage;
  if (coverage === undefined || coverage === null || !Number.isFinite(coverage)) {
    return unmeasured(
      'no call in the phase was long enough to have a prefix the provider had already seen',
    );
  }
  const tailPerCall = finiteOrNull(census.last_tokens);
  const uncachedPerCall = finiteOrNull(census.uncached_tokens_per_call);
  const prefix = Math.round(census.prefix_tokens ?? 0);
  const tail = Math.round(tailPerCall ?? 0);
  const uncached = Math.round(uncachedPerCall ?? 0);
  const percent = (coverage * 100).toFixed(1);

  if (coverage >= PREFIX_HONOURED) {
    return {
      state: 'prefix-honoured',
      coverage,
      uncachedPerCall,
      tailPerCall,
      repair: 'the-turn',
      sentence:
        `the provider credited ${percent}% of the ${String(prefix)}-token prefix it had seen, and the ` +
        `newest message was ${String(tail)} tokens: the ${String(uncached)} uncached tokens a call are ` +
        `the turn's own material, not the memory's`,
    };
  }
  if (coverage < PREFIX_BROKEN) {
    return {
      state: 'prefix-broken',
      coverage,
      uncachedPerCall,
      tailPerCall,
      repair: 'the-prefix',
      sentence:
        `the provider credited ${percent}% of the ${String(prefix)}-token prefix it had seen, against ` +
        `a ${String(tail)}-token newest message: the lane is re-billing a prefix it believes is cached`,
    };
  }
  return {
    state: 'prefix-partial',
    coverage,
    uncachedPerCall,
    tailPerCall,
    repair: 'the-prefix',
    sentence:
      `the provider credited ${percent}% of the ${String(prefix)}-token prefix it had seen: part of ` +
      `the prefix is re-billed on some calls, which is a boundary that moves rather than a size`,
  };
}

function finiteOrNull(value: number | undefined | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function unmeasured(sentence: string): CacheCensusVerdict {
  return {
    state: 'unmeasured',
    coverage: null,
    uncachedPerCall: null,
    tailPerCall: null,
    repair: 'unmeasured',
    sentence,
  };
}
