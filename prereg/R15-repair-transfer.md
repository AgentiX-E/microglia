---
id: R15-repair-transfer
step: R15
opened: 2026-10-31
arms: none,full,full-transferred,full-repair-transferred
sample: 350
gates: V1,V13,V14,V15,V16,V17,V33,V34,V35,V36,V37,V38,V39,V40,V41,V42
---

# R15 — does the pair travel, or does it only reproduce?

## Why this file exists

R14 put a second substrate under the probe and got the largest difference this project has measured:
a pair-rendered repair reproduces 53.80% of the correction it was learned from against a sentence's
30.69%, +23.10pp, p = 1.05e-14, five folds in the same direction. It also answered one question the
other way: the gated arm built from that store, `full-repair-verified`, moved the held-out cell by
−0.29pp. Reproduction and usefulness came apart, and R14 said so:

> reproduction is a property of the extraction, and the arm's cell is a property of what the
> extraction is worth on questions the store was not written from.

That sentence names the measurement it defers. R13 made it for the sentence substrate and only for
the sentence substrate: 118 admitted rules, 98 with a home database, 523 trials, 467 informative, 34
repaired (7.28%), 28 broken, `break_rate` 0.50, net marginal +1.15pp, and a transferred pack that
carried 10 rows across 350 questions. The repair store has never been asked. So the one question a
reader of R14 and R13 together cannot answer is the one the product turns on:

    repairs per question ≈ (pointable admitted items / questions) × (transfer rate)

For the sentence: 98 pointable items over 350 questions, 7.28% of the trials they could be part of,
10 rows that survived both gates. For the pair: 128 admitted of 303, 271 pointable. Whether the
second number is the first number or three times it decides whether the substrate axis is a lever or
a curiosity, and R14 cannot be read either way without it.

## What changed to make this a measurement rather than a second dispatch

1. **The probe is asked for by the arms that consume it.** `full-transferred` consumed
   `probe.transfer` but only `full-verified` paid for the probe, and `full-repair-transferred`
   consumed `probeRepair.transfer` while only `full-repair-verified` bought it. A dispatch naming
   only the transfer arm would therefore have injected the *transferred* set of a probe that never
   ran — an empty pack, `none` under a second name, reported as a reading. This is the same defect
   class R13 found in the ledger (a field nobody writes) and R12 found in the admission gate (a
   verdict nobody recomputes). Both arms now request their own probe, and the substrate comparison
   is computed whenever both probes ran rather than whenever an arm happened to.
2. **One gate function, four ids.** `transferGates` is shared between the two substrates, because
   the second one exists only to be set beside the first: a repair measured by a lighter rule
   produces a number that cannot be compared. The ids (V39–V42) are arguments, so the published
   ids V15/V16/V17/V33 cannot be renamed by a refactor of the shared body.
3. **The second substrate's ledger reaches the file.** `rule_transfer_repair` is projected from the
   same fold records through the same `transferArtefact` function as `rule_transfer`, and V41 refuses
   a run whose rows did not survive the projection. R13's first transfer run published a rate with
   no pairs behind it; that failure is now blocking on both sides.
4. **Same controls, same runs.** Both stores are distilled from the same `learn` rows of the same
   fold and probed against the same foreign questions with one shared blank control per source
   question. The rule side is re-measured rather than quoted from R13, because R13 and R15 are
   different dispatches and a rate quoted across two of them would be a comparison of runs.

## Prediction

- **Instrument: ≥ 400 informative trials on the repair side.** R13 produced 467 from 98 pointable
  rules at `transfer_targets` = 8; the repair store admits 128 of 303 items of which 89.4% have a
  home database, so 400–700 is the expected range and below 400 the rate is quoted as a direction.
  V39 and V41 pass, or nothing below is a reading.
- **The pair transfers more often than the sentence: above 7.28%, expected 10–20%.** This is the
  hypothesis R14's separation leaves open: the account contains the mechanism (what the attempt did,
  why it returned a different answer, what replaced it) and the sentence does not, and a mechanism
  that reproduces its own case is a mechanism that can point at a foreign one. A rate inside
  7.28 ± 2pp is a tie, not a small win.
- **`break_rate` does not fall below 0.50.** R14 measured `broke` 11 for the sentence against 10 for
  the pair on the stores' own cases: the substrate did not reduce harm, and a longer account is more
  to follow rather than less. If damage tracks the amount of guidance in front of the question
  (≈1.7pp per item, W8), a pair-rendered item carries more of it per row, not less.
- **`full-repair-transferred` is a diagnostic and not a product: `pack_kept` ≤ 35 of ~640 rows
  (≤ 0.10 per question) and the cell within ±3pp of `none`.** R13's rule-side arm kept 10 of 640 and
  changed 349 of 350 packs — a gate that empties almost every pack satisfies "it was applied" while
  injecting nothing, which is why the kept count and not the differs count is the reading here.
- **The home-database ceiling holds: ≤ 12% of repair items without `scope.domain`.** R14 measured 32
  of 303 (10.6%); R13 lost 20 of 118 rules the same way. If the repair store loses more than 20%,
  the transfer rate is being measured on a subsample chosen by a rendering artefact and the ceiling
  becomes the finding.

## Refutation

- **Rate ≤ 7.28% at ≥ 400 informative trials.** The substrate axis is finished. Two substrates that
  differ by 23pp on reproduction and by nothing on transfer say that reproduction is not the property
  that travels, and no third rendering is bought: the next iteration is the dose curve (three pack
  sizes, one store), and after it the delivery question R14 already pointed at. This is the clause
  that ends the line rather than weakening it, and it is written before the number exists because
  after it every outcome will have a story.
- **Rate ≥ 14.6% (twice the sentence) with `break_rate` ≥ 0.50.** Content is not the constraint:
  a store that repairs twice as often and breaks as often has a net marginal effect near zero, and
  the finding is that harm is a function of quantity. That redirects the work to filtering by dose
  and leaves the substrate where R14 left it.
- **Informative < 400.** Instrument failure: no claim about the substrate is made, the rate is
  reported as `unmeasured`, and the cause is diagnosed in the target matcher
  (`transfer_targets_per_rule`) before anything else is dispatched.
- **`full-repair-transferred` moves the cell by ≥ 5pp.** Then the arm is a product candidate rather
  than a diagnostic, and it needs a replication dispatch before it is described as one. A single
  dispatch has produced a 5pp cell before and lost it in the next run.

## What a positive result would license, and what it would not

A transfer rate of 12–20% with a break rate near the sentence's would license one product sentence —
*the memory form decides how much of a correction is available, and the pair keeps twice as much of
it available on questions it was not written from* — and one dispatch: the dev split with the repair
form as the default distiller and the transferred filter as the default injection, `learn_sample`
raised. It would also license retiring the rule distiller as the default, which is the only
architectural change this project has left that is cheaper than collecting more data.

It would not license a SOTA claim. BIRD dev is 1,534 questions and this instrument is 350; the arm
that would carry a claim is `full-repair-transferred` at a pack size that is not near-empty, and that
arm's `pack_kept` is a prediction in this file precisely because a positive transfer rate with a
0.03 items/question arm would license the distiller and not the arm.

## Outcome

Filled in when the dispatch lands.
