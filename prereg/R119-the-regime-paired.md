---
id: R119-the-regime-paired
step: R119
opened: 2026-11-15
# One arm, and the reason is arithmetic rather than preference. This arm claims an absolute score
# against a fixed bar, not a delta between two arms, so it does not need a control inside the
# dispatch — and it could not afford one: R104's single arm took 177 wall-clock minutes for 160
# episodes, and the L4 job's ceiling is 340. Two arms at 68 tasks is 544 episodes, about ten hours.
# A registration that names a control it cannot finish is a registration that buys nothing.
arms: memory
sample: 160
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
testTasks: 40
release: v1.0.1
---

# R119 — the regime, paid for: what a store fourteen times larger does to a score, at R104's own `n`

**Registered** 2026-11-15, after R118 answered the question this arm exists to price.

> **R104** (`43589735959`) asked 73 corrections and got **10 answers**: `answered: 10, blank: 63`, 16
> candidates, 6 stored, one store served whole to 164 requests at a 4.76% median coverage,
> `pass^4 0.550` on 40 tasks.

> **R118** (`43623858218`) ran the same 73 corrections under a stated `thinking: 'off'` and got
> **73 of 73 answered**, `blank: 0`, 143 candidates, **86 stored**, 67,859 characters,
> `silence.state: answered-everywhere`.

So the store this registration evaluates is not R104's store. It is fourteen times larger, and
nothing has measured what it does to a score.

## What one dispatch changes

Nothing about the arm. This is R104's lane, R104's split, R104's `n`, R104's form and model, with the
regime R112 and R118 have both documented.

| change | what it is |
| --- | --- |
| `thinking: 'off'` stated by the client | R104's regime was an inherited endpoint default |
| `storeItems`, `store`, `yield` in the artefact | R118 wrote a store and could not say what was in it |

## The three rulers, and which one this registration is measured with

The record has been reading its own numbers with one ruler and stating conclusions with another.
Three different quantities are in play and they differ by nearly a factor of three:

| what is claimed | the ruler | at n = 40 | at n = 68 |
| --- | --- | --- | --- |
| a paired delta, from one dispatch's two arms | `detectableDelta(tasks, d)` | 44.30pp (`d=1`) / 27.91pp (`d=0.397`) | 33.98pp / 21.41pp |
| **an absolute score against a fixed bar** | `1.96·sqrt(p(1−p)/n)` over tasks | **±15.42pp** | ±11.86pp |
| two runs from different samples | `1.96·sqrt(p₁(1−p₁)/n₁ + p₂(1−p₂)/n₂)` | 17.65pp against ALTK's 114 | 14.65pp |

**This registration claims the second row.** It does not claim that memory beats a control inside
this dispatch — that claim needs two arms and the wall clock will not carry them, which is why `arms:
memory` and not `memory, reference`. What it claims is a score on 40 tasks, measured against a bar
fixed before the run.

## Prediction

- `distillReplies` reads `answered: 73, blank: 0` and `funnel.stored` is **86**, not 6 — the regime
  reproduces on a dispatch that goes on to evaluate.
- `storeItems` carries the text of the 86 claims, `faithfulness.kept`/`.entities` and
  `coverage.medians` are the readings this arm is really buying, and `yieldCensus` says which
  corrections taught nothing.
- The score is reported with its binomial interval, not as a point.

## Refutation

- **The score must clear 0.75 to be called above the 0.575 bar.** At n = 40 the interval's lower
  bound is `p − 15.42pp`, so 0.65 gives 0.502 and 0.70 gives 0.558 — both below the bar. A score of
  0.72 reported as *beating* 0.575 refutes this registration's own arithmetic, not the bar.
- **A score below 0.55 with 86 claims where 6 gave 0.550** refutes the reading that the memory null
  was a store-size problem, and moves the lever to what the claims say — §192's finding that all six
  were format, and R117's ban, become the next dollar.
- **A `blank` count above zero** refutes the regime statement, because `distillClient` states
  `thinking: 'off'` and the artefact carries `reasoningTokens`.
- **`funnel.stored` far below 86** refutes the reproduction rather than the regime: this arm and R118
  share a distiller and differ only in what happens after it.

## Why `effectClaimPp` is absent, and what that costs

A header field refuses a claimed effect its own sample could not resolve. On 40 paired tasks the floor
is 44.30pp, so any delta claim here would be refused — correctly, and that is why no delta is claimed.
The field's other job is moot: with one arm there is no delta to claim at all.

**This is a descriptive arm.** It buys a store's text and a point estimate with an interval, for $0.89
in 177 minutes. It cannot buy a SOTA statement, and the arithmetic above says why: 40 tasks resolve a
15.42pp half-width on an absolute score, which separates 0.55 from 0.75 and does not separate 0.55
from 0.575.

## Cost

**~$0.89**, R104's own billed figure for the same shape: 160 episodes, about 2,400 agent calls,
73 distillation calls, 177 wall-clock minutes against a 340-minute ceiling.

## What this unlocks

| reading | question it answers | what it decides |
| --- | --- | --- |
| `storeItems` on 86 claims | whether the 14× store is operational or still format | whether R117 (the ban) or R113a (the unit) is the next dollar |
| `faithfulness.kept` / `.entities` | how much concrete value survives the abstraction | whether the ban is the thing removing it |
| `coverage.medians` | how much of a request an injected claim covers | whether 4.76% was the store or the population |
| the absolute score and its interval | whether 14× the store moves a score at all | what the next `n` has to be, and on which lane |
| the facade split | whether the 17.5pp null contrast survives a different store | whether any τ² number can be ordered |
