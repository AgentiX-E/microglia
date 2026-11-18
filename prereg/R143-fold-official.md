---
id: R143-fold-official
step: R143
opened: 2026-11-18
# The published direction of the benchmark's own split, re-run so that the pair artefact states the two id
# sets it ran. R141 ran this exact treatment and its artefact carries the halves inside the arm files but not
# in the pair file, so the cross-fit refuses it — and refusing rather than back-filling is the pool's whole
# claim. This fold is therefore a replication of R141 as well as one half of R143.
arms: memory
sample: 114
gates: V0,V1,V2,V3,V5,V8
recallFloor: 0
facadePair: off
facadeNotes: off
facadeShapes: off
distillScope: all
distillUnit: correction
distillForm: lesson
consolidate: true
consolidateKey: routine
consolidateLinkage: all
serveSupport: 2
speakMargin: 0
trials: 1
trainDomain: retail
testDomain: retail
recallDomain: retail
packBudget: 2400
packLimit: 1
taskSplit: official
trainTasks: 74
testTasks: 40
release: v1.0.1
claimRuler: interval
---

# R143, fold `official` — the direction the benchmark publishes, run again so the file can say so

**Registered** 2026-11-18, before the arm runs, and paired by construction with `R143-fold-swapped`.

## Why this fold is a re-run rather than a read

R141 ran this treatment on this split and published a pair artefact. That artefact does not state its two id
sets, because the field that carries them (`foldSplit`) was added after it was written. The cross-fit refuses a
fold that cannot state what it learned from — the whole claim is that no task is scored by a store that saw it,
and an identity nobody recorded cannot be checked.

Back-filling it from the arm files is the obvious shortcut and it is refused for the reason the pool exists:
a reader who trusts a reconstructed boundary is trusting the reconstruction. So the fold is run again, at
$0.30, and the round buys three things for it:

1. the identity, so the pool can run at all;
2. a **test–retest** of one treatment on one population, which the record has never had — and whose
   disagreement is the floor of every future delta on this lane;
3. the second population (`R143-fold-swapped`) measured under the same treatment on the same day.

## The arithmetic this round was designed around

| population | discordance | `mde80` |
| --- | --- | --- |
| n = 40 (R141's held-out half) | 7 / 40 = 17.5% | **18.53pp** |
| n = 114 (the corpus) | 7 / 40 carried over | **10.98pp** |

`detectableDelta` at R141's own discordance. The cross-fit therefore buys **7.5 points of resolution**, not a
larger effect: an interval that had to clear 18.5pp to resolve now has to clear 11pp. And a ten-point effect
sits *on* that line rather than inside it, which is the honest reason this round cannot promise a verdict.

**What it can promise is the count.** If the two folds reproduce R141's shape — 5 repaired and 1 broken per 40
evaluated trials — the pool holds 12–15 gained against 3–5 lost, and the exact McNemar test separates:

| gained / lost | p |
| --- | --- |
| 10 / 5 | 0.3018 |
| 13 / 4 | 0.0490 |
| 12 / 3 | 0.0352 |
| 15 / 3 | 0.0075 |

So the prediction is stated as a pair count rather than as a percentage, because at this n the count is what
decides.

## Prediction

- **`supportFloor.retired` 44–56, `retained` 8–14** at 74 learn tasks. R141 read 50 and 14 on the same
  registration; the band is R141's own reading widened by the merge rate's content dependence, which has
  already been wrong on this axis by four items.
- **Every served item carries support ≥ 2.** The floor is the treatment; a served singleton means it did not
  reach the pack.
- **The harm share stays below 5%**, and the point estimate is expected to be within a point of R141's 3.03%:
  this is the same treatment on the same population, and a test–retest that moves by five points is a finding
  about the lane's noise, not about the floor.
- **`serveYield.opportunity` lands at 15–22% of renders.** R141 read 17.5% (7 of 40), and the share is a
  property of the corpus and the retriever rather than of the store.
- **The pooled delta is positive and near ten points.** Stated as a direction: this fold alone cannot resolve
  it (18.53pp), and the round's claim is the pool's, not the fold's.

## Refutation

- **A served item with support 1.** The floor did not reach the recall path and the artefact's item table is
  not about the treatment.
- **Harm share ≥ 10%**, or more than 3 broken trials. R141's 1-in-33 does not replicate and the floor's
  mechanism — not its direction — is falsified.
- **`retired` < 35.** The learn half corroborated less than R141's, and the pool would then be comparing two
  stores rather than one treatment.
- **A delta that disagrees with this fold's own R141 reading by more than 10pp.** Test–retest instability that
  large makes every n = 40 number in the record unreadable, and the next dollar goes to the instrument rather
  than to the treatment.

## Decision rule, stated before the number

| outcome | what the next dollar buys |
| --- | --- |
| pooled McNemar p < 0.05, both folds positive | **the outcome counter (R129) on a resolved delta** — the first mechanism this record could price against a resolved reading |
| pooled p ≥ 0.05, folds agree in sign | **a population with more headroom**: 85% of renders are inert on this corpus, and no amount of n moves that |
| folds disagree in sign | **the tiling census**: the corpus is doing the work, and the effect is a property of which half a store learned from |
| a served singleton, or harm share ≥ 10% | **the floor is withdrawn** before any counter is built on it |

## Cost

**~$0.30.** R141's pair cost `0.1986 + 0.0973 = 0.2959` off-peak for 74 learn and 40 held-out episodes per
arm; this fold is the same 114 episodes over the same two arms with the same caps, so the bill should land
within a cent of that figure. `not_before: 10:00` — the rate card's peak windows are 01–04 and 06–10 UTC, and
the job needs 65 minutes of off-peak after the wait, which 10:00 leaves until 01:00. The dispatch is sent **no
earlier than 06:00** because `planBandWait` caps the wait at 240 minutes; a message sent at 04:00 naming 10:00
is refused by that cap rather than by the band.
