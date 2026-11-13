---
id: R99-the-supply-arm
step: R99
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
distillScope: all
rawCeiling: 2000
packBudget: 2400
taskSplit: official
storePin: eval/pins/r92-retail.json
trainTasks: 74
testTasks: 40
release: v1.0.1
---

# R99 — fifteen records against a 292-rule playbook is a supply gap, not a tuning gap

**Registered** 2026-11-13, dispatchable after R93. Every arm in this record learns from **failures
only**: `distillScope: edited` is the default and no published number was measured under anything else.
On the benchmark's own learn half that is **15 corrections from 74 tasks** — a fifth of the half — and
R92 served them to 40 held-out tasks at **1.09 items per request**, refusing **1,119 candidates for
size**, with a median question coverage of **0.214**.

The competitor's playbook holds **292 rules**. Appendix M has called the gap "an order of magnitude" for
three rounds; this arm is the first that can price it, because it changes one thing: **the population the
store is built from**.

## What R93 changed about this arm's yardstick, written before this arm runs

R93 measured the store on the benchmark's own 40 held-out tasks with the memory off in the same
dispatch: **memory 0.700 against no memory 0.725**, paired delta **−2.50pp [−17.50, +12.50]** at
p = 1.0000, with **13 trials repaired and 10 broken** of 160 and a bill of **2.17×** the control
($0.8276 against $0.3807 over the same 160 conversations).

So the yardstick is no longer the competitor's 0.675, which this lane's *memory-free* arm already clears.
The question this arm answers is narrower and harder: **does five times the supply close the 2.5 points
the memory currently costs, at the same dose and the same pack?** A store that only matches no memory is
still not a flywheel, and this registration is written to say so rather than to celebrate 0.675.

## The one variable, and what it is not

`distillScope: all` teaches from every task that states a rule, not only from the ones that failed. On
this corpus that is 74 tasks against 15, and the extra 59 are the tasks the agent **passed** — so what
they teach is the rule a successful trajectory followed, which `taskCorrection` renders from the same
`evaluation_criteria` the failures use.

It is not a dose experiment, and the distinction is the point. R16 moved items per question at a fixed
store and found the curve flat-or-negative from the first item; this arm moves the *store* at a fixed
dose — one item per request, 2,400-character budget, unchanged — and asks whether a store that covers a
fifth of its learn half behaves differently from one that covers it entirely.

It is also not a re-draw. The pin replays R92's fifteen failures, so the fifteen records the failures
teach are the same fifteen R92 served; the arm adds 59 and changes nothing else.

## Why the literature says this is the missing half

Both canonical systems aggregate over *every* experience they have, not over their mistakes:

| system | what it learns from | the ablation that says the population matters |
| --- | --- | --- |
| **ExpeL** (AAAI 2024) | every gathered trajectory; insights merged with `UPVOTE`/`DOWNVOTE` | insights 36.0 vs retrieval 31.0 vs both 39.0 on HotpotQA; an insights pool built only from the few-shot examples has **no advantage over ReAct** |
| **AWM** (ICML 2025) | successful trajectories only | +51.1% relative on WebArena with workflows induced from solved runs |

The ExpeL line is the load-bearing one: a pool built from a *narrow* population — their few-shot
examples, this lane's fifteen failures — scored no better than no memory at all, while the pool built
from a wide one reached 39.0 against ReAct's 28.0. This lane has only ever built the narrow one.

## Prediction

- **The store is five times larger and the pack is not.** `learning.distilled` between **68 and 74**
  (74 tasks, two of 114 in this corpus state neither an action list nor a rubric, so a handful teach
  nothing); `store.stored` 68–74; `pack.meanIds` still ≈ 1.1 and `pack.droppedForSize` **above 1,000**,
  because a 2,400-character budget with 1,700-character records carries one whatever the store holds.
  A `meanIds` that moved would mean the pack changed, and the pack is not the variable.
- **Provenance splits, and that is the treatment.** `provenance.passed` ≈ 58, `provenance.edited` = 15.
  An artefact whose `passed` count is zero did not apply the scope.
- **Supply buys coverage at the retrieval side.** `coverage` median above R92's **0.214**, and
  `use.distinct` — a field this lane can report for the first time (R93) — above **30 of the 68–74**.
  A store that serves one record per request out of seventy is a store whose *ranking* is doing all the
  work; that is exactly the claim this reading tests.
- **The score moves, and the only movement worth buying is a large one.** At n = 40 this lane resolves
  **21.02pp**, so a 2.5pp recovery cannot be certified by any arm on this sample. The prediction is
  therefore stated where it can be falsified: `pass^4` **at or above 0.775** (R93's memory leg + three
  tasks) would be a supply effect large enough to certify, and it would justify the paired re-run that
  prices it. Between 0.700 and 0.775 the arm is a replication with a bigger store; **below 0.700** the
  five-fold store is worse than the fifteen-record one and the supply line closes.

## Refutation

- **The scope did not apply.** `provenance.passed = 0` or `learning.distilled` = 15. The header or the
  dispatch variable did not reach the driver; the arm is a duplicate of R93's memory leg at double the
  distill cost, and no number from it is used.
- **The store grew and the pack did too.** `pack.meanIds > 1.5`: the extra records displaced the
  ceiling rather than the ranking, and the arm is measuring capacity (R94's question) instead of supply.
- **`pass^4` below R93's memory leg by more than the interval.** More supply of this unit is *harmful*,
  which is R16's dose curve arriving through the population instead of through the count, and it retires
  the "we simply have too few rules" explanation for the gap to 67.5.
- **No movement at all, with the store at seventy.** Then the unit — a whole task rendered as a Q/A
  exemplar with 154 of 156 values kept verbatim (§34.122) — is the constraint, and R99 closes the supply
  line the way R15 closed the extraction line.

## Cost

160 evaluation episodes + 73 distill calls, at **$0.0053** per conversation → **~$0.70**, one arm, no
learn episodes. It is the cheapest arm in the queue and the only one that can move the score rather than
explain it.

## What this unlocks

| cell | store | what it isolates |
| --- | --- | --- |
| R92 / R93 memory leg | 15 (failures) | the memory's net effect at the store this lane has always built |
| **R99** | **~73 (every task)** | **the population, at the same dose and the same pack** |
| R94 | 73 or 15, ceiling 700/4,800 | the pack, at a store that is no longer the constraint |
| merge arm | ~10–20 after merging by action shape | `supportTasks` above 1, ALTK's `sup3` for the first time |
