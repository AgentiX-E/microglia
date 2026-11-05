---
id: R45-admission
step: R45
opened: 2026-11-06
arms: memory,reference
sample: 200
gates: V1,V2,V3,V5,V6,V7,V8,V15,V16,V17,V32,V33,V44
---

# R45 — the first round with a treatment

**Registered** 2026-11-06, after reading R44 (run `41872858497`) and reproducing its
admission decision offline on the real corpus. **Stage**: the first dispatch in which
`recall.served` can be greater than zero.

## What R44 measured

`store.reasons` was `insufficient-evidence=19` on 19 stored items, `0 active`,
`0 servable`, `1,427` recall requests and `0` served, `meanPackIds 0.00`.
`V1` printed its population for the first time. `l4-paired` was +12.00pp at
p = 0.1460 with an empty pack; `pass^4` was memory 0.52 / reference 0.40.
Five of six registered predictions held. The `sota` job's conclusion was
`failure` on four blocking scientific gates; `ci.yml` on the same head was green.

## What the offline reproduction settled, without a dispatch

`insufficient-evidence` is written by `confidence < activationThreshold` **or**
`support < minSupport`. R44's histogram cannot separate them. The decision was
reproduced on the real τ² retail learn split — the exact 32 tasks the dispatch
learned from, extracted verbatim from the fingerprinted corpus
(`eval/fixtures/tau2-retail-learn-actions.json`, sha256 `b5e49bb7…`, 28,749 bytes;
source sha256 `76e1fa64…`, 328,166 bytes) — through the real `diffJson` →
`trustFor` → `createKnowledgeItem` → `decideStatus` chain. No model call, no mock.

| condition | active / 32 | mean confidence | reading |
|---|---|---|---|
| A current structural distance | **1** | 0.4613 | 31 candidates, `insufficient-evidence` |
| B gold-verified semantic distance = 1.0 | **32** | 0.6165 | repair, no threshold touched |
| C `activationThreshold` 0.6 → 0.45 | 17 | 0.4613 | wrong lever, admits weak evidence |
| D `minSupport` 0.8 → 0.5 | **1** | 0.4613 | no change: support never the block |
| E `singleObservationTrust` → 0.99 | **1** | 0.4613 | no change: contradiction path only |

The mechanism: `editDistance = ops / (leaves(before) + leaves(after))` prices a
gold-verified correction by tool arity (`trust` 0.50–0.90), and
`createLlmInterpreter` writes `trust` into both `trust` and `evidence.weight`, so
`scoreKnowledge`'s `weight × logit(trust)` is quadratic. `support` clears 0.8 at
`trust = 0.8`; `confidence` there is 0.4806; activation needs `trust = 0.89`.
Sixteen of 32 items have `support ≥ 0.8` and `confidence < 0.6`.

**The repair shipped in this round.** `packages/eval/src/tau2-admission.ts` exports
`tau2EditSemantics(before, after)`, which returns `1` only when `after` is the
`correctionEdit` shape and `before` is the driver's completion, and `undefined`
otherwise (structural distance stays the default for every other event).
`tau2-driver.ts` passes it as `editSemantics` to `openMicroglia`; `packages/core`
is untouched. `storeCensus` now carries an item-level `admission` block
(min/max/mean of `trust`, `support`, `confidence`, and `supportOnly`), and the
driver prints the three means. TDD: the corpus-shaped failing test came first;
2,921 tests pass, including a control that reproduces the defect and a treatment
that clears it.

## The claim under test

> The delivery defect was a measurement of the evidence, not a property of the
> memory. Correcting it admits items the recall facade can reach, and this is the
> first round in which the memory arm is actually given a treatment.

## Prediction

- **`store.active > 0` and `store.servable > 0`.** With `trust = 0.9` the
  admission means should read `0.9000 / 0.9000 / 0.6165` and `supportOnly` should
  be `0`; `statuses.candidate` should fall from 19 to near zero.
- **`recall.served > 0` and `meanPackIds > 0`.** This is the round's deliverable.
  `V1-pack-not-empty` passes instead of printing `0.00 rules/question`.
- **`V32` stays at 0/32** and `V8` stays reliable: this round changes the
  capture-layer edit semantics, not the reader or the distiller.
- **`V5` still fails and no bar moves.** The minimum detectable difference at
  50 paired tasks is ~19pp; no dispatch of this lane decides 5pp.
- **`l4-paired` is not predicted.** Every previous paired delta was a sample of
  the untreated condition (R43 −4.00pp, R44 +12.00pp, 14pp of drift between the
  memory arms). This is the first round that can measure an effect at all, so an
  honest registration does not name a sign or a magnitude.

## Refutation

- **If `active > 0` but `served = 0`**, the store admitted items the facade cannot
  reach; the next round instruments `/v1/recall` (the branch R43 also named), and
  no effect is claimed.
- **If `active = 0`**, the hook did not reach the capture layer or the items are
  contradicted after creation; read `store.reasons` and `admission` before any
  further repair.
- **If `l4-paired` is significantly negative, or falls below −5pp with a served
  pack**, the memory costs accuracy and this project's rule applies: **revert on
  the reading, not on the explanation**. A plausible story about why a bad pack
  hurt is not evidence that the next pack will help.
- **If `pass^4` moves by more than 5pp with no served pack**, the instrument is
  broken; do not read the delta.

## What would make this round worthless

Quoting the delta as the result when `recall.served = 0`, or declaring the memory
"works" on a non-significant +12pp. The second way is to treat a positive delta
with a served pack as proof of the *mechanism*: one dispatch at n = 50 has an MDE
near 19pp, so a single significant-looking pair is a reason to replicate, not a
conclusion. The third is to weaken a threshold to make items active: conditions
C–E measured what that does and rejected it before the dispatch.

## Cost

One dispatch through `sota.yml` with the same scenario pair, the same 32-task
learn half, whole-airline evaluation at four trials, two arms, about 1 h 20 min.
No new dataset, no new model family, no change to the merge gate. Acceptance:
`pnpm check` exit 0, coverage ≥ 95% on every dimension (goal 100%), `ci.yml` green
before dispatch, and both repositories pushed as Lambertyan.
