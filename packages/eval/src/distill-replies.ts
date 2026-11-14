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
 * a count per reply and the *first* reply of each kind verbatim, which is enough to tell `[]` from
 * `{"candidates":[]}` from a sentence in prose, and it is a count rather than a log because an
 * artefact is a document.
 *
 * ## Four states, because the first version had two and the third was the one that happened
 *
 * R111 counted two kinds of reply: *empty*, meaning it parsed to a candidate list of length zero, and
 * everything else. A reply that was **not JSON** was deliberately left to the interpreter, on the
 * argument that "it carries its own sample". R114 read that argument against a run and it did not
 * hold: R104's learn half printed `73 call(s), 0 empty, 6824 character(s) returned` — a healthy line
 * — while the same run recorded `63 answered by the rule fallback, reasons MG_E_INVALID_SIGNAL` and
 * one fault sample whose quote was **empty**. The interpreter's sample was the whole proof the
 * delegation rested on, and it was blank.
 *
 * So the states are named for what a reader needs to distinguish, and they are exhaustive:
 *
 * | state | what it means | what it costs |
 * | --- | --- | --- |
 * | `answered` | parsed to at least one candidate | the writer worked |
 * | `empty` | parsed to a list of length zero | the writer chose silence |
 * | `blank` | no visible character at all | the call returned nothing, and no sample can show it |
 * | `unparsed` | not blank, and not JSON | the writer said something the parser cannot read |
 *
 * `blank` is the one this census previously counted as *healthy*. A whitespace-only reply is not a
 * reply: it has no shape to inspect, so it cannot be left to the interpreter's preview, and counting
 * it as "not empty" made the one diagnosis that needs a sample the one diagnosis that had none.
 *
 * ## Why it lives here rather than in the driver
 *
 * `packages`' own `bin/` directories are excluded from coverage, on the argument that a CLI is a
 * shell over logic in the package. That argument is only true if the logic is in the package: R110
 * found the one function that decided whether a real artefact could be read living inside a `bin/`,
 * where no test could see it. Counting is logic.
 */
import { parseCandidates } from '@agentix-e/microglia-core/distill';

/** What one reply turned out to be. Exhaustive: a reply is exactly one of these. */
export type DistillReplyKind = 'answered' | 'empty' | 'blank' | 'unparsed';

/** The reading. A `first*` field is absent when no reply was of that kind, never an empty string. */
export type DistillReplyCensus = {
  /** Replies the model seam saw. */
  readonly calls: number;
  /** Replies that parsed to at least one candidate, which is the writer working. */
  readonly answered: number;
  /** Replies that parsed to a candidate list of length zero. */
  readonly empty: number;
  /** Replies with no visible character at all. */
  readonly blank: number;
  /** Replies that are not blank and did not parse. */
  readonly unparsed: number;
  /** Total characters returned, which prices a reply that said nothing. */
  readonly chars: number;
  /** The first empty reply, verbatim and bounded. */
  readonly firstEmpty?: string;
  /** The first blank reply, verbatim and bounded — a reader has to quote it, because it is invisible. */
  readonly firstBlank?: string;
  /** The first unreadable reply, verbatim and bounded. */
  readonly firstUnparsed?: string;
};

/** A census a driver can note every reply into and read once, at the end of the learn half. */
export type DistillReplyCounter = {
  /** Note one reply and hand it back, so a caller can wrap its model seam in one expression. */
  readonly note: (reply: string) => string;
  /** The reading. Safe to call more than once; the counter is not consumed. */
  readonly reading: () => DistillReplyCensus;
};

/**
 * How much of a sampled reply is kept.
 *
 * The same bound the parser uses for its own previews: enough to recognise the shape of an answer,
 * short enough that a model which echoes its prompt cannot put the prompt in the artefact.
 */
export const EMPTY_PREVIEW_CHARS = 200;

/**
 * Classify one reply.
 *
 * The order of the tests is the definition: a reply with no visible character is `blank` **before**
 * it is anything else, because the parser's verdict on it (`not JSON`) describes a text that was
 * never there. Saying "unparsed" about an empty string would make a silent model indistinguishable
 * from a model that answered in prose, which is the distinction this module exists to draw.
 */
export function classifyReply(reply: string): DistillReplyKind {
  if (reply.trim() === '') return 'blank';
  let parsed: unknown[];
  try {
    parsed = parseCandidates(reply);
  } catch {
    return 'unparsed';
  }
  return parsed.length === 0 ? 'empty' : 'answered';
}

/**
 * The reading as one line, with every sample quoted.
 *
 * The samples are quoted rather than interpolated because a blank reply's sample *is* whitespace:
 * printed bare it looks like the missing evidence the old line printed, and `"\n\n"` is the finding.
 */
export function replyCensusLine(reading: DistillReplyCensus): string {
  const sample = (label: string, text: string | undefined): string =>
    text === undefined ? '' : `, first ${label} ${JSON.stringify(text)}`;
  return (
    `${String(reading.calls)} call(s), ${String(reading.answered)} answered, ` +
    `${String(reading.empty)} empty, ${String(reading.blank)} blank, ` +
    `${String(reading.unparsed)} unparsed, ${String(reading.chars)} character(s) returned` +
    sample('empty', reading.firstEmpty) +
    sample('blank', reading.firstBlank) +
    sample('unparsed', reading.firstUnparsed)
  );
}

export function replyCensus(): DistillReplyCounter {
  let calls = 0;
  let answered = 0;
  let empty = 0;
  let blank = 0;
  let unparsed = 0;
  let chars = 0;
  let firstEmpty: string | undefined;
  let firstBlank: string | undefined;
  let firstUnparsed: string | undefined;
  return {
    note: (reply: string): string => {
      calls += 1;
      chars += reply.length;
      switch (classifyReply(reply)) {
        case 'answered':
          answered += 1;
          break;
        case 'empty':
          empty += 1;
          firstEmpty ??= reply.trim().slice(0, EMPTY_PREVIEW_CHARS);
          break;
        case 'blank':
          blank += 1;
          // Kept as it arrived rather than trimmed: the whole finding is *which* invisible
          // characters came back, and a trim would erase the difference between a newline and
          // nothing at all.
          firstBlank ??= reply.slice(0, EMPTY_PREVIEW_CHARS);
          break;
        case 'unparsed':
          unparsed += 1;
          firstUnparsed ??= reply.trim().slice(0, EMPTY_PREVIEW_CHARS);
          break;
      }
      return reply;
    },
    reading: (): DistillReplyCensus => ({
      calls,
      answered,
      empty,
      blank,
      unparsed,
      chars,
      ...(firstEmpty === undefined ? {} : { firstEmpty }),
      ...(firstBlank === undefined ? {} : { firstBlank }),
      ...(firstUnparsed === undefined ? {} : { firstUnparsed }),
    }),
  };
}
