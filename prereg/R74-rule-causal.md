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

## Amendment 2 — the cap was an estimate wearing a bound's clothes, and the run paid to find out

**Written after dispatch `42856739453`, which failed 31 minutes in with no artefact.**

Fold 1 completed at **5,483 calls over 4,698 question-arms** — 1.167 per question-arm against the
1.078 R72 measured, because `loo` renders a degraded pack, degraded SQL errors more often, and the
repair call is what turns one failure into a second attempt. The forecast after that fold said the run
needed **29,609** calls; the dispatch had written **28,000**; the lane stopped, wrote a partial
artefact, and exited 1. **The fold it had just paid for was discarded** — $0.45 of calls spent to
compute a number that four more folds would have fitted inside 32,000.

The forecast was right. The dispatch's arithmetic was low by 5.7%, which is the *fourth consecutive
registration* whose estimate was the moving part (R72: 44,000 budgeted, 16,876 spent; R73: 4,000
budgeted, 851 reached before a stop; R73 Amd 2: 5,600 budgeted, 3,165 spent). Four misses in four
directions is not carelessness, it is the wrong instrument: a cost table written by hand is a guess
about a lane whose repair rate changes when its arms change.

**Two defects, one in each layer, and both are now structural.**

1. **An estimate was given a bound's authority.** `forecastBudget` compared the projection against the
   same number the operator had written as the cap, so an arithmetic miss became a run that died
   holding a fifth of its own cost. The two are different objects: a projection is what the folds
   imply, a ceiling is what the operator authorises. **Only the ceiling may end a run now.** A run
   whose projection exceeds its cap but fits its ceiling raises its own cap to the projection
   (`LlmClient.authoriseCalls`, upward only, non-finite ignored) and prints that it did; the artefact
   records `config.budget = { cap, ceiling, cap_in_force }` so the next registration can see the miss
   rather than rediscover it.
2. **The estimate was arithmetic in a Markdown table.** `pnpm eval:budget` now derives it from an
   artefact: the measured rate, the projection, and a ceiling that is a *multiple* rather than a
   number whenever the requested arm list contains an arm the prior run never evaluated — 1.2× for
   the 8% miss, which would have produced 33,416 here and the run would have finished.

The second defect has a corollary worth stating because it is the reason the first one existed. A
number nobody measured cannot be made more accurate by writing it down more precisely, and every
registration that tried was refining a figure that had no measurement behind it. The tool does not
make the estimate correct; it makes the *ceiling* wide enough that being wrong is affordable, and it
prints which arm the width is for.

**Re-dispatched** with `max_calls` 27,846 and `ceiling_calls` 33,416, both from
`pnpm eval:budget --bird eval/results/poc-sota-bird-train-R72-overlap-gate.json --arms none,full,loo`.
Everything else is unchanged: three
arms, `train`, five folds, `learn_sample` 700, `deadline_min` 170.

**What the miss is evidence for, beyond cost.** `loo` costing 8% more calls than `full` is a fact about
the arm: withholding one rule from the pack makes the model's SQL error more often, which is the first
direct evidence in this lane that the rules *prevent* malformed queries rather than merely
contextualising them. If the arm's accuracy is flat while its syntax error rate is higher, that
separates "the rule helps the model say the right thing" from "the rule helps the model say anything
at all" — and the second is testable from the same artefact's statements block at zero calls.

## Outcome — the attribution was two thirds selection effect, and what is left does not pay for a pruning

Run `42890996017`, 2026-11-10 20:01 UTC, 105 minutes. `train`, 7,829
questions, three arms, **24,465 calls**, and `config.budget = {cap: 27,846, ceiling: 33,416,
cap_in_force: 29,587}` — **the ceiling mechanism fired on its first live run**: the projection passed the
forecast at some fold and the run was authorised to continue instead of dying with the folds it had
paid for. Without Amendment 2 this file would have produced nothing for the second time.

**The whole split first, because it is null.**

| arm | accuracy | n |
| --- | --- | --- |
| `full` | 55.66% | 7,829 |
| `loo` | 55.65% | 7,829 |

**−0.01pp** [−0.52, 0.51], p = 1.0000. Withholding one rule per question from a pack of 1.86 moves
nothing at all. The withheld choice was well spread — 532 distinct rules, median 10 draws, max 88.

**The class table is where the file's branches are decided, and it says two opposite things
depending on where the class was decided.**

| class | in-sample Δ (95% CI, p) | pairs | cross-fitted Δ (95% CI, p) | pairs |
| --- | --- | --- | --- | --- |
| harmful | **+2.37pp [1.54, 3.21], p < 0.0001** | 3,369 | **+0.82pp [−0.08, 1.73], p 0.0978** | 2,431 |
| helpful | **−2.84pp [−3.84, −1.88], p < 0.0001** | 2,498 | −0.33pp [−1.42, 0.77], p 0.6241 | 1,828 |
| neutral | −0.51pp [−1.38, 0.36], p 0.2888 | 1,962 | −0.43pp [−1.25, 0.37], p 0.3379 | 3,276 |

**Branch 3 fires, and this file should have predicted that it could.** A rule is called harmful *because*
the `full` arm failed on the questions that drew it, and the paired effect is then measured on those
same questions — so a question that was unlucky is a question whose rules were labelled harmful, and a
second draw on it is expected to improve whatever the rule did. `looCrossFitted` decides each rule's
class on **the other four folds** and measures the effect on the fifth, and the effect falls from
+2.37pp to **+0.82pp** on harmful and from −2.84pp to **−0.33pp** on helpful: **65% of the harmful
signal and 88% of the helpful one were the fold that produced the label.** The neutral class is the only
one that does not move, which is what a null should do.

**What survives, stated at the strength it survives at.** The harmful class keeps its **direction** at
p = 0.0978 and nothing else does. That is not nothing — it is the first out-of-sample evidence this
project has that any per-rule quality signal exists at all — but it is not a lever:

- the effect is **+0.82pp on the 43% of questions that drew a harmful rule**, so pruning all 171 of them
  projects to about **+0.35pp on the split**, on a population where one question is 0.013pp and a
  paired interval at this size is ±0.4pp. **The intervention would be indistinguishable from noise.**
- the helpful class **loses its effect entirely** out of fold, so "keep the good rules" has no measured
  basis and the pruning can only be one-sided.
- 294 pairs withheld a rule that no other fold saw and are counted as `unseen` rather than neutral,
  because neutral is a measurement and unseen is the absence of one.

**So the answer to the question the user posed — that what we memorise and how we use it is wrong
because the memory is wrong — is: yes for the instrument, and not enough for the intervention.** The
per-rule verdicts this project has been using to decide what goes into memory are **two thirds
regression artifact**. That is a defect in `attribution.ts`'s output as a *decision input*, and it is
now recorded as such. But the residual, measured causally, is too small to prune.

**The whole-split null now has three explanations and the file's own branch structure cannot separate
them.** −0.01pp is consistent with (i) a pack of 1.86 rules whose average effect is zero because helpful
and harmful cancel, which the in-sample table appeared to show; (ii) a pack whose rules are mostly inert,
which the cross-fitted table shows; and (iii) an effect too small to see at 7,829 questions. The
cross-fitted numbers favour (ii): the harmful class is worth +0.82pp and covers 43% of questions, the
helpful class is worth nothing, and 0.43 × 0.82 ≈ 0.35pp is inside the interval of the whole-split null.
**A pack cannot help if most of its rules are inert, and this project has never once measured how many
of its rules do anything at all.**

**The next registration follows from that sentence rather than from a branch.** Its question is not
"which rules are harmful" but **"how many of the 540 rules change any answer, in either direction"** —
the inert share, measured by a within-question design that randomises *which* rule is withheld across
draws rather than holding one hash draw per question. That is a different instrument from this one and
is registered separately.

**Two instrument defects found while reading this file.**

1. `pnpm eval:loo` had **never produced output**. The command was registered in `package.json`, the
   module was covered by sixteen tests, and the binary exported `main` without ever calling it: a
   script that exits zero and prints nothing, which is the worst shape a defect can take because every
   gate in this repository passed. Fixed, and it is the reason this file's numbers exist at all.
2. The in-sample class table was the only one the module produced. `looGroups` is now labelled for what
   it is in the code, and `looCrossFitted` sits beside it with the reason written down.
