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

## Outcome

Dispatch `41256898122`, artefact **`eval/results/poc-sota-bird-dev-R25-dose-and-admission.json`**: 1,534
questions, 5 folds, **9,096 calls**, 0 call failures, 0 timeouts, **33 minutes**, **14 gates pass** — including
both registered ones, `V49-dose-truncated` at 1,133 of 1,534 questions changed (73.9%) with no prompt over one
item, and `V50-admission-engaged` at 1,027 of 1,534 questions admitted (66.9%) with all five folds fitted from
decisive learning rows. `V48` read 18 of 12,774 statements at the deadline (0.14%) and 172 truncated (1.35%).
`V17` was not needed: `V44-domain-accounted` read 165 unscoped items, all of them arrived that way, none
widened.

| arm | items/question | accuracy | n |
|---|---|---|---|
| `none` | 0 | **57.17%** | 877/1534 |
| `full-one` | **1.00** | 56.78% | 871/1534 |
| `full` | 1.74 | 57.11% | 876/1534 |
| `full-accepted` | **0.67** | **57.63%** | 884/1534 |

| contrast | pp | 95% CI | discordant | p |
|---|---|---|---|---|
| `full-one` − `full` | **−0.33** | [−1.56, +0.85] | 42/47 | 0.6718 |
| `full-one` − `none` | −0.39 | [−1.76, +0.91] | 52/58 | 0.6338 |
| `full` − `none` | −0.07 | [−1.50, +1.30] | 60/61 | 1.0000 |
| `full-accepted` − `full-one` | **+0.85** | [−0.13, +1.83] | 35/22 | 0.1112 |
| `full-accepted` − `none` | +0.46 | [−0.78, +1.69] | 52/45 | 0.5426 |
| `full-accepted` − `full` | +0.52 | [−0.85, +1.83] | 58/50 | 0.5008 |

### The two refutations that were the point of the run

**The 4.13pp dose gap was selection, and truncating everyone to one item costs nothing.** `full-one − full` is
**−0.33pp [−1.56, +0.85]**. The observational reading was 4.13pp in R24's store and 3.12pp in this one
(dose-1 questions **+2.24pp** on 401, dose-2 **−0.88pp** on 1,133), and it does not survive being made causal.
The store gave its second item to the questions it had more to say about, and those were the questions where a
note of either length was worth more. **Prediction 1 is refuted and prediction 2 with it**: one note on its own
is −0.39pp.

**Per-question admission is the only arm in twenty-four iterations to point up, and it does not get there.**
`full-accepted − full-one` is **+0.85pp [−0.13, +1.83], p = 0.1112, 35 gained against 22 lost**. That is the
largest positive point estimate any pack arm has produced and the tightest interval against loss — the lower
bound excludes any harm larger than a tenth of a point — and it still does not exclude zero, which is what
prediction 3 said would happen. The decision it encodes is real and visible in the artefact: 507 questions were
refused the note, and those questions moved **4 gained and 3 lost against `none` on a byte-identical prompt** —
the endpoint's own test–retest floor, measured inside this run for free, at 1.4% of 507 and matching the
1.4–2.6% band the `none-replica` arms established.

### The registered refutation clause fired

The clause reads: *"If `full-one` − `full` and `full-one` − `none` both have intervals containing zero, the pack
line is closed at every budget … the honest record is that the mechanism is inert rather than mis-sized."* Both
intervals contain zero, and by a wide margin. **The pack line is closed.** The product decision that follows is
not a smaller pack: it is no pack before the question, which is what iteration 90 already shipped on weaker
evidence and what this run now puts a dev-scale interval around.

### Why nothing further can be measured here

`V5-resolution` reads a minimum detectable effect of **2.01pp** on this split, and the two ceilings read from
R24's artefact with the answer key in hand are **+2.35pp** for dropping every net-harmful item and **+4.17pp**
for keeping the pack exactly where it helped. Every arm in this run lands inside **±1pp**. An effect that a
perfect oracle prices at 2.35pp cannot be resolved by an instrument that needs 2.01pp to see anything, and the
benchmark has no more dev questions to buy resolution with. **The line has reached the limit of what BIRD dev
can measure**, and that is a statement about the instrument rather than about the mechanism.

### What held

`full − none` at **−0.07pp [−1.50, +1.30]** reproduces R24's −0.59pp inside one interval: the anchor is stable
across two stores built from different learning passes. `V49` and `V50` both passed on their first run, the
admission floor landing between 0.111 and 0.200 across five folds while keeping 51–84% of each fold's
decisive-bearing learning rows. Per fold, `full-accepted − full-one` ran **−0.33, +3.26, −1.30, +0.98, +1.63**;
`full-one − full` ran **0.00, −1.30, +1.30, −1.63, 0.00**. The admission effect is concentrated where the note
is on the question — `moderate` **+2.16pp** (13/3), `simple` **+0.65pp**, `challenging` **−2.07pp** (0/3) — which
is a shape, not a result, at 145 challenging questions.

### Reproducibility

`pnpm check` green: 2,044 tests, 107 files, 99.98 / 99.61 / 100 / 99.98; `dose.ts` and `arm-contrast.ts` at 100
on all four dimensions. The registered cross-arm contrast is computed by `pnpm eval:arm-contrast` and committed
at `eval/results/poc-arm-contrast.json`, so the number is re-derivable from a file in the repository.
