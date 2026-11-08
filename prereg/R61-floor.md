---
id: R61-floor
step: R61
opened: 2026-11-09
arms: memory,reference
sample: 228
gates: V1,V2,V3,V5,V6,V7,V8,V32,V44
recallFloor: 0
facadePair: off
trainDomain: retail
testDomain: retail
recallDomain: retail
---

# R61 — the ceiling was binding, the yield moved, and nothing corroborated: the floor was the constraint

**Registered** 2026-11-09, dispatchable. R60 is read. It did what it was built to do and then failed
in a way that is more informative than success.

| reading | R59 | R60 | the registration's prediction |
| --- | --- | --- | --- |
| ceiling | 3 (inherited) | **6 (chosen)** | 6 |
| claims per correction | 2.21 | **3.08** | >= 3.0 ✓ |
| median claims per correction | 2 | **3** | 3 ✓ |
| max claims | 3 | **4** | — |
| items at `supportTasks >= 2` | 1 of 30 | **1 of 36** | >= 2 ✗ |
| items at `supportTasks >= 3` | 0 of 30 | **0 of 36** | >= 1 ✗ |
| store retained | 30 of 31 | 36 of 37 (97.3%) | >= 50% ✓ |

**The ceiling was binding and raising it moved the yield.** Median 2 → 3, mean 2.21 → 3.08, on one
more claim per correction than the cap it replaced. The registration's first refutation — "the yield
does not move: the cap was never the constraint" — is **cleared**, and R61 must not be a second
attempt at the ceiling.

**And corroboration did not move at all.** 37 claims at a cap of six produced exactly the same
support 2 count as 31 claims at a cap of three, and still no item at support 3. The refutation "the
yield moves and nothing corroborates: the corpus is the constraint rather than the population" is
**cleared** as well. Both readings are in, and they point at the pass that is supposed to recognise
two tasks saying one thing.

## What the measurement found, before any dispatch

Both defects are provable from the R60 artefact, and neither needed an arm.

**The condition veto had no discriminating power, and it refused the store's best pair.** The pass
required three shared condition terms between two conditions before it would merge them, on the
argument that a count separates a paraphrased trigger from an unrelated one. Measured over the 37
items and their 666 pairs: the shared condition count has **median 1 among pairs whose statements
match** (containment >= 0.60) and **median 1 among pairs whose statements are unrelated** (< 0.40),
with 75% and 82% of each band sharing at least one term. The ratio is the same, median 0.11 in both.
Because the veto runs *after* the statement gate it never sees an unrelated pair, so its only
measurable effect was to keep **1 of the 4 pairs above 0.60 containment** — among them a pair at
**0.88 containment and 0.70 Jaccard**, the most similar pair the store held, refused because its
conditions shared one term while the pair that merged shared five.

**The grouping was single linkage.** A resembling B and B resembling C became one group of three
whose extreme members could share one term in five, reported as three tasks agreeing.

Both are fixed in code rather than argued away, and both are now **measured inside every run**:

| change | what it does | what makes it checkable |
| --- | --- | --- |
| the condition gate is reported, not applied | the statement decides; the condition travels in the census per group | `conditionShared` per group, and the veto still selectable at 3 so its cost is an ablation rather than a memory |
| complete linkage | a member joins only if it matches every member of the group | `weakestPair` per group, which must be >= the floor — an invariant, not a hope |
| the sweep | every threshold in the grid, at the operating condition floor and at the veto's scale | `consolidationSweep` in the artefact, and `refusedLinkage` counting the chains the linkage refused |

## The measurement this registration is built on, taken before it was written

The sweep was run over R60's own sampled store — 36 live items — before R61 was registered, using
the module the artefact's readback can re-run:

| threshold | groups | largest | weakest pair | support |
| --- | --- | --- | --- | --- |
| 0.40 | 6 | 3 | 0.41 | 1..3, 2..3, and four 1..2 |
| 0.45 | 3 | 3 | 0.62 | 2..4, 1..2, 1..2 |
| **0.50 – 0.60** | **1** | **3** | **0.62** | **2..4** |
| 0.65 – 0.80 | 1 | 2 | 0.88 | 2..3 |

**At the unchanged statement floor of 0.60 the store forms one group of three, where the pass formed
one group of two.** Its members carry support 2, 1 and 1, so the group's support is 2, 3 or 4
depending on which tasks the two singletons came from — an interval, because a sampled store has no
evidence rows, and stated as an interval for that reason.

The condition veto, at the same floor, forms **no group at all**: the only pair it ever admitted was
the one the previous pass already merged and retired.

## Prediction

- **The sweep is present and its operating point is the census's own numbers.** Same threshold, same
  condition floor, same `groups`, `merged` and `maxSupportAfter`. A sweep that recomputed the
  operating point could disagree with the pass the store was written from, and then the artefact
  would carry two answers to one question.
- **Every group's `weakestPair` clears the floor it was produced at.** Complete linkage's invariant,
  asserted over every group and not only the largest: a group of three whose extreme members share
  one term in five is the shape that used to be reported as three tasks agreeing.
- **At 0.60 the sweep forms at least one group of three.** Measured at one group of three, weakest
  pair 0.62, against the pass's one group of two — on R60's own store, before this registration was
  written.
- **`maxSupport` reaches 3 and at least one item reaches `supportTasks >= 3`.** Predicted at 3 from
  the interval [2,4]: the group's members carry support 2, 1 and 1, and the two singletons cannot
  both be the task the survivor already holds two rows from, because a correction produced at most
  four claims and the survivor's second row came from the correction that produced its first.
- **`crossTaskGroups >= 1`** — the merge bought a task rather than folding one task's own claims into
  an item that already had it.
- **The store keeps at least 50% of what it read**, so the corroboration was not bought by collapsing
  the store into a few large groups.
- **The veto's ablation merges no more than the operating setting does, at every threshold.**
  Monotone by construction, and a sweep that violated it would be reporting its own arithmetic
  rather than the store's.

## Refutation

- **"The floor was never the constraint: the store holds no duplicate family at any floor."** If no
  group of two forms above 0.60 even with the veto removed, the corroboration question is closed for
  this split and the next lever is the correction rate, not the pass.
- **"The three items are one task's three claims."** If the group of three reports `supportTasks: 1`,
  the store's only duplicate family is a single failure restated, and the recurrence bar is
  unreachable at 57 tasks for a reason no floor can address.
- **"The floor move cost precision, and the group is not the same claim."** If the group at 0.60
  contains a pair below 0.60, complete linkage did not hold and every other reading here is void.
- **"The corroboration does not survive into the served pack."** If an item carries
  `supportTasks >= 3` and the readback's paired delta moves the wrong way by more than the 3.51pp a
  control arm has been measured to drift, then a three-task rule is not better than a two-task one
  and the recurrence bar is measuring the wrong thing.

## What this registration deliberately does not do

It does not raise the ceiling again. The ceiling's contribution is measured and R61 holds it fixed at
6 so that the floor is the only difference from R60. It does not change the cap on trace candidates,
the injection note, or the sampler. It does not touch R57's planted arm, which needs the lane and
must be dispatched after this one.
