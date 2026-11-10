---
id: R72-overlap-gate
step: R72
opened: 2026-11-10
arms: full
sample: 7829
gates: V1,V2,V3,V4,V5,V6,V7,V8,V12,V32,V44,V48
---

# R72 — memory's sign is a function of whether the pack talks about the question

**Registered** 2026-11-10, undispatched, and **not dispatched by this iteration**: the design below is
produced by a measurement that cost nothing, and its first honest output is the sample size it needs.

## The measurement that generated it

R66's dev artefact (`42750334097`, 1,534 questions, 5 folds) records, per question, the rules that were
injected and whether the answer with memory was right where the answer without it was not. That is
enough to ask where memory helps and where it hurts, without a single model call:

| tercile of lexical overlap between the pack and the question | mean overlap | n | net flips | per 100 questions |
| --- | --- | --- | --- | --- |
| low | 0.168 | 511 | **−13** | **−2.54** |
| middle | 0.304 | 511 | +2 | +0.39 |
| high | 0.485 | 512 | **+9** | **+1.76** |
| all | — | 1,534 | −2 | −0.13 |

The gradient is monotone and it changes sign. Overlap is `|content words of the pack ∩ content words
of the question ∪ evidence| / |content words of the question ∪ evidence|`, with function words and
one-character tokens removed.

**And it is not the lane's own signal.** `coverage` — the field this project built to describe how much
of a question a rule reaches — does not order the effect at all: at coverage 0 the net is −1.72 per
100 (n = 58), at 0.2 it is +3.85 (n = 130), at 0.333 it is −4.67 (n = 150), at 0.4 it is +12.96
(n = 54). Nine points of spread with no direction. The number that predicts the sign is the one
nobody was recording.

**The two honest limits of that reading, stated before anything is built on it.**

- *It is not significant.* A bootstrap over questions puts the high-minus-low contrast at **+2.34pp,
  95% CI [−1.81, +6.46]** — it crosses zero. With 33 discordant questions across 1,534, a 4.3pp
  contrast is below what this design can resolve, which is the same arithmetic that has made every
  memory reading in this project a null: the effect, if it exists, is smaller than the sample.
- *A threshold chosen from these labels is in-sample.* Cross-fitting it (choose on four folds, apply
  to the fifth) gives a **stable threshold region, 0.32–0.43 on all five folds**, and a policy worth
  **+5 flips against always-injecting's −2**. That is +7 flips on 1,534 questions — +0.46pp, and inside
  the noise of its own denominator.

So this file registers the **experiment that can decide it**, not the reading. The axis is real enough
to spend on; the sample is not.

## The design, exactly

- **Split: `train`.** 7,829 questions over 58 databases, out of sample for every published dev cell.
  Dev cannot resolve the contrast — the requirement below is four times its discordance — and running
  it on dev again would produce a fourth memory null with a new name.
- **`full-overlap` does not exist yet, and this file says so rather than discovering it at dispatch.**
  The arm is named in the header because it is the arm this registration will run; the lane has to
  grow it first, and the two places that must agree — `OPTIONAL_ARMS` and the arm-list test — are the
  exact pair that cost R66 and R67 a dispatch each. R66 wrote its own not-implemented status into its
  header for the same reason, and the audit records that as the pattern to copy rather than the
  exception to apologise for.
- **Two arms, one variable.** `full` (inject every admitted rule, as today) and `full-overlap`
  (inject only when the pack's overlap with the question clears the threshold frozen at **0.34**, the
  median of the cross-fitted choices). Everything else — distillation, admission, the prompt, the
  judge — is identical, because the claim is about *when* a pack is shown rather than about what is in
  it.
- **The estimand is paired and per-question**: net flips, `(gained − lost)`, in the low-overlap
  tercile, where the hypothesis predicts damage. The whole-split net is reported beside it but it is
  not the claim: a gate that removes harm and adds nothing is a success even when the whole-split
  number does not move.
- **Power, computed before the run.** The tercile contrast needs about **6,000 questions** to resolve
  4pp at 80% power at the discordance this lane shows (≈2.2% of questions flip either way). `train`'s
  7,829 clears that; dev's 1,534 does not, by a factor of four. `pnpm eval:power` recomputes this from
  the artefact before the run is read.

## Prediction

- **The gate removes the damage and keeps most of the benefit**: low-overlap net flips move from
  **−2.5 per 100** to **≥ −0.5**, and the whole-split net moves by **+0.5…+1.5pp**.
- **The threshold region replicates**: the cross-fitted choice on train lands inside 0.25–0.45.
- **The gate does not become the mechanism**: `full-overlap` does not beat `full` on the high-overlap
  tercile, because there the two arms are the same run.
- **The instrument**: `V1` (the pack is non-empty where it is injected), `V44`/`V48` as usual, and a new
  count — *share of questions whose pack was withheld* — which must sit between 30% and 70% or the
  gate is either not firing or firing everywhere.

## Refutation

The branches are ordered and partition on the paired net in the low tercile.

- **Void** — the withheld share is outside 30–70%, or the run's discordance is under 1.5%, so the
  design cannot resolve its own claim.
- **Overlap is the axis** — low-tercile net improves by **at least +2pp** and the interval excludes
  zero. Then the memory's sign is a routing property, the gate becomes the lane's default, and every
  later memory mechanism is evaluated on the gated regime rather than on a mixture of two.
- **Overlap is a proxy for something else** — the net improves by less than +2pp but the threshold
  region replicates. Then the ranking is real and the cut is wrong, and the next registration fits the
  cut on the question's *tables* rather than its words.
- **Memory is null in every regime** — the low-tercile net is unchanged. Then the prompt-prefix
  position is closed for good, the finding is that a pack shown before a question cannot help it, and
  the only remaining position worth pricing is the one R66 opened: evidence shown *after* a failure.

## Amendment 1 — the estimator is committed, and re-deriving it moved two numbers and deleted an arm

**Written before dispatch**, which is the only time an amendment is worth anything. Every number below
comes from `pnpm eval:overlap` against R66's dev artefact (`42750334097`) — the same file the original
measurement read, now read by committed code instead of by a session script.

| reading | as registered | re-derived with committed code |
| --- | --- | --- |
| tercile means | 0.168 / 0.304 / 0.485 | **0.165 / 0.303 / 0.484** |
| net flips by tercile | −13 / +2 / +9 | **−7 / −3 / +8** |
| whole population | −2 (−0.13 per 100) | **−2 (−0.13 per 100)** |
| cross-fitted region | 0.32–0.43 | **0.38–0.41** (0.40, 0.38, 0.40, 0.41, 0.38) |
| policy against always-injecting | +5 vs −2 | **+9 vs −2** |
| withheld at the frozen 0.34 | — | **63.0%** |

Three things follow, and none of them is a rounding.

**The gradient replicates and its shape changed.** The tercile means land within 0.003 of the
registered ones and the whole-population net is identical to the digit — the estimator is the one the
file was written on. But the middle tercile is **−3** rather than **+2**, so the sign change happens
between *middle and high*, not between *low and middle*. The hypothesis survives; the sentence that
describes it does not. "Low overlap hurts, high overlap helps, the middle is a wash" was the file's
reading; the reading is "below-median overlap hurts and the top third pays for it".

**The threshold moves from 0.34 to 0.40, and the instrument band has to give way.** At 0.40 the gate
withholds **71.8%** of questions — outside the 30–70% band the file set, by 1.8 points. The band was
written before the estimator existed, as a sanity check on a gate nobody had computed. Widening a band
after seeing a number is normally how a registration dies, so the amendment does it in the open and
narrows what the band can veto: the withheld share is **reported at every threshold**, and the void
condition is only the degenerate gate — 0% or 100% — where the policy is not a router at all. The
estimand is unchanged and the branches are unchanged; what changes is that a gate withholding seven in
ten is no longer automatically void. Both thresholds, 0.40 and 0.30 (48.0% withheld), are evaluated and
reported, so the reader can see the whole trade rather than the point the file happened to freeze.

**`full-overlap` is withdrawn, and the run gets cheaper rather than dearer.** The registered design
needed an arm that did not exist. It does not need one: a policy that chooses between `none` and `full`
per question is **evaluated exactly**, not estimated, from a run that measures both — every question has
both actions observed, so the counterfactual for any deterministic rule over the recorded pack text is
already in the file. This is off-policy evaluation with full support, and it is exact rather than an
approximation because the support is not partial: the two arms were run on every question, and the rule
reads only a string that both runs recorded. A third arm would have bought the same numbers with a
third more calls and a new prompt path to debug.

**And the trap that the committed estimator avoids.** Reconstructing the pack from `packIdList` and the
item store instead of reading `injected` **reverses the gradient**: +0 / +5 / −7 flips, because a store
item's `statement` is that item's content in whichever fold wrote the snapshot, not the text injected
under that id. The pack has to be the string that was shown. That is a comment in `overlap.ts` beside
the function and it is why the function takes `readonly string[]` and not item ids.

**Dev still cannot resolve it, and now the number is attached to the policy rather than to a contrast.**
On 1,534 questions the whole threshold range lands between **+0.13pp and +0.98pp** against always-
injecting, every interval crossing zero, and the best of them is 0.38. That is the file's power argument
made concrete: dev's answer is "somewhere between nothing and one point", which is why the run is on
train.

**Dispatch.** Two arms, `none` and `full`, `train`, 7,829 questions, five folds. R70's 2,953 calls over
350 questions decompose into 1,750 pool draws, 700 answer calls and ≈500 distillation calls, so a
dispatch with no draws costs about **2.4 calls per question**: ≈18,500 calls, ≈2.7 hours at R70's
measured 1.94 calls/s, ≈**$1.5** off-peak — inside the job's 340-minute cap with room for the wall-clock
stop the lane enforces itself. The policy is read afterwards by `pnpm eval:overlap --policy`, which
costs nothing.

**One more dispatch parameter, recorded rather than assumed.** `learn_sample` is **700** per fold, not
the 6,263 available. Distilling from all of them would add ≈31,300 calls — twice the answering cost —
and the claim here is about *routing*, not about how much a fold can learn: every arm in the run sees
the same pack, so a smaller learning sample moves the level of both arms and not the difference the
registration is about. 700 per fold is the size R70's folds used, doubled.

## Outcome 0 — void: the dispatch that ran instead bought two arms this file never names

Run `42819268828`, 2026-11-10 12:51 UTC, **stopped after its first fold at 7,235 calls**. Nothing in
the table below is R72's reading, and the reason is a lane defect rather than a bad hypothesis.

**What was dispatched.** `arms` was left empty, and the workflow's fallback was the literal
`gated,oracle` — the R67 ladder frozen into a menu default. This file declares `arms: full`. The run
therefore measured two planted arms that no sentence in this file mentions, on 1,566 questions of
fold 1, and the registration's own arm check did not stop it:

```ts
// the rule as it stood, one direction, over an empty list
const ok = prereg === undefined || declared.every((arm) => bought.includes(arm));
```

`declared` is the header minus the two baselines, so `arms: full` yields `[]`, and "every element of
the empty set is bought" is true for any dispatch whatsoever. The check passed on the one dispatch it
could not possibly have checked.

**What stopped it.** The budget forecast, one fold in: `the run needs about 39069 calls, the cap is
26000 (short by 13069)`. That number is the useful residue of the failed run and the reason this
Outcome is cheap rather than expensive — it is the **first measurement of what a two-arm train
dispatch actually costs**, and it is 2.1× the estimate in the Amendment above.

| per fold (1,566 questions) | calls | note |
| --- | --- | --- |
| answering, 2 arms | 6,264 | 2 calls per question-arm, not 1 |
| distillation, `learn_sample` 700 | 711 | cache-hit on the R69 key |
| adjudication | 260 | |
| **fold total** | **7,235** | 21 minutes wall clock |
| **five folds, projected** | **39,069** | $3.15 at R70's $0.0806 per call, off-peak |

The estimate of $1.5 was wrong by a factor of two because answering costs **2 calls per
question-arm**: one to generate and one to repair, and `edited = 271` of 6,264 is what made that
visible only in the totals. The cost of the void run itself was **$0.58**.

**Two fixes, one of them a correction of a correction.**

1. **The default is the registration.** `SOTA_ARMS` now falls back to `steps.registration.outputs.value`,
   produced by `pnpm eval:prereg-arms --csv prereg/R72-overlap-gate.md` — the same pattern the
   temperature already used, for the same reason, and an empty header resolves to "the two baselines"
   rather than to somebody else's ladder. A literal default in a workflow is a third representation
   of a fact that already has two.
2. **The check is equality in both directions.** `armsAgainstRegistration` now reports `unbought`
   and `undeclared` separately and refuses both, because "the dispatch buys an arm the file never
   names" and "the file names an arm the dispatch does not buy" are different facts that need
   different sentences. The counter-argument for the old containment rule was R66, whose header named
   the treatment while its dispatch bought `retry-blank` beside it; the answer is that the header is
   the commitment, so **R66's header now names both arms** and the rule can be exact. A named
   registration that does not exist is also refused now instead of silently skipped.

Neither fix would have caught this on its own: the check was reachable and wrong, and the default was
wrong and unreachable.

**Re-dispatch.** Same registration, `train`, five folds, `learn_sample` 700, cap **44,000** (the
forecast plus 13%), deadline 175 minutes — the first fold's 21 minutes puts five folds at ≈105 plus
distillation on a cold queue, and the step's own cap is 200. Estimated **$3.2 off-peak**, 2.1× the
original estimate and still the cheapest form of this experiment: the policy is read afterwards by
`pnpm eval:overlap --policy` for nothing.
