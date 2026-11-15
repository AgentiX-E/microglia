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
  /**
   * Mean tokens of the system messages a call, which is where a pack and an adapter's preamble live.
   *
   * R135. The Python half has computed this per call since the census was written and then summed it into
   * a counter that nothing read, so every artefact reported a `prefix_tokens` that is *system + history*
   * under one name. The split is the attribution: a premium that sits in `systemTokensPerCall` is the
   * memory's own text, and one that sits in `conversationTokensPerCall` is the agent's behaviour.
   */
  readonly system_tokens_per_call?: number;
  /** Mean tokens of the non-system messages a call — the conversation the agent grew. */
  readonly conversation_tokens_per_call?: number;
  /** Mean tokens of the second-newest message a call: the tool result the turn appended. */
  readonly tail2_tokens?: number;
  /**
   * Mean uncached tokens a call that neither newest message accounts for.
   *
   * The number that decides whether `the-turn` is an attribution or a guess. `prompt - cached` is the
   * bill; the two newest messages are the largest thing the census can see behind it; what is left is
   * material the census never looked at — the tools block and the chat template's framing.
   */
  readonly residual_tokens_per_call?: number;
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
  'prefix-undercounted',
  'unmeasured',
] as const;

export type CacheCensusState = (typeof CACHE_CENSUS_STATES)[number];

/** Above this share of the prefix, the provider is holding it. The probe measured 0.98. */
export const PREFIX_HONOURED = 0.85;

/** Below this, it is not holding it at all, and the reading is about the boundary. */
export const PREFIX_BROKEN = 0.35;

/**
 * Above this share, the *denominator* is wrong rather than the prefix being held extra well.
 *
 * R135. `prefix_coverage` is `credited / seen`, and `seen` deliberately stops two messages short: a tool
 * loop appends the assistant's call and the tool's result together, so before the last two messages
 * everything was provably offered to the provider in an earlier request. That makes `seen` a **lower
 * bound**, and the provider routinely credits the newest of those excluded messages as well — so the
 * ratio lands above 1 by construction.
 *
 * R134's two arms printed 1.4752 and 2.2639, and both were classified `prefix-honoured` with the sentence
 * "the provider credited 226.4% of the 1880-token prefix it had seen, and the newest message was 163
 * tokens: the 420 uncached tokens a call are the turn's own material, not the memory's". A share above
 * 100% is not a provider being generous; it is the lane dividing by a number it knows is too small, and
 * the conclusion drawn from it — mine, in AUDIT 34.166 — was wrong for exactly that reason.
 */
export const PREFIX_UNDERCOUNTED = 1.02;

export type CacheCensusVerdict = {
  readonly state: CacheCensusState;
  readonly coverage: number | null;
  /** Mean uncached tokens a call, which is the number the whole decomposition is about. */
  readonly uncachedPerCall: number | null;
  /** Mean tokens of newest message a call — the candidate explanation for `uncachedPerCall`. */
  readonly tailPerCall: number | null;
  /** What the reading points a repair at. `unmeasured` when the census cannot attribute the bill. */
  readonly repair: 'the-turn' | 'the-prefix' | 'the-framing' | 'unmeasured';
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
  const system = finiteOrNull(census.system_tokens_per_call);
  const conversation = finiteOrNull(census.conversation_tokens_per_call);
  const residual = finiteOrNull(census.residual_tokens_per_call);
  // The split turns "the turn" or "the memory" from a preference into a measurement, so it is printed
  // whenever the phase reports it and omitted when it does not — an arm that predates R135 has no split,
  // and inventing a zero for it would be the absence-as-zero defect this module was written against.
  const split =
    system === null || conversation === null
      ? ''
      : `; of the ${String(Math.round(system + conversation))} message tokens a call, ` +
        `${String(Math.round(system))} were system (the pack and the adapter's preamble) and ` +
        `${String(Math.round(conversation))} were conversation`;
  const attribution =
    residual === null
      ? ''
      : residual <= Math.max(1, 0.1 * uncached)
        ? `, and the two newest messages account for all of them`
        : `, and ${String(Math.round(residual))} of them sit outside every message this census saw — ` +
          `the tools block and the chat template's framing`;

  if (coverage > PREFIX_UNDERCOUNTED) {
    return {
      state: 'prefix-undercounted',
      coverage,
      uncachedPerCall,
      tailPerCall,
      repair: 'unmeasured',
      sentence:
        `the provider credited ${percent}% of the ${String(prefix)}-token prefix this census counts as ` +
        `seen, which is more than it was shown: the share is above 1 because the denominator stops two ` +
        `messages short, not because the provider credited more than it held${split}; the ` +
        `${String(uncached)} uncached tokens a call cannot be attributed from this reading: the ` +
        `attribution R134's arms were read with is a guess until the split below is reported`,
    };
  }
  if (coverage >= PREFIX_HONOURED) {
    return {
      state: 'prefix-honoured',
      coverage,
      uncachedPerCall,
      tailPerCall,
      repair: 'the-turn',
      sentence:
        `the provider credited ${percent}% of the ${String(prefix)}-token prefix it had seen, and the ` +
        `newest message was ${String(tail)} tokens${split}: the ${String(uncached)} uncached tokens a ` +
        `call are the turn's own material${attribution}`,
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
        `a ${String(tail)}-token newest message${split}: the lane is re-billing a prefix it believes is ` +
        `cached${attribution}`,
    };
  }
  return {
    state: 'prefix-partial',
    coverage,
    uncachedPerCall,
    tailPerCall,
    repair: 'the-prefix',
    sentence:
      `the provider credited ${percent}% of the ${String(prefix)}-token prefix it had seen${split}: part ` +
      `of the prefix is re-billed on some calls, which is a boundary that moves rather than a size` +
      `${attribution}`,
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

/**
 * Characters per token, as a range rather than a number, for pricing a block.
 *
 * The census measures this ratio on the phase's first call when a run reports one (3.55 on R93's
 * corpus). It is a range here because the attribution has to be computable from artefacts that
 * predate the census, and a single borrowed constant would turn an estimate into a claim.
 */
export const CHARS_PER_TOKEN = { dense: 3.5, sparse: 4.0 } as const;

/** Two arms' uncached columns, and the characters the treatment served per call. */
export type PremiumInput = {
  readonly control: { readonly calls: number; readonly uncachedTokens: number };
  readonly treatment: {
    readonly calls: number;
    readonly uncachedTokens: number;
    /** Mean characters of the pack the treatment served, including its wrapper. */
    readonly servedChars: number;
  };
};

/**
 * What the treatment's uncached premium can and cannot be the block.
 *
 * The decomposition this answers is the one PROGRESS 179 could not: a premium is a single number, and
 * the block is only one of two things that can produce it. Dividing the served characters by the
 * characters-per-token range gives the block's **ceiling** — the most it could cost if every call paid
 * for it in full, in a regime where the provider caches nothing — and whatever is left over is material
 * the pack does not contain, which is the arm's own turn.
 *
 * `null` when the treatment was not more expensive per call: a negative premium is not a small premium,
 * and a share-of-a-negative is the arithmetic that produces −40%.
 */
export function premiumSplitOf(input: PremiumInput): PremiumSplit | null {
  const control = input.control.calls > 0 ? input.control.uncachedTokens / input.control.calls : 0;
  const treatment =
    input.treatment.calls > 0 ? input.treatment.uncachedTokens / input.treatment.calls : 0;
  const perCall = treatment - control;
  if (!(perCall > 0)) return null;
  const dense = input.treatment.servedChars / CHARS_PER_TOKEN.dense;
  const sparse = input.treatment.servedChars / CHARS_PER_TOKEN.sparse;
  const share = (tokens: number): number => tokens / perCall;
  const flatDense = perCall - dense;
  const flatSparse = perCall - sparse;
  return {
    perCall,
    blockTokens: [sparse, dense],
    blockShare: [share(sparse), share(dense)],
    // Ascending, like `blockTokens`: the block priced at its most expensive leaves the least for the
    // turn, and a range is read low-to-high.
    flatPerCall: [Math.max(0, flatDense), Math.max(0, flatSparse)],
    sentence:
      `+${perCall.toFixed(1)} uncached tokens a call over the control, of which the ` +
      `${String(Math.round(input.treatment.servedChars))} served character(s) can account for ` +
      `${(share(sparse) * 100).toFixed(1)}–${(share(dense) * 100).toFixed(1)}% even if every call paid ` +
      `for the block in full; ${Math.max(0, flatSparse).toFixed(1)}–${Math.max(0, flatDense).toFixed(1)} ` +
      `tokens a call are material the pack does not contain`,
  };
}

export type PremiumSplit = {
  /** Uncached tokens a call beyond the control's. */
  readonly perCall: number;
  /** The block's cost at 4.0 and at 3.5 characters a token, in that order. */
  readonly blockTokens: readonly [number, number];
  /** The same two, as a share of `perCall`. */
  readonly blockShare: readonly [number, number];
  /** What is left when the block is priced at its most expensive: the arm's own turn material. */
  readonly flatPerCall: readonly [number, number];
  readonly sentence: string;
};
