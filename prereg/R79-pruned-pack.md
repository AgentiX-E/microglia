---
id: R79-pruned-pack
step: R79
opened: 2026-11-11
arms: pruned
sample: 1900
offset: 2000
temperature: 0
looTargets: eval/manifests/loo/R77-silent-tail.json
gates: V1,V2,V3,V4,V5,V6,V7,V8,V12,V32,V44,V48,V51
---

# R79 — the first arm that asks whether removing memory helps

**Registered** 2026-11-11, to be dispatched after R78 returns, **on R78's own slice**.

## Why this and not another formulation

R77 measured the memory's net effect at **+0.25pp** on 2,000 paired questions, 95% **−0.90 … +1.40**,
p = 0.73. R63 measured +0.57 on Mini-Dev, the October artefact measured −2.86. Four dispatches, three
splits, two backbones, and the one quantity every arm is supposed to move has never separated from zero.

Inside that, R77 found two things that are not noise:

- **74.8 rules of dead weight**, 95% **72.5 – 77.1** (15.4–16.4% of the 472), from `silenceReading`'s
  interval rather than from its point estimate;
- **`full` beats `loo` by 0.90pp**, p = 0.089, 59 lost against 41 gained — so the *last* rule in a pack
  is worth more than the pack is.

A pack is 1.83 rules and 1,083 characters. This arm shrinks it to about 1.0 rules and asks what happens.
It is the smallest treatment this lane has ever applied — a change in *quantity* on a component whose
sign is unknown — and the first one whose counterfactual is "less memory" rather than "different memory".

## What it measures

`pruned` renders the `full` pack with every rule on `looTargets` withheld. Same question, same store, same
budget, one fewer rule on the 18.4% of questions that hold one. The comparison is paired within the
question against `full`, so a 1pp move in the pack is a 1pp move in this number.

| reading | where it comes from |
| --- | --- |
| `pruned` vs `full`, paired | the arm pair this registration buys |
| rules actually removed per question | `armPackIds` for `full` minus `pruned` |
| packed questions that emptied | `pruned` pack ids = 0 |

## Prediction

- The paired difference will be **inside ±1.5pp**, because 74.8 rules of 472 is 16% of the pack and the
  whole pack is inside ±1.4. A pruning that moved the number by more than the component it prunes would
  mean the dead-weight reading is wrong about which rules are dead.
- **`pruned` will render 0 rules on about 10% of the questions** that `full` rendered one on: the plan's
  105 rules are 22% of the 472 ever drawn, and 18.4% of packs hold one of them at 1.83 rules per pack.
- The **learning cache will pay for most of this dispatch**, because it scores R78's slice with R78's
  seeds: `SOTA_DISTILL_CACHE` keys on the prompt, and the prompts are the same questions. A replay that
  costs 3,500 fresh distillations would mean the cache key moved, which is itself worth knowing.

## Refutation

- **If `pruned` renders the same ids as `full` on every question**, the plan did not reach the arm and
  this is `full` under a second name — the failure `full-validated` was refused for.
- **If `pruned` is worse than `full` by more than 1.5pp**, the rules on the list are not dead: they are
  used, five draws was not enough to see it, and the 5-draw threshold in `drawsToResolve` is wrong about
  this pack rather than the rules being wrong about it.
- **If `pruned` is better by more than 1.5pp**, the dead weight is not inert but harmful, and the next
  registration is a pruning in the product rather than an experiment about one.

## What this file does not do

It does not prune the store. The rules stay; only one arm renders without them, because a deletion made
on the strength of a top-up that has not returned would be a deletion on the strength of R77's four-draw
draws, which is the thing R78 exists to fix. If this arm moves nothing, nothing is deleted and the memory
keeps its 1,083 characters with a number that says why.

## Outcome — pruning a fifth of the pack moved one question (2026-11-11)

Dispatch `42958324847`, 04:18 UTC, **6,663 calls, $0.5398, all off-peak** (R78 paid $1.111 for 6,943
calls at 03:19 with 95% of it peak), 1,900 questions at offset 2,000, 54 databases, five folds, no gate
failed and no call failed.

| arm | accuracy | pack |
| --- | --- | --- |
| `none` | 57.74% (1,097) | — |
| `full` | 57.63% (1,095) | 1.84 rules, 1,090 chars |
| `pruned` | **57.68% (1,096)** | **1.48 rules, 904 chars** |

**Paired, `pruned` − `full`: +0.05pp, 95% [−0.79, +0.84], p = 1.0, 33 gained against 32 lost.** One
question of 1,900. The 105 rules the plan names were withheld from **694 of the 3,497 placements**
(19.8% of the injected text) and the number did not move.

**What the pruning actually touched.** 642 questions (33.8%) held at least one named rule — 590 held
one, 52 held two — and **116 packs emptied completely** (6.1% of the split). Those 116 are the only
place where the treatment is "no memory at all", and there the direction is the wrong one for the
dead-weight story: `pruned` **67.24%**, `full` 65.52%, `none` 66.38%. Removing the memory from those
questions *helped* by 1.7pp against the pack and 0.9pp against nothing — on 116 questions, which is a
±8pp interval. It is not a result; it is the absence of the one that was predicted.

### The prediction that matters was the one about the reach

| prediction | registered | measured | |
| --- | --- | --- | --- |
| paired difference | inside ±1.5pp | +0.05pp | **holds** |
| questions holding a named rule | 18.4% | **33.8%** | fails, 1.8× |
| packs emptied by the pruning | ~10% | **6.1%** | fails, 0.6× |
| the distill cache pays for the dispatch | "most" | **2,825 hits / 87 misses = 97.0%** | holds |

**Both legs of the second prediction missed, and the direction of the miss is the finding.** The plan's
105 rules are 22% of the 472 the store ever drew, and they sit in **33.8% of packs** — over-represented
by 1.5×. `silenceTargets` selects rules that were *drawn and never decisive*, and a rule is drawn
because it resembles the question; a rule that resembles everything is drawn against everything and
decides nothing. **Dead weight is not a property of a rule being useless; it is a property of a rule
being generic.** That is the same fact R78 found from the other side, when the 97 plan rules that
survived into a store learned from other questions turned out to be the ones with no domain.

**And the arithmetic that made the prediction wrong is worth keeping.** 18.4% was derived from the draw
plan — 346 draws over 1,900 questions — while a *placement* is a rule in a pack, and a rule that matches
every question is placed on all of them. The prediction counted draws where the quantity is placements.
Pruning by placement removes 19.8% of the text; pruning by draw would have removed 18.2% of a much
smaller thing.

### What this closes

R77's Amendment 4 read 15.4–16.4% of the pack as dead weight from `silenceReading`'s interval. R79 is
the intervention that tests it, and the answer is that **the dead weight is inert in the strict sense:
removing all of it at once changes the number by less than a tenth of the interval it was measured
with.** The negative effect this project keeps looking for is not concentrated in the never-decisive
rules, and it is not concentrated anywhere the pack can reach: `full` against `none` on this slice is
**−0.11pp**, so the whole component is inside its own noise before any pruning happens.

**A note on the re-purchase.** `full` here is the same cell R78 bought — same questions, same seed, same
packs — and it came back 57.63% against 57.79%: three questions apart, with 97% of the distillations
served from cache. That is the reproducibility this lane has, and it is the reason every reading above
is the **within-run paired** one rather than a comparison against R78's table.

### The defect this run found in its own artefact

`config.loo_targets.given` read **`0` of 105** — while 694 placements of exactly those rules were being
withheld. The counter it reads is incremented inside the `loo` arm, and this dispatch bought `pruned`
alone, so the field was structurally zero: not "the plan missed this store" but "nobody was there to
count". It is the same shape as R67's arm table — a field that is correct when its own arm runs and
silently wrong when another one does — and it very nearly sent this readback looking for a store-local
plan failure that had not happened.

`planCoverage` now reports three numbers instead of one: **`present`** (rules this store holds, a
property of the store and of no arm), **`given`** (draws taken, `null` unless `loo` ran), **`withheld`**
(rules `pruned` removed, `null` unless `pruned` ran). This artefact predates the fix and reads `0`; the
number it should have carried is **`present: 97`, `withheld: 97`** — recomputed from `per_case`
(`packIdList` against the plan's ids, and `packIdList` minus `armPackIds.pruned`) rather than from the
field. Ninety-seven is also exactly what R78's `given` counted, which is what it should be: same slice,
same seed, same store. The eight rules the plan names that no pack holds did not survive into a store
learned from these questions.
