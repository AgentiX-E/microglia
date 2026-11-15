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
  /** Mean tokens of the tool schemas a call, counted from the request because no message carries them. */
  readonly tools_tokens_per_call?: number;
  /**
   * Mean prompt tokens a call beyond the messages and the tool schemas: the chat template's framing.
   *
   * R135 defined this field as `uncached - last - tail2` and then read it as "material no message
   * carries". That arithmetic makes it inherit the entire premium by construction whenever two arms cache
   * differently — memory 1409.7 against the reference's 179.5, which is 99.7% of a premium that is 45% a
   * longer prompt and 45% a worse cache. A residual of a residual is not an attribution. It is measured
   * against the prompt column now, so it means what its name says: the framing, and nothing else.
   */
  readonly residual_tokens_per_call?: number;
  /** Mean prompt tokens a call, so the three message-and-tool columns have a denominator to subtract from. */
  readonly prompt_tokens_per_call?: number;
  /**
   * Mean characters of the system messages a call, and of the rest.
   *
   * R136. The character columns exist because the one measurement that can attribute the system column is
   * a *length*, and the agent records its injected message in characters. Converting either side through
   * `chars_per_token` to compare them is how a ratio becomes a conclusion; comparing them where they are
   * measured is how it stays a measurement.
   */
  readonly system_chars_per_call?: number;
  readonly conversation_chars_per_call?: number;
  /**
   * Calls that carried a second system message, i.e. the calls the pack rode on.
   *
   * The callback sees every model call a simulation makes, the user simulator's included, and the
   * simulator's system prompt is neither the agent's policy nor the pack. A mean over both is a mixture
   * whose composition moves with how many turns each side took, which is why R135 could read a 559-token
   * system growth and not say what it was made of.
   */
  readonly packed_calls?: number;
  readonly system_chars_per_packed_call?: number;
  readonly system_chars_per_unpacked_call?: number;
  /** The agent's own injected characters, divided by the calls the census saw carrying a pack. */
  readonly injected_chars_per_packed_call?: number;
  /**
   * What the system column carries beyond the injected message, per packed call: the adapter's preamble.
   *
   * This is the column no field on this record has ever named. R135 priced a 559-token system growth
   * against a 725-character pack, and the remainder — about 409 tokens a call — was neither the pack nor
   * the conversation: it was material the pack's own length cannot account for, sitting in a column that
   * was reported as one number.
   */
  readonly carriage_chars_per_packed_call?: number;
  readonly carriage_tokens_per_call?: number;
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
  /**
   * The injected message's share of the system column it rides in, when both were measured.
   *
   * R136. `null` when the phase reported no carriage, which is every artefact written before this
   * instrument: a pack that is 27% of its own column and a pack that is 90% of it call for different next
   * dollars, and only a share says which one this is.
   */
  readonly carriageShare: number | null;
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
  const prompt = finiteOrNull(census.prompt_tokens_per_call);
  const tools = finiteOrNull(census.tools_tokens_per_call);
  // Descriptive, not causal: the four columns of the prompt and the cache credit beside them. R135's
  // sentence claimed an attribution from a residual that could not carry one, and the repair is to print
  // the composition and let the reader subtract -- the arithmetic of a premium is a subtraction, and a
  // sentence that performs it in prose has to get the same answer as the numbers.
  const composition =
    prompt === null || system === null || conversation === null || tools === null || residual === null
      ? ''
      : `; of the ${String(Math.round(prompt))} prompt tokens a call, ${String(Math.round(system))} were ` +
        `system, ${String(Math.round(conversation))} conversation, ${String(Math.round(tools))} tool ` +
        `schemas and ${String(Math.round(residual))} framing`;
  // R136: the system column split into the message the agent injected and the carriage it did not. Printed
  // only when the phase reports both, so an arm that predates the instrument says nothing rather than zero.
  const pair = carriagePair(census);
  const carriageShare = pair === null ? null : pair.injected / (pair.injected + pair.carriage);
  const carriage =
    pair === null
      ? ''
      : `; on the ${String(Math.round(pair.calls))} call(s) that carried a pack the injected message was ` +
        `${String(Math.round(pair.injected))} characters and the system column carried ` +
        `${String(Math.round(pair.carriage))} more` +
        (pair.tokens === null ? '' : ` (about ${String(Math.round(pair.tokens))} tokens)`);

  if (coverage > PREFIX_UNDERCOUNTED) {
    return {
      state: 'prefix-undercounted',
      coverage,
      uncachedPerCall,
      tailPerCall,
      repair: 'unmeasured',
      carriageShare,
      sentence:
        `the provider credited ${percent}% of the ${String(prefix)}-token prefix this census counts as ` +
        `seen, which is more than it was shown: the share is above 1 because the denominator stops two ` +
        `messages short, not because the provider credited more than it held${split}${composition}` +
        `${carriage}; the ` +
        `${String(uncached)} uncached tokens a call cannot be attributed from this reading: the ` +
        `attribution R134's arms were read with is a guess until the split is read beside the prompt's ` +
        `own composition`,
    };
  }
  if (coverage >= PREFIX_HONOURED) {
    return {
      state: 'prefix-honoured',
      coverage,
      uncachedPerCall,
      tailPerCall,
      repair: 'the-turn',
      carriageShare,
      sentence:
        `the provider credited ${percent}% of the ${String(prefix)}-token prefix it had seen, and the ` +
        `newest message was ${String(tail)} tokens${split}${composition}${carriage}: the ${String(uncached)} ` +
        `uncached tokens a call are the turn's own material`,
    };
  }
  if (coverage < PREFIX_BROKEN) {
    return {
      state: 'prefix-broken',
      coverage,
      uncachedPerCall,
      tailPerCall,
      repair: 'the-prefix',
      carriageShare,
      sentence:
        `the provider credited ${percent}% of the ${String(prefix)}-token prefix it had seen, against ` +
        `a ${String(tail)}-token newest message${split}${composition}${carriage}: the lane is re-billing a ` +
        `prefix it believes is cached`,
    };
  }
  return {
    state: 'prefix-partial',
    coverage,
    uncachedPerCall,
    tailPerCall,
    repair: 'the-prefix',
    carriageShare,
    sentence:
      `the provider credited ${percent}% of the ${String(prefix)}-token prefix it had seen${split}` +
      `${composition}${carriage}: part of the prefix is re-billed on some calls, which is a boundary that ` +
      `moves rather than a size`,
  };
}

function finiteOrNull(value: number | undefined | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * The two lengths the carriage is made of, or `null` when the phase did not record both.
 *
 * One function rather than a condition at the call site, because the call site needed three conjunctions to
 * say "both halves and a denominator" and each of them is a branch that has to be reachable to be tested.
 * Here every rejection is an input the reader can be handed: a census without the injection, a census with
 * the injection but no column, an empty column (nothing to divide), and no call count (nothing to divide by).
 */
function carriagePair(census: PhaseCacheCensus): {
  readonly injected: number;
  readonly carriage: number;
  readonly calls: number;
  readonly tokens: number | null;
} | null {
  const injected = finiteOrNull(census.injected_chars_per_packed_call);
  if (injected === null) return null;
  const carriage = finiteOrNull(census.carriage_chars_per_packed_call);
  if (carriage === null) return null;
  if (injected + carriage <= 0) return null;
  const calls = finiteOrNull(census.packed_calls);
  if (calls === null) return null;
  return { injected, carriage, calls, tokens: finiteOrNull(census.carriage_tokens_per_call) };
}

function unmeasured(sentence: string): CacheCensusVerdict {
  return {
    state: 'unmeasured',
    coverage: null,
    uncachedPerCall: null,
    tailPerCall: null,
    repair: 'unmeasured',
    carriageShare: null,
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
