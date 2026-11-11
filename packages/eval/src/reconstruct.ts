/**
 * Guidance written for one question, from what the store remembers, and then thrown away.
 *
 * Every memory arm in this project injects **stored abstractions**: a rule distilled from a failure is
 * written to the store, retrieved by similarity, and rendered into the prompt exactly as it was learned.
 * R79 is the sharpest reading of what that is worth here — withholding a fifth of the pack moved one
 * question in 1,900 — and `full` against `none` on the same slice is −0.11pp, so the store's content is
 * inert in aggregate and no pruning of it has changed that.
 *
 * Three papers published months apart describe why that can be the *expected* result rather than a
 * failed implementation, and they converge on the same mechanism:
 *
 * - **Error reproduction** (Wang, Panaganti and Zhou, *More Memory, Worse Agents*, arXiv:2610.27406):
 *   a stored abstraction that contains an error propagates it through retrieval, and the resulting
 *   trajectory becomes the basis for the next abstraction — the error is regenerated rather than merely
 *   reused. Their fix, *Anti-Persistence*, keeps trajectories and outcomes and **reconstructs
 *   task-specific guidance on demand, discarding it after execution**.
 * - **Negative transfer from replayed memory** (Wu et al., *MemHarness*, arXiv:2607.28272): injecting a
 *   retrieved experience verbatim, regardless of the present state, is what causes the harm; the fix is
 *   to reconstruct the memory conditioned on the current question.
 * - **Single-level concrete memory** (Zhu et al., *STRATA*, arXiv:2610.19386): a flat pool of concrete
 *   memories degrades as the task set grows and suffers catastrophic negative transfer, repaired by
 *   contrast edges that flag direction-opposite experience.
 *
 * This module implements the first mechanism's advice on our own substrate, one arm wide: the same
 * retrieval, the same store, one call that writes at most `budget` characters of advice **for this
 * question only**, and nothing written back. If persistence is the problem, a reconstruction should beat
 * the pack; if the pack is simply inert, a bespoke note should be inert too, and the memory line closes
 * with a mechanism rather than with a null.
 *
 * The prompt forbids the three things that would make the comparison meaningless: restating the notes
 * (that is the persisted pack under another name), describing the schema (that is the arm's own input,
 * not the store's contribution), and writing SQL (then the arm measures a second answer rather than
 * guidance). `NONE` is a first-class answer, because "nothing in the store applies to this question" is
 * the correct output for most questions and a prompt that cannot say it will always say something.
 */
export type GuidanceItem = {
  readonly statement: string;
  /** The condition the rule was learned under, when the store recorded one. */
  readonly when?: string | undefined;
};

/** The word the writer is told to produce when the store has nothing for this question. */
export const DECLINE = 'NONE';

/**
 * The prompt that asks for one question's guidance.
 *
 * Deliberately short: this is the expensive arm (one call per question), and a long instruction would
 * buy prompt tokens rather than guidance. The question and the notes are quoted verbatim, so the only
 * thing the writer can add is the advice.
 */
export function reconstructPrompt(
  question: string,
  evidence: string,
  items: readonly GuidanceItem[],
  budget: number,
): string {
  const notes = items
    .map((item, index) => {
      const when = item.when === undefined || item.when === '' ? '' : ` (when ${item.when})`;
      return `${String(index + 1)}. ${item.statement}${when}`;
    })
    .join('\n');
  const context = evidence.trim() === '' ? '' : `\nEvidence:\n${evidence.trim()}\n`;
  return (
    `Notes recorded from earlier mistakes on this workspace:\n${notes}\n` +
    `Question: ${question}\n${context}\n` +
    `Write at most ${String(budget)} characters of advice for answering THIS question, using only the ` +
    `notes above. Do not restate the notes, do not describe the tables or columns, and do not write ` +
    `SQL. If none of the notes applies to this question, answer with the single word ${DECLINE}.\n` +
    'Advice:'
  );
}

export type ParsedGuidance = {
  /** The advice as it will be injected, or '' when the writer declined or wrote nothing usable. */
  readonly text: string;
  /** Whether the writer answered `NONE` (or nothing at all) rather than producing advice. */
  readonly declined: boolean;
};

/**
 * Turn a writer's reply into the text an arm injects.
 *
 * Three rules, each of them a reading that would otherwise be wrong:
 *
 * - **`NONE` is a decline, not advice.** Injected verbatim, it would put the word "NONE" in front of the
 *   model as if the store had said something, and the arm would be measuring a one-word block.
 * - **The budget is enforced here rather than trusted.** A writer that overshoots is the common case with
 *   a small limit, and an arm whose block length varies with the writer's obedience is an arm whose cost
 *   is not the one the registration priced.
 * - **Cut at a word, not mid-token.** A truncated clause would be a fragment of advice the writer never
 *   wrote, and a fragment is exactly the kind of plausible residue this whole line of work is trying to
 *   stop injecting.
 */
export function parseGuidance(reply: string, budget: number): ParsedGuidance {
  const trimmed = reply.trim();
  if (trimmed === '' || trimmed.toUpperCase().startsWith(DECLINE)) {
    return { text: '', declined: true };
  }
  if (trimmed.length <= budget) return { text: trimmed, declined: false };
  const cut = trimmed.slice(0, budget);
  const space = cut.lastIndexOf(' ');
  return { text: (space > 0 ? cut.slice(0, space) : cut).trimEnd(), declined: false };
}

/** What the reconstruction pass actually produced, per run. */
export type ReconstructReading = {
  readonly questions: number;
  readonly written: number;
  readonly declined: number;
  /** Mean characters injected over the questions that produced advice, or `null` when none did. */
  readonly meanChars: number | null;
  /** The budget every writer was given, so a reader can see how much of it was used. */
  readonly budget: number;
};

/**
 * Bookkeeping for the reconstruction arms.
 *
 * `declined` is not a failure count. A store of 1.86 rules per question that has nothing to say about
 * most of them should decline most of the time, and the arm's population then splits by construction:
 * the questions where advice existed and the questions where it did not. Reporting the split is what
 * makes a null result readable — a pack that says nothing and a pack that says something useless are
 * different failures with different next steps.
 */
export function reconstructReading(
  replies: readonly ParsedGuidance[],
  budget: number,
): ReconstructReading {
  const written = replies.filter((reply) => !reply.declined);
  return {
    questions: replies.length,
    written: written.length,
    declined: replies.length - written.length,
    meanChars:
      written.length === 0
        ? null
        : written.reduce((sum, reply) => sum + reply.text.length, 0) / written.length,
    budget,
  };
}
