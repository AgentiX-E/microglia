---
id: R152b-the-replication
step: R152b
opened: 2026-11-18
# R152's arm acted and its artefact could not say so: the field entered the record through a spread, `Tau2Raw`
# never declared it, and `PROJECTION` had no decision for it, so the arm file carries the key in `unprojected`
# and no block (AUDIT 34.195). The blocking gate that caught it is the evidence that a projection defect cannot
# be repaired at $0 from the arm files — the arm file IS the input — so this is one declared replication of the
# same treatment: a complete artefact, and the first between-run spread reading for a *bounded* arm.
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

# R152b — the replication: the same treatment, drawn again, and the artefact it has to leave behind

**Registered** 2026-11-18, after reading R152's fold and before this arm runs. **Same registration as R152 in
every header line that decides the treatment**; the only thing that differs is that the pipeline can now write
the field, and that the predictions below are about a *second draw* rather than about a first mechanism.

## Why a dispatch and not a repair

R152 is the first fold in this record whose *evidence* is incomplete rather than whose reader is wrong. R143's
official fold was regenerated from its two arm files at $0 (§PROGRESS 178) because the pair artefact was mis-built
and the arms were sound. Here the arm file itself carries `unprojected: ["serveRotation"]` and no block: the
policy is missing from the record, `rotationModeOf` reads the fold as `none` instead of `fair-share`, and the
fold cannot enter the pool as the treatment it ran. The input to any $0 repair is the file that is wrong.

The decision rule R152 registered fired — *breaks ≤ 2 and repairs ≥ 3 → allocation is the lever: ship the rotation
as the serving default* — and that clause cannot be executed on an artefact that does not state the policy it
would be the default of. So this dispatch buys two things, in this order:

1. **a complete artefact** for the arm the rule wants to make the default;
2. **the bounded arm's own between-run spread**, which the lane has for the unbounded treatment (R141 against
   R143: 7.5pp apart) and has never had for a bounded one.

## What is held fixed, and what is drawn again

Held fixed: the split, the distillation population, the recurrence pass and its key, the support floor of 2, the
one-item pack, the 2,400-character budget, the model, one trial per task, `serveRotation: fair-share`, and the
cap's arithmetic. Drawn again: **the store**, which is a draw from whichever learn tasks the model fails in one
trial each, and therefore the servable count the cap is computed over.

That is the same relationship R141 has to R143, which is what makes the second column comparable: a second draw of
one treatment, read as a spread rather than as a repechage.

## Prediction

- **`serveRotation` is present in the artefact and internally consistent**: `mode: 'fair-share'`, `requests` equal
  to `recall.requests`, `renders = requests` when every pack is served, `maxRenders ≤ cap`. The first of these is
  what this dispatch exists for; the last three are the reading the block is worth having.
- **`cap` is 3–5 and `starved` is 0.** The cap follows the store, and R143's official fold kept 11 servable items
  where R152 kept 14; a store outside 8–14 servable would move the cap outside this band, and that would be a
  finding about the draw rather than about the bound.
- **`pass^4` in 0.85–0.975, and the delta again unresolved.** At 40 held-out tasks the design resolves 15–18pp. A
  point estimate is bought here only as a *second* point for the spread, and grading it as a claim would be the
  mistake §AUDIT 34.190 records.
- **The delta lands within ±7.5pp of +2.50pp** — the between-run spread the lane measured for the unbounded
  treatment. A larger move says the rotation's effect is not stable across stores, which is a different finding
  from "the arm is a wash", and the record should be able to tell them apart.
- **`breaks` ≤ 3 and `repairs` ≥ 2.** Not "breaks ≤ 2": the first draw hit the floor of the band and a replication
  is not a demand for the same count. A second draw above 3 breaks turns R152's 5.88% into a favourable draw.
- **`serveYield.opportunity` in 10–20% of renders.** The first draw read 15.0% against R143's 10.0%, and the
  quantity is a property of the corpus and the reference arm's pass rate more than of the rotation.

## Refutation

- **No `serveRotation` block again.** The projection did not reach this arm, which means the fix is in the wrong
  layer and the lane's next round is the instrument, not the mechanism.
- **`requests ≠ recall.requests`, or `maxRenders = 0` with `renders > 0`.** The reading is taken at the wrong
  moment again, and every number in the block is suspect — including the ones that look plausible.
- **`cap` outside 3–5, or `starved` > 0.** The store drew much thinner or much fatter than the two folds measured
  before it, so the fold is not comparable with R152's and the spread above is a spread across treatments.
- **`breaks` ≥ 5.** R152's 2 was the lucky tail of the same mechanism, and the mechanism's claim must be reduced
  to "the bound acts on concentration" without a harm claim.
- **`repairs` ≤ 1.** The renders the leader lost went nowhere: the bound spreads service and the spread is not
  where the repairs were, which makes R152's repair count the draw and the axis *selection* after all.
- **A delta more than 7.5pp from +2.50pp.** State the spread honestly and stop quoting either fold's point
  estimate: two draws that disagree by more than the lane's own noise floor are one distribution, not one effect.

## Decision rule, stated before the number

| outcome | what the next dollar buys |
| --- | --- |
| block present and consistent, breaks ≤ 3, repairs ≥ 2 | the rotation becomes the serving default in the template, and the next registration is the lexical anchor measured **on top of** it |
| block present, breaks ≥ 5 | the default stands as a concentration control with no harm claim, and the outcome counter (R129) becomes the arm |
| block present, repairs ≤ 1 | the axis is selection, not allocation: withdraw the harm claim and register a ranking instrument |
| block absent again | nothing else is bought until the projection is fixed at the type, and the round is an instrument round at $0 |

## Cost

**$0.3717**, which is R152's measured bill for the same configuration (learn 0.1883, memory 0.0918, reference
0.0916) rather than the registration's earlier estimate. One dispatch. Off-peak with no `not_before`: the
registration is opened at 19:40 UTC and the job needs 63 minutes.
