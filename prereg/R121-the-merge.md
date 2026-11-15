---
id: R121-the-merge
step: R121
opened: 2026-11-15
# R120's lane, R120's split, R120's n, R120's form and model — with the store's own recurrence pass
# turned on for the first time on this unit. One variable.
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
# R121's treatment. The pass that merges two claims into one has run only under `distillUnit: trace`
# since R58; every arm since R104 runs `correction` and has therefore held one item per correction with
# `supportTasks: 1` while its own two censuses priced 39-53 claims with support up to 5.
consolidate: true
trainDomain: retail
testDomain: retail
recallDomain: retail
packBudget: 2400
taskSplit: official
trainTasks: 74
testTasks: 40
release: v1.0.1
# The score is graded by the interval ruler and is not claimed: at forty tasks the half-width is 15.18pp
# and R120 measured 0.750 while R119 measured 0.600 on the same lane. What this registration claims is a
# census of the store, and a rate with the episode count as its denominator.
claimRuler: interval
---

# R121 — the store has priced its own recurrence for twelve rounds and never collected it

**Registered** 2026-11-15, after reading R120's artefact.

> **R120** (`43665852454`) built a store of **73 items** from 73 corrections and measured what it is:
> `merge: shapes 53, mergeable 30, support {max 5, atLeastTwo 10, atLeastThree 5}` beside
> `storeItems`: `64 statement(s), 42 distinct claim(s) (34.4% restated), largest 12`.

Two censuses, two keys, one answer, and both are computed from a population the store did not keep.
`consolidateKnowledge` — the product's own recurrence pass, with R58's measured floor and its four
refusal counters — is invoked by the driver under

```ts
const consolidation =
  DISTILL_UNIT === "trace"
    ? consolidateKnowledge(written, consolidationOptions)
    : undefined;
```

and every arm since R104 runs `distillUnit: correction`. **The pass has existed since R58 and has never
run on the unit this project publishes.** This dispatch is the first one that runs it there.

## What one dispatch changes

| change | what it is | who measures it |
| --- | --- | --- |
| `consolidate: true` | the same lane, the same distiller, the same corrections, with the store's recurrence pass enabled | `distillUnit.consolidation` |
| — | the store's size, its support distribution and its restatement, all read from the artefact | `funnel.stored`, `storeItems`, `redundancy` |

Nothing else moves. Same pack budget, same form, same split, same seed, same model, same `n`. The pass
is reversible at the header, so the R120 pair is available without a second store.

## Prediction

- **`distillUnit.consolidation.merged` is greater than zero** and `retained` is at most **55** of 73 —
  two of five statements restate another, and the pass's floor is the consolidator's own 0.60 rather
  than a number chosen for this arm. This is the claim: a census, exact, no sampling error.
- **`consolidation.crossTaskGroups` is greater than zero**: at least one merge unions evidence from two
  distinct tasks, which is the first time any item in this record carries `supportTasks ≥ 2`. That cell
  is ALTK-Evolve's `sup2`, and no arm here has ever served one.
- `consolidation.supportAfter.max` is at least 2, and `supportAfter` has fewer entries at 1 than
  `supportBefore`.
- **`storeItems` redundancy falls to at most 15%** against R120's 34.4% on the same measurement, with
  the clipping sentence carried: the sample is clipped at 240 characters, so the figure is an upper
  bound in the same direction on both runs and the comparison is like for like.
- `funnel.stored` falls by the `merged` count and `servable` with it, so the pack serves **fewer
  distinct items** per request: `pack.summary.meanIds` is at most R120's 4.012.
- **The episode rate is reported with its interval and the headline is not claimed.** R120 measured
  141 of 160 episodes (88.13% ±5.01pp) and `pass^4 0.7500` against a `rate⁴` of 0.6031. A rate inside
  ±5pp of 88.13% with a headline anywhere in [0.60, 0.90] is **the same experiment**, and the record
  now says so before the run rather than after it.

## Refutation

- **`merged: 0` with `considered: 73` refutes the pass's reachability on this store**, not the store's
  recurrence. The four refusal counters say which refusal did it (`refusedCondition`, `refusedPayload`,
  `refusedDuplicateEvidence`, `refusedLinkage`), and the next dollar goes to the floor rather than to
  another arm. This is the third mechanism in six rounds whose reachability had never been measured.
- **`merged > 0` with `crossTaskGroups: 0` refutes the merge's *purpose***: the store shrinks without
  getting corroborated, which is the laundering R99 already paid for and would close the merge line
  rather than advance it.
- **`distillUnit.consolidation` absent while the header says `consolidate: true` refutes the wiring** —
  the parameter nobody sent, in its third form. No arm on this lane may report a merged store until it
  is fixed.
- **A rate below 83.1%** (R120's 88.13% minus its 5.01pp half-width) would be the first store-side
  change on this lane with a resolvable harm, and it would outrank any census in this file.
- **`storeItems.shape` or `fold.unnamed` regressing** would mean the merge changed the item shape the
  fold keys on; the fold's census is reported on this arm for that reason and not as a second treatment.

## Why the merge is not the fold

R120 measured the delivery-side fold at **−12.50pp on 40 tasks** (`[-30.00, +5.00]`, p = 0.2668) while
folding 58 items out of 162 packs, and the mechanism is now understood: `makePack` refills behind the
fold, so that arm **substituted** one item for another instead of delivering fewer. The write-path merge
is a different object in three ways, and they are the reason it is worth a dollar after that result:

| | delivery fold (R120) | write-path merge (R121) |
| --- | --- | --- |
| what changes | which items a pack carries | what the store *holds* |
| support | reported, never written | **unioned into the survivor's evidence** |
| reversibility | per request, both arms in one dispatch | per dispatch |
| the risk | substitution, invisible at the boundary | the merged claim is a paraphrase no episode wrote |

The last row is the real risk and it is measurable: the pass refuses a merge whose payloads differ, and
`weakestPair` reports the weakest containment any merged group rests on.

## Cost

**~$1.10**, R120's own billed figure for the same shape: one learn half (74 episodes, ~$0.19) and one
evaluation of 160 episodes ($0.9256). One arm, because the two-unit machinery is off: the units are not
what this registration varies.

## What this unlocks

| reading | question it answers | what it decides |
| --- | --- | --- |
| `consolidation.merged`, `retained` | whether a store can be made to hold claims instead of corrections | whether the store's unit changes at all, or the line closes |
| `crossTaskGroups` | whether a merge can buy support, which is `sup2` | whether this record can ever serve the cell ALTK wins on |
| `storeItems` redundancy | whether the merge removes the restatement the census priced | whether R120's "uninformative at the margin" reading holds |
| the rate, and the ledger diff against R120 | what a smaller, corroborated store does to episodes | the next arm's prediction, with numbers from the same instrument |
