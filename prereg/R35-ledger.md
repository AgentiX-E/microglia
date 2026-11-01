---
id: R35-ledger
step: R35
opened: 2026-11-02
arms: none
sample: 7000
gates: V59,V60,V61
---

# R35 — does the store have per-item value?

## Why this file exists

Four routes are closed by measurement. The item's content does not decide the sign (§145), its quantity
does not (§146, R16), the read-time filter realises a sixth of its own ceiling and does not pay
(§147–§148), and the population cannot be reselected because the only signal that predicts failure also
predicts instability (§149). Each of those treated the pack as a unit: a prompt of two rules, shown or
not shown.

The store has never been the variable. Every round has asked *how* to use the same 203 rules; none has
asked whether the rules are worth different amounts. That question has an obvious operational form —
**prune**: keep the rules that repair, drop the rules that break — and pruning is the only store-side
intervention that can be evaluated against data this project already paid for, because it needs no new
generation if the per-rule ledger is stable.

Pruning has a presupposition, and it is the thing this file tests: **that a rule has a net value, that
the value is a property of the rule, and that it transfers from the questions where it was seen to the
questions where it will be shown.** If a rule repairs on the databases where it was observed and breaks
on the ones it was not, there is no per-item value to prune on, and the store route is not reachable by
post-hoc editing — it needs a different unit of memory, which is a different programme.

## The corpus, counted

Everything below is a column in `poc-sota-bird-train.json`, the 7,000-question out-of-sample artefact
§146 paid for. No model call is made in this round.

| quantity | value |
|---|---|
| questions | 7,000 over 58 databases |
| rules that reached a prompt | 203 |
| injections (rule × question) | 13,578 |
| questions repaired / broken | 187 / 237 |
| injections named on a repaired question | 349 |
| injections named on a broken question | 462 |
| mean injections per rule | 66.9 |

The counts differ because attribution is not exclusive: a pack holds two rules and a flip is credited to
both. That is the instrument's oldest limitation (`store-report.ts` states it) and it is why the unit is
written down again here: **the ledger's unit is the injection, and a question with a two-rule pack
contributes two of them.**

## What is being tested, exactly

1. **Is there any heterogeneity at all?** A χ² dispersion statistic over the per-rule repair counts,
   against a null that preserves the pack structure: permute the case-level outcome labels across
   questions, so every rule keeps exactly the questions it was shown on and only the outcomes move.
   This null is the right one because packs of two make rules within a pack positively correlated;
   a vanilla binomial null would call that structure heterogeneity.
2. **Does it replicate?** Split the 58 databases 29/29 by a stable hash, estimate each rule's net rate
   on one half, and correlate against the other. If a rule's value is a property of the rule, the two
   estimates agree; if it is a property of the rule's *pairing* with a database, they do not.
3. **Does a screening rule work out of sample?** Flag every rule whose discovery-half net is negative
   and which was shown at least ten times, then measure on the confirmation half whether questions
   carrying a flagged rule did worse than questions that did not. This is the only form of the question
   that is actionable, and it is testable with real outcomes rather than a counterfactual.
4. **What would it take to be usable?** The split-half correlation *is* the reliability of a half-length
   ledger; Spearman–Brown turns it into the reliability of the full one, and the answer says how many
   injections per rule would be needed for the ledger to be worth acting on.

## Prediction

Six predictions, all of them falsifiable on a corpus that exists.

- **P1 — instrument.** 203 rules, 13,578 injections, 424 flips; both halves hold ≥ 25 databases and
  ≥ 100 rules seen at least five times each. A split that leaves either half without rules cannot
  answer anything, and this is checked before any other number is read.
- **P2 — heterogeneity exists, but only just.** The dispersion statistic exceeds the 99th percentile of
  its structure-preserving permutation null, at p < 0.01. The prediction is deliberately weak: 424
  flips over 203 rules is 2.1 flips per rule, and a corpus this thin should struggle to show that rules
  differ at all.
- **P3 — it does not replicate.** The split-half correlation of per-rule net rate is at most **0.2**,
  and the sign of a rule's net agrees across halves no more than **60%** of the time. This is the
  prediction the file is worth writing for: if it holds, a rule's measured value is not a property that
  travels, and pruning is a coin.
- **P4 — the ledger is not reliable enough to prune on.** Spearman–Brown on P3's correlation gives a
  full-length reliability at or below **0.3**. Anything below roughly 0.7 means the estimate is mostly
  noise, and a prune on noise removes rules at random.
- **P5 — the screening rule does not discriminate.** On the confirmation half, the net gain of questions
  carrying a flagged rule is not distinguishable from the net gain of questions that do not, on a
  database-clustered interval. If it *is* distinguishable, P3/P4 are wrong in the way that matters and
  the store route is open.
- **P6 — the power statement is the finding.** Reaching a reliability of 0.8 at the observed flip rate
  needs at least **ten times** the present injections per rule, i.e. ≥ 670 questions per rule and
  ≥ 130,000 injections overall. A number that large is not a request for more data; it says the unit is
  wrong.

## A seventh question this file did not set out to ask

While counting the corpus for P1, one structural variable turned out to vary: the pack is not always two
rules. 423 questions carry a single rule, and they behave differently:

| pack | questions | repair rate | break rate | net |
|---|---|---|---|---|
| one rule | 423 | 12.50% (25/200) | 5.38% (12/223) | **+3.07pp** |
| two rules | 6,576 | 5.94% (162/2,725) | 5.84% (225/3,851) | −0.96pp |

The difference is **+4.03pp on a database-clustered interval of [+0.87, +6.52]**, which excludes zero.
Pack size is not assigned — retrieval returns what it returns — so this is a comparison of questions that
retrieval happened to serve one rule and questions it served two, and the confound is real: the singleton
questions are harder (47.3% unanswerable by the bare model, against 41.4%).

- **P7 — the lead is corpus-dependent, and it does not license a decision.** The same contrast, computed
  on every other committed artefact, is **negative in twelve of the seventeen** — every 350-question
  pilot reverses it, and the five that show it positively are the five with more than a thousand
  questions. A contrast whose sign tracks the corpus is a corpus effect until an arm says otherwise,
  and this file records it as a lead for R36 rather than as a finding.

## Refutation

- **P3/P4 refuted (correlation above 0.5, reliability above 0.7).** Rules have usable per-item value and
  the store can be pruned. Then R36 is a pruning arm: drop the flagged rules, keep the rest, and the
  predicted gain is the flagged group's confirmation net. The store route reopens with a number.
- **P5 refuted (the screening rule discriminates).** Same conclusion by a shorter route: the value does
  not have to replicate *quantitatively* if a coarse flag carries signal, and pruning on the flag is
  worth an arm even when the correlation is weak.
- **P2 refuted (no heterogeneity at all).** Every rule is exchangeable with every other, the store is a
  bag of interchangeable prompts, and the content route is closed at the item level *and* the rule level
  — a stronger negative than P3's, because it says there is nothing to find rather than that we cannot
  find it.
- **P7 refuted (the pack-size contrast holds across the family).** Then the variable is not what the
  store says but how many items the prompt carries, R36's one-rule arm becomes the critical path, and
  the programme has its first positive lead.

## What a positive result licenses, and what it does not

Nothing here changes the product claim. The corpus-level exchange is 0.789 against a hurdle of 1.393
(§149); no rearrangement of which rules are in the pack can move the fact that the store repairs 6.39%
and breaks 5.82% unless the rearrangement changes *which questions flip*, and this instrument cannot
observe a counterfactual flip. A positive P5 licenses one arm. A negative P5 licenses the sentence
**"the store's items have no transferable value"**, which is the last item on the product list that
could have been answered without new generation.

## Disclosure

This file was written after an exploratory pass over corpus aggregates, and the pass is listed because
it is the difference between a prediction and a fit: pack-size distribution and per-size flip rates
(which produced P7's table), home-database versus foreign-database flip rates (which produced nothing
and is not registered), the dispersion statistic and one split-half correlation computed with one
particular hash split (`AUDIT` §33.1 records the cost). P2, P3 and P7 are therefore **replications**,
not blind predictions. P1, P4, P5 and P6 were not computed before this file existed, and the screening
rule's out-of-sample behaviour is the round's only genuinely blind test.

## Outcome

Seven predictions, seven held, and the two that matter were both negative.

| | claim | observed | |
|---|---|---|---|
| P1 | instrument | 203 rules, 13,578 injections, 29 databases per half, 135 rules seen five times in each | ✓ |
| P2 | heterogeneity exists | χ² **293.3** against a permutation null of **209.6** (99th percentile 280.4), **p = 0.0047** | ✓ |
| P3 | it does not replicate | r = **−0.134** [−0.296, +0.036] over 135 rules; sign agreement **49.1%** over 53 | ✓ |
| P4 | not reliable enough to prune | Spearman–Brown **−0.309** | ✓ |
| P5 | a coarse flag does not discriminate | 58 rules, 2,545 questions, **−0.55pp** against **−0.49pp**, difference −0.06pp [−1.97, +1.56] | ✓ |
| P6 | a usable ledger is out of reach | **670** injections per rule, ten times the measured 66.9 | ✓ |
| P7 | the pack-size lead is corpus-dependent | +4.03pp [+0.76, +6.62] here; **5 of 17** artefacts positive, 12 negative | ✓ |

### The rules are not interchangeable, and none of them is worth anything in particular

The dispersion statistic clears its structure-preserving null — 293.3 against a null whose 99th
percentile is 280.4 — so a rule's record is not just an echo of the pack it travelled in. **That is the
first time this programme has found real structure in the store**, and it is worth exactly nothing,
because the structure does not survive being measured somewhere else: correlated across two disjoint
sets of databases the per-rule nets come out at **r = −0.134**, the sign agrees on **49.1%** of the 53
rules that moved in both halves, and Spearman–Brown turns that into a full-length reliability of
**−0.309** — worse than knowing nothing, because a negative reliability means the second measurement
would be *better* inverted.

**So the store's heterogeneity is not a per-item property.** A rule repairs on the databases where it
was shown and breaks on the ones it was not, and there are 203 rules against 58 databases: the
interaction is 11,774 cells over 424 flips, which is not a table anyone can learn. The unit of memory is
wrong in a way that pruning cannot fix — not because the rule is the wrong *content*, but because a
rule is the wrong *grain*.

### The actionable form fails too, and it fails flatly

A coarse flag — negative net over at least ten showings — covers 58 rules and 2,545 of the 3,770
confirmation questions, and those questions returned **−0.55pp** against **−0.49pp** for the questions
carrying no flagged rule. A 0.06pp difference on an interval of [−1.97, +1.56]: the flag is not a
weaker version of the ledger, it is no signal at all. This is the prediction I would have most liked to
fail, because a flag that worked would have licensed an arm and an arm is cheap.

### What the pack-size contrast actually is

| corpus | questions | single-rule questions | difference | interval |
|---|---|---|---|---|
| train | 6,999 | 423 | **+4.03pp** | [+0.76, +6.62] |
| dev, R24 split | 1,534 | 343 | +4.14pp | [+0.83, +6.28] |
| dev, R25 dose and admission | 1,534 | 401 | +3.13pp | [+0.62, +5.23] |
| dev, R26 channels | 1,534 | 380 | +0.62pp | [−1.74, +2.95] |
| dev | 1,534 | 97 | +0.36pp | [−2.40, +3.45] |
| twelve 350-question pilots | 350 each | 33–78 | −1.55 to −13.98pp | mostly excluding zero |

Every artefact with more than a thousand questions is positive and every 350-question pilot is negative,
and that is not a fact about packs — it is a fact about **how many singleton questions a corpus holds**:
33 to 78 in a pilot, 97 to 423 in a full split. The pilots are not contradicting the large corpora; they
are too small to measure the contrast and their point estimates are dominated by a handful of flips.
**Three of the twelve pilot intervals exclude zero negatively, and three of the five full-split intervals
exclude zero positively** — a split that a corpus-size explanation predicts exactly and that a mechanism
explanation would have to explain away. It is the part that keeps this a lead rather than a finding.

**What would settle it** is not more of these artefacts. It is one arm that assigns pack size rather
than observing it: same questions, same store, one rule per prompt, and the bare arm already paid for.
That is R36, and its cost is half the prompt tokens of the run it replaces.

### What this closes

The fourth and last route that kept the corpus fixed. Content (§145), quantity (§146, R16), the filter
(§147–§148), the population (§149), and now **the store's items**: none of them can move the exchange
rate from 0.789 toward the 1.393 hurdle, and the reason is now specific rather than general. **A rule has
no per-item value that transfers, so a store cannot be improved by editing its items one at a time —
only by changing the grain at which memory is written, or the number of items a prompt carries.**
