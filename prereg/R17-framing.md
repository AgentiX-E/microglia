---
id: R17-framing
step: R17
opened: 2026-10-31
arms: none,none-advisory,full,full-advisory,full-prohibitive
sample: 350
gates: V1,V2,V3,V4,V5,V6,V7,V8,V12,V32,V43
---

# R17 — does permission to ignore the note recover what the note costs?

## Why this file exists

R16 closed the quantity axis and closed it harder than it was asked to. The dose curve is a step, not
a slope: 0.29 items per question costs +0.00pp, 1.83 costs −2.57pp, 2.97 costs −4.00pp and 4.16 costs
−2.86pp, and iteration 86's `chars-900` — the one cell in this project that reached exactly 1.00 item
per question — cost −3.14pp on a store whose `full` cell was within 0.6pp of today's. **The loss is
complete at the first item.** Everything above one item moves the number by 1.43pp across a fourfold
range of injected text, which is inside this lane's floor.

That result removes the cheapest product fix. A budget cannot help, because the smallest budget that
injects anything already costs what the default costs. What is left is the item: which one is
retrieved, how it is ordered, and how it is said. R13–R16 closed content and substrate — four forms
inside ±3pp, an 18.24pp reproduction gap buying 0.07pp of transfer — and the only arm family this
project has ever measured as non-negative is the one where the model is *asked differently* rather
than given different text: `full-onretry` at +1.43pp with 5 gained and 0 lost, `retry-blank` at +0.57pp
with 2 gained and 0 lost, across the dispatches that carried them.

The retry channel and R17 test the same hypothesis from opposite ends. Retry gives the model a second
pass, which is one way to let it notice that a note does not apply. This iteration gives it permission
to notice on the first pass, in one sentence, with nothing else changed.

## What the literature says, and what this project already measured

MemTrapBench (arXiv 2608.20202) reports that all five memory frameworks it tests sit below their
no-memory setting, that the strength of the trap scales with memory length, and that its mitigation —
AdaptiveMem — is an *inference-time instruction*, not an architecture change. Its stated mechanism is
trauma: a memory that records a past error makes the model cautious about a category, and the caution
generalises past the case that produced it.

This project has already measured that mechanism twice without naming it:

- **Repair pairs, which record what went wrong, are worse than rules, which record what is true.** On
  iteration 86's dispatch the pair cost −4.86pp against the rule's −3.14pp on the same run, and R15
  measured the same ordering in the gated cells (`full-repair-verified` −0.29pp against
  `full-verified` +1.14pp). Naming the error costs more than stating the fact.
- **The case-bearing form loses and the caseless form did not.** Iteration 88's `full-procedural`
  reached +0.86pp against a `full` of −4.29pp, though iteration 89 failed to replicate it. The
  direction is consistent with an account in which the pack invites imitation of a specific case; the
  replication failure is why it is a direction and not a finding.

So the harm has a shape: the text arrives as a claim about the world, from an authority the model did
not ask for, with no statement of when it stops applying. The intervention the literature proposes is
one sentence that restores the model's standing to disagree. That is cheap, it is the last lever whose
mechanism has published support, and it is falsifiable in one dispatch.

## The design, and the two controls that make it readable

1. **One store, one pack, one default.** Every arm recalls with the same query and the shipped 1,200
   character budget. R16 closed the budget; nothing here varies it.
2. **`full-advisory`** appends one sentence to the prompt beside the unchanged pack: the notes are
   reference data from prior corrections, they may be incomplete or wrong, each state a condition, and
   a note whose condition does not hold for this question should be ignored.
3. **`none-advisory` is the control that makes the recovery attributable.** The sentence is 200-odd
   characters of new prompt. Without an arm that carries the sentence and no pack, a recovery cannot
   be separated from the cost of the extra text, and this project has already published one artefact
   (R11's empty pack at 230 characters, 1.14pp) that shows extra text is not free.
4. **`full-prohibitive`** renders the same items under a frame that classifies them as recorded errors
   rather than as reference data — same statement, same order, same count, different register. It is
   the arm that tests the trauma mechanism *forward* rather than as a mitigation: if a note that
   records an error is over-applied, saying so should hurt more, not less.
5. **No transfer arm and no new measurement.** Every reading here is a cell against `none` on the same
   350 questions. One gate is added — `V43-framing-delivered`, which counts per arm how many of its
   prompts carried the framing it declares — because the failure it prevents is the one this stage
   cannot otherwise see: a table entry that silently fails to match leaves `full-advisory` as `full`
   under a second name, and "the sentence cost nothing" becomes a reading about a sentence that was
   never sent.

## Amendment before dispatch (2026-10-31, written before the run)

The prediction below was written at the resolution this lane was assumed to have. R16 measured that
resolution and it is coarser than the prediction's clauses: 350 questions, paired, means the smallest
cell that clears its own bar is about **4.0pp** (`chars-1800`: 26 discordant pairs, delta −4.00pp,
p = 0.0094), and a 2.6pp cell did not clear it (0.1078). A paired difference of 2pp lives inside this
instrument's noise, so four of the thresholds below are not measurable as written. They are re-levelled
here, before the dispatch, rather than after the numbers land:

| Clause as written | How it will be read |
|---|---|
| `full-advisory` at least 2pp above `full` | **Confirmed** if the point estimate is ≥ +3pp **and** p < 0.05; **partial** if the estimate is positive with the CI's lower bound below 0; **not supported** if the estimate is ≤ 0 |
| `full-advisory` no more than 1pp below `none` | Recorded as a direction, not a criterion: 1pp is a quarter of the MDE and no cell in this record has ever resolved it |
| `full-prohibitive` within 1pp of `full` | **Confirmed** if the CI on `full-prohibitive` − `full` contains 0; the 1pp band is reported but not adjudicated |
| `none-advisory` within ±1.5pp of `none` | Same: the CI is the reading, the band is a description |
| no arm above `none` by 2pp | Unchanged, and it is the one clause this lane *can* adjudicate in the negative: a cell 4pp above `none` is visible, and one that is not is not |

**What a null means here.** With the effect this hypothesis predicts (recovering the default's −2.86pp,
i.e. +2.86pp), this dispatch has roughly 60% power at α = 0.05. A null is therefore **not** evidence
that framing does not matter unless the interval's upper bound on `full-advisory` − `full` sits below
+2.5pp. If it does not, the honest verdict is "inconclusive at this n", and the arm set is re-dispatched
on a second draw before the refutation clause is allowed to fire. Writing the power down before the run
is what stops a 60%-power null from being read as a discovery.

## Prediction

- **`full-advisory` recovers most of the harm: at least 2pp above `full`, and no more than 1pp below
  `none`.** The default cell has been −3.71, −3.14, −2.00 and −2.57pp on four dispatches; recovering
  two thirds of that with one sentence is the claim, and reaching `none` is the stronger form.
- **`full-prohibitive` is not better than `full`: within 1pp of it.** The trauma reading says the
  negative register is the harm, so classifying a fact as an error should cost at least as much.
- **`none-advisory` sits within ±1.5pp of `none`.** The sentence alone does nothing to a question with
  no pack to doubt; if it moves accuracy by itself, that movement is the sentence's effect and has to
  be subtracted from whatever `full-advisory` shows.
- **No arm is above `none` by 2pp.** A mitigation is not a gain, and this prediction is written here
  so that the difference cannot be dropped quietly if the recovery looks good.

## Refutation

- **`full-advisory` no better than `full`, at this lane's resolution.** The registered form was "within
  1pp", which is a quarter of the MDE and would fire on noise; the amendment above replaces it with the
  one this instrument can prove — the interval on `full-advisory` − `full` has an **upper bound below
  +2.5pp**, so a recovery large enough to matter is excluded rather than merely unproven. Framing is
  then not the channel, and the variable is which item was retrieved rather than how it was said: the
  next iteration is selection — a pack that picks the highest-ranked item that fits instead of taking
  rank order and stopping — with the relevance strata as its readout.
- **`full-prohibitive` at least 2pp above `full`.** The trauma mechanism runs the other way in this
  lane: the negative register is what makes a note usable. That would reopen the content axis through
  framing rather than through form, and it would be registered as a new stage rather than added here.
- **`none-advisory` at least 2pp below `none`.** The sentence is not free, no recovery can be
  attributed to it, and the arm set is re-registered with a length-matched neutral filler before any
  conclusion is drawn from the advisory cells.
- **`full-advisory` at least 2pp above `none`.** The first positive read on this lane in nineteen
  iterations. It is not called a gain until a second dispatch reproduces the sign, and the replication
  is registered as its own stage with its own artefact.

## What a positive result would license, and what it would not

A `full-advisory` cell at or above `none` would license exactly one sentence in the product: the pack
is delivered with a standing statement that it is fallible and conditionally applicable, and that
statement is part of the payload rather than part of the integration guide. It would not license
calling the store useful — recovering a loss is not producing a gain, and four dispatches of this
lane at the shipped budget have never produced one. It also would not license dropping the quantity
work: the advisory arm carries the default pack, so a recovery here says nothing about whether one
item is better than two.

If the refutation fires on the first clause, the sequence that follows is already written: selection
before framing, then relevance strata, and the product statement stays at "the store is inert at best
and harmful at the shipped budget" until an arm beats `none` twice.

## Outcome

Dispatch `41185616121` (success, 2,110 calls, 5 retries, 0 timeouts, 0 call failures, eleven gates
pass, `config.prereg` = this file). Artefact `eval/results/poc-sota-bird-framing.json`. `none` at
54.86%, 350 questions, 5 folds, minimum detectable effect 4.53pp.

| Arm | Items | Characters | Accuracy | Δ vs `none` | 95% CI | gained / lost | p |
|---|---|---|---|---|---|---|---|
| `none-advisory` | 0 | 0 | 52.86% | −2.00pp | [−4.00, +0.00] | 3 / 10 | 0.0923 |
| `full` | 1.81 | 1,078 | 50.86% | −4.00pp | [−7.14, −0.86] | 9 / 23 | 0.0201 |
| `full-advisory` | 1.81 | 1,078 | 50.29% | −4.57pp | [−7.71, −1.71] | 7 / 23 | 0.0052 |
| `full-prohibitive` | 1.81 | 1,078 | 49.71% | −5.14pp | [−8.29, −2.00] | 7 / 25 | 0.0021 |

Paired against `full` on the same questions — the numbers the decision rule is written on:

| Arm | Δ vs `full` | 95% CI | gained / lost | p |
|---|---|---|---|---|
| `full-advisory` | **−0.57pp** | [−3.14, +2.00] | 10 / 12 | 0.832 |
| `full-prohibitive` | −1.14pp | [−4.00, +1.71] | 10 / 14 | 0.541 |
| `none-advisory` | +2.00pp | [−1.14, +5.14] | 19 / 12 | 0.281 |

**The registered refutation fired.** `full-advisory` sits 0.57pp *below* `full` and its interval's
upper bound is +2.00pp, under the pre-registered +2.5pp bar from the amendment. A sentence granting
the model standing to disregard the block does not recover what the block costs, and the datum
excludes any recovery large enough to have been worth the sentence. Framing is not the channel.

**The sentence has a price, and it is the size of the effect it was meant to buy.** `none-advisory`
— the sentence with no pack, the control this arm set was built around — is 2.00pp below `none`
(p = 0.0923, 13 discordant). Four dispatches put the default pack's cost at −2.86pp on average, and
two thirds of a chance to recover it was the claim; a paragraph of instruction against a block of
1,078 characters came back at −2.00pp on its own. The two costs do not add — pack plus sentence would
be −6.00pp and the cell is −4.57pp, so the interaction is +1.43pp — but this lane cannot resolve an
interaction of that size, and the honest reading is the simpler one: **in this prompt, words cost
about what the note costs**, which is why every mitigation that works by adding words has to clear a
bar as high as the harm it repairs.

**The trauma mechanism ran forward and stayed inside its interval.** `full-prohibitive` classifies the
same 1.81 items as records of failures rather than as workspace facts and lands 1.14pp below `full`
(CI [−4.00, +1.71]). The prediction was "not better than `full`" and it holds; the prediction was
"within 1pp" and the point estimate is just outside it, which at this resolution is a direction rather
than a size. Read against `none-advisory`, the two arms that add a paragraph are 4.57 and 5.14pp below
no memory, so the register — the one variable MemTrapBench's mechanism names — moved the cell by
0.57pp. Whatever the harm is, it is not the register the block is written in.

**`full` is negative for the seventh time, and the third by significance.** −4.00pp at p = 0.0201;
the mean across seven dispatches is −3.2pp. That is now less a finding than a property of the lane,
and it is the number the product statement has to survive.

**The instrument passed the check it was built for.** `V43-framing-delivered` reports
`none: 0/350 expected none, full: 0/350 expected none, full-advisory: 350/350, none-advisory:
350/350, full-prohibitive: 350/350`. This is the first run in this record where a prompt-level
treatment's delivery is itself a gate, and it is what makes the three cells above readings about
sentences rather than readings about tables.

**What the refutation's own next step is, and why it is not the one written before the run.** The
clause named selection — a pack that picks the highest-ranked item that fits. R16, one iteration
earlier and after this file was drafted, measured that the loss is complete at the **first** item
(−3.14pp at exactly 1.00 item per question) and that everything from one item to four moves the
number by 1.43pp. Selecting *which* item arrives cannot remove a cost the first item already
incurs, so selection is not the successor the evidence supports. What the record does support is the
single mechanism with a positive sign: `full-anchored`, +2.86pp against `full` pooled over 700
questions at p = 0.0205 — measured, however, without an arm that writes twice and injects nothing.
That control is what `prereg/R18-anchored-control.md` registers, and it is the iteration that
decides whether the note or the revision owns the only positive number this project has.

**Reproducibility.** `prereg/R17-framing.md`, artefact `eval/results/poc-sota-bird-framing.json`,
dispatch `41185616121`; `pnpm check` green with `sota.ts` and `prereg.ts` at 100 on all four
coverage dimensions.
