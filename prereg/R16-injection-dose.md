---
id: R16-injection-dose
step: R16
opened: 2026-10-31
arms: none-replica,full,chars-600,chars-1800,chars-2400
sample: 350
gates: V1,V2,V3,V4,V5,V6,V7,V8,V12,V32
---

# R16 — is the harm a property of what is stored, or of how much of it arrives?

## Why this file exists

R15 closed the content axis. Two substrates 18.24pp apart on reproduction transfer at 6.21% and
6.28% — a tie — and the arms built from either intersection inject 0.03 and 0.05 items per question.
R14 had closed the same axis from the other side: four content forms, four cells inside ±3pp. Nothing
this project writes into the store, in any form it has tried, changes what the store does to a
held-out question.

What the store does is negative in sign and unstable in size. `full` was 51.71% against 53.71% on
R15's dispatch — **−2.00pp, p = 0.3105**, 14 questions gained and 21 lost at 1.78 items and about
1,060 characters per question — and **−3.71pp, p = 0.0192** on the dispatch before it, which share
nothing but their sign and their pack. Every arm that injects *fewer* items sits above `full`:
`full-verified` 0.36 items/question at +1.14pp, `full-repair-verified` 0.31 at −0.29pp, both
transferred intersections at 0.05 at exactly `none`.

Those cells differ in content as well as in quantity, so they cannot be read as a dose response. This
iteration holds content fixed — same store, same retrieval order, same question — and changes one
number: the character budget the pack layer enforces.

## Why the axis is items, and why the old arms could only look down it

The pack layer adds whole items until the budget is exhausted and returns an empty pack when none
fits, so the unit the budget really controls is the item. On this store a rendered item measures 500
characters at the smallest and 582 at the median, which means the existing dose arms are not a curve:
150 and 300 admit nothing and are `none` under another name, 600 admits one item, and 1,200 — the
default — admits 1.78. **The default has been injecting two items, and the only direction the existing
arms could look was down, to one, where they degenerate.**

So this iteration adds the other direction. 1,800 and 2,400 characters are new arms, and with them
the axis is 0, 1, 2, 3, 4 items rather than 0, 1, 1.78. A curve that can only go down can only
recover harm; a curve with both directions can say whether harm is a function of quantity at all.

## What the literature says the shape should be

Three external results bear on the design, and all three predict a falling curve:

1. **The count of competing items is the variable, not the length.** The context-poisoning analysis
   formalises a decisive-evidence score that is capped while the strongest distractor's score grows
   with the number of distractors, and derives that holding accuracy above chance requires the
   evidence margin to grow as Ω(√log N) in the effective distractor count. Degradation is predicted to
   be steep while N is small and to flatten after, which is a claim about which step of this curve
   carries the loss.
2. **The first few items do most of the damage.** UTILMEM (arXiv 2608.30508) fixes evidence recall at
   1.0 and adds semantically similar distractors: the largest loss occurs among the first two to eight
   and then plateaus, and fewer than ~2.5 strong distractors suffice for a 25% quality reduction in
   the models it tests. This project injects 1.78, inside that window — which is why the loss is
   predicted to be nearly complete at two items.
3. **Memory that is faithfully recorded and relevant still hurts, and hurts more as more arrives.**
   MemTrapBench (arXiv 2608.20202) reports all five memory frameworks below their no-memory setting,
   the strongest by more than 10pp, and that the strength of the trap scales with memory length. Its
   mitigation, AdaptiveMem, is an inference-time instruction rather than an architecture change — a
   separate hypothesis, registered later as R17, not this one.

"Lost in the middle" (Liu et al., 2024) is the fourth: retrieved context is not an unconditional asset
and can fall below answering with no context at all. The pack is placed before the question in every
arm here, so placement is fixed and only quantity varies.

## The design, and the one thing that makes it a curve

1. **One store, one retrieval, one question.** Each dose arm calls `recall` with the same query and
   scope and a different budget — the arm name is `chars-` followed by the number the pack layer is
   given. Nothing else about the treatment changes, so a difference between two points is a difference
   in how much text arrived.
2. **The prefix property.** A 600-character pack is a prefix of the 1,200-character pack from the same
   ranking — the extra text is appended, never substituted — so the points are nested rather than
   independent draws.
3. **`none-replica` in the same run.** The identical prompt asked twice. Whatever it reports is what
   the endpoint does to an unchanged question, and it is the floor every point is read against. R11
   measured 3–6 discordant questions on it, the same size as most effects this project has published.
4. **No gate on the curve.** The admitted set is not applied: `full-verified` answers a different
   question and cannot be a point on a curve whose content must stay fixed.

## Prediction

- **Instrument: the points are ordered and non-empty.** `mean_pack_ids` increases across 600 < 1,200 <
  1,800 < 2,400, `mean_pack_chars` stays inside its budget, and each point injects at least one item
  on ≥70% of questions. A curve whose points collapse to the same pack is not a curve, and the run
  says so before any delta is read.
- **The curve falls as the dose rises: `chars-600` ≥ `chars-2400` by at least 3pp.** Both the
  distractor-count bound and the UTILMEM window put the loss in the first two items and predict
  saturation after, so the 1,200 → 2,400 step should be smaller than the 0 → 1,200 one.
- **Two items is where the harm already is: `chars-600` within ±2pp of `none`, `full` below both.**
  The product consequence: if one item is harmless and two are not, the default is wrong by a single
  item and the fix is a budget rather than a redesign.
- **No point beats `none` by ≥2pp.** The claim this project has never been able to make, and the one
  a dose curve can falsify cheaply: if memory helps at any quantity, some point here shows it.
- **`full` is negative again, −1 to −4pp.** Its sign has held in two dispatches; the size has not.

## Refutation

- **Flat across 600–2,400 (all points within ±2pp of each other).** Quantity is not the variable. The
  harm is then a property of *which* items were retrieved — relevance, order or framing — and the next
  iteration is `full-asked` and the relevance strata rather than another budget. R17's framing question
  becomes the main line rather than a follow-up.
- **Accuracy rises with the dose (`chars-2400` best by ≥2pp).** The negative cells were dispatch
  artefacts or a threshold effect and injection is beneficial at full dose. Then the inert gated arms
  are inert because of their size, not their content, and the next measurement is a gate that keeps
  enough items to matter.
- **Every point below `none`, including 600.** The store cannot be used at any dose. That ends the
  injection-budget line and moves the work to what gets stored: R13's 22 of 100 admitted rules and
  R15's 24 of 102 without a home database are the ceiling on everything downstream, and they become
  the subject rather than a footnote.
- **`none-replica` disagrees with `none` on more than 10 questions.** The floor is not a floor at this
  endpoint, no point on the curve is resolvable, and the run is reported as a direction.

## What a positive result would license, and what it would not

A curve that is monotone in the predicted direction, with 600 inside ±2pp of `none` and 2,400 below
it, would license one product sentence — *the store is not harmful, the default budget is* — and one
change: a budget set from evidence rather than a constant, measured on the dev split before it becomes
a default. It would not license keeping a store that helps nothing: recovering the harm is not
producing a gain, and the fourth prediction is written down so that the difference cannot be dropped
quietly when the curve looks good.

## Outcome

One dispatch, `41177896801`, artefact `eval/results/poc-sota-bird-dose.json`: 350 questions, 5 folds,
2,263 calls, 1 retry, 0 timeouts, 0 call failures, `config.prereg` naming this file, and all ten gates
that this arm set engages pass. Five points, one store, one ranking, one question, one number apart.

| Reading | Value | Predicted | |
|---|---|---|---|
| dose order | 0.29 → 1.83 → 2.97 → 4.16 items/question (100, 639, 1,040, 1,456 rendered items) | increasing | ✓ |
| characters inside the budget | 168 / 1,080 / 1,649 / 2,212 against 600 / 1,200 / 1,800 / 2,400 | under budget | ✓ |
| coverage at 600 | one item on 100 of 350 questions (28.6%) | ≥ 70% | ✗ |
| `chars-600` | 54.00%, **+0.00pp**, CI [−1.43, +1.71], p = 1.0000, 4 gained / 4 lost | within ±2pp of `none` | ✓ |
| `full` (1,200) | 51.43%, −2.57pp, CI [−5.43, +0.29], p = 0.1078, 8 gained / 17 lost | −1 to −4pp, below 600 | ✓ |
| `chars-1800` | 50.00%, **−4.00pp**, CI [−6.86, −1.14], **p = 0.0094**, 6 gained / 20 lost | not registered individually | the only point that clears |
| `chars-2400` | 51.14%, −2.86pp, CI [−6.00, +0.29], p = 0.1102, 11 gained / 21 lost | ≤ `chars-600` − 3pp | ✗ by 0.14pp |
| `none-replica` | 52.57%, −1.43pp, CI [−2.86, +0.00], p = 0.1250, 1 gained / 6 lost | ≤ 10 discordant | ✓ (7) |

`none` is 54.00% and nothing on the curve is above it. The best arm is the one that injects nothing,
at +0.00pp; the worst is 4.00pp below it, which is also this sample's minimum detectable effect
(V5, 4.00pp at 80% power). One point clears its own bar, four do not, and the spread of the whole
curve is the width of the instrument.

**The instrument prediction failed, and the failure is the finding.** `chars-600` was registered as a
one-item cell and it is a one-item cell on 100 of 350 questions: the pack layer takes items in rank
order, adds a whole item or stops, and the top-ranked item renders to more than the 600-character
budget on the other 250. So the flat cell at 600 is 71.4% `none` by construction, and a cell that is
seven parts control cannot answer the question it was built for. Diluted by 0.286, a per-item cost of
−5.0pp and a per-item gain of +6.0pp both land inside CI [−1.43, +1.71]: **the prediction that "one
item is harmless" was checked against a cell that could not have shown otherwise.**

**The one-item cell this run failed to build exists, in iteration 86.** That dispatch gave the same
lane the same four low budgets against the same rules-with-the-case store, and its `chars-900` reached
**exactly 1.00 item per question** at 718 characters. Read the two runs together:

| Dispatch | Arm | Characters | Items | Accuracy | Δ vs `none` | gained / lost | p |
|---|---|---|---|---|---|---|---|
| 86 | `chars-300` | 0 | 0.00 | 53.71% | +0.29pp | 5 / 4 | 1.00 |
| 86 | `chars-600` | 156 | 0.27 | 54.00% | +0.57pp | 6 / 4 | 0.75 |
| R16 | `chars-600` | 168 | 0.29 | 54.00% | **+0.00pp** | 4 / 4 | 1.00 |
| 86 | `chars-900` | 718 | **1.00** | 50.29% | **−3.14pp** [−6.29, −0.29] | 9 / 20 | 0.061 |
| R16 | `full` | 1,080 | 1.83 | 51.43% | −2.57pp [−5.43, +0.29] | 8 / 17 | 0.108 |
| 86 | `full` | 1,094 | 1.87 | 50.29% | **−3.14pp** [−6.00, −0.29] | 9 / 20 | 0.061 |
| R16 | `chars-1800` | 1,649 | 2.97 | 50.00% | **−4.00pp** [−6.86, −1.14] | 6 / 20 | 0.009 |
| R16 | `chars-2400` | 2,212 | 4.16 | 51.14% | −2.86pp [−6.00, +0.29] | 11 / 21 | 0.110 |

Two things survive the join. The diluted cell is **reproducible across stores**: 0.27 items at +0.57pp
then 0.29 items at +0.00pp, two distillations apart. And **the loss is already complete at one item**:
1.00 item costs −3.14pp, 1.83 costs −2.57, 2.97 costs −4.00 and 4.16 costs −2.86 — an excursion of
1.43pp across a fourfold range of injected text, with the whole of the step between 0.29 items and
1.00. The registered prediction said the harm would be complete by the second item; it is complete by
the **first**, and the second item adds nothing.

**Which is the refutation clause, arriving by a door the file did not name.** The clause required all
points within ±2pp of each other to declare that quantity is not the variable. Inside this run the
spread is 4.00pp and the literal condition fails. Across the two runs, everything from one item up
sits within 1.43pp and nothing above one item moves the number — which is the substance of the clause
and the reason the next measurement is not another budget. R17's framing question is the main line now,
not the follow-up.

**The floor moved, and it moved against this run.** Iteration 86's `none-replica` was 3 gained and 3
lost — the floor was three questions. This run's is 1 gained and 6 lost: seven discordant questions,
−1.43pp, and the first clearly negative replica on record. Two consequences, and both cut against
reading small cells. Everything at or below seven flips is noise here, which is `chars-600` (8) and the
replica itself (7), so flatness at 600 is what an unchanged question looks like rather than evidence
about one item. And because `none` is the luckier of two identical prompts, every delta in the table
overstates the harm by up to 1.43pp — the sign of the finding does not depend on it, the size does.

**Four dispatches, one sign, at the dose the product ships.** The default budget has been measured at
−3.71pp (p = 0.0192), −3.14pp, −2.00pp (p = 0.3105) and −2.57pp (p = 0.1078) on four disjoint
350-question draws of this lane. The sign has held four times and the size has not; the mean is
**−2.86pp**. That is what the shipped configuration costs, and it is the one number here that has never
come back positive.

**The header was wrong, and the check that would have caught it now exists.** This file's `gates` line
was copied from R15 and named seven transfer gates that a dose arm set cannot engage; the run emitted
ten others and nothing refused the mismatch. That is the fourth instance of one defect — a field that
was true when written and silently stopped being true (R12's admission, R13's ledger, R15's V14/V17) —
and the first where both sides of the claim are files in the repository. `protocol` now recomputes the
agreement for every artefact that names a pre-registration, and fails on a mismatch.

**What this licenses, and what it closes.** Three axes are now measured: content (four forms inside
±3pp), substrate (an 18.24pp reproduction gap buying 0.07pp of transfer) and quantity (a step at the
first item, nothing above it, no point above `none`). The sentence this file was written to license —
*the store is not harmful, the default budget is* — is in the Outcome as a refutation rather than a
result, because the cell that would have carried it was 71% control and the cell that could have
carried it, from iteration 86, came back at −3.14pp. **A budget cannot be the fix**: the smallest
budget that injects anything already costs what the default costs. What is left is the item — which one
is retrieved, and how it is said — and both are registered: `prereg/R17-framing.md` varies the framing
of the same fact, and the pack layer's all-or-nothing prefix selection is the instrument defect this run
exposed.


