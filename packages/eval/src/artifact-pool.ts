/**
 * The recorded pool, read back out of an artefact.
 *
 * The artefact is the only place a past run's candidates exist, and two commands now want them: the
 * pool description and the signal gate. A reader copied into each of them is two readers that can
 * disagree about the same file — the first version of this lane recomputed the question shape in one
 * command with a private copy of the regular expressions, which is a second definition of the
 * question's intent waiting to drift from the first.
 *
 * So the reading lives here once, and the commands print what it returns.
 */

import { shapeOf, type ExecSignature } from './exec-signature.js';
import type { PoolCandidate, PoolQuestion } from './pool.js';

/** One candidate exactly as the artefact recorded it. */
export type ArtifactPoolCandidate = {
  readonly draw: number;
  readonly correct: boolean;
  readonly resultKey: number;
  readonly signature: ExecSignature | null;
};

/** One case of `per_case`, with only the fields the pool needs. */
export type ArtifactPoolCase = {
  readonly id: string;
  readonly question: string;
  readonly evidence?: string;
  readonly pool: readonly ArtifactPoolCandidate[] | null;
};

export type ArtifactPool = {
  readonly questions: readonly PoolQuestion[];
  readonly draws: number;
};

/**
 * Draws the run took, read from the arm names.
 *
 * The pool has no field for it, and inferring it from the candidates would make a run whose calls
 * were dropped look like a deliberate three-draw design: the collapse statistic is a share of the
 * draws taken, so a missing draw has to count against it.
 */
export function drawsOf(arms: readonly string[]): number {
  let most = 0;
  for (const arm of arms) {
    const match = /^sample-(\d+)/.exec(arm);
    if (match === null) continue;
    const drawn = Number(match[1]);
    if (drawn > most) most = drawn;
  }
  return most;
}

/**
 * Every question that produced a pool, in artefact order.
 *
 * The shape is recomputed from the question and its evidence rather than stored, so the artefact
 * stays a record of candidates and not of an interpretation: if the reader of intent improves, a
 * past run is re-analysed with the better reader instead of being stuck with the one it ran under.
 */
export function poolFromArtifact(
  cases: readonly ArtifactPoolCase[],
  arms: readonly string[],
): ArtifactPool {
  const questions: PoolQuestion[] = [];
  for (const entry of cases) {
    if (entry.pool === null || entry.pool.length === 0) continue;
    const candidates: PoolCandidate[] = entry.pool.map((candidate) => ({
      draw: candidate.draw,
      correct: candidate.correct,
      resultKey: candidate.resultKey,
      signature: candidate.signature,
    }));
    questions.push({
      id: entry.id,
      shape: shapeOf(entry.question, entry.evidence ?? ''),
      candidates,
    });
  }
  return { questions, draws: drawsOf(arms) };
}
