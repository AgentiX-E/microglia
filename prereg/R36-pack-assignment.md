---
id: R36-pack-assignment
step: R36
opened: 2026-11-02
arms: full-one
sample: 1534
gates: V62,V63
---

# R36 — one rule per prompt, assigned rather than observed

## Why this file exists

R35 closed the fifth route and left two levers, both of them designs rather than items: the **grain** at
which memory is written and the **number of items a prompt carries**. It also left one number standing
above zero — the pack-size contrast, **+3.13pp [+0.62, +5.23]** on this very split, +4.03pp on the train
corpus — recorded as a lead rather than a finding because retrieval assigns pack size and the singleton
questions are harder.

That lead is worth a round because it is the only positive estimate the programme has. It is also, for
once, **cheap to settle**: the lane has carried a `full-one` arm since R25 — the same retrieval, the same
order, the first item and no second one, built from the pack `full` carries so the two prompts differ in
nothing but the number of items in the block. R25 ran it on the dev split and reported it as a *dose*
control, never as a test of R35's lead, which did not exist yet. **The cell is therefore already paid for,
and the only thing missing is the reading that would decide the lead.**

Two things are registered here, and they are deliberately different in kind:

1. **An adjudication of the lead against evidence that already exists.** This is not a prediction — the
   cell has been in a committed artefact since R25 and this file was written after it was read. What can
   still be fixed in advance is the **decision rule**, the **statistic**, and the **threshold**, and those
   are what the section below fixes. The disclosure section says exactly what was seen.
2. **A replication.** The R25 cell is one store draw; a null measured once on a store that is resampled
   every dispatch is a null with no error bar on its own reproducibility, and this programme has been
   burned by exactly that (three `full` deltas of −3.71, −4.00 and +0.86pp on identical code). One
   dispatch re-measures the same arm on a fresh store draw, and P5 is the replication test.

## What is being tested, exactly

1. **Does the truncation pay?** `full-one − full` on the dev split, on a database-clustered interval.
   R35's lead predicts the sign and the size; the pre-registered material threshold is the same one R25
   registered for this arm, **+2pp**, so the two rounds cannot disagree about what "it works" means.
2. **Does the one-rule pack clear the hurdle?** R34 established that a repair can only happen on a
   question the bare model got wrong and a break only on one it got right, so the break-even exchange is
   the bare model's odds `B / R`, not parity. R25 reported deltas; it never reported `full-one`'s
   exchange rate against that hurdle, and the two readings can disagree: an arm can be a wash in accuracy
   and still be further from, or closer to, profitability.
3. **What is the second item actually worth?** The pair of arms decomposes into a marginal item:
   `full` minus `full-one` is 8 repairs and 3 breaks on the R25 draw, and that marginal help-per-harm is
   a number no round has computed. If the second rule is the best-behaved item in the store, capping the
   pack at one is not a neutral truncation but the removal of the only thing that pays.

## The corpus, counted

`eval/results/poc-sota-bird-dev-R25-dose-and-admission.json`, the dev split, five cross-fitting folds,
1,534 questions over 11 databases, one store per fold distilled from 280 learn rows. No model call is
made by the adjudication; the replication is one dispatch.

| quantity | value |
|---|---|
| questions | 1,534 |
| bare-model correct (breakable) | 877 |
| bare-model wrong (repairable) | 657 |
| hurdle `B / R` | 1.335 |
| `full` mean items per prompt | 1.74 |
| `full-one` mean items per prompt | 1.00 |
| prompts `full-one` changed against `full` | 1,134 (73.9%) |

## Prediction

- **P1 — instrument.** 1,534 questions, 11 databases, `full-one` carries exactly one item on every
  prompt, and its rendered block differs from `full`'s on more than 70% of questions. An arm that
  degrades into a duplicate of `full` would publish a null that is a bug: this is checked before any
  number is read (R25's `V49` did exactly this check, and it is repeated here because a re-read that
  skips it is a re-read of an unchecked cell).
- **P2 — the recount reproduces the lane's own contrast.** The module's paired contrast on the committed
  per-case records must agree with the lane's `arm_pairs` entry for `full-one` against `full` to within
  **0.01pp** on the point estimate and exactly on the discordant counts. This is an instrument test, not
  a result: two independent implementations of the same arithmetic that disagree mean one of them is
  wrong, and the lane's is not the one with tests.
- **P3 — the one-rule pack does not clear the hurdle.** `full-one`'s clearance is below **1**, and below
  `full`'s. A pack of one exchanges *worse* than a pack of two, which is the opposite of what R35's
  singleton-question contrast implies and what would make the lead a property of the questions.
- **P4 — the second item is the one that pays.** The marginal help-per-harm of the second rule is above
  **2.0**: truncating the pack removes more repairs than breaks. If it lands below 1.0, the second item
  is a net harm and capping at one is the improvement R25 failed to find for a different reason.
- **P5 — the null replicates on a fresh store.** A dispatch of the same split, the same folds and the
  same arm on a new store draw puts `full-one − full` inside an interval whose upper bound is below
  **+2pp**. This is the round's only blind test, and it is the one that decides the lever.

## Decision rules, fixed before the replication is paid for

| outcome | reading | next |
|---|---|---|
| **P5 holds** (upper bound < +2pp) | the pack-size contrast is selection, not mechanism, on two independent stores | the number-of-items lever is **closed**; the grain of memory writes is the only lever left |
| **P5 refuted** (`full-one − full ≥ +2pp`) | R35's lead survives assignment | the programme has its first positive arm; next is a dose arm on minidev and an out-of-sample confirmation on train |
| **P5's interval contains +2pp** | underpowered at 1,534 questions | register a larger split; do not read the sign |
| **P4 above 2.0 but P3 below 1** | the second item pays and the pair still loses | the mechanism is real and too small to reach break-even; that is a ceiling statement, not an arm |

The replication is dispatched **before** the adjudication module is written, so the adjudication cannot
influence the run. Both readings are reported whatever they say.

## Disclosure

This file is written after the R25 artefact was read, and the reading is listed because it is the
difference between a prediction and a fit:

- The `full-one` cell's accuracy (56.78%), its discordant counts (52 gained, 58 lost) and its contrast
  against `full` (−0.33pp) were seen before this file existed, and they are in `prereg/R25-dose-and-
  admission.md` §Outcome in the repository's own words.
- The hurdle-normalised reading (P3) and the marginal-item decomposition (P4) were **not** computed
  before this file, and neither was the clustered interval on the dev split: R25 reported an
  i.i.d. bootstrap interval, and R35's contrast was clustered by database, so the two numbers in the
  repository are not yet on one scale.
- **P1, P2 and P5 are blind.** P3 and P4 are new statistics on an old cell and are registered as
  **readings**, not as predictions; `AUDIT.md` records them under the same heading as R35's disclosure.

The consequence is stated plainly rather than buried: **R36's adjudication half cannot fail in the way a
prediction fails.** Its value is that the decision rule was fixed before the replication was bought, so
the round cannot choose its threshold after seeing which way the fresh run went.

## Refutation

- **P3 refuted (clearance ≥ 1).** The one-rule pack is profitable and the pair is not, which makes
  truncation a product change and reopens the pack line at a budget the project never tried.
- **P4 refuted (marginal help-per-harm < 1).** The second item is a net harm; capping at one should have
  helped and did not, which means the loss is not in the item count but in what the item says. That
  narrows the grain lever rather than closing it.
- **P5 refuted.** As above: the first positive arm.

## Cost

The adjudication is zero model calls. The replication is one dispatch: 1,534 learning generations plus
`none`, `full` and `full-one` on 1,534 questions — **6,136 calls**, against R25's 9,096 for the same
split with four arms and an admission fit. The distillation cache is restored, so the store is replayed
where its prompts recur.
