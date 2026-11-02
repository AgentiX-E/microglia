---
id: R41-cross-domain
step: R41
opened: 2026-11-02
arms: memory,reference
sample: 200
gates: V1,V2,V3,V5,V6,V7,V8,V15,V16,V17,V32,V33,V44
---

# R41 — the transfer gates, on a scenario they were not written for

**Registered** 2026-11-02, before the dispatch that measures it. **Stage**: R29 stage 2, the arm that
`ROADMAP` R29 deferred until the instrument existed (`AUDIT` §34.8, `PROGRESS` §152).

## What this round is, and what it is not

R29 stage 1 made the τ² driver record what the protocol's gates read. It fired nine gates on paper
and four on a run, and the seven that stayed dark included the four the round exists for: `V15`,
`V16`, `V17` and `V33` — the transfer family, which on BIRD asks whether a rule that repaired its own
case repairs any other.

Stage 2 runs the arm that family needs on τ²: **learn from τ²-retail, answer τ²-airline**. The
treatment is the store, recalled under the scenario it learned in and served to questions from a
scenario it never saw. The control is the same episodes with no store. This is not a new benchmark
and not a new model family; it is one dispatch through the lane that already exists.

The two conditions the protocol cannot state are stated here with it, because they belong to this
pair rather than to the instrument: `l4-paired` asks whether the treatment cost accuracy at p < 0.05,
and `l4-same-split` asks whether both arms scored exactly the same tasks. Neither is a `V` code, so
neither appears in the header; both block, and both are reported by the pairing step.

What it is *not*: a SOTA attempt. §138's claim is about the apparatus, and the round's job is to put
the accounting gates in front of a second scenario. If the effect is a null — and the registration
predicts one — the round has still bought the thing it was registered for.

## The claim under test

> The protocol's transfer machinery is a property of the apparatus rather than of BIRD: on a second
> scenario it reconciles, it counts its pairs, and it refuses a rate its own counts cannot support.

## Prediction

- **Three of the four transfer gates pass on a cross-domain τ² arm.** `V15` reconciles every episode
  into informative, already-correct, or unmeasured; `V33` carries one ledger row per episode; `V17`
  re-derives its net from its own repair and break counts.
- **`V16` fails, and this is a prediction rather than a hope.** A hundred informative episodes is a
  floor, and informative means the control arm *failed*; a foreign pack on a capped airline slice
  will not produce a hundred of them. A pass would mean the floor was being cleared by episodes that
  were not informative.
- **The net marginal effect is a null, at or below +5pp**, and the sign is not predicted. §136
  measured the mechanism's best reading at +1.17pp on the terrain most favourable to it; a foreign
  scenario is strictly harder, and anything above +5pp is more likely to be a leak in the split than
  a transfer.
- **The audit's index moves exactly four places**: supplyable 9 → 13, arm-indexed 30 → 26, and the
  fired set gains `V15`, `V16`, `V17`, `V33` with nothing else added or removed.
- **Every evaluated episode is paired.** The reference arm's episodes reach the ledger as the control
  half, so the treatment arm contributes no orphan and the ledger's length is the pair's length.
- **If the foreign pack serves nothing**, `V1` fails and the round reports the mechanism rather than
  the effect: an empty pack is a measurement of recall across a scenario boundary, and the run must
  not present it as "memory did not help".

## Refutation

- **If `V15`, `V33` or `V17` fails**, the transfer family cannot be graded on a second scenario, and
  §138's claim narrows a second time — to *"the shape gates are portable and the accounting gates
  are not"* — in the protocol's own documentation rather than in a private note.
- **If the fired set gains a gate outside the four**, the projection is reading a field nobody wrote
  and the index is wrong; the round reverts the projection rather than the report.
- **If the net effect exceeds +5pp**, the split is audited before the finding is published. A
  cross-domain arm cannot leak by construction — the store never saw an airline task — so a large
  positive effect would mean the two arms are not the same task set, which `l4-same-split` checks.
- **If either arm writes no `per_trial` rows**, the pair has no episodes to reconcile and the round
  reports the lanes as unmeasured; it does not fall back to a task-level proxy and call it a ledger.
- **If four-dimension coverage falls below 95%, or either new module is not at 100**, the round does
  not ship: the arithmetic this registration turns on is the arithmetic those modules perform.

## What would make this round worthless

A transfer reading computed from a rate that had no pairs, which is the defect `V33` was written
after: a rate was once published without the pairs behind it because the ledger lived in a record the
artefact never serialised. The mitigation here is structural — the ledger is built from the same
`per_trial` rows the counts are built from, and `V33` compares the artefact's row count to the trial
count, so a reader can recompute every number from the file.

The second risk is that the treatment is weaker than BIRD's: one store rather than one rule, so
`repaired > 0` says the pack fixed an episode and says nothing about which item did. The artefact
states this in its notes rather than leaving a reader to infer a per-rule claim from a per-pack
number.

## Cost

One τ² dispatch through `sota.yml`, both arms, one scenario pair, the airline task set at four
trials against a thirty-two-task retail learn half. No new dataset, no new model family, no change
to the merge gate.
