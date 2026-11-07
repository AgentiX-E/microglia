---
id: R46-use-census
step: R46
opened: 2026-11-06
arms: memory,reference
sample: 200
gates: V1,V2,V3,V5,V6,V7,V8,V15,V16,V17,V32,V33,V44
---

# R46 — the as-is census, a measurement with no treatment

**Registered** 2026-11-06, after R45 (run `42131391874`) was read back and after
the use-side instrument shipped on `c2da0b55` with `ci.yml` run `42149283405`
green. This dispatch is the P1 step of `TECH-DESIGN` section 17.90.

## What this round is not

It is not an arm. No pack, rule, admission decision, scope, threshold, gate or
line of `packages/core` changes. The dispatch inputs are R45's verbatim —
`l4=true`, `bird=false`, `probe=false`, `l4_arms=both`, `l4_train_share=0.5`,
`adjudicate=false`, `split=minidev` — with only `prereg` renamed, so the
artefact name becomes `poc-sota-bird-R46-use-census.json` and R45's file is
preserved. The one difference is on the reading side: the driver now records
`(query, statements)` at the `/v1/recall` facade, and `armRecordFromDriver`
reduces them into the seven-field `use` census.

## The claim under test

R45 delivered a treatment for the first time (`store 21 active / 21 servable`,
`recall 1480 served / 0 empty`, `meanPackIds 1.839`) and measured `pass^4`
memory 0.42 against reference 0.36, `l4-paired +6.00pp [-6, +20] p=0.5488
n=50`, with `V5` reporting an 18.59pp minimum detectable difference. The arm
record carried pack sizes and per-trial rewards but no statement, rule, pack id
or injected content, so the delta cannot separate an underpowered lane from a
pack whose rules were mostly about another domain. `AUDIT` section 34.23
measured 75.88% zero lexical overlap on cross-domain structural stand-ins
against 20.77% within-domain, and refused an accuracy claim because those are
proxies. This dispatch measures the missing half on the real statements the
distiller produced.

## What is read, and what is not claimed

The reading is the memory arm's `tau2.use` block (`arm`, `recallRequests`,
`recallServed`, `meanPackIds`, `injectedPairs`, `zeroCoveragePairs`,
`widenedItems`) and `zeroCoverageShare` computed from its two registered counts.
`coverageProfile` is a pure function over the raw observations, not a field of
the registered shape; it is not read here and no floor is chosen here. No
accuracy claim is made from this run: `l4-paired`, `V5` and `V16` may again
report a red conclusion, and that is the lane refusing to certify an
underpowered measurement rather than a build failure. U3's floor is computed
from the committed census **after** this dispatch, as `AUDIT` section 34.22
requires; it is not computed from R45's delta or from this run's delta.

## Prediction

- **`use` is present on the memory arm and absent on the reference arm.** The
  reference driver returns before the facade exists, so its artefact cannot
  carry observations; a `use` block there, or a missing one on the memory arm,
  means the instrument did not cross the process boundary.
- **`recallServed > 0`, `recallRequests` within ten percent of R45's 1480, and
  `meanPackIds` within ten percent of R45's 1.839.** The configuration is
  unchanged, so a large movement in the served population is a regression in
  delivery rather than a new measurement.
- **`injectedPairs > 1000` and equal to the sum of the served pack sizes.** The
  census flattens one row per statement; a different total means the driver
  recorded something other than what the agent was shown.
- **`zeroCoveragePairs > 0` and `zeroCoverageShare > 0.5` on real statements.**
  The offline proxy measured 0.7588 cross-domain against 0.2077 within-domain;
  predicting the direction on the real corpus is falsifiable and is not a
  threshold for any arm.
- **`widenedItems = 0`.** `V44` reported 0 widened items in R45 because
  `stampDomain` marks every item with the learn domain; no code path in this
  dispatch changes that ledger.
- **Every validity gate R45 passed passes again** (`V1`, `V2`, `V3`, `V6`,
  `V7`, `V8`, `V15`, `V17`, `V32`, `V33`, `V44`), and `V5` and `V16` remain
  unresolved as before. The sign, magnitude and significance of `l4-paired`
  are not predicted.

## Refutation

- **If the memory arm's `use` block is missing, or `injectedPairs = 0` while
  `recallServed > 0`**, the instrument is not wired into the driver. Abandon the
  reading, repair the instrument and re-dispatch; do not report "no coverage
  problem" and do not compute a floor from zeros.
- **If `zeroCoveragePairs > injectedPairs`, or `zeroCoverageShare` falls
  outside 0 to 1**, the census counts two different populations. The reading is
  invalid and U3 stays closed.
- **If any validity gate that R45 passed regresses** — `V8` above 0%, `V32`
  above 0 of 32, `V1` failing, or `V44` reporting a widened item — the dispatch
  changed a behaviour instead of observing it. Revert the instrument on the
  reading, exactly as the project rule requires for a regression.
- **If `l4-paired` is significantly negative, or falls below minus five points
  with a served pack**, R45's revert rule fires unchanged; this round adds no
  new revert branch and no accuracy claim that could soften it.
- **If the run's evidence artefact is absent**, nothing was measured. Say so,
  keep U1, U2, U3 and R46's admission-rule arms closed, and do not reinterpret
  R45's number as a census.
- **A floor chosen from any accuracy number in this run refutes the
  registration.** The floor belongs to U3, is computed from the committed
  census, and is registered before its own dispatch.

## Cost

One dispatch through `sota.yml`, the same scenario pair and sample as R45, two
arms, about 1 h 20 min. No new dataset, no new model family, no change to the
merge gate, no change to `packages/core`, `sota.yml` or any gate definition.
Acceptance: `pnpm check` exit 0, coverage at least 95 percent on every
dimension, `ci.yml` green before dispatch, and both repositories pushed as
Lambertyan.
