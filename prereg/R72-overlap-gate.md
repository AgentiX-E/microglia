---
id: R72-overlap-gate
step: R72
opened: 2026-11-10
arms: full,full-overlap
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
