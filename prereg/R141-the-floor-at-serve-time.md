---
id: R141-the-floor-at-serve-time
step: R141
opened: 2026-11-17
# R139 let the pass compare every pair and the store finally corroborated: 11 groups, 15 merged, 8 items with
# two or more tasks behind them. What it also measured is that the consensus is written and never used. This
# round serves it: retire, at serve time, every item no second task agreed with.
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
trainDomain: retail
testDomain: retail
recallDomain: retail
packBudget: 2400
packLimit: 1
taskSplit: official
trainTasks: 74
testTasks: 40
release: v1.0.1
claimRuler: interval
---

# R141 — the floor at serve time

**Registered** 2026-11-17, after reading R139 (`44141846982`) and its own artefact, and before the floor runs.

R139 answered its question and answered the next one on the way. The pass, no longer filtered by its key,
folded 15 items into 11 groups and left `supportAfter {1: 44, 2: 8, 3: 2, 4: 1}` — **11 items that two or
more tasks independently taught**, on a store of 55. The score moved +2.50pp on the paired split
(`[−15.00, +17.50]`, p = 1.0000, 6 repaired / 5 broken) and the bill matched the control's to the tenth of a
cent ($0.0958 against $0.0962). So the *store* now holds a consensus and the *score* cannot see it, for two
reasons that the same artefact states:

1. **Of the 21 items served over 40 requests, every one of the three negative-net items had one task of
   support.** Each cost −1. Neither of the two corroborated items that were served was negative.
2. **43 of 64 items were never served at all.** One item a request over a population of 64, and the pack
   carries one — an item cannot accumulate outcomes it is never handed.

Both point at the same switch. A floor on `supportTasks` applied **at serve time** retires the singletons and
leaves the corroborated items to circulate; it is ALTK's `sup2`/`sup3` cell and ACE's helpfulness counter,
applied at the moment the memory is served rather than the moment it is written.

## What is being measured

- **`supportFloor`** — `{total, retired, retained, floor}`, carried in the learning block and, when the floor
  empties the store, in the refusal's diagnostics. New field: no artefact before this one could say whether a
  short serve was the floor working or the store having nothing to serve.
- **`store.reasons['support-floor']`** — the store's own vocabulary, so the census counts what the floor
  removed beside the pass's own retirements rather than inside them.
- **`recall.served` / `recall.requests`**, and the pair's per-item table — the same two numbers R139 published,
  so this round is a comparison rather than a new baseline.
- **`serveSplit.served`** — the split that separates "the pack was withheld" from "the pack was short".

## The change

One resolver and one option:

```ts
const SERVE_SUPPORT = resolveServeSupport();   // TAU_SERVE_SUPPORT, unset = 1, non-negative integer
if (SERVE_SUPPORT > 1) {
  const stored = await store.listKnowledge({});          // after the pass wrote its survivors back
  supportFloor = retireBelowSupport(stored, SERVE_SUPPORT, Date.now());
  for (const item of supportFloor.items) if (item.statusReason === "support-floor") await store.putKnowledge(item);
  process.stdout.write(`[tau2] ${supportFloorLine(supportFloor)}\n`);
}
```

Three decisions, stated because each of them could be made differently:

- **A status, not a filter.** The recall path runs in another process; a predicate there would be a second
  implementation of a rule the store already has (`statusReason`) and the store's own index already skips
  non-active items. Retiring is reversible, legible in the census, and costs no query surface.
- **Applied after the pass, before the gate.** `funnelVerdict` reads the store the recall path will open, so a
  floor applied later would be measured as a store that carried something and served nothing — which is the
  sentence R42 spent an hour of pack-free evaluation to misread once already.
- **Refused without the pass.** `serveSupport > 1` needs `consolidate: true`, because without the pass every
  item is written from one correction and its support is 1 by construction: the floor would retire the whole
  store and the arm would serve no memory at all under the treatment's name. A transfer that fell to zero for
  this reason reads exactly like a floor that did not work, so the registration is refused rather than priced.

## Prediction

- **`supportFloor.floor: 2`, `retired` between 40 and 46, `retained` between 9 and 13.** R139's
  `supportAfter {1: 44, 2: 8, 3: 2, 4: 1}` is the population this floor acts on: 44 of 55 items have one task.
  The band allows for the pass landing one or two merges differently on a fresh set of calls.
- **`store.reasons['support-floor']` equals `supportFloor.retired`**, and the servable count in the census is
  the floor's `retained` rather than the store's length. A mismatch means the write-back was partial, and no
  score from this arm may be read.
- **The three negative-net items are gone from the served set.** They were support 1 each, so this is the
  instrument's own criterion for the round: a served item with `support 1` means the floor did not reach the
  pack.
- **`serveSplit.served` falls from 33 of 40 to at most 13**, because the population that can be served is the
  floor's `retained`. Not a failure: R139's 43-of-64 unserved was the same fact viewed from the other end.
- **The mean is expected to be flat and may be worse.** Four of the items the floor removes are the ones R139
  measured as *positive* (+4 together). Removing harm worth −3 and gain worth +4 is a trade this round should
  lose on the point estimate; the claim being graded is the **harm share** (15.63% in R139) and the `broke`
  column, not the delta.
- **Cost: ~$0.20**, R139's own pair, since the change adds no model call.

## Refutation

- **`retired < 30` with `floor: 2`.** The population R139 measured is not the population this run wrote: the
  pass merged far more than 15 this time, or the linkage did not arrive. The floor's effect is then
  uninterpretable and the next dollar goes at the carriage, as in R137.
- **`retained ≥ 20`.** Same defect from the other side: the store is mostly corroborated, which contradicts
  `supportAfter[1] = 44` and means one of the two runs is not describing the same corpus.
- **A served item with support 1.** The floor did not reach the recall path — the write-back is partial or the
  store re-activated the item — and the arm is R139's arm wearing this round's name.
- **`broke` does not fall while `retained` is in band.** Then corroboration is not what separates the harmful
  items from the helpful ones, the −1s were three singletons by coincidence, and the axis for the next round is
  **content** (what the served claim says) rather than support.
- **The mean falls by more than the harm it removed.** Then the floor is a tax: the corroborated items it keeps
  are not better, they are merely fewer, and the item-count axis (R139's second branch) is what carries the
  next round.

## Decision rule, stated before the number

| outcome | what the next dollar buys |
| --- | --- |
| harm share falls, `broke` falls | **the outcome counter.** Items now recur by construction — 11 items over 40 requests is 3.6 serves each — so R129's quarantine has a denominator and the per-item table can finally be a rate |
| harm share falls, mean falls too | **the gain side.** The floor is safe and it is not sufficient: the corroborated items are worth less than the singletons they replaced, and the next arm asks what makes a served claim useful rather than whether it recurs |
| `broke` flat | **the item table as a finding, not a stop-gap.** Three −1s and four +4s on 21 served items is a signal about content, and the next registration cuts on what the claim says |
| `retired` out of band | **nothing this round.** The floor's population was mispredicted, the census and the treatment disagree, and the carriage is the defect to fix before any floor is priced |

## Cost

**~$0.20.** No model call is added: the floor is arithmetic over evidence the store already carries, and the
census costs nothing.

## What this unlocks

| reading | question it answers | what it decides |
| --- | --- | --- |
| `supportFloor.retired` | how much of the store no second task agreed with | whether a serve-time floor has a population at all |
| `store.reasons['support-floor']` | whether the retirement reached the store the recall path opens | whether the arm and the control are the same store |
| served items by support | whether the pack now carries consensus | whether R129's outcome counter is identifiable |
| harm share vs R139 | whether corroboration separates harm from gain | whether the next axis is support or content |
