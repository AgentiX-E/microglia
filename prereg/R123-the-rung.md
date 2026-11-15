---
id: R123-the-rung
step: R123
opened: 2026-11-16
# R123a's lane, split, sample, form, model and store exactly — with the gate on at the rung the ladder
# chose. One variable, and it is the one R123a was dispatched to price.
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
# R123a's store, unchanged: the rung is a property of *this* store, and a threshold measured on one store
# and dispatched against another is the substitution R99 paid for.
consolidate: true
consolidateKey: routine
# R123's treatment, chosen by the three rules R123a fixed before its data: 0.05 withholds 49 of 163
# rivaled requests (30.06%), the smallest rung above the 15% floor and below the 40% ceiling.
speakMargin: 0.05
trainDomain: retail
testDomain: retail
recallDomain: retail
packBudget: 2400
taskSplit: official
trainTasks: 74
testTasks: 40
release: v1.0.1
# The exact counts are claims; the rates are reported against their own intervals and never ranked against
# a published row. A gate's cost is exact and its benefit at forty tasks is not.
claimRuler: interval
---

# R123 — the rung, chosen by the rule and not by the intuition

**Registered** 2026-11-16, after reading R123a's ladder (`43773201592`) and before any gated arm exists.

> **`served 162 of 162` was read as coverage for twelve rounds.** It is a default: `buildPack` keeps every
> hit at floor 0, and no registration ever named a floor, so no request on this lane was *able* to be
> refused. `apply/speak.ts` made the question askable; R123a priced it.

## What the ladder said

R123a's own census, from `diagnostics.memory` of the memory arm:

```
census 163, rivaled 163, margin_p10 0.0107, margin_p50 0.0993, margin_p90 0.3095
ladder 0.01 13 / 0.02 22 / 0.05 49 / 0.10 82 / 0.15 105 / 0.20 118 / 0.30 145
```

As shares of the 163 contested requests:

| rung | withheld | share | verdict by the registered rules |
| --- | --- | --- | --- |
| 0.01 | 13 | 7.98% | below the 15% floor — not a treatment |
| 0.02 | 22 | 13.50% | below the floor |
| **0.05** | **49** | **30.06%** | **chosen: smallest rung ≥ 15% and ≤ 40%** |
| 0.10 | 82 | 50.31% | above the 40% ceiling — replaces the store rather than filtering it |
| 0.15 | 105 | 64.42% | above the ceiling |
| 0.20 | 118 | 72.39% | above the ceiling |
| 0.30 | 145 | 88.96% | above the ceiling |

Rule 1 selects **0.05**. Rule 3 does not fire — the smallest rung withholds 7.98%, so the store's margins
are not compressed into a single point and the gate is not an off switch wearing a threshold's clothes.

**Three of R123a's four predictions were graded, and two were wrong in ways worth recording.**

| prediction | measured | verdict |
| --- | --- | --- |
| `rivaled` between 40 and 150 of ~160 requests | **163 of 163** | **refuted** — and the denominator was mispredicted too: the phase spent 163 requests on 160 episodes |
| the ladder is not a cliff at the first rung | largest adjacent jump 33 of 163 = **20.2%**, against the 50% bar | held |
| `margin_p50 < 0.05` | **0.0993** | **refuted**, by a factor of two |
| the rate is inside R121's interval (88.13% ± 5.01pp) | **90.63%** | held |

`rivaled: 163` is not a surprise once the pack is read: `meanPerRequest` is 4.02 and `maxPerRequest` 5, so
every served pack carried at least two candidates and *every* request had a contested ranking. The
prediction failed because it was made about a store that might have had single-candidate packs, and this one
never did — which is the strongest possible statement of the gate's applicability: it acts on all the traffic
rather than on a separable half of it. The p50 miss says the same thing from the other side: the ranking is
neither sharply decided nor compressed, and a median margin of 0.099 sits almost exactly at the rung that
withholds half the traffic (0.10 → 50.31%), as a median must.

## What this arm treats

One switch: `speakMargin: 0.05`. `buildPack` withholds the pack when `margin < 0.05` — strict, so a request
whose top two candidates are exactly 0.05 apart is served. The prediction is that **49 of 163 requests** are
refused, and that the refusal is exact: the ladder is a count, not an estimate.

**The rate cannot show the effect and this registration says so before the dispatch.** A thirds of the
episodes will run with no pack at all, which makes the memory arm a mixture: 70% memory, 30% reference. If the
pack is worth the 6.87pp R123a's transfer ledger measured, the arm's rate should move from 90.63% toward
`0.7 × 90.63 + 0.3 × 83.75 = 88.57%` — 2.06pp, against a half-width of 4.52pp. **The prediction is that the
episode rate does not resolve.** What this arm registers as readable is:

| reading | why it can move | interval |
| --- | --- | --- |
| `withheld` count | exact by construction | none needed |
| **serve split** — the arm's own trials, served vs withheld | a within-arm comparison, so the store and the model are held fixed | Wilson, per bucket |
| `transfer` net and harm share over the served episodes | the quantity that moved 12.50pp between R123 and R123a | ±17pp at 27 informative |
| `turnCensus` per-turn counts across arms (R125) | 1,800 turns against 160 episodes | Poisson + paired |
| `attribution` per item (R128) | the ledger is now in the artefact with its boundary | item counts |

## Prediction

- **`served 114 of 163`** on the memory phase, with `withheld 49`. The exactness is the mechanism check: a
  count that differs means the ladder and the gate disagree about the comparison, which is one character in
  `buildPack`.
- **The withheld trials score like the reference arm, and worse than the served ones.** This is the arm's
  falsifiable core. If the two buckets come out level, the gate removed traffic without removing harm — a
  filter — and R123's mechanism claim is refuted at the first opportunity.
- **The served bucket's rate exceeds R123a's arm rate**, because the contested packs are gone. A mixture of
  90.63% overall implies the served 70% is above it if the withheld 30% is below.
- **`turnCensus.toolErrors` is non-null and `repeatCalls` is countable**, since τ² serialises the flag on
  every tool result. A `null` there refutes the instrument's reach, not the memory.

## Refutation

- **The serve split is level within its intervals.** Then the gate does not act on harm, and the next dollar
  moves from the use-side gate to the store's content — which is where R128's item table points anyway.
- **`withheld` is 0 or 163.** The first means the margin never reached `buildPack` (the R123a failure mode,
  one layer down); the second means `speakMargin` arrived as something other than 0.05. Either is a wiring
  finding and is reported as one rather than as a store result.
- **`pack.margins.ladder` absent from the arm artefact.** It is written in-process from the decisions since
  this round, so its absence means the census is not running — the check that R123a's readback had to make by
  downloading a job log.
- **`turnCensus.measurable` below `episodes`** means the census could not read messages the runner wrote, and
  the per-turn reading is then a sample of the phase rather than the phase.

## Cost

**~$0.97** at the off-peak rate R123a's own bill measured ($0.9653 for the memory phase, learning included).
Four readings ride on this one arm and three of them are observers: the gate is the only variable, and the
census, the serve split and the item table cannot move a byte of it — the first is computed after the run
from `simulations`, and the second and third read the ledger the pack already writes.

## What this unlocks

| reading | question it answers | what it decides |
| --- | --- | --- |
| `withheld 49 of 163` | did the rung reach the pack, and is a rung a share or a number | whether R123's rung is reusable on another store |
| the serve split | does the gate remove harm or traffic | gate-side or store-side, which is R124 vs R128 |
| `turnCensus` | whether the memory induces wrong actions at a denominator that can resolve them | R125's registration, priced rather than guessed |
| `attribution` | which claim broke which trial | R128's ablation list |
