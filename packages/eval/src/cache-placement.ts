/**
 * Where the pack sits, priced before it is dispatched.
 *
 * R93 and R99 were billed 2.17× the control on identical tasks, and PROGRESS 179 decomposed that
 * premium to the cent: 99.9% of it is **uncached prompt tokens**, and the per-call arithmetic puts
 * it at roughly 1.1k extra miss tokens on each of sixteen calls rather than one miss per episode.
 * Two mechanisms produce that number and they need opposite repairs:
 *
 *  - the block is rendered **outside** the cached prefix, so the prefix ends at the native system
 *    message and everything the pack adds is paid again on every call — a placement defect, and
 *    moving the block fixes it;
 *  - the block is **inside** the prefix but the material behind it is not cached, so the block is
 *    billed because it sits in front of a boundary the provider does not carry — a property of the
 *    second system message, and merging the two messages fixes it.
 *
 * The lane's ledger cannot tell them apart, and neither can a score: both look like "the memory arm
 * cost twice as much". What tells them apart is a probe that sends the same prefix under each
 * placement and reads the provider's own `prompt_cache_hit_tokens`, which is a number this record
 * has been paying for and never reading per shape.
 *
 * ## Why a probe rather than an arm
 *
 * R102 is registered as a treatment — the block moves, the prompt changes, so the score can change —
 * and it costs $0.83 whether or not its premise holds. The premise is a **mechanical fact about
 * prefix caching**, and a mechanical fact is cheaper to measure than to assume: four shapes over
 * nine growing turns is 36 calls of a few thousand prompt tokens each, which is cents. An arm
 * dispatched on a guessed premise does not merely waste $0.83; it produces a delta that cannot be
 * attributed, because a reader cannot tell a treatment that fixed the cache from a treatment that
 * changed the prompt.
 *
 * ## What this module is, and is not
 *
 * It builds the four prompt shapes, and it classifies the readings. It does not make an HTTP call:
 * the driver owns the network, exactly as `provider-probe.ts` splits the same way, so every branch
 * below is reachable from a committed reading rather than from an outage.
 *
 * The four shapes are the three placements this record could ship plus the control:
 *
 *  | placement         | prompt                                                        |
 *  | ----------------- | ------------------------------------------------------------- |
 *  | `control`         | `[system native] …history…`                                    |
 *  | `system-second`   | `[system native][system block] …history…`  (what the arm sends) |
 *  | `system-merged`   | `[system native + block] …history…`                            |
 *  | `first-turn`      | `[system native][user task + block] …history…`                 |
 *
 * `first-turn` is ExpeL's placement — the insights ride the task instruction rather than the policy
 * — and it is the only one of the three that changes the block's *illocutionary* position, which is
 * the thing the memory-failure literature blames. `system-merged` changes only the message
 * boundary. `system-second` is the current arm. A probe that measured only the two system shapes
 * would price the cache and nothing else; the third is what makes the same 36 calls also answer
 * "what would the other placement cost", which is the question R102 would otherwise have to buy.
 */

/** A message in the shape the provider reads, which is all this module needs of a chat turn. */
export type PromptMessage = {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
};

/** The placements a dispatch can ask for. `control` carries no block at all. */
export const PACK_PLACEMENTS = ['control', 'system-second', 'system-merged', 'first-turn'] as const;

export type PackPlacement = (typeof PACK_PLACEMENTS)[number];

/** One growing conversation, as the probe sends it: a policy, a block, and the turns so far. */
export type PlacementPromptInput = {
  /** τ²'s own system policy — the text the reference arm sends and nothing else. */
  readonly native: string;
  /** The rendered pack, wrapper included, exactly as `renderPack` produced it. */
  readonly block: string;
  /** The episode so far. The last turn is the one being answered. */
  readonly turns: readonly { readonly user: string; readonly assistant: string }[];
};

/**
 * The messages one placement sends for one point in an episode.
 *
 * Deterministic and total: no placement falls back to another, because a probe that silently ran
 * the control under a treatment's name would report that the treatment is free.
 */
export function placementPromptFor(
  placement: PackPlacement,
  input: PlacementPromptInput,
): readonly PromptMessage[] {
  const history: PromptMessage[] = [];
  for (const turn of input.turns) {
    history.push({ role: 'user', content: turn.user });
    history.push({ role: 'assistant', content: turn.assistant });
  }
  const system = (content: string): PromptMessage => ({ role: 'system', content });

  switch (placement) {
    case 'control':
      return [system(input.native), ...history];
    // Today's arm: a second system message, after the policy and before the conversation.
    case 'system-second':
      return [system(input.native), system(input.block), ...history];
    // One message, so the policy and the block are one prefix rather than two.
    case 'system-merged':
      return [system(`${input.native}\n\n${input.block}`), ...history];
    // ExpeL's placement: the block rides the task statement instead of the policy. Refused on an
    // empty episode rather than given a shape of its own, because a block with no turn to attach to
    // is a different treatment and a probe that quietly substituted one would price the wrong thing.
    case 'first-turn': {
      const first = input.turns[0];
      if (first === undefined) {
        throw new Error(
          "the `first-turn` placement needs at least one turn to attach the block to; " +
            'a probe with none is measuring a shape it did not name',
        );
      }
      return [
        system(input.native),
        { role: 'user', content: `${first.user}\n\n${input.block}` },
        { role: 'assistant', content: first.assistant },
        ...history.slice(2),
      ];
    }
  }
}

/** One call's prompt, as the provider reported it. Nothing here is derived from a rate card. */
export type CacheReading = {
  readonly promptTokens: number;
  readonly cachedTokens: number;
};

/**
 * One shape's bill, in the two regimes it actually has.
 *
 * A prompt is either cached or it is not; the series of per-call uncached counts is bimodal, so the
 * **median** of the steady state is the typical call and the mean is a blend of the two regimes
 * weighted by how often the cache happened to be warm. Both are reported, the verdict reads the
 * median, and the first call is kept separate because it can never be a hit: the prefix did not
 * exist until this call wrote it.
 */
export type CacheLedger = {
  readonly calls: number;
  readonly promptTokens: number;
  readonly cachedTokens: number;
  readonly uncachedTokens: number;
  /** Per call, in order. The shape's fingerprint: a mean alone cannot show a boundary. */
  readonly uncachedSeries: readonly number[];
  /** Per call, in order — the denominator the cache rate is computed over. */
  readonly promptSeries: readonly number[];
  /** The first call, which is a miss by construction and is not evidence about the boundary. */
  readonly firstUncached: number;
  /** Median of the per-call uncached counts after the first. Zero for a single-call shape. */
  readonly steadyUncached: number;
  /** Mean of the same population, which is what the arm's bill is actually made of. */
  readonly steadyMeanUncached: number;
};

/**
 * The tolerance a delta is read against, in tokens.
 *
 * The provider caches in token blocks and not in single tokens, so a shape that differs from the
 * control by less than a block cannot be said to be missing from the cache — it is a rounding
 * boundary, not a regime. 128 is two of the 64-token blocks: the point at which a delta is a
 * measurement rather than an accounting residue.
 */
export const CACHE_TOLERANCE_TOKENS = 128;

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  // An even population has two middles and no middle; the mean of the pair is used rather than the
  // lower one, because the series is short (seconds, not thousands) and picking a side would make
  // the verdict depend on which side the extra call landed.
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** Fold one shape's readings into the two regimes a verdict reads. */
export function cacheLedgerOf(readings: readonly CacheReading[]): CacheLedger {
  const uncachedSeries: number[] = [];
  const promptSeries: number[] = [];
  let promptTokens = 0;
  let cachedTokens = 0;
  for (const reading of readings) {
    // Clamped rather than trusted: a provider that reports a hit count larger than the prompt is
    // reporting about a different request, and believing it would produce a negative bill.
    const prompt = Math.max(0, reading.promptTokens);
    const cached = Math.min(prompt, Math.max(0, reading.cachedTokens));
    promptSeries.push(prompt);
    uncachedSeries.push(prompt - cached);
    promptTokens += prompt;
    cachedTokens += cached;
  }
  const steady = uncachedSeries.slice(1);
  return {
    calls: readings.length,
    promptTokens,
    cachedTokens,
    uncachedTokens: promptTokens - cachedTokens,
    uncachedSeries,
    promptSeries,
    firstUncached: uncachedSeries[0] ?? 0,
    steadyUncached: median(steady),
    steadyMeanUncached:
      steady.length === 0 ? 0 : steady.reduce((sum, value) => sum + value, 0) / steady.length,
  };
}

/** One shape as the artefact carries it: what it cost, and what it cost relative to the control. */
export type PlacementReadout = {
  readonly placement: PackPlacement;
  readonly ledger: CacheLedger;
  /** Steady-state uncached tokens beyond the control's. Negative is possible and is a phase effect. */
  readonly delta: number;
};

/**
 * What the four shapes said about *why* the pack costs what it costs.
 *
 * Four states, and the two that are not about placement are the reason this type has four:
 *
 *  - `placement-is-the-boundary` — the second system message is re-billed and the merged one is not.
 *    The block sits behind a boundary the provider does not carry. R102 is confirmed before it is
 *    dispatched, and its prediction is this number rather than a guess.
 *  - `block-never-cached` — every placement that carries a block pays. Placement is not the lever;
 *    the block's *content* is outside the cache for a reason that moving it cannot change, and R102
 *    as registered is refused rather than run.
 *  - `placement-is-free` — the second system message is cached like the control's. The arm's premium
 *    is something else entirely, and the R102 premise is refuted on the cheapest possible evidence.
 *  - `inconclusive` — a shape is missing, or the block measured zero tokens, so no delta is about
 *    the block. Not a pass: a probe that could not see must not be read as a probe that saw nothing.
 */
export type PlacementVerdictState =
  | 'placement-is-the-boundary'
  | 'block-never-cached'
  | 'placement-is-free'
  | 'inconclusive';

export type PlacementVerdict = {
  readonly state: PlacementVerdictState;
  /** Prompt tokens the block adds, measured on the first call where the history is identical. */
  readonly blockTokens: number;
  readonly readouts: readonly PlacementReadout[];
  /** One sentence a report can quote without recomputing anything. */
  readonly sentence: string;
};

/**
 * Classify four ledgers.
 *
 * The block's size is **measured**, not passed in: the first call's prompt differs between the
 * merged shape and the control by exactly the block, and the history at that point is one turn for
 * both. A caller that supplied the size could supply the wrong one, and every delta would then be
 * read against the wrong denominator.
 */
export function placementVerdict(
  ledgers: Readonly<Partial<Record<PackPlacement, CacheLedger>>>,
): PlacementVerdict {
  const control = ledgers.control;
  const second = ledgers['system-second'];
  const merged = ledgers['system-merged'];
  const firstTurn = ledgers['first-turn'];

  const readouts: PlacementReadout[] = [];
  const base = control?.steadyUncached ?? 0;
  for (const placement of PACK_PLACEMENTS) {
    const ledger = ledgers[placement];
    // A shape the probe skipped is absent from the readout rather than present with a zero: an arm
    // that was not run and an arm that cost nothing are different facts.
    if (ledger === undefined) continue;
    readouts.push({ placement, ledger, delta: ledger.steadyUncached - base });
  }

  const missing =
    control === undefined ||
    second === undefined ||
    merged === undefined ||
    control.calls === 0 ||
    second.calls === 0 ||
    merged.calls === 0;
  // The control's first call is the baseline the block's size is measured against, so a control
  // that reported no prompt is a probe that did not send one.
  const controlFirst = control?.promptSeries[0] ?? 0;
  const blockTokens = (merged?.promptSeries[0] ?? 0) - controlFirst;

  if (missing || controlFirst === 0 || blockTokens <= 0) {
    return {
      state: 'inconclusive',
      blockTokens: Math.max(0, blockTokens),
      readouts,
      sentence: missing
        ? 'the probe did not read every shape it needs, so nothing here is a fact about placement'
        : `the block measured ${blockTokens} prompt tokens, which is not a block: no delta can be about it`,
    };
  }

  const dSecond = second.steadyUncached - control.steadyUncached;
  const dMerged = merged.steadyUncached - control.steadyUncached;
  const dFirst = firstTurn === undefined ? undefined : firstTurn.steadyUncached - control.steadyUncached;
  const firstClause =
    dFirst === undefined ? '' : ` The first-turn placement reads ${dFirst.toFixed(0)} against it.`;

  if (dSecond <= CACHE_TOLERANCE_TOKENS) {
    return {
      state: 'placement-is-free',
      blockTokens,
      readouts,
      sentence:
        `a second system message is re-billed ${dSecond.toFixed(0)} tokens a call over the control, ` +
        `inside the ${CACHE_TOLERANCE_TOKENS}-token tolerance, so the block is cached where it sits ` +
        `and the arm's premium is not a placement boundary.${firstClause}`,
    };
  }
  if (dMerged <= CACHE_TOLERANCE_TOKENS) {
    return {
      state: 'placement-is-the-boundary',
      blockTokens,
      readouts,
      sentence:
        `the second system message costs ${dSecond.toFixed(0)} uncached tokens a call over the ` +
        `control and the merged message costs ${dMerged.toFixed(0)}, so the message boundary is the ` +
        `thing the provider does not cache and merging removes it.${firstClause}`,
    };
  }
  return {
    state: 'block-never-cached',
    blockTokens,
    readouts,
    sentence:
      `both block-bearing system shapes pay: ${dSecond.toFixed(0)} tokens a call for the second ` +
      `message and ${dMerged.toFixed(0)} for the merged one, against a ${blockTokens}-token block. ` +
      `Placement is not the lever.${firstClause}`,
  };
}

/**
 * Deterministic filler of roughly `tokens` tokens.
 *
 * A probe needs a body of known size and no meaning. Repeating one word would tokenize differently
 * from prose and would compress to a different block count, so the filler cycles a small vocabulary
 * with an index — which is what makes two runs of the probe comparable and what makes the reported
 * block size a property of the placement rather than of the filler.
 *
 * Four characters per token, which is the ratio the pack renderer uses for its own accounting and is
 * close enough that `--block-tokens 1200` produces a block the provider reads as about that size.
 */
export function syntheticText(tokens: number, seed = 0): string {
  const vocabulary = ['order', 'item', 'refund', 'exchange', 'address', 'payment', 'gift', 'card'];
  const words: string[] = [];
  let used = 0;
  for (let index = 0; used < tokens * 4; index += 1) {
    const word = `${vocabulary[(index + seed) % vocabulary.length]}_${(index * 7 + seed) % 97}`;
    words.push(word);
    used += word.length + 1;
  }
  return words.join(' ');
}
