---
id: R17-framing
step: R17
opened: 2026-10-31
arms: none,none-advisory,full,full-advisory,full-prohibitive
sample: 350
gates: V1,V2,V3,V4,V5,V6,V7,V8,V12,V32
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
5. **No gate, no transfer arm, no new instrument.** Every reading here is a cell against `none` on the
   same 350 questions, and the six gates that measure packs, folds, parsing, reliability and shape are
   the ones that already exist.

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

- **`full-advisory` within 1pp of `full`.** Framing is not the channel. Then the variable is which
  item was retrieved rather than how it was said, and the next iteration is selection — a pack that
  picks the highest-ranked item that fits instead of taking rank order and stopping — with the
  relevance strata as its readout.
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
