---
id: R24-dev-split
step: R24
opened: 2026-11-01
arms: none-noevidence,full-noevidence
sample: 1534
gates: V1,V2,V3,V4,V5,V6,V7,V8,V12,V32,V44,V47
---

# R24 — the same 2×2 on the split the competitors used

## Why this file exists

R23 measured the 24.86pp that BIRD's per-question `evidence` sentence is worth, and the −6.00pp interaction
that shows a retrieved pack competing with it. Three claims in that file are deliberately weaker than the
headline, and the same measurement on a larger split is what would strengthen them.

1. **The headline is not in the same units as the comparisons it invites.** R23 ran on `minidev`, 350
   questions, and the numbers it is set against — 12.71 (RSL-SQL), 14.36 (CHESS), 18.37 (DAIL-SQL), 20.01
   (GPT-4) — were all measured on **dev**, 1,534 questions. Minidev also drops the easiest third, which makes
   its effect size a statement about moderate and challenging questions only. Quoting 24.86 against 12.71
   across that boundary is the kind of comparison this record's own admissibility rule calls `indicative`.
2. **The +1.14pp cell is below the instrument's floor.** `full-noevidence` is 13 gained and 17 lost against
   `none-noevidence`; the direction is the finding, the significance is absent, and at 350 questions it
   cannot be present.
3. **The difficulty-shape prediction could not be tested.** Minidev has no `simple` questions, so the
   literature's three-level gradient (Simple −10 to −11, Moderate −15 to −19, Challenging −19 to −20) had
   two levels, 0.49pp apart, and the reading was recorded as unresolved. Dev keeps the simple third.

## The design

The same four cells as R23 — `none`, `none-noevidence`, `full`, `full-noevidence` — with two changes to the
run and none to the code:

1. **`SOTA_SPLIT=dev`**, 1,534 questions. Every arm is re-measured inside the run; nothing is carried over.
2. **`SOTA_LEARN_SAMPLE=280`**, so each fold distils from exactly as many learn rows as it did on minidev
   (280 of 4/5 of 350). The store size is therefore held and **the split is the only difference** — a store
   of 1,227 rows per fold would confound the split with a much larger memory and cost ~12,000 calls.
   `learnPool` is a prefix of a list already interleaved across databases, so the sample is a sample of every
   database rather than of whichever one sorts first.

`V47-evidence-ablated` runs unchanged and is the condition on reading: `none` and `full` must show the
sentence on every question that has one, and both ablated arms on none.

## What the larger sample buys, computed before the run

R23's discordance measured the two contrasts at 105 and 94 of 350 questions. Scaled to 1,534 same-database
questions at the same rates, the paired standard errors are `sqrt(460)/1534 = 1.40pp` for the main effect and
`sqrt(412)/1534 = 1.32pp` for the interaction, so both half-widths are about **±2.7pp** — against ±3.8pp and
±4.4pp on minidev.

That is what makes the confirmatory claims below possible: **≥8pp on the main effect and ≥2pp on the pack's
value without the hint.** On minidev the second bar would have been below the floor and would not have been
registered.

## Prediction

- **`none` − `none-noevidence` ≥ 8pp, and the interval contains 24.86.** The replication bar, set to R23's
  rather than to its point estimate, because the point estimate is exactly what this run is checking. The
  24.86pp is **falsified if the dev interval excludes it** — that would mean the minidev panel inflates the
  effect, which is plausible a priori since it drops the simple third.
- **`full-noevidence` − `none-noevidence` ≥ 2pp.** The first testable statement of the cell that reversed the
  record's conclusion. Registered as confirmatory here because the design can now resolve it; on minidev the
  same claim would have been unfalsifiable.
- **The interaction is ≤ −4pp with an interval excluding zero.** A replication of −6.00pp at 4.4× the sample.
- **The effect rises with difficulty across three levels.** The prediction R23 could not test. Estimated
  from the literature's gradient and from R23's two flat levels, the ranking to expect is
  `simple < moderate ≤ challenging`, with the simple effect between 5 and 15pp and the challenging one
  between 18 and 30pp.
- **`none` lands between 50% and 58%.** The dev baseline is not the minidev baseline: the split keeps the
  easiest third, where this lane scored 53.71% against 53.52% for XiYan, and the two published dev cells for
  this prompt are 53.71 and 57.63. A `none` far outside that band would be an environment change.

## Refutation

- **If `none` − `none-noevidence` is below 12pp with an interval excluding 24.86, minidev inflated the effect
  and the dev number becomes the headline.** The argument is not that R23 was wrong but that its split has a
  difficulty mixture the literature's split does not, and the record would then report per-split effects and
  use dev for every cross-system comparison. The 24.86pp would become a moderate-and-challenging estimate.
- **If `full-noevidence` − `none-noevidence` is negative with an interval excluding −2pp, the +1.14pp cell was
  noise.** The honest statement then becomes "the pack is null without a competitor" rather than "positive",
  and the product switch survives — because a null is still not a cost — but the claim that a note *pays*
  anything is withdrawn.
- **If the interaction's interval contains zero, substitution does not replicate at 4.4× the sample** and the
  competition reading is demoted from a mechanism to a single-run observation. That would be the most
  damaging outcome available here, and it is the one clause that would send this line back to R21-style
  selection work rather than forward to the database.
- **If the difficulty effect is flat across all three levels, the literature's gradient does not transfer to
  this prompt** and the difficulty story is dropped from the record rather than left as a caveat.
- **If `V47-evidence-ablated` fails, the run is not read.** Three consecutive iterations have carried this
  clause and none has needed it; it stays because the alternative is reading a score about something else.
- **If the deadline truncates the run before five folds, the artefact is read as a partial run and no
  confirmatory claim is made**, because a split that changed mid-run is not a split.
