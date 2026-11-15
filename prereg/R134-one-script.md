---
id: R134-one-script
step: R134
opened: 2026-11-16
# R133's arm with one change: the pack may serve one item. 114 episodes rather than 262, because this arm
# buys no replay: its subject is the pack's composition and the held-out half's pairing, and the two phases
# that measured the store on its own cases were R132's and R133's instruments.
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
# No gate, for R131's, R132's and R133's reason: a gate changes the population the pack is drawn from, and
# this arm varies the count served from a store the gate would have changed.
speakMargin: 0
trials: 1
trainDomain: retail
testDomain: retail
recallDomain: retail
# Unchanged from R133 on purpose: the budget is what an item's *length* is charged against, and leaving it
# at 2,400 keeps the count the only variable. A budget small enough to fit one record would confound "one
# script" with "records too long to serve", which is the reachability finding this arm is not buying.
packBudget: 2400
# The treatment. R133 served 3.975 items and 2,239 of 2,400 characters on every request.
packLimit: 1
taskSplit: official
trainTasks: 74
testTasks: 40
release: v1.0.1
claimRuler: interval
---

# R134 — one script instead of four

**Registered** 2026-11-16, after reading R133 (`43880380623`) and before any arm has served fewer items
from the same store.

> R133's control replay gave the four cells a denominator that is not the selector: **9 repaired / 7 broken
> = +2 net** of 74 learnt tasks (2.70%), own-case `harmShare` **43.75%**. Against the learn draw itself the
> same replay read **11 repaired / 9 inert of the 20** the learn half failed (55.00%), **7 broken and 47
> kept** of the 54 it passed (38.89%).
>
> Two facts from the same artefact bound what can be done with it. The store holds **73 active items, 62 of
> the 64 it lists at `supportTasks: 1`** — single-episode transcripts, `kind: procedure` on a `shape` of the
> exact call sequence. And the pack **serves 3.975 items / 2,239 characters of a 2,400 budget**, dropping
> **161 items for size over 40 requests**. Every request was served (40 of 40, 74 of 74 in the replay), so
> this is not a store that fails to reach its cases; it is a store that hands the agent four unrelated
> scripts and lets it choose.

## What is being tested

The same arm, the same store, the same floor, the same budget, and `packLimit: 1`: the pack serves the
single most relevant item instead of all that fit. Nothing else moves.

Why the count and not the threshold. R133's own two rates say a gate that speaks less would lose as much as
it saves: on the drawer that selected the store, **55.00% of the failures were repaired and 13.0% of the
passes were broken**, so a gate tuned until it stops breaking the 7 also stops repairing most of the 11.
The conditioning that the net's sign licenses is therefore applied to **what the pack carries**, not to
whether the pack speaks — the same branch of R133's decision table, moved one layer into the retrieval.

Why this needs its own header rather than a smaller budget. A character budget leaves the count to how long
the distiller happened to write its records: at 2,400 characters R133 fitted four, and a store written in
shorter sentences would fit eight. "One script" is a count, and a count is the only thing that can state it.

## Prediction

- **The switch reaches the query.** `pack.summary.meanIds == 1.0` and `pack.empty == 0` over the 40
  held-out requests, with `droppedForSize` no longer counting items the count refused. If `meanIds` is not
  1.0 the header did not reach `recall` — the driver, the workflow variable and the registration are three
  places for one number — and **nothing below is read**. This is the wiring check the plan does not get to
  assume: R132's first dispatch died on a string the two ends spelled differently.
- **The bill falls, and by more than the obvious.** R133's memory half spent **$0.00655 an episode against
  the control's $0.00270** — 2.43× for the same 74 tasks — because a four-item pack **replaced the prompt
  every call**: cache hit rate 0.707 against the control's 0.902, and 2.5M uncached prompt tokens against
  0.59M. One stable item per request should restore most of that: `cache_hit_rate > 0.83` and a memory-half
  cost **at least 30% below $0.00655 an episode**. A cost that does not fall says the pack's *content*, not
  its *length*, is what evicts the cache.
- **The harm count falls without the repair count collapsing.** On the 40 paired held-out tasks, R123a read
  a **29.63%** harm share. One script can only move that by removing the competition, so the prediction is
  `harmShare < 0.185` (7 or fewer of the 40 served), which is the smallest move this sample can show at the
  discordant count R123a measured.
- **The store keeps working from `supportTasks: 1` or it does not.** 62 of 64 items are single-episode
  transcripts. If the repair rate survives a pack of one — the single most relevant item is the one that
  teaches the case — then an item's *relevance* is what carries it and the abstraction question is
  orthogonal. If it does not, the repairs were being carried by the second, third and fourth scripts, and
  the next arm is the write side by an argument this lane has not yet had.

## Refutation

- **`pack.summary.meanIds != 1.0`.** The count did not reach the query. The arm is R133 rerun and its
  numbers are R133's numbers; the dispatch is a wiring cost, not a measurement.
- **`pack.empty > 0` while `meanIds == 1`.** One item does not fit 2,400 characters on some requests, so
  the arm is measuring the renderer rather than the count, and the budget has to move before this one can.
- **`harmShare` moves by less than the quarter above and the cost does not fall.** Then neither the
  competition nor the length is what the store does to the prompt, the four-item pack was never the
  mechanism, and the write side is next with R133's `+2 net` read as the ceiling of what transcription buys.
- **The repair count collapses while the harm count does not.** The store's value is in *coverage by several
  unrelated items* — which is a cache, not a lesson — and every arm from here is about the item, not the
  pack.

## Decision rule, stated before the number

| outcome | what the next dollar buys |
| --- | --- |
| `meanIds == 1`, `harmShare < 0.185`, cost −30% | the competition was the mechanism → **the item**: abstraction level (a rule over a class rather than a transcript of one episode), and R129's outcome counter as the admission rule for it |
| `meanIds == 1`, `harmShare` flat, cost −30% | the pack was a *cost* defect and not a *quality* one → **the write side**: R129 deletion, then a verifier, with the pack left at one |
| `meanIds == 1`, repair collapses, `harmShare` falls | the store is a cache whose value is breadth → **coverage**: which item each request needs, measured before any distiller change |
| `meanIds != 1` | nothing above; fix the wiring and redispatch |

The rows are keyed on `meanIds` first because it is the only one of the three that is exactly resolvable at
this sample: it is a count of items against a declared integer, not an estimate over 40 tasks. The two rates
below it are read as intervals, as they have been since R123a withdrew a harm share measured at I²=60%.

## Cost

**~$0.55**, from R133's measured bills: 40 held-out episodes at $0.0062 ($0.2461) and 74 learnt episodes at
the replay's $0.00655 ($0.4847) would be $0.73, and the treatment's own prediction is a third off the second
term, so the estimate is $0.55 with the fall priced in and **$0.73 if it does not fall** — which is the
number to hold the dispatch to. In time: 114 episodes at R132's 0.44 minutes each, about **50 minutes**,
plus distillation: inside the 240-minute job with room for one rate-window boundary.

## What this unlocks

| reading | question it answers | what it decides |
| --- | --- | --- |
| `pack.summary.meanIds` | did the count reach the query | whether the arm measured anything |
| `cache_hit_rate`, `cost.usd` | what a fourth of the pack was costing | whether the store's bill is a length or a content defect |
| paired `harmShare` on 40 | does competition account for the damage | item vs write side |
| repair counted against the pool | does one script still teach | relevance vs coverage |
