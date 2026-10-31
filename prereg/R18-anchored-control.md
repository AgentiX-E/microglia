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

## Outcome

Dispatch `41188122217` (success, 1,762 calls, 6 retries, 0 timeouts, 0 call failures, eleven gates pass,
`config.prereg` = this file). Artefact `eval/results/poc-sota-bird-anchor.json`. 350 questions, 5 folds,
`none` at 54.00%, minimum detectable effect 3.76pp.

| Arm | Items | Characters | Accuracy | Δ vs `none` | 95% CI | gained / lost | p |
|---|---|---|---|---|---|---|---|
| `anchor-blank` | 0.00 | 0 | 50.00% | **−4.00pp** | [−7.43, −0.57] | 12 / 26 | 0.0336 |
| `full-anchored` | 1.85 | 1,088 | 54.00% | **+0.00pp** | [−1.71, +1.71] | 4 / 4 | 1.0000 |
| `full` | 1.85 | 1,088 | 53.43% | −0.57pp | [−3.14, +2.00] | 10 / 12 | 0.8318 |

Paired exact McNemar on the questions both arms answered — the comparison the iteration exists for:

| Pair | Δ | gained / lost | discordant | p |
|---|---|---|---|---|
| `anchor-blank` − `none` | **−4.00pp** | 12 / 26 | 38 | 0.0336 |
| `full-anchored` − `none` | +0.00pp | 4 / 4 | 8 | 1.0000 |
| `full-anchored` − `anchor-blank` | **+4.00pp** | 27 / 13 | 40 | 0.0385 |

**The first prediction is refuted and the refutation is the finding.** `anchor-blank` was predicted
above `none` by 1 to 3pp because a second pass is worth something. It came back **4.00pp below** it,
one sign in all five folds (−7.14, −4.29, −2.86, −4.29, −1.43pp), p = 0.0336. Being shown your own draft
and asked to revise it, with nothing added, costs about as much as the note does — the same
−4.00pp that `full` itself cost in R17. The second pass is not a free look at the question.

**The second prediction holds, and it is worth exactly the size of the first one.** `full-anchored`
minus `anchor-blank` is +4.00pp (27 gained, 13 lost, 40 discordant, p = 0.0385), while `full-anchored`
sits at exactly no memory (54.00% both). So the cell that has been credited with the record's only
positive sign is not above no memory at all in this run: the note, in the one position where it does no
harm, puts back precisely what the blind revision took away.

**What that means mechanistically, stated as narrowly as the design allows.** The two things
`anchor-blank` lacks relative to `full-anchored` are the block and the block's closing instruction —
"if none applies, return the first attempt unchanged". R18 cannot separate them, and it does not have
to in order to say what changed here: a request to revise with nothing to revise *toward* and nothing
saying the draft may stand is harmful; add a block whose instruction carries an explicit licence to
stop, and the harm disappears completely, leaving no gain. The commentary version of this — "the note
at anchor is worth the permission it carries to stop" — is the reading that survives the numbers, and
it is also the one that makes a testable claim, which is why the next file tests it as a 2×2 rather
than asserting it.

**The record's own positive number is smaller than the pooled figure said.** `full-anchored` against
`full` in the same run is +0.57pp, not the pooled +2.86pp over 700 questions from two earlier
dispatches. Those dispatches compared the anchored cell against a `full` that was itself costing
−4.00pp in one of them; in this run `full` costs −0.57pp and the gap between the two shrinks with it.
Both statements are true and only one of them is about the note: **anchoring is reproducibly *not
harmful* while injection is, and the difference between the two is mostly the harm injection does, not
a benefit anchoring confers.** Every document that credits the anchored arm with a gain is narrowed in
this commit.

**The one prediction that moved without being about the mechanism.** `full` was expected around −3pp
for the seventh consecutive dispatch. It is −0.57pp (CI [−3.14, +2.00], p = 0.8318) — the sign held and
the size did not, and this is the first dispatch in six where that cell is not distinguishable from
zero. Nothing in this iteration was designed to move it and no change was made to its prompt, so the
honest reading is that the five draws before this one (mean −3.08pp) have a spread wide enough to
produce an −0.57 without injection having stopped being costly; the six-draw mean is −2.67pp. It is
recorded because a record that only reports the draws that agree with its own average is not a record.

**The instrument did what it was built for, in the direction nobody asked for.** `V44-domain-accounted`
reports `184 item(s) with no domain, 184 arrived unscoped, 0 widened`, and the inequality is an
equality only because one of the two paths is doing all of the work: **not one domain-free item in this
store was produced by generalisation widening a scoped claim.** The 14.6% of the store with no domain
is the interpreter declining to scope at the door, which is a prompt to fix and not a policy to
tighten. `V32-fold-learning-intact` reports 0/1400 unanswered questions, 648 corrections and 0
distillation failures; `V12-shape-present` reports 647/647 injected rules carrying a condition.

## What this leaves

The 2×2 that R18 opens is registered as R20: four cells over (block, no block) × (permissive
instruction, conservative instruction), of which R18 measured the conservative row. The question it
answers is whether the permission is the active ingredient or the block is, and this iteration cannot
distinguish them — which is the difference between a product that says "show the note and tell the
model it may decline" and one that says "show the note".

