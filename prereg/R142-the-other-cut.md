---
id: R142-the-other-cut
step: R142
opened: 2026-11-18
# R141's floor removed the harm and the gain in equal measure on paper, and on the arm it removed the harm
# only: 5 broken fell to 1, 5 repaired stayed 5, and the delta turned positive for the first time in this
# lane. That reading cannot be claimed at n=40, so this round buys a second population to read it on.
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
trainShare: 0.5
trainTasks: 57
testTasks: 57
trainDomain: retail
testDomain: retail
recallDomain: retail
packBudget: 2400
packLimit: 1
release: v1.0.1
claimRuler: interval
---

# R142 — the other cut

**Registered** 2026-11-18, after reading R141 (`44162747993`) and before the arm runs.

R141 asked whether the store's consensus separates a harmful served item from a helpful one, and answered
in the direction the registration predicted but not in the size it expected:

| reading | R139 (no floor) | R141 (floor 2) |
| --- | --- | --- |
| broken trials | **5** of 32 the control passed (15.63%) | **1** of 33 (3.03%) |
| repaired trials | 6 | **5** |
| paired delta | +2.50pp [−15.00, +17.50] | **+10.00pp [0.00, +22.50]** |
| informative trials | 11 | 7 |
| verdict | UNRESOLVED (MDE 23.23pp) | UNRESOLVED (MDE 17.16pp) |

Two of R141's four predictions were falsified in the useful direction — `retired` landed at 50 against a
40–46 band and `retained` at 14 against 9–13, and the mean did not go flat or worse, it went up — and one
was falsified by being written in the wrong unit (`serveSplit.served` "at most 13" counted items where the
split counts requests: 37 of 40 requests were served, from 14 records).

**What is not established.** A delta of ten points at an MDE of seventeen is not a small effect, it is an
unmeasured one. The harm share moved from 15.63% to 3.03% on 32 and 33 trials — Fisher's exact p = 0.10.
Neither reading is a claim, and building the outcome counter on top of them would be building on two
directions that the record has already certified it cannot see.

## What is being measured

The **same treatment** on a **different held-out population**, which is the cheapest replication this lane
can buy:

- the same floor (`serveSupport: 2`), the same pass (`consolidate: true`, `linkage: all`, key `routine`);
- the lane's own cut of all 114 retail tasks at 0.5 — **57 learn / 57 held out** — rather than the
  benchmark's 74/40;
- `trainShare` is now a registration header rather than a repository variable, so the cut is in this diff
  and not in whichever dispatch edited `vars.TAU_TRAIN_SHARE` last. That is the round's only code change
  to the treatment, and it changes no number the arm computes: `splitTaskIds` is the function the lane has
  always used, and 114 at 0.5 is the 57/57 every pre-R92 arm ran on.

## Prediction

- **`supportFloor.retired` 30–42, `retained` 8–14.** The forecast is R141's ratios carried to a smaller
  learn half: 73 corrections from 74 learn tasks, 83 admitted, 19 merged, 64 retained, 50 retired, 14
  servable. At 57 learn tasks the same ratios give ~56 corrections, ~64 admitted, ~12–15 merges, ~49
  retained and ~37 retired. The band is wide because the merge rate is content, not arithmetic, and R141's
  own band was wrong on this axis by four items.
- **Every served item carries support ≥ 2**, which is the floor's own criterion and is read from `pack`'s
  `support ≥2` count against `recall.served`. A served singleton means the floor did not reach the pack.
- **The harm share stays below R139's 15.63%.** This is the round's falsifiable claim and the one that can
  resolve at this n: 1 broken in 47 control-passed trials is 2.13%, which separates from 5 in 32 at
  Fisher's p ≈ 0.04. A harm share back above 10% falsifies the floor's mechanism, not its direction.
- **The delta is positive but again unresolved.** At n = 57 the pair resolves ~14.4pp (R141's 17.16pp
  scaled by `sqrt(40/57)`), so an effect of ten points cannot clear it. Registered as a direction with the
  bound printed: `|delta| < 14.4pp` is what this arm can say.
- **`serveSplit.served` is a share of requests, not of records**, and no band is stated for it: R141's
  prediction compared a request rate to a record count and the error cost a paragraph of readback.

## Refutation

- **`retired` < 25 with `floor: 2`.** The learn half was too thin to corroborate anything, and the arm
  measured a store, not a floor. Then the next round returns to 74 learn tasks and the *cheapest* way to
  raise n is a second domain rather than a smaller store.
- **A served item with support 1.** The floor did not reach the recall path.
- **Harm share ≥ 10%.** Corroboration is not what separates harm from gain, and R141's 3.03% was the
  smaller sample. The next axis is the content of the served claim.
- **Delta significantly negative.** The floor is a tax at this population and the treatment is withdrawn.

## Decision rule, stated before the number

| outcome | what the next dollar buys |
| --- | --- |
| harm share < 5% and delta ≥ 0 | **the outcome counter** (R129), which now has both a population that recurs and two arms that did not break more than one trial in fifty |
| harm share < 5% and delta < 0 | **the gain side**: the floor is safe and insufficient, and the next arm asks what makes a corroborated claim useful |
| harm share ≥ 10% | **content**, not support: the axis moves from how many tasks agreed to what the served claim says |
| `retired` < 25 | **the store's supply**, at 74 learn tasks or a second domain, before any mechanism is priced again |

## Cost

**~$0.30**, and the number is R141's own bill rather than an estimate: its memory arm read
`cost.usd 0.1986` and its reference arm `0.0973`, both off-peak, for 74 learn and 40 held-out episodes. This
arm runs 57 and 57 — the same total, differently divided — so the pair should land within a cent or two of
$0.2959. The floor adds no model call, the distillation ceiling stays at 400, and the pack budget at 2,400:
nothing in this round can raise the bill except a store that distils more corrections than R141's 73, and a
smaller learn half can only do the opposite.
