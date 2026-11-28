/**
 * Competition-domain gate: decide which field a system or leaderboard belongs to, so microglia competes only where
 * it should (R248).
 *
 * ## The category error this prevents
 *
 * microglia ships a headless library that turns a host's corrections into scoped knowledge and injects the result
 * into that host's prompt. It is a memory capability amplifier, not a text-to-SQL, charting or data-visualisation
 * product. Those domains belong to `AgentiX-E/nl2charts`, which owns the core NL/SQL/chart function; microglia must
 * stay decoupled from them. Yet a leaderboard row can be quoted as "a competitor" simply because it is a headline
 * number in a document that also mentions memory. Reading an NL2SQL execution-accuracy score as a microglia target
 * is a category error: it measures the host's vertical task, not the value of the memory layer.
 *
 * The user's standing instruction (R248) makes this a first-class boundary:
 *  - microglia competes in **memory-augmented task success** — does a memory layer raise success, at what cost?
 *  - `nl2charts` competes in NL2SQL / text2charts / data2charts — microglia is only its amplifier there.
 *
 * ## The deciding question
 *
 * Not the system's name, and not the benchmark's prestige: **the unit of the number**. A number obtained by
 * comparing memory-on against memory-off is a memory-domain measurement, wherever it was taken — even inside a SQL
 * host, where it makes microglia the amplifier. An absolute score on a host task (BIRD EX, chart accuracy) is a
 * host-domain measurement; it belongs to nl2charts, not to this project. When the unit is unknown, the label
 * signals are consulted — and a tie (both memory and host signals) is declared `ambiguous`, never auto-assigned.
 * Refusing to guess on a tie is the whole point: an auto-assignment would recreate the category error this module
 * exists to stop.
 *
 * ## Discipline
 *
 * Pure and deterministic; no clock, no network, no model. Every guard refuses rather than defaults — a blank name
 * or an unknown artifact would otherwise quietly land in "other" and look like an honest classification. The module
 * classifies a *description*; it does not fetch or score any system. A caller supplies the measured unit and the
 * signal labels it actually used, and this function reports the field that number is admissible in.
 */
import { MicrogliaError } from '../kernel/index.js';

/** The closed, ordered vocabulary of domain verdicts. */
export const DOMAIN_VERDICTS = ['memory', 'host', 'ambiguous', 'other'] as const;
export type DomainVerdict = (typeof DOMAIN_VERDICTS)[number];

/** The closed, ordered vocabulary of reasons. */
export const DOMAIN_REASONS = [
  'measured-memory-gain',
  'memory-benchmark',
  'host-task-score',
  'host-artifact',
  'mixed-signals',
  'no-signal',
] as const;
export type DomainReason = (typeof DOMAIN_REASONS)[number];

/** The unit a reported number was measured in. The primary decision input. */
export const DOMAIN_UNITS = ['memory-gain', 'absolute-task-score', 'unknown'] as const;
export type DomainUnit = (typeof DOMAIN_UNITS)[number];

/** Artifact kinds that are unambiguously a host product, not a memory pack. */
export const HOST_ARTIFACTS = ['sql-query', 'chart', 'visualization'] as const;
export type HostArtifact = (typeof HOST_ARTIFACTS)[number];

export const DOMAIN_ARTIFACTS = ['memory-pack', ...HOST_ARTIFACTS, 'report', 'other'] as const;
export type DomainArtifact = (typeof DOMAIN_ARTIFACTS)[number];

/**
 * Signal labels, normalised to lower case before matching. Deliberately explicit and closed: a label that is not in
 * either set is ignored (reported as neither signal), which is honest — an unknown label carries no evidence.
 */
const MEMORY_SIGNALS = new Set([
  'longmemeval',
  'locomo',
  'memoryagentbench',
  'beam',
  'dolphinbench',
  'ama-bench',
  'memory-recall',
  'cross-session-recall',
  'episodic-memory',
  'semantic-memory',
  'knowledge-update',
  'temporal-reasoning',
]);
const HOST_SIGNALS = new Set([
  'bird-ex',
  'spider-ex',
  'nl2sql-ex',
  'text2sql-ex',
  'chart-accuracy',
  'data2chart',
  'execution-accuracy',
  'schema-linking',
]);
const HOST_ARTIFACT_SET = new Set<string>(HOST_ARTIFACTS);
const ARTIFACT_SET = new Set<string>(DOMAIN_ARTIFACTS);
const UNIT_SET = new Set<string>(DOMAIN_UNITS);

export type DomainCandidate = {
  readonly name: string;
  readonly measures: readonly string[];
  readonly artifact: DomainArtifact;
  readonly unit: DomainUnit;
};

export type DomainClassification = {
  readonly verdict: DomainVerdict;
  readonly reason: DomainReason;
  /** True only when a memory gain was measured inside a host scenario: microglia is the amplifier, not the vendor. */
  readonly amplifierRole: boolean;
  readonly name: string;
  readonly unit: DomainUnit;
  readonly memorySignals: number;
  readonly hostSignals: number;
};

/**
 * Classify the field a measured number is admissible in.
 *
 * The unit decides first; signal counts are a fallback only when the unit is unknown. Host artifacts are read as a
 * host signal so a chart/SQL deliverable cannot be mistaken for a memory product just because its labels are sparse.
 */
export function classifyCompetitionDomain(candidate: DomainCandidate): DomainClassification {
  if (typeof candidate.name !== 'string' || candidate.name.trim() === '') {
    throw new MicrogliaError('MG_E_CONFIG', 'candidate name must be a non-blank string', {
      name: candidate.name,
    });
  }
  if (!Array.isArray(candidate.measures)) {
    throw new MicrogliaError('MG_E_CONFIG', `candidate '${candidate.name}': measures must be an array`, {
      name: candidate.name,
    });
  }
  for (const label of candidate.measures) {
    if (typeof label !== 'string') {
      throw new MicrogliaError('MG_E_CONFIG', `candidate '${candidate.name}': measure labels must be strings`, {
        name: candidate.name,
      });
    }
  }
  if (typeof candidate.artifact !== 'string' || !ARTIFACT_SET.has(candidate.artifact)) {
    throw new MicrogliaError(
      'MG_E_CONFIG',
      `candidate '${candidate.name}': unknown artifact '${candidate.artifact}'`,
      { name: candidate.name, artifact: candidate.artifact },
    );
  }
  if (typeof candidate.unit !== 'string' || !UNIT_SET.has(candidate.unit)) {
    throw new MicrogliaError('MG_E_CONFIG', `candidate '${candidate.name}': unknown unit '${candidate.unit}'`, {
      name: candidate.name,
      unit: candidate.unit,
    });
  }

  let memorySignals = 0;
  let hostMeasureSignals = 0;
  for (const raw of candidate.measures) {
    const label = raw.toLowerCase();
    if (MEMORY_SIGNALS.has(label)) memorySignals += 1;
    if (HOST_SIGNALS.has(label)) hostMeasureSignals += 1;
  }
  const hostArtifact = HOST_ARTIFACT_SET.has(candidate.artifact);
  // The reported total includes the artifact; the reason distinguishes a measured host score from a host-shaped
  // deliverable so a chart/SQL artifact without a host benchmark label is still named honestly.
  const hostSignals = hostMeasureSignals + (hostArtifact ? 1 : 0);

  let verdict: DomainVerdict;
  let reason: DomainReason;
  let amplifierRole = false;

  if (candidate.unit === 'memory-gain') {
    // A memory-on/off gain is microglia's unit wherever it was measured. Inside a host scenario the role is
    // amplifier: the host owns the core function, microglia supplies the memory layer.
    verdict = 'memory';
    reason = 'measured-memory-gain';
    amplifierRole = hostArtifact || hostMeasureSignals > 0;
  } else if (candidate.unit === 'absolute-task-score') {
    if (hostMeasureSignals > 0) {
      verdict = 'host';
      reason = 'host-task-score';
    } else if (hostArtifact) {
      verdict = 'host';
      reason = 'host-artifact';
    } else if (memorySignals > 0) {
      verdict = 'memory';
      reason = 'memory-benchmark';
    } else {
      verdict = 'other';
      reason = 'no-signal';
    }
  } else if (memorySignals > 0 && hostSignals > 0) {
    verdict = 'ambiguous';
    reason = 'mixed-signals';
  } else if (memorySignals > 0) {
    verdict = 'memory';
    reason = 'memory-benchmark';
  } else if (hostSignals > 0) {
    verdict = 'host';
    reason = hostMeasureSignals > 0 ? 'host-task-score' : 'host-artifact';
  } else {
    verdict = 'other';
    reason = 'no-signal';
  }

  return {
    verdict,
    reason,
    amplifierRole,
    name: candidate.name,
    unit: candidate.unit,
    memorySignals,
    hostSignals,
  };
}
