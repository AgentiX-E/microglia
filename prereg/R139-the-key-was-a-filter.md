---
id: R139-the-key-was-a-filter
step: R139
opened: 2026-11-17
# R138 refused the outcome counter because items do not recur: 19 distinct items over 40 requests, sup2 2 of 66.
# The round before that diagnosed the same thing as a cardinality of the *store*. This one asks the pass instead:
# the store holds 43 distinct claims over 64 statements and the pass merged 1, and 34 of the 35 joined pairs are
# filed under different keys, which the pass never compares. The key is the defect, not the grain.
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

# R139 — the key was a filter when it had to be a prior

**Registered** 2026-11-17, after reading R137 (`44106251734`) and R138 (its own artefacts), and before the
pass changes.

R138 refused R129's outcome counter on a cardinality: **19 of 64 items served over 40 requests**, two
negative at −1 each, four positive together worth +5, and 45 never served. An item whose outcomes are
net-negative cannot be quarantined when one of the two had been served **once**, so the mechanism was
refused on evidence rather than deferred. The round named the precondition as a **category** — cut the item
where 57 corrections become ≤12 kinds — and that precondition was never checked against the store the lane
actually writes. This round checks it, and the answer is that the category was not the missing piece.

## What the store says, measured on R137's own artefact and costing nothing

`pnpm tsx packages/eval/src/bin/store-redundancy.ts eval/results/arms/memory/poc-l4.json` prints:

```
redundancy: 64 statement(s), 43 distinct claim(s) (32.8% restated), largest 9,
35 of 2016 pair(s) at or above 0.60;
34 of the 35 joined pair(s) are filed under different keys, which a keyed pass cannot reach;
64 input(s) were clipped, so this is an upper bound
```

Three facts, one diagnosis:

1. **The store knows 43 claims, not 64.** A third of it is a restatement of another part of it, and one
   claim is repeated **nine** times. The wording of those repeats is not subtle — *"Return actions require
   the order_id, the item_ids being returned, and a payment_method_id"* appears six times across six
   routines.
2. **The pass merged one.** `consolidation` on the same artefact reports `considered 70, pairs 2,415,
   groups 1, merged 1, supportBefore {1: 70} → supportAfter {1: 68, 2: 1}`, `skippedKind 1,247`,
   `skippedScope 1,138`, `skippedOverlap 29` — and 1,247 + 1,138 + 29 + 1 = 2,415 exactly, so the census
   is complete rather than suggestive.
3. **34 of the 35 joins are cross-key, and the pass compares only within a key.** `consolidateKey: routine`
   (R124) filters a pair out when the two routines differ, so those 34 pairs were never shown to the
   0.60 floor at all. Within a key the store offered **one** admissible pair — containment 0.667, the one
   the pass merged.

So `sup2 = 2 of 66` was not a property of the corpus, of the distiller, or of the unit. It is the
arithmetic of a filter: a key introduced to make the quadratic test affordable (R121) and then read as a
statement that two items filed differently are two claims.

## What is being measured

- **`consolidation.skippedKey`** — pairs removed by the key **after** every other test admitted them. The
  new field. `skippedScope` cannot say it: a store of 64 unrelated claims and a store holding six
  paraphrases of one sentence both report a large scope count and zero groups.
- **`consolidation.linkage`** — `key`, `scope` or `all`, carried in the census so a readback can tell the
  arm from the control without reading the registration.
- **`consolidation.groups / merged / retained / supportAfter / maxSupportAfter`** — the store the arm
  writes, which is what the superseded R129 counter would have been written onto.

## The change

One option on the pass and one header on the registration:

```ts
readonly linkage?: "key" | "all";   // key filters pairs (default, every artefact to date); all does not
```

With `all` the key is not consulted for removal and **every other test is unchanged**: kind, claim
containment at 0.60, the condition floor, payload equality, duplicate-evidence refusal and complete
linkage. The pass still refuses to merge two claims that state different things — this is *look everywhere*
rather than *merge everything*, and the case that pins the difference is in the suite
(`keeps the guards in force when the key is not`).

The counters are gated so no earlier artefact is reinterpreted: `skippedOverlap`, `refusedCondition`,
`refusedPayload` and `refusedDuplicateEvidence` are incremented only for a pair the key admitted, exactly
as before. `skippedKey` is new and counts the subset of `skippedScope` that passed everything else.

## Prediction

- **`linkage: "all"` on the arm, `skippedKey: 0`.** The instrument's own criterion: a phase that still
  reports hidden candidates has not stopped filtering.
- **The control's `skippedKey` is at least 34** — measured above on the 64-item sample, where the pass
  considered 70 items and its key admitted a single admissible pair. The arm's population is the same
  store, so this is a property of the text rather than a hope; a sample of 64 of 70 makes 34 a floor.
- **`merged` between 8 and 21, `retained` between 49 and 62.** Two independent ceilings, and the prediction
  is the interval between them: the corrections census (`merge`: 73 corrections, 44 shapes, `atLeastTwo`
  **12**, `max 8`) says at most 12 groups can buy support, and the keyless redundancy census says 21 items
  are restatements with complete linkage over 0.60 (`43` groups of `64`).
- **`supportAfter[2] ≥ 8` and `maxSupportAfter` between 5 and 9.** The largest claim is repeated nine
  times in the text; whether all nine survive complete linkage is the open question, and 5 is the floor a
  paraphrase chain can leave behind.
- **`weakestPair ≥ 0.60` in every group, by construction**, and the group detail is what a readback quotes
  to show the merges were paraphrases rather than routines.
- **Cost: ~$0.20**, which is R137's own pair ($0.0996 memory + ≈$0.09 control) on the same 114 episodes.
- **The score: a direction, not a size.** The pack serves fewer, better-supported items out of the same
  2,400-character budget, so the number to read is the **harm share** (6.06% of the trials the control
  passed in R137) rather than the point estimate at n = 40.

## Refutation

- **`groups < 8` with `skippedKey == 0`.** Then the guards, not the key, are what stands between the store
  and its duplicates: the 34 cross-key pairs are not one claim, this round's premise is wrong, and the
  write-side axis closes as *the store's redundancy is not a wave that any merge can fold*.
- **`groups > 21`.** Then the pass is folding only the trivial schema repeats, `sup2` stays under the
  needed bar, and the next dollar goes at the **claim floor** (a sweep, not an arm) rather than at the key.
- **`merged` rises and the score falls.** Then corroboration is not quality: an item supported by two tasks
  is a *more confident* wrong rule, and R129's counter is refused a second time, now for a reason that has
  nothing to do with cardinality.
- **`skippedKey > 0` on the arm.** Then the mode did not reach the pass — the defect R137 found one layer
  up, in the carriage — and no score from this arm may be read.

## Decision rule, stated before the number

| outcome | what the next dollar buys |
| --- | --- |
| `sup2 ≥ 8`, harm share falls | **the outcome counter.** Items now recur by construction — a kind served into many trials — so R129's quarantine becomes identifiable and the `broke` column of the item table gets a denominator |
| `sup2 ≥ 8`, harm share flat | **the item count.** The pack holds 60% of the items for the same budget and the score did not move, which makes dose the variable rather than content — an axis that was unmeasurable under the repeated block |
| `groups < 8` | **the floor.** The claim test is the constraint; the next registration sweeps it on this store and prices the merge it would buy before any dispatch |
| `merged` up, score down | **the counterfactual.** Corroboration bought confidence and not correctness, and the next arm removes the corroborated items to price what they contributed |

## Cost

**~$0.20.** The census that motivates the arm costs nothing: it reads R137's committed artefact, and the
same command runs on any future artefact in one line.

## What this unlocks

| reading | question it answers | what it decides |
| --- | --- | --- |
| `skippedKey` | did the key remove pairs that every other test admitted | whether a merge result is a statement about the store or about the filter |
| `linkage` | which of the two the run actually executed | whether an arm and its control are comparable at all |
| `supportAfter` | how much of the store is now corroborated | whether R129's quarantine has a population to act on |
| `groupDetail.weakestPair` | whether the merges were paraphrases | whether `sup2` was bought or earned |
