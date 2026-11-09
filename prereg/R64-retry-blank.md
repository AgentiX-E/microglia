---
id: R64-retry-blank
step: R64
opened: 2026-11-09
arms: retry-blank
sample: 350
gates: V1,V2,V3,V4,V5,V6,V7,V8,V12,V32
---

# R64 — the arm whose number is prose, measured on the population it is about

**Registered** 2026-11-09, undispatched.

## Why this file exists

`retry-blank` is self-correction with no memory: the retry prompt carries the failed attempt and the
execution error, and an empty pack. It is the mechanism arXiv:2606.29733 reports at **+3.06pp
(p=2e-11)** on CodeLlama-7B and **+3.65pp (p=6e-11)** on Llama-3.1-8B, and it is the arm R17 quotes at
**+0.57pp with 2 gained and 0 lost**.

That reading cannot be checked. `grep -rl retry-blank eval/results/` returns nothing, and so does the
repository's history: the dispatch that produced it left no artefact. Two of the two non-negative
readings this project has ever recorded for any arm family are retry arms, and both of them are prose.
So this registration is not for a new mechanism — it is for the evidence of an old one.

## The design, and why the population is the failures

Comparing `retry-blank` to `none` over all questions spends most of its sample on questions where the
first answer was already right and no retry was made. The quantity the mechanism is about is defined
only on the questions that failed:

  repaired      first answer wrong, retry right
  regressed     first answer right — then the question was never retried, so this is zero by
                construction on the retried population, and the population is defined by failure
  repaired rate repairs / retried

At minidev with a base accuracy near 53%, about 165 of 350 questions fail, so the repaired rate is
resolved to roughly ±7pp at 95% — enough to separate "the mechanism does nothing" from "it repairs a
third of failures", which is the published range. The mean delta over all 350 is *also* reported, and
the registration says in advance that it cannot resolve 0.57pp: at n=350 the smallest detectable paired
effect is about 6pp, so a null there is a null about power, not about the mechanism.

## Prediction

- **The retry fires.** At least **40%** of the 350 questions produce a first answer that fails to
  execute or scores wrong, so the retried population is at least 140 questions. A lower share means the
  base accuracy moved and this registration's population is not the one it was written for.
- **The repaired rate is between 15% and 45%**, with the point estimate **above 25%**. The published
  per-failure reading is in this range on models with more headroom; ours has less, so the lower half
  of the band is the expected one.
- **The arm's net over `none` is positive but unresolved**: a point estimate between 0 and +4pp with an
  interval that includes zero. This is what a +0.57pp mechanism looks like at n=350 and it is not
  evidence against the mechanism.
- **`retry-keyed` is not dispatched here.** One mechanism per registration; the failure-keyed
  retrieval is a memory arm and belongs to a registration that names a pack.
- **The bill is computable and the run is off-peak**, for the same reason R63 states: a run that cannot
  state its cost cannot be scheduled.

## Refutation

- **The retry line is promoted** if the repaired rate's lower bound exceeds 25% **and** the net delta
  is positive. The next stage is a registered comparison of `retry-blank` against `retry-keyed` on the
  same retried population, which prices what memory adds *at the moment a failure exists* — the one
  place this project has never been able to measure memory cleanly.
- **The mechanism is closed** if the repaired rate's upper bound is below 10%, or if the net delta is
  negative with an interval excluding zero. A retry that damages more than it repairs is a mechanism
  the product must not ship, and the prose number in R17 is then wrong rather than merely unevidenced.
- **The run is void** if the retried population falls below 140 questions, because the registration's
  band was computed for that population and a different one is a different test.
- **A null with an interval that includes both 0 and +4pp is the registered outcome, not a refutation.**
  It is written here so that the next reader does not have to decide after the fact whether a small
  positive was a failure.

The alternatives are named so the outcome selects one. The specific risk this registration exists to
prevent is the one R17 already suffered: an arm that measures non-negative, gets quoted for twenty
rounds, and has no artefact to re-derive it from.
