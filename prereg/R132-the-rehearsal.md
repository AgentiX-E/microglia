---
id: R132-the-rehearsal
step: R132
opened: 2026-11-16
# R123a's arm configuration — same lane, split, domains, store identity — with one addition and one
# reduction. The addition is the replay of the learn half against the store it wrote; the reduction is two
# trials instead of four, because the replay is a second pass over 74 episodes and one 240-minute job
# carries 228 of them, not 308.
arms: memory
sample: 228
gates: V0,V1,V2,V3,V5,V8
recallFloor: 0
facadePair: off
facadeNotes: off
facadeShapes: off
distillScope: all
distillUnit: correction
distillForm: lesson
consolidate: true
consolidateKey: routine
# No gate, for R131's reason: this arm's subject is the store's behaviour on its own cases, and a gate
# would change the population the replay is compared with.
speakMargin: 0
# The one switch this registration buys. 74 learned + 80 evaluated + 74 replayed = 228 episodes, which the
# reader checks in `header 'rehearsal'`'s arithmetic before the first model call.
rehearsal: true
trials: 2
trainDomain: retail
testDomain: retail
recallDomain: retail
packBudget: 2400
taskSplit: official
trainTasks: 74
testTasks: 40
release: v1.0.1
claimRuler: interval
---

# R132 — the store on the cases it was built from

**Registered** 2026-11-16, after reading R123 (`43801571591`) and R131's dispatch, and before any arm has
replayed a store against its own learn half.

> R123 measured a harm share of **56.7%** on the outcomes its gate changed. R123a, with the same store and no
> gate, measured **29.6%**. Those two numbers describe one store and cannot be told apart by any reading this
> lane has: a store that is **wrong** and a store that is **right but applied where it does not belong** both
> produce a harm share, and they call for opposite fixes — a write-side fix (admission, verification, R129's
> outcome counter) or a conditioning fix (the trigger, the margin, the floor).

## What is being tested

An item is distilled from a **failure**: the learn half runs every training task with no memory, and the
tasks that failed are what the corrections are written from. Replaying those same tasks **with** the store
asks the one question no held-out number can: *does an item repair the case that wrote it?* Four cells, from
two reward sets paired by task:

| cell | meaning |
| --- | --- |
| repaired | failed without memory, passed with it — the item worked on its own case |
| broke | passed without memory, failed with it — the item made a case worse that needed no help |
| inert | failed both times — the item was absent, irrelevant, or wrong in a way that changed nothing |
| kept | passed both times — nothing to repair, and the store did not break it |

The reading is `repairRate = repaired / (repaired + inert)` and `harmShare = broke / (repaired + broke)`.
The first divides by the **failures** the store was written from; the second divides by the **outcomes the
store changed**. They answer different questions and neither is a held-out score.

## Prediction

- **All 74 learn tasks pair.** The learn half ran one trial per task and the replay runs the same list at one
  trial, so `paired == tasks == 74`. A smaller number is a plan defect — the two phases disagreeing about the
  split — or a task whose reward was `null`, and either way the replay is not evidence about the memory.
- **The store serves its own cases: `served ≥ 60 of 74`.** These questions are what wrote the items, so
  retrieval should be at least as good here as on held-out tasks, where R123a served 162 of 162. Below 60 the
  finding is scoping or the pack budget, and this round reports it as a retrieval finding rather than as a
  distillation one — the distinction `served` exists to make and the four cells cannot.
- **`repaired > broke`.** The store converts more of its own failures than it breaks. This is a comparison of
  two counts, so it has no denominator to argue about, and it falsifies "the items are simply wrong" outright.
- **`repairRate ≥ 0.25`.** At least a quarter of the failures that wrote the store are repaired by it.
- **`harmShare < 0.5670`** — the store breaks a smaller share of the outcomes it changes on its own cases than
  it did on held-out tasks under R123's gate. This is the conditioning hypothesis stated as a number: if
  own-case harm is **not** lower than held-out harm, then the gate is not what made R123 harmful and the
  explanation has to be the items themselves.
- **The replay's own bill is in the artefact.** `rehearsal.usage` carries the phase's calls and cost, and
  `rehearsal.refused` is absent. A second paid phase whose bill exists only in a workflow log is the defect §179
  was written about; a `refused: peak-window` would mean the arm started too late for its own third phase, which
  costs the reading without costing correctness and is a dispatch error rather than a result.

## Refutation

- **`paired < 74`.** Then the two halves disagree about the split, the replay is not about this store, and the
  round fixes the plan before it reads the memory.
- **`served < 60 of 74`.** Then the store cannot reach its own cases, and every reading above is about
  retrieval. The next arm is a scope or budget arm, not a distillation arm — and R123's harm share stays
  unexplained.
- **`repaired ≤ broke`, or `repairRate < 0.25`.** Then the items do not repair the failures they were distilled
  from: the finding is **distillation**, the conditioning hypothesis is dead for this store, and the next
  dollar goes to the write side (R129's outcome counter, write admission, or a verifier) rather than to the
  trigger or the margin.
- **`harmShare ≥ 0.5670`.** Then the store is as harmful on its own cases as on held-out ones, and the
  difference R123 and R123a showed is the *gate's* selecting which requests get an item — not a mismatch
  between the case an item was written from and the case it was served on. That reading would move this lane's
  open question from "conditioning vs distillation" to "which requests the gate should withhold", and R123's
  15pp `pass^4` cost is then the price of asking it.

## Cost

**~$0.94**, from R123a's measured $0.0041 an episode over 228 episodes (74 learned + 80 evaluated + 74
replayed), plus the replay's packs. In time: 228 × 0.75 minutes ≈ 171 minutes plus ~40 for the store, inside
the 240-minute job — which is why this arm buys two trials instead of four and why `readPrereg` now refuses a
rehearsal arm that would not fit one job.

## What this unlocks

| reading | question it answers | what it decides |
| --- | --- | --- |
| `repairRate` | is the store right on the cases that wrote it | distillation fix vs conditioning fix |
| `harmShare` on own cases | is the harm a match problem or an item problem | whether R123's gate finding generalises |
| `served` of the replay | can the store reach its own cases at all | retrieval vs distillation as the next arm |
| `rehearsal.usage` | what a second phase costs | whether every future arm carries a replay |
