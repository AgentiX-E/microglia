---
id: R24-dev-split
step: R24
opened: 2026-11-01
arms: none-noevidence,full-noevidence
sample: 1534
gates: V1,V2,V3,V4,V5,V6,V7,V8,V12,V32,V44,V47,V48
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

## Amendment 1 — before the re-dispatch, because the first dispatch produced no artefact

Dispatch `41226847922` ran this design exactly as registered and published nothing. It printed its last
progress line at 19:17:48, 82 minutes in, and then emitted nothing for the next 118 minutes until the step's
own 200-minute timeout killed it. No artefact, no partial record, no number. **Nothing was read, and no
claim in this file was tested by it.**

The cause was not the split and not the provider. Judging a fold executes every statement the model wrote
against a real database through a synchronous driver, so a query that is slow to answer — a three-way cross
join is the easy way to write one — stops the whole process inside a native call. No timer runs, no deadline
check runs, and the run is indistinguishable from a hang. The first fold's judging phase took 5.8 minutes,
the second took 63, and the third never finished; the lane's own 130-minute wall clock could not fire because
it is checked between model calls.

Three things changed, all of them instrument rather than hypothesis:

1. **Every statement runs in a child process with a deadline of 20 s and a row cap of 10,000**
   (`SOTA_SQL_DEADLINE_MS`, `SOTA_SQL_ROW_CAP`). A statement that outlives the deadline is killed with
   `SIGKILL` and recorded as a *deadline*, not as a wrong answer. The design was measured before it was
   chosen: terminating a worker thread stuck inside the driver takes 50.5 seconds, killing a child process
   takes 0 ms, and spawning one costs 19 ms.
2. **`V48-statements-answered` is registered as a blocking gate**: at least 99% of executed statements must
   answer inside the deadline. A score built mostly from killed statements is a score about how long queries
   take, and the registered claims below would be readings of the instrument rather than of the model.
3. **The judging phase now reports its progress**, and the fold line carries the statement counts, so a
   phase that stops moving is visible in the log while it is happening rather than after a timeout.

Nothing in the design, the arms, the sample or the predictions changed. The run this file describes has still
never been executed.

## Outcome

Dispatch `41245819288`, artefact **`eval/results/poc-sota-bird-dev-R24-dev-split.json`**: 1,534 questions, 5 folds, 6,571 calls,
0 call failures, 13 gates pass (including `V48-statements-answered` at 16 of 10,160 statements, 0.16%), 32
minutes. `V47-evidence-ablated`: `none` 1386/1386 and `full` 1386/1386 carrying the sentence,
`none-noevidence` 0/1386 and `full-noevidence` 0/1386 — the 148 questions whose row carries no evidence are
skipped in both directions, as the instrument specifies.

| cell | accuracy | n |
|---|---|---|
| `none` | **57.43%** | 881/1534 |
| `none-noevidence` | 39.83% | 611/1534 |
| `full` | 56.84% | 872/1534 |
| `full-noevidence` | 40.55% | 622/1534 |

| contrast | pp | 95% CI | discordant | p |
|---|---|---|---|---|
| evidence, no pack (`none − none-noevidence`) | **+17.60** | [+15.38, +19.82] | 315/45 | <1e-4 |
| evidence, with pack (`full − full-noevidence`) | **+16.30** | [+14.14, +18.58] | 300/50 | <1e-4 |
| pack, with evidence (`none − full`) | +0.59 | [−0.91, +2.09] | 73/64 | 0.4944 |
| pack, no evidence (`none-noevidence − full-noevidence`) | **−0.72** | [−2.15, +0.72] | 60/71 | 0.3824 |
| interaction (DiD) | **−1.30** | [−3.06, +0.46] | 86 up / 105 down / 1343 flat | — |

### Prediction by prediction

1. **`none − none-noevidence` ≥ 8pp — held, at +17.60pp.** The bar was cleared by 9.6 points and the interval
   is 2.14pp wide, half of what minidev's 350 questions could produce.
2. **"The interval contains 24.86" — falsified on the whole panel.** [+15.38, +19.82] excludes it. **The
   registered *explanation* for that falsification is also refuted.** The prediction said a dev interval
   excluding 24.86 would mean "the minidev panel inflates the effect, which is plausible a priori since it
   drops the simple third". Restricted to the mixture minidev actually keeps — moderate and challenging,
   n = 609 — the same dispatch gives **+22.99pp [+19.21, +26.77]**, which contains 24.86. The difference
   between 24.86 and 17.60 is therefore **composition, not inflation**: 60% of dev is `simple`, where the
   sentence is worth 14.05pp, and minidev contains none of it. The 24.86 stands as an estimate for
   moderate-and-challenging questions; **17.60 is the whole-split number and is what a cross-system
   comparison must use.**
3. **`full-noevidence − none-noevidence` ≥ 2pp — falsified.** Measured **−0.72pp [−2.15, +0.72]**. The
   +1.14pp cell that reversed this record's conclusion in R23 does not replicate on 4.4× the sample; the
   honest statement is that **the pack is null without a competitor**, not that it is positive.
4. **Interaction ≤ −4pp with an interval excluding zero — falsified.** **−1.30pp [−3.06, +0.46]**, interval
   containing zero, against R23's −6.00pp [−10.57, −1.71]. The registered refutation clause fires:
   *"substitution does not replicate at 4.4× the sample and the competition reading is demoted from a
   mechanism to a single-run observation."*
5. **The effect rises across three levels — held, and it is the first time the shape was testable.**
   `simple` n=925 **+14.05pp** [+11.24, +16.86], `moderate` n=464 **+22.63pp** [+18.32, +27.16],
   `challenging` n=145 **+24.14pp** [+15.86, +32.41]. Monotone, `simple` inside the registered 5–15pp band
   and `challenging` inside 18–30pp. The simple-to-moderate step is **+8.58pp ± 5.24**, resolved; the
   moderate-to-challenging step is **+1.51pp ± 9.38**, not resolved — the gradient's top end is still open.
6. **`none` between 50% and 58% — held**, at 57.43%. The environment did not move.

### What the five cells say together

**The hint is real, large and now measured in the units the literature uses.** 17.60pp on the whole split,
22.99pp on the mixture every competitor's panel keeps. Against the manipulator prices the record already
carries — 20.01 (BIRD GPT-4), 12.71–18.37 (RSL-SQL, CHESS, DAIL-SQL), 8.35–20.86 (SEED) — this is the top of
the published range, not an outlier.

**The pack never pays and never costs, on this split, in either condition.** +0.59pp with the hint and
−0.72pp without it; neither interval excludes zero and neither is above the 2.14pp the design can detect.
Twenty-three iterations have now measured the pack under eight varied axes, and this is the first that
measured it with an instrument able to resolve 2pp and with the competitor both present and removed.

**The interaction that motivated R25 does not replicate.** −1.30pp against −6.00pp, on the split the
competitors used, with the same four cells. Per the clause registered above, the substitution reading is
demoted to a single-run observation, and the line's next step is **selection work rather than the database**:
the reason to ask "can a value index substitute for the hint" was that the pack was losing a competition, and
on the larger panel it is not in one.

**Store variance, again.** The evidence effect per fold runs 14.98 to 21.50pp and the pack's runs −2.28 to
+3.26pp across five stores rebuilt from the same corrections — the ±1.7pp band AUDIT 17.6 recorded, and the
reason every claim here is within-dispatch.

### Where the artefact is, and why it is not `poc-sota-bird-dev.json`

The dispatch wrote the canonical dev path, because that is what the lane did: the artefact's name was
the split's, and this is the second design to run on `dev`. The first is R8.3b, whose run is the file
the protocol gate recomputes the `reproduced` cell from, and the write replaced it. Nothing failed at
the time — the replacement is a valid artefact with a different number in it — and the loss was found
by `pnpm check`, in the one gate that recomputes the cell rather than quoting it.

R8.3b's artefact is restored, this run is committed under its own name, and the lane no longer names a
file after the split alone: a run that names a pre-registration appends that id to the split's own, as
`poc-sota-bird-dev-R24-dev-split.json` does here, so two designs on one split cannot share a path and a
re-dispatch of one design still writes one file. The
2026-11-01 amendment to `AUDIT` §19.9 and `TECH-DESIGN` §17.60 record the defect; the number in this
file is unaffected, because it was always read from the artefact and not from its name.

### The instrument

`V48-statements-answered`: **16 of 10,160 statements hit the 20s deadline (0.16%)**, 130 results truncated at
the 10,000-row cap (1.28%). Without the deadline this dispatch would not exist — the previous one spent 118
minutes inside a single fold's judging phase and published nothing. The gate is what makes the difference
between "the lane is slow" and "the lane is describing its own timeout" a number in the artefact.
