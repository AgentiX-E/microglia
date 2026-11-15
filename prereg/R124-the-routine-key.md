---
id: R124-the-routine-key
step: R124
opened: 2026-11-15
# R121's lane, split, n, form, model and store size — with the recurrence pass keyed on the routine the
# correction taught instead of on the sentence the distiller wrote. One variable.
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
# R121's switch, unchanged: the pass runs on the published unit.
consolidate: true
# R124's treatment. R121 merged nothing because the pass compares `scopeKey`, which includes the
# distiller's free-text `intent`; 64 items made 60 buckets, so 4 of 2,016 pairs were ever tested.
# `routine` supplies the key the fold and the merge census already share.
consolidateKey: routine
trainDomain: retail
testDomain: retail
recallDomain: retail
packBudget: 2400
taskSplit: official
trainTasks: 74
testTasks: 40
release: v1.0.1
# A census of the pair population is exact; a score at forty tasks is not. The rate is reported with its
# interval and the headline beside its `rate⁴`, and neither is ranked against a published row.
claimRuler: interval
---

# R124 — the pass was keyed on a string this record had already disqualified

**Registered** 2026-11-15, after reading R121's artefact.

> **R121** (`43688056849`) turned the store's recurrence pass on for the first time on the published unit
> and returned `considered 79, groups 0, merged 0, retained 79` — with `refusedCondition 0`,
> `refusedPayload 0`, `refusedDuplicateEvidence 0` and `refusedLinkage 0`.

Four zeros and one zero that mattered. The pass walks every pair and `continue`s on three conditions
*before* any counter increments:

```ts
if (leftItem.kind !== rightItem.kind) continue;
if (scopeKey(leftItem.scope) !== scopeKey(rightItem.scope)) continue;
if (overlapOf(leftIndex, rightIndex) < threshold) continue;
```

`scopeKey` includes `scope.intent`, which the distiller fills with a phrase per episode. R121's own store:

| reading | value |
|---|---|
| items in the sample | 64 |
| distinct `scopeKey` | **60** |
| buckets holding two items | 4 |
| pairs the pass could test | **4** of 2,016 |

and the artefact's sweep prices the rest: `threshold 0.40: groups=1 merged=1 crossTask=1`, eight rows of
zeros above it. **One of the four pairs is a merge, it is cross-task, and it sits one rung below the floor
that was chosen for a store this lane no longer has.**

**R119 had already disqualified that string.** The fold's key was moved from `scope.intent` to the
correction's routine for exactly this reason — one routine arrived spelled `return_items`, `return_item`
and `items to return`, and nine of sixty-four items shared a spelling while every one of them carried
`supportTasks: 1`. The consolidator's linkage key was not moved, and the pass ran for the first time two
rounds later.

## What one dispatch changes

| change | what it is | who measures it |
| --- | --- | --- |
| `consolidateKey: routine` | the pass compares two items by the routine their corrections used — `actionShapeOf`, the same function the fold's key and the merge census share | `consolidation.linkage` |
| — | the store's support distribution and its restatement, read from the artefact | `consolidation.supportBefore/After`, `redundancy` |

Nothing else moves. Same form, split, seed, model, `n`, budget, unit. `linkage: scope` is still the
default, so R121's reading stays reproducible from its own artefact.

## Prediction

- **`consolidation.linkage` is `host`** and `pairs` rises from **4** to between 200 and 900: 79 items in
  roughly forty routine buckets gives Σ C(nᵢ,2), which the artefact's `merge.shapes: 44` already bounds.
- **`consolidation.merged > 0`**, and `crossTaskGroups > 0` — the first items in this record whose
  evidence names two tasks, which is ALTK's `sup2` cell and the reason the arm is worth a dollar.
- `supportAfter.max ≥ 2` and `supportBefore[1] > supportAfter[1]`, since a merge unions two items of
  support 1 into one of support 2.
- **`redundancy` falls below R121's 28.1%**: a merge that keys on the routine removes restatements the
  sentence-level key never saw.
- **The episode rate is reported with its interval and the headline is not claimed.** R121 measured
  141 of 160 episodes with a memory-free control at 133 of 160 (+5.00pp, p = 0.2668). This arm's test is
  whether the rate stays inside ±5pp of 88.13%; anything inside is the same experiment.

## Refutation

- **`merged: 0` with `skippedScope` near zero** closes the merge line for good: the pass would then have
  seen every pair the routine key admits and found no two claims that say the same thing, which is a fact
  about this store's content rather than about a key. That is a result, and it retires R99's
  `support.atLeastTwo` as a merge opportunity at the same time.
- **`merged > 0` with `crossTaskGroups: 0`** is the laundering R99 already paid for — the store shrinks
  without getting a second witness — and it refutes the merge's purpose rather than its reach.
- **`linkage: 'scope'` while the header says `routine`** refutes the wiring, in the fifth form of a
  parameter nobody sent. No arm on this lane may report a merged store until it is fixed.
- **A rate below 83.1%** (R121's 88.13% less its 5.01pp half-width) would be the first store-side change
  on this lane with a resolvable harm, and it would outrank every census in this file.
- **`fold.unnamed` or `storeItems.shape` regressing** would mean the merge rewrote the item shape the fold
  keys on. The fold's census is reported here for that reason, not as a second treatment.

## Why this is not a re-run of R121

R121 asked whether the pass *runs*; it does, and it merged nothing. R124 asks whether the pass can *see*
the store, and the answer is measured by a population rather than by a score: 4 pairs becoming hundreds.
The single risk the key change introduces is that two corrections which called the same tools wrote
different claims, and that is exactly what the similarity test and `weakestPair` still guard — the key
admits a pair to the test, and never decides the merge.

## Cost

**~$1.10** — R121's own figure for the same shape: one learn half (74 episodes) and one evaluation of
160 episodes beside a memory-free reference, which the two-arm machinery serves inside one run.

## What this unlocks

| reading | question it answers | what it decides |
| --- | --- | --- |
| `pairs`, `skippedScope` | whether the pass can see a store whose items spell one routine eight ways | whether the key, not the store, has been the constraint for twelve rounds |
| `merged`, `crossTaskGroups` | whether a merge can buy support | whether this record can serve `sup2` at all |
| `redundancy` | whether a routine-keyed merge removes the restatement the census priced | whether R121's 28.1% was a floor or an artifact |
| the rate, and `pack.ledger` against R121 | what a smaller, corroborated store does to episodes | the next arm's prediction, from the same instrument |
