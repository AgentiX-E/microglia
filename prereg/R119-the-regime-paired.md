---
id: R119-the-regime-paired
step: R119
opened: 2026-11-15
# Two arms, because a delta needs something to be a delta from. R104 bought `memory` alone and
# published a `pass^4` against a bar from another paper; `armsAgainstRegistration` now compares this
# list with what a dispatch buys in both directions, so a dispatch of one arm is refused rather than
# quietly producing a number that has no control in it.
arms: memory, reference
# 68 tasks × k=4 = 272 episodes. Not a round number: 68 is the split the `-67` evidence files were
# drawn on, so this is comparable with the one τ² pairing on disk. The floor is stated in tasks, not
# episodes — a pairing is one per task — and 40 tasks would put it at 44.30pp against this design's
# 33.98pp, which is the difference between a reading that could see a large effect and one that
# could not.
sample: 272
gates: V0,V1,V2,V3,V5,V8
recallFloor: 0
facadePair: off
facadeNotes: off
# Kept because R104 ran it: the two-unit facade split is what produced the 17.5pp null contrast, and
# an arm that dropped it would not be comparable with the dispatch it is repeating.
facadeShapes: two-unit
distillScope: all
distillUnit: correction
distillForm: lesson
trainDomain: retail
testDomain: retail
recallDomain: retail
packBudget: 2400
taskSplit: official
trainTasks: 74
testTasks: 68
release: v1.0.1
---

# R119 — the regime, paid for: one store built under a stated regime, measured against its own control

**Registered** 2026-11-15, after R118 answered the question this arm exists to price. Three readings
are on disk and none of them is this one:

> **R104** (`43589735959`) asked 73 corrections and got **10 answers**: `distillReplies {calls: 73,
> answered: 10, blank: 63}`, 16 candidates, 6 stored, one store served whole to 164 requests at a
> 4.76% median coverage, `pass^4 0.550` against a 0.575 bar.

> **R112** (`43621097332`) asked one fixture of 8 candidate `(model, form)` pairs under a stated
> `thinking: 'off'` and **every one answered**, `reasoningTokens: 0` on every call, `lesson` best of
> the four forms. Model and form are excluded as explanations.

> **R118** (`43623858218`) ran the same 73 corrections under the same stated regime and got
> **73 of 73 answered**, `blank: 0`, `143 candidates`, **86 stored**, 67,859 characters,
> `silence.state: answered-everywhere`. The regime was the whole of it.

So the store this registration evaluates is not R104's store. It is fourteen times larger, built from
seven times as many answers, and **nothing has ever measured what it does to a score**.

## What one dispatch changes

Nothing about the arm. This is R104's lane with a regime that R112 and R118 have both documented, and
one change to the dispatch rather than to the experiment:

| change | what it is | why it is not a treatment |
| --- | --- | --- |
| `memory` **and** `reference` bought together | R104 named one arm | the reference arm is the control the delta is measured against, so it cannot move what the memory arm does |

Everything else is R104's: `distillScope: all`, `distillUnit: correction`, `distillForm: lesson`, the
official 74/68 split, `packBudget: 2400`, `release v1.0.1`, `deepseek/deepseek-flash`,
`facadeShapes: two-unit`.

## Prediction

- `distillReplies` reads `answered: 73, blank: 0` and `funnel.stored` is **86**, not 6 — the regime
  reproduces on a dispatch that goes on to evaluate.
- `storeItems` carries the text of the stored claims, and `faithfulness`/`coverage` are the readings
  this registration is really buying: whether 86 claims are still format, and how much of a request
  an injected claim now covers.
- The paired delta is reported with its interval and its floor, and the facade split is reported
  beside it rather than instead of it.

## Refutation

**The floor is 33.98pp on 68 paired tasks**, from `detectableDelta(68, 1)` — complete discordance,
which no run reaches. So:

- A paired delta **below 33.98pp is not a finding** and this registration forbids quoting it as one,
  whatever its sign. The most likely outcome of this dispatch is a number in that band.
- At the discordance the last τ² pairing actually showed — 27 of 68 tasks changing hands — the
  minimum detectable difference is **21.41pp**, which is the number a result on this lane is measured
  against in practice.
- A delta **above those bounds in favour of memory** is the first effect this lane has ever been able
  to resolve, and it is attributable to the store the stated regime builds.
- A delta **above those bounds against memory** refutes the repaired store on its own population and makes
  R117 (the ban, on and off) the next dollar rather than R113a.
- `funnel.stored` far below 86 on an evaluating dispatch refutes the reproduction, not the regime:
  R118's census and this arm share a distiller and differ in what happens after it.
- A `blank` count above zero refutes the regime statement itself, because `distillClient` states
  `thinking: 'off'` and the artefact carries `reasoningTokens`.

## Why `effectClaimPp` is absent

A header field now refuses a claimed effect its own sample could not resolve, and on this design it
would have to be **above 33.98pp** to pass — which is honest and is also larger than any effect this
project has measured anywhere. It is not written because the size of this effect is the question, not
the premise: a registration that states a number it does not believe is a registration that has
already decided what it will find.

The field's second job is done anyway. `armsAgainstRegistration` compares this header's two arms with
what a dispatch buys in both directions, so a dispatch of `memory` alone against this file is refused
before it spends anything.

## Cost

**~$3.04**, which is two arms at R85's billed band: 272 episodes each, about 4,100 agent calls, and
73 distillation calls charged once. R104's `memory` arm alone cost $0.8938 for 160 episodes, so this
is that number scaled to 272 and doubled — and the doubling is the part R104 skipped.

## What this unlocks

| reading | question it answers | what it decides |
| --- | --- | --- |
| the paired delta and its interval | what a 14× store does to `pass^4` | whether the memory null was ever about memory |
| `storeItems` + `faithfulness.kept` + `coverage` | whether 86 claims are operational or still format | whether R117 (the ban) or R113a (the unit) is next |
| the facade split | whether the 17.5pp null contrast survives a larger sample | whether any number on this board can be ordered at all |
| `yieldCensus` | which corrections taught nothing and which taught six | whether the population or the writer is the ceiling |
