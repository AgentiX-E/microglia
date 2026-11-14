/**
 * What the distiller's model put in its replies.
 *
 * ## The gap this closes
 *
 * The funnel counts four things about one learning phase: the corrections it had, the events the
 * distiller was asked about, the claims the parser kept, and the claims it threw away. A reply with
 * **nothing in it** is invisible to all four — `asked` counts the event, `candidates` counts zero,
 * and `drops` counts zero because nothing was parsed and discarded. So "the model chose silence" and
 * "the interpreter was never called" produce the same numbers, and R104's own stop printed the
 * sentence for the first while nobody could rule out the second:
 *
 * > the interpreter answered all 15 event(s) with no claim of its own: nothing was thrown away after
 * > the reply, so the model is what carried nothing
 *
 * The reply itself — the one artefact that settles it — was discarded at the seam. This census keeps
 * a count per reply and the *first* empty one verbatim, which is enough to tell `[]` from
 * `{"candidates":[]}` from a sentence in prose, and it is a count rather than a log because an
 * artefact is a document.
 *
 * ## Why it lives here rather than in the driver
 *
 * `packages`' own `bin/` directories are excluded from coverage, on the argument that a CLI is a
 * shell over logic in the package. That argument is only true if the logic is in the package: R110
 * found the one function that decided whether a real artefact could be read living inside a `bin/`,
 * where no test could see it. Counting is logic.
 */
import { parseCandidates } from '@agentix-e/microglia-core/distill';

/** The reading. `firstEmpty` is absent when no reply was empty, never an empty string. */
export type DistillReplyCensus = {
  /** Replies the model seam saw. */
  readonly calls: number;
  /** Replies that parsed to a candidate list of length zero. */
  readonly empty: number;
  /** Total characters returned, which prices a reply that said nothing. */
  readonly chars: number;
  /** The first empty reply, verbatim and bounded. */
  readonly firstEmpty?: string;
};

/** A census a driver can note every reply into and read once, at the end of the learn half. */
export type DistillReplyCounter = {
  /** Note one reply and hand it back, so a caller can wrap its model seam in one expression. */
  readonly note: (reply: string) => string;
  /** The reading. Safe to call more than once; the counter is not consumed. */
  readonly reading: () => DistillReplyCensus;
};

/**
 * How much of an empty reply is kept.
 *
 * The same bound the parser uses for its own previews: enough to recognise the shape of an answer,
 * short enough that a model which echoes its prompt cannot put the prompt in the artefact.
 */
export const EMPTY_PREVIEW_CHARS = 200;

/**
 * Classify one reply.
 *
 * A reply that is not JSON is **not** counted as empty: it is the interpreter's error to count, it
 * carries its own sample, and folding it into "the model said nothing" is the conflation this
 * census exists to end.
 */
export function replyIsEmpty(reply: string): boolean {
  let parsed: unknown[];
  try {
    parsed = parseCandidates(reply);
  } catch {
    return false;
  }
  return parsed.length === 0;
}

export function replyCensus(): DistillReplyCounter {
  let calls = 0;
  let empty = 0;
  let chars = 0;
  let firstEmpty: string | undefined;
  return {
    note: (reply: string): string => {
      calls += 1;
      chars += reply.length;
      if (replyIsEmpty(reply)) {
        empty += 1;
        firstEmpty ??= reply.trim().slice(0, EMPTY_PREVIEW_CHARS);
      }
      return reply;
    },
    reading: (): DistillReplyCensus => ({
      calls,
      empty,
      chars,
      ...(firstEmpty === undefined ? {} : { firstEmpty }),
    }),
  };
}
