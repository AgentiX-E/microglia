---
id: R21-clearance
step: R21
opened: 2026-10-31
arms: full-cleared,full-cleared-sampled
sample: 350
gates: V1,V2,V3,V4,V5,V6,V7,V8,V12,V32,V44,V45
---

# R21 — clearance: is a smaller pack of *better* items better than a smaller pack?

## Why this file exists

Seven axes have been varied on this store and none of them reaches no memory. Content (rule, repair,
procedure) moves ±3pp and is inert; substrate reproduces twice as well and transfers identically;
quantity loses the whole of its effect at the first item; position is negative in both directions;
framing is closed twice; the delivery order recovered 4pp and then turned out to be a repair of a loss
the control had created. The one number that has survived every attempt to explain it away is the
dose: **the loss arrives with the first item, worth about two points, and everything after that is
flat** (R16, R20's `full` at −4.29pp with 1.83 items).

That reading has a corollary nobody has tested, because every arm so far has changed the *pack* rather
than its *membership*. If the loss is "being shown advice", then a pack of items that were measured to
hurt should be worse than the same number of items chosen at random, and a pack with the measured
hurtful items removed should be better. The two claims are the same claim, and this record has never
been able to state it because the arms it has do not hold the size fixed.

The literature the record already leans on says the same thing, and this is its untested half. Xiong
et al. (arXiv 2505.16067) report that deletion by observed utility beats deletion by age; MeClear
(arXiv 2609.09115) reports 82.3% recovery by clearing records with a Shapley / leave-one-out utility
score. What this project has built is the *retirement* half of that prescription — `full-validated`
removes rules whose record is bad enough, on a two-thirds threshold — and a retirement that removes a
third of the store while leaving the rest is a different experiment from a clearance that removes the
measured-bad and keeps everything else. The first is a hypothesis about the store's overall quality; the
second is a hypothesis about whether a per-item utility score carries any information at all.

## The design

Two arms, one variable, and the variable is *which* items, never how many.

1. **`full-cleared`** — the fold's learn rows score every rule by counterfactual: for each learn
   question the pack is answered twice, once with the rules and once without, and a rule is credited
   only where the two outcomes differ (`outcomeCredit`, `helped` or `harmed`). A rule whose record shows
   **more harms than helps** is removed from every held-out pack it appears in. A rule with no record is
   **kept**: the arm's claim is "clear what was measured to hurt", not "admit only what was measured to
   help", and the second would shrink the pack to almost nothing and measure the dose axis a fourth
   time.
2. **`full-cleared-sampled`** — for each held-out question, the same *number* of rules is dropped, chosen
   uniformly from that question's pack by a seeded Fisher–Yates stream. Retrieval order is preserved in
   both arms, so the two prompts differ in item identity and in nothing else.
3. **`none` and `full` are the anchors**, and the pair is compared to both: dose says the pair should
   sit between them, and only the paired difference says whether membership mattered.
4. **No store mutation.** The clearance removes rules from a *pack*, not from the store, so a run that
   asks for clearance and not for `full-validated` leaves every rule in place and `full` means what it
   meant in the run before. `validateMemory` returns its credit for that reason; the caller that wants
   deletion does the deleting.
5. **One new gate, `V45-clearance-dose-matched`.** Two ways this stops being an experiment: the control
   drops a different count (dose moved), or no question's pack changed (two names, one condition). Both
   fail the run. The counts the gate reads are **post-budget**, because `makePack` admits whole items
   until 1,200 characters are spent — two packs with the same survivors can render a different number
   of items when the survivors differ in length, and that is exactly the way dose would move without
   anyone noticing.
6. **The credit is measured on learn rows only**, with the rule learned from a row excluded from that
   row's own pack (`validation_self_excluded` counts it). The counterfactual reading is forced for these
   arms even when the caller did not ask for it: the absolute score is a question about difficulty
   (iteration 76 fitted a single binomial across rules, p = 0.296), so a filter built on it would be a
   random filter with a narrative.

## Prediction

- **`full-cleared` is above `full-cleared-sampled` by 1 to 3pp on the paired difference.** This is the
  confirmatory claim, and it is a claim about the only per-item measurement in this record that is
  counterfactual rather than correlational. If it holds, the deletion half of the literature's
  prescription works here and the next iteration spends its budget on a better utility estimate rather
  than on another content form.
- **The pair sits between `none` and `full`, closer to `none`, and both arms are scored at a smaller
  dose than `full`.** `cleared`'s mean items will be below `full`'s 1.83 and the control's will equal
  it by construction; V45 is what makes that equality a fact rather than an assumption.
- **The clearance removes a minority of the store.** Between 5% and 40% of rules with any record will
  show more harms than helps. A clearance that removes almost nothing cannot move accuracy and a
  clearance that removes almost everything is a dose experiment; both are reported as such rather than
  as a null about utility.

## Refutation

- **If `full-cleared` − `full-cleared-sampled` is within ±1pp with a 95% interval that excludes +1pp,
  the utility score carries no usable signal at this store size** and the record stops attacking
  selection. That result would say the harm is not a property of *which* rule is shown, which is the
  third independent measurement of the "the harm is not relevance" reading (after the relevance audit
  and `full-shuffled`).
- **If more than 60% of the store's measured rules are removed**, the pair is a dose experiment wearing
  a clearance's name. The run is reported with that reading and no claim about membership is made from
  it, whatever the delta.
- **If `full-cleared`'s mean items fall below 0.5**, the same applies in the other direction: an arm
  that shows almost nothing will land on `none` and its distance from `none` measures emptiness. The
  artefact reports the mean, and the interpretation is fixed here rather than after the number.
- **If V45 fails**, the run is not read at all. A control that dropped a different number of items makes
  the delta uninterpretable after the fact, and a pair that never differed is one condition under two
  names.

## Resolution

The paired `full-cleared` − `full-cleared-sampled` is the only cell that gets a verdict, and it is
worth about 3pp of resolution at 350 questions with the discordant counts the dose axis predicts. A
null is pre-registered as "the score carries nothing at this n", not as "clearance does not work": the
two claims differ by exactly the quantity this lane cannot supply, which is a second store large enough
to estimate a per-item effect with more than one observation behind it.

## Outcome

Dispatch `41203470612` (success, 4,378 calls, 6 retries, 0 timeouts, 0 call failures, twelve gates pass,
26 minutes, `config.prereg` = this file). Artefact `eval/results/poc-sota-bird-clearance.json`. 350
questions, 5 folds, `none` at 54.00%, minimum detectable effect 4.46pp.

| Arm | Items | Chars | ACC | Δ vs `none` | 95% CI | gained / lost | p |
|---|---|---|---|---|---|---|---|
| `full` | 1.83 | 1,089 | 52.00% | −2.00pp | [−5.14, +1.14] | 12 / 19 | 0.2810 |
| `full-cleared-sampled` | 1.51 | 905 | 51.71% | −2.29pp | [−5.43, +0.57] | 10 / 18 | 0.1849 |
| `full-cleared` | 1.51 | 907 | 51.71% | −2.29pp | [−5.43, +0.86] | 11 / 19 | 0.2005 |

The pair, which is what the registration was about: **`full-cleared` − `full-cleared-sampled` = +0.00pp,
6 gained and 6 lost, 12 discordant, exact McNemar p = 1.0000.** Against `full` the two arms are each
−0.29pp (5/6 and 3/4, p = 1.0000 both), and the shipped clearance removed 93 of the 628 rules the pass
scored (14.8%), 115 items over 350 questions, 0.33 per question.

**The confirmatory claim is refuted, and the refutation clause in the registration fires.** The
prediction was +1 to +3pp for `full-cleared` over its control; the measured difference is exactly zero
with an interval of zero, and the clause that was written down in advance for that case is explicit: the
utility score carries no usable signal at this store size, and the record stops attacking selection.

**Why it is zero, and why that is the finding rather than an excuse.** `V45-clearance-dose-matched`
passed on the dose (0 mismatched of 350) and reported **311 identical**: on 88.9% of questions the two
arms rendered *the same pack*. The structural reason is the store's own shape. A pack carries 1.83 items;
when the clearance removes the one item a single-item pack holds, it leaves nothing, and a control that
must drop the same count has only that item to drop, so the two cells coincide **exactly where the
clearance acted most strongly**. The pair therefore differed on 39 questions, and on those it split
6–6. The registered resolution was 3pp on 350 question-pairs; it was never going to be met by 39.

**The number underneath is the one worth keeping.** The counterfactual pass answered 104 decisive
questions across five folds — 7.4% of the 1,400 learn rows — because a question is only decisive when
the outcome *changes* between the pack and no pack, and most questions are right both ways or wrong both
ways. Those 104 questions credited 143 of the 628 scored rules, so **77% of the store has no
counterfactual record at all**, and the rules that do have one average 1.2 comparisons. A perfect
clearance could therefore have filtered at most 22.8% of this store, and a 3pp effect measured over the
39 questions where a pack actually changed is not a thing this lane can resolve.

**What the arm did measure, and it is consistent with everything before it.** Both clearance arms sit at
1.51 items and −2.29pp while `full` sits at 1.83 items and −2.00pp: a third of an item less text, a third
of a point worse, which is the dose axis's own noise. The clearance moved accuracy by nothing because it
moved the pack by nothing, and the pack moved by nothing because the score had almost nothing to work
with.

**Two instrument readings.** `V44-domain-accounted` reports `180 item(s) with no domain, 180 arrived
unscoped, 0 widened` — the third dispatch in a row in which generalisation widened nothing. `V32`
reports 644 corrections from 1,400 learn rows with 0 unanswered and 4 distillation failures (0.3%), in a
fold whose decisive count was 104.

## What this leaves

The prereg's refutation clause committed the record to one conclusion if this came back null: **the
object is the problem, not the filter.** Every arm here varies a distilled store — its content, its size,
its position, its framing, its delivery order, and now its membership at a fixed dose — and the one
substrate no arm has injected is the raw correction itself. That is R22, registered as
`prereg/R22-raw.md` and built in the same iteration, and its confirmatory claim is the mirror of this
one: the interpretation is what costs, so removing it should pay.

R21 also fixes a design defect for any future clearance experiment, and it is worth stating because it
was invisible until the pair ran: **a control matched on item count is degenerate on single-item packs.**
Dose matching has to be on characters, or the comparison restricted in advance to the questions where
the two packs differ — a subset that must be declared before the run, not selected after it.
