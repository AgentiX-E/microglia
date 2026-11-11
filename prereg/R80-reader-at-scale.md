---
id: R80-reader-at-scale
step: R80
opened: 2026-11-11
arms: sample-5-first,sample-5-assert
sample: 1534
gates: V18,V19,V69
---

# R80 — the written reader, at a population that can see it

**Registered** 2026-11-11 **before dispatch**. It is R73's own recommended next step, taken at the size
R73's arithmetic asks for, and it is registered separately rather than as an amendment because the
population is a different claim: R73 read 350 questions, this reads 1,534.

## Why this file exists, in R73's own numbers

R73 wrote three assertions per question with one model call and executed them arithmetically against
R70's pool. The strongest signal was `assertion-hits` at **AUC 0.581, 95% [0.492, 0.667]**, top-pick
**29.57%** against `sample-5-first`'s **26.09%** — four questions out of 115. The branch was *the writer
is not the price*, and the file's closing sentence was that the mechanism "is not refuted either — it is
underpowered by construction":

> A 115-question population with 252 pairs detects an AUC of about 0.59 and nothing smaller, so this
> run's *effectiveness* is bounded by its *size*.

**That is a sample-size statement and it is arithmetic, not hope.** An AUC of 0.56 needs roughly 280
discordant pairs at 80% power against a two-sided 0.05; R73 had 252 pairs and a measured 0.581 whose
interval was ±0.088 wide. The eligible population is 32.9% of the split, so the smallest question count
that yields ~500 eligible is about 1,520 — and `dev` is 1,534. This file buys nothing new mechanically:
the same writer, the same three kinds, the same arithmetic reader, the same control.

## The design, exactly

- **Population:** BIRD `dev`, all 1,534 questions, 5 folds, `learn_sample = 64` — the configuration of
  `eval/results/poc-sota-bird-dev.json`, which is the published cell. The `none` arm therefore re-buys
  the **57.63%** this project's leaderboard row reports, and every contrast in this file is paired
  inside the run rather than against another day's file.
- **Arms:** `none`, `full` (the two the lane always measures), `sample-5-first` and `sample-5-assert`.
  The control is in the header because a header that names only the treatment lets a dispatch omit the
  control — R66's lesson, recorded in R73's Amendment 1.
- **The writer:** one call per question, shown the task prompt verbatim and the *shapes* of the five
  draws (columns, row counts, whether the result executed), never the SQL and never the verdict.
  Assertions are cached by prompt hash under `assertions-deepseek-flash`, so a fold that re-asks a
  question another fold already wrote for pays nothing.
- **The reader:** free and deterministic. A candidate scores how many assertions it satisfies; ties
  break to the earlier draw. `column` is column presence, `value` is literal containment in the
  result's own values, `rows` is the row count.
- **Two readings beside the treatment.** The dev-scale five-draw ceiling (`oracle − first`), which is
  the number that bounds *every* selection experiment this project could run at this baseline and is
  currently known only from 350-question slices; and the pool itself, which becomes a reusable artefact
  that later content and shape readers can score for zero calls.

## Prediction

- **Eligible population ~505 questions (460–550).** R73 measured 32.9%; the same split and the same
  temperature should land within a point of it, and a number far from it is a fact about `dev` rather
  than about the reader.
- **`assertion-hits` AUC 0.54–0.68, with an interval that excludes 0.5** — the same interval R73
  measured, narrowed from ±0.088 to about ±0.045 by the population. The registered claim is the
  *interval*, not the point: R73's 0.581 was never distinguishable from chance and this run exists to
  find out whether that was the population or the mechanism.
- **Top-pick gain over `sample-5-first` of +1…+5pp on the eligible population, and under +1.5pp on all
  1,534.** R73's +3.48pp came from four questions; at five times the population the same rate would be
  about +3.5pp with a ±2pp interval, and the whole-split number is that divided by the eligible share.
- **The ceiling on dev is 7–11pp.** Two 350-question slices measured 8.86 (R67) and 8.57 (R70); the
  prediction is that the number does not move with the population, only its interval.
- **Instrument:** `none` reproduces the published 57.63% within ±1.4pp (the 95% interval of 1,534
  questions), parse rate ≥ 99%, gold execution ≥ 99%, and at least 1,400 of 1,534 questions produce at
  least one parseable assertion.

## Refutation

Ordered, and partitioning on the pair (AUC interval, eligible top-pick gain).

- **Void** — fewer than 1,300 questions produced a parseable assertion, or the eligible population is
  under 380, or `none` misses the published cell by more than 1.4pp. Then the writer met the questions
  it found easy, or the population is not the one the leaderboard row was measured on, and no reading
  here describes the mechanism.
- **The reader pays** — the interval excludes 0.5 **and** the eligible gain is at least +3pp. Then
  written assertions are the lane's first selector with an interval behind it, `sample-5-assert` becomes
  the default over draws, and the next registration prices the writer's *input*: schema-only against
  schema-plus-result-shapes, to find what the assertion needed to know.
- **The reader is small** — the interval excludes 0.5 and the gain is under +3pp. Then reading converts
  a measured but sub-point fraction of the ceiling, the free-reader conclusion stands with a price
  attached, and the next money goes to generation rather than selection.
- **The reader is absent** — the interval straddles 0.5 at ~505 eligible questions. Then no per-question
  reader — free, cheap or written — recovers the gap on this corpus at this baseline, the selection line
  closes on a *population* rather than on a mechanism, and the programme moves to the one generation
  lever that has never been tried here: **decomposition**, which changes the prompt rather than the
  sampling distribution.

A number that lands between the bars is reported as measured and adopts no line.

## Cost, and the band it was dispatched in

Forecast **12,600 calls** — 1,534 × (1 `none` + 1 `full` + 5 draws + 1 writer) plus 320 learning calls —
under a **15,000** ceiling and a 300-minute deadline. At the peak rate this dispatch was launched in,
that is about **$2.0**; the identical run inside the off-peak window is about **$1.0**.

**The band is stated because it is a choice and not an accident.** `pnpm eval:band` printed
`06:1x UTC is peak — off-peak from 10:00 UTC` before the first call, and the run was bought anyway: it is
the only dispatch that reproduces the dev cell, prices the reader at a detectable population and leaves
a reusable 7,670-candidate pool behind it, and the next off-peak window is four hours away. The number
this costs is written here rather than discovered on the invoice.
