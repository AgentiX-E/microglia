/**
 * Which writer wrote the store an arm evaluated, and how much of the population it covered.
 *
 * ## Why this is a field and not an inference
 *
 * The distiller is a *resilient pair*: a model-backed interpreter, and a rule interpreter that
 * answers any event the model faults on. The pair exists so a single bad reply does not cost a
 * learning phase, and it is the right design — but it makes the store's provenance ambiguous, and
 * the ambiguity is invisible in every number the artefact carries. `store.stored: 6` does not say
 * whether six claims came from a model that read the corrections or from a rule that copied them.
 *
 * R104's learn half printed the numbers and the first version of this module joined them wrongly:
 *
 * ```
 * learn: 73 correction(s) … 16 candidate(s), 6 created, 6 item(s) in the store,
 *        63 answered by the rule fallback, reasons MG_E_INVALID_SIGNAL=63
 * ```
 *
 * Read as a share, `63 of 73` says the fallback wrote the store. It did not: the rule interpreter
 * was invoked **and returned no candidates**, because `distillUnit: correction` gives it no trace to
 * copy from. The six stored items are the model's. So authorship cannot be read from the fault
 * count, which counts *invocations* of the fallback and not its output — and a counter that reports
 * an invocation as an answer is the same defect this repository has now paid for four times.
 *
 * ## The two numbers a reader needs
 *
 * **Who wrote it** — decided by which side produced claims, never by which side was called.
 * **How much it covers** — `asked - faults` is the number of events the model answered at all, and
 * on R104 that was 10 of 73. A store of six claims from ten answers is a store covering 14% of its
 * population, and a pack limit of five then serves the same five items to every request: the
 * retrieval has degenerated into "the store". No field on the artefact said either thing.
 */

export type WriterState = 'model' | 'fallback' | 'mixed' | 'none';

export type WriterReading = {
  readonly state: WriterState;
  /** Events the pair was asked about. */
  readonly asked: number;
  /** Events the model threw on, which is also the number the fallback was invoked for. */
  readonly faults: number;
  /** Claims each side produced. Authorship is decided here and nowhere else. */
  readonly primaryClaims: number;
  readonly fallbackClaims: number;
  /** Events the model answered at all, `asked - faults`, as a share of `asked`. */
  readonly modelCoverage: number;
  readonly sentence: string;
};

const share = (part: number, whole: number): number => (whole === 0 ? 0 : part / whole);

/**
 * Read which writer produced the store, from claims rather than from calls.
 *
 * `none` covers two different runs that must not be merged: an arm that asked no writer at all
 * (a scaffold arm, or one whose learn half is pinned) and an arm that asked and received nothing.
 * Both are stated in the sentence rather than folded into `model` with a zero, because a store of
 * nothing is the reading R41 published.
 */
export function writerOf(input: {
  readonly asked: number;
  readonly faults: number;
  readonly primaryClaims: number;
  readonly fallbackClaims: number;
}): WriterReading {
  const asked = Math.max(0, Math.trunc(input.asked));
  const faults = Math.min(asked, Math.max(0, Math.trunc(input.faults)));
  const primary = Math.max(0, Math.trunc(input.primaryClaims));
  const fallback = Math.max(0, Math.trunc(input.fallbackClaims));
  const answered = asked - faults;
  const modelCoverage = share(answered, asked);
  const coverage = `${String(answered)} of ${String(asked)} event(s)`;

  if (asked === 0) {
    return {
      state: 'none',
      asked: 0,
      faults: 0,
      primaryClaims: primary,
      fallbackClaims: fallback,
      modelCoverage: 0,
      sentence: 'no event was put to a writer, so the store was not written by one',
    };
  }
  if (primary === 0 && fallback === 0) {
    return {
      state: 'none',
      asked,
      faults,
      primaryClaims: 0,
      fallbackClaims: 0,
      modelCoverage,
      sentence:
        `the model answered ${coverage} and neither writer produced a claim: ` +
        'the store this arm evaluated was written by nobody',
    };
  }
  if (fallback === 0) {
    return {
      state: 'model',
      asked,
      faults,
      primaryClaims: primary,
      fallbackClaims: 0,
      modelCoverage,
      sentence:
        `the model wrote ${String(primary)} claim(s) from ${coverage} (${modelCoverage.toFixed(4)})` +
        (faults === 0
          ? ' and no event fell back'
          : `; the fallback was invoked on ${String(faults)} and contributed nothing`),
    };
  }
  if (primary === 0) {
    return {
      state: 'fallback',
      asked,
      faults,
      primaryClaims: 0,
      fallbackClaims: fallback,
      modelCoverage,
      sentence:
        `the model wrote nothing for any event and the fallback wrote ${String(fallback)} claim(s): ` +
        'the store this arm evaluated is the fallback’s',
    };
  }
  return {
    state: 'mixed',
    asked,
    faults,
    primaryClaims: primary,
    fallbackClaims: fallback,
    modelCoverage,
    sentence:
      `the model wrote ${String(primary)} claim(s) and the fallback ${String(fallback)}: ` +
      'the store holds both writers and no arm here can separate them',
  };
}
