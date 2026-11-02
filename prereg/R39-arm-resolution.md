---
id: R39-arm-resolution
step: R39
opened: 2026-11-02
arms: none
sample: 98
gates: V69,V70,V71
---

# R39 — is the memory disagreement a disagreement, or eighty samples too small to have met?

## Why this file exists

`AUDIT` §25.7 has carried an open item since R30: *`eval:power` audits whole-artefact deltas, and an arm
inside an artefact is not a row.* Twenty artefacts were audited; the record's claims are not twenty. They
are the ninety-eight arm rows inside those artefacts — `values` at +1.17pp, `linked` at −9.26pp,
`full-one` at −0.20pp, `full-lexicon` at −0.59pp, four separate `full-verified` readings — and not one of
them has ever been set beside the difference its own sample could resolve.

That is why the memory question has been re-opened seven times without ever being answered. The record
contains, for the same contrast (`full − none`), readings from −4.86pp to +0.72pp on splits from 350 to
7,000 questions, and it has treated that range as evidence that the mechanism is unstable. **A range that
wide has two possible causes — the mechanism moves, or the instrument cannot see** — and the second has
never been quantified per arm.

The open item asked a schema question: *is an arm an artefact?* The answer this round takes is **no, and it
does not need to be.** An artefact is the unit the validity gates certify — one dataset, one fold
partition, one call budget, one set of vetted outcomes. An arm is a column of that same run: it inherits
the gates and contributes one number the gates never read, how many questions changed hands between it and
its control. So an arm needs no validity schema of its own. It needs `(helped, harmed, n)` read as a row.

## What is tested

1. **The ledger.** Every published arm row in `eval/results/`, from `arms[]` (control `none`) and
   `arm_pairs[]` (control `full`), recomputed from its discordant counts and set beside two bars: the 95%
   half-width and the difference the same sample could detect at 80% power. A row is **decided** when its
   delta clears the second, stricter bar — the same bar `V5-resolution` applies.
2. **The price.** For every undecided row, the number of questions it would take to decide an effect of the
   size it found, at the discordance it observed: `n = z²·d / δ²` with `z = 2.802`. A zero effect has no
   price and is reported as `null` rather than as an enormous integer.
3. **The replication.** Each contrast name across the runs that measured it, with the decided ones counted
   separately. Runs are **not** pooled: minidev, dev and train are different samples with different fold
   partitions and different stores, and an average over them would be an average of five experiments
   weighted by size.
4. **The shrinkage.** For each contrast measured at more than one sample size, the median `|delta|` at each
   size and whether it fell or rose. A genuine effect does not shrink because more questions were asked.

## Prediction

Fixed before the artefact was regenerated for CI and before any assertion over it was written. Each bullet
states the reading and the observation that would refute it.

- **P1 — fewer than a third of the published arm rows are decided by their own sample.** Refuted if a third
  or more are decided, which would mean the record's pilots were better powered than they read and the
  project has been under-reading its own evidence rather than over-reading it.
- **P2 — no decided row is smaller than 4pp.** Refuted if any row below 4pp is decided, which would mean a
  350-question design can settle an effect the product cares about and the whole "underpowered" account is
  wrong.
- **P3 — `full − none` has been measured at least fifteen times and at most two of those runs were decided.**
  Refuted if fewer than fifteen runs exist (the contrast was not as replicated as claimed) or if three or
  more were decided (the disagreement is real and the range means something).
- **P4 — the median magnitude of `full − none` on the 1,534-question split is under a quarter of its median
  on the 350-question pilots.** Refuted if the ratio is a quarter or more, which would mean the effect
  survives a 4.4× larger sample and the small pilots were not exaggerating it.
- **P5 — at least fifteen of the twenty `full − none` runs are negative.** Refuted if the sign is not
  predominantly negative, in which case there is no stable direction to explain and the round's reading of
  a small negative effect dissolves into noise.
- **P6 — at least one arm published as a finding would need more questions than the corpus contains, by an
  order of magnitude.** Refuted if every price is within ten times the sample that produced it, in which
  case every question in the record is affordable and "we cannot decide" is an excuse rather than
  arithmetic.

P1 and P3 are the load-bearing predictions. If they hold, the seven re-openings of the memory question were
seven samples that could not have answered it, and the correct response is to stop re-running and start
pricing. If P1 fails, the record has been *under*-reading itself, which would be a defect of the opposite
kind and would reopen every closure.

## Refutation

Read in order; the first that fires is the round's outcome.

- **The ledger is short.** If `V69-every-arm-is-a-row` fails — any published row was dropped between the
  artefact scan and the table — the reading is withdrawn. This record has made that mistake in four
  layers, and a table that is quietly missing rows looks exactly like one that is not.
- **The ledger does not reconcile.** If `V70-the-ledger-reconciles` fails on any row, that row's printed
  delta describes a population other than the one its own counts describe, and every column derived from it
  — resolution, price, decision — is arithmetic about a sample that does not exist. A single failure
  withdraws the row rather than qualifying it.
- **The price contradicts the decision.** If `V71` fires, the two formulas have drifted and the price column
  is withdrawn until they agree.
- **P3 is refuted in the decisive direction.** If three or more of the `full − none` runs are decided and
  they disagree in sign, the memory question is genuinely contested rather than underpowered, and this
  round's conclusion is refuted rather than narrowed.
- **The shrinkage runs the other way.** If the median magnitude of `full − none` rises with n, the small
  pilots were not exaggerating the effect and the "range is small-sample" account is refuted.

## Disclosure

**A zero-call reading cannot be blind to its own data.** The predictions were fixed after an exploratory
pass had printed the ledger, and the honesty of the round therefore rests on the refutation clauses rather
than on blindness. Three readings are recorded because each would have changed the claim:

- **The two baselines are different contrasts and the record quotes both as "the effect".** `values` reads
  **+1.17pp** in `arms[]` (against the no-memory baseline SQL, 64 gained / 46 lost) and **+0.85pp** in
  `arm_pairs[]` (against the `full` arm, 87 gained / 74 lost). Neither is wrong; they are `values − none`
  and `values − full`, and a document that quoted "the values channel is worth +1.17pp" without naming the
  control would be quoting a treatment effect while describing a control comparison. The ledger therefore
  carries `control` in every row and in every contrast name.
- **The 80% bar is stricter than a 95% interval, so a row can be significant and undecided.** The train
  run at 7,000 questions reads −0.71pp with a 0.82pp floor: inside the interval, outside the power bar. The
  record's best memory run is that shape, and a ledger that printed only one bar would have hidden it. Both
  are printed for every row.
- **The first version of `replicationsOf` called a single decided run a replication.** With one decided row
  the sign set has one element and "the decided runs agree" is vacuously true. `decidedAgree` is now `null`
  below two decided rows, because a set of one has no agreement to report.

**What this round cannot say.** It cannot say the mechanism is zero: 80 undecided rows are 80 questions
this record cannot answer, not 80 answers of zero. It cannot compare arms across artefacts as if they were
one experiment (different stores, different folds), which is why nothing here is pooled. And it cannot price
a question whose discordance would change at a larger n — the price uses the discordance the run observed,
which is the same approximation the minimum detectable difference already carries.

## Cost

Zero model calls and zero dispatches: one command over the committed artefacts (`pnpm eval:resolution`),
49 unit tests over the module, three gates (two blocking). CI diffs the artefact and asserts 15 of its
fields, so a change in the arithmetic arrives as a diff rather than as a paragraph.

## Outcome

| # | Prediction | Reading | Result |
|---|---|---|---|
| P1 | fewer than a third of the rows are decided | **18 of 98 — 18.4%**, 27 clear a 95% interval | holds |
| P2 | no decided row is smaller than 4pp | smallest decided row is **4.57pp** | holds |
| P3 | `full − none` measured ≥ 15 times, ≤ 2 decided | **20 runs, 1 decided**, 6 clear a 95% interval | holds |
| P4 | the 1,534 median is under a quarter of the 350 median | **2.86pp → 0.33pp**, ratio 0.11 | holds |
| P5 | at least 15 of 20 are negative | **18 negative, 2 positive** | holds |
| P6 | one price exceeds the corpus by an order of magnitude | **1,457,294 questions** for a −0.07pp row | holds |

**The ledger says the range was the instrument.** Eighteen of ninety-eight published arm rows could be
decided by their own sample, and **every one of the eighteen is a large effect** — the smallest is 4.57pp,
the largest 32.57pp. Not one row below 4pp has ever been decided in this record, and the effects the
product cares about are 0.1–0.7pp. The three design sizes in the record impose floors of **4.38pp at 350
questions, 2.07pp at 1,534 and 0.82pp at 7,000** (median across the rows at each size): the pilot design
that produced most of the record's beliefs could not have seen a 1pp effect if it were there.

**`full − none` is eighteen negatives and two positives, one decided, and six inside a 95% interval.** Its
median magnitude is **2.86pp on the 350-question pilots, 0.33pp on the dev split and 0.71pp on the 7,000
out-of-sample train split** — a fall to about a ninth when the sample grew 4.4×, which is what an
exaggerated small-sample effect looks like and not what a stable mechanism looks like. The one decided
memory row (`full − none` at −4.57pp on 350 minidev questions) sits exactly where the inflated pilot
magnitudes sit, so it is the least representative of the twenty rather than the most.

**The counter-example is kept because it is the reason to believe the instrument.** `linked` — the schema
pruning channel — reads **7.71pp on 350 questions and 9.26pp on 1,534**, the only contrast in the record
whose effect *grows* with the sample, and it is decided at both sizes. A rounding artefact does not grow
with n. So the ledger distinguishes the one large effect the record actually has from the twenty small ones
it has been arguing about.

**The price list is the round's practical result.** The cheapest undecided question in the record costs
**352 questions**; the dearest costs **1,457,294** — the `full − none` row at −0.065pp on the dev split,
which is one of the smallest memory deltas the record has ever published. A question that costs a million questions is not a question
this project can ask, and saying so is arithmetic rather than a shrug.
