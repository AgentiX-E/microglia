---
id: R48-u3-coverage-floor
step: R48
opened: 2026-11-07
arms: memory,reference
sample: 200
gates: V1,V2,V3,V5,V6,V7,V8,V15,V16,V17,V32,V33,V44
recallFloor: 0.01
---

# R48 — U3: one registered coverage floor, applied at the recall facade

**Registered** 2026-11-07, after R47 (run `42337250684`, dispatched on
`bc0a39eb`) was read back. R47 committed the first real retention curve:
`measuredPairs 2180`, `unmeasurablePairs 8`, `injectedPairs 2188`,
`recallServed 1491`, `zeroCoveragePairs 750`, and a ten-rung curve whose
`0.01` rung retains `1438` pairs in `1069` packs and empties `414` packs.
All eight structural predictions held, the three reconciliation identities
held, all six refutations stayed clear, and `U3_ELIGIBLE` was true. The
head-still rule of `AUDIT` section 34.21 is lifted on that reading.

This is the first arm that **acts** on a use-side measurement. The treatment is
exactly one number: `buildPack`'s `minCoverage` at the recall facade changes
from `0` (as-is) to `0.01`. Every other dispatch input is R47's verbatim —
`l4=true`, `bird=false`, `probe=false`, `l4_arms=both`,
`l4_train_share=0.5`, `adjudicate=false`, `split=minidev` — so the only
behavioural difference between the two memory arms is the floor. The
reference arm is memory-free and unchanged.

## The floor, its cost weights and its tie-break

`0.01` is computed by `decideFloor` from R47's committed `coverage` and `use`
blocks alone, with the registered cost weights `alpha=1`, `gamma=3`,
`beta=0.5`. The score is `alpha * relevant(f) - gamma * falsePos(f) -
beta * abstained(f)`, with `gamma > alpha > beta` so a false-positive
injection costs more than a correct reuse earns and an abstained pack costs
least, following RSCB-MC's asymmetric abstention rule. On the committed
curve these weights give a unique argmax at `0.01`. The registered tie-break
is **least aggressive**: on a plateau the smallest admissible rung wins, so
an array order can never choose the treatment. Both the weights and the
tie-break are fixed in source before this dispatch and are checkable by
`pnpm eval:prereg-floor`, which recomputes the declared floor from the
committed artefact and refuses a mismatch.

The weights are **not** robust on the real curve, and this registration does
not pretend they are. An abstention-averse ordering (`alpha=1`, `gamma=0.5`,
`beta=3`) selects `0`, the as-is configuration. That sensitivity is why the
weights have no default anywhere in the implementation and why they are
registered here rather than tuned after the readout. No `l4-paired`,
accuracy, p-value, task outcome or offline structural proxy entered the
choice, and none may be used to revise it afterwards.

## What is measured

The reading is the memory arm's `tau2.use` census and its `tau2.coverage`
histogram beside R47's as-is memory arm, paired per task on the same split,
seed and scenario pair. The contribution of U3 is the paired delta in
`pass^4` between the two memory arms, the delivered population (`recallServed`,
`meanPackIds`, `zeroCoveragePairs`), and the number of packs the floor
emptied. A red `l4-paired`, `V5` or `V16` is the lane refusing to certify an
underpowered measurement, not a build failure. R46 read `0.00pp [-10, +10]
p=1.0000` and R47 read `12.00pp p=0.1094` with MDE 17.72pp, so the sign,
magnitude and significance of this run's `l4-paired` are **not predicted**;
a non-significant reading is expected and is not a refutation.

## Prediction

- **The floor reaches the facade.** The memory arm's `meanPackIds` is strictly
  lower than R47's `1.4675`, and its `injectedPairs` is lower than R47's
  `2188`. If both are unchanged the treatment was not applied and the arm
  measures nothing.
- **Zero-coverage injection falls.** The memory arm's `zeroCoveragePairs` is
  strictly lower than R47's `750`, because a positive floor removes pairs
  with no shared content term before the pack is served. This is the use-side
  harm the floor is designed to remove.
- **Packs are emptied, and `V1` still holds.** `recallServed` is lower than
  R47's `1491`, since a served count requires a non-empty pack, while
  `V1-pack-not-empty` still passes on `meanPackIds > 0`. R47's `0.01` rung
  emptied `414` of `1491` packs (27.77 percent), so a large drop is expected
  and is a cost, not a defect; it must be reported beside any accuracy delta.
- **The three reconciliation identities still hold** — `measuredPairs +
  unmeasurablePairs = injectedPairs`, every rung's `retainedPacks +
  emptiedPacks + unmeasurablePacks = recallServed`, and the zero rung retains
  `measuredPairs` while emptying nothing. A floor changes the delivered
  population, not the instrument's arithmetic.
- **Every validity gate R47 passed passes again** (`V1`, `V2`, `V3`, `V6`,
  `V7`, `V8`, `V15`, `V17`, `V32`, `V33`, `V44`), `V5` and `V16` remain
  unresolved as before, the seven-field `use` census keeps its shape, and
  `widenedItems = 0`. No gate reads `coverage` and no gate definition changes.
- **`coverage` is present on the memory arm and absent on the reference arm.**
  The reference driver returns before the recall facade exists, so its
  artefact cannot carry observations.
- **The declared floor is recomputed, not copied.** `pnpm eval:prereg-floor`
  emits `0.01` from the committed R47 curve under the registered weights,
  and the lane refuses any dispatch whose declaration disagrees with that
  computation.
- **The two memory arms are comparable.** Both use the same task split, seed,
  model, distill and admission settings; the only source difference is the
  recall facade's `minCoverage`. A change in the learning phase, the store or
  the admission rule would break the pairing and refute the arm.

## Refutation

- **If the treatment did not reach the facade** — `meanPackIds`,
  `injectedPairs` and `zeroCoveragePairs` all match R47 within rounding —
  the wiring is broken. Abandon the reading, repair the instrument and
  re-dispatch; do not report the as-is arm twice as an ablation.
- **If any reconciliation identity or the grid shape fails**, the instrument
  counted a different population than the census. Revert on the reading and
  keep U3 closed; a broken curve is not a finding.
- **If `V1-pack-not-empty` fails**, the floor emptied too much of the served
  population for this corpus. Revert on the reading rather than relaxing the
  gate or redefining the served count after the fact.
- **If `l4-paired` is significantly negative, or falls below minus five
  points with a served pack**, R45's revert rule fires unchanged. This arm
  adds no new revert branch and no accuracy claim that could soften it.
- **If `l4-paired` is used to select, justify or later revise the floor**, the
  registration is refuted. Likewise, editing this file, the cost weights, the
  tie-break or R47's committed artefact after the readout refutes it.
- **If the evidence artefact is absent, or the two memory arms did not score
  the same tasks**, nothing was measured. Say so, report no delta and keep
  U1, U2 and R46's admission-rule arms closed until a valid pair exists.
- **If a validity gate R47 passed regresses**, the arm changed a behaviour
  instead of applying one floor; revert on the reading exactly as the
  project rule requires for a regression.

## Cost

One dispatch through `sota.yml`, the same scenario pair and sample as R47,
two arms, about 1 h 20 min. The source change is one optional environment
variable read at the recall facade, a pre-registration header field and a
checker that recomputes the declared floor; `packages/core`, the gate
definitions, the driver's learning phase and the pairing logic are untouched.
Acceptance: `pnpm check` exit 0, coverage at least 95 percent on every
dimension, `ci.yml` green before dispatch, `pnpm eval:prereg` all valid, and
both repositories pushed as Lambertyan.
