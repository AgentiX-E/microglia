---
id: R14-substrate-pair
step: R14
opened: 2026-10-31
arms: none,full,full-verified,full-repair-verified
sample: 350
gates: V1,V13,V14,V34,V35,V36,V37,V38
---

# R14 — is the substrate the defect, or is the delivery?

## Why this file exists

R13 measured one substrate and wrote the claim that the next iteration has to test:

> a sentence about a correction loses the query pair that made the correction mechanical.

That claim is currently an *interpretation* of two numbers, not a measurement of two substrates. The
store built from single-sentence rules reproduced 19.9% of its own corrections, repaired 7.3% of the
foreign questions that needed help and broke 50.0% of those that did not. Every one of those numbers
describes the *sentence* substrate. The project has never put another substrate beside it under the
same instrument, and until it does, "the extraction is the wrong shape" is an inference from one
column of a table.

The alternative already exists in the codebase and has never been probed. The `repair` distiller
renders the pair — the question, the attempt, the correction a reviewer saved, and the observed
failure — into a three-sentence account: what the attempt did, why that returns a different answer,
what the correction does instead. It is the form ExpeL (arXiv 2308.10144) and ReasoningBank (arXiv
2509.25140) report their gains under, and the form this project measured at the *arm* level three
times (iteration 84: −5.14pp, p = 0.0021; iteration 88: −4.86pp, p = 0.0137; iteration 90: −5.71pp,
p = 0.0012) — always as a whole pack, never as a store asked to reproduce its own corrections.

So the two readings that exist are not commensurable: rules have a reproduction rate and repairs have
an accuracy delta. This iteration gives repairs the same rate, on the same questions, with the same
control.

## The design, and the one thing that makes it a comparison

1. **Same corrections.** Both stores are distilled from the same `learn` rows of the same fold, from
   the same cached generations, so the only difference between them is the instruction that asks for
   a rule and the instruction that asks for a repair.
2. **Same probe.** Both are asked to reproduce the correction they were distilled from, with the same
   pack budget (1,200 characters) and the same judge. A repair statement is longer than a rule
   statement, so the *item count* per pack differs; the *character budget* does not. The controlled
   quantity is the text in front of the question, because that is what W8 measured as the dose
   (≈1.7pp per rule injected).
3. **Shared control.** The blank retry prompt is built from the question, the attempt and the observed
   failure — none of which depend on the store — so the two probes share one control per source
   question instead of paying for it twice. This is not only cheaper: 16.4% of questions return a
   different query under the same prompt, so a second control would put the endpoint's own sampling
   noise inside the difference the pairing exists to isolate. A hole is carried as a hole and not
   re-asked.
4. **Paired, not two rates.** The comparison is McNemar's exact test over the questions both stores
   covered. Two independent rates of 20% against 26% at n≈300 would each carry an interval wide
   enough to overlap; on the same questions the test uses only the discordant pairs.
5. **Coverage is reported, not absorbed.** The two stores do not hold a rule for exactly the same set
   of corrections. The intersection is the paired set; the exclusive questions on each side are
   counted and gated (V36). A comparison that silently intersected them would report a rate over a
   subset chosen by the store.
6. **Both gates apply to the second substrate.** `full-repair-verified` injects only the repairs that
   reproduced their own correction and broke none — R12's admission rule, unchanged. V37 reconciles
   its buckets and V38 asks whether its gate changed any held-out pack.

## Prediction

- **The repair store reproduces more of its own corrections: Δ ≥ +10pp, p < 0.05.** A rule states
  what is true about a workspace; a repair states what one query did, why that was wrong, and what
  replaced it. The mechanism is in the second and absent from the first, and this is the hypothesis
  R13's conclusion rests on. 296 corrected cases are expected to be paired, which resolves a 10pp
  difference at p < 0.001 by McNemar.
- **`broke` is not lower under repair.** A longer account is more to follow, and W8 measured the harm
  as a function of how much guidance is in front of the question. If the repair store's break rate
  falls as well as its reproduction rate rising, the form is unambiguously better; if it rises, the
  substrate fixes the extraction and the delivery is still the constraint.
- **`full-repair-verified` stays within ±3pp of `none`.** Both gated arms remove most of the harm;
  neither has enough admitted rules to move a 350-question cell by a resolvable amount. A cell outside
  ±3pp is a finding about the store, not about the arm.
- **The store loses its home database for 8–20% of items.** R13: 20 of 118 admitted rules had no
  `scope.domain` and could not be pointed at any foreign question. The repair form asks for the domain
  explicitly, so the same omission rate is expected. The number is now reported as the ceiling on
  transfer rather than rediscovered by the next iteration.
- **Instrument.** V34 reconciles every shared question into a cell or a hole and the two rates with
  the cells; V37 reconciles every repair-store rule into one of its four admission buckets; V35 is
  satisfied (≥100 paired questions) or the delta is reported as a direction.

## Refutation

- **Δ ≤ 0pp with ≥100 paired questions.** Then the pair-rendering substrate is *not* the improvement
  R13 named, the sentence is not what loses the mechanism, and the defect is downstream: retrieval,
  dosage, or the fact that the model does not act on either form. The next iteration is the dose
  curve (three pack sizes, one store) rather than a third substrate, because two substrates at the
  same rate makes the substrate a weak explanation.
- **Δ ≥ +10pp but the break rate also rises by ≥10pp.** The substrate fixes the extraction and not
  the harm. Then the finding is that reproduction and damage come from the same property — how much
  the model is told — and the answer is filtering by dosage rather than by content.
- **Paired < 100.** Instrument failure. No claim about the substrate is made, the comparison is
  reported as `floor`, and the cause (coverage, holes, or a store with too few items) is diagnosed
  before anything else is dispatched.
- **`full-repair-verified` changes no held-out pack (V38).** The gate admitted nothing, so the arm is
  `none` under a second name and its accuracy is not evidence about the form.

## What a positive result would license, and what it would not

A +10pp or larger reproduction difference would license one product sentence — *a repair
out-reproduces a rule as a memory form, and the store's own cases can tell the difference* — and one
dispatch: the dev split with the repair form as the default distiller, `learn_sample` raised, no new
construction.

It would not license a SOTA claim, and it would not by itself license dropping the rule form. A
substrate that reproduces its own corrections better is still a substrate whose *transfer* rate has to
be measured: R13 put the sentence at 7.3% repair against 50% damage, and nothing in this design says
whether the pair does better on questions the store was not written from. That measurement is the one
that follows, and it needs this one to be positive to be worth buying.

## Outcome

Dispatch `41165067200`, artefact `eval/results/poc-sota-bird-substrate.json`: 350 questions, 5 folds,
2,490 calls, 1 retry, 0 timeouts, 0 call failures. Every gate passes, including the four this
iteration added.

| Reading | Value | Predicted | |
|---|---|---|---|
| paired source questions | 303 of 303 shared, 0 holes, 0 exclusive | V35 satisfied | ✅ |
| rule substrate, reproduced | **30.69%** (93 of 303) | — | — |
| repair substrate, reproduced | **53.80%** (163 of 303) | — | — |
| paired delta | **+23.10pp**, p = 1.05e-14, verdict `right` | ≥ +10pp, p < 0.05 | ✅ |
| discordant pairs | 10 to the rule, 80 to the repair | — | — |
| `broke` | 11 rule, 10 repair | not lower under repair | ✅ (by one case) |
| admission | 118 of 590 (20.0%) rule, 128 of 303 (42.2%) repair | — | — |
| rules that broke their own source | 22 (3.7%) rule, 10 (3.3%) repair | — | — |
| items without a home database | 96 of 590 (16.3%) rule, 32 of 303 (10.6%) repair | 8–20% | ✅ |
| `full-repair-verified` | 52.86% vs 53.14% — −0.29pp, 0.31 items/question | \|Δ\| ≤ 3pp | ✅ |

Five folds, five positive deltas: +23.08, +22.95, +22.03, +28.81, +18.64pp, each p < 0.01 on its own.

**The prediction held and the product did not move.** The account reproduces nearly twice as much of
what it was learned from, and the gated arm built from it answers one question differently out of 350.
That is not a contradiction — it is the separation this iteration was designed to make: reproduction
is a property of the extraction, and the arm's cell is a property of what the extraction is worth on
questions the store was not written from. The refutation clause for Δ ≤ 0pp did not fire; the sentence
that follows from a +23pp reading, *the substrate is the constraint*, does not survive the arm.

**What this changes about R13's conclusion.** R13 wrote that a sentence about a correction loses the
query pair, and R14 confirms that at the level the claim was made — a pair-rendered account
reproduces 23pp more of its own cases. R13's *product* reading (7.3% repair against 50% damage) was
not retested here and remains the number that matters for deployment. The next measurement is the
repair substrate's transfer, because extraction is now the one explanation this iteration removes.
