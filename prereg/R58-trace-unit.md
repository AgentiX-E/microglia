---
id: R58-trace-unit
step: R58
opened: 2026-11-08
arms: memory,reference
sample: 228
gates: V1,V2,V3,V5,V6,V7,V8,V32,V44
recallFloor: 0
facadePair: off
trainDomain: retail
testDomain: retail
recallDomain: retail
distillUnit: trace
traceClaims: 3
---

# R58 — the object distilled is one task trace, and the store is consolidated after it is written

**Registered** 2026-11-08, dispatchable. R55.0 is read (`{1: 7}`, ABANDONED on its own refutation),
R56 is read and reverted (`procedure` lost 8.77pp, the ban is kept), and R53's capability is built
but not dispatched. This registration executes the step the roadmap named after R55.0.

## What the two failures have in common

R54's conditions existed and shared 8.33% of the request's terms — written in the procedure's
register, because the `lesson` form asks `when` to name "which tables or columns it involves", and a
lane whose input is *"I need to cancel my order"* has none. R56 answered that with the `procedure`
form and a host-side ban: the ban worked (0 of 7 items, 0 of 1,921 packs, 9 of 16 candidates
refused) and the store halved, coverage fell to 6.25% against a 12% bar, and the arm read −8.77pp.
Reverted, as R45 requires.

R55.0 then asked the other half of the question and got `{1: 7}`: every item in that store is one
task's single observation, nothing reaches support 2, and the floor R55.1 would have gated on
(`supportTasks >= 3`) is above the population's maximum. That is not a threshold problem. It is the
unit: `taskCorrection` renders one failed task as one sentence, the model writes one rule from it,
and one sentence of one failure carries one claim — so no two tasks can produce the same item, and
the competitive record's `sup3` arm (a guideline admitted after three distinct learning tasks, ~5
guidelines per task, 31 of 292 retail at support 3) is unreachable by any setting of a number.

Both failures are the same object defect seen twice: **one sentence is not enough of an episode to
write a condition in the requester's register, and it is not enough of an episode to recur.**

## What is actually written

Three things, and the first two are the treatment.

**1. The unit is the trace.** τ²'s learning document carries `simulations[].messages` — what the
agent did, in order — beside `evaluation_criteria.actions`, what the reference trajectory does. The
driver read neither: it read the criteria and rendered them as one sentence. `tracesOf` now reads
the failing trial's calls, `traceOf` puts them beside the reference actions and the failed rubric,
and the event's `input.trace` carries all three into the prompt. The distiller is asked for up to
three claims per trace, in a `trace` form whose `when` guidance is *the words the person making the
request used*, and whose statement may not name a tool, a function, an endpoint or an identifier.

**2. The store is consolidated after it is written.** `consolidateKnowledge` runs over the finished
store: items of one kind and one scope whose statements overlap (Jaccard over content terms, 0.7)
are one claim, and a group becomes one survivor carrying the union of its evidence. That union is
what `countDistinctTasks` reads, which is what makes `supportTasks` reach 2 or 3 without a threshold
being lowered anywhere. It refuses — and counts — a pair whose conditions disagree, whose payloads
differ, or whose evidence is the same, because a merge that buys no support would report a duplicate
as corroboration.

**3. The ban stays.** R56's finding is not re-tested here: the tool-name ban is on in both arms, and
the register constraint moves from the `procedure` form (which lost) to the `trace` form's `when`
guidance, enforced by the same host-side predicate.

## The one variable, and the control inside one dispatch

`TAU_DISTILL_UNIT` changes from `correction` (the unit every published arm measured, still the
default) to `trace`. Everything else is held: same corrections, same learning half, same recall,
same note level, same model, same seed, same held-out split, `minCoverage` 0, the ban on.

Consolidation is not a second variable, because it has a control *inside the same run*: the pass
reports `supportBefore` and `supportAfter` over one store it read once, exactly as R49's paired
facade reads two floors over one store. A second dispatch would distil a second store — different
claims, different coverage, and a difference that cannot be attributed to the pass.

## Prediction

- **Something recurs.** At least one item reaches `supportTasks >= 3` after the pass, which is the
  threshold the published leader admits at and the number R55.0 measured as 0 of 7.
- **Recurrence is not a rounding error.** At least 25% of the surviving items reach support 2.
- **The pass keeps the store.** At least 50% of the items it read survive it. A pass that reaches
  support 3 by retiring five-sixths of a store has bought a threshold with coverage, which is R56's
  failure arriving by a different route.
- **The register moves with the unit.** Median non-zero coverage at or above **12%**, the same bar
  R54 and R56 both failed, on the same instrument. A trace is where the requester's own words live;
  if the register does not move when the object that contains it is put in the prompt, the register
  is not what decides the trigger.
- **The unit ran.** At least 80% of the corrections carry a trace. Below that the arm is partly the
  control and its numbers describe neither.
- **`pass^4` is reported and not claimed.** 57 pairs resolve 19.66pp; a `HARM` verdict reverts under
  R45, and `UNRESOLVED` is expected and stated in advance.

## Refutation

- **No item reaches support 2 even after the pass.** Then recurrence is not reachable by changing
  the unit, the object is wrong one level further down (the *task*, not the trace), and the support
  axis closes for this store shape rather than for this register.
- **The pass merges nothing (`groups = 0`).** Then paraphrases do not converge at any threshold that
  would not also merge different claims, and consolidation is inert: a post-hoc pass cannot
  manufacture recurrence that the write path never produced.
- **The store halves.** Then support was bought with reach, R56's trade repeated, and the revert rule
  fires on the arm as a whole rather than on one of its halves.
- **Traces on fewer than 80% of corrections.** The treatment did not run on the population the
  reading is over; the run is `NO_MEASUREMENT` and the reader is told which layer failed.
- **The artefact cannot say which unit ran.** Then a control and a treatment would read as one
  experiment of two, which is the defect R56 named and R58's fourth refutation repeats.

## What would make this round worthless

- Changing the note level, the admission rule or the recall floor in the same dispatch. R53, R55.1
  and R57 are registered and all three are downstream of what the store contains.
- Reading the coverage number off a different population than R54's. The delivered-pair median is
  the named field; the non-zero median is the one the 12% bar has always meant, and the artefact
  carries both.
- Quoting the paired delta as a result. It is `UNRESOLVED` by construction and will be again.
- Grading the recurrence numbers on an artefact whose `distillUnit` is absent. That artefact is a run
  from before this capability, and the gate `l4-support-recurrence` blocks rather than warns.

## Cost

One dispatch: at most 3 distillation calls per correction where there was 1 (32 corrections, so
≤ 96 calls against 32), plus the same 57 tasks × 4 trials × 2 arms. The consolidation pass costs no
model call at all: it is a lexical grouping over items already stored.

## Sequencing

R58 is the last prompt-side and write-side lever this record has: R54 tested the form, R56 tested the
register, R53 tests the note, and all three are ways of saying the same sentence differently. R58
changes which object is distilled. If it moves the store, R53 and R57 become readable against a
store worth reading; if it does not, the finding is that the *corpus* (57 held-out tasks, one
domain, four trials) is the ceiling and the next registration is about the sample rather than the
mechanism.
