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
} from '@agentix-e/microglia-core';
import type { DistillCandidate, KnowledgeItem } from '@agentix-e/microglia-core';
import {
  canGeneralize,
  mergeEvidence as mergeSiblingEvidence,
  pickGeneralizationTarget,
  withoutDomain,
} from './generalize.js';
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
      const candidate = sanitize(raw, options);
      if (!candidate) {
        report.rejectedUnsafe += 1;
        continue;
      }
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

  const siblings =
    options.generalize === false
      ? []
      : pool.filter((item) => item.status !== 'retired' && canGeneralize(item, candidate));
  const target = pickGeneralizationTarget(siblings);
  if (target !== undefined) {
    const scope = target.scope.domain === undefined ? target.scope : withoutDomain(target.scope);
    const mergedEvidence = mergeSiblingEvidence(siblings, candidate);
    const widened: KnowledgeItem = {
      ...target,
      id: target.scope.domain === undefined ? target.id : newId('k', now, options.random),
      scope,
      evidence: mergedEvidence.evidence,
      support: mergedEvidence.support,
      trust: Math.max(...siblings.map((item) => item.trust), candidate.trust),
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
    for (const sibling of siblings) {
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

/** Redact first, then screen. Screening a secret before removing it is pointless. */
function sanitize(candidate: DistillCandidate, options: DistillOptions): DistillCandidate | null {
  const statement = redact(candidate.statement).text;
  const findings = scanForInjection(statement);
  if (options.policy.rejectUnsafeKnowledge && hasHighSeverity(findings)) return null;

  const payload = candidate.payload === undefined ? undefined : redactJson(candidate.payload);
  return {
    ...candidate,
    statement,
    ...(payload === undefined ? {} : { payload }),
  };
}
