---
id: R59-llm-fault-census
step: R59
opened: 2026-11-12
arms: memory
sample: 40
gates: V1,V2,V3,V5,V6,V7,V8,V44
recallFloor: 0
facadePair: off
trainDomain: retail
testDomain: retail
recallDomain: retail
distillUnit: trace
traceClaims: 3
distillScope: edited
---

# R59 — eleven of fifteen distillation calls threw, and the record cannot say what they threw

**Registered** 2026-11-12, dispatchable. R58 is read and it is `NO_MEASUREMENT`: the trace unit ran
(15 of 15 corrections carried a trace, 57 traces read, nothing dropped by the parser) and the store
was built from **four** of those fifteen events, because eleven of them faulted and were answered by
the rule interpreter, which writes nothing for a trace.

This is not an experiment on memory. It is the measurement that has to exist before any memory
experiment in this lane can be read, and it is registered because the alternative — dispatching a
ten-task run and reading its log — produces a fact with no prediction attached, and this record has
already paid for that mistake twice.

## What the round needs to know

`MG_E_INVALID_SIGNAL` covers three different failures and the fixes do not overlap:

| what the model did | what the fix is | what would still be true afterwards |
| --- | --- | --- |
| wrote a JSON object that the token ceiling cut in half | raise `DISTILL_TOKENS`, or shrink the trace the prompt carries | the store's statements get shorter, or cheaper |
| wrote prose around the object, or a shape the schema refuses | change the form's instruction, not the ceiling | the claims are what the model meant |
| refused the request, timed out, or answered 429 | change concurrency and backoff; no prompt change is licensed | the store is a sample of the corpus until availability improves |

R58 recorded `llmFailed: 11` and no code, so all three were live explanations. The instrument that
carries them — `learning.llmFailedReasons` and `learning.llmFailedSamples`, one specimen per code —
landed in `d027a76` and `d27b5cde` and has not been run.

## The arm

One dispatch, `l4_tasks = 10`, `l4_arms = memory`, unit `trace`, everything else at the values R58
ran: same distilled scope (`edited`), same three-claim ceiling, same ban, same model, same seed.
Ten tasks rather than fifty-seven because the question is about the *distiller*, and the distiller
sees the learning half — every task in it contributes corrections whether or not the evaluation
afterwards is large enough to grade. The run's `pass^4` is discarded: ten tasks is below the
coverage floor by construction, and the gate that refuses five tasks as a reading refuses ten.

## Prediction

- **The count and the codes agree exactly.** `sum(llmFailedReasons) == llmFailed`, and the run
  prints one `[tau2] distill fault CODE: …` line per distinct code. Anything else means the
  recorder is wrong and no reading below it is available.
- **At least one fault on ten tasks.** R58's rate was 73% of fifteen events; a rate that drops to
  zero at a tenth of the load is a throughput effect, and that is a finding about the fleet rather
  than about the prompt.
- **The dominant code is `MG_E_INVALID_SIGNAL`, at 60% or more of the faults.** The trace prompt is
  the longest this lane has ever sent — a whole attempt's calls beside the reference actions and the
  failed rubric — and the ceiling is 1,200 tokens because the longest statement the parser keeps is
  640 characters. That reasoning predicts truncation, and truncation is this code.
- **Every sample is quotable.** `llmFailedSamples` carries one string per code, at most 200
  characters, and for `MG_E_INVALID_SIGNAL` it contains the reply's opening characters — the only
  evidence that separates a cut-off object from a prose preamble.
- **The store is not graded.** `distilled` and `claims` are recorded; the support, coverage and
  `pass^4` readings are `n/a` because the population is ten tasks. A run that reports them is a run
  whose readback has ignored its own floor.

## Refutation

- **No fault at ten tasks.** Then the eleven at fifty-seven were an availability or throughput
  effect: the fault is a function of concurrency and duration, the fix is backoff and a smaller
  batch, and no prompt or ceiling change is licensed by this line of work.
- **Faults with no codes in the artefact.** The instrument did not reach the run: `learning` carries
  `llmFailed` and not `llmFailedReasons`, so the dispatch ran a commit older than `d027a76`. The run
  is `NO_MEASUREMENT` and the next one points at the right tag.
- **A provider or timeout code dominates.** Then the store was never a statement about the unit, the
  ceiling and the prompt are both innocent, and R58's `{1: 6}` describes a fleet that answered a
  quarter of the time — a fact about availability, not about recurrence.
- **A code that this lane has never named.** Then the enumeration is incomplete, the missing branch
  is where the money went, and it is named before any further dispatch.

## What would make this round worthless

- Reading the store's support or coverage numbers off it. Ten tasks cannot carry them, and the
  temptation to look is exactly why the section above exists.
- Changing anything else in the same dispatch — the unit, the ceiling, the form, the concurrency.
  The question is *which* failure, and a second variable makes the answer unattributable.
- Quoting the rate as a reliability number for the distiller. Fifteen events produced eleven faults
  once; one dispatch of ten tasks does not replace that measurement, it explains it.

## Cost

Bounded and small: the learning half is 10 tasks, at most three distillation calls per correction
(≈ 30 calls), and the evaluation is 10 tasks × 4 trials × 1 arm. At R58's measured rates that is
**under $0.10**, and it is dispatched inside the off-peak window so that the number is not doubled
by the hour it was sent.

## Sequencing

R59 is upstream of everything else in the queue. R58's confirmation, the `rawlog` baseline and the
in-episode arm are all statements about a store, and every one of them needs a distiller that
answers. Until the code distribution exists, "the store is small" has three causes and this record
can distinguish none of them.
