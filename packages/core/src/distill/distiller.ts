/**
 * Domain-blind distillation.
 *
 * The three outcomes of one claim are explicit and counted: created, merged
 * (same claim, more evidence), generalised (same claim, one fewer scope
 * dimension). Anything else is rejected and the reason is counted too, because
 * a flywheel that silently drops input cannot be debugged.
 */
import {
  createKnowledgeItem,
  dedupeKeyOf,
  hasHighSeverity,
  jsonEqual,
  recordContradiction,
  scopeKey,
  mergeEvidence as mergeItemEvidence,
  newId,
  redact,
  redactJson,
  scanForInjection,
  scoreKnowledge,
  decideStatus,
} from '../kernel/index.js';
import { tierFor } from '../kernel/index.js';
import type { DistillCandidate, FeedbackEvent, KnowledgeItem } from '../kernel/index.js';
import { generalizationPlan, mergeEvidence as mergeSiblingEvidence } from './generalize.js';
import type { DistillOptions, DistillReport, InterpretContext } from './types.js';

export async function distill(options: DistillOptions): Promise<DistillReport> {
  const events = await options.memory.listEvents({
    since: options.since ?? 0,
    ...(options.limit === undefined ? {} : { limit: options.limit }),
  });

  const report = {
    events: events.length,
    candidates: 0,
    created: 0,
    merged: 0,
    generalized: 0,
    superseded: 0,
    contradicted: 0,
    quarantined: 0,
    rejectedUnsafe: 0,
    rejectedBorrowed: 0,
    rejectedByHost: 0,
    failed: 0,
  };

  for (const event of events) {
    const run = await options.memory.getRun(event.runId);
    const context: InterpretContext = { event, run };
    let candidates: readonly DistillCandidate[];
    try {
      candidates = await options.interpreter(context);
    } catch (error) {
      // An interpreter is host code: a model call, a parser, a domain pack. One
      // unparseable response is a fact to count, not a reason to lose the rest of
      // the batch; a host that wants the old behaviour passes `strict`.
      if (options.strict === true) throw error;
      report.failed += 1;
      continue;
    }
    for (const raw of candidates) {
      report.candidates += 1;
      const screened = sanitize({ ...raw, tier: raw.tier ?? tierFor(event.kind) }, options, event);
      if (!screened.ok) {
        if (screened.reason === 'borrowed') report.rejectedBorrowed += 1;
        else report.rejectedUnsafe += 1;
        continue;
      }
      const candidate = screened.candidate;
      if (options.accept && !options.accept(candidate)) {
        report.rejectedByHost += 1;
        continue;
      }
      const result = await upsert(options, candidate);
      report[result.outcome] += 1;
      report.superseded += result.superseded;
      report.contradicted += result.contradicted;
    }
  }

  return report;
}

type UpsertOutcome = 'created' | 'merged' | 'generalized' | 'quarantined';

type UpsertResult = {
  readonly outcome: UpsertOutcome;
  readonly superseded: number;
  readonly contradicted: number;
};

async function upsert(options: DistillOptions, candidate: DistillCandidate): Promise<UpsertResult> {
  const now = options.clock.now();
  const pool = await options.memory.listKnowledge({
    namespace: candidate.namespace,
    task: candidate.scope.task,
    status: 'all',
  });

  const contradicted =
    options.resolveContradictions === false
      ? 0
      : await contradictSameScope(pool, candidate, options, now);

  const key = dedupeKeyOf(candidate);
  const exact = pool.find((item) => dedupeKeyOf(item) === key && item.status !== 'retired');
  if (exact) {
    const merged = mergeItemEvidence(exact, candidate, options.policy, now);
    await options.memory.putKnowledge(merged);
    return {
      outcome: merged.status === 'quarantined' ? 'quarantined' : 'merged',
      superseded: 0,
      contradicted,
    };
  }

  const plan = options.generalize === false ? undefined : generalizationPlan(pool, candidate);
  if (plan !== undefined) {
    const { target, scope, endorsers } = plan;
    const mergedEvidence = mergeSiblingEvidence(endorsers, candidate);
    const widened: KnowledgeItem = {
      ...target,
      id: target.scope.domain === undefined ? target.id : newId('k', now, options.random),
      scope,
      evidence: mergedEvidence.evidence,
      support: mergedEvidence.support,
      trust: Math.max(...endorsers.map((item) => item.trust), candidate.trust),
      status: target.scope.domain === undefined ? target.status : 'candidate',
      updatedAt: now,
    };
    const confidence = scoreKnowledge(widened, options.policy, now);
    const decision = decideStatus({ ...widened, confidence }, options.policy, now);
    const finalItem: KnowledgeItem = {
      ...widened,
      confidence: decision.confidence,
      status: decision.status,
      statusReason: decision.reason,
    };
    await options.memory.putKnowledge(finalItem);

    let superseded = 0;
    for (const sibling of endorsers) {
      if (sibling.id === finalItem.id) continue;
      await options.memory.putKnowledge({
        ...sibling,
        status: 'retired',
        statusReason: `generalized:${finalItem.id}`,
        systemUntil: now,
        updatedAt: now,
      });
      superseded += 1;
    }
    // The target is active by construction, so the widened item cannot be
    // quarantined: `decideStatus` only quarantines an already-quarantined item.
    return { outcome: 'generalized', superseded, contradicted };
  }

  const item = createKnowledgeItem(candidate, options.policy, now, newId('k', now, options.random));
  await options.memory.putKnowledge(item);
  return {
    outcome: item.status === 'quarantined' ? 'quarantined' : 'created',
    superseded: 0,
    contradicted,
  };
}

/**
 * A trusted correction that contradicts an active rule in the *same* scope is
 * evidence against that rule, not a second rule to run in parallel.
 *
 * Different scopes are not contradictions: a domain-specific exception is
 * supposed to disagree with the general rule, and specificity resolves it at
 * read time. Same scope with a different payload is a genuine conflict, and the
 * older item is demoted so the pack cannot contain two active answers.
 */
async function contradictSameScope(
  pool: readonly KnowledgeItem[],
  candidate: DistillCandidate,
  options: DistillOptions,
  now: number,
): Promise<number> {
  if (candidate.trust < options.policy.singleObservationTrust) return 0;
  const key = scopeKey(candidate.scope);
  let count = 0;
  for (const item of pool) {
    if (item.status !== 'active') continue;
    if (item.kind !== candidate.kind) continue;
    if (scopeKey(item.scope) !== key) continue;
    if (jsonEqual(item.payload ?? null, candidate.payload ?? null)) continue;
    const next = recordContradiction(item, candidate.evidence.weight, options.policy, now);
    await options.memory.putKnowledge(next);
    count += 1;
  }
  return count;
}

type ScreenResult =
  | { readonly ok: true; readonly candidate: DistillCandidate }
  | { readonly ok: false; readonly reason: 'unsafe' | 'borrowed' };

/**
 * Redact first, then screen. Screening a secret before removing it is pointless.
 *
 * The last check is provenance, and it is a rejection rather than a correction:
 * a candidate must cite the event that produced it. An interpreter is host code
 * — a model, a domain pack, a parser — so a claim citing *someone else's*
 * feedback id is a claim buying support it did not earn. Re-binding the id here
 * would erase the only evidence that the interpreter misbehaved.
 */
function sanitize(
  candidate: DistillCandidate,
  options: DistillOptions,
  event: FeedbackEvent,
): ScreenResult {
  if (
    candidate.evidence.feedbackId !== event.id ||
    candidate.evidence.runId !== event.runId
  ) {
    return { ok: false, reason: 'borrowed' };
  }
  const statement = redact(candidate.statement).text;
  const findings = scanForInjection(statement);
  if (options.policy.rejectUnsafeKnowledge && hasHighSeverity(findings)) {
    return { ok: false, reason: 'unsafe' };
  }
  const payload = candidate.payload === undefined ? undefined : redactJson(candidate.payload);
  return {
    ok: true,
    candidate: {
      ...candidate,
      statement,
      ...(payload === undefined ? {} : { payload }),
    },
  };
}
