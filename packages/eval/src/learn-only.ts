/**
 * What a dispatch can say when it stops after the learning half, because the census is the reading.
 *
 * ## Why an arm would stop there
 *
 * R104 spent **$1.21** and produced a score that cannot be ordered against anything: 40 tasks resolve
 * ±10pp on the difference, two facades of the same dispatch differed by 17.5pp with no treatment, and
 * the store underneath covered 10 of 73 corrections. The score was never the informative half. What
 * was: **63 of 73 replies carried no visible character**, and the arm had no way to say why.
 *
 * R112 then excluded the writer — 8 of 8 `(model, form)` pairs answer on a fixture, `lesson` best —
 * which leaves the regime R104 ran under, where no `thinking` parameter was sent and the ceiling was
 * 1,200 output tokens. A reply that spends its ceiling reasoning is a reply with nothing in it, and
 * that is indistinguishable from a model declining the correction **unless the census is read**.
 *
 * So the next arm asks for the census and not the score: the same learning half, `thinking` stated, and
 * a stop before the evaluation. The difference is `$0.19` against `$1.21` for a reading that a
 * benchmark at this sample cannot turn into a verdict anyway.
 *
 * ## What this module is not
 *
 * It is not a gate. A `mostly-blank` reading does not refuse the arm — it *is* the arm's result, and it
 * is recorded as a no-measurement artefact with its diagnostics rather than as a failure, because the
 * pipeline did what it was asked and the census is what came back. The predicate that refuses an empty
 * store already exists (`funnelVerdict`) and this one does not overlap it.
 */
import type { DistillReplyCensus } from './distill-replies.js';

/** How the replies were distributed, named so a reader does not have to divide. */
export type ReplySilenceState =
  /** No call was made, which is a batch that never reached the distiller. */
  | 'unasked'
  /** Every reply carried a candidate. */
  | 'answered-everywhere'
  /** Half or more of the replies carried no visible character. */
  | 'mostly-blank'
  /** Half or more of the replies parsed to an empty list. */
  | 'mostly-empty'
  /** Every state is present and none holds a majority. */
  | 'mixed';

export type ReplySilenceReading = {
  readonly state: ReplySilenceState;
  readonly calls: number;
  /** Blank replies as a share of calls. Zero calls reads as zero, never as one. */
  readonly blankShare: number;
  readonly emptyShare: number;
  readonly sentence: string;
};

/** Percent with one decimal, the form every lane in this repository prints a share in. */
function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

const shareOf = (part: number, whole: number): number => (whole === 0 ? 0 : part / whole);

/**
 * Read the census into the one sentence a stopping dispatch is worth.
 *
 * The order of the tests is the definition. `unasked` comes first because a batch that never reached
 * the distiller is not a finding about replies; `answered-everywhere` comes last among the positives so
 * that a single blank reply in seventy-three does not get called a majority by rounding.
 */
export function silenceOf(census: DistillReplyCensus): ReplySilenceReading {
  const calls = Math.max(0, Math.trunc(census.calls));
  const blankShare = shareOf(census.blank, calls);
  const emptyShare = shareOf(census.empty, calls);
  const base = { calls, blankShare, emptyShare };
  const tally =
    `${String(calls)} call(s): ${String(census.answered)} answered, ${String(census.empty)} empty, ` +
    `${String(census.blank)} blank, ${String(census.unparsed)} unparsed, ` +
    `${String(census.chars)} character(s) returned`;

  if (calls === 0) {
    return {
      ...base,
      state: 'unasked',
      sentence: 'no reply was recorded, so this is not a reading about the distiller',
    };
  }
  if (census.answered === calls) {
    return {
      ...base,
      state: 'answered-everywhere',
      sentence:
        `every one of ${String(calls)} call(s) produced a candidate; ` +
        `${String(census.chars)} character(s) returned`,
    };
  }
  if (blankShare >= 0.5) {
    return {
      ...base,
      state: 'mostly-blank',
      sentence:
        `${percent(blankShare)} of replies carried no visible character — ${tally}. ` +
        'A blank reply is the regime or the model, not the prompt: nothing came back to be parsed',
    };
  }
  if (emptyShare >= 0.5) {
    return {
      ...base,
      state: 'mostly-empty',
      sentence:
        `${percent(emptyShare)} of replies parsed to an empty list — ${tally}. ` +
        'The writer answered and chose silence, which is a finding about the corrections',
    };
  }
  return { ...base, state: 'mixed', sentence: `no state holds a majority — ${tally}` };
}

/**
 * The sentence a learn-only stop carries, which is the one place in this lane where a stop is the
 * delivery rather than a failure.
 */
export function learnOnlyReason(reading: ReplySilenceReading): string {
  return (
    'the arm stopped after the learning half, because the census is the reading and the score is not: ' +
    reading.sentence
  );
}
