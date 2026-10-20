/**
 * Integrity checks a host can run in CI or on a cron.
 *
 * The failure modes that matter are not crashes; they are quiet ones: an active
 * rule that cites evidence no longer in the journal, a rule below the threshold
 * that is still being injected, or a store that has stopped learning. `doctor`
 * names them so a dashboard can alert on a number instead of a feeling.
 */
import { scoreKnowledge } from '@agentix-e/microglia-core';
import type { Policy } from '@agentix-e/microglia-core';
import type { MemoryPort } from '@agentix-e/microglia-memory';
import type { Diagnosis, DiagnosisIssue } from './options.js';

export type DoctorOptions = {
  readonly memory: MemoryPort;
  readonly namespace: string;
  readonly policy: Policy;
  readonly now: number;
};

export async function diagnose(options: DoctorOptions): Promise<Diagnosis> {
  const stats = await options.memory.stats();
  const items = await options.memory.listKnowledge({ namespace: options.namespace, status: 'all' });
  const events = await options.memory.listEvents({ namespace: options.namespace });
  const eventIds = new Set(events.map((event) => event.id));
  const issues: DiagnosisIssue[] = [];

  const orphaned = items.filter((item) =>
    item.evidence.some((entry) => !eventIds.has(entry.feedbackId)),
  );
  if (orphaned.length > 0) {
    issues.push({
      code: 'MG_D_ORPHAN_EVIDENCE',
      severity: 'error',
      detail: 'Knowledge cites feedback that is not in the journal',
      ids: orphaned.map((item) => item.id),
    });
  }

  const unsupported = items.filter(
    (item) => item.status === 'active' && item.support < options.policy.minSupport,
  );
  if (unsupported.length > 0) {
    issues.push({
      code: 'MG_D_ACTIVE_WITHOUT_SUPPORT',
      severity: 'error',
      detail: 'Active knowledge is below the evidence floor',
      ids: unsupported.map((item) => item.id),
    });
  }

  const belowThreshold = items.filter(
    (item) =>
      item.status === 'active' &&
      scoreKnowledge(item, options.policy, options.now) < options.policy.activationThreshold,
  );
  if (belowThreshold.length > 0) {
    issues.push({
      code: 'MG_D_ACTIVE_BELOW_THRESHOLD',
      severity: 'warn',
      detail: 'Active knowledge scores below the activation threshold at the current clock',
      ids: belowThreshold.map((item) => item.id),
    });
  }

  const quarantined = items.filter((item) => item.status === 'quarantined');
  if (items.length > 0 && quarantined.length / items.length > 0.4) {
    issues.push({
      code: 'MG_D_HIGH_QUARANTINE',
      severity: 'warn',
      detail: 'More than 40% of knowledge is quarantined; check source trust',
      ids: quarantined.map((item) => item.id),
    });
  }

  const conflicted = items.filter((item) => item.status === 'conflicted');
  if (conflicted.length > 0) {
    issues.push({
      code: 'MG_D_CONFLICTED',
      severity: 'warn',
      detail: 'Contradictory corrections are waiting for adjudication',
      ids: conflicted.map((item) => item.id),
    });
  }

  if (items.length === 0 && events.length > 0) {
    issues.push({
      code: 'MG_D_NO_KNOWLEDGE',
      severity: 'info',
      detail: 'Feedback exists but no knowledge has been distilled yet',
    });
  }

  return {
    ok: issues.every((issue) => issue.severity !== 'error'),
    issues,
    stats,
  };
}
