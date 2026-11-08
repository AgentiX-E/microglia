/**
 * The instrument-validity gates, and the contract that carries them.
 *
 * ## Why this is a package rather than a module inside one lane
 *
 * Forty gates certify every number this project publishes, and for twenty-six iterations they had
 * exactly one caller: the BIRD lane. The second scenario in the repository — τ²-bench — did not import
 * them; it wrote three of its own, one of which failed at a 15pp half-width against a 5pp bar and was
 * recorded as a note rather than as a verdict. **A protocol with one customer is a habit**, and the
 * repair is a boundary rather than more prose.
 *
 * ## What makes a gate portable
 *
 * The first answer was a question asked of the signature: *does it mention a scenario type?* Measured
 * rather than assumed — every gate was read for the `input.*` fields it touches — and it came out at
 * **29 of 31 depend on nothing scenario-specific at all**. The two that do are `V4-gold-executable`
 * and `V10-convention-executable`, and both take an *optional* field: a scenario that cannot execute
 * its own reference answer omits `goldExecRate` and the gate is then **absent**, not green.
 *
 * Stage 2 of R27 showed that answer was measured on the wrong noun. A signature being scenario-free
 * does not make a gate *evaluable*: `V45-clearance-dose-matched` names no scenario type and is
 * unreachable for a lane that ran no clearance arm. **Portability is indexical — a gate is as portable
 * as the arm behind it.** The second scenario's audit (`packages/eval/src/tau2-gates.ts`) is that
 * index. It found **9** supplyable when it was written and **13** after R29 stage 2 made the four
 * transfer gates reachable, with 2 of the 13 vacuous — which is why the count lives in that file's
 * table and in the artefact, and why no number is quoted here from memory. This paragraph said
 * "9 supplyable, 30 arm-indexed" for as long as the table had said 13 and 26, which is the drift
 * the table exists to prevent, one file over.
 *
 * The two places where a scenario had leaked into this contract are now data:
 *
 *  - the channel gate's floors were a `Record<'values' | 'linked', number>` literal inside the gate;
 *    they are now `floor` and `expects` on each entry, so the gate never learns a channel's name;
 *  - `goldExecRate` was a required field of the whole input; it is now the one field of
 *    `ScenarioGateInput`, which the scenario half supplies.
 *
 * Stage 2 removed the third: eight fields of `ProtocolGateInput` were mandatory, and two of them —
 * `meanPackIds` and the call tally — are knowable only to a lane that runs its model in-process. A
 * lane that could not state them could not call this function at all, so a scenario able to prove
 * four gates proved none. All eight are optional now, and the rule that was already true of the
 * scenario half applies to both: **a gate that cannot fire is absent, and an absent gate is a line in
 * the report rather than a silent green.**
 *
 * One flag changed with it: `V5-resolution` is blocking. All seventeen published artefacts that carry
 * it pass it, at 1.96pp to 4.87pp, so the advisory flag had never been exercised — and the first run
 * it would have protected was the one that mattered, a design whose minimum detectable difference was
 * 21.4pp against a 6pp bar.
 *
 * R52 then changed what that flag blocks on, because blocking on the wrong noun is the same defect
 * one layer down. A gate that demands the scenario resolve 6pp is red forever on a scenario whose
 * entire population cannot — 115 tasks at pass^4 reach 9.05pp — and a line that is always red teaches
 * its readers to ignore red. `V5` now blocks a run that *claims* a direction finer than its sample
 * can resolve, which is a property of the run and is answerable on every scenario; the 6pp stays as
 * `POWER_TARGET_PP`, reported in the gate's own sentence and never met by a lane that cannot meet it.
 * The distinction that makes this a restriction rather than a loosening is `claimPp`: `null` is a run
 * saying it concluded nothing, and *absence* still means "this lane does not report claims", which
 * keeps the old, stricter condition.
 *
 * ## What is not here, on purpose
 *
 * Execution, parsing and scoring. Those are `LaneAdapter` methods, because only a lane can know what
 * a correct answer is. A protocol that scored would have to learn about SQL execution or tool-call
 * matching, and would then be a second copy of the lane it was extracted from.
 */

export type FramingDelivery = {
  readonly arm: string;
  /** Prompts this arm put to the model, one per question per fold it was scored in. */
  readonly prompts: number;
  /** How many of those carried the framing the arm declares. */
  readonly carrying: number;
  /** Whether the arm declares a framing at all: `false` means it must carry none. */
  readonly expected: boolean;
};

/**
 * How much of one arm's prompts carried the question's own evidence sentence.
 *
 * Deliberately the same shape as `FramingDelivery`, counting a block in the opposite direction. A
 * framing arm adds a sentence and the instrument asks whether it arrived; an evidence arm *removes* a
 * block the dataset supplies, and the instrument asks two questions at once — that the shipped arms
 * still show it on every question that has one, and that the ablated arms show it on none. A separate
 * type rather than a shared one because the two exist for different failures, and this record names
 * its instruments after what they catch.
 *
 * `expected` here means "this arm is meant to carry the evidence block", which is every arm except the
 * two that ablate it.
 */
export type EvidenceDelivery = FramingDelivery;

export type ValidityGate = {
  readonly id: string;
  readonly criterion: string;
  readonly actual: string;
  readonly pass: boolean;
  readonly blocking: boolean;
};

/**
 * Paired source questions below this count make a difference a direction rather than a measurement.
 *
 * The floor the transfer statistic uses: an exact test over a handful of discordant pairs cannot
 * reject anything, and a report that called its sign a finding would be reporting the sign of noise.
 */
export const SUBSTRATE_FLOOR = 100;

/** The published precision of a net transfer rate: two decimals, so a gate may not demand more. */
const NET_PUBLISHED_STEP = 0.01;

export function transferGates(
  input: TransferGateInput,
  ids: {
    readonly reconcile: string;
    readonly resolvable: string;
    readonly ledger: string;
    readonly net: string;
  },
): readonly ValidityGate[] {
  const { trials, informative, repaired, blankRight, unmeasured, measured, broke, netPp, verdict } =
    input;
  const blankHoles = input.unmeasuredBlank ?? 0;
  const out: ValidityGate[] = [
    {
      id: ids.reconcile,
      criterion: 'every transfer trial is measured, informative, or a target that needed nothing',
      // The control-side holes are named separately because they are the ones that would have
      // flattered the rate if they had been folded into "the retry failed".
      actual:
        `${unmeasured + blankRight + informative}/${trials} trial(s): ${informative} informative, ` +
        `${blankRight} already repaired by the retry, ${unmeasured} unmeasured ` +
        `(${blankHoles} with no control call)`,
      pass: unmeasured + blankRight + informative === trials,
      blocking: true,
    },
    {
      id: ids.resolvable,
      criterion: 'at least 100 informative trials, or the transfer rate is a direction rather than a rate',
      actual: `${informative} informative trial(s), ${repaired} repair(s)`,
      pass: informative >= 100,
      blocking: false,
    },
    // The aggregate answers how often and the ledger answers where. The first version of the ledger
    // was written into the fold record, which the artefact never serialises, so a run published a
    // rate with no pairs behind it and nothing failed. A field nobody checks is a field that can be
    // absent: this gate makes "the ledger reached the file" a condition of the run being readable.
    {
      id: ids.ledger,
      criterion: 'the artefact carries one row per trial, so the pairs behind the rate survive the run',
      actual: `${input.ledger ?? 0}/${trials} pair(s) carried`,
      pass: (input.ledger ?? 0) === trials,
      blocking: true,
    },
    // The conditional rate cannot go down: its denominator excludes, by construction, every trial
    // where the rule could do damage. A summary that reports it without the break side is a
    // summary that can only look like progress, so the net marginal effect is a gate rather than a
    // column somebody may or may not read.
    //
    // The tolerance is half of the last published digit rather than machine epsilon. The artefact
    // publishes this ratio at two decimals for a reader; a gate that then demanded 1e-9 of it failed
    // every run whose ratio does not terminate at two decimals (`(29 - 27) / 483 = 0.4141...` is
    // published as `0.41`), which is most of them. The check keeps its teeth: a fabricated value is
    // wrong by more than a rounding step, and one that agrees with its own counts is wrong by none.
    {
      id: ids.net,
      criterion:
        'the transfer summary states its net marginal effect, and the repair and break counts reconcile with it',
      actual:
        `${netPp.toFixed(2)}pp net over ${measured} measured trial(s): ` +
        `${repaired} repaired, ${broke} broken, verdict \`${verdict}\``,
      pass:
        measured > 0 &&
        Math.abs(netPp - ((repaired - broke) / measured) * 100) <= NET_PUBLISHED_STEP / 2,
      blocking: true,
    },
  ];
  return out;
}

/** One substrate's transfer bookkeeping, as the gates read it. */
export type TransferGateInput = {
  readonly trials: number;
  readonly informative: number;
  readonly repaired: number;
  readonly blankRight: number;
  readonly unmeasured: number;
  /** Trials whose control call is the missing half; a subset of `unmeasured`. */
  readonly unmeasuredBlank?: number;
  /** Rows the artefact carries for the pairs themselves, which must be one per trial. */
  readonly ledger?: number;
  readonly measured: number;
  readonly broke: number;
  readonly netPp: number;
  readonly verdict: string;
};

/**
 * The order a gate list is published in.
 *
 * Explicit data rather than the order the code happens to push objects in, because two things depend on
 * it and neither is visible from the code: a committed artefact's `gates[].id` sequence is compared
 * against its own pre-registration, and `eval:protocol` re-renders every report and compares it byte for
 * byte. A push order that drifts one line is a diff in thirty-one published files.
 *
 * The list reproduces the sequence the single-lane implementation emitted, so extracting this package
 * changed no artefact. It has **40 entries** rather than 31: the eight transfer ids (`V15`–`V17`, `V33`,
 * `V39`–`V42`) are passed *into* `transferGates` as arguments rather than written beside an object
 * literal, so a scan for `id:` misses them — and a list missing them would sort eight published gates
 * to the end of the report. The fortieth, `V0-instrument-ready`, was added in R55's audit: the eight
 * gates below `V1` all grade a number, and none of them asks whether the pipeline that produced the
 * number carried anything at any stage.
 */
export const GATE_ORDER: readonly string[] = [
  'V0-instrument-ready',
  'V1-pack-not-empty',
  'V2-fold-partition',
  'V3-parse-rate',
  'V4-gold-executable',
  'V5-resolution',
  'V6-controls-inject',
  'V7-channel',
  'V8-call-reliability',
  'V32-fold-learning-intact',
  'V12-shape-present',
  'V9-subset-size',
  'V11-channel-ceiling',
  'V13-probe-reconciles',
  'V14-probe-applied',
  'V37-repair-probe-reconciles',
  'V38-repair-probe-applied',
  'V15-transfer-reconciles',
  'V16-transfer-resolvable',
  'V33-transfer-ledger',
  'V17-transfer-net-reported',
  'V39-repair-transfer-reconciles',
  'V40-repair-transfer-resolvable',
  'V41-repair-transfer-ledger',
  'V42-repair-transfer-net-reported',
  'V34-substrate-paired',
  'V35-substrate-resolvable',
  'V36-substrate-coverage',
  'V18-pool-complete',
  'V19-pool-reconciles',
  'V10-convention-executable',
  'V43-framing-delivered',
  'V48-statements-answered',
  'V44-domain-accounted',
  'V45-clearance-dose-matched',
  'V46-raw-is-verbatim',
  'V47-evidence-ablated',
  'V49-dose-truncated',
  'V50-admission-engaged',
  'V51-channel-applied',
];

const RANK: ReadonlyMap<string, number> = new Map(GATE_ORDER.map((id, index) => [id, index]));

/**
 * Sort a gate list into publication order.
 *
 * A gate whose id is not in `GATE_ORDER` sorts last rather than throwing: a scenario is allowed to
 * contribute a gate this package has never heard of, and refusing to publish it would make the
 * extension point useless at the exact moment somebody used it.
 */
export function inGateOrder(gates: readonly ValidityGate[]): ValidityGate[] {
  const fallback = GATE_ORDER.length;
  return [...gates].sort((a, b) => (RANK.get(a.id) ?? fallback) - (RANK.get(b.id) ?? fallback));
}

export type ProtocolGateInput = {
  /**
   * Mean rules injected per question on the memory arm.
   *
   * Optional, and the four below it are optional for a reason the second scenario supplied: the
   * first version of this type made eight facts mandatory, and two of them — this one and the call
   * tally — are knowable only to a lane that runs its model in-process. A lane whose agent is
   * another program could therefore not call this function **at all**, not even to evaluate the
   * thirty-one gates whose own fields were missing. The type was all-or-nothing, so a scenario that
   * could prove four gates proved none. Making a requirement optional adds an absence to the
   * report; leaving it mandatory added a refusal to the lane.
   */
  readonly meanPackIds?: number;
  /**
   * The population behind `meanPackIds`: what the store held, and what the facade was asked for.
   *
   * `0.00 rules/question` is the same number for three different defects — the agent never asked, the
   * store held nothing active, or the items were stored under a key the recall path does not ask in —
   * and a gate whose sentence cannot separate them sends its reader to the wrong layer. Supplied
   * beside the rate rather than as its own gate, because it grades nothing: it explains.
   */
  readonly packPopulation?: {
    readonly stored: number;
    readonly active: number;
    readonly servable: number;
    readonly requests: number;
    readonly served: number;
  };
  /**
   * The fold accounting: evaluated, total, duplicated, leaked.
   *
   * Absent when the lane cannot show its split. A gate that guessed zero leaks would certify the
   * one property the whole design rests on from a lane that never recorded it.
   */
  readonly partition?: {
    readonly evaluated: number;
    readonly total: number;
    readonly duplicated: number;
    readonly leaked: number;
  };
  readonly parseRate?: number;
  /** Smallest effect the sample could resolve at 80% power, in percentage points. */
  readonly detectablePp?: number;
  /**
   * The delta this run publishes as a direction, when it publishes one.
   *
   * Three states, and the difference between the last two is the whole point of the field:
   *
   *  - a **number** — the run concluded in this direction, at this size;
   *  - **`null`** — the run measured and concluded nothing, which it says so that `V5` can read
   *    "no direction claimed" as a *statement* rather than as a silence;
   *  - **absent** — the lane does not report directional claims at all, and `V5` falls back to the
   *    6pp bar exactly as it did before this field existed.
   *
   * A lane that never reports claims therefore keeps the old, stricter condition. Reading absence as
   * "claimed nothing" would let any run pass by not mentioning the question, which is the vacuous
   * pass this project has spent two iterations removing.
   */
  readonly claimPp?: number | null;
  readonly packControls: readonly { readonly arm: string; readonly meanPackIds: number }[];
  /**
   * What each arm's prompts carried, when the run turns framing into a variable.
   *
   * Absent when no arm declares a standing, because a gate that always passes is a comment.
   */
  readonly framing?: readonly FramingDelivery[];
  /**
   * Per arm, how much of what it sent carried the question's evidence sentence.
   *
   * Absent unless the run ablates it, because a gate that always passes is a comment.
   */
  readonly evidence?: readonly EvidenceDelivery[];
  /**
   * The provenance of the store's domain-free items, when the run reports its shape.
   *
   * `scope.domain` is the one scope field the host knows and the model only echoes, and an item
   * without one can never be pointed at a foreign question — so this count is the ceiling on every
   * transfer number the store can produce. Two paths produce one, and they call for opposite fixes:
   * the interpreter declined to scope the claim, or generalisation widened the domain away.
   */
  readonly domainOrigin?: {
    readonly storedWithDomain: number;
    readonly storedWithoutDomain: number;
    readonly unscopedIn: number;
    readonly widenedIn: number;
  };
  /**
   * What the statement executor had to do to keep the lane alive.
   *
   * The driver is synchronous, so a query the model wrote can stop the whole run inside a native
   * call. Every statement therefore runs in a process that can be killed, and this is the record of
   * how often that was necessary: a statement killed by the deadline is not a wrong answer, and a
   * run whose statements were mostly killed is describing its own timeout rather than the model.
   */
  readonly statements?: {
    readonly statements: number;
    readonly deadlines: number;
    readonly truncations: number;
  };
  /**
   * What a one-slot arm carried, when the run truncates every pack.
   *
   * Absent when no such arm ran. Present, it is the arm's validity condition: a truncation that
   * did not truncate is a second name for `full`, and the two would report a difference of zero
   * as if something had been measured.
   */
  readonly dose?: {
    readonly arm: string;
    /** Prompts this arm built, which should equal the questions it was supposed to ask. */
    readonly prompts: number;
    /** Of those, the ones that still carried more than one item. */
    readonly overBudget: number;
    /** Questions whose truncated pack was a different pack from `full`'s. */
    readonly differsFromFull: number;
    readonly questions: number;
  };
  /**
   * What a per-question admission arm admitted, when one ran.
   *
   * Absent when none did. Present, it is the difference between "admission did not help" and
   * "admission never fired": an arm whose fitted floor keeps the whole population is its own
   * control, and this record has published a null under the wrong name once already.
   */
  readonly admission?: {
    readonly arm: string;
    readonly control: string;
    readonly folds: readonly {
      readonly fold: number;
      readonly floor: number;
      readonly kept: number;
      readonly total: number;
      readonly helped: number;
      readonly harmed: number;
      readonly reason: string;
    }[];
    /** Questions this arm showed a note to. */
    readonly admitted: number;
    /** Questions it was asked, which is the denominator the share is read against. */
    readonly questions: number;
  };
  readonly channelBest: { readonly arm: string; readonly deltaPp: number } | undefined;
  /**
   * How often each channel arm actually rewrote the prompt, when one ran.
   *
   * Absent when no channel arm did. Present, it is the arm's validity condition: a value annotator
   * that annotated no column and a pruner that pruned no table are both the control under another
   * name, and the difference either reports is a difference of nothing. The two kinds need
   * different floors — annotation is unconditional and pruning is not — so the kind travels with
   * the count instead of being guessed from the arm's name.
   */
  readonly channels?: readonly {
    readonly arm: string;
    /** What kind of manipulation this channel performs, in the lane's own vocabulary. */
    readonly kind: string;
    readonly applied: number;
    readonly asked: number;
    /**
     * The share this kind must reach for its null to be a null about the channel.
     *
     * Carried with the entry rather than chosen by the gate: an annotation that is unconditional
     * and a pruner that binds only sometimes need different floors, and which is which is a fact
     * about the lane, not about the instrument.
     */
    readonly floor: number;
    /** How this entry reads inside the gate's own sentence, e.g. `values at least 95% of prompts`. */
    readonly expects: string;
  }[];
  /**
   * How the clearance arm and its dose-matched control compared, when the run builds one.
   *
   * Absent when no clearance arm ran, because a gate that always passes is a comment. Present, it
   * is the only thing standing between the pair and the inference this record has already had to
   * withdraw once: a filtered pack is a *smaller* pack, and size alone moves accuracy here.
   */
  readonly clearance?: {
    readonly arm: string;
    readonly control: string;
    readonly questions: number;
    /** Questions where the two arms carried a different number of items. */
    readonly mismatched: number;
    /** Questions where they carried the same items, so the comparison has no content there. */
    readonly identical: number;
    /** Items the clearance removed, summed over questions. */
    readonly dropped: number;
    readonly meanCleared: number;
    readonly meanControl: number;
  };
  /**
   * What a raw arm's packs actually contained, when one ran.
   *
   * Absent when no arm injects verbatim text. Present, it is the arm's whole claim: the payload lines
   * were not rewritten, reformatted or truncated on the way into the prompt.
   */
  readonly raw?: {
    readonly arm: string;
    /** Blocks of rendered event across every prompt the arm sent. */
    readonly cells: number;
    /** Of those, the ones byte-identical to the event they were rendered from. */
    readonly verbatim: number;
    /** Events that did not fit the budget whole, so the reader knows what was left out. */
    readonly skipped: number;
    /**
     * The first block that was not byte-identical, cut to a readable length.
     *
     * Carried because a count is a verdict and a sample is a diagnosis: the gate's own first version
     * reported `1103/1632` and could not say which of the three fields was being rewritten, so the
     * failure cost a dispatch to explain. Never interpreted by the gate — printed beside the count.
     */
    readonly sample?: string;
  };
  /**
   * Share of calls that failed after exhausting retries, in [0, 1], and the tally behind it.
   *
   * Optional together, because a rate and its counts are the same fact twice: a lane that knows one
   * and not the other cannot be graded on reliability, and a default of zero would report perfect
   * reliability for a lane that never looked.
   */
  readonly callFailureRate?: number;
  readonly calls?: number;
  readonly callFailures?: number;
  /**
   * The learning half's bookkeeping.
   *
   * A fold's treatment is a store distilled from its corrections, so a correction that never
   * arrived is not a missing data point — it is a smaller store, and a store built from sixty of
   * sixty-four questions is a different treatment from the one the arm was defined as. Before this
   * existed the two were indistinguishable in the artefact: a generation that failed was cached as
   * an empty string, and the distiller counted a failed reply as "the model said nothing".
   */
  readonly learning?: {
    readonly rows: number;
    readonly unanswered: number;
    readonly edited: number;
    readonly distillFailed: number;
  };
  /**
   * Present only when the run teaches a house convention.
   *
   * The S2b protocol fixes a floor before the result is read: below a hundred
   * qualifying questions the run is a direction, not a verdict, and the verdict
   * gate is not applied. Making the floor a gate that is *recorded* rather than a
   * silent `if` is what stops "we ran it anyway" from becoming "we found".
   */
  readonly subset?: { readonly qualifying: number; readonly minimum: number };
  /**
   * How many injected rules carried an applicability condition.
   *
   * The shape experiment's validity condition. `full` and `full-plain` differ only
   * in that field, so a run in which the distiller produced no condition has two
   * identical arms and a delta of zero that means nothing. Recording it as a gate
   * makes "the model declined to say when" visible instead of indistinguishable
   * from "the condition does not help".
   */
  readonly packConditions?: { readonly injected: number; readonly withCondition: number };
  /**
   * Absolute accuracy of the strongest channel control, when the protocol names a
   * ceiling for it.
   *
   * The S2b protocol requires the oracle arm to reach 90%: an oracle that cannot
   * make the model produce the accepted answer at all means the lane is measuring
   * the model's output format, not its use of knowledge. V7 asks whether the
   * channel *responds*; this asks whether it is *usable*, and both have to hold.
   */
  readonly channelCeiling?: number;
  /**
   * What the reproducibility gate did, when its arm ran.
   *
   * `kept` plus the three drop buckets has to equal `rules`: a gate that loses rules between
   * counting and filtering has a defect in its bookkeeping, and a defect there would make every
   * `full-verified` number a measurement of the bug rather than of the store. `packDiffers` is
   * the arm's own validity condition — a gate that kept everything it saw is `full` under a
   * second name, which is the failure mode every earlier control in this lane exists to catch.
   */
  readonly probe?: {
    readonly rules: number;
    readonly kept: number;
    readonly noVerifiedSource: number;
    readonly brokeItsSource: number;
    readonly unsupported: number;
    readonly packDiffers: number;
    readonly questions: number;
  };
  /**
   * The same bookkeeping for the second substrate, when a run built both stores.
   *
   * The admission buckets have to partition the repair store for the same reason they have to
   * partition the rule store: a gate that miscounts turns an arm into a number nobody can check.
   */
  readonly probeRepair?: {
    readonly rules: number;
    readonly kept: number;
    readonly noVerifiedSource: number;
    readonly brokeItsSource: number;
    readonly unsupported: number;
    readonly packDiffers: number;
    readonly questions: number;
  };
  /**
   * What the transfer measurement found, when it ran.
   *
   * The three buckets have to reconcile to the trials for the same reason the admission buckets
   * do, and `informative` has to be large enough for the rate to mean anything: a rate computed on
   * forty informative trials cannot separate 2% from 8%, and publishing it beside one computed on
   * four hundred would give two numbers the same standing.
   */
  readonly transfer?: TransferGateInput;
  /**
   * The same measurement over the second substrate, when a run asked for it.
   *
   * Checked by the same four gates with different ids rather than by a lighter version: a repair
   * that transfers is a claim about the product, and a claim about the product is held to the same
   * reconciliation its predecessor was.
   */
  readonly transferRepair?: TransferGateInput;
  /**
   * The two-substrate comparison, when a run built both stores.
   *
   * A paired reading is only a paired reading if the cells reconcile: every shared question is either
   * a cell or a hole, and the shared set plus the two exclusive sets is the union. An artefact that
   * published `both` and `onlyRight` without those identities would report a comparison over a
   * denominator nobody can reconstruct.
   */
  readonly substrate?: {
    readonly left: string;
    readonly right: string;
    readonly shared: number;
    readonly leftExclusive: number;
    readonly rightExclusive: number;
    readonly holes: number;
    readonly both: number;
    readonly onlyLeft: number;
    readonly onlyRight: number;
    readonly neither: number;
    readonly paired: number;
    readonly leftRate: number;
    readonly rightRate: number;
    readonly deltaPp: number;
    readonly p: number;
    readonly verdict: string;
  };
  /** The candidate pool, when a sampling arm recorded one. */
  readonly pool?: {
    readonly questions: number;
    readonly expected: number;
    readonly candidates: number;
    readonly signed: number;
    readonly unsigned: number;
    /** Every question's distinct-result count was at least one, or the recording dropped a case. */
    readonly consistent: boolean;
  };
  /**
   * How much of the pipeline from a correction to a servable rule carried anything, when the lane
   * counted it.
   *
   * Every gate in this file grades a number. None of them asks whether the machine that produced the
   * number was running: `V1` passes on a pack of one rule and `V32` passes on a store whose every
   * item was quarantined. Three published rounds were read as "the mechanism does not work" when the
   * stage that had failed was the distiller's parse, and one was read as "the store is thin" when
   * the write path had refused every candidate. The funnel is that missing question, stated as five
   * counts whose only purpose is to locate a zero.
   */
  readonly funnel?: FunnelInput;
};

/**
 * The five stages a rule passes through, and the two refusal counts that explain a narrowing.
 *
 * The names are the pipeline's, in order: the learning half could teach from `corrections` events,
 * the interpreter proposed `candidates`, the store `admitted` some of them, it `stored` that many
 * items, and `servable` of those are reachable by the recall the arm actually asks in. A stage that
 * is zero is a different defect from a stage that is small, and only the sequence distinguishes them.
 */
export type FunnelInput = {
  /** Learnable corrections the learning half produced. */
  readonly corrections: number;
  /** Candidate claims the interpreter proposed over them. */
  readonly candidates: number;
  /** Candidates that became an item or merged into one: created plus merged. */
  readonly admitted: number;
  /** Items the store holds. */
  readonly stored: number;
  /** Items the recall scope can reach. */
  readonly servable: number;
  /** Candidates a host-side rule refused. */
  readonly refused?: number;
  /** Events the interpreter failed on. */
  readonly failed?: number;
};


export type ScenarioGateInput = {
  /**
   * Share of gold answers that execute, when the scenario can execute them.
   *
   * Absent in a scenario whose correctness cannot be established by running the reference answer —
   * a judged reply, a tool-call match — and the gate that reads it is then absent rather than
   * passing, because a gate that always passes is a comment.
   */
  readonly goldExecRate?: number;
  /**
   * Share of qualifying questions whose reference answer, rewritten to report the way the workspace
   * reports, produces the expected value.
   *
   * Absent unless the lane teaches a house convention. This is that lane's counterpart to
   * `goldExecRate`: without it, a scoring bug and a model that cannot follow the convention look
   * identical, and both look like "the mechanism does not work".
   */
  readonly conventionExecRate?: number;
};

/**
 * The effect size this instrument is built to certify: six percentage points at 80% power.
 *
 * R52 made it a *target* rather than a pass condition. The constant did not move and cannot be moved
 * by a caller — a bar a caller can type is a bar that will be typed to pass — but meeting it is no
 * longer what a run has to do to publish. What a run has to do is not claim more than it can resolve,
 * and the target is the number it is measured against in the sentence `V5` prints.
 */
export const POWER_TARGET_PP = 6;

/**
 * `V1`'s sentence, with the population behind the rate when the lane recorded one.
 *
 * The three zeros are distinct facts and the sentence is the only place they can be told apart:
 *
 *   - no request at all — the treatment was never delivered, and no amount of distillation fixes it;
 *   - requests, nothing servable — the store's items are stored under a key this recall does not ask
 *     in (`scope.domain`), which is a write-side defect wearing a read-side symptom;
 *   - requests, items servable, nothing served — the facade is dropping what the store offered.
 */
function packReading(
  mean: number,
  population: ProtocolGateInput['packPopulation'],
): string {
  const rate = `${mean.toFixed(2)} rules/question`;
  if (population === undefined) return rate;
  if (population.requests === 0) {
    return (
      `${rate}: the store held ${String(population.stored)} item(s), ` +
      `${String(population.active)} of them active, and the agent made no recall request`
    );
  }
  return (
    `${rate}: ${String(population.served)} of ${String(population.requests)} request(s) carried an item, ` +
    `from a store of ${String(population.stored)} (${String(population.active)} active, ` +
    `${String(population.servable)} in scope)`
  );
}

/**
 * Where the funnel stopped, as a value.
 *
 * One predicate with three callers — the gate, the driver's early stop, and the readback — because
 * three predicates that each decide for themselves is the defect this family of instruments exists
 * to remove. `ready` is the publication condition; `reason` names the stage, so a caller that stops
 * a run can say which one broke rather than that something did.
 */
export type FunnelVerdict = {
  readonly ready: boolean;
  readonly reason: string;
};

export function funnelVerdict(funnel: FunnelInput): FunnelVerdict {
  const reconciled =
    funnel.admitted <= funnel.candidates &&
    funnel.stored <= funnel.admitted &&
    funnel.servable <= funnel.stored;
  if (!reconciled) {
    return {
      ready: false,
      reason:
        'a stage is larger than the one before it, so a count was taken over a different ' +
        'population than the one it is used to explain',
    };
  }
  const empty = emptyStage(funnel);
  return empty === undefined ? { ready: true, reason: 'every stage carried something' } : { ready: false, reason: empty };
}

/**
 * `V0`'s sentence: the chain as it ran, and the stage that broke when one did.
 *
 * A funnel is read to answer one question — *where did it stop* — and a sentence that reported only
 * the first and last numbers would move that question back to the reader.
 */
export function funnelReading(funnel: FunnelInput, verdict: FunnelVerdict): string {
  const refusals = [
    funnel.refused === undefined ? undefined : `${String(funnel.refused)} refused`,
    funnel.failed === undefined ? undefined : `${String(funnel.failed)} failed`,
  ].filter((entry): entry is string => entry !== undefined);
  const chain =
    `${String(funnel.corrections)} correction(s) -> ${String(funnel.candidates)} candidate(s) -> ` +
    `${String(funnel.admitted)} admitted -> ${String(funnel.stored)} stored -> ` +
    `${String(funnel.servable)} servable`;
  const tail = refusals.length === 0 ? '' : ` (${refusals.join(', ')})`;
  return verdict.ready ? `${chain}${tail}` : `${chain}${tail}: ${verdict.reason}`;
}

function emptyStage(funnel: FunnelInput): string | undefined {
  if (funnel.corrections === 0) {
    return 'the learning half produced no correctable episode, so no stage after it could carry anything';
  }
  if (funnel.candidates === 0) return 'the interpreter proposed no candidate over any correction';
  if (funnel.admitted === 0) return 'every candidate was refused: the write path admitted nothing it was offered';
  if (funnel.stored === 0) return 'the store holds no item, which contradicts an admission above';
  if (funnel.servable === 0) {
    return 'the store holds items and none is reachable by the recall scope this arm asks in';
  }
  return undefined;
}

export function buildProtocolGates(
  input: ProtocolGateInput & ScenarioGateInput,
): ValidityGate[] {
  const gates: ValidityGate[] = [];
  if (input.funnel !== undefined) {
    const funnel = input.funnel;
    const verdict = funnelVerdict(funnel);
    gates.push({
      id: 'V0-instrument-ready',
      criterion: 'every stage from a correction to a servable rule carried something, and the stages reconcile',
      actual: funnelReading(funnel, verdict),
      pass: verdict.ready,
      blocking: true,
    });
  }
  if (input.meanPackIds !== undefined) {
    gates.push({
      id: 'V1-pack-not-empty',
      criterion: 'the memory arm injected at least one rule per question on average',
      actual: packReading(input.meanPackIds, input.packPopulation),
      pass: input.meanPackIds > 0,
      blocking: true,
    });
  }
  if (input.partition !== undefined) {
    gates.push({
      id: 'V2-fold-partition',
      criterion: 'every question is evaluated exactly once, by a memory that never learned from it',
      actual:
        `${input.partition.evaluated}/${input.partition.total} questions, ` +
        `${input.partition.duplicated} duplicates, ${input.partition.leaked} leaks`,
      pass:
        input.partition.duplicated === 0 &&
        input.partition.leaked === 0 &&
        input.partition.evaluated === input.partition.total,
      blocking: true,
    });
  }
  if (input.parseRate !== undefined) {
    gates.push({
      id: 'V3-parse-rate',
      criterion: 'at least 90% of replies contain a statement',
      actual: `${(input.parseRate * 100).toFixed(2)}%`,
      pass: input.parseRate >= 0.9,
      blocking: true,
    });
  }
  if (input.detectablePp !== undefined) {
    const resolution = input.detectablePp;
    // `Infinity` is what a comparison with no discordant pairs produces, and it is not a large
    // resolution — it is the absence of one. Printing "Infinitypp" reads like a bug in the
    // arithmetic; saying what it means is the same failure with an explanation attached.
    const estimable = Number.isFinite(resolution);
    const withinTarget = estimable && resolution <= POWER_TARGET_PP;
    const claim = input.claimPp;
    // A claim is publishable only if the sample could have resolved it. `Math.abs` because the
    // symmetry is the point: a 4pp loss at a 13.73pp resolution is as unclaimable as a 4pp gain,
    // and the revert rule that *does* fire on a loss is a safety rule, not a resolution claim.
    const claimResolved = typeof claim === 'number' && estimable && Math.abs(claim) >= resolution;
    const target = `${POWER_TARGET_PP.toFixed(2)}pp target`;
    const actual = !estimable
      ? 'not estimable: no question changed hands'
      : claim === null
        ? `minimum detectable ${resolution.toFixed(2)}pp against a ${target}; the run claims no direction`
        : typeof claim === 'number'
          ? `minimum detectable ${resolution.toFixed(2)}pp against a ${target}; claims ${claim.toFixed(2)}pp` +
            (claimResolved ? '' : ', which is finer than the sample can resolve')
          : `minimum detectable ${resolution.toFixed(2)}pp against a ${target}; this lane reports no claims`;
    gates.push({
      id: 'V5-resolution',
      criterion:
        'the run claims no effect finer than its sample can resolve: a resolvable 6pp, or no direction claimed',
      actual,
      // R52: the gate grades the *claim*, not the sample. `detectablePp <= 6` was unreachable for a
      // scenario whose entire population cannot resolve 6pp at pass^4, so it was red on every τ²
      // dispatch for a reason no mechanism could fix — the same pathology R50 removed from the
      // finding gate. What remains blocking is the thing that is actually a defect in a run: a
      // published direction the sample could not have seen, which is what the gate was written for.
      pass: estimable && (withinTarget || claim === null || claimResolved),
      // Blocking, and for the reason it always was: a run that publishes a direction its sample
      // cannot resolve misrepresents the instrument. What changed is that the condition is now
      // about the run rather than about the scenario.
      blocking: true,
    });
  }
  gates.push({
    id: 'V6-controls-inject',
    criterion: 'every pack-based control arm injected at least one rule on average',
    actual:
      input.packControls
        .map((entry) => `${entry.arm}: ${entry.meanPackIds.toFixed(2)} rules/question`)
        .join(', ') || 'no pack-based controls configured',
    pass: input.packControls.every((entry) => entry.meanPackIds > 0),
    blocking: true,
  });
  gates.push({
    id: 'V7-channel',
    criterion: 'a stated control moves accuracy by at least 10pp',
    actual:
      input.channelBest === undefined
        ? 'no channel control was run'
        : `${input.channelBest.deltaPp.toFixed(2)}pp with the ${input.channelBest.arm} control`,
    pass: input.channelBest === undefined ? true : input.channelBest.deltaPp >= 10,
    blocking: true,
  });
  if (input.callFailureRate !== undefined) {
    const tally =
      input.calls === undefined || input.callFailures === undefined
        ? ''
        : ` (${input.callFailures}/${input.calls} calls)`;
    gates.push({
      id: 'V8-call-reliability',
      criterion: 'at most 2% of calls failed after retries, so the outcome is about knowledge',
      actual: `${(input.callFailureRate * 100).toFixed(2)}%${tally}`,
      pass: input.callFailureRate <= 0.02,
      blocking: true,
    });
  }
  if (input.learning !== undefined) {
    const { rows, unanswered, edited, distillFailed } = input.learning;
    const unansweredShare = rows === 0 ? 0 : unanswered / rows;
    const distillShare = rows === 0 ? 0 : distillFailed / rows;
    gates.push({
      id: 'V32-fold-learning-intact',
      criterion:
        'at most 10% of the learning questions went unanswered and at most 10% of the corrections ' +
        'failed to distil, so the store is the one the fold paid for',
      actual:
        `${unanswered}/${rows} unanswered question(s) (${(unansweredShare * 100).toFixed(1)}%), ` +
        `${edited} correction(s), ${distillFailed} distillation failure(s) ` +
        `(${(distillShare * 100).toFixed(1)}%)`,
      pass: unansweredShare <= 0.1 && distillShare <= 0.1,
      blocking: true,
    });
  }
  if (input.packConditions !== undefined) {
    const { injected, withCondition } = input.packConditions;
    const share = injected === 0 ? 0 : withCondition / injected;
    gates.push({
      id: 'V12-shape-present',
      criterion: 'at least 50% of injected rules state when they apply, or the two shapes are the same pack',
      actual: `${withCondition}/${injected} injected rule(s) carried a condition (${(share * 100).toFixed(1)}%)`,
      pass: share >= 0.5,
      blocking: false,
    });
  }
  if (input.subset !== undefined) {
    gates.push({
      id: 'V9-subset-size',
      criterion: `at least ${input.subset.minimum} qualifying questions, or the result is a direction rather than a verdict`,
      actual: `${input.subset.qualifying} qualifying question(s)`,
      pass: input.subset.qualifying >= input.subset.minimum,
      blocking: false,
    });
  }
  if (input.channelCeiling !== undefined) {
    gates.push({
      id: 'V11-channel-ceiling',
      criterion: 'the strongest channel control reaches 90% accuracy, or the lane cannot express its answer',
      actual: `${(input.channelCeiling * 100).toFixed(2)}%`,
      pass: input.channelCeiling >= 0.9,
      blocking: true,
    });
  }
  if (input.probe !== undefined) {
    const { rules, kept, noVerifiedSource, brokeItsSource, unsupported, packDiffers, questions } = input.probe;
    const counted = kept + noVerifiedSource + brokeItsSource + unsupported;
    gates.push({
      id: 'V13-probe-reconciles',
      criterion: 'the reproducibility gate accounts for every rule it was given',
      actual: `${counted}/${rules} rule(s): ${kept} kept, ${unsupported} unsupported, ${brokeItsSource} broke its source, ${noVerifiedSource} unprobed`,
      pass: counted === rules,
      blocking: true,
    });
    gates.push({
      id: 'V14-probe-applied',
      criterion: 'the gate changed at least one held-out pack, or the arm is `full` under a second name',
      actual: `${packDiffers}/${questions} question(s)`,
      pass: packDiffers > 0,
      blocking: false,
    });
  }
  if (input.probeRepair !== undefined) {
    const { rules, kept, noVerifiedSource, brokeItsSource, unsupported, packDiffers, questions } =
      input.probeRepair;
    const counted = kept + noVerifiedSource + brokeItsSource + unsupported;
    gates.push({
      id: 'V37-repair-probe-reconciles',
      criterion: 'the second substrate accounts for every rule its gate was given',
      actual: `${counted}/${rules} rule(s): ${kept} kept, ${unsupported} unsupported, ${brokeItsSource} broke its source, ${noVerifiedSource} unprobed`,
      pass: counted === rules,
      blocking: true,
    });
    gates.push({
      id: 'V38-repair-probe-applied',
      criterion: "the second substrate's gate changed at least one held-out pack",
      actual: `${packDiffers}/${questions} question(s)`,
      pass: packDiffers > 0,
      blocking: false,
    });
  }
  if (input.transfer !== undefined) {
    gates.push(
      ...transferGates(input.transfer, {
        reconcile: 'V15-transfer-reconciles',
        resolvable: 'V16-transfer-resolvable',
        ledger: 'V33-transfer-ledger',
        net: 'V17-transfer-net-reported',
      }),
    );
  }
  // The same four checks over the second substrate. R14 established that a store which
  // reproduces twice as much can still be inert; this is the measurement that says whether it
  // also travels, and it is held to the same reconciliation rather than to a lighter one.
  if (input.transferRepair !== undefined) {
    gates.push(
      ...transferGates(input.transferRepair, {
        reconcile: 'V39-repair-transfer-reconciles',
        resolvable: 'V40-repair-transfer-resolvable',
        ledger: 'V41-repair-transfer-ledger',
        net: 'V42-repair-transfer-net-reported',
      }),
    );
  }
  if (input.substrate !== undefined) {
    const s = input.substrate;
    const cells = s.both + s.onlyLeft + s.onlyRight + s.neither;
    const union = s.shared + s.leftExclusive + s.rightExclusive;
    gates.push({
      id: 'V34-substrate-paired',
      criterion:
        'every shared question is a cell or a hole, and both rates and the delta reconcile with the cells',
      actual:
        `${cells} cell(s) + ${s.holes} hole(s) = ${s.shared} shared of ${union} question(s); ` +
        `${s.left} ${(s.leftRate * 100).toFixed(2)}%, ${s.right} ${(s.rightRate * 100).toFixed(2)}%`,
      pass:
        cells + s.holes === s.shared &&
        cells === s.paired &&
        // The rates are computed from the cells, so a report that carried one without the other is
        // caught here rather than by a reader who happens to divide.
        Math.abs(s.leftRate * s.paired - (s.both + s.onlyLeft)) < 1e-9 &&
        Math.abs(s.rightRate * s.paired - (s.both + s.onlyRight)) < 1e-9 &&
        Math.abs(s.deltaPp - (s.rightRate - s.leftRate) * 100) < 1e-9,
      blocking: true,
    });
    gates.push({
      id: 'V35-substrate-resolvable',
      criterion: `at least ${String(SUBSTRATE_FLOOR)} paired questions, or the difference is a direction rather than a measurement`,
      actual: `${s.paired} paired question(s): ${s.left} ${(s.leftRate * 100).toFixed(2)}%, ${s.right} ${(s.rightRate * 100).toFixed(2)}%, ${s.deltaPp.toFixed(2)}pp, p = ${s.p.toFixed(4)}`,
      pass: s.paired >= SUBSTRATE_FLOOR,
      blocking: false,
    });
    // The rate the comparison reports is over the paired set, and the paired set is chosen by the
    // stores rather than by the design: a store that holds a rule for a question the other one does
    // not would otherwise contribute to one side's denominator only. This gate does not fail the
    // run — an asymmetry is a property of the corpus — but it makes the size of the asymmetry a
    // condition of reading the delta, so "paired on 300 of 296" cannot pass as paired.
    gates.push({
      id: 'V36-substrate-coverage',
      criterion: 'the exclusion is small enough that the paired set still describes the corpus',
      actual: `${s.leftExclusive} left-only, ${s.rightExclusive} right-only of ${union}`,
      pass: s.leftExclusive + s.rightExclusive <= Math.max(10, Math.round(union * 0.1)),
      blocking: false,
    });
  }
  if (input.pool !== undefined) {
    const { questions, expected, candidates, signed, unsigned, consistent } = input.pool;
    gates.push({
      id: 'V18-pool-complete',
      criterion: 'the pool describes every question the baseline answered, or the instrumentation dropped cases',
      actual: `${questions}/${expected} question(s), ${candidates} candidate(s)`,
      pass: questions === expected && questions > 0,
      blocking: true,
    });
    gates.push({
      id: 'V19-pool-reconciles',
      criterion: 'every recorded candidate is either signed or explicitly unsigned, and every question has a result',
      actual: `${signed} signed + ${unsigned} unsigned = ${candidates} candidate(s)`,
      pass: signed + unsigned === candidates && consistent,
      blocking: true,
    });
  }
  if (input.goldExecRate !== undefined) {
    // Present only where the scenario can execute its own reference answer: a judged reply or a
    // tool-call match has no `gold` to run, and a gate that cannot fire must be absent rather than
    // green. The threshold is the dataset's usability, not the model's.
    gates.push({
      id: 'V4-gold-executable',
      criterion: 'at least 99% of gold queries execute, or the dataset is not usable',
      actual: `${(input.goldExecRate * 100).toFixed(2)}%`,
      pass: input.goldExecRate >= 0.99,
      blocking: true,
    });
  }

  if (input.conventionExecRate !== undefined) {
    gates.push({
      id: 'V10-convention-executable',
      criterion: 'at least 99% of rewritten gold queries report the value the convention expects',
      actual: `${(input.conventionExecRate * 100).toFixed(2)}%`,
      pass: input.conventionExecRate >= 0.99,
      blocking: true,
    });
  }
  if (input.framing !== undefined && input.framing.length > 0) {
    // A framing arm that never sent its sentence is the control under a second name, and the
    // reading would be "the sentence cost nothing" when the truth is that there was no sentence.
    // The two directions are both failures: an arm that declares a framing and misses a prompt,
    // and an arm that declares none and carries one anyway.
    const disagree = input.framing.filter((entry) =>
      entry.expected ? entry.carrying !== entry.prompts : entry.carrying !== 0,
    );
    gates.push({
      id: 'V43-framing-delivered',
      criterion:
        'every arm that declares a framing carried it on every prompt it sent, and no other arm carried one',
      actual:
        input.framing
          .map(
            (entry) =>
              `${entry.arm}: ${entry.carrying}/${entry.prompts}${entry.expected ? '' : ' expected none'}`,
          )
          .join(', ') +
        (disagree.length === 0 ? '' : ` — disagrees: ${disagree.map((e) => e.arm).join(', ')}`),
      pass: disagree.length === 0,
      blocking: true,
    });
  }
  if (input.statements !== undefined) {
    // A statement that ran out of time is not evidence about the model, and a score built mostly
    // from them is a score about how long a query takes. The bar is one percent: a pathological
    // statement shows up once or twice in a panel of a thousand, so anything above that share is a
    // systematic property of the lane — a database it cannot query, or a deadline set too low for
    // the machine — and either way the number underneath it is not the model's.
    const { statements, deadlines, truncations } = input.statements;
    gates.push({
      id: 'V48-statements-answered',
      criterion:
        'at least 99% of the statements the lane executed answered inside the statement deadline',
      actual: `${deadlines} of ${statements} statement(s) hit the deadline, ${truncations} truncated`,
      pass: statements > 0 && deadlines / statements <= 0.01,
      blocking: true,
    });
  }
  if (input.domainOrigin !== undefined) {
    // Two paths make a domain-free item: a claim that arrived unscoped, and a widening that earned
    // the loss. Anything beyond those two is an item that lost its domain somewhere nobody
    // instrumented, which is the shape of every instrument defect this audit has recorded — so the
    // check is an inequality rather than an accounting identity, and a surplus fails the run.
    //
    // The population is part of the criterion. `0 <= 0` is true, and the first cross-domain dispatch
    // was certified by it: the store held no items at all, so the ledger reconciled nothing, passed,
    // and appeared beside `V1`'s "the pack was empty" as if the two were different findings. A gate
    // that certifies an empty population is a gate that certifies nothing, and it is blocking, so it
    // was the reason the pair looked valid.
    const { storedWithDomain, storedWithoutDomain, unscopedIn, widenedIn } = input.domainOrigin;
    const stored = storedWithDomain + storedWithoutDomain;
    gates.push({
      id: 'V44-domain-accounted',
      criterion:
        'the store holds at least one item, and every item with no domain either arrived without one or lost it to a recorded widening',
      actual:
        stored === 0
          ? 'the store holds no item, so there is no ledger to account for'
          : `${storedWithoutDomain} of ${stored} item(s) with no domain, ${unscopedIn} arrived unscoped, ${widenedIn} widened`,
      pass: stored > 0 && storedWithoutDomain <= unscopedIn + widenedIn,
      blocking: true,
    });
  }
  if (input.clearance !== undefined) {
    // Two ways this pair stops being an experiment. If the control dropped a different number of
    // items, the delta is dose as much as content and nothing can separate them afterwards. If no
    // question's pack changed at all, the two arms are one condition with two names, and the delta
    // between them is the provider's noise wearing a treatment's clothes. Both are failures of the
    // instrument rather than of the hypothesis, so neither is allowed to reach a published number.
    const { questions, mismatched, identical, dropped, meanCleared, meanControl, arm, control } =
      input.clearance;
    gates.push({
      id: 'V45-clearance-dose-matched',
      criterion:
        'the clearance arm and its control carried the same number of items on every question, and clearance changed at least one pack',
      actual:
        `${mismatched} mismatched of ${questions} question(s), ${identical} identical, ` +
        `${dropped} item(s) cleared, mean items ${meanCleared.toFixed(2)} (${arm}) vs ` +
        `${meanControl.toFixed(2)} (${control})`,
      pass: mismatched === 0 && identical < questions,
      blocking: true,
    });
  }
  if (input.raw !== undefined) {
    // Two failures, and both of them end the claim rather than the run. A block that is not
    // byte-identical to the event it came from means the renderer interpreted something, and the arm
    // is then a third distiller with a new name — the one reading that would make its delta
    // uninterpretable. No cells at all means the arm never showed a raw event, which is `none` under
    // a second name: a run whose store produced no correction, or whose budget admitted none.
    //
    // The unit is the *event*, not the line, and that is a correction to this gate rather than a
    // widening of it: the first version split the payload on newlines and matched each line against a
    // field, which cannot represent a value that is itself multi-line — and a SQL query usually is.
    // R22's first dispatch failed on exactly that: every `Question:` and `Correction:` cell matched,
    // the short single-line `Attempt:` cells matched, and the multi-line ones could not. A block is
    // the only unit that can carry the claim the arm makes.
    const { arm, cells, verbatim, skipped, sample } = input.raw;
    gates.push({
      id: 'V46-raw-is-verbatim',
      criterion:
        'every block of a raw pack is byte-identical to the correction event it was rendered from, and the arm rendered at least one',
      actual:
        `${verbatim}/${cells} rendered event(s) byte-identical (${arm}), ${skipped} event(s) ` +
        `skipped as too long${sample === undefined ? '' : `, first mismatch: ${JSON.stringify(sample)}`}`,
      pass: cells > 0 && verbatim === cells,
      blocking: true,
    });
  }
  if (input.evidence !== undefined && input.evidence.length > 0) {
    // The ablation's validity, in both directions. An arm that removed nothing is `none` under a
    // second name, and its difference from `none` would then be read as "the evidence costs nothing"
    // when the truth is that the evidence was still there — the same defect this record has caught in
    // a framing arm, a dose control and a verbatim checker. A shipped arm that lost the block is the
    // mirror image and just as fatal: every published number in this record was measured on top of
    // that block, so an arm that silently dropped it is not the baseline it claims to be.
    //
    // The third condition is the one a count alone cannot see: the ablated arm has to have sent as
    // many prompts as the arm it ablates. An ablation that reached fewer questions is a smaller
    // experiment wearing the same name.
    const widest = Math.max(...input.evidence.map((entry) => entry.prompts));
    const disagree = input.evidence.filter((entry) =>
      entry.expected
        ? entry.carrying !== entry.prompts
        : entry.carrying !== 0 || entry.prompts !== widest,
    );
    gates.push({
      id: 'V47-evidence-ablated',
      criterion:
        'every arm meant to show the evidence sentence showed it on every prompt that had one, ' +
        'every ablated arm showed it on none, and the ablation covered as many questions as the arm it ablates',
      actual:
        input.evidence
          .map(
            (entry) =>
              `${entry.arm}: ${entry.carrying}/${entry.prompts}${entry.expected ? '' : ' expected none'}`,
          )
          .join(', ') +
        (disagree.length === 0 ? '' : ` — disagrees: ${disagree.map((e) => e.arm).join(', ')}`),
      pass: widest > 0 && disagree.length === 0,
      blocking: true,
    });
  }

  if (input.dose !== undefined) {
    // A truncation that did not truncate is not a null result, it is an arm nobody ran. The two
    // readings it guards against are both silent: a pack that arrived with two items because the
    // budget allowed them, and a pack that arrived with one because the store only had one — the
    // second is legitimate and the gate accepts it, so the criterion is about the ceiling rather
    // than the mean, and about whether the arm's prompts differ from `full`'s at all.
    const share = input.dose.questions === 0 ? 0 : input.dose.differsFromFull / input.dose.questions;
    gates.push({
      id: 'V49-dose-truncated',
      criterion:
        'every prompt of the one-slot arm carried at most one item, it asked every question, ' +
        'and its pack differed from full on at least a fifth of them',
      actual:
        `${input.dose.arm}: ${input.dose.prompts} prompts, ${input.dose.overBudget} over one item, ` +
        `${input.dose.differsFromFull}/${input.dose.questions} differ from full ` +
        `(${(share * 100).toFixed(1)}%)`,
      pass:
        input.dose.overBudget === 0 &&
        input.dose.prompts === input.dose.questions &&
        share >= 0.2,
      blocking: true,
    });
  }

  if (input.admission !== undefined) {
    // The arm's own question, asked of the arm: did the fit admit anything, and did it refuse
    // anything? A floor that keeps the whole population makes the arm its own control, and the
    // difference it reports is then a difference of nothing. `no-evidence` is the same failure
    // wearing a fitted floor of zero, so the gate reads the reason rather than the number.
    const admittedShare =
      input.admission.questions === 0 ? 0 : input.admission.admitted / input.admission.questions;
    const unevidenced = input.admission.folds.filter((fold) => fold.reason !== 'fitted');
    gates.push({
      id: 'V50-admission-engaged',
      criterion:
        'every fold fitted its floor from decisive learning rows, and the arm both admitted and ' +
        'refused questions, so its comparison with the one-slot control is a decision',
      actual:
        input.admission.folds
          .map(
            (fold) =>
              `fold ${fold.fold}: floor ${fold.floor.toFixed(3)}, kept ${fold.kept}/${fold.total}, ` +
              `net ${fold.helped - fold.harmed}, ${fold.reason}`,
          )
          .join('; ') +
        ` — admitted ${input.admission.admitted}/${input.admission.questions} ` +
        `(${(admittedShare * 100).toFixed(1)}%)` +
        (unevidenced.length === 0 ? '' : `, unevidenced folds ${unevidenced.length}`),
      pass:
        input.admission.folds.length > 0 &&
        unevidenced.length === 0 &&
        input.admission.admitted > 0 &&
        input.admission.admitted < input.admission.questions,
      blocking: true,
    });
  }
  if (input.channels !== undefined && input.channels.length > 0) {
    // A channel arm's null is about the channel only if the channel moved the prompt. `values`
    // annotates every column unconditionally, so it is held to 95%: a tenth of prompts without the
    // annotation is a different arm from the one the name describes. `linked` prunes only when the
    // question names tables, so it is held to the weaker condition that it fired at all — thresholding
    // a pruner's *share* would encode this record's guess about how often a linker binds.
    const readings = input.channels.map((entry) => ({
      ...entry,
      share: entry.asked === 0 ? 0 : entry.applied / entry.asked,
    }));
    gates.push({
      id: 'V51-channel-applied',
      criterion:
        'every channel arm rewrote the prompt at least as often as its kind requires ' +
        `(${readings.map((entry) => entry.expects).join(', ')}), so a null on it is a null about ` +
        'the channel rather than about the arm carrying its name',
      actual: readings
        .map(
          (entry) =>
            `${entry.arm} (${entry.kind}): ${entry.applied}/${entry.asked} = ` +
            `${(entry.share * 100).toFixed(1)}%`,
        )
        .join('; '),
      // `applied > 0` is an invariant of the gate rather than of a floor: a channel arm that rewrote
      // nothing is the control under another name, and a floor of zero would otherwise let it pass.
      // The floor answers "how often must it happen to be this arm", and zero is not an answer.
      pass: readings.every(
        (entry) => entry.asked > 0 && entry.applied > 0 && entry.share >= entry.floor,
      ),
      blocking: true,
    });
  }

  return inGateOrder(gates);
}
