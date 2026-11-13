---
id: R93-the-paired-arm
step: R93
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
storePin: eval/pins/r92-retail.json
trainTasks: 74
testTasks: 40
release: v1.0.1
---

# R93 — the arm this benchmark never runs: the same model, twice, with and without the store

**Registered** 2026-11-13, dispatchable after R92's redispatch. R92 produced the first number in this
project measured on τ²'s own held-out 40 tasks with a complete denominator: **`pass^4` 0.65**. Every row
on the competitive board it can be compared with is either a *baseline* (a model with no memory, 0.575
for GPT-4.1) or a *submission* (ALTK's 0.675). Not one of them, and not one arm in this record, has ever
measured **memory off on those same 40 tasks, in the same dispatch, at the same store**.

That is the cell this arm buys. It is also the only cell whose delta is a statement about the product
rather than about the instrument: R89 bought a pack, R90 a guard, R91 an identity, R92 a denominator, and
each of those was graded against a number from a different arm. Here the treatment is the store itself.

## Why the store is pinned, when the arm is about the store

`storePin: eval/pins/r92-retail.json` lists the fifteen tasks R92's learn phase failed on, read from its
own `yieldCensus` rows (`2, 4, 20, 35, 41, 52, 76, 78, 91, 92, 95, 98, 105, 109, 112`). Pinning them does
two things and changes no treatment:

- **The two legs differ in one thing.** An unpinned memory leg rebuilds its store from a fresh draw of the
  learn half, and R91's readback already showed what that costs: R89 wrote 12 corrections and R90 fifteen
  from the same 57 tasks, 8 ids shared. A reference leg has no store at all, so an unpinned pair would
  differ in *memory* and in *which failures taught it* — with 40 tasks and a ±17pp resolution, no
  interval could separate those.
- **R92's 0.65 becomes a replication.** The memory leg replays the same fifteen failures under the same
  registration, so its `pass^4` is a second independent draw at a fixed store. Two draws at one store
  measure the trial-level noise the lane has been quoting as signal, at zero extra treatment cost.

The pin removes the 74 learn episodes. That is 74 fewer conversations and — more importantly — it is the
difference between "the two arms are one experiment" and "the two arms are two".

## The design, stated as the two legs

| | memory leg | reference leg |
| --- | --- | --- |
| `TAU_MEMORY` | `true` | `false` |
| store | 15 records replayed from the pin | none |
| learn episodes | 0 (fifteen distill calls) | 0 |
| evaluation | 40 tasks × 4 trials | 40 tasks × 4 trials |
| model / judge | deepseek-flash / deepseek-flash | identical |
| seeds, caps, ceilings, pack budget | identical | identical |
| dispatch | one `sota` run, memory then reference | ← same run |

Both legs are steps of one job, so they share the runner, the τ² checkout, the release, the corpus and
the hour. The lane learned this the expensive way: iterations 60–61 measured 0.6471 against 0.5882 in two
dispatches and could not say whether 5.89 points belonged to the memory or to the day.

## Prediction

- **Instrument.** Both artefacts carry `tasks: 40`, `k: 4`, `unscored_reported: 0`, `split {train: 74,
  test: 40}`, `benchmark.version: v1.0.1` and a judge of `deepseek/deepseek-flash`; the memory leg's
  `learning.edited` is exactly **15** (a pin replays; it does not re-draw) and its `yieldCensus` names the
  same fifteen ids as the pin file.
- **The memory leg reproduces R92.** `pass^4 ∈ [0.575, 0.725]` — 0.65 ± three tasks. Outside that band,
  the arm is measuring trial noise larger than anything the registration can attribute, and the pair's
  delta has to be read as a draw rather than as an effect.
- **The reference leg lands near the published baseline, not below it.** `pass^4 ∈ [0.50, 0.65]`. The
  published 0.575 is GPT-4.1 with a GPT-5.5 simulator and is *not* an expectation for this backbone; it is
  a bar. A reference leg far below it would say the DeepSeek backbone, not the memory, is the deficit.
- **The delta is small and the interval says so.** Point estimate in **[−5, +10]pp**. Nothing in the
  record predicts a gain from this store: fifteen records, **1.09 items served per request**, **1,119
  candidates refused for size over 162 requests**, `conditioned 0 / 15` (not one record carries a `when`),
  a constant admission confidence of **0.6165**, and a median question coverage of **0.214** — the served
  statement mentions about a fifth of the request it is served to. R22 already found the pack 1.43pp
  *below* its own shuffled control, and the pooled cost of any text against no memory at −2.67pp
  (p = 0.0091). This arm is where that reading is priced on the benchmark's own halves, with an interval,
  for the first time.

## What this arm cannot certify, stated before the run

At n = 40 paired tasks the lane's own resolution function,
`detectableDelta(n, d) = √(z²·d/n)` with z = 2.802, gives:

| discordance | 40 pairs | 114 pairs (R95) |
| --- | --- | --- |
| d = 0.10 | **24.8pp** | 14.7pp |
| d = 0.20 | **19.8pp** | 11.7pp |
| d = 0.30 | **17.1pp** | 10.1pp |

So this arm can certify a *large* effect and a *harm*, and it cannot certify a 5-point gain. That is a
property of the 40 held-out tasks the benchmark defines, not of the dispatch, and no number of trials
changes it: `pass^4` is one binary per task and more trials buy a better estimate of that binary, not more
pairs. A reader who wants five-point resolution needs R95's 114, where 65% of the tasks taught the store
and the number stops being held-out — the trade is stated in the roadmap rather than discovered after.

## Refutation

- **The pin did not replay.** `learning.edited ≠ 15`, or a pinned id is absent from the train half, or
  `learning.rows ≠ 74`. The store was rebuilt from a draw; the memory leg is not R92's store and the pair
  is two variables again.
- **The legs did not score the same tasks.** `l4-same-split` fires. There is no pair; the run is a pair of
  means and is discarded rather than averaged.
- **The memory is harmful.** A paired delta whose 95% interval excludes zero on the negative side. That is
  the negative effect this project has been chasing since R16, confirmed on the benchmark's own halves at
  a named store — and every arm after it is a repair, not an optimisation. It also falsifies the
  "content is arbitrary" reading of R22 in the only direction that matters: arbitrary content that is
  *served* costs more than no content at all.
- **The memory is doing real work.** A paired delta of ≥ +12pp with an interval excluding zero. Then the
  fifteen-record store is not inert, R22's nulls were about *form* and not about *supply*, and the binding
  constraint is capacity and admission — which is what R94 and the conditioning line are for. This is the
  outcome the project wants, and the one its own record argues against.
- **The reference leg is the finding.** If `reference ≥ memory` while both legs are whole, no mechanism
  tune is admissible next: the store's *serving policy* has to change, and the queue's next item is a
  gate rather than a knob.

## Cost

320 evaluation episodes (2 × 40 × 4) and 15 distill calls, at R85's billed band **$0.0053 per
conversation** → **~$1.70**, off-peak, one τ² dispatch at a time. Cheaper than R92's $0.844 twice over
because the pin removes the 74 learn episodes, which are the expensive ones: 74 × ~100 steps of a
tool-calling dialog each.

## What this unlocks

| cell | what it measures | comparable to |
| --- | --- | --- |
| R92 | 0.65 with memory, 40 held-out tasks, complete denominator | ALTK's 67.5 (baseline-adjacent) |
| **R93** | **the same 40 tasks with and without the store, paired** | **no competitor publishes this cell** |
| R98 | the same, with unrelated records in the pack | the competition reading, falsified or confirmed |
| R97 / R96 | one sentence in the block: ephemerality, applicability | the four 2026 papers' largest effects |

Every arm after this one is a delta against a number that was measured in the same dispatch, on the same
tasks, at the same store. That is the difference between a tuning loop and a test.
