---
id: R12-own-case-probe
step: R12
opened: 2026-10-31
arms: none,full-verified
sample: 350
gates: V1,V13,V14
---

# R12 — has the store ever demonstrated anything?

## Why this file exists, and what it costs

Twelve iterations have measured what the pack does to a *question it was not learned from*, and the
answer is now stable: −1.37pp on 1,534 dev questions, no coverage threshold makes it positive (the
best gate, which keeps 12.6% of questions, reaches −0.13pp), and both the on-topic and the off-topic
halves lose about the same amount. Every one of those measurements assumes the stored rules are
worth injecting. None of them tests that assumption.

The instrument to test it has existed since the probe was written (`rule-probe.ts`) and has never
run on BIRD: `rule_probe` is `null` in both committed artefacts. It is cheap because it never
touches a held-out question — it re-asks each *corrected* learn question twice, once with a blank
retry and once with the rules that correction produced:

|                  | retry alone right | retry alone wrong |
|------------------|-------------------|-------------------|
| with rules right | `redundant`       | `supplied`        |
| with rules wrong | `broke`           | `useless`         |

Two calls per corrected case, on learn rows only. On the 350-question split that is roughly 100
cases and 200 calls, against 3,190 for a two-arm dev run. This is the cheapest question the project
has ever asked, and it is the one that decides whether the last twelve iterations were measuring a
mechanism or a noise generator.

## Prediction

- **`supplied` ≥ 20% of measured trials.** At least one corrected case in five comes back only when
  its own rules are shown. Below that, a distilled rule cannot reproduce the event it was distilled
  from, and "the pack does not transfer" is a second-order question about a first-order failure.
- **`broke` ≤ 15% of measured.** A rule shown its own source case should rarely destroy a case the
  retry alone would have repaired. This is the sharpest available evidence of a *wrong* rule rather
  than an unhelpful one, so it is predicted small and reported exactly.
- **`blankFixRate` between 20% and 60%.** The retry channel alone repairs a fifth to three-fifths of
  its own failures — the range three earlier runs measured on the retry arms (+0.57 to +1.14pp on
  different populations). If it comes back near zero, the retry prompt is not doing what its
  measurement assumes and the four verdicts are not comparable with anything.
- **`kept` ≥ 25% of the active store.** A gate that admits almost nothing turns `full-verified` into
  `none` under a second name, and the arm's number would then describe an empty pack rather than the
  admission rule. The count is predicted to land above a quarter so that the arm retains meaning.
- **Instrument.** ≥ 80% of planned trials reach a verdict (an unanswered call is a hole, not a
  negative), and V13 reconciles every rule into exactly one of the four admission buckets.

## Refutation

- **`supplied` = 0, or `broke` ≥ `supplied`.** Then single-correction distillation is refuted as a
  source of knowledge, and no further injection variant — retry timing, retrieval scorer, budget,
  form — is worth dispatching. The alternatives are named now so the next stage is a test and not a
  search: (a) consolidate near-duplicate corrections into claims with more than one observation
  before storing them, so that `minEvidence` has something to admit; (b) stop distilling per
  correction and admit only what the workspace has got wrong twice.
- **`kept` < 10% of the store.** The verified arm is `none` with extra steps. The accuracy
  comparison is void by construction and only the probe's verdicts are reported; the arm is not
  re-dispatched with a looser admission rule until a different admission rule is pre-registered.
- **`blankFixRate` < 5%.** The retry prompt is not repairing what the retry arms claim it repairs,
  and the `redundant`/`broke` split is an artefact of a prompt that never helped. In that case the
  probe is reported as an instrument failure and no claim about extraction is made from it.

## What a positive result would license, and what it would not

If `supplied` clears the bar and `kept` keeps a quarter of the store, the product statement moves
from "the pack is an in-database prompt" to "the pack is an in-database prompt that is admitted only
by reproducing its own case", and the next dispatch is the accuracy comparison at dev scale, three
arms, no new construction.

It would **not** license a SOTA claim: 350 questions cannot resolve a two-point difference, the
verified arm is a filter on a store that is already net-negative, and a filter that removes harm is
a smaller loss rather than a gain. The claim that would need a new pre-registration is that the
verified store is *positive*.
