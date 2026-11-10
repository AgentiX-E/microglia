---
id: R74-rule-causal
step: R74
opened: 2026-11-10
arms: loo
sample: 7829
gates: V1,V2,V3,V4,V5,V6,V7,V8,V12,V32,V44,V48,V51
---

# R74 — every verdict this project has about a rule is observational, and one withheld rule per question fixes that

**Registered** 2026-11-10, after R72's outcome and R73's, before either reading is used to prune
anything. It is the only experiment in this lane that prices an **individual rule** rather than a pack.

## What R72 left standing, in one paragraph

Memory costs **−0.84pp** on 7,829 questions `[−1.44, −0.26]`, p 0.0054, and the damage is
concentrated in the tercile whose pack shares least of the question's vocabulary (−1.46pp, p 0.0042).
A lexical gate recovers that tercile (+2.91pp) and still lands, at its in-band threshold, **0.22pp
below injecting nothing at all**. So the prefix position is closed as a source of accuracy — and the
reason it was worth measuring at all is that it separated *where* the pack hurts from *whether the
rules in it are the right rules*, and the second question was never answered. `attribution.ts`
answers it with a confound: **267 harmful, 236 helpful, 1,206 neutral rules of the 1,709 ever
injected**, and 33.2% of all injections belong to a harmful rule.

## Why that verdict is not yet usable

A rule's sign is estimated from the questions that happened to retrieve it. Retrieval compares a rule
to the question, so a rule that fires on hard questions and stays quiet on easy ones reads as harmful
whatever it says, and a rule that fires on questions about `customer` reads as helpful because those
questions were easier. The confound is not hypothetical: the store's retrieval is exactly a similarity
function over content, which is a function of topic, which is a function of difficulty.

Pruning the 267 rules on this evidence would be acting on a selection effect. That is the decision
this file exists to make safe, and it is a decision worth about **4.4pp of the negative** if the
attribution is real and **nothing at all** if it is not: 33.2% of injections times a plausible
per-injection harm is the whole gap R72 measured.

## The design, exactly

- **Population:** `train`, 7,829 questions, five folds — R72's own split, because the effect being
  measured is the one R72 measured and a smaller split cannot resolve it. R73 is the price of getting
  this wrong: 115 eligible questions could not exclude an AUC of 0.59.
- **Three arms:** `none` (the baseline the ledger needs), `full` (the paired baseline), and `loo`.
- **The arm.** `loo` renders the pack `full` renders **with exactly one rule removed**, chosen by
  `looIndex(pack.items.length, question + fold)` — a hash of the question's own text, so the choice is
  reproducible from the artefact and cannot be influenced by the lane, the fold order, or a `--seed`
  outside the registration. Nothing is re-retrieved and nothing is re-cut: if the cell moves, the
  withheld rule moved it.
- **The pairing.** Within a question the other rules are held fixed and the model is the same, so
  `loo − full` is attributable to one rule. Across the split, a rule is withheld on a random subset
  of the questions that drew it, so a **group** of rules — harmful, helpful, neutral, one-item packs,
  three-item packs — has an unconfounded verdict.
- **The classes are computed from the same artefact**, by the arithmetic `attribution.ts` uses: a
  rule's net is the flips it was present for. Joining one file to itself is what makes the reading
  reproducible; a reading that needed a second stage's output could not be re-derived.
- **The reading is offline and free.** `pnpm eval:loo` reads the artefact the dispatch wrote and
  prints the whole-split delta, the class table, the pack-size table and the draw distribution, with
  zero calls.

| item | calls | note |
| --- | --- | --- |
| answering, three arms | 23,487 | 2 calls per question-arm, generation plus repair |
| distillation, `learn_sample` 700 | 711 | R70's rate, warm cache |
| adjudication | 390 | three arms |
| **total** | **≈24,600** | **≈$2.0** off-peak, ≈90 minutes |

Cap **28,000** (the projection plus 13%), deadline **170** minutes. The number is not an estimate from
a table: it is R72's own fold totals — 7,235 calls for two arms over 1,566 questions, of which 6,264
were answering — scaled to a third arm, because the last three registrations each discovered that the
budget was the moving part and the fold's measurement is the only number worth dispatching on.

## Prediction

- **The attribution is directionally right and smaller than it looks.** Withholding a rule the ledger
  calls harmful recovers **+1.0…+3.0pp** on the questions that withheld one; withholding a helpful rule
  costs **−1.0…−3.0pp**. The damage is real, the 267-rule count overstates it because some of those
  rules are marked harmful by the confound rather than by their content.
- **The neutral class is the control, and it should move nothing.** `−0.4…+0.4pp` with an interval
  across zero. A neutral rule that moves questions is a rule whose class was wrong, and 1,206 of them
  is a large enough group to say so.
- **The whole-split delta is small and positive.** `+0.2…+0.7pp`: one rule in 1.86 removed is a weak
  dose, and the pool of harmful rules is a third of the injections rather than all of them.
- **Pack size will look like a dose effect and is not one.** A question with one rule that loses it
  becomes `none` and improves by the per-question harm; a question with three loses a third of its
  pack. The two tables must be read together because the size table is a restatement of the class
  table weighted by how the retriever sizes packs.

## Refutation

The branches partition and are ordered; the first whose conditions hold names the outcome.

- **Void** — fewer than 5,000 questions withheld a rule, or the withheld share is under 60% (which
  would mean most packs were empty and the split is not the one R72 measured), or the reading's
  `nothingToWithhold` count is missing from the artefact. Then the arm measured the provider's
  nondeterminism on most of the split and the verdict is about that.
- **The attribution is causal** — the harmful class recovers at least **+1.0pp** with an interval
  excluding zero **and** the helpful class loses at least 1.0pp with an interval excluding zero.
  Then a rule's observed net is a usable estimate of its own effect, pruning the harmful 267 is worth
  what the group delta says, and the next registration is **a pruned store against a full one** — the
  first intervention in this project that removes memory rather than routing it.
- **The confound is the whole story** — the two extreme classes' intervals both straddle zero while
  the whole-split delta is positive. Then what looked like harmful rules was hard questions, no
  per-rule verdict in this project can be trusted, and the next experiment is not about rules at all:
  it is R66's position, where the evidence arrives after a failure and the question of relevance has
  already been answered by the failure itself.
- **The dose is what hurts** — the whole-split delta clears +0.5pp while the class table shows no
  separation. Then any rule removed helps, the pack is too large at 1.86, and the next registration is
  a dose curve measured causally rather than the `chars-N` curve R25 read, where every point looked
  down the axis and the only recoverable finding was that harm shrinks when nothing is injected.

## What this file does not do

It does not prune anything, and it does not change a default. The store is built exactly as it is
built today; the only difference is that one rule per question is absent from the prompt. A
registration that pruned while measuring would be measuring its own intervention.

## Amendment 1 — the arm is a hash of the question, and the fold is part of the key

**Written before dispatch.** The first version hashed the question alone. Two folds share no
questions, so the only effect of adding the fold is on the rare question that appears twice — and
leaving it out would mean a question's withheld rule is the same in every dispatch, which is
precisely what makes the choice reproducible. The fold is in the key anyway, and the reason is
narrower than reproducibility: `looDropped` is recorded on the row, and a re-derivation that did not
have the fold could not check the record. The field exists so that the choice is *checkable*, not
merely *repeatable*.

The second version of this paragraph claimed the fold made the choice "independent across folds",
which is wrong — the folds partition the questions, so there is nothing to be independent of. The
correction is recorded rather than deleted because a registration is a document about what was
believed, and this file has already published one sentence that a fold total refuted.
