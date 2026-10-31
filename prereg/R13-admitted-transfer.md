---
id: R13-admitted-transfer
step: R13
opened: 2026-10-31
arms: none,full,full-verified,full-transferred
sample: 350
gates: V1,V13,V14,V15,V16,V17
---

# R13 — does an admitted rule repair a question it was not written from?

## Why this file exists

R12 asked the store to reproduce its own corrections and got 12.2% `supplied`, 66.0% `useless`.
That locates the deficit in the extraction — a correction read into a sentence usually cannot
reproduce itself. It does not answer the question the product rests on, which is whether a rule
that *does* reproduce its own case is knowledge or a lookup table with one row.

That is the last memory-axis question the design has not measured. Three earlier iterations
measured the same boundary from other sides: R9 fitted a rule's value at +1.33pp inside its own
database and −2.27pp across one; R10 found the distilled sentence has no referent away from home
(66.8% unbindable); R11 found the structure is bindable and the column is not (62.3% withheld, 60%
of them a column the target database does not have). All three measured *why a rule cannot travel
to another database*. None of them measured whether it travels **within** one.

The number decides the next stage rather than decorating this one:

    repairs per question ≈ (rules admitted per pack) × (transfer rate)

At 0.39 admitted rules per question (R12), a 2% transfer rate is worth 2.7 questions of 350 —
inside the noise floor measured at one question. A 20% rate is worth 27. One of those says buy
more data; the other says change the substrate. There is no third reading.

## What changed since R12, and why each change is needed for this measurement

1. **A hole on the control call was being counted as evidence.** `TransferTrial.blankCorrect` was
   a `boolean`, so a blank call that never returned was recorded as "the retry alone was wrong".
   That filed the trial in the *informative* denominator and credited the rule with any repair it
   produced — the one direction this statistic must never move in. It is now `boolean | undefined`,
   `transferSummary` requires both halves to have returned, the summary carries `unmeasuredBlank`,
   and `transferringItemIds` requires an explicit `false` before it calls anything a repair. V15's
   reading names the control-side holes so the count is visible rather than averaged away.
2. **The ledger is kept.** Each pair is written to the artefact as `[item, target, blank, rule]`.
   Every later question about this measurement — is a repair concentrated in one database, did one
   rule repair three targets — is a question about the ledger, and answering it by re-dispatching
   would cost a run.
3. **`learn_sample` 128, not 64.** Transfer draws its targets from the corrected cases of the rule's
   own database *within its own fold*, because both halves of the pair must be learn rows. At 64
   learn rows per fold that pool is ~31 corrections over 11 databases — 2.8 per database — so 38
   admitted rules could not have produced the 100 informative trials the resolvability floor asks
   for. At 128 the pool doubles to ~62 per fold, which is the cheapest change that makes the
   measurement resolvable without touching the evaluation split.
4. **`SOTA_TRANSFER_TARGETS` 8, not 4.** Four targets per rule was sized for 294 admitted rules
   (iteration 96's store). R12 admitted 38, so four targets would have produced 152 trials and a
   rate whose numerator is two or three repairs. Eight targets against a pool of ~5 per database
   per fold yields the same trials from a larger per-rule draw.

The cost of (3) is a larger store and a second sample of `full`, so **`full`'s absolute accuracy in
this run is not comparable with R12's or with the dev artefact**. The arms are paired inside this
run and every claim below is a within-run comparison. That is stated here, before the numbers, so
the difference is not explained afterwards.

## Prediction

- **Informative ≥ 200 of the planned trials.** The blank-retry channel repairs 21.8% of its own
  failures (R12), so ~78% of any trial set is informative. Below 200 the rate is a direction, and
  the floor (100) would be the binding constraint rather than the effect.
- **Transfer rate ≤ 6% of informative trials.** A rule reproduces its own correction one time in
  eight. A different question in the same database has a different failure, a different vocabulary
  and a different join path, so it should be repaired more rarely still — if the extraction is
  producing a statement about *that question* rather than about the schema it ran against.
- **At most 4 admitted rules repair anything.** With 38 rules in the R12 store and a rate near 3%,
  the number of rules with at least one repair is in the low single digits, and a count of ten
  would mean the repairs cluster rather than scatter.
- **`full-transferred` carries ≤ 0.10 rules per question.** The arm is the intersection of two
  gates. If the intersection is empty on most questions the arm is `none` under a third name, and
  the reading must say so rather than reporting its accuracy as a result about transfer.
- **`full-verified` holds at |Δ| ≤ 3pp against `none`.** R12 measured 54.00% against 54.00% at
  n=350. A second sample of the same arm on a larger store either reproduces "the gate removes the
  harm" or shows that the first reading was one sample.
- **Instrument.** V15 reconciles every trial, V16 is satisfied, V17 passes, and control-side holes
  are ≤5% of trials. V13 must reconcile every rule into one of its four admission buckets; it is
  blocking, and the dry run in R12 is why it still is.

## Refutation

- **Rate ≥ 15% of informative trials (≥30 repairs at 200).** Then a rule written from one
  correction does generalise to another question in its database, and the store is too *small*
  rather than empty. The next stage is more corrections — `learn_sample` at dev scale, not a new
  construction — and the product statement becomes "in-database prompt, and the binding constraint
  is data".
- **Rate ≤ 1% while the own-case probe stays near 12%.** Then the two rates differ by an order of
  magnitude and the substrate is a demonstration rather than knowledge: a distilled sentence
  reproduces the event it came from and nothing else. Per-correction prose is refuted as a memory
  form, and the next construction renders the *pair* — question, failed query, corrected query —
  instead of a sentence about it. This is the outcome the accumulated record predicts, and naming
  it now is what makes the next iteration a test rather than a search.
- **Informative < 100.** Instrument failure. No claim about the substrate is made from this run,
  the transfer arm is reported as `unmeasured`, and the cause is diagnosed before anything else is
  dispatched.
- **Control-side holes > 15% of trials.** The provider is not answering consistently enough for a
  paired design. The run is reported as an instrument failure even if the rate looks decisive,
  because a rate computed over the trials that happened to return is a rate about the endpoint.

## What a positive result would license, and what it would not

Repairs at ≥15% with ≥200 informative trials would license one product sentence — *an admitted rule
repairs other questions in its own database, so the constraint is the number of corrections* — and
one dispatch: the dev split, three arms, `learn_sample` raised, no new construction.

It would not license a SOTA claim. The transfer arm keeps at most a handful of rules; it cannot
move a 1,534-question cell by a resolvable amount, and this benchmark's gold still contains no
convention the model cannot infer from the DDL. What the claim would need is a store whose admitted
rules number in the hundreds, which is a data question, not a protocol one.
