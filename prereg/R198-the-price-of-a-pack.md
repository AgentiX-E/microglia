---
id: R198-the-price-of-a-pack
step: R198
opened: 2026-11-23
# R197 was cancelled because the lane could report accuracy a third time and still no price: bin/l4.ts wrote
# `calls: 0` as a literal, and R198's first step replaced it with a reader that distinguishes census from count
# from silence. That reader is merged and gated, so this is the dispatch the registration was waiting for: the
# same two arms as R152c, same split, same caps, bought once with the price column switched on. The accuracy
# delta is a by-product — the fold's half-width is ±9 to ±11 points, so a sixth draw of this size cannot move the
# pooled −4.38 pp — and the registered readings are the bill and the delivery census.
arms: both
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

# R198 — the price of a pack, on the fold whose configuration is already published

**Registered** 2026-11-23, after R200 read five folds into one ledger and before this arm runs. Same treatment as
R152c, same split, same one-item pack, same cap arithmetic, same rotation. The only thing that changes is the
reader: the arm and the pair now carry a bill.

## What the five committed folds say, and what none of them can

R200's ledger closes `inert = served − repaired − broke` on all five folds and reports **78.1% [72.6, 82.8]** of
251 served packs inert. It also reports the price column **unpriced for all five**, with the reason printed: no
committed pair artefact carries a bill, because every fold predates R198's reader.

So the lane can say what the pack *did* and cannot say what it *cost*. That is the one axis every competitor row on
the board reports and this lane does not, and it is the axis R201's gate will be judged on — a gate that withholds
inert packs is a cost claim, and a cost claim without a price is a sentence.

## Prediction

- **Both arms report `bill: census` with a positive `calls` and a positive `promptTokens`, and the pair artefact
  carries both.** This is about the instrument, not the arm, and it is the reason the round exists: a pair that
  reports a delta and a `count` would be R198 unfixed, and the column would stay empty with a green job.
- **The memory arm's injected prompt tokens land between 100 and 900 an episode.** The pack is one item inside a
  2,400-character budget, the measured packs have been 551 characters, and the recall scaffolding adds its own
  request; a number outside that band means the bill is measuring something other than the pack.
- **The inert share lands between 70% and 88%**, which is where all five committed folds are. A sixth fold outside
  that band is a finding about the split rather than about the pack, and it refutes R200's replication claim before
  it refutes this arm.
- **The delta is unresolved and inside ±11 pp of zero.** At 40 held-out tasks this design resolves 15–18 pp; the
  prediction is stated so that a *resolved* delta would be read as a surprise, and the fold is pooled rather than
  quoted alone.
- **`breaks` and `repairs` are both non-zero, and the ledger closes without a refusal.** A fold where nothing broke
  and nothing repaired would be a store the pack never reached — that is a finding about admission, and it would be
  reported as one rather than as a null result.

## Refutation

- **If either arm reports `bill` other than `census`, the price claim is refuted, not reinterpreted.** The dispatch
  is the first one carrying the reader; a `count` here means the reader does not reach the arm, and the next round
  is a repair rather than another run.
- **If the memory arm bills no more prompt tokens than its own control, the pair is refused.** Two arms of one
  dispatch cannot serve the same request for different amounts and produce a negative injection; that outcome says
  the arms are not one dispatch, and the alternative explanations — a shared store, a replayed cache — are exactly
  what the bill exists to make visible.
- **If the inert share falls outside [55%, 95%], R200's replication claim is abandoned.** The claim is that
  inertness is the stable quantity across folds; a fold at 40% or 97% would make it a property of the split.
- **If the run produces no pair artefact, the round bought nothing and is recorded as such.** R152b is the
  precedent: a green job that measured an arm without its control.
