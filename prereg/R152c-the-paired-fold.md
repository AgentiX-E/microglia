---
id: R152c-the-paired-fold
step: R152c
opened: 2026-11-18
# R152b bought the arm and not its control: the dispatch narrowed `l4_arms` to `memory`, and the workflow's pair
# step runs only for `both` (sota.yml:1839), so the job went green having built no pair, graded no gate and
# measured no delta — a green job that measures nothing is the most expensive shape a run can have. This is the
# same treatment again with both arms, which is what the two earlier dispatches should have been.
arms: memory
sample: 114
gates: V0,V1,V2,V3,V5,V8
recallFloor: 0
facadePair: off
facadeNotes: off
facadeShapes: off
distillScope: all
distillUnit: correction
distillForm: lesson
consolidate: true
consolidateKey: routine
consolidateLinkage: all
serveSupport: 2
speakMargin: 0
serveRotation: fair-share
trials: 1
trainDomain: retail
testDomain: retail
recallDomain: retail
packBudget: 2400
packLimit: 1
taskSplit: official
trainTasks: 74
testTasks: 40
release: v1.0.1
claimRuler: interval
---

# R152c — the paired fold: the third draw, and the first one the reconciliation gate grades

**Registered** 2026-11-18, after reading R152 and R152b and before this arm runs. Same treatment as both, same
split, same floor, same one-item pack, same cap arithmetic.

## What the two earlier dispatches measured, and what neither could

| reading | R152 (run `44363599721`) | R152b (run `44383776557`) |
| --- | --- | --- |
| store created / servable | 72 / **14** | 83 / **13** |
| cap resolved | **3** | **4** |
| renders the leader took | **3** | **4** (equals the cap) |
| requests served | 40 of 40 | 40 of 40 |
| starved | 0 | 0 |
| pass^4, memory arm | **0.875** (35/40) | **0.925** (37/40) |
| artefact carries the policy | **no** (`unprojected: ["serveRotation"]`) | **yes**, and it reconciles with its own ledger |
| delta | +2.50pp [−7.50, +12.50], UNRESOLVED | **not measured** — no reference arm was bought |

Two draws of the bounded arm, **5pp apart** on the same treatment, both served in full, both reaching the cap and
neither starving. The mechanism is not in question any more. What is missing is the one thing neither dispatch
produced: a fold — two arms, same split, one pair artefact, one set of gates.

## What this dispatch is for

1. **a poolable bounded fold**, which requires both arms in one dispatch (R48's rule: an arm from another
   dispatch is a second sample wearing the first one's name);
2. **the first fold `l4-rotation-reconciles` grades**, which is a test of the gate as much as of the arm: the
   declared reading must equal the reading the pack ledger accounts for, and the artefact must say which fields the
   ledger cannot reach (`mode` is a policy);
3. **a third point on the bounded arm's distribution** — 0.875 and 0.925 exist; a third draw says whether the pair
   is centred or whether those two are the tails.

## Prediction

- **The pair artefact carries `rotationReconciled` with no problems, `unprojected` is empty, and
  `l4-rotation-reconciles` passes.** Everything else here is about the arm; this is about the instrument, and it is
  the reason the round exists. A fold whose gates are green while the block went missing would be R152 again.
- **`cap` is 3–4, `starved` is 0, `maxRenders` is within one of the cap.** Two draws resolved 3 (over 14 servable)
  and 4 (over 13); the cap is a function of the draw and a store outside 10–14 servable would be a third value,
  which would be a finding about the store rather than about the bound.
- **`breaks` ≤ 3 and `repairs` ≥ 2, with the delta unresolved.** The registration rules are unchanged: at 40
  held-out tasks this design resolves 15–18pp. What a third draw adds is a location, not a claim.
- **The delta lands within ±7.5pp of +2.50pp.** The two memory-arm draws are 5pp apart, so the band is stated at
  the lane's own test–retest spread rather than tightened to fit the draws already in hand.
- **`pass^4` in 0.85–0.975.** Three draws in one band, two of them already inside it.
- **`serveYield.opportunity` in 10–20% of renders.** R143 read 10.0%, R152 15.0%; the quantity belongs to the corpus
  and the reference arm's pass rate more than to the rotation.

## Refutation

- **No `rotationReconciled`, or `unprojected` non-empty.** The gate is not wired or the projection regressed, and
  the next round is the instrument at $0.
- **`l4-rotation-reconciles` fails with a disagreement.** The block and the ledger describe different runs, which
  is a defect in the driver's accounting rather than in the arm, and no number from this fold may be quoted.
- **`starved` > 0, or fewer than 36 of 40 requests served.** The bound has become a dose change, which is the axis
  this lane has already priced — and the arm would no longer be the one R152 measured.
- **`breaks` ≥ 5.** The two earlier draws were the favourable tail, and the claim reduces to "the bound acts on
  concentration" with no harm claim attached.
- **`repairs` ≤ 1.** The renders the leader lost went nowhere: the axis is *selection*, not allocation.
- **A delta more than 7.5pp from +2.50pp.** Three draws then span more than the lane's own noise floor, and the
  honest report is a distribution rather than a point.

## Decision rule, stated before the number

| outcome | what the next dollar buys |
| --- | --- |
| all blocking gates green, breaks ≤ 3, repairs ≥ 2 | **the rotation becomes the serving default**: `serveRotation: fair-share` in `prereg/TEMPLATE.md`, and the lexical anchor registered on top of it |
| green instrument, breaks ≥ 5 | the bound ships as a concentration control with no harm claim, and R129's outcome counter becomes the arm |
| green instrument, repairs ≤ 1 | selection rather than allocation: the harm claim is withdrawn and a ranking instrument is registered |
| instrument red (`rotationReconciled` absent or disagreeing) | nothing else is bought; the round is an instrument round and the cause is the driver, not the arm |

## Cost

**$0.3717** registered, which is R152's measured bill for the same configuration. The round's real cost is
**$1.03** across three dispatches, $0.29 of it spent on R152b's arm without its control; that is recorded rather
than absorbed, because a dispatch input that silently skips the pair is the cheapest way for this lane to buy
nothing. The guard lives in the operator's `dispatch.py` (a single-arm dispatch now has to say so explicitly) and
the workflow's own step summary.

Off-peak with no `not_before`: this file is opened at 20:55 UTC and the job needs 60 minutes.
