---
id: R100-the-applicability-floor
step: R100
opened: 2026-11-13
arms: memory
sample: 160
gates: V1,V2,V3,V5,V6,V7,V8,V32,V44
recallFloor: 0.2
facadePair: off
trainDomain: retail
testDomain: retail
recallDomain: retail
distillUnit: raw
distillScope: edited
rawCeiling: 2000
packBudget: 2400
taskSplit: official
storePin: eval/pins/r92-retail.json
trainTasks: 74
testTasks: 40
release: v1.0.1
---

# R100 — the memory repairs thirteen trials and breaks ten, and the breaks have to be paid back at the door

> **Refused before dispatch, by the lane's own floor procedure (2026-11-13).** `eval:prereg-floor`
> recomputes the permitted floor from the committed curve with the registered cost weights
> (`alpha 1 / gamma 3 / beta 0.5`) and refuses a declaration that disagrees. On the R47 fixture that
> number is **0.01**. Recomputing it on R92's own curve — the newest complete population, 177 pairs at a
> median coverage of 0.214 — returns **0.01** as well: `structure-only argmax over registered cost, with
> least-aggressive tie-break`. So no rung the procedure selects can change the delivered population
> (0.01 retains 99.4% of pairs), and the arm below cannot be dispatched as written.
>
> **This is the refusal working.** The alternative is a floor chosen because a readback liked 0.20, which
> is the defect the check exists to prevent. The measurement stands and the hypothesis is untouched: a
> third of the packs are below 0.20 coverage and the memory breaks ten trials. What the arithmetic says
> is that under the registered cost model — a false injection charged 3, an abstention 0.5 — the expected
> cost of a gate exceeds its expected benefit on this population. Changing the *procedure* is a
> registration of its own, and changing the *weights* after seeing this number is not available.
>
> The arm is kept in the record as refused rather than deleted, because the next attempt at applicability
> has to start from this number rather than from the intuition that a gate must help.

**Registered** 2026-11-13, after R93. R93 measured the store it was given, on the benchmark's own halves,
with the memory off in the same dispatch:

| | memory | no memory | delta |
| --- | --- | --- | --- |
| `pass^4`, 40 tasks | **0.700** (28/40) | **0.725** (29/40) | **−2.50pp** [−17.50, +12.50], p = 1.0000 |
| trials repaired / broken | 13 repaired, 10 broken of 160 | — | net **+1.88pp** per trial |
| cost, 160 conversations | **$0.8276** ($0.0052 each) | **$0.3807** ($0.0024 each) | **2.17×** |
| cache-hit rate | 76.4% | 91.2% | the pack rewrites the prefix every episode |

**Two facts, and they point at one mechanism.** The memory *does* something — it repairs thirteen trials
the control failed — and it also breaks ten that the control passed, and the breaks are what `pass^4`
counts, because a task needs all four trials. So the store is not inert; it is **imprecise**. And the
instrument that would show where it is imprecise is already committed: R92's retention curve, computed
from the same facade that served these packs, says a `minCoverage` floor of **0.20 empties 53 of 161
packs (32.9%)** and keeps 67.3%, and a floor of 0.15 empties 17 (10.6%).

This arm moves exactly that number and nothing else.

## The single variable

`recallFloor: 0.2` — the floor `buildPack` already applies, and the rung R92's own histogram priced
before this arm existed. The store, the pin, the pack budget, the ceiling, the trials, the model, the
judge, the seed and the registration's other eleven switches are R93's.

**What it is not.** It is not a threshold chosen after a readout: the grid (`0, 0.01, 0.02, 0.03, 0.05,
0.08, 0.1, 0.15, 0.2, 0.3`) is fixed in source, the retention curve for every rung was computed from R92's
facade before this arm was written, and 0.20 is the rung at which the emptied population first exceeds a
quarter — that is, the smallest floor that can plausibly move a 40-task sample.

## Why the breaks should be the low-coverage requests

The mechanism the literature names is applicability, and this lane has measured the store's side of it
twice: `conditioned 0 / 15` (not one record carries a `when`) and a median question coverage of **0.214**,
against a maximum of 0.526. A record that mentions a fifth of the request it is served to is a record
the model has to decide about, and `pass^4` says that decision costs more than it earns. A floor is the
cheapest possible version of "do not serve what does not apply", and it needs no prompt sentence — which
matters because this lane's one attempt at a prompt sentence (R17) found the permissive clause a
*substitute* for the note rather than an addition to it.

## Prediction

- **The floor applies, and the emptying is visible.** `pack.requests` ≈ 161 with `pack.emptiedBySize > 0`
  for the first time, and roughly **50–55** packs empty (R92's curve: 53 of 162). A run whose
  `emptiedBySize` is 0 did not apply the floor and is discarded without reading the score.
- **Coverage rises, and the store's use narrows.** `coverage.nonzeroQuantiles.p50` at least R92's
  **0.214** — the floor removes pairs below 0.20 by construction, so a median at or below the floor means
  the histogram is being computed over the ungated population and the two readings disagree.
- **The trial-level repair/break ledger improves on the break side.** R93: 13 repaired, 10 broken. This
  arm's prediction is **breaks ≤ 6** with repairs ≥ 9 — the floor should remove pack-induced failures and
  keep the repairs, because a repair needs a record about the task and a break does not.
- **`pass^4` between 0.70 and 0.775.** The point estimate should move up from 0.700 toward the no-memory
  arm's 0.725. Above 0.725 the gate is a gain rather than a repair, and it becomes the first arm in this
  record with a positive memory effect measured on the benchmark's own halves.

## Refutation

- **The floor did not reach the pack.** `pack.emptiedBySize = 0`, or `recall.served` still 161 of 161.
  The header, the workflow's floor step or the driver's resolver is wrong; the arm is a duplicate of
  R93's memory leg at the same price.
- **Emptying costs more than it saves.** `pass^4` below **0.70** with the floor applied. Then the ten
  breaks are *not* concentrated in low-coverage requests, the coverage signal is not the applicability
  signal, and the next arm has to measure the served record directly (R98's unrelated control) rather
  than filter it.
- **The memory becomes exactly neutral.** `pass^4` = 0.725 with a third of the packs empty. Then the
  honest reading is that the store contributes nothing at any coverage, "serve nothing" is the best
  policy this store supports, and the next question is the unit rather than the filter.
- **The breaks move and the score does not.** Ledger improves, `pass^4` unchanged. Then the sample
  cannot see a 2.5pp effect (it cannot: 21.02pp is the floor) and no further single-variable arm on 40
  tasks is worth buying until a larger sample or a larger effect exists.

## Cost

160 evaluation episodes and 15 distill calls at R93's measured band → **$0.83**, one arm. The reference
leg is deliberately **not** re-run: R93 measured it four hours earlier in the same configuration, and a
second $0.38 buys a replication of a number whose interval is ±14.7pp. A paired re-run is bought only if
this arm's `pass^4` clears 0.75, where a pair could plausibly certify something.

## What this unlocks

| cell | store | floor | what it isolates |
| --- | --- | --- | --- |
| R92 | 15 rebuilt | 0 | the store R92 built |
| R93 | 15 pinned | 0 | memory against no memory, paired |
| **R100** | **15 pinned** | **0.20** | **whether to serve, at a fixed store** |
| R99 (registered, not run) | ~73 | 0 | the population, at a fixed policy |
| R98 (queued) | 15 pinned | 0 | whether the *content* matters, at matched length |

If R100 moves and R99 does not, this project's gap to the competitor is a serving policy rather than a
supply of rules — and the competitor's own 292-rule playbook would then be the wrong lesson to copy.
