---
id: R120-the-fold-key
step: R120
opened: 2026-11-15
# R119's lane, R119's split, R119's n, R119's form — with one mechanism repaired and nothing else
# moved. The repair is not a treatment: the fold was installed at R109 to deliver support ≥ 2 and it
# has never had an input, so this dispatch is the first one in which the two facade arms are two
# treatments. A comparison against R119 would be a comparison against a run whose collapse arm was
# the per-failure arm under a different name, which is why the prediction below is a census and not a
# delta.
arms: memory
sample: 160
gates: V0,V1,V2,V3,V5,V8
recallFloor: 0
facadePair: off
facadeNotes: off
facadeShapes: two-unit
distillScope: all
distillUnit: correction
distillForm: lesson
trainDomain: retail
testDomain: retail
recallDomain: retail
packBudget: 2400
taskSplit: official
trainTasks: 74
testTasks: 40
release: v1.0.1
# The bar, as a field the gate reads. R119 stated its bar in prose — "the interval's lower bound must
# clear 0.575, which needs p ≥ 0.75" — and the gate compared a point to `published + 5pp`. One
# dispatch, two bars, and the gate's was the lenient one: a run at 0.63 would have been green under a
# file that says the claim cannot be made below 0.75. This registration names the ruler it is graded
# by, and the gate's criterion prints the half-width it applied.
claimRuler: interval
---

# R120 — the fold's key had no input, and the census that proved it was printed beside it

**Registered** 2026-11-15, after reading R119's artefact.

> **R119** (`43645602812`) ran this lane and printed two numbers about one store, in one dispatch:
> `fold: units 631, folded 0, groups 0, atLeastTwo 0, max 1` and `merge: shapes 53,
> support.atLeastTwo 10, max 5`. They are the same question asked with two keys.

The merge census keys a **correction** by the tools it called. The fold keys an **item** by the `A:`
line in its statement. A record written by the distiller is a sentence — *"return actions carry the
order_id, the item_ids being returned, and a payment_method_id"* — and it has no `A:` line at all, so
`callsOfStatement` returned `[]` for all 79 servable items, `shapeKeyOf` returned `undefined` for all
of them, and every item was its own unit. The fold could not fire on any distilled store.

R119 read that as a property of the store and said so:

> "the fold removed nothing, so the two arms are one treatment: this delta is the lane's run-to-run
> noise at n = 40"

The conclusion is right and the reason is not the one given. The two arms *were* one treatment, and
the difference between them was 7.50pp — which is a valid noise reading only by accident: the
treatment failed to apply. `facadeShapes: two-unit` has been registered on every distilled arm since
R109 and has never once produced two units.

## What one dispatch changes

| change | what it is | who measures it |
| --- | --- | --- |
| the fold's key | the routine of the correction that wrote the item, joined through the item's evidence, with the statement's own `A:` line still winning when it has one | `fold.groups`, `fold.support`, `fold.folded` |
| `storeItems[].shape` | the resolved routine per sampled item, so the census can be re-derived from the artefact instead of from the code that printed it | `storeItems.shapeCarried` |
| the gate's ruler | `claimRuler: interval`: the score minus its own half-width must clear 0.575 | `l4-pass4` criterion |

Nothing else moves. Same store size target, same pack budget, same form, same split, same seed, same
distiller.

## Prediction

- **`fold.groups` is non-empty and `fold.folded` is greater than zero.** This is the claim. It is a
  census over every injected pair, so it has no sampling error: a non-zero `folded` is a fact about the
  mechanism and needs no interval.
- `fold.support.atLeastTwo` **equals the number of survivors whose evidence names two or more tasks of
  one routine**, and `fold.support.max` is at least 2. If `max` is 1 while `merge.support.atLeastTwo`
  is above zero, the join is wrong rather than the store.
- `storeItems.shapeCarried` is `true`, and the number of sampled items with a `shape` is at least 40
  of 64 — the fraction of R119's sample whose intent strings already clustered into 9 groups.
- **The two facade arms now differ in what they served**: `items/req` in the collapse arm is below the
  per-failure arm's 3.92, and `chars/req` is below its 2,197, because the fold replaces a group with
  its medoid.
- The score is reported with its interval and **is not claimed**. At n = 40 the half-width at p = 0.60
  is 15.18pp, so a point of 0.60 spans [0.448, 0.752] and the registered bar is the lower bound.

## Refutation

- **`fold.folded: 0` with `shapeCarried: true` refutes the join**, not the store: it would mean the
  evidence's task ids do not reach the corrections the learn half produced. The next dollar goes to the
  join, and no arm on this lane may report a facade split until it is fixed.
- **`fold.folded: 0` with `shapeCarried: false` refutes the wiring**: the driver built the index and
  did not hand it to the sample, which is the "parameter nobody sends" defect in its second form.
- **`fold.support.max: 1` with `merge.support.atLeastTwo` above zero** refutes the resolution rule: an
  item citing one task cannot have support 2, so a non-zero `atLeastTwo` in the census and a maximum of
  1 in the pack would mean the two are counting different populations.
- **A `blank` count above zero** refutes the regime, which R118 and R119 have both reproduced at 73/73.
- **`items/req` unchanged between the two facade arms** refutes that the fold reached the pack at all,
  whatever its census says.

## Why the score is not the claim

R119's own file said a score needs `p ≥ 0.75` to be called above 0.575 at n = 40, and R119 measured
0.600 — inside the band the file named as unresolvable. That was not a failure of the registration; it
was the registration predicting its own silence and the run confirming it.

Nothing about this repair changes that arithmetic. What it changes is whether the *mechanism* is
working, and a mechanism assertion is a census. Claiming a score here would be repeating R119's
mistake with a better story.

## Cost

**~$2.07**, R119's own billed figure for the same shape: one learn half (74 episodes, $0.19) and two
evaluations of 160 episodes ($0.92 and $0.96). About 340 wall-clock minutes against the L4 job's
ceiling, which is why the arm count is one and not two.

## What this unlocks

| reading | question it answers | what it decides |
| --- | --- | --- |
| `fold.folded`, `fold.support` | whether the delivery-side fold can work at all on a distilled store | whether R109's delivery decision survives, or the merge has to move to the write path |
| `items/req`, `chars/req` in both arms | whether a fold that fires is even visible at the pack boundary | whether the facade apparatus has anything to measure on this lane |
| `storeItems[].shape` distribution | which routines the store actually holds | whether the next arm is a write-path merge (`wouldStore 53`) or a distiller contract change |
| the score and its interval | whether a supported pack moves a score | only after the census is non-zero, and only at an `n` that can resolve the delta |
