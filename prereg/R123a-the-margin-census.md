---
id: R123a-the-margin-census
step: R123a
opened: 2026-11-15
# R124's lane and shape exactly, with the gate turned off and the census on. One variable, and the
# variable is an observer: this arm buys a population, not a score.
arms: memory
sample: 160
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
# R123a's switch: zero margin, so every non-empty pack is served, and the census on, so every request
# that had a rival lands in the ladder. Naming `speakMargin` at all is what asks for the census, which is
# why the value is written out rather than left absent.
speakMargin: 0
trainDomain: retail
testDomain: retail
recallDomain: retail
packBudget: 2400
taskSplit: official
trainTasks: 74
testTasks: 40
release: v1.0.1
# The ladder is exact and the rate is not: this arm prices a threshold and reports its rate only as a
# replicate of the control.
claimRuler: interval
---

# R123a — the rung is a property of the store, so measure the store before naming the rung

**Registered** 2026-11-15, before R124 (`43705196364`) returned and before any margin was observed.

> **R123's mechanism is built and green and no rung is chosen.** `apply/speak.ts` withholds a pack when
> the store's best candidate is not far enough ahead of its runner-up; `served 162 of 162` has been read
> as coverage for twelve rounds and it is a **default** — `buildPack` keeps every hit at floor 0 and no
> registration ever named a floor, so no request on this lane was able to be refused.

The reason the rung is not named here is not caution, it is arithmetic. On the same 650 pairs the
*relevance* floor is a cliff rather than a curve — 0.05 serves all 162 requests, 0.10 serves 154,
**0.15 serves 75**, 0.20 serves 36 — so a threshold chosen by intuition has two possible outcomes and
neither is a measurement: it withholds nearly everything or nearly nothing. A margin threshold is the
same kind of number. It is a quantile of a distribution the store produces, and this record has never
observed that distribution.

**The distribution is free.** `buildPack` already computes the margin between its top two candidates on
every request, whether or not a gate reads it. So one arm at margin 0 records the ladder that prices
every rung at once, and the arm that follows it is registered against a measured cost rather than a
hoped-for one.

## What one dispatch adds

| field | what it is | who reads it |
| --- | --- | --- |
| `memory.rivaled` | requests whose store returned at least two candidates — the population a margin gate acts on | the denominator of every rung |
| `memory.margin_ladder` | for each of `0.01 0.02 0.05 0.10 0.15 0.20 0.30`, how many of those requests it would withhold, **exactly** | R123's registration |
| `memory.margin_p10/p50/p90` | nearest-rank quantiles of the same population | a reader checking the ladder against its own summary |
| `memory.recall_empty`, `silent_because` | the silences that are *not* the gate, kept separate | R123's mechanism check |

Nothing is treated. `speakMargin: 0` means the gate speaks on every non-empty pack, so the episode rate
this arm produces is a control, and its only role is to sit beside R121's 88.13% as a replicate. The
census is an observer and `apply/__tests__/speak.test.ts` pins that: rendered bytes, ids and fingerprint
are identical with it on and off.

## The decision rule, fixed before the data

The ladder is read and the rung is chosen by this rule and no other:

1. **The rung is the smallest one whose withheld share is at least 15%**, provided that share is at most
   40%. A gate that removes fewer than one request in seven is not a treatment; one that removes more
   than two in five has replaced the store rather than filtered it.
2. If no rung reaches 15%, the rung is the largest (`0.30`) and R123's registration states that the
   store's margins are compressed, with the ladder as its own evidence.
3. **If the smallest rung already withholds more than 40%, R123 is not run on this store.** That outcome
   is a result and it is written up as one: it would mean the store's top two candidates are almost
   always within one point of each other, and a margin gate on such a store is an off switch wearing a
   threshold's clothes.

The rule is stated as a share of `rivaled` rather than as a margin, because the share is the quantity the
next arm's prediction is made in and the margin is the quantity the arm must be dispatched with.

## Prediction

- **`rivaled` is between 40 and 150** of the ~160 requests. `meanPackIds` is 4.06, so a store that
  serves four lines per pack is a store with rivals; the packs that carried one line are the ones that
  are not.
- **The ladder is not a cliff at the first rung.** A relevance floor jumps from serving 162 to serving 75
  between two adjacent rungs; a top-two margin over the same store should fall off much more smoothly,
  because it is a difference of two nearby scores rather than a level. If it *is* a cliff, R123's premise
  — that the contested half of the traffic is a separable half — is refuted for this store, and that is
  the most valuable thing this arm can find.
- **`margin_p50 < 0.05`.** The candidates come from one store on one topic; a median margin above a
  twentieth of the scale would mean the ranking is sharply decided and the gate has little to do.
- **The rate is inside R121's interval** (88.13% ± 5.01pp), since nothing is treated.

## Refutation

- **`rivaled: 0`** refutes the wiring, not the store: it means the census never reached the driver —
  the sixth form of a parameter nobody sent, and the first one this record would have caught with an
  instrument that was written to catch it. No arm may name a rung until the count is non-zero.
- **`rivaled` far below `recalls - recall_empty`** means most packs carried a single candidate, and the
  gap is the finding: the gate would be deciding on a minority of the traffic and its rate would be an
  average over two different populations.
- **A ladder that jumps by more than half the population between two adjacent rungs** refutes R123's
  premise for this store, as above, and R123 is re-registered around a *dose* (withhold a fixed share,
  chosen by the run's own quantile on the train half) rather than around a margin.
- **`memory` absent from `diagnostics`** is the `memory_stats` defect recurring: a phase that ran the
  sidecar but reported no block. It would be the eighth instance, and it is the reason the block is
  written from `run_split.py` rather than from a script nobody calls.

## Cost

**~$1.10** — R124's own figure for the same shape. The census itself is free; the money buys the episode
population the ladder's denominator lives in, and a control rate that the paired machinery produces anyway.

## What this unlocks

| reading | question it answers | what it decides |
| --- | --- | --- |
| `rivaled` | how much of the traffic has a contested ranking at all | whether a margin gate can be a treatment on this lane |
| `margin_ladder` | what each rung costs, exactly | R123's `speakMargin`, by the rule above |
| the ladder's shape | whether contention is a separable half of the traffic | whether R123 tests a threshold or a dose |
| `margin_p50` against `margin_p90` | whether the ranking is sharply decided | whether the store's own signal is the constraint, before any gate |
