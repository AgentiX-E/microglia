---
id: R129-the-outcome-counter
step: R129
opened: 2026-11-16
# R123's lane and store, with one addition: every item carries the outcome of the trials it was served into,
# accumulated across dispatches, and an item whose outcomes are net-negative is quarantined rather than served.
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
trainDomain: retail
testDomain: retail
recallDomain: retail
packBudget: 2400
taskSplit: official
trainTasks: 74
testTasks: 40
release: v1.0.1
claimRuler: interval
---

# R129 — the field every competitor maintains by outcome and this store has never written

**Registered** 2026-11-16, before the counter exists.

> **The gap is a column, not a score.** `sup2 = 2 of 66` says our items are barely corroborated by *tasks*.
> Nothing says whether an item *helped* when it was served — and three of the four 2026 mechanisms this record
> studied are built on exactly that field (Appendix AS).

## What the store knows, and what it does not

| field | written today | what it is |
| --- | --- | --- |
| `confidence` | yes, at distillation | the distiller's own belief, before any trial |
| `supportTasks` | yes, at consolidation | how many **learning** tasks produced this item |
| `provenance` | yes | which corrections it came from |
| **`outcomes`** | **never** | how many trials it was served into, and how many of those the arm won |

`supportTasks` counts *inputs* to the store; `outcomes` would count *effects* of the store. The record has
measured the second offline twice — R128's `itemTransfer` reads `kept`, `broke` and `net` per item from the pack
ledger and the trial table — and has never written it back. That is the difference between an audit and a
mechanism: SEMV calls the audit an admission gate and reports 5.7% → 0.2% negative transfer; ACE calls it a
helpfulness counter and reports AppWorld +10.6%.

## The treatment

One field and one rule. After a phase is scored, each item that was served into a measured trial gains
`outcomes: { served, kept, broke }`, summed into the item's record and carried across dispatches by the store
pin. At serve time, `buildPack` refuses an item whose `broke > kept` **and** `served >= 3` — the count floor
exists so that a single unlucky trial cannot quarantine an item, and it is the same floor R128's registration
already applies to reading the table (two episodes is the smallest count worth naming; three is the smallest
worth a dispatch).

Two arms, so the contribution is separable:

| arm | what it changes | what it measures |
| --- | --- | --- |
| `memory` + counter, quarantine on | the serve set | the mechanism's total effect |
| `memory` + counter, quarantine off | nothing (the counter is an observer) | whether the **rest** of the loop is unchanged by carrying the field — the ablation that stops quarantine from claiming credit for an unrelated movement |

## Prediction

- **The quarantined set is small and identifiable.** On the R123a store, `broke > kept` holds for at most a
  handful of items: the item table reported 9 items with `net < 0` over ≥1 episode and R128's criteria already
  require ≥2. A quarantine that removes more than 15% of the store has become a filter on the store rather than
  on its errors, and that outcome is a finding about item quality rather than a success.
- **`broke` falls faster than `kept`.** The mechanism's claim is directional: the items it removes are ones the
  trials say hurt. If `kept` falls by as much as `broke`, the counter is removing *active* items and the next
  dollar returns to the fold key.
- **The rate does not resolve, and is not asked to.** At 40 tasks the interval is ±17.5pp against an effect the
  record expects in the low single digits. The registered reading is harm share and item counts, and the score
  is reported with its interval and not compared.

## Refutation

- **`broke > kept` for no item.** Then the store has no net-negative item at the floor of 3 trials, the harm is
  spread thinly across many items, and item-granularity quarantine cannot work. That is a result, and it sends
  the next dollar to R126's key question instead.
- **The counter is empty in the next dispatch's artefact.** The field does not survive the store pin, which is
  a persistence defect of the same family as AUDIT 34.160 (a reading with no writer) and is reported as one.
- **Quarantine removes ≥15% of the store.** The floor is too low or the store is worse than its own audit said;
  either way the treatment is a store change and needs its own registration.

## Cost

**~$2.00** for two arms (R123a's phase measured $0.97 each; the counter itself is free, as it reads artefacts
the run has already written).

## What this unlocks

| reading | question | decides |
| --- | --- | --- |
| `outcomes` present on ≥1 item | does the field survive the pin | whether the flywheel can close at all |
| quarantined item count | how much of the store is net-negative at a floor of 3 | whether item-granularity is the right unit |
| harm share, treatment vs observer | does removing known-harmful items reduce harm | whether SEMV's mechanism transfers to a store this small |
| `sup2` after quarantine | does the surviving store corroborate better | whether the two columns move together or are independent |
