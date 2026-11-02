---
id: R36-pack-assignment
step: R36
opened: 2026-11-02
arms: full-one
sample: 1534
gates: V1,V2,V3,V4,V5,V6,V7,V8,V12,V32,V44,V48,V49
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

## Which gates this file names, and why it names those

The `gates` field above is the set this file's **dispatch** emits — the lane's own instrument and control
checks, unchanged from R25's list minus `V50` because this round asks for no admission fit. It reads as a
strange list for a round whose subject is an assignment test, so the reason is worth writing down: the two
gates that decide this round, `V62-assignment-instrument` and `V63-assignment-reproduces-the-lane`, are
produced by `pnpm eval:pack-assign` from an artefact that already exists, and **no dispatch emits them**. A
field that claimed them would be claiming a run that never happened; the first version of this file did
exactly that, `eval:protocol` refused it on the next push, and the correction is `AUDIT` §34.7.

The two gates are still gates, and their criteria are fixed here rather than in the module:

- **`V62-assignment-instrument`** — the arm is a truncation of the pack and not a second retrieval: one item
  at most, every question of the split asked, and the block changed on at least seven tenths of the prompts.
  Its criterion in code is `R36_BARS.minChangedShare`.
- **`V63-assignment-reproduces-the-lane`** — this reading agrees with the lane's own `arm_pairs` entry for the
  same pair to within a hundredth of a point on the delta and exactly on both discordant counts. Its
  criterion in code is `R36_BARS.tolerancePp`.

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

The adjudication is zero model calls. The replication is one dispatch at **`learn_sample = 280`**, the same
learning budget R25 used, so that the two stores are distilled from the same number of corrections per fold:
about 6,000 calls — 5 folds × 307 questions × 3 arms, plus the learning generations — against R25's 9,096
for the same split with four arms and an admission fit. The distillation cache is restored, so the store is
replayed where its prompts recur.

**The first attempt at this dispatch is recorded rather than deleted.** It was issued with `learn_sample`
left at its default, which the input description defines as *all*, so each fold learned from the whole
split, the lane forecast 13,328 calls against a cap of 9,000, and it stopped after fold 1 instead of
discarding the folds it had. The failure is a fact about this file: **a cost written down without the input
that produces it is not a cost** — 6,136 was arithmetic for a setting the registration never named
(`AUDIT` §34.4).

## Outcome — the adjudication half (read 2026-11-02, before the replication)

Four of the five predictions are decidable on the artefact R25 paid for, and the reading reverses the lead
it was registered to test.

| | claim | observed | |
|---|---|---|---|
| P1 | instrument: one item, the split, more than one database | 1 item at most and 1.00 on average; 73.9% of prompts differ from the pair; 1,534 questions over 11 databases | ✓ |
| P2 | the reading reproduces the lane's own contrast | −0.33pp [−1.65, +1.25] against the lane's −0.33pp; 42/47 discordant against 42/47 | ✓ |
| P3 | the one-rule pack does not clear the hurdle | clearance **0.672** on a hurdle of 1.335, against **0.737** for the pair | ✓ |
| P4 | the second item is worth more than two repairs per break | **23** repairs carried and **27** breaks caused — **0.85** per break | ✗ |
| P5 | the null replicates on a fresh store | **−0.07pp [−1.34, +1.20]**, 38/39, upper bound 0.80pp under the bar | ✓ |

**The lead does not survive assignment.** `full-one` against `full` is **−0.33pp [−1.65, +1.25]**, so the
cluster-robust interval excludes the +2pp this file registered as material by 3.7pp. The observation it
contradicts is visible in the same artefact: the 401 questions retrieval served one rule broke **9 of 212**
(4.2%) where the 1,133 served two broke **52 of 665** (7.8%), while both groups repaired at 9.5% and 9.0%.
The +3.13pp was a break-rate difference between two populations, and giving the second population the first
population's pack size does not give it the first population's break rate.

**The fourth cell is the round's result.** The second rule carries 23 repairs and causes 27 breaks — a net
harm on its own record, which is exactly what R35's contrast appeared to license removing — and it also
**prevents 15 repairs and 24 breaks**, because the first rule answers differently alone. The four cells sum
to the measured −5 questions, and the sum is a test rather than a remark (`assignment.test.ts`). A pack is
therefore not a set of independent items, and "how many rules fit" is not a dial: the marginal item's effect
depends on which items are already present.

**Per fold, the interaction does not keep its sign.** The store is distilled one fold at a time, so the four
cells above are five readings rather than one, and the fix in advance was only that they be reported —
`foldsOf` groups rather than pools, because pooling is what would hide exactly this:

| fold | questions | repairs added | repairs given up | breaks added | breaks removed | net | Δpp |
|---|---|---|---|---|---|---|---|
| 0 | 307 | 5 | 7 | 4 | 6 | 0 | 0.00 |
| 1 | 307 | 1 | 6 | 8 | 9 | −4 | −1.30 |
| 2 | 307 | 5 | 4 | 4 | 7 | +4 | +1.30 |
| 3 | 307 | 2 | 3 | 4 | 0 | −5 | −1.63 |
| 4 | 306 | 2 | 3 | 4 | 5 | 0 | 0.00 |

The rows sum to the pooled −5 (identity, asserted at both levels), and the per-fold intervals are reported
beside them: every one of the five spans zero. The single row that comes closest to deciding anything is
fold 3 at **−5 questions, [−2.55, −0.66]pp** — the only fold whose interval excludes zero on this draw.

**The replication, and what it does to the per-fold reading.** The second store draw landed after the table
above was first read, and it changes how the table should be described. It reads **−0.07pp [−1.34, +1.20]**
on the same 1,534 questions, 38 gained against 39 lost, so **P5 holds**: the upper bound is 0.80pp under the
2pp bar this file fixed in advance, and the null replicates. Two further facts carry over unchanged — the
second item is a net harm again (**20 repairs against 23 breaks**, 0.87 per break, against 23/27 and 0.85),
and one rule again clears less of the hurdle than the pair (**0.708 against 0.721**). The marginal item's
sign is the stable quantity; the pooled contrast is not.

The folds are the same questions in both artefacts — the split is seeded, 0 of 1,534 questions change fold —
so the two per-fold tables are **paired**, and the pairing says more than either table alone:

| fold | questions | first draw | second draw | keep sign | first spans zero | second spans zero |
|---|---|---|---|---|---|---|
| 0 | 307 | 0 | −2 | — (first is exactly zero) | yes | yes |
| 1 | 307 | −4 | −1 | yes | yes | yes |
| 2 | 307 | +4 | +5 | yes | yes | yes |
| 3 | 307 | −5 | −1 | yes | **no** | **yes** |
| 4 | 306 | 0 | −2 | — (first is exactly zero) | yes | yes |

**This corrects the reading the table had on its own.** Three of five folds keep their sign and the two that
do not are exactly zero on the first draw, so the per-fold sign is *not* a fresh draw per store — the folds
are the same questions, and a fold that leans one way leans that way again. What does not survive is the one
thing a per-fold table is for: **the only fold whose interval excluded zero (−5 questions, [−2.55, −0.66])
covers zero on the second draw at [−2.93, +2.06]**, and the fold that is positive on both draws (+4, +5) spans
zero both times at [−1.58, +4.33] and [−1.76, +5.37]. So the honest statement is narrower than "the sign is
drawn per store" and, for the count lever, just as final: **no fold in either draw yields an effect
distinguishable from zero, and the single fold that appeared to on one draw does not on the other.** A
quantity with no decidable fold has nothing to calibrate against. Recorded as `AUDIT` §34.6, because the
stronger wording was already written into four documents before the second draw was read.

**Disclosed, because it was found while writing this and it changes a published interval.** R35's outcome
table quotes the dev cell of this contrast as +3.13pp **[+0.62, +5.23]**; recomputing it here gives
**[+0.87, +5.23]** at the module's default 2,000 resamples. The point estimate is identical to the digit and
the upper bound to 0.004pp; the lower bound moves because R35's dev rows were produced at **400** resamples
while everything else in that round used the default. It is recorded as `AUDIT` §34.2 rather than silently
restated, and R36 uses the default everywhere.

**What a P4 refutation licenses, by the rules written above.** *"The second item is a net harm in its own
record; capping at one should have helped the break rate and did not, which means the loss is not in the item
count but in what the items say."* That is what happened: truncation removes 27 breaks and 23 repairs and
instates 24 breaks and 15 repairs, and the two pairs almost cancel — and the second store draw repeats the
marginal item's record (20 against 23) while repeating none of the pooled contrast's magnitude. The count
lever is closed on two draws; the grain lever is the only one left.

**Verdict: four of five predictions hold and the refuted one is the round's result.** P1 and P2 hold the
instrument, P3 holds that truncation does not pay, P5 holds that the null replicates on a second draw, and
P4 is refuted — which is what licenses the sentence above. The gates this file
registered are two — `V62` (the arm is a truncation) and `V63` (the reading reproduces the lane) — and they
stay two: P5's threshold is a prediction, and its numbers are carried as CI assertions rather than promoted
to a gate the file did not register.
