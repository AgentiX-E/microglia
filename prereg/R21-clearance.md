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
