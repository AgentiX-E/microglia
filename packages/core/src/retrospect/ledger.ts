/**
 * The review ledger: what a human decided, about exactly which text, and when.
 *
 * A hand-adjudicated memory has one serious methodological problem — the human is an
 * unmeasured variable. If guidelines are accepted by a person before they are measured, the
 * arm's delta is *memory plus that person's priors*, and no ablation across arms can separate
 * them afterwards. The published competitor set does not help here: ALTK-Evolve states that
 * no human annotation is involved, ExpeL and AWM admit everything their extractor produces,
 * and AutoGuide's selection is a model's. None of them reports what a reviewer would have
 * removed, so none of them can price one.
 *
 * The answer is not to avoid the reviewer but to make the reviewer readable: every decision
 * stores the text as shown, the text as accepted, the action, the reviewer and the time it
 * took. That turns "a human approved this" into a quantity — accept rate, edit rate, seconds
 * per card — and lets a later arm ask whether the human's marginal contribution is positive.
 *
 * Three of the rules below are worth stating because they are the ones a reviewer will argue
 * with:
 *
 *  1. **The condition is not editable, and that is a design decision rather than a gap.** A
 *     trigger here is the *output of the witness* — the intersection of the conditions its
 *     sources declared — not a sentence somebody wrote. Editing it would change what the rule
 *     covers while leaving the coverage evidence untouched, which is precisely the operation
 *     this pipeline exists to make impossible. A reviewer who believes the trigger is wrong
 *     has two honest moves: `split` (these are two situations) or `reject` (this is not a
 *     rule). Widening a rule is a different operation that needs sources the corpus does not
 *     have, and inventing them from the keyboard is how a measured memory becomes a prompt.
 *  2. **Accepting an inadmissible card is refused.** The machine gate is not decoration, and
 *     a console that lets a human wave a restatement through has turned a measured pipeline
 *     back into a hand-written prompt.
 *  3. **`override` exists, and it is recorded.** A human who disagrees with the gate can say
 *     so, with a reason, and the admitted item carries `reviewAction: 'override'` so the
 *     store can be audited for exactly how often that happened. Refusing the option would
 *     not remove the disagreement, it would only remove the record of it.
 */
import { MicrogliaError, hashText } from '../kernel/index.js';
import type { DistillCandidate, EvidenceRef } from '../kernel/index.js';
import { admissibilityOf, witnessOf, type RetrospectPolicy } from './witness.js';
import type { AdmissibilityReport } from './witness.js';
import type { ClusterCensus } from './cluster.js';
import type { GuidelineProposal, RetrospectSource } from './types.js';

export type ReviewAction =
  /** Admit as written. Requires a reviewable card. */
  | 'accept'
  /** Admit with the reviewer's wording and/or condition, which must still witness. */
  | 'edit'
  /** Refuse, with a reason an auditor can read. */
  | 'reject'
  /** The guideline covers two situations; the parts are re-witnessed as separate proposals. */
  | 'split'
  /** Not now. The only state a later decision may overwrite. */
  | 'defer'
  /** Admit against the gate's verdict, with a reason. Recorded as such on the item. */
  | 'override';

export type ReviewDecision = {
  readonly candidateId: string;
  readonly action: ReviewAction;
  readonly textBefore: string;
  /** The replacement statement, for `edit`. */
  readonly textAfter?: string;
  readonly reason?: string;
  /** For `split`: the parts the reviewer separated the guideline into. */
  readonly splitInto?: readonly string[];
  readonly reviewer: string;
  readonly at: number;
  /** Wall-clock time the reviewer spent on the card, which is what HITL costs. */
  readonly elapsedMs: number;
};

export type ReviewState = 'pending' | 'accepted' | 'rejected' | 'split' | 'deferred';

export type ReviewItem = {
  readonly proposal: GuidelineProposal;
  readonly admissibility: AdmissibilityReport;
  readonly state: ReviewState;
  /** The statement that would be admitted. Equal to the proposal's until a decision changes it. */
  readonly text: string;
  readonly decision?: ReviewDecision;
  /** Children produced by a `split`, as proposals still to be reviewed. */
  readonly children?: readonly GuidelineProposal[];
};

export type ReviewBatch = {
  readonly schema: 'microglia.retrospect/1';
  readonly id: string;
  readonly createdAt: number;
  readonly namespace: string;
  readonly policy: RetrospectPolicy;
  readonly corpus: readonly RetrospectSource[];
  readonly items: readonly ReviewItem[];
  /**
   * What the grouping did with the corpus, when the batch was built by a consolidator.
   *
   * Optional and absent from every batch that predates it: a `census` of zeroes on a hand-built
   * batch would be a measurement about a grouping that never ran. Present, it is the M1 reading a
   * reviewer can check the cards against — how much of the corpus no card claims, and which cards
   * are chains rather than groups.
   */
  readonly census?: ClusterCensus;
};

export function buildBatch(input: {
  readonly id: string;
  readonly createdAt: number;
  readonly namespace: string;
  readonly policy: RetrospectPolicy;
  readonly corpus: readonly RetrospectSource[];
  readonly proposals: readonly GuidelineProposal[];
  readonly census?: ClusterCensus;
}): ReviewBatch {
  const items = input.proposals.map((proposal) => ({
    proposal,
    admissibility: admissibilityOf(proposal, input.corpus, input.policy),
    state: 'pending' as const,
    text: proposal.statement,
  }));
  return {
    schema: 'microglia.retrospect/1',
    id: input.id,
    createdAt: input.createdAt,
    namespace: input.namespace,
    policy: input.policy,
    corpus: input.corpus,
    items,
    ...(input.census === undefined ? {} : { census: input.census }),
  };
}

function refused(sentence: string, detail: Record<string, unknown>): never {
  throw new MicrogliaError('MG_E_CONFIG', sentence, detail);
}

/** The card as it now stands, re-judged on the text and condition a decision left behind. */
function verdictOf(
  item: ReviewItem,
  corpus: readonly RetrospectSource[],
  policy: RetrospectPolicy,
): AdmissibilityReport {
  return admissibilityOf({ ...item.proposal, statement: item.text }, corpus, policy);
}

/**
 * Apply one decision, returning a new batch.
 *
 * Pure: the caller persists. That is what makes the console's ordering irrelevant — the
 * ledger is a fold over decisions, so a recorded session can be replayed against a fresh
 * batch and must produce the same items, which is a test rather than an aspiration.
 */
export function applyDecision(batch: ReviewBatch, decision: ReviewDecision): ReviewBatch {
  const index = batch.items.findIndex((item) => item.proposal.id === decision.candidateId);
  if (index < 0) refused('decision names a candidate that is not in this batch', { candidateId: decision.candidateId });
  const item = batch.items[index] as ReviewItem;
  if (item.state === 'accepted' || item.state === 'rejected' || item.state === 'split') {
    refused('this candidate has already been decided; the ledger is append-only', {
      candidateId: decision.candidateId,
      state: item.state,
    });
  }
  if (decision.reviewer.trim() === '') refused('a decision without a reviewer cannot be attributed', {});
  if (!Number.isFinite(decision.elapsedMs) || decision.elapsedMs < 0) {
    refused('elapsedMs must be a measured duration, not a placeholder', { elapsedMs: decision.elapsedMs });
  }
  if (decision.textBefore !== item.text) {
    // The console sends back what it showed. A mismatch means the card the reviewer read is
    // not the card being decided, and the edit distance would then describe a different text.
    refused('the decision was made about a different text than the batch now carries', {
      candidateId: decision.candidateId,
    });
  }

  const next = (patch: Partial<ReviewItem>): ReviewBatch => ({
    ...batch,
    items: batch.items.map((entry, position) => (position === index ? { ...entry, ...patch } : entry)),
  });

  switch (decision.action) {
    case 'accept': {
      const verdict = verdictOf(item, batch.corpus, batch.policy);
      if (verdict.state !== 'reviewable') {
        refused(`this card is not admissible as it stands: ${verdict.state}`, {
          candidateId: decision.candidateId,
          sentence: verdict.sentence,
        });
      }
      return next({ state: 'accepted', decision });
    }
    case 'override': {
      if ((decision.reason ?? '').trim() === '') {
        refused('an override carries a reason, or the gate was decoration', { candidateId: decision.candidateId });
      }
      return next({ state: 'accepted', decision });
    }
    case 'edit': {
      const after = (decision.textAfter ?? item.text).trim();
      if (after === '') refused('an edit must carry the replacement text', { candidateId: decision.candidateId });
      if (after === item.text.trim()) {
        refused('an edit that changes nothing is an accept; recording it as an edit would inflate the edit rate', {
          candidateId: decision.candidateId,
        });
      }
      // The edit is re-judged rather than trusted, even though it touches no condition: a
      // reworded claim can invert the rule's polarity, and a "never" where its sources say
      // "always" is the one edit that would survive every other check.
      const verdict = admissibilityOf({ ...item.proposal, statement: after }, batch.corpus, batch.policy);
      if (verdict.state !== 'reviewable') {
        refused(`the edited card is not admissible: ${verdict.state}`, {
          candidateId: decision.candidateId,
          sentence: verdict.sentence,
        });
      }
      return next({ state: 'accepted', text: after, decision });
    }
    case 'reject':
      if ((decision.reason ?? '').trim() === '') {
        refused('a rejection carries a reason, or the next reader cannot tell it from a lost card', {
          candidateId: decision.candidateId,
        });
      }
      return next({ state: 'rejected', decision });
    case 'defer':
      return next({ state: 'deferred', decision });
    case 'split': {
      const parts = (decision.splitInto ?? []).map((part) => part.trim()).filter((part) => part !== '');
      if (parts.length < 2) {
        refused('a split needs at least two parts; one part is an edit', {
          candidateId: decision.candidateId,
          parts: parts.length,
        });
      }
      // Each part is re-witnessed against the corpus rather than given the parent's claim:
      // the reviewer is asserting that the members divide along the new triggers, and the
      // members the parts do not reach are exactly the ones that were never one guideline.
      const children = parts.map((part, position) => {
        const child: GuidelineProposal = {
          id: `${item.proposal.id}_s${position + 1}`,
          statement: part,
          when: item.proposal.when,
          covers: item.proposal.covers,
        };
        const report = witnessOf(child, batch.corpus);
        const kept = new Set(
          report.findings.filter((finding) => finding.verdict === 'entailed').map((finding) => finding.sourceId),
        );
        return { ...child, covers: child.covers.filter((id) => kept.has(id)) };
      });
      return next({ state: 'split', decision, children });
    }
    default:
      return refused('unknown action', { action: decision.action as string });
  }
}

export function applyDecisions(batch: ReviewBatch, decisions: readonly ReviewDecision[]): ReviewBatch {
  return decisions.reduce((current, decision) => applyDecision(current, decision), batch);
}

export type ReviewSummary = {
  readonly total: number;
  readonly accepted: number;
  readonly edited: number;
  readonly overrides: number;
  readonly rejected: number;
  readonly deferred: number;
  readonly split: number;
  readonly pending: number;
  /** Accepted over decided, which is the number HITL is usually asked for. */
  readonly acceptRate: number;
  /** Edited over accepted: how often the proposer's wording survived contact. */
  readonly editRate: number;
  readonly medianElapsedMs: number;
};

export function summaryOf(batch: ReviewBatch): ReviewSummary {
  const states = batch.items.map((item) => item.state);
  const accepted = batch.items.filter((item) => item.state === 'accepted').length;
  const edited = batch.items.filter((item) => item.decision?.action === 'edit').length;
  const overrides = batch.items.filter((item) => item.decision?.action === 'override').length;
  const rejected = states.filter((state) => state === 'rejected').length;
  const deferred = states.filter((state) => state === 'deferred').length;
  const split = states.filter((state) => state === 'split').length;
  const decided = accepted + rejected + split;
  const durations = batch.items
    .map((item) => item.decision?.elapsedMs)
    .filter((value): value is number => value !== undefined)
    .sort((a, b) => a - b);
  const middle = Math.trunc(durations.length / 2);
  const medianElapsedMs =
    durations.length === 0
      ? 0
      : durations.length % 2 === 1
        ? (durations[middle] as number)
        : Math.round(((durations[middle - 1] as number) + (durations[middle] as number)) / 2);
  return {
    total: batch.items.length,
    accepted,
    edited,
    overrides,
    rejected,
    deferred,
    split,
    pending: states.filter((state) => state === 'pending').length,
    acceptRate: decided === 0 ? 0 : Number((accepted / decided).toFixed(4)),
    editRate: accepted === 0 ? 0 : Number((edited / accepted).toFixed(4)),
    medianElapsedMs,
  };
}

/**
 * The admitted guideline, shaped like every other write.
 *
 * Routed through `DistillCandidate` rather than through a privileged constructor on purpose:
 * a guideline then passes the same write admission, the same dedupe and the same scoring as
 * a distilled correction, so retrospection cannot become a back door into the store. What it
 * adds is lineage — `mergedFrom` names the sources it subsumes, and the evidence ref carries
 * their mean confidence rather than an invented one.
 */
export function toDistillCandidate(
  batch: ReviewBatch,
  item: ReviewItem,
  options: { readonly domain?: string; readonly decisionId: string },
): DistillCandidate {
  if (item.state !== 'accepted') {
    refused('only an accepted guideline can be admitted', { candidateId: item.proposal.id, state: item.state });
  }
  const decided = item.decision;
  // An accepted state with no decision is a corrupted ledger rather than an accepted card,
  // and admitting it would write a guideline with no reviewer and no time.
  if (decided === undefined) {
    refused('an accepted card carries a decision; this one does not', { candidateId: item.proposal.id });
  }
  // The card is re-judged on the text as accepted, not on the text the proposer wrote: an
  // edit can make an admissible guideline inadmissible (or the reverse), and the store must
  // not be reachable by a card whose current text nobody would have admitted. An override is
  // the one way past this, and it is on the record.
  const overridden = decided.action === 'override';
  const verdict = overridden
    ? undefined
    : verdictOf(item, batch.corpus, batch.policy);
  if (verdict !== undefined && verdict.state !== 'reviewable') {
    refused(`the accepted text is not admissible: ${verdict.state}`, {
      candidateId: item.proposal.id,
      sentence: verdict.sentence,
    });
  }
  const report = verdict?.report ?? witnessOf({ ...item.proposal, statement: item.text }, batch.corpus);
  const covered = report.findings
    .filter((finding) => finding.verdict === 'entailed')
    .map((finding) => finding.sourceId);
  const members = batch.corpus.filter((source) => covered.includes(source.id));
  const mean = members.length === 0 ? 0 : members.reduce((sum, member) => sum + member.confidence, 0) / members.length;
  const evidence: EvidenceRef = {
    feedbackId: options.decisionId,
    runId: batch.id,
    at: decided.at,
    weight: Number(mean.toFixed(4)),
    taskId: members[0]?.taskId ?? batch.id,
  };
  const digest = hashText(`${item.text}\u0000${item.proposal.when}`);
  return {
    namespace: batch.namespace,
    kind: 'procedure',
    scope: {
      task: members[0]?.task ?? 'unknown',
      ...(options.domain === undefined ? {} : { domain: options.domain }),
    },
    statement: item.text,
    when: item.proposal.when,
    payload: {
      mergedFrom: [...covered],
      support: covered.length,
      distinctTasks: new Set(members.map((member) => member.taskId)).size,
      reviewedBy: decided.reviewer,
      reviewAction: decided.action,
      batch: batch.id,
      guidelineHash: digest,
    },
    evidence,
    trust: Number(Math.min(0.99, 0.5 + 0.1 * covered.length).toFixed(4)),
    // A guideline is written from corrections by construction — the batch refuses to be built
    // without at least one — so its side is known rather than inferred, and recording it keeps a
    // guideline readable by the same reader that reads a distilled record.
    polarity: 'repair',
    // The trigger is part of the identity: two guidelines with one statement and different
    // conditions are two rules, and merging them would silently widen both.
    dedupeKey: `guideline:${digest}`,
  };
}
