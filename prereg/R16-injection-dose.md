---
id: R16-injection-dose
step: R16
opened: 2026-10-31
arms: none-replica,full,chars-600,chars-1800,chars-2400
sample: 350
gates: V1,V13,V14,V15,V16,V17,V33
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

Filled in when the dispatch lands.
