/**
 * Confidence-weighted reliability and calibrated abstention gate (R252).
 *
 * ## The negative effect this prevents
 *
 * R246-R251 gate what we store, whether a correction sticks, whether a revision reached every copy,
 * whether new evidence displaced the stale value, and whether a correctly retrieved lesson is the right
 * one to use. All of them stop at a *categorical* decision. But "Blind Faith" — treating every retrieved
 * item as equally trustworthy — is a separate failure: a stale, low-credibility or contradictory item is
 * shown with the same force as a fresh, sourced one, and an overconfident answer follows.
 *
 * MMA (arXiv 2602.16493, github.com/AIGeeksGroup/MMA) attacks this with a per-item reliability layer:
 * source credibility, temporal decay and conflict-aware consensus combine into a confidence score that
 * reweights evidence and, when support is insufficient, abstains. On FEVER it matches baseline accuracy
 * while cutting variance 35.2%; on MMA-Bench it reaches 41.18% Type-B accuracy where the baseline collapses
 * to 0.0%. This module reproduces that scoring and pins its abstention rule as a falsifiable verdict.
 *
 * ## The model (faithful to MMA confidence_module.py, compute_v2, tri mode)
 *
 * Three signals, each in [0, 1]:
 * - `S` source credibility: a closed mapping (knowledge 0.95, semantic 0.70, procedural 0.60,
 *   resource 0.60, episodic 0.50) from MMA's confidence_v2.yaml.
 * - `T` temporal decay: `0.5 ** (ageDays / halfLifeDays)`, MMA's half-life form of
 *   `exp(-ln2 * delta / halfLife)`.
 * - `C` conflict-aware signed consensus: weighted mean of `neighbor.confidence * neighbor.support`,
 *   support in [-1, 1] (positive reinforces, negative contradicts), clamped to [-1, 1]. No neighbors
 *   yields 0, matching MMA's empty-neighborhood consensus.
 *
 * The final confidence is the self-normalising weighted sum, floored at zero:
 *   `C = max(0, (w_s*S + w_t*T + w_c*Csigned) / (w_s + w_t + w_c))`
 * MMA clamps to [0, 1]. Because weights are non-negative and every signal is bounded, the sum is
 * provably <= 1 (attained only when every signal is 1), so the upper clamp is unreachable dead code
 * and is removed; a negative consensus can pull the numerator below zero, so the lower floor is kept
 * and exercised. For the same reason the consensus weighted mean is already within [-1, 1] (each
 * confidence*support is in [-1, 1] and weights are positive), so no clamp is applied there.
 *
 * ## Disposition ladder (strict priority, per item)
 *
 * 1. `C < abstainBelow` and consensus < 0 -> `abstain` / `conflict-overwhelms` — a contradictory
 *    neighborhood the score cannot outvote; withhold before use.
 * 2. `C < abstainBelow` -> `abstain` / `below-threshold` — support insufficient, abstain.
 * 3. `C < reweightBelow` -> `reweight` / `marginal` — usable but discounted.
 * 4. otherwise -> `admit` / `reliable`.
 *
 * The set verdict is the strictest disposition present (abstain > reweight > admit); reason and
 * `decidingId` name the most severe item, first wins a tie. Counts partition the item total.
 *
 * ## Discipline
 *
 * Pure and deterministic; no clock, no network, no model, zero cost. `decidingScoreMilli` is the deciding
 * item's confidence in integer thousandths so the product and the independent Python reader compare
 * integers, not floats. Every guard refuses rather than defaults.
 */
import { MicrogliaError } from '../kernel/index.js';

/** Closed, ordered vocabulary of a memory's source credibility class (MMA confidence_v2.yaml). */
export const CONFIDENCE_SOURCES = ['knowledge', 'semantic', 'procedural', 'resource', 'episodic'] as const;
export type ConfidenceSource = (typeof CONFIDENCE_SOURCES)[number];

/** Closed, ordered vocabulary of per-item dispositions. */
export const CONFIDENCE_DISPOSITIONS = ['admit', 'reweight', 'abstain'] as const;
export type ConfidenceDisposition = (typeof CONFIDENCE_DISPOSITIONS)[number];

/** Closed, ordered vocabulary of reasons, ordered by severity (least to most strict). */
export const CONFIDENCE_REASONS = ['reliable', 'marginal', 'below-threshold', 'conflict-overwhelms'] as const;
export type ConfidenceReason = (typeof CONFIDENCE_REASONS)[number];

/** MMA's source credibility priors, from confidence_v2.yaml. */
export const SOURCE_CREDIBILITY: Readonly<Record<ConfidenceSource, number>> = {
  knowledge: 0.95,
  semantic: 0.7,
  procedural: 0.6,
  resource: 0.6,
  episodic: 0.5,
};

export type ConfidenceWeights = {
  readonly source: number;
  readonly time: number;
  readonly consensus: number;
};

export type ConsensusNeighbor = {
  readonly weight: number;
  readonly confidence: number;
  readonly support: number;
};

export type ConfidenceItem = {
  readonly id: string;
  readonly source: ConfidenceSource;
  readonly ageDays: number;
  readonly neighbors: readonly ConsensusNeighbor[];
};

export type MemoryConfidenceInput = {
  readonly id: string;
  readonly weights: ConfidenceWeights;
  readonly halfLifeDays: number;
  readonly abstainBelow: number;
  readonly reweightBelow: number;
  readonly items: readonly ConfidenceItem[];
};

export type MemoryConfidence = {
  readonly id: string;
  readonly verdict: ConfidenceDisposition;
  readonly reason: ConfidenceReason;
  readonly decidingId: string;
  readonly decidingScoreMilli: number;
  readonly itemCount: number;
  readonly admitCount: number;
  readonly reweightCount: number;
  readonly abstainCount: number;
};

const SOURCE_SET = new Set<string>(CONFIDENCE_SOURCES);

/** Higher is stricter; used to name the decisive item of a set. */
const REASON_SEVERITY: Readonly<Record<ConfidenceReason, number>> = {
  reliable: 0,
  marginal: 1,
  'below-threshold': 2,
  'conflict-overwhelms': 3,
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

type ItemReading = {
  disposition: ConfidenceDisposition;
  reason: ConfidenceReason;
  scoreMilli: number;
  signedConsensus: number;
};

/** Per-item signals and ladder, kept separate from guards so the decision rule is auditable on its own. */
function readItem(
  item: ConfidenceItem,
  weights: ConfidenceWeights,
  halfLifeDays: number,
  abstainBelow: number,
  reweightBelow: number,
): ItemReading {
  const source = SOURCE_CREDIBILITY[item.source] as number;
  const time = Math.pow(0.5, item.ageDays / halfLifeDays);

  let signedConsensus = 0;
  if (item.neighbors.length > 0) {
    let weighted = 0;
    let totalWeight = 0;
    for (const neighbor of item.neighbors) {
      weighted += neighbor.weight * neighbor.confidence * neighbor.support;
      totalWeight += neighbor.weight;
    }
    signedConsensus = weighted / totalWeight;
  }

  const total = weights.source + weights.time + weights.consensus;
  const confidence = Math.max(
    0,
    (weights.source * source + weights.time * time + weights.consensus * signedConsensus) / total,
  );

  let disposition: ConfidenceDisposition;
  let reason: ConfidenceReason;
  if (confidence < abstainBelow && signedConsensus < 0) {
    disposition = 'abstain';
    reason = 'conflict-overwhelms';
  } else if (confidence < abstainBelow) {
    disposition = 'abstain';
    reason = 'below-threshold';
  } else if (confidence < reweightBelow) {
    disposition = 'reweight';
    reason = 'marginal';
  } else {
    disposition = 'admit';
    reason = 'reliable';
  }

  return { disposition, reason, scoreMilli: Math.round(confidence * 1000), signedConsensus };
}

/**
 * Score retrieved memories and decide which may be admitted, reweighted, or abstained from.
 */
export function memoryConfidence(input: MemoryConfidenceInput): MemoryConfidence {
  if (typeof input.id !== 'string' || input.id.trim() === '') {
    throw new MicrogliaError('MG_E_CONFIG', 'episode id must be a non-blank string', { id: input.id });
  }

  const weights = input.weights;
  if (typeof weights !== 'object' || weights === null || Array.isArray(weights)) {
    throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': weights must be an object`, { id: input.id });
  }
  if (
    !isFiniteNumber(weights.source) || weights.source < 0 ||
    !isFiniteNumber(weights.time) || weights.time < 0 ||
    !isFiniteNumber(weights.consensus) || weights.consensus < 0
  ) {
    throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': weights must be non-negative finite`, {
      id: input.id,
    });
  }
  if (weights.source + weights.time + weights.consensus <= 0) {
    throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': weights must not all be zero`, {
      id: input.id,
    });
  }

  if (!isFiniteNumber(input.halfLifeDays) || input.halfLifeDays <= 0) {
    throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': halfLifeDays must be positive finite`, {
      id: input.id,
    });
  }
  if (!isFiniteNumber(input.abstainBelow) || input.abstainBelow < 0 || input.abstainBelow > 1) {
    throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': abstainBelow must be within [0, 1]`, {
      id: input.id,
    });
  }
  if (
    !isFiniteNumber(input.reweightBelow) ||
    input.reweightBelow < input.abstainBelow ||
    input.reweightBelow > 1
  ) {
    throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': reweightBelow must be within [abstainBelow, 1]`, {
      id: input.id,
    });
  }

  if (!Array.isArray(input.items)) {
    throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': items must be an array`, { id: input.id });
  }
  if (input.items.length === 0) {
    throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': items must not be empty`, { id: input.id });
  }

  const seen = new Set<string>();
  let admitCount = 0;
  let reweightCount = 0;
  let abstainCount = 0;
  let verdict: ConfidenceDisposition = 'admit';
  let reason: ConfidenceReason = 'reliable';
  let decidingId = '';
  let decidingScoreMilli = -1;
  let decidingSeverity = -1;

  for (const item of input.items) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': every item must be an object`, {
        id: input.id,
      });
    }
    if (typeof item.id !== 'string' || item.id.trim() === '') {
      throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': item id must be non-blank`, { id: input.id });
    }
    if (seen.has(item.id)) {
      throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': duplicate item id '${item.id}'`, {
        id: input.id,
        itemId: item.id,
      });
    }
    seen.add(item.id);
    if (typeof item.source !== 'string' || !SOURCE_SET.has(item.source)) {
      throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': unknown source '${item.source}'`, {
        id: input.id,
        itemId: item.id,
      });
    }
    if (!isFiniteNumber(item.ageDays) || item.ageDays < 0) {
      throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': ageDays must be non-negative finite`, {
        id: input.id,
        itemId: item.id,
      });
    }
    if (!Array.isArray(item.neighbors)) {
      throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': neighbors must be an array`, {
        id: input.id,
        itemId: item.id,
      });
    }
    for (const neighbor of item.neighbors) {
      if (typeof neighbor !== 'object' || neighbor === null || Array.isArray(neighbor)) {
        throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': every neighbor must be an object`, {
          id: input.id,
          itemId: item.id,
        });
      }
      if (!isFiniteNumber(neighbor.weight) || neighbor.weight <= 0) {
        throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': neighbor weight must be positive finite`, {
          id: input.id,
          itemId: item.id,
        });
      }
      if (!isFiniteNumber(neighbor.confidence) || neighbor.confidence < 0 || neighbor.confidence > 1) {
        throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': neighbor confidence must be within [0, 1]`, {
          id: input.id,
          itemId: item.id,
        });
      }
      if (!isFiniteNumber(neighbor.support) || neighbor.support < -1 || neighbor.support > 1) {
        throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': neighbor support must be within [-1, 1]`, {
          id: input.id,
          itemId: item.id,
        });
      }
    }

    const reading = readItem(item, weights, input.halfLifeDays, input.abstainBelow, input.reweightBelow);
    if (reading.disposition === 'admit') admitCount += 1;
    else if (reading.disposition === 'reweight') reweightCount += 1;
    else abstainCount += 1;

    const severity = REASON_SEVERITY[reading.reason];
    if (severity > decidingSeverity) {
      decidingSeverity = severity;
      decidingId = item.id;
      decidingScoreMilli = reading.scoreMilli;
      reason = reading.reason;
      verdict = reading.disposition;
    }
  }

  return {
    id: input.id,
    verdict,
    reason,
    decidingId,
    decidingScoreMilli,
    itemCount: input.items.length,
    admitCount,
    reweightCount,
    abstainCount,
  };
}
