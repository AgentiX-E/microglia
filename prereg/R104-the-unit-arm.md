---
id: R104-the-unit-arm
step: R104
opened: 2026-11-14
arms: memory
sample: 160
gates: V0,V1,V2,V3,V5,V8
recallFloor: 0
facadePair: off
facadeNotes: off
facadeShapes: two-unit
# Amended before any measurement (see the note below the sentence). The store this arm's premise
# quotes is R99's: 73 records, 53 routines, ten taught by two tasks. That is the mixed population, and
# leaving the switch to a repository variable resolved it to `edited` — fifteen records from fifteen
# failures, which cannot hold the ten corroborated routines the claim is about.
distillScope: all
trainDomain: retail
testDomain: retail
recallDomain: retail
packBudget: 2400
taskSplit: official
trainTasks: 74
testTasks: 40
release: v1.0.1
---

# R104 — the unit, not the tuning: one store delivered as failures or as routines

**Registered** 2026-11-14, after R109a built the pair. R99's own census is the reason this arm exists and
it is quoted here because it fixes what the arm may claim:

> 73 corrections distilled into **53 action shapes**, of which **10 are taught by two tasks and 5 by
> three**. Every one of the 73 records carries evidence from exactly one task.

So the store had a supply of 53 routines and could express a supply of 73 facts, none of them
corroborated. ALTK-Evolve's published `sup2`/`sup3` cells are exactly the two numbers this store cannot
produce (COMPETITIVE Appendix AE), and the reason is not retrieval tuning: the dedupe key is the
normalized statement, and two failures of one routine differ in every literal token. **The unit of
memory, not the ranking of it, is what hides the recurrence.**

R109 put the fold at the delivery boundary — a pure function over the pack the recall already produced —
and R109a made it a pair: one dispatch, one learning phase, one store, two facades that differ in one
`RecallQuery.shape`. This registration is that pair, with the control being the unit every committed
artefact ran.

## Amended before any measurement: the population

The first dispatch (run `43578774040`, 2026-11-14) **produced no measurement** and therefore no result
to amend anything in the light of. It ran 74 learn episodes for $0.1875, produced fifteen corrections,
asked the distiller about all fifteen, and got fifteen empty replies — `0 candidate(s)`, `0 stored`,
`0 servable`. The arm stopped there, as it should.

That dispatch also resolved `distillScope` from a repository variable that was empty, so the driver
defaulted to `edited`: **fifteen corrections from fifteen failures.** The census this registration
quotes is R99's, which was built from every trajectory — 73 records, 53 shapes, ten taught by two
tasks and five by three. Fifteen records cannot hold ten corroborated routines: R99's own ratio
(73 records → 53 shapes → ten at support ≥2) puts the expected count at fifteen near one. So the
dispatched arm could not have measured the claim it registered **whatever the distiller had done**,
and nothing in the header said which store the claim lived in.

Two changes follow, both before any measurement exists:

1. The header now pins `distillScope: all`. The predictions and the refutations are unchanged.
2. `prereg.ts` refuses a `two-unit` arm that leaves the population to a variable, for the reason it
   already refuses a floor, a pair, note levels, units, a form and a pack mode there: a repository
   variable is global, and the fold's supply is exactly what the population decides.

The fifteen empty replies are a separate defect and are not amended here. They are instrumented
(`distillReplies`, the pre-flight, and the diagnostics a stop now carries), and whether the model
answers this population at all is the next run's question rather than a prediction of this one.

## The two legs

| leg | `shape` | what one line is |
| --- | --- | --- |
| control | `per-failure` | one correction: the failure that produced it |
| treatment | `collapse` | one routine: the medoid of the failures that taught it, evidence union *reported* |

Nothing else differs: same store (attested by `facadeScope`), same floor, same budget, same limit, same
diversity, same seed stream, same model, same held-out forty tasks, and the same facade process.

## Prediction

- The treatment arm folds at least one unit on this store, so `poc-l4-facade-shapes` reports a state other than `NO_TREATMENT`.
- Containment holds on every request the budget did not cut: zero mismatches between the treatment's served ids and the control's under the fold.
- The treatment arm serves fewer characters per request than the control arm, because a folded unit is one member's line and the group's other members are not rendered.
- The paired `pass^4` delta of the treatment against the control is not below **-5.00pp**, the revert bar this lane has graded every pack experiment against since R45.
- The control arm reports zero folded items on every request, which is what makes the switch's arrival checkable rather than assumed.

## Refutation

- `CONTAINMENT_BROKEN` refutes the run rather than the hypothesis: the arms differed in something the registration did not name, and no delta from it is quoted.
- `NO_TREATMENT` refutes the arm's premise on this store: the fold removed nothing, which is a finding about the store's recurrence and not evidence that the unit does not matter.
- A paired delta below **-5.00pp** refutes the fold as a default: the unit costs accuracy, and the revert is on the reading rather than on an explanation of it.
- Identical characters per request on both arms refutes the delivery claim: a fold that changed no rendered line did not reach the pack, whatever the state says.
- A treatment arm whose `itemsPerRequest` exceeds the control's by more than the fold removed refutes the containment reading and has to be explained before any delta is used.

## Why the claim is non-inferiority and not a gain

R93's paired design on this benchmark has a **minimum detectable effect of 21.02pp** over fifty paired
tasks. A registration that claimed a five-point gain would be claiming something the design cannot
detect, and this record has already paid for that mistake twice — once when a `-2.50pp` was read as a
fact about a pack (R101), and once when a cross-run difference was read as a contribution (defect 29).

So the registered claim is the one the design can falsify: **the fold does not cost score**, at the same
bar the lane reverts on. A gain is a thing R95's 114-task base could detect; it is not a thing this arm
may assert, and the readback prints the interval rather than a verdict on the point estimate.

## Cost

**~$1.21**, the same as R101's pair and for the same reason: 320 evaluation episodes (2 × 40 × 4) at
R85's billed band plus the wrapper's overhead on both legs, **and no learn half** — both facades read the
store this dispatch distils once, so the learning phase is paid once rather than twice.

R109a itself cost **$0**: it is the instrument, not a dispatch, and its own claims are about the
mechanism (containment, characters, the state machine) which the offline census already measures on the
committed corpus.

## What this unlocks

| reading | question it answers | comparable to |
| --- | --- | --- |
| `shape-contrast` | does one-line-per-routine cost or buy score at a fixed budget | ALTK's `sup2`/`sup3` cells, which are the only published support cells |
| `charsPerRequest` | what the unit costs, on the same run that produced the score | no competitor publishes a bill (Appendix AD) |
| `containment` | was the treatment the control under the fold, or two experiments in one artefact | this lane's own defect 29, in a second variable |
| `poc-l4-facade-shapes.folded` | how much recurrence this store actually had | R99's census, reproduced at run time |
