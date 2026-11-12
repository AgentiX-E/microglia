---
id: R62-population
step: R62
opened: 2026-11-09
arms: memory,reference
sample: 228
gates: V0,V1,V2,V3,V5,V6,V7,V8,V32,V44
recallFloor: 0
facadePair: off
trainDomain: retail
testDomain: retail
recallDomain: retail
distillScope: all
---

# R62 — the population: teach from every trajectory, not the fourteen that failed

**Registered** 2026-11-09, dispatchable once R57's arms have run. R61 is read and `ABANDONED`.

## What R61 actually established

Three rounds have now moved the three knobs the corroboration pass has, and support stayed at two:

| round | knob | movement | items at support 3 |
| --- | --- | --- | --- |
| R59 | none (baseline) | 30 claims, cap 3 | 0 |
| R60 | the tracer's ceiling, 3 → 6 | 37 claims, median 3, max 4 | 0 |
| R61 | the merge floor over 36 grid points, + complete linkage | 45 claims, median 3, max 5 | 0 |

R61's sweep is the decisive one: **across 36 grid points the largest group is two**, and the same
store's two merged pairs are the two obvious families. R60's group of three did not reproduce on a
fresh store built from the same 57 tasks at the same seed. So the floor was never the constraint, the
linkage was never the constraint, and the ceiling stopped being the constraint in R60.

**What remains is that there is no third member to find.** Fourteen tasks teach; they produce 45
claims; the families among those claims are singletons and pairs. Meanwhile 43 of the 57 learning tasks
**passed on the first attempt** and therefore teach nothing at all — `teachingOf` returns `undefined`
for a pass, deliberately, because a store built from every failure is the store the fold paid for.

That decision is correct for a correction arm and it is what caps the population. R62 is the
experiment that changes the population without changing the unit: **a passing trajectory is asked what
it did that a naive attempt would not have done.**

## The treatment, precisely

One switch, `TAU_DISTILL_SCOPE`, with two values:

| value | what is distilled | tasks teaching (retail, 57) |
| --- | --- | --- |
| `edited` | the corrections: one per failed-and-then-repaired task. Every published arm measures this, and unset means this | **14** |
| `all` | the corrections **plus** every task that passed first time, asked for the rule its successful trajectory follows | **57** |

The distiller form is unchanged (`distill-prompt/3`); what changes is the teaching record. A passing
task carries no failure to explain, so its record states the task, the criteria it met and the
trajectory that met them — the `trace` unit already pairs an attempt with the reference trajectory, and
this is the same pairing with the reference omitted because the attempt *is* the reference.

**Provenance travels with every claim.** Each item records whether it came from a repair or from a
pass, and the artefact carries both counts. Without that the round cannot tell a store that grew from a
store that changed character, and the readback would be grading a mixture it cannot name.

## Prediction

- **The store grows by at least 2.5x.** At the ceiling of six and a median of three, 57 teaching tasks
  produce **>= 112 claims** against R61's 45, of which at least 60 carry `provenance: passed`. A run
  that produces fewer than 112 has not changed the population and is a refutation below.
- **At least one group of three forms at 0.60, and at least one item reaches support 3.** This is the
  round's question. With 2.5x the claims the pair-collision count that produced two pairs at 45 claims
  should produce a triple at 112 if collisions are the mechanism at all.
- **The paired delta does not fall below the 3.51pp control drift.** R61 measured +14.04pp
  (`UNRESOLVED`, CI [−1.75, 29.82], 57 pairs); a wider store spreads one 1,200-character budget over
  more items, and `meanPackIds` was 2. The prediction is a *floor*, not an improvement: dilution must
  not cost the effect this lane has finally measured.
- **The pass keeps at least half the store it reads**, as in every round, and `unanswered` stays 0.

## Refutation

- **"The success distiller has nothing to say."** If the store produces fewer than 112 claims, or fewer
  than 60 from passes, then a passing trajectory does not yield a rule the distiller can state, and the
  population cannot be widened this way — the next lever is a different unit (per-assertion episodes),
  not a different scope.
- **"Corroboration is not a population question either."** If the store crosses 112 claims and still
  holds no group of three at 0.60, then collisions are not the mechanism: claims are bespoke to their
  task at every population this corpus can supply, and recurrence must be counted on **tasks** rather
  than on claims. That would close the merge route for good rather than for one round, and it is the
  outcome this registration is most likely to produce.
- **"The wider store dilutes the pack."** If the paired delta falls below the 3.51pp drift, the effect
  R61 measured is a property of a narrow store, and any future widening trades it away.
- **"The provenance split is a fiction."** If the readback cannot separate passed-claims from
  repair-claims by their recorded provenance, the artefact did not carry what this registration says it
  carries and every reading above is void.

## What this registration deliberately does not do

- It does not change the ceiling (six), the floor (0.60 operating, veto 0), the linkage (complete) or
  the unit (`trace`). One knob moves, and it is the population.
- It does not propose a semantic matcher. R61's sweep shows the lexical matcher already merges the two
  families that exist; a matcher that merges more would be merging claims that are not one rule, which
  is the memory-negative-effect failure this project is trying to measure rather than to introduce.
- It does not touch the evaluation half. The 57 held-out tasks and the `reference` arm are unchanged, so
  the paired delta remains comparable to R61's.
