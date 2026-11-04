---
id: R44-admission
step: R44
opened: 2026-11-04
arms: memory,reference
sample: 200
gates: V1,V2,V3,V5,V6,V7,V8,V15,V16,V17,V32,V33,V44
---

# R44 — the store admitted nothing, and the store can say why

**Registered** 2026-11-04, after reading R43 (run `41851255477`) and before the dispatch that measures
this round. **Stage**: the third layer of the delivery defect. R41 delivered nothing because no store was
built; R42 built one and served nothing because the keys were the model's; R43 fixed the keys, learned from
every failure it could read, and still served nothing — because nothing in the store is `active`.

## What R43 measured, in full

| reading | R42 | R43 | what it means |
|---|---|---|---|
| `learning.edited` | 7 | **12** | every failed training task produced a correction |
| `learning.unanswered` | 25 | **0** | no failure was left without a lesson |
| `V32-fold-learning-intact` | **FAIL** 78.1% | **pass** 0.0% (0/32, 12 corrections, 0 distillation failures) | the learner reads the record now |
| `store.stored` | 14 | **24** | two candidates per correction, as designed |
| `store.active` | not recorded | **0** | nothing the recall path can see |
| `store.servable` | not recorded | **0** | same number under the search's own definition |
| `recall.requests / served` | 200 / 0 | **1,518 / 0** | the façade was asked 1,518 times and served nothing |
| `V1-pack-not-empty` | FAIL, bare rate | **FAIL**, bare rate | the population was dropped between the artefact and the record |
| `V44-domain-accounted` | pass, 0/14 | pass, **0/24** | every item carries the host's domain |
| `V8-call-reliability` | pass 0/7 | pass **0/12** | twelve distiller calls, none refused |
| `V15-transfer-reconciles` | 88 informative | **76 informative**, 124 retried, 0 unmeasured | the ledger still reconciles |
| `V17-transfer-net-reported` | +4.00pp | **−1.50pp** (18 repaired, 21 broken), verdict `unmeasured` | a direction, not a rate |
| `l4-paired` | +4.00pp, p = 0.6875 | **−4.00pp**, p = 0.7905, n = 50 | the sign moved, significance did not |
| `pass^4` | memory 0.44 / reference 0.40 | **0.38 / 0.42** | a memory arm that was given no memory |
| `V5-resolution` | FAIL 13.73pp | **FAIL 20.97pp** | 8 lost, 6 gained out of 50 |
| `scenarioTasks` | — | **learn 114 / test 50** | the lane's own count, and it agrees with the census |

**Three of R43's registered predictions held, two were refuted, and the refutations are the round's
finding.** `unanswered` 25 → 0 held; `V32` passing held; the bar not moving held. `learning.edited` 7 → 32
was refuted at 12, because the prediction assumed every training task fails — twenty of the thirty-two
passed, and a pass teaches nothing by design. `V8` firing on at least 32 calls was refuted at 12, because a
correction is one call and not two.

**And R43's own refutation section named this round.** It said: *"If the store is 32+ items but
`store.active` is 0, the defect is confidence and contradiction, not the key: the stamp was necessary and
not sufficient, and the next round reads `contradictSameScope` rather than the scope."* The store is 24
items with 0 active. That branch is the one that fired, and this round is its reading.

## What has already been excluded

The obvious suspect — that the driver's evidence payload reads as a trivial edit to the capture layer,
since it states the completion as the reference call names and the edit as those names with their
arguments, and `trustFor('edit')` derives trust from how far the edit moved the completion against a
`minSupport` of 0.8 — was measured this round in three conditions and rejected: the driver's own shape, a
rubric-only correction, and a call correction against a completion naming a different call all activate at
0.9. The test is committed as the guard that keeps the hypothesis from being re-asserted.

What remains is that some decision inside `decideStatus` (`kernel/knowledge.ts`) leaves all 24 items as
`candidate`, and there are exactly three of them:

1. `item.tier === 'user-text' && distinctTasks(item) < 2` → `needs-corroboration`
2. `confidence < activationThreshold` (0.6) → `insufficient-evidence`
3. `support < minSupport` (0.8), where support is the merged evidence weight → `insufficient-evidence`

Two of them write the same reason string, which is why the instrument this round adds is a histogram of
`statusReason` and not a fourth status.

## The claim under test

> The items are held by a decision the store can name, and the name distinguishes the three candidate
> repairs. The round's deliverable is the reason, not a fix: a fix chosen before the reason is a guess with
> a dispatch's cost.

## Prediction

- **`store.reasons` is populated and dominated by one key.** `insufficient-evidence` on the majority (both
  branch 2 and branch 3 write it), `needs-corroboration` on at most the corrections that came from prose,
  and `contradiction-budget-exceeded` on none: the 12 corrections are 12 distinct tasks, so corroboration
  cannot be the block for them.
- **`V1`'s sentence carries the population this time.** The record now forwards `store` and `recall`, so the
  pair report must print `0 of N request(s) carried an item, from a store of 24 (0 active, 0 in scope)`
  rather than the bare rate. If it prints the bare rate again, the block is dropped somewhere else and that
  is the round's finding instead.
- **`V32` stays at 0/32** and the learning half is unchanged: this round touches no reader.
- **`V5` still fails and the bar is not moved.** 50 airline tasks resolve 14.67pp at 8 lost / 6 gained; no
  dispatch of this lane decides 5pp here, and the bar's movement is its own registration (`WHITEPAPER`
  §3.6.37).
- **`l4-paired` remains not significant, and its sign is not predicted.** A memory arm with nothing active
  is the control arm with an HTTP façade, so the honest expectation is "no difference", not "no effect".
- **`recall.requests` stays in the thousands.** The agent asks per step; the count is a property of the
  agent loop, not of the store.

## Refutation

- **If `store.reasons` is `{}`**, the items carry no `statusReason` — either they were written before the
  field existed or the admission path does not set it — and the instrument is what failed. The next round
  reads the store's own writer, not the gate.
- **If `needs-corroboration` dominates**, the block is the prose tier's two-task rule and the repair is in
  `tierFor` or in how the driver labels a benchmark correction, not in support.
- **If `insufficient-evidence` dominates and `confidence` is the failing half**, the repair is
  `activationThreshold`'s input — `scoreKnowledge` — and the round after reads that function's weights
  rather than `minSupport`.
- **If `insufficient-evidence` dominates and `support` is the failing half**, the repair is the merged
  evidence weight, and the driver's evidence is the thing to change: the transcript of the failed episode
  is what the lane does not have, and V46/V47 are blocked on the same absence.
- **If `active > 0` and `served` is still 0**, the store admitted items the façade cannot reach and the next
  round instruments `/v1/recall`, which is the branch R43 also named.
- **If `l4-paired` falls below −5pp with a served pack**, the memory costs accuracy and this project's rule
  applies: reverted on the reading, not on the explanation.

## What would make this round worthless

Treating the delta as the result. The memory arm is expected to be indistinguishable from the reference arm
again, and quoting −4.00pp as a finding about the mechanism would be quoting the absence of a treatment. The
second way to waste it is to dispatch a fix in the same round as the diagnosis: the reason histogram is the
deliverable, and a repair chosen before reading it is what produced R41's empty store and R42's silent one.

## Cost

One dispatch through `sota.yml` with the same scenario pair, the same 32-task learn half, whole-airline
evaluation at four trials, two arms, about 1 h 20 min. No new dataset, no new model family, no change to the
merge gate.
