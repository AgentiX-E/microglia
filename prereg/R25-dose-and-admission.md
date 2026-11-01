---
id: R25-dose-and-admission
step: R25
opened: 2026-11-01
arms: full-one,full-accepted
sample: 1534
gates: V1,V2,V3,V4,V5,V6,V7,V8,V12,V32,V44,V48,V49,V50
---

# R25 — one note, or two

## Why this file exists

R24 closed the substitution line and demoted the competition mechanism, and it left one number on the table
that nothing has ever explained. Its artefact carries a per-question record, and read at that granularity the
pack is not one treatment at all:

| dose the question received | questions | gained | lost | delta |
|---|---|---|---|---|
| one item | 343 | 20 | 11 | **+2.62pp** |
| two items | 1,191 | 44 | 62 | **−1.51pp** |

That is a **4.13pp** difference between two groups of 1,534 questions, and it is the largest non-null quantity
any pack arm has produced in twenty-three iterations. It is also not yet causal: the store offered a second
item on exactly the questions it had more to say about, so the two groups are different questions rather than
one question under two budgets. Truncating every pack to its first item is the causal version, and it changes
**77.6%** of the split.

W8 left the same question open from the other direction — *"the next item is the dose curve measured
properly — three pack sizes, one store, enough power to find where it crosses zero"* — and R16 could not
answer it because minidev's 350 questions put every point on the curve inside its own floor.

R25 also has to answer the question it was registered for, which R24's outcome changed rather than removed.
The substitution design is withdrawn because the competition it was meant to win does not reproduce; what
survives is *selection*, and the pre-registration's question is whether a decision made per question beats an
order that is the same for everyone.

## The design

Four arms, one store, one split, one dispatch:

| arm | items per question | what it is |
|---|---|---|
| `none` | 0 | the anchor, and the floor every claim clears |
| `full-one` | **1** | the pack `full` would have carried, truncated to its first item |
| `full` | 1.78 mean | the shipped product, and R24's −0.59pp cell |
| `full-accepted` | 1 or 0 | one slot, filled only where the question's own note clears a fitted floor |

`SOTA_SPLIT=dev` (1,534 questions, 5 folds) and `SOTA_LEARN_SAMPLE=280`, exactly as R24 ran, so the store size
and the split are held and the budget is the only difference. `full-one` is built from the pack `full` carries
rather than recalled again, so the two prompts differ in the number of items in the block and nothing else.

**The floor.** `full-accepted` fits one threshold per fold on the fold's *learning* rows, before a single
held-out question is scored: the note's coverage of the question, against the counterfactual verdict that row
produced during the learning pass. It maximises `helped − harmed` over the rows at or above each candidate
threshold, subject to keeping at least **half** the population, and returns the lowest threshold among ties.
Per-item credit — the statistic every previous selection arm used — is not the statistic here, because it is
empty for 77% of a store distilled from 280 corrections and would have made the arm `full-one` under a second
name. `SOTA_VALIDATION_CREDIT=counterfactual`; the absolute reading is answered by the question's difficulty
(iteration 76) and would fit a floor on difficulty.

## What the design can resolve, computed before the run

R24 measured this lane at **±2.14pp** on 1,534 paired questions. The dose gap is 4.13pp, so the truncation
contrast is inside the instrument by a factor of two. Two ceilings bound what any admission rule could be
worth, both read from R24's artefact with no new calls: an oracle that drops the 69 items with a net-harmful
eval-side record reaches **59.78%** (**+2.35pp** over `none`), and an oracle that keeps the pack exactly where
it helped reaches **61.60%** (**+4.17pp**). Those are upper bounds with the answer key in hand, which is why
the confirmatory bar below is the 2pp the line has never reached rather than either ceiling.

## Prediction

- **`full-one` − `full` ≥ +2pp, with an interval excluding zero.** The causal reading of the 4.13pp
  observational gap, discounted to the half the design can detect. This is the confirmatory claim.
- **`full-one` − `none` ≥ +2pp.** One note, on its own, is worth something. If this fails while the claim
  above holds, the finding is that the second note is a cost and the first is nothing — a product change
  without a mechanism.
- **`full-accepted` − `full-one` is within ±2pp.** The pre-registration's own question, predicted null:
  content-based pruning has equalled random pruning on this store wherever it has been measured (W8,
  `full-grounded` against `full-sampled`, p = 1.0), and a coverage floor is a pruning rule applied to
  questions rather than to items.
- **`full` − `none` is within ±2pp of zero.** R24 read −0.59pp; the anchor is expected to hold.
- **`V49-dose-truncated` passes**: no prompt of `full-one` carries more than one item, and its pack differs
  from `full`'s on at least a fifth of the questions — the observational number says 77.6%.
- **`V50-admission-engaged` passes**: every fold fits a floor from decisive learning rows, and the arm both
  admits and refuses. The expected admitted share is between 50% and 90%.

## Refutation

- **If `V49-dose-truncated` fails, nothing in this file is read.** A truncation that did not truncate leaves
  two arms carrying the same pack, and a difference of zero between them would be a fact about the code
  rather than about the budget.
- **If `full-one` − `full` and `full-one` − `none` both have intervals containing zero, the pack line is
  closed at every budget.** The dose curve would then be flat at zero from one item to two, on the only split
  with the power to see it, and the honest record is that the mechanism is inert rather than mis-sized. The
  product decision that follows is not a smaller pack; it is no pack before the question.
- **If `full-one` − `full` ≤ −2pp, the second note pays.** The observational −1.51pp for two-item questions
  was then a selection effect pointing the other way, the store gives its second item to the questions that
  need it, and the next design is a floor on *minimum* dose rather than on maximum.
- **If `full-accepted` − `full-one` ≥ +2pp, per-question admission works and it is the first positive result
  in this line.** The floor, its fitted value and the admitted share become the product's retrieval policy,
  and the claim to replicate is a coverage threshold rather than a mechanism.
- **If `full-accepted` − `full-one` ≤ −2pp, coverage is anti-correlated with usefulness** — the note helps
  where it is least about the question — and the retrieval score is ruled out as an admission signal rather
  than merely unhelpful.
- **If `V50-admission-engaged` fails, `full-accepted`'s contrast is not read and `full-one` against `full` is
  read alone.** A floor that kept the whole population, refused the whole population, or was fitted on no
  decisive rows makes the arm its own control, and reporting its delta as a null about admission would be the
  fourth time this record published "no effect" about a treatment that never happened.
- **If fewer than five folds complete, the artefact is read as a partial run and no confirmatory claim is
  made**, because a split that changed mid-run is not a split.

## Cost

Four arms on 1,534 questions is 6,136 calls; the counterfactual learning pass is 2,800 more (2 per learning
row, 280 rows, 5 folds), and it is the pass `full-cleared` already pays for. The dispatch is expected to run
inside R24's 32 minutes plus that pass.
