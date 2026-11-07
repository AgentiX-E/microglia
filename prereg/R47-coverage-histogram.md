---
id: R47-coverage-histogram
step: R47
opened: 2026-11-07
arms: memory,reference
sample: 200
gates: V1,V2,V3,V5,V6,V7,V8,V15,V16,V17,V32,V33,V44
---

# R47 — the committed histogram, read from a real dispatch

**Registered** 2026-11-07, after R46 (run `42317807270`) was read back on
`cb329054` and defect 25 was repaired on `d5497a8e`. R46 committed
`injectedPairs 3016` and `zeroCoveragePairs 1175` — one coverage scalar —
because `armRecordFromDriver` reduced the driver's raw `useObservations` to the
seven-field `UseCensus` and discarded the pairs. `TECH-DESIGN` section 17.89
requires U3's `minCoverage` floor to be computed from a committed histogram,
and a scalar cannot support that: a real-kernel offline probe measured two
populations with the identical scalar whose retained pair fractions at
`minCoverage = 0.05` differ by 12.44 points. `coverageHistogram` now commits a
fixed `COVERAGE_FLOORS` retention curve with pack-level `retainedPacks` and
`emptiedPacks`, non-zero coverage quantiles and separately reported
content-free queries. This dispatch is the P1 step of the post-readback order:
an as-is observation that reads that histogram from a real run.

## What this round is not

It is not an arm. No pack, rule, admission decision, scope, threshold, gate or
line of `packages/core` changes. The dispatch inputs are R45's and R46's
verbatim — `l4=true`, `bird=false`, `probe=false`, `l4_arms=both`,
`l4_train_share=0.5`, `adjudicate=false`, `split=minidev` — with only `prereg`
renamed, so the artefact becomes `poc-sota-bird-R47-coverage-histogram.json`
and R45's and R46's files are preserved. The one difference, as in R46, is on
the reading side: the same facade observations now reduce into a committed
`coverage` histogram beside the unchanged seven-field `use` census. The
`coverage` field is optional, so every older artefact keeps reading as "not
measured"; no gate reads it.

## The claim under test

R46 answered the use-side question with a scalar: on real distilled statements
`zeroCoverageShare` read 0.3896, falsifying the pre-registered `> 0.5` and
confirming that a proxy is not the distilled statement. But a scalar cannot say
what a non-zero floor would empty, and the non-zero coverage mass was measured
offline to sit in the left tail (p10 0.04, p50 0.069, p90 0.143). U3 needs the
retention curve itself: for each candidate floor, how many served packs keep at
least one statement and how many a floor would empty. `V1` grades whether a
pack is non-empty, so the pack-level curve, not a pair-level mean, is the
quantity a floor can be held against. This round measures that curve on the
real corpus and commits it; it does not act on it.

## What is read, and what is not claimed

The reading is the memory arm's `tau2.coverage` block (`measuredPairs`,
`unmeasurablePairs`, `unmeasurablePacks`, `nonzeroQuantiles`, and one
`floors` row per `COVERAGE_FLOORS` entry with `minCoverage`, `retainedPairs`,
`retainedPacks`, `emptiedPacks`) beside the seven-field `tau2.use` block. The
retention curve is a measurement, not a decision. **No floor is chosen in this
round**: U3's floor is computed from this committed curve and registered before
its own dispatch, as `AUDIT` section 34.22 requires, and is never chosen from
`l4-paired` or from any accuracy number in this run. No accuracy claim is made
from this run: `l4-paired`, `V5` and `V16` may again report a red conclusion,
and that is the lane refusing to certify an underpowered measurement rather
than a build failure. The sign, magnitude and significance of `l4-paired` are
not predicted.

## Prediction

- **`coverage` is present on the memory arm and absent on the reference arm.**
  The reference driver returns before the recall facade exists, so its artefact
  cannot carry observations; a `coverage` block there, or a missing one on the
  memory arm, means the new instrument did not cross the process boundary.
- **`floors` has exactly one row per `COVERAGE_FLOORS` entry (ten rows), the
  first `minCoverage` is 0, and the sequence is strictly increasing.** The grid
  is fixed in source before any dispatch; a different length, a reordered grid
  or a missing zero rung means the retention curve is not the registered one.
- **`measuredPairs + unmeasurablePairs` equals `use.injectedPairs`.** The
  histogram calls `coverageProfile` on the same observations the census counts,
  so the two readings share one population by construction; a mismatch means
  the instrument counted a different set of injected statements.
- **For every floor row, `retainedPacks + emptiedPacks + unmeasurablePacks`
  equals `use.recallServed`.** Served packs either have a content-bearing
  question and fall into the retained or emptied bucket, or have no content
  term and are reported separately; the three buckets must reconcile to the
  served population at every rung, not only at zero.
- **At the zero rung, `retainedPairs` equals `measuredPairs` and
  `emptiedPacks` is 0.** `buildPack` keeps every hit when the floor is zero and
  every coverage is non-negative, so the first rung is the as-is configuration
  and cannot empty a measurable pack.
- **`retainedPairs` never increases and `emptiedPacks` never decreases as
  `minCoverage` rises, and at least one positive rung reports
  `emptiedPacks > 0`.** Raising a floor can only remove hits. The last clause
  is the falsifiable one: if no pack in the real population is emptied by any
  positive rung, the fixed grid has no pack-level resolving power on this
  corpus and U3 cannot be registered from it.
- **`nonzeroQuantiles` is non-decreasing from `min` through `max`, every value
  lies in 0 to 1, and `min > 0` when `measuredPairs > 0`.** These are quantiles
  of the strictly positive coverage of measurable pairs; an inversion or a
  zero minimum would mean the sorted population was built incorrectly.
- **Every validity gate R45 and R46 passed passes again** (`V1`, `V2`, `V3`,
  `V6`, `V7`, `V8`, `V15`, `V17`, `V32`, `V33`, `V44`), `V5` and `V16` remain
  unresolved as before, the seven-field `use` census is unchanged in shape and
  `widenedItems = 0`. The sign, magnitude and significance of `l4-paired` are
  not predicted.

## Refutation

- **If the memory arm's `coverage` block is missing, empty, or present on the
  reference arm**, the instrument is not wired through `instrument()` into
  `armRecordFromDriver`. Abandon the reading, repair the instrument and
  re-dispatch; do not report "no histogram needed" and do not compute a floor
  from the seven-field scalar.
- **If any of the three reconciliation identities fails** — the pair
  population against `injectedPairs`, the pack population against
  `recallServed` at any rung, or the zero rung against `measuredPairs` — the
  histogram counts a different population than the census. The reading is
  invalid, U3 stays closed, and no floor is registered from it.
- **If the grid shape, monotonicity or quantile ordering is violated**, the
  committed curve is not the fixed `COVERAGE_FLOORS` measurement. Revert the
  instrument on the reading, exactly as the project rule requires for a
  regression, rather than interpreting a broken curve as a finding.
- **If `l4-paired` is significantly negative, or falls below minus five points
  with a served pack**, R45's revert rule fires unchanged; this round adds no
  new revert branch and no accuracy claim that could soften it. If any validity
  gate that R45 and R46 passed regresses, the dispatch changed a behaviour
  instead of observing it and the same rule applies.
- **If the run's evidence artefact is absent**, nothing was measured. Say so,
  keep U1, U2, U3 and R46's admission-rule arms closed, and do not reinterpret
  R46's scalar as a histogram.
- **A floor chosen from any accuracy number in this run, or from the offline
  structural proxy, refutes the registration.** The floor belongs to U3, is
  computed from the committed retention curve, and is registered before its
  own dispatch. Likewise, a rewrite of R46's six predictions or of this file
  after the run refutes it: the registration is fixed before the measurement.

## Cost

One dispatch through `sota.yml`, the same scenario pair and sample as R45 and
R46, two arms, about 1 h 20 min. No new dataset, no new model family, no
change to the merge gate, no change to `packages/core`, `sota.yml` or any gate
definition. Acceptance: `pnpm check` exit 0, coverage at least 95 percent on
every dimension, `ci.yml` green before dispatch, and both repositories pushed
as Lambertyan.
