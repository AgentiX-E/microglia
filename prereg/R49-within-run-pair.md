---
id: R49-within-run-pair
step: R49
opened: 2026-11-07
arms: memory,reference
sample: 200
gates: V1,V2,V3,V5,V6,V7,V8,V15,V16,V17,V32,V33,V44
recallFloor: 0.01
facadePair: as-is-floored
---

# R49 — a within-run pair of recall facades on one distilled store

**Registered** 2026-11-07, after R48 (run `42353229972`) was read back and the
R45 revert rule fired on its within-run `l4-paired = -6.00pp [-16, 4]`,
`p = 0.4531`, `n = 50`. R48's comparison was not a measurement of the floor.
It compared two dispatches: R47 distilled 8 items and referenced at `0.30`,
R48 distilled 12 and referenced at `0.44`. `AUDIT` 34.35 calls this defect 29.
The applied floor was reverted to as-is, and the U1, U2 and R46 arms were closed
until a valid paired reading exists. This registration is that reading.

## The one thing that changes

One `sota.yml` dispatch, one `run_split.py` invocation sequence, one learning
phase, one distilled store, one held-out split, one seed stream, one model and
one memory-free reference arm. Inside the single driver process, the SAME
`host` is evaluated twice, once per recall facade:

| Facade | `buildPack.minCoverage` | Artefact role |
| --- | --- | --- |
| as-is | `0` | control half of the pair |
| floored | `0.01` | registered treatment; also the memory arm `l4-pair` grades |

`TAU_MIN_COVERAGE = 0.01` is read from this registration by `prereg-floor.ts`,
which recomputes it from R47's committed coverage histogram under the
registered weights `alpha=1`, `gamma=3`, `beta=0.5`. `prereg-pair.ts` emits the
pair switch. Neither the floor nor the pair can be supplied from the dispatch
menu, and neither can be revised after the readout (R5). The two evaluations
pass the same explicit `--seed 300` to `run_split.py`, so common random numbers
are an attested property: `Var(A - B) = 2 * sigma^2 * (1 - rho)` is why two
dispatches of one configuration are never a paired comparison, however similar
their inputs look.

`RunScope` pins eight shared fields: `dispatchId`, `preregId`,
`storeFingerprint`, `learnSplit`, `testSplit`, `seed`, `trials`, `model`. The
fingerprint is a deterministic digest of the single store's statements, taken
before either facade recalls. A changed learning phase is refused at runtime
by `within-run-pair.ts` rather than being discovered in a document.

## What is measured, and what is not

The primary readout is `poc-l4-facade-pair.json`, with exactly three terminal
states: `PAIRED`, `REFUSED_CROSS_RUN`, `NO_MEASUREMENT`. Only `PAIRED` reports a
contribution, and it reports a per-task exact McNemar reading with its
bootstrap interval, p-value, paired count and served-pack population. The
contrast is tagged `facade-contrast` and has no `scope` field readable by the
R45 revert rule: it is **not** the memory-versus-reference `l4-paired` gate.
The main `poc-l4.json` still grades the floored memory arm against the
memory-free reference through `l4-paired`, exactly as R48 did, so the revert
rule is neither bypassed nor double-counted.

Defect 27 is closed with a bounded provider pre-flight registered by this
dispatch. If the provider refuses every probe call, the lane writes an
explicit `status_no_measurement` artefact and claims nothing. An infrastructure
failure is not a zero, not a negative delta and not a revert.

No accuracy, `l4-paired` value, task-level outcome or offline proxy may be used
to choose, justify or revise `0.01`. A `PAIRED` verdict with
`servedPacks.floored = 0` is a zero-delta pair of two untreated arms, not
evidence that the floor has no effect.

## Prediction

- The driver attests one `storeFingerprint`, one `dispatchId` and one `preregId` for both facades, so `withinRunPair` cannot return `REFUSED_CROSS_RUN` on a correctly wired run.
- Both facades score exactly the same qualified task ids, so `comparison.onlyFirst` and `comparison.onlySecond` are both zero and `comparison.paired` equals the held-out task count.
- The as-is facade serves at least one pack and the floored facade serves at least one pack, so `treatmentDelivered` is true and the reading is not a pair of two untreated arms.
- The floored facade serves fewer or equal packs than the as-is facade, because a positive `minCoverage` can only empty or shrink a pack, never grow one.
- `poc-l4-facade-pair.json` is written beside `poc-l4.json`, and its `state` is one of the three registered terminal states.
- The main `poc-l4.json` still carries an `l4-paired` gate against the memory-free reference, and no `revertRule` input is produced by the facade contrast.
- `poc-l4.json` contains a new `l4-facade-pair` gate whose value is the paired state, and that gate passes for `PAIRED` and `NO_MEASUREMENT`.
- The pre-flight probe either reports `READY` over three consecutive completions or stops the lane with `status_no_measurement = 1` and `status_not_run = 0`.

## Refutation

- Abandon this arm if the two facades carry different `storeFingerprint`, `dispatchId`, `learnSplit`, `testSplit`, `seed`, `trials` or `model` values; that is defect 29 reproduced, not a measurement.
- Abandon this arm if either facade scores no task, or the two facades do not score exactly the same qualified task ids.
- Abandon this arm if the floored facade serves zero packs, because a treatment that never arrived cannot have a contribution.
- Abandon this arm if the readback reports `NO_MEASUREMENT` for a reason other than the registered provider pre-flight refusal.
- Abandon this arm if `poc-l4-facade-pair.json` is absent while both arms wrote their artefacts, because the pair was not actually graded.
- Abandon this arm if any accuracy, `l4-paired` value or offline proxy is used to change `0.01` after the readout, or if this file is edited after the readout.
- Abandon this arm if the facade contrast is fed to the R45 revert rule, or if a `Pass^4` number is quoted as the floor's contribution.

## Interpretation limits

A `PAIRED` delta is the contribution of `minCoverage = 0.01` **on this one
store, split, model and seed stream**. It is not a SOTA claim, not a ranking
movement and not a statement about other floors. With `n = 50` the registered
minimum detectable difference remains in the double digits of percentage
points, so a non-significant interval is reported as unresolved rather than as
a null effect. `NO_MEASUREMENT` and `REFUSED_CROSS_RUN` produce no contribution
at all. U1, U2 and R46 stay closed until a valid `PAIRED` reading exists.
