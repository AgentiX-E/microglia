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
