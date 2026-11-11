---
id: R77-inert-share
step: R77
opened: 2026-11-10
arms: loo
sample: 2000
temperature: 0
gates: V1,V2,V3,V4,V5,V6,V7,V8,V12,V32,V44,V48,V51
---

# R77 — how many of the rules change any answer at all

**Registered** 2026-11-10. `train`, 2,000 questions, deterministic sampling. **6,875 calls projected from
R74's measured rate** — `pnpm eval:budget --bird poc-sota-bird-train-R74-rule-causal.json --arms
none,full,loo --questions 2000` — ceiling **7,600**, **≈$0.60**.

The first version of this header said "two arms, ≈4,600 calls", and it was wrong in the same way R68's
was: `loo` is the third arm, not the second, because `none` and `full` are measured on every dispatch
whether or not a header names them. Two arms × 2,000 questions is 4,000; the run buys 6,000 before the
4% per-question overhead, and the planner's 6,875 is what the prior was actually billed.

## Why this file exists

R74 closed the question "which rules are harmful" and its answer was: the per-rule verdict is two
thirds regression artifact, and what survives it (+0.82pp on the 43% of questions that drew a harmful
rule) projects to **+0.35pp on the split, against a ±0.4pp interval**. There is no usable per-rule
signal, and there is no pruning to build on it.

That outcome leaves a question the lane has never asked, and it is more basic than any of the four
coordinates the negative effect has been placed on. **Does a rule change what the model writes?**

R74's artefact answers it, partly, for free: with one rule withheld, **4,074 of 7,829 pairs (52.0%)
produced byte-identical SQL** to the arm that had the rule in the pack. But R74 ran at **T = 0.7**, and
at T = 0.7 the same prompt can produce the same query twice by chance. The number is a mixture of
inertness and coincidence, and the mixture cannot be separated from that file.

**At T = 0 the mixture disappears.** A deterministic decoder given two prompts that differ by one rule
returns the same query if and only if the rule did not matter. So the measurement is not a statistic to
estimate — it is a count, and it costs one dispatch.

## The design, exactly

- **Split** `train`, the only population whose labels nobody has corrected (R75).
- **Questions** 2,000, drawn as the first 2,000 the fold assignment yields. Two thousand puts the
  standard error of a proportion at 1.1pp, which is finer than any branch boundary below.
- **Arms** `none` and `loo` — the second is R74's, unchanged: the `full` pack with **one rule withheld**,
  chosen by `looIndex(pack.items.length, question + fold)`.
- **Temperature 0**, declared in this header so that the dispatch cannot inherit a repository variable.
- **The reading is a count over `per_case`**, not a model call: `predictedSql` is the `full` arm's query,
  `armSql.loo` is the same question with one rule withheld, and the pair is *live* when the two strings
  differ after whitespace normalisation.

## Prediction

- **The corrected pair-level inert share lands between 30% and 55%.** R74's 52.0% at T = 0.7 is a mixture;
  the deterministic share should be below it, and the gap is the coincidence rate of a temperature-0.7
  decoder on this prompt.
- **Per-rule inertness will be much higher than pair-level inertness.** A rule drawn on fourteen
  questions needs to be decisive on none of them to be called wholly inert, and with 1.86 rules per
  question no single rule should be decisive every time.
- **The rules that are live will be concentrated.** The 540-rule pack was distilled from 7,829 failures,
  and a failure that generalises is rare.

## Refutation

- **If the pair-level inert share is above 70%**, the pack's premise is wrong rather than its dose: most
  rules are text the model does not act on, and the next intervention is the distillation prompt rather
  than admission, pruning or position.
- **If it is below 30%**, most rules are live and the problem is that they are live in the wrong
  direction — which returns the lane to R74's residue and makes the dose the only remaining axis.
- **If the deterministic reading is within 2pp of R74's 52.0%**, then the temperature-0.7 decoder is
  nearly deterministic on this prompt and the mixture was never a mixture: the 52% is the inert share,
  and R74's whole-split null has a mechanical explanation that no effect size can distinguish from "the
  pack is mostly noise".

## What this file does not do

It does not measure whether a live rule is *right*. A rule that changes the answer and makes it worse is
as live as one that fixes it, and separating those two is R74's question, which has been answered at the
strength it could be. This file measures only whether the pack is doing anything at all.

## Amendment 1 — the first dispatch was authorised for two thirds of itself

**2026-11-10, before any reading.** The dispatch (`42915903394`) ran fold 1 and stopped:

```
[sota] fold 1/5: eval=400 learn=700 edited=272 unanswered=0 distillFailed=0 active=521 calls=1952
[sota] budget forecast after fold 1/5: the run needs about 10541 calls, the ceiling is 7600 (short by 2941)
[sota] failed: MG_E_BUDGET_EXCEEDED: the configured ceiling cannot finish the folds
```

1,952 calls spent, no artefact. The ceiling did exactly what R74's amendment built it to do — only a
ceiling may end a run — but it ended a run whose *authorisation* was wrong rather than one whose
forecast was. Nothing was overspent; the run was refused permission to finish.

**Why the projection was 6,875.** `pnpm eval:budget` priced 2,000 questions × 3 arms at R74's measured
**1.0416 calls per question per draw**. That rate is a mixture, and the mixture is the defect: R74
spent 700 *learning* calls per fold against a `GenerationCache` that deduplicated 2,624 of the 3,500
learning requests, so most of its learning was free and the rate is mostly a marginal per-question
cost. **The learning pass does not scale with `limit`.** A projection that multiplies a
cache-warm mix onto a smaller question sample with a cold cache prices the cheap part correctly and
omits the expensive one. Fold 1 of this dispatch paid all 700.

This is the third instance of one error class, and each instance moved up a level: R64 sized a run by
arm count, R68 found the arm count was a draw count, and this one found that a per-question rate is a
rate only over the part of the bill that is per question.

**Amended budget.** 11,000 forecast, **12,000 ceiling**, deadline 200. The upper bound is five folds at
the dearest fold's price — 5 × 2,147 — and the ceiling is that plus the same 9% margin the planner
uses. ≈$0.95 for the dispatch, ≈$1.12 for the registration including the fold that was thrown away.

## Amendment 2 — the first dispatch would have finished

**2026-11-10, after the reading.** The second dispatch (`42922152605`) spent **6,946 calls** and
**$0.531** over five folds. That is inside the **7,600** the first dispatch was authorised for. **The
first dispatch was not under-sized; it was stopped by a forecast that projected fold 1's price onto four
folds it did not describe.**

Fold 1 of the first dispatch cost 1,952 calls: 1,200 evaluation, 700 learning, 52 other. The `GenerationCache`
answered none of that learning because a cache with nothing in it cannot. The in-run forecast multiplied
that fold by five and reported 10,541. In the completed run the cache answered **2,623 of 3,500** learning
requests — the same 75% it answered in R74 — so the whole learning pass cost **877 calls, not 3,500**, and
the run came in at 6,946.

**Amendment 1 above is therefore wrong about its central sentence.** It said the registration was
"authorised for two thirds of itself". It was authorised for 91% of what the run actually needed. What
was wrong is the instrument that decided, and the defect it exposes is one level further in than the one
Amendment 1 found:

- `planBudget` priced the dispatch at 6,875 before it ran, and the run cost 6,946 — accurate to 1%.
- The corrected `planBudget` prices it at 7,593 projected / 11,249 bounded, and both bracket the truth.
- **`forecastBudget` projected 10,541 for a run that cost 6,946, an over-estimate of 52%, and the ceiling
  obeyed it.**

A forecast that extrapolates the *dearest completed fold* is an upper bound, and an upper bound is what a
ceiling should be compared against — but this one names the cold-start fold as if it were typical, so the
bound grows with exactly the quantity that shrinks. The repair belongs in `forecastBudget`: the first
fold's learning is paid once, so it is a start-up cost and not a per-fold rate. Amendment 1's mechanism
(the learning pass does not scale with `limit`) is right; its arithmetic assumed the pass was paid per
fold rather than deduplicated across them, and its conclusion about *this dispatch* is withdrawn.

What the mistake cost: **1,952 calls, about $0.15**, and one fold of data that was thrown away.

## Outcome — 2026-11-10, dispatch `42922152605`

**6,946 calls, $0.531, 5 folds, 2,000 questions, `none,full,loo`, `temperature: 0`.** Gates all pass;
`n` 2,000/2,000 with no leak; 1.83 rules injected per question.

### The reading

| reading | value |
| --- | --- |
| pairs compared | 1,999 (1 with no statement on one side) |
| **inert** | **1,114 — 55.73%** (5 live pairs differ only by case) |
| rules ever withheld | 472; draws per rule median **3**, p90 9, max 28, mean 4.24 |
| **rules that never changed an answer** | **113 — 23.9% of the pack** |
| rules live on ≥75% of their draws | 102 — 21.6% |
| live share 1–25% / 25–50% / 50–75% | 24 / 105 / 128 |
| concentration | the busiest tenth produced **33.3%** of the live answers |

**No branch fires, and that is the outcome.** The file named three: above 70% (the distillation prompt),
below 30% (the dose), within 2pp of R74's 52.0% (the mixture was never a mixture). The reading is
**55.73%**: above the prediction's own ceiling of 55%, and **1.7pp outside the window in which the
temperature-0.7 decoder would have been nearly deterministic**.

**Prediction 1 is falsified by 0.73pp, and in the direction that matters.** The band was 30–55% on the
reasoning that the deterministic share must sit *below* R74's 52.0% at T = 0.7, the gap being coincidence.
The deterministic share is **higher** than the mixture it was supposed to be a component of. The pack is
more inert than predicted, and the coincidence explanation for R74's number is dead: at T = 0, where
coincidence is impossible, the share does not fall — it rises, on a different pack and a fifth of the
population, but by more than the 2pp the branch allowed.

**Prediction 2 is falsified, and it was arithmetically impossible as written.** "Per-rule inertness will
be much higher than pair-level inertness" cannot hold for rules with more than one draw: a rule live on
some draws contributes identical pairs on the others, so pair-level inertness is an average over rules
and wholly-inertness is a per-rule extreme, and the extreme is below the average unless the pack is
bimodal. It is bimodal — that is the finding — but the prediction asserted the opposite relation.

| what the pack is made of | share | per-rule live rate |
| --- | --- | --- |
| never fires | **23.9%** | 0 |
| fires sometimes | 54.5% | ~0.5 |
| fires on ≥75% of draws | **21.6%** | ≥0.75 |

**Prediction 3 holds.** A third of the live answers come from a tenth of the rules.

### What the split says about memory

| arm | accuracy |
| --- | --- |
| `none` | 61.55% |
| `full` | 61.80% |
| `loo` (one rule withheld) | 60.90% |

Withholding one rule **improves** accuracy by **−0.90pp** [−1.90, 0.10], p = 0.0886 — the widest-sample
out-of-sample reading of the negative effect this lane has, and the first at temperature zero. The
cross-fitted class table is empty: harmful **+0.00pp**, helpful **+0.00pp**, neutral −1.21pp
[−2.58, 0.16], with 224 pairs withheld a rule no other fold saw. A rule class that survives cross-fitting
does not exist in this pack, which is R74's conclusion reproduced on a population whose draws were
randomised rather than hash-fixed.

### What this file did not expect

**A quarter of the pack is dead weight and a fifth of it is the pack.** Neither number was a branch, and
both are more actionable than the pair-level share: the 113 rules that never fired are a pruning
candidate on *evidence of absence* rather than on a regression artifact, and the 102 that fire on most
draws are the instrument. But 113 rules at a median of 3 draws each is weak evidence per rule — a rule
live half the time is silent on three draws 12.5% of the time, so most of the 113 could be noise. The
honest next measurement is not a pruning; it is **giving those 113 more draws** and asking whether any of
them ever fires.

## Amendment 3 — the repair, replayed on both dispatches

**2026-11-10, after the outcome.** The repair Amendment 2 asked for is in `forecastBudget`: `FoldSpend`
now carries the optional `learning` figure, measured around the fold's learning pass rather than assumed
from the question count, and the extrapolation takes the maximum of `calls - learning` instead of the
maximum of `calls`. Taking the net cost *before* the maximum, rather than subtracting learning from the
maximum, keeps the original rule — the remaining folds are priced at the dearest one — while refusing to
charge a one-off to folds that read it from the cache.

Replayed on the two ledgers it was derived from, with nothing else changed:

| dispatch | forecast then | forecast now | actual | error then | error now | cap | verdict now |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R77 (1,952 after fold 1, 700 of it learning) | 10,541 | **7,461** | 6,946 | +52% | **+7.4%** | 7,600 | finishes, 139 to spare |
| R74 (5,483 after fold 1) | 29,609 | **≤ 26,529** | 24,465 | +21% | ≤ +8.4% | 28,000 | finishes for any pass above 366 calls |

R74's row is a threshold and not a replay because its artefact records calls per fold and not learning
per fold — the field is new. The break-even is 366 calls of learning in fold 1; the pass cost 877 in R77,
which pays it in the same place, so the direction is not in doubt but the figure is a bound. The test
that carries this states the threshold rather than asserting a measurement the artefact cannot support.

Three tests pin the new behaviour: the R77 replay, the R74 threshold, and the one that keeps the
dearest-fold rule honest when a *later* fold is dearer than the net of the cold one. Two more pin the
edges that make it safe to ship — a fold with no `learning` field forecasts exactly as before, so no
published figure moves, and a fold that reports more learning than it spent is clamped rather than
subtracted, because a negative cost would quietly raise the ceiling the run believes it has.

**What this does not fix.** The forecast is still an extrapolation from a sample of one to four folds,
and the +7.4% residual is the folds not being priced alike. That is what the 10% safety factor is for and
it is now the only thing the safety factor has to cover, which is the difference between a bound that
absorbs fold-to-fold variation and a bound that absorbs a structural error.
