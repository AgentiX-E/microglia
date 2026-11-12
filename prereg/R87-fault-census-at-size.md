---
id: R87-fault-census-at-size
step: R87
opened: 2026-11-12
arms: memory
sample: 57
gates: V1,V2,V3,V5,V6,V7,V8,V32,V44
recallFloor: 0
facadePair: off
trainDomain: retail
testDomain: retail
recallDomain: retail
distillUnit: trace
traceClaims: 3
distillScope: edited
---

# R87 — the census again, at the size the failure population actually has

**Registered** 2026-11-12. R86 was dispatched to name the eleven codes behind R58's `llmFailed: 11`
and came back `NO_MEASUREMENT` after **one** distillation call. Its registration justified the cap with
the sentence *"every task in it contributes corrections"*, and that sentence is false: `teachingOf`
returns `undefined` for a task that passed (R62), so a correction exists per **failing** task. Ten
evaluated tasks split into five learning ones, one failed, and the census had one call instead of
fifteen. `§34.107` records the arithmetic.

This registration runs the same instrument on the same corpus at the size where the population is the
one R58 measured — 57 learning tasks, from which 15 corrections and 11 faults were produced once.

## The arm

One dispatch, `l4_tasks = 0` (all 114 retail task ids), `TAU_TRAIN_SHARE = 0.5`, `TAU_TRAIN_TASKS = 57`,
**`TAU_TEST_TASKS = 1`**, `l4_arms = memory`, unit `trace`, three claims, `edited` scope, R58's model and
seed. The last two numbers are the registration's whole cost argument and they are separate knobs on
purpose: the quantity is produced by the **learning** half, and the evaluation cap only decides how much
of the run is spent grading something this arm does not report.

The predicted population is therefore stated before the run rather than discovered after it:

| quantity | arithmetic | R58's reading |
| --- | --- | --- |
| learning tasks | the plan's train half, capped at 57 | 57 |
| corrections | failing tasks among them, ~26% of the corpus | 15 of 57 |
| distillation calls | one per correction (three claims each, one call) | 15 |
| faults | 73% of the calls, if the rate is about the distiller | 11 |

A run with fewer than **eight** calls cannot grade a distribution and says so below.

## Prediction

- **The count and the codes agree exactly.** `sum(learning.llmFailedReasons) == learning.llmFailed`, and
  the run prints one `[tau2] distill fault CODE: …` line per distinct code. Anything else means the
  recorder is wrong and nothing below it is available.
- **At least eight calls and at least one fault.** Eight is the registration's own floor: a code
  distribution over seven calls is a list, and the point of this dispatch is that the last one could not
  tell a 73% rate from a 0% one.
- **The dominant code is `MG_E_INVALID_SIGNAL`, at 60% or more of the faults.** A trace is the longest
  prompt this lane sends — an attempt's calls beside the reference actions and the failed rubric — and
  the ceiling is 1,200 tokens against a 640-character statement, so the mechanism that reasoning
  predicts is a truncated JSON object, which is this code.
- **The empty claim list is counted, not inferred.** R86's single call returned **no claims and no
  fault**: the reply parsed and carried nothing. Whatever its share here, it appears in the artefact as
  its own number (`candidates` against `events` against `failed`), because it is the one outcome that
  reads downstream as "the corpus had nothing to teach".
- **Every sample is quotable.** `llmFailedSamples` carries one string per code, at most 200 characters,
  and for `MG_E_INVALID_SIGNAL` it opens with the reply's own characters — the only thing that separates
  a cut-off object from a prose preamble.
- **The store is not graded.** `distilled`, `claims` and the code distribution are recorded; support,
  coverage and `pass^4` are `n/a`. `TAU_TEST_TASKS = 1` means the evaluation is four episodes of
  bookkeeping, and a readback that quotes its `pass^4` has ignored this sentence.

## Refutation

- **Fewer than eight calls.** Then the population arithmetic is still wrong and the fault is in this
  registration rather than in the distiller: the failing share of the learning half is not what the
  corpus says, and the next dispatch counts it before choosing a cap. `NO_MEASUREMENT`, and the run's
  own funnel names it.
- **Eight or more calls and no fault at all.** Then the eleven at fifteen were an availability or
  throughput effect rather than a property of the prompt: the fix is backoff and a smaller batch, and no
  prompt or ceiling change is licensed by this line of work.
- **A provider or timeout code dominates.** Then the ceiling and the prompt are both innocent, R58's
  `{1: 6}` describes a fleet that answered a quarter of the time, and the store's size is a statement
  about availability rather than about the unit.
- **A code this lane has never named.** Then the enumeration is incomplete, the missing branch is where
  the money went, and it is named before anything else is dispatched.
- **Every call returns no claims and no fault.** Then the trace form is producing an empty claim list as
  its normal outcome, the fault census is measuring a path the lane no longer takes, and the next
  registration is about the form rather than about the failures.

## What would make this round worthless

- Quoting the store's support, coverage or `pass^4`. One task is scored; the number is bookkeeping.
- Changing a second variable — the unit, the ceiling, the form, the scope, the model. The question is
  *which* failure, and a second variable makes the answer unattributable.
- Reading the code distribution as a reliability rate for the distiller. It is a census of one corpus at
  one ceiling, and it explains R58 rather than replacing it.
- Dispatching it beside another tau run. The provider is the shared resource: two dispatches in one
  window measure each other's throttling, and R58's own faults may be exactly that.

## Cost

The learning half is 57 episodes at R58's model — R86 measured 110 s for five, so about 21 minutes of
wall clock and, at the same rate, **under $0.30**. The evaluation is one task times four trials, which is
why it is one: four episodes, not 228. Total is under a quarter of the $1.06 the full arm costs, and the
distillation calls are the same fifteen the census needs.
