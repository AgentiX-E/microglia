/**
 * Whether the pack speaks at all.
 *
 * Every arm in this record before R123 served the pack on **every** request. `served 162 of 162` was
 * read as a coverage figure and it is not one: `buildPack` keeps every hit when the floor is 0, and a
 * registration that names no floor emits 0, so no request was ever *able* to be refused. The
 * retention curve on the same 650 pairs says what that default costs a reader — 0.05 still serves
 * 162, 0.10 serves 154 and empties 8, **0.15 serves 75 and empties 87**, 0.20 serves 36. The first
 * rung that withholds anything withholds more than half the traffic, which is why a relevance floor
 * has never been a usable way to ask this question: it is a cliff, not a decision.
 *
 * The question underneath is different from every gate the pack already carries.
 *
 *   - `minCoverage` asks *does this rule mention the question*.
 *   - `minEvidence` asks *was this rule observed enough*.
 *   - `speakMargin` asks *does the store have an answer, or does it have several*.
 *
 * The third question is about the **shape of the ranking**, not about any single item, and it is the
 * one the published read-time result points at: memory injected into a request it does not answer
 * produces 35-81% unsafe actions against ≈0 without it (arXiv 2611.07554), and the ablation's
 * strongest models express that gap as abstention rather than error. A store whose top two candidates
 * tie has not decided which answer it holds, and serving it teaches the model a rule the store itself
 * does not prefer.
 *
 * ## Why the margin is measured over the candidates, not over the pack
 *
 * `limit` is the host's room, not the store's confidence: a request whose eighth candidate is its
 * second-best answer still has a leader, and a request whose pack was cut to one line still had a
 * contested ranking behind it. Measuring the margin after the cut would let a small budget manufacture
 * a leader, which is the same defect as reading a default as a measurement.
 *
 * ## Why the silence is a named state
 *
 * `silentBecause` is a union of five words rather than a boolean, because "the pack is empty" has five
 * causes and only one of them is the store's: it matched nothing, nothing covered the question,
 * nothing was corroborated, the host asked for no room, or the top of the ranking was contested. A
 * host that cannot tell them apart lowers thresholds until the noise returns — the failure
 * `suppressed` was introduced for, now carried per request instead of per host.
 */
import type { SpeakDecision, SpeakSilence } from '../kernel/index.js';

export type SpeakInput = {
  /** Candidates the store returned. */
  readonly candidates: number;
  /** Candidates that survived the coverage floor. */
  readonly afterCoverage: number;
  /** Candidates that survived the corroboration floor. */
  readonly afterEvidence: number;
  /** Candidates the host's room carried. */
  readonly selected: number;
  /** Relevance of every candidate that cleared both floors; order is irrelevant. */
  readonly scores: readonly number[];
  /**
   * How far ahead of its runner-up a top candidate must be to speak. Zero — the default — speaks on
   * every non-empty pack, which is the behaviour every committed artefact measured.
   */
  readonly speakMargin: number;
};

/**
 * Reduce the pack's own population to the decision it made.
 *
 * Pure, so the gate can be replayed against a recorded census without a store, and so the arm that
 * measures and the arm that does not are provably the same arm.
 */
export function decideSpeak(input: SpeakInput): SpeakDecision {
  // Descending, and computed on a copy: the caller's candidate order is the retrieval's, and a census
  // that reordered it in place would be the second time this record let an instrument move a pack.
  const ranked = [...input.scores].sort((left, right) => right - left);
  const topScore = ranked[0] ?? null;
  const runnerUpScore = ranked[1] ?? null;
  const margin = topScore === null || runnerUpScore === null ? null : topScore - runnerUpScore;
  const silentBecause = silenceOf(input, margin);

  return {
    candidates: input.candidates,
    afterCoverage: input.afterCoverage,
    afterEvidence: input.afterEvidence,
    belowCoverage: input.candidates - input.afterCoverage,
    belowEvidence: input.afterCoverage - input.afterEvidence,
    overLimit: input.afterEvidence - input.selected,
    topScore,
    runnerUpScore,
    margin,
    spoke: silentBecause === null,
    silentBecause,
  };
}

/**
 * The first gate that removed everything, in the order the gates run.
 *
 * The order is the design: each state names the gate that emptied the pack, so a silence is
 * attributable to one cause rather than to "the pack came back empty". A candidate removed by the
 * corroboration floor was *covered* — reporting it as uncovered would send a reader to the wrong knob.
 */
function silenceOf(input: SpeakInput, margin: number | null): SpeakSilence | null {
  if (input.candidates === 0) return 'nothing-matched';
  if (input.afterCoverage === 0) return 'nothing-covered';
  if (input.afterEvidence === 0) return 'nothing-corroborated';
  if (input.selected === 0) return 'nothing-selected';
  // A single candidate has no rival, and nothing contested it: `margin` is null and the pack speaks.
  // The gate is therefore about *contested* rankings only, and it is strict — a margin equal to the
  // floor speaks, so a registration that names 0 keeps every pack.
  if (margin !== null && margin < input.speakMargin) return 'no-leader';
  return null;
}

/**
 * The `suppressed` reason a silent pack carries, when its silence was deliberate.
 *
 * Three of the five are not suppressions. An empty store and an uncovered question are retrieval
 * results, and a host that read them as a deliberate silence would be told to fix a threshold that is
 * working. A host that asked for no room got what it asked for. The other two are decisions the
 * memory made on the host's behalf: the corroboration floor (`uncorroborated-store`, the word
 * `capture` already writes) and a contested ranking (`no-leader`, the state this gate adds).
 */
export function suppressionOf(
  silentBecause: SpeakSilence | null,
): 'uncorroborated-store' | 'no-leader' | undefined {
  if (silentBecause === 'nothing-corroborated') return 'uncorroborated-store';
  if (silentBecause === 'no-leader') return 'no-leader';
  return undefined;
}
