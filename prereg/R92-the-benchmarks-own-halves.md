---
id: R92-the-benchmarks-own-halves
step: R92
opened: 2026-11-13
arms: memory
sample: 160
gates: V1,V2,V3,V5,V6,V7,V8,V32,V44
recallFloor: 0
facadePair: off
trainDomain: retail
testDomain: retail
recallDomain: retail
distillUnit: raw
distillScope: edited
rawCeiling: 2000
packBudget: 2400
taskSplit: official
trainTasks: 74
testTasks: 40
release: v1.0.1
---

# R92 — the held-out half has to be the one the benchmark names

**Registered** 2026-11-13. R91's instrument fixed the store; this arm fixes the *sample*, and it is the
last thing standing between this lane's numbers and a comparison anyone can check.

τ² ships `data/tau2/domains/retail/split_tasks.json`: **74 train, 40 test**. This lane has never read it.
`TRAIN_SHARE = 0.5` cut the 114 tasks itself, taking the lexicographically first 57 for learning and the
rest for scoring — so every held-out number in the record (`0.5752`, `0.5614`, `0.7018`, `0.6316`) was
measured on a set the benchmark does not define. Meanwhile ALTK-Evolve's published held-out figure,
**67.5%**, is on the benchmark's 40. The lane has been ranking itself against a number from another
population, which is the same error it has spent four rounds auditing inside its own registrations.

`splitFromOfficial` reads the file, `heldOutPlan` takes it as-is, and `taskSplit: official` is the only
value that turns it on — a share spelled in this header would move the boundary the comparison rests on.

The two caps are stated even though the file states them, and the reason is a repository variable:
`TAU_TRAIN_TASKS` is **57**, left there by the arms that ran the lane's own cut, and a registration that
said nothing would have its 74 learned tasks silently capped at the number a previous dispatch chose. The
caps and the split now agree, and a disagreement between them would be visible as 57.

**And the release, because the first dispatch of this arm died for want of it.** The lane had pinned τ²
**v0.2.0**; `split_tasks.json` ships from v1.0.0, and the published 67.5% was produced on **v1.0.1**. The
boundary is not a version of the software: at v1.0.1 all 114 retail tasks declare a `reward_basis` (112 of
them `DB+NL_ASSERTION`) and 112 are graded on their prose rubric, where at v0.2.0 no retail task declared one
and the default `DB+COMMUNICATE` applied. Airline did not move. So `release: v1.0.1` is stated here, the
driver refuses a dispatch pinned elsewhere, and the artefact carries `benchmark {version, commit}` — a number
without a release cannot be ranked against a published one, which is the defect this whole round is about.


## The question is recorded here, and deliberately not pinned

R91's readback found the second draw: `buildPack` ranks on the question, the question is the user
simulator's sampled first turn, and no arm in this record had ever recorded one. This arm carries
`tau2.queries` — every request, its position, and a digest of the mapping — so that its packs are
explainable and so that a later pin can be derived from this run, which is exactly how R90's `storeItems`
made the store pin possible.

It does not set `queryPin`, and the absence is the decision rather than an omission. This arm's product is
an **absolute** number to rank against ALTK-Evolve's 67.5% on the same 40 tasks; a pinned phrasing is a
retrieval stimulus no user typed, and a pack matched to a sentence nobody sent is a weaker treatment than
the one deployment gives. The pin belongs to the arms whose subject *is* the pack — R93's grid, where two
floors are only two levels if they are read against one question.

So this arm's `pack.meanChars` and `coverage.p50` are readings of (question draw, pack), and its readback
will say so rather than quoting them to four figures.


## What moved, and what did not

| | R90 / R91 | R92 |
| --- | --- | --- |
| the split | this lane's cut, 57 / 57 | **the benchmark's, 74 / 40** |
| the store | 15 records from 57 failures (pinned in R91) | **rebuilt from the 74 train tasks** |
| ceiling, pack, admission, scope, trials, model, guard | — | **same** |

The store has to be rebuilt rather than pinned: R90's fifteen failures were drawn from the lane's 57, and
only part of that half is inside the benchmark's 74. A pin applied across two different learn halves would
be a store this arm did not learn from, which is the defect R91 exists to remove in the other direction.

## Prediction

- **The halves are the published ones.** `plan.train` is 74 tasks and `plan.test` 40, the run prints
  `split: the benchmark's own`, and `metrics.tasks = 40`. Anything else means the file was not read and
  no number below is comparable to the competitor's.
- **The store is built from the wider half.** `learning.edited` between 10 and 25 — 74 tasks at a
  measured ~21% failure rate on this corpus, so a store of 15 ± 10. A store of 57-or-more would mean the
  learning half was not the benchmark's.
- **`pass^4` is reported against the 40-task baseline.** `PUBLISHED_PASS4 = 0.575` *is* the published
  held-out baseline on these 40 tasks (ALTK's `None` row, GPT-4.1), so this is the first arm in the
  record whose delta against it is not cross-split. The model still differs — deepseek against GPT-4.1
  with a GPT-5.5 simulator — and that is stated beside the number rather than corrected for.
- **The pack's occupancy inherits R90's shape, not its text.** `pack.budget = 2400`,
  `pack.capacity = 2010`, `pack.meanIds = 1`: the records are new, but a 2,400-character pack carries one
  record in this lane's shape whatever the record says, and `droppedForSize > 0` is the counter that
  shows it rather than the inference that assumes it.
- **No direction on `pass^4`.** n = 40 gives a half-width near ±14.7pp at p ≈ 0.65, wider than the
  +5.66pp R90 reported at n = 57. This arm buys comparability, not resolution — and a reader who wants
  both needs the second domain, which is the next queue item.

## Refutation

- **The split was not read.** `metrics.tasks ≠ 40`, or the learn half is 57. The header, the corpus path
  or the plan is wrong; the run is discarded before its outcome is read.
- **The benchmark's file names a task this corpus does not hold.** `heldOutPlan` refuses it rather than
  evaluating fewer tasks; a run that produced a number anyway absorbed a corpus mismatch.
- **The store is smaller than the failures.** `learning.edited = 0` or `stored < edited`: the wider half
  failed the write, and nothing below describes a memory.
- **`pass^4` below the 40-task baseline.** With a store built from 74 tasks and every record intact, this
  would be the cleanest evidence for the negative effect the lane has been chasing — at the sample the
  competitor used, on the split the benchmark defines.

## Cost

74 learn episodes + 160 evaluation episodes = 234, at R85's billed band **~$1.00**, off-peak, one τ²
dispatch at a time. It is cheaper than R90 despite the wider learn half because the evaluation half is
40 tasks instead of 57.

## What this unlocks

| cell | split | store | isolates |
| --- | --- | --- | --- |
| R89 / R90 / R91 | lane cut 57/57 | drawn → pinned | pack, identity, instrument |
| **R92** | **benchmark 74/40** | **rebuilt from 74** | **the sample, and the first comparable delta** |
| R93 (not registered) | benchmark 74/40 | pinned from R92 | the pack at a fixed store |
| R94 (not registered) | benchmark 74/40 | pinned from R92 | the ceiling at a fixed store |

Every ablation registered before this one is priced on a split no competitor used. After it, the same
ablations run on one that a published number exists for — which is the difference between "the lane's own
instrument says it improved" and "a reader can check".
