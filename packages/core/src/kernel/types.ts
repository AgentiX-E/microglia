/**
 * Public type surface for Microglia.
 *
 * The schema strings are literal versions rather than free-form metadata: a
 * persisted event is read by a future version of this library, and a version
 * that cannot name the shape it is reading cannot migrate it. Bumping a schema
 * string is therefore a breaking change with an explicit migration.
 */

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export type JsonObject = { [key: string]: Json };

export type JsonPath = ReadonlyArray<string | number>;

/** A single structural change between two JSON values. */
export type CorrectionOp =
  | { readonly op: 'set'; readonly path: JsonPath; readonly before: Json; readonly after: Json }
  | { readonly op: 'remove'; readonly path: JsonPath; readonly before: Json }
  | { readonly op: 'insert'; readonly path: JsonPath; readonly after: Json };

export type ActorType = 'user' | 'system' | 'evaluator' | 'verifier';

export type Actor = {
  readonly type: ActorType;
  /**
   * A salted hash, never a raw identifier. Microglia is embedded in the host and
   * must not become a second place where user identities are stored.
   */
  readonly idHash?: string;
};

export type FeedbackKind =
  | 'rating'
  | 'edit'
  | 'preference'
  | 'outcome'
  | 'clarification'
  | 'abstain';

export type RatingValue = 'up' | 'down';

export type FeedbackSignal =
  | {
      readonly type: 'rating';
      readonly value: RatingValue;
      readonly reasons: readonly string[];
      readonly comment?: string;
    }
  | {
      readonly type: 'edit';
      readonly beforeHash: string;
      readonly afterHash: string;
      readonly ops: readonly CorrectionOp[];
      /** Normalised edit distance in [0, 1]; 0 means "no change". */
      readonly distance: number;
      /** Canonical post-edit value, redacted, used as the learning target. */
      readonly after: Json;
      /**
       * What the reviewer said about the edit, when they said anything.
       *
       * `RunHandle.edit` has always accepted this option and the normaliser used to
       * drop it, so an interpreter saw an edit without the one piece of context a
       * human supplied. Carried, not interpreted: prose is evidence at the user-text
       * tier, never an instruction.
       */
      readonly note?: string;
    }
  | {
      readonly type: 'preference';
      readonly chosenRunId: string;
      readonly rejectedRunId: string;
      readonly criterion?: string;
    }
  | {
      readonly type: 'outcome';
      readonly ok: boolean;
      readonly code?: string;
      readonly detail?: string;
    }
  | {
      readonly type: 'clarification';
      readonly question: string;
      readonly answer: string;
    }
  | {
      readonly type: 'abstain';
      readonly reason: string;
    };

/**
 * The generation-side context that makes a feedback event interpretable later.
 *
 * `knowledgeIds` is the load-bearing field: without it a correction cannot be
 * credited to (or exonerated from) the knowledge that was in the prompt, and
 * the flywheel degenerates into "append everything, measure nothing".
 */
export type RunProvenance = {
  readonly model?: string;
  readonly promptVersion?: string;
  readonly appVersion?: string;
  readonly domainPack?: string;
  readonly schemaDigest?: string;
  readonly knowledgeIds: readonly string[];
  readonly retrievalHash?: string;
  readonly metadata?: JsonObject;
};

export type FeedbackEvent = {
  readonly schema: 'microglia.feedback/1';
  readonly id: string;
  readonly at: number;
  readonly namespace: string;
  readonly sessionId: string;
  readonly runId: string;
  readonly task: string;
  readonly taskId?: string;
  readonly attempt?: number;
  readonly kind: FeedbackKind;
  readonly actor: Actor;
  /** Source trust in [0, 1], derived from the signal, not from the user. */
  readonly trust: number;
  readonly signal: FeedbackSignal;
  readonly provenance: RunProvenance;
  /** How many spans were redacted before persistence. Zero is the common case. */
  readonly redactions: number;
};

export type RunRecord = {
  readonly schema: 'microglia.run/1';
  readonly id: string;
  readonly at: number;
  readonly namespace: string;
  readonly sessionId: string;
  readonly task: string;
  /** The task instance this run is an attempt of, when one was opened. */
  readonly taskId?: string;
  /** 1-based attempt number within the task. */
  readonly attempt?: number;
  /** The attempt this one revises, so a chain can be walked without guessing. */
  readonly parentRunId?: string;
  readonly input: JsonObject;
  readonly output: Json | undefined;
  readonly provenance: RunProvenance;
  readonly feedbackIds: readonly string[];
};

export type KnowledgeKind =
  | 'constraint'
  | 'exemplar'
  | 'negative'
  | 'lexicon'
  | 'procedure'
  /**
   * A recorded finding that a kind of question cannot be answered as asked.
   *
   * It is knowledge in the only sense that matters here: it stops the model from
   * inventing an answer. Rendered in its own block with its own instruction,
   * because a negation inside a positive block is read as a positive.
   */
  | 'abstention';

/**
 * How much structure a signal carries, which caps how far its lesson may travel.
 *
 * A free-text comment is a claim; an edit is a corrected artefact; an outcome is a
 * measurement of one. The order matters because a store whose lessons come from
 * text alone can be talked into anything by one articulate user -- `user-text` may
 * be stored and may contribute evidence, but it cannot activate a rule on its own.
 */
export type ProvenanceTier = 'user-text' | 'structured-edit' | 'outcome' | 'host-asserted';

export const TIER_RANK: Readonly<Record<ProvenanceTier, number>> = {
  'user-text': 0,
  'structured-edit': 1,
  outcome: 2,
  'host-asserted': 3,
};

/**
 * A scope is a conjunction of optional filters. Every present field must match.
 *
 * Scopes are deliberately coarse and human-auditable: a correction learned in
 * `sales` must not silently govern `hr`, and a correction learned from one
 * schema must not leak into another. Optional fields are omitted, never `null`,
 * so a persisted record has one representation.
 */
export type KnowledgeScope = {
  readonly task: string;
  readonly domain?: string;
  readonly schemaDigest?: string;
  readonly intent?: string;
  readonly field?: string;
  readonly reasonCode?: string;
};

export type EvidenceRef = {
  readonly feedbackId: string;
  readonly runId: string;
  readonly at: number;
  /** Weighted by source trust and signal strength, in [0, 1]. */
  readonly weight: number;
  /**
   * The task instance this evidence came from, when the host opened one.
   *
   * Support is counted per task, not per event: eight attempts of one task are
   * one observation by one user, and letting them count eight times is how a
   * single persistent user admits a rule alone. Absent means "no task declared",
   * and the run id stands in, which keeps callers that never opened a task on the
   * previous behaviour.
   */
  readonly taskId?: string;
  /**
   * Which attempt at that task produced this evidence, when the host ran it more than once.
   *
   * 1-based, the same numbering `FeedbackEvent.attempt` and `RunRecord.attempt` already use, so a host
   * that opened a task does not have to translate between two vocabularies. The offline arms write
   * every claim before any evaluation trial starts, so this field is absent from all of them and their
   * packs are unchanged. It exists for the in-episode arm, where the store is written *during* the
   * evaluation from the trial that just failed, and where the one property that makes the reading a
   * measurement rather than a leak is that attempt *t* cannot read a claim distilled from attempt *t*.
   * See `visibleBefore`.
   *
   * Filled by `distill` from the event's own `attempt`, not taken from the interpreter: the attempt is
   * a property of the observation, and an interpreter is host code stating facts about someone else's
   * evidence. One that states a different number is overruled, the way the host's `domainOf` is.
   */
  readonly attempt?: number;
};

/**
 * Which records an erasure request covers.
 *
 * A host with deletion obligations is asked for a person, not for a row: it knows
 * an actor id or a task id, rarely the internal ids of the knowledge an erasure
 * produced. Selecting by all three is how the request survives that asymmetry.
 * At least one field is required; an empty selector would be a wipe.
 */
export type ErasureSelector = {
  /**
   * Tenant scope. The facade always sets it, because an `actorId` alone would
   * otherwise erase that person in every namespace the store happens to hold.
   */
  readonly namespace?: string;
  readonly ids?: readonly string[];
  readonly taskId?: string;
  /**
   * The salted hash the event carries, never a raw identifier: the library does
   * not hold identities, so it cannot be asked to erase by one it never saw.
   */
  readonly actorHash?: string;
};

export type ErasureReport = {
  readonly events: number;
  readonly runs: number;
  /** Items removed because no evidence survived. */
  readonly knowledge: number;
  /** Items kept, with the erased evidence removed and the claim re-scored. */
  readonly rescored: number;
  readonly tombstone: string;
};

/**
 * What was erased, and nothing about what it said.
 *
 * The tombstone is the audit trail of a deletion: it records that a selector was
 * applied at a time and how many records it covered. It never carries a statement
 * or a payload, because a record of the erased data would defeat the erasure.
 */
export type ErasureTombstone = {
  readonly schema: 'microglia.erasure/1';
  readonly id: string;
  readonly at: number;
  readonly namespace?: string;
  readonly selector: ErasureSelector;
  readonly erased: {
    readonly events: readonly string[];
    readonly runs: readonly string[];
    readonly knowledge: readonly string[];
  };
};

export type KnowledgeStatus = 'candidate' | 'active' | 'quarantined' | 'retired' | 'conflicted';

/**
 * How an item has actually behaved when it was in the prompt.
 *
 * Without a denominator, credit is a numerator with no base and retirement has
 * nothing to stand on: a rule cannot be shown to be useless if nobody counted how
 * often it was given a chance. `injected` counts outcomes observed on runs that
 * cited the item -- not every render, because a render is not a measurement.
 */
export type Utility = {
  readonly injected: number;
  readonly flippedUp: number;
  readonly flippedDown: number;
};

export type TaskStatus = 'accepted' | 'abandoned' | 'escalated';

/**
 * A task instance: the unit of intent.
 *
 * A run is one generation; a task is the job the user was trying to get done. The
 * distinction is what lets the store learn from "the third rewrite of attempt two
 * was accepted" instead of only from adjacent edits.
 */
export type TaskRecord = {
  readonly schema: 'microglia.task/1';
  readonly taskId: string;
  readonly taskType: string;
  readonly namespace: string;
  readonly sessionId?: string;
  readonly attempts: number;
  readonly status: TaskStatus;
  readonly finalRunId?: string;
  readonly reasonCode?: string;
  readonly openedAt: number;
  readonly closedAt: number;
};

export type KnowledgeItem = {
  readonly schema: 'microglia.knowledge/1';
  readonly id: string;
  /** Tenancy boundary. Retrieval never crosses it; the leakage test asserts it. */
  readonly namespace: string;
  readonly kind: KnowledgeKind;
  readonly scope: KnowledgeScope;
  /** One sentence, declarative, self-contained. Rendered verbatim. */
  readonly statement: string;
  /**
   * The condition under which the statement applies, when the distiller can state one.
   *
   * Added after the measurement in iteration 62: rules credited with a hurt sat at
   * median cosine 0.232 from the question that was harmed and rules credited with a
   * help at 0.228 (p = 0.86), and word coverage was 0.133 against 0.130. Two signals,
   * no separation — so the failing thing was not *which* rule was retrieved but what
   * the rule says. A statement records what was true; it says nothing about when it
   * is true, and the prompt asked the model to treat the first as the second.
   *
   * `when` is that missing half, and it is rendered *before* the statement so a
   * reader meets the condition first. Absent means the distiller declined to name
   * one, which is not the same as "always" — the renderer says so.
   */
  readonly when?: string;
  /** Machine-usable payload (e.g. exemplar input/output), if the kind needs one. */
  readonly payload?: Json;
  readonly evidence: readonly EvidenceRef[];
  /** Sum of evidence weights; drives the saturating evidence score. */
  readonly support: number;
  /** Number of contradictory observations. */
  readonly contradictions: number;
  /** Fused confidence in [0, 1]. Recomputed by `scoreKnowledge`. */
  readonly confidence: number;
  /** Inherited source trust in [0, 1]. */
  readonly trust: number;
  readonly validFrom: number;
  /** World-time end, `Infinity` while still asserted. */
  readonly validUntil: number;
  readonly systemFrom: number;
  /** System-time end, `Infinity` while current. */
  readonly systemUntil: number;
  readonly status: KnowledgeStatus;
  readonly statusReason?: string;
  /** The strongest tier among the evidence that produced this item. */
  readonly tier?: ProvenanceTier;
  /** Number of runs in which this item was retrieved and injected. */
  readonly applied: number;
  /** Number of those runs whose observed outcome was positive. */
  readonly succeeded: number;
  /** Present once the item has been part of a run that reported an outcome. */
  readonly utility?: Utility;
  readonly createdAt: number;
  readonly updatedAt: number;
};

export type KnowledgePack = {
  readonly items: readonly KnowledgeItem[];
  readonly ids: readonly string[];
  readonly rendered: string;
  /** Rough token estimate (characters / 4), stated as an estimate everywhere. */
  readonly tokens: number;
  readonly hash: string;
  readonly budget: number;
  readonly truncated: number;
  /**
   * Why a pack that a host asked for came back empty, when it was suppressed rather
   * than merely unmatched.
   *
   * `'uncorroborated-store'` means the corroboration floor was applied: the store
   * cannot corroborate its own rules, so the pack was silenced deliberately. A host
   * that cannot tell that from "nothing matched" will read a deliberate silence as a
   * retrieval failure and lower thresholds until the noise returns.
   */
  readonly suppressed?: 'uncorroborated-store';
  /**
   * What the pack's units carry, when the host can name a shape.
   *
   * Present in both modes: `per-failure` folds nothing and reports the pack as it stands, which is how
   * the control arm's own support distribution becomes a number rather than an assumption. Absent on
   * every host that never declared a shape extractor, so no pack written before this field existed
   * changes.
   */
  readonly fold?: ShapeFold;
};

/**
 * The two units a pack can carry: one line per failure, or one line per routine.
 *
 * The names are words rather than a boolean for the reason every switch in this project is: a
 * `boolean` reads as "on" in a table nobody annotated, and the thing being varied is a *unit*, which
 * has two spellings and no default meaning outside the arm that chose one.
 */
export type ShapeMode = 'per-failure' | 'collapse';

export const SHAPE_MODES: readonly ShapeMode[] = ['per-failure', 'collapse'];

/** One routine, the members that taught it, and the survivor a folded pack carries. */
export type FoldedGroup = {
  /** The shape as the host's extractor spelled it, with the kind removed: one shape may be two groups. */
  readonly shape: string;
  /** The member id the pack renders. */
  readonly kept: string;
  /** Every member id the group held, in pack order, `kept` included. */
  readonly members: readonly string[];
  /** Distinct tasks behind the group — the quantity the fold exists to make visible. */
  readonly support: number;
};

/**
 * What the pack's units carry, over the items it will render.
 *
 * The same three numbers on both arms, which is what makes the control's reading a reading rather than
 * an absence: `per-failure` reports `atLeastTwo: 0` on a store of single-task records, and that zero is
 * R92's finding reproduced inside the arm instead of argued from the store's size.
 */
export type FoldSupport = {
  readonly max: number;
  /** Units taught by ≥2 tasks — ALTK's `sup2`. */
  readonly atLeastTwo: number;
  /** Units taught by ≥3 tasks — the cell ALTK's `sup3` keeps. */
  readonly atLeastThree: number;
};

/** What folding a pack did, and what the units it kept carry. */
export type ShapeFold = {
  /** The items to render, in their original order, with each folded group's survivor in place. */
  readonly items: readonly KnowledgeItem[];
  /** How many items the fold removed: `input − items`. */
  readonly folded: number;
  /** Groups that folded, in pack order. Empty in `per-failure` mode, which folds nothing. */
  readonly groups: readonly FoldedGroup[];
  /**
   * Groups of ≥2 members that did **not** fold because their distinct tasks fell short.
   *
   * Counted rather than dropped: a store where nothing folded because every shape was taught once and a
   * store where nothing folded because nothing recurs are different findings, and an arm that reported
   * only `folded: 0` could not tell them apart.
   */
  readonly refused: number;
  readonly support: FoldSupport;
};

export type Policy = {
  /** Confidence at or above which a candidate becomes active. */
  readonly activationThreshold: number;
  /** Confidence below which an active item is retired. */
  readonly retirementThreshold: number;
  /** Evidence weight required before a candidate may activate. */
  readonly minSupport: number;
  /** Contradictions tolerated before an item is marked conflicted. */
  readonly maxContradictions: number;
  /** Runs after which a failing item is retired. */
  readonly minApplicationsForRetirement: number;
  /** Success rate below which a sufficiently applied item is retired. */
  readonly failureRateThreshold: number;
  /** Trust required for a single observation to activate knowledge. */
  readonly singleObservationTrust: number;
  /** Observations below this trust are quarantined instead of admitted. */
  readonly quarantineBelowTrust: number;
  /** Penalty in log-odds applied per contradictory observation. */
  readonly contradictionPenalty: number;
  /** Prior successes and failures used by the smoothed empirical rate. */
  readonly priorSuccess: number;
  readonly priorFailure: number;
  /** Characters of knowledge allowed in a pack by default. */
  readonly defaultBudget: number;
  /** Reject knowledge whose statement fails the injection screen. */
  readonly rejectUnsafeKnowledge: boolean;
};

export type SignalStrength = {
  readonly trust: number;
  readonly weight: number;
};

export type DistillCandidate = {
  readonly namespace: string;
  readonly kind: KnowledgeKind;
  readonly scope: KnowledgeScope;
  readonly statement: string;
  /** The condition under which the claim applies; see `KnowledgeItem.when`. */
  readonly when?: string;
  readonly payload?: Json;
  readonly evidence: EvidenceRef;
  readonly trust: number;
  /** Stable identity of the claim, used to merge duplicates across runs. */
  readonly dedupeKey: string;
  /** Set by the distiller from the event kind; absent means "not classified". */
  readonly tier?: ProvenanceTier;
};

export type RecallQuery = {
  readonly task: string;
  readonly text: string;
  readonly namespace: string;
  readonly scope?: Omit<KnowledgeScope, 'task'>;
  readonly budget?: number;
  readonly limit?: number;
  /**
   * Minimum share of the query's content terms a rule must mention to be injected.
   *
   * Absent means "no gate", which is the behaviour every existing caller has.
   * A host that has measured its own knowledge sets this so a weak match becomes
   * no match: injecting a rule the question does not mention is how a pack of
   * correct facts becomes prompt noise.
   */
  readonly minCoverage?: number;
  /**
   * Whether a scope-matched rule that shares **no word** with the query may be
   * injected.
   *
   * `'scope'` (the behaviour before iteration 62) treats a structured scope as an
   * index: every rule in the domain becomes a candidate, and confidence — which is
   * a function of time and corroboration, not of relevance — can carry it into the
   * top-k. That was deliberate, to keep rules that had generalised out of a domain
   * reachable, and it is what made a pack of 2.0 rules per question contain, on
   * BIRD, injections whose median lexical overlap with the question was 13% and 57%
   * of which shared under a sixth of the question's content words.
   *
   * `'lexical'` requires an anchor: a rule enters the pack because the question
   * mentions something in it. Scope still filters — a rule outside the scope never
   * appears — but it cannot be the only reason.
   *
   * The default stays `'scope'` because that is the published contract, and because
   * the measurement says the keyword gate is not the fix: on BIRD, requiring one
   * shared word removed the pack's unanchored rules and recovered 0.29pp of a 4.00pp
   * cost. What it costs is recorded here rather than acted on by changing a default.
   */
  readonly anchoring?: 'lexical' | 'scope';
  /**
   * Independent corrections a rule needs before it may be injected.
   *
   * The pack layer's third gate, beside scope (which rules could apply), coverage
   * (which rules the question mentions) and this one (which rules have been observed
   * more than once). Absent means 1: one correction is enough, which is the behaviour
   * every caller had before the field existed.
   */
  readonly minEvidence?: number;
  /**
   * The sentence the rendered block opens with, for THIS request only.
   *
   * A request-level override of the host's note, absent meaning "whatever the host was
   * opened with". It is on the query rather than only on the host because the level is
   * text a pack is rendered with — not state the memory holds — and because an experiment
   * that varies one sentence must be able to do it over ONE store: three dispatches of one
   * configuration produce three stores, so three levels run that way measure the model's
   * corrections, not the note. See `NoteMode` in `apply/render.ts` for the three levels.
   */
  readonly note?: 'standard' | 'hardened' | 'none';
  /**
   * The attempt whose pack this is: only claims learned from strictly earlier attempts may be served.
   *
   * Absent means "no watermark", which is every offline arm -- the store there is frozen before the
   * evaluation starts, so there is nothing to leak. It is present only in an arm that writes between
   * attempts, where the whole reading depends on attempt *t* not seeing what attempt *t* taught. The
   * watermark travels in the request rather than in the writer's memory because it has to hold against
   * a write that lands while the attempt is still recalling, and a filter the reader supplies is the
   * only one a concurrent writer cannot outrun.
   *
   * 1-based like `FeedbackEvent.attempt`: `before: 1` is the first attempt and serves only what the
   * store held before the episode began. A claim that declares no attempt predates the episode and is
   * served to all of them.
   */
  readonly before?: number;
  /**
   * The unit this request wants: one line per failure, or one line per routine.
   *
   * Absent means `per-failure`, the shape every committed artefact measured. `collapse` folds items
   * that state the same routine into one line, keeping the group's medoid and reporting the support the
   * group carries — see `apply/shape-fold.ts`, and note that the request can only fold what the host can
   * name: a host opened without a `shapeOf` extractor folds nothing whatever this says.
   */
  readonly shape?: 'per-failure' | 'collapse';
};
