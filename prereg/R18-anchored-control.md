---
id: R18-anchored-control
step: R18
opened: 2026-10-31
arms: anchor-blank,full-anchored
sample: 350
gates: V1,V2,V3,V4,V5,V6,V7,V8,V12,V32,V44
---

# R18 — the one positive result has never had a control

## Why this file exists

R17 closed the framing axis. `full-advisory` came back 0.57pp *below* `full` on 350 paired
questions (10 gained, 12 lost, CI [−3.14, +2.00]), so the registered refutation fired: an
instruction granting the model permission to ignore a note does not recover what the note costs, and
the interval excludes a recovery of the size that would have mattered. Two things came with it: the
sentence costs 2.00pp on its own (`none-advisory`, 52.86% against 54.86%), and the error register ran
the predicted direction one step further down (`full-prohibitive`, −1.14pp against `full`).

That makes four axes closed — content, quantity, position, framing — and leaves exactly one mechanism
in this record with a positive sign: **`full-anchored`**, the pack delivered as an objection to the
model's own draft in a second call. Two dispatches, pooled: **+2.86pp against `full` on 700 paired
questions, McNemar p = 0.0205, 44 gained and 24 lost**; and in the second of those dispatches the
anchored arm sat at +0.29pp against no memory while `full` in the same run cost −4.00pp.

**It was measured against `full` and never against a second pass with no pack.** That is the whole
reason for this iteration. A revision is a second look at the same question, and this project has
already measured what a second look is worth on its own: `retry-blank` — the identical second attempt
with an empty pack — gained +0.86, +0.57, +1.14 and +1.14pp in four runs, and `retry-keyed`, which
retrieves the right note by the right key at that same moment, was *identical to the question* with
`retry-blank`. Once the blank control existed, the note's contribution at retry was zero.

Anchoring is the same shape and has no such control. Until it has one, "+2.86pp" is a statement about
*writing twice with a package of extra text somewhere in the prompt*, not about a note delivered at the
right moment.

## The design

1. **`full-anchored`** — unchanged, and it is the incumbent: draft with no pack, then revise with the
   pack and the conservative instruction ("if none applies, return the first attempt unchanged").
2. **`anchor-blank`** — the same draft, the same revision request, **no pack and no instruction about
   one**. `anchorPromptFor` already renders the empty pack as no block and no instruction, so the two
   arms differ in one block of text and nothing else: same second call, same model, same temperature.
3. **`none` and `full`** are the run's anchors to its own baseline, and `full` is also the arm the
   project's published negative is stated against.
4. **No new instrument.** The two gates that could disagree with the arms already exist: V43 counts
   framing per arm (inactive here, no arm declares a standing) and V44 reconciles the store's
   domain-free items against the two paths that produce them.

## Prediction

- **`anchor-blank` is above `none`.** A second pass on the same question is worth something; at retry
  it was worth +0.86pp on average across four dispatches, and a draft is a better starting point than
  a failed query. Expected +1 to +3pp.
- **`full-anchored` − `anchor-blank` ≥ 0.** Whatever the revision is worth, the note does not make it
  worse at the one moment the record says it stops making things worse. This is the weaker of the two
  predictions and the one the iteration is built on.
- **`full-anchored` ≥ `anchor-blank` ≥ `none` − 1pp.** If both revision arms land within a point of no
  memory, the mechanism is "a second pass fixes what a first pass gets wrong", and the note is a
  passenger in its own result.
- **`full` stays negative**, around −3pp, as it has in six consecutive dispatches.

## Refutation

- **`anchor-blank` within 1pp of `full-anchored` and both at or below `none`.** Then the note
  contributes nothing at anchor *and* the second pass contributes nothing: the +2.86pp pooled result
  was neither. This is the outcome that would say the project's only positive sign was a dispatch
  artefact, and it is written down here so that it cannot be found later and renamed.
- **`full-anchored` at least 2pp below `anchor-blank`.** The note *hurts* even when it arrives as an
  objection to a draft, which would mean the harm is in the reading of any unsolicited claim at all,
  and the product sentence changes from "the store is inert" to "the store is harmful in every
  position this framework can put it in".
- **`anchor-blank` at least 2pp above `full-anchored` while `full-anchored` is at `none`.** Then the
  note is actively suppressing a gain the second pass would otherwise produce, and the next iteration
  is the conditional anchor (the instruction that asks the model to name which item applies before
  changing anything) against this control.

## Resolution, stated before the run

This lane resolves about **4.5pp** on a marginal cell (R16: 26 discordant pairs for −4.00pp at
p = 0.0094; R17's MDE was 4.53pp) and about **3pp** on a paired difference with 60 discordant pairs.
The two outcomes this iteration separates — "the second pass earns the +2.86pp" and "the note earns it
at anchor" — differ by roughly 3pp, which is at the edge of what 350 questions can separate. Three
consequences are pre-registered:

1. **A null on both revision arms is not a result.** If `anchor-blank` and `full-anchored` both sit
   within 2pp of `none` and of each other, the iteration is inconclusive at this n and is re-dispatched
   before anything is concluded; the artefact says "inconclusive", not "no effect".
2. **The confirmatory cell is the difference, not the level.** `full-anchored` − `anchor-blank` is
   computed as a paired McNemar over the questions both arms answered, and it is the only number that
   gets a verdict.
3. **`anchor-blank` is the number that can demote the record's only positive.** If it lands at or above
   `none` while `full-anchored` also lands at or above `none`, the honest statement is that the
   anchored cell's +2.86pp was the revision, and every document that credits the note at anchor is
   corrected in that commit rather than after the next dispatch.

## What a positive result would license

`full-anchored` at or above `anchor-blank`, with `anchor-blank` above `none`, licenses one product
sentence and it is narrower than the current one: *the store is worth consulting when a draft already
exists and the reader has been told it may decline* — not "the store helps", and not "the store is
neutral". It would not license always-on injection, which six dispatches have measured between −2.0 and
−4.0pp, and it would not license calling the note the mechanism until a second dispatch reproduces the
ordering.
