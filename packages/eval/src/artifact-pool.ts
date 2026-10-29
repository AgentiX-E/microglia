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
  /**
   * The database and the fold, when the file recorded them.
   *
   * The pool itself does not need them; the memory prior does, because "on this database, shapes like
   * this were wrong" is only a memory if the database and the fold the answer came from are both known.
   */
  readonly dbId?: string;
  readonly fold?: number;
  /**
   * The candidates, or null when no sampling arm ran.
   *
   * Optional as well as nullable because an artefact written before this field existed is exactly
   * the thing a re-analysis reads: the reading has to say "this run has no pool" about a file that
   * predates the field, not throw on it.
   */
  readonly pool?: readonly ArtifactPoolCandidate[] | null;
};

export type ArtifactPool = {
  readonly questions: readonly PoolQuestion[];
  readonly draws: number;
  /**
   * Whether the file carries the field at all.
   *
   * A file written before R7.0 has no `pool` key anywhere; a file from a run without a sampling arm
   * has the key and null in it. Both produce no questions, and they mean different things: the first
   * is "we never looked", the second is "we looked and there was nothing". A reader that merges them
   * turns an absence of instrumentation into a finding about the pool.
   */
  readonly recorded: boolean;
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
    const recorded = entry.pool ?? null;
    if (recorded === null || recorded.length === 0) continue;
    const candidates: PoolCandidate[] = recorded.map((candidate) => ({
      draw: candidate.draw,
      correct: candidate.correct,
      resultKey: candidate.resultKey,
      signature: candidate.signature,
    }));
    questions.push({
      id: entry.id,
      shape: shapeOf(entry.question, entry.evidence ?? ''),
      candidates,
      // Carried through only when present, so a reader can tell an unrecorded database from a
      // database called '' without asking the artefact which version wrote it.
      ...(entry.dbId === undefined ? {} : { dbId: entry.dbId }),
      ...(entry.fold === undefined ? {} : { fold: entry.fold }),
    });
  }
  return {
    questions,
    draws: drawsOf(arms),
    recorded: cases.some((entry) => entry.pool !== undefined),
  };
}
