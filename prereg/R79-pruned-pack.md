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
