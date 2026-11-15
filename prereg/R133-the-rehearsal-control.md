---
id: R133-the-rehearsal-control
step: R133
opened: 2026-11-16
# R132's arm with two changes, both of them about the denominator. The addition is a third pass over the
# learn half with the store OFF — the control the four cells have never had. The reduction is one trial
# instead of two on the held-out half, because 74 learned + 40 evaluated + 74 replayed + 74 controlled = 262
# episodes, and a third pass at R132's two trials would be 302, one over the reader's ceiling.
arms: memory
sample: 262
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
# No gate, for R131's and R132's reason: the arm's subject is the store's behaviour on its own cases, and a
# gate would change the population both replays are compared with.
speakMargin: 0
rehearsal: true
# The switch this registration buys that R132 did not: the same 74 tasks, one trial, no store.
rehearsalControl: true
trials: 1
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

# R133 — the replay's own denominator

**Registered** 2026-11-16, after reading R132 (`43848545387`) and before any arm has compared a replay against
a store-off draw of the same tasks.

> R132 replayed the 74 learnt tasks against the store and read **5 repaired / 9 inert** of the 14 that had
> failed without memory, with **3 broken** of the 60 that had passed. `repairRate` 35.71%, own-case
> `harmShare` 37.50%.
>
> Those four cells divide by the population the store was *selected* on. `inert` means "failed without memory,
> then failed again with it" — and a task that fails two thirds of the time produces that cell whether or not
> the store did anything. R131 gave the reason to take this seriously: at the 0.05 rung its ladder withholds
> **60 of 160** requests, and the same arm's `pass^4` has now read **0.775** (R123a) and **0.625** (R131) in
> two dispatches. A lane whose own repeats move 15pp cannot read a 9-of-14 cell as a fact about the store.

## What is being tested

The same replay, run twice: once with the store (`microglia_agent`, R132's phase) and once without it
(`llm_agent` — the agent the learn half ran, no facade, no recall). Both run **the same 74 tasks at one trial**,
so the only difference between the two phases is the store.

The reading is the four cells recomputed against the *control* rather than against the learn draw:

| cell, against the control | meaning |
| --- | --- |
| repaired | the control failed and the store's replay passed — the item changed a case a fresh draw also failed |
| broke | the control passed and the store's replay failed — the item cost a case a fresh draw passes |
| inert | both failed — the task fails on its own, and the item neither helped nor hurt |
| kept | both passed |

`net = repaired − broke` over the 74 paired tasks is then the store's effect on its own cases with the draw
held fixed. It is the number R132 could not produce, and it is signed: a zero says the store changed nothing
net, which is a different claim from "it changed nothing".

## Prediction

- **Both replays pair 74.** They run the same list at the same trial count, so `control.reading.paired ==
  rehearsal.paired == 74`. Smaller is a plan defect, and the round fixes the plan before reading the memory.
- **The control's contrast is not degenerate: `repaired + broke ≥ 6`.** R132's raw reading had 8 discordant
  pairs against the learn draw (5 repaired, 3 broken). A control that disagrees with the treatment on fewer
  than six tasks is a second draw that reproduces the first — which would itself be a finding (the model is
  deterministic on these tasks) and would make the whole comparison uninformative.
- **The store is neutral-to-positive on its own cases: `net ≥ 0`.** R132's raw net was +2. If the fresh draw
  agrees — that is, if the 14 failures recur without the store — then the 9 `inert` cells are task difficulty
  and the store is neither repairing nor breaking its own cases. This is the prediction that makes the
  conditioning hypothesis survive.
- **`control.usage.usd` is present and `control.refused` is absent.** The control is a third paid phase; a
  phase whose bill exists only in a workflow log is the defect §179 was written about.
- **The held-out half claims nothing.** `published_bar_applies` must be `0` and the run must not print a
  `pass^4` claim: at one trial there is no k=4 reading, and R132 at two trials already showed what a
  differently-labelled k does (`pass4: 0.825, k: 2`). The held-out half of this arm is a lane check, not its
  product.

## Refutation

- **`control.reading.paired < 74`.** The two replays disagree about the task list. Nothing below is read.
- **`repaired + broke < 6`.** The control reproduces the treatment on nearly every task, so the store is not
  what moves these cases and this round cannot separate the two explanations. The next arm varies the store
  (a different distiller or admission rule) rather than the sample.
- **`net < 0`.** Then the store *hurts* the cases it was written from, by more than chance: the 9 `inert` cells
  were not difficulty, they were damage that did not show up as `broke` against the learn draw. Distillation is
  refuted as the explanation and the "right item, wrong trigger" hypothesis dies with it — the items themselves
  are the problem, and the next dollar is the write side (R129's outcome counter, write admission, a verifier)
  rather than the margin.
- **`net ≥ 0` but `repairRate < 0.25`.** The store is harmless on its own cases and repairs almost none of
  them. That is the **inert store** finding: held-out harm (29.6% in R123a) is then not the store's doing at
  all, and the next arm must attack whether the items are *reachable* — the pack, the scope key, the render —
  before anything else is changed.

## Decision rule, stated before the number

| outcome | what the next dollar buys |
| --- | --- |
| `net ≥ +2` | the store is right on its own cases and misapplied elsewhere → **conditioning**: the trigger, the margin ladder (0.05 withholds 60 of 160 in R131), the floor |
| `−2 < net < +2` | the store is inert on its own cases → **reachability**: pack and scope before distillation |
| `net ≤ −2` | the store damages its own cases → **write side**: R129, admission, a verifier |

The bands are ±2 because the discordant count is ~8: a difference of two cases is the smallest one this sample
can distinguish, and stating the band in advance is what keeps the readback from becoming a story.

## Cost

**~$0.51**, from R132's measured $0.00196 an episode over 262 episodes (74 learned + 40 evaluated + 74
replayed + 74 controlled), plus the third phase's packs. In time: R132 ran 228 episodes in 100 minutes
(0.44 minutes each, store included), so 262 episodes is about **115 minutes** — inside the 240-minute job with
room for the store and one rate-window boundary.

## What this unlocks

| reading | question it answers | what it decides |
| --- | --- | --- |
| `control.reading.net` | does the store change its own cases, with the draw held fixed | conditioning vs distillation vs reachability |
| `control.reading.inert` | how many of the 14 failures recur without the store | whether R132's 9 was difficulty |
| `control.reading.broke` | does the store cost cases a fresh draw passes | the own-case price of an item |
| `control.usage` | what a third phase costs | whether every rehearsal arm carries one |
