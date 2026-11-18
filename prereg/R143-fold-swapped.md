---
id: R143-fold-swapped
step: R143
opened: 2026-11-18
# The benchmark's own boundary read backwards: the store learns from the 40 published test tasks and answers
# the 74 published train tasks. It is the only direction that covers a task the published direction cannot,
# and it is the half of the cross-fit that makes the pool 114 instead of 40.
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
taskSplit: official-swapped
trainTasks: 40
testTasks: 74
release: v1.0.1
claimRuler: interval
---

# R143, fold `official-swapped` — the same document read backwards

**Registered** 2026-11-18, before the arm runs, and paired by construction with `R143-fold-official`.

## What this fold is

`split_tasks.json` states 74 train and 40 test. The published direction learns from the 74 and answers the 40;
this one learns from the 40 and answers the 74. Neither is a boundary this repository chose, and together they
answer every task once — by a store that never saw it.

## The confounder this fold carries, stated before the number

The halves are not the same size, so the **stores the two folds serve are not the same store**:

| fold | correction supply | evaluated trials | weight in the pool |
| --- | --- | --- | --- |
| `official` | R141 distilled 73 corrections from 74 learn tasks | 40 | 35% |
| `official-swapped` | ~40 corrections from 40 learn tasks, before the pass merges what recurs | 74 | **65%** |

A cross-fit removes the leak and does not remove this. The pooled number is therefore **65% the thin store's
fold**, and the per-fold deltas are the primary reading: a pool of a rich store and a poor one averages two
mechanisms, which is the same error §8.18 refuses for two treatments.

Two consequences, both registered rather than discovered later:

- **the pool's point estimate is expected to sit between the folds, weighted 0.65 toward the swapped one**;
- **a wide gap between the folds is the finding, not noise**: it is the supply's contribution, measured for
  the first time on this lane at two sizes with one treatment.

## Prediction

- **The store is thinner and the floor retires fewer items in absolute terms.** At 40 learn tasks the
  correction supply is roughly half R141's 73, the pass merges less, and `supportFloor.retired` is predicted
  at **22–32** with `retained` **5–10**. The rates should be close to R141's 60% retired; the counts cannot be.
- **Every served item carries support ≥ 2**, which is the floor's own criterion and is read from the pack's
  `support ≥2` count against `recall.served`.
- **The harm share stays below 8%.** This is a looser bar than the official fold's 5%, on purpose: the thin
  store is served into 74 trials it has less evidence about, and a floor built on 40 tasks corroborates less.
  A harm share above R139's 15.63% would still falsify the mechanism.
- **The delta is positive but smaller than the official fold's.** A thinner store, asked a harder question —
  the 74 published *train* tasks are not the ones the benchmark scores, and nothing says the retriever finds
  them as well. Predicted `+4pp to +9pp`, and stated as a direction because at 74 evaluated trials this fold
  alone resolves ~13.6pp.
- **`serveYield.opportunity` is a smaller share of renders than the official fold's 17.5%**, because the
  reference arm is likelier to pass on tasks a memory built from the other half cannot help with.

## Refutation

- **A served item with support 1.** The floor did not reach the recall path.
- **Harm share ≥ 15.63%** — R139's no-floor reading. The floor does not survive a thin store, and its claim is
  bounded by the supply rather than by corroboration as such.
- **`retired` < 18.** The store was too thin to corroborate anything, and the pool would then be comparing a
  treatment against a corpus effect; the honest disposition is to pool `official` alone and say so.
- **A delta below −2pp.** The thin store is a tax, and the pool's 65% weight turns that into the round's
  headline — which is a real result about supply and would send the next dollar to the store's yield.
- **A fold that evaluated a task it learned from.** Impossible by construction and checked by the pool's own
  leak test: `learned ∩ evaluated` must be empty, and the two folds' evaluated sets must not intersect.

## Decision rule, stated before the number

| outcome | what the next dollar buys |
| --- | --- |
| both folds positive, pool p < 0.05 | **the outcome counter (R129)** against a resolved reading |
| both positive, pool p ≥ 0.05 | **headroom, not n**: 85% of renders are inert on this corpus |
| swapped ≤ 0 while official > 0 | **the supply curve**: the same treatment at two store sizes, which prices corroboration per correction for the first time |
| either fold breaks more than 3 trials | **the floor is withdrawn** before any counter is built on it |

## Cost

**~$0.30.** 114 episodes per arm over the same two arms — 40 learn and 74 held out rather than the reverse —
so the bill should land within a cent of R141's `0.2959`. `not_before: 10:00`, because the rate card's peak
windows are 01–04 and 06–10 UTC and this job needs 65 minutes of off-peak after the wait; the dispatch is sent
no earlier than 06:00, which is the 240-minute cap `planBandWait` puts on the wait. The two folds are separate
dispatches; the workflow declares no `concurrency` group, so they may run in parallel and the second one's wait
is zero.
