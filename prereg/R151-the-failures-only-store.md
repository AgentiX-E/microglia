---
id: R151-the-failures-only-store
step: R151
opened: 2026-11-18
# R142's decision table was written before its number, and its third row sends a harm share of 10% or more to
# the content axis. R142 landed at 12.77%. So this round changes what the store is made of and leaves every
# serving knob at its identity: the axis moves from how many tasks agreed to what the served claim says.
arms: memory
sample: 114
gates: V0,V1,V2,V3,V5,V8
recallFloor: 0
facadePair: off
facadeNotes: off
facadeShapes: off
distillScope: edited
distillUnit: correction
distillForm: lesson
consolidate: true
consolidateKey: routine
consolidateLinkage: all
serveSupport: 1
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

# R151 — the failures-only store

**Registered** 2026-11-18, after reading R142 (`44256793758`) and before the arm runs.

## What R142 read

| reading | R142 (57 learn / 57 held out, `scope: all`, floor 2) |
| --- | --- |
| reference `pass^4` | 0.8246 (47 / 57) |
| memory `pass^4` | 0.7895 (45 / 57) |
| paired delta | **−3.51pp** [−14.04, +7.02], p = 0.7539 |
| lost / gained | **6 / 4** |
| harm share | **6 of 47 = 12.77%** |
| store | 61 items from 57 corrections, 112 candidates |
| consolidation | 11 groups, 13 merged, 48 retained, cross-task 11 |
| floor 2 | 37 of 61 retired, **11 servable**, 9 served |
| renders | 57 requests from 9 records, mean 1.00 items, top-1 19.3% |
| attribution | 4 records carried all six breaks and all four repairs |
| verdict | UNRESOLVED at MDE 15.55pp |

R142's registration behaved exactly as written on the two predictions that could fail and it falsified the
one this round is built on: the harm share did not stay below R139's 15.63%, it came back at 12.77%. The
floor did what it said — `retired` 37 against a 30–42 band, `retained` 11 against 8–14, no singleton served
— and the arm still lost more trials than it repaired.

## The registered branch that fired

R142's decision rule, quoted from the file as it was pushed before the run:

| outcome | what the next dollar buys |
| --- | --- |
| harm share < 5% and delta ≥ 0 | the outcome counter (R129) |
| harm share < 5% and delta < 0 | the gain side |
| harm share ≥ 10% | **content**, not support: the axis moves from how many tasks agreed to what the served claim says |
| `retired` < 25 | the store's supply |

Two of the four rows were available: harm 12.77% and `retired` 37. The first row for `retired` is not
reached, the harm row is, and no interpretation is needed to choose between them. This round is that row.

## What is being measured

**One axis: the population a claim is distilled from.** Every arm this lane has bought since R131 carried
`distillScope: all`, which admits a record from a trajectory that *already passed*. That choice was made for
supply, and the reason is visible in R142's own consolidation line: the fold needs two tasks behind one
routine, and a store built only from failures is a store where every routine has one witness. R142 bought the
witnesses by widening the population to passes, and then the floor selected the largest of those groups — so
what `support ≥ 2` certified was **two tasks whose successful episodes read alike**, which is a description
of behaviour and not a repair.

`distillScope: edited` is the lane's default and has not been measured at this cut. Under it a record is
written only from a trajectory the arm got wrong, and the store is small: R142's 57 learn tasks produce
corrections only for the ones the learn half failed, and the reference arm passes 82.46% of retail at this
cut, so the expected population is **8–16 corrections** against 57.

Two knobs move, and they are one decision:

- `distillScope: all → edited` — the content axis, registered here.
- `serveSupport: 2 → 1` — the floor returns to its identity, because a floor of two over a ten-item store is
  a different experiment with a foreseen outcome. R142 measured the ratio: 11 of 61 items carried support
  ≥ 2 under a population that had been widened to make corroboration possible. A failures-only store at the
  same 18% would serve **one or two items out of ten**, which is not a measurement of content.

A reader who wants the floor isolated on a failures-only population is asking for a third arm, and the
honest answer is that the floor has no denominator there — by construction, not by accident. The confound is
stated rather than dissolved: if R151 breaks fewer trials than R142, the reading is "a store of repairs
serves better than a store of descriptions", and the floor's contribution is not separated in it.

Everything else is R142's: the same 57/57 cut of the 114 retail tasks, the same consolidation pass and key,
the same `packLimit: 1`, the same `speakMargin: 0`, the same budget, the same model, the same trials.

## Prediction

- **`created` 8–16, `servable` ≥ 8.** The band is the pass rate carried to the learn half — 47 of 57 at
  the test half, so ~10 corrections — widened by the distiller's own variance (R142 turned 57 corrections
  into 112 candidates, so ~2 per task, and 61 items).
- **`retired` 0.** `serveSupport: 1` retires nothing; a non-zero count means the knob did not reach the
  path and the round measured R142's floor with a smaller store.
- **`repairs` ≥ 4 and `breaks` ≤ 2.** This is the falsifiable claim: R142 repaired four trials and broke six
  from a store that mostly described behaviour that already worked. A store of ten repairs should not
  repair fewer, and should break fewer.
- **The delta is ≥ 0 and still unresolved.** At n = 57 the pair resolves 15.55pp, and no effect this lane
  has measured comes near it. Registered as a direction with the bound printed, not as a claim.
- **`serve split` served falls well below R142's 78.95%.** Nine records served 57 requests in R142; ten
  records over the same 57 requests will not reach all of them, because a failures-only store has no item
  covering a routine the learn half never failed at. A served share of 20–60% is the expected shape, and it
  is the reason the harm share and the repair count are read per opportunity rather than per request.

## Refutation

- **`breaks` ≥ 5.** The store's population is not what separates harm from gain at this cut, and the next
  axis is **usage**: the margin rung. R142's own ladder prices it without another dispatch — 11 of 57
  requests are withheld at 0.05, 23 at 0.10 — and the artefact carries `margins.perRequest` aligned with
  `ledger`, so the rung can be chosen by joining the gate to the outcomes already paid for.
- **`repairs` ≤ 2.** A failures-only store is a store that only answers the questions it failed, and the
  held-out half does not ask them. Then the axis is the **cut**: the same store measured on a held-out half
  drawn from the same routines, which is what the two R143 folds were registered for.
- **`created` < 6.** The learn half passed more than 90% of its tasks, the store cannot support a content
  reading, and the arm's supply has to be bought at 74 learn tasks before any content question is asked.
- **A served item carrying an `edited` provenance count of zero.** The scope knob did not reach the
  distiller, and the arm is R142 with a smaller store. Read from `provenance.edited` rather than from the
  header, because the header is an intention.

## Decision rule, stated before the number

| outcome | what the next dollar buys |
| --- | --- |
| breaks ≤ 2 and repairs ≥ 4 | **the usage axis at zero cost first**: price the margin rung against R142's and R151's rendered trials, then buy the rung the join selects |
| breaks ≤ 2 and repairs ≤ 3 | the store is safe and quiet: the **cut**, on the held-out half drawn from the learn half's routines |
| breaks ≥ 5 | content is not the lever either: the next arm is **usage** (margin rung) and the store's population is left as it is |
| `created` < 6 | **supply** at 74 learn tasks, before any content question is asked again |

## Cost

**~$0.26**, which is R142's measured bill for the same shape rather than an estimate: `cost.usd 0.1338`
for the memory arm and `0.1272` for the reference, both off-peak, over 57 learn and 57 held-out episodes
(1,764 model calls, 91.2% of them served from cache). The distillation ceiling stays at 400 and the store is
smaller, so the model-call total can only fall: R142 asked 57 distill questions and this one asks roughly ten,
which is the one term of the bill that shrinks with the treatment.
