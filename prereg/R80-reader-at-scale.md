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

## Outcome — the reader is real, and the sampling bill eats it (2026-11-11)

Dispatch `42971765502`, 06:20 → 07:27 UTC, **12,194 calls, $1.6272**, 1,534 questions, 11 databases,
5 folds, `learn_sample` 64, T = 0.7, cache hit rate 77.4%, no retry, no timeout, no failed call, every
gate passing. It was dispatched inside the peak window, so the same run off-peak is about **$0.81**; the
band lever is a dispatch field now (see below).

| arm | accuracy | against `full` |
| --- | --- | --- |
| `none` — no memory, one deterministic call | **57.24%** (878) | — |
| `full` — memory pack | 56.78% (871) | — |
| `sample-5-first` — the first of five draws | 55.93% (858) | −0.85pp [−2.35, 0.65], p = 0.32 |
| `sample-5-assert` — the written reader | **57.30%** (879) | +0.52pp [−0.98, 2.02], p = 0.55 |

**The two contrasts that decide the question, paired within the question:**

| contrast | reading | gained / lost |
| --- | --- | --- |
| `assert − first` | **+1.37pp [+0.52, +2.22], p = 0.0025** | 33 / 12 |
| `assert − none` | +0.07pp [−1.04, +1.17] | 40 / 39 |
| `full − none` | −0.46pp [−1.89, +0.91] | 55 / 62 |
| `first − none` | **−1.30pp [−2.41, −0.26], p = 0.025** | 26 / 46 |

**The written reader is the first selector in this project that is significantly better than the draw it
reads** — +1.37pp at p = 0.0025, on 1,534 questions, with 33 questions gained against 12 lost. R73 bought
the same mechanism at 350 questions and could not see it; R73's own closing sentence was that it was
underpowered by construction, and this is that sentence confirmed rather than contradicted.

**And the sampling bill eats the whole gain.** The first of five draws at T = 0.7 is **1.30pp worse than
one deterministic call** (p = 0.025), so a selector that recovers 1.37pp of it lands level with doing
nothing at all (`assert − none` = +0.07pp). The share reading says the same thing from the other side:

| | R67, 350 questions | **R80, 1,534 questions** |
| --- | --- | --- |
| selector | `sample-5-exec` (shape) | **`sample-5-assert` (written)** |
| first / selected / oracle | 50.86 / 52.00 / 59.71 | 55.93 / **57.30** / 63.30 |
| ceiling `oracle − first` | 8.86pp | **7.37pp** (113 questions) |
| captured `exec − first` | 1.14pp | 1.37pp |
| **share, 95%** | 0.13 [−0.27, 0.40] — inconclusive | **0.19 [0.08, 0.29] — CAPTURED** |

**The ceiling is 7.37pp at this population and the reader takes a fifth of it.** That is the first
positive, interval-excluding-zero share this project has measured, and it was bought with 5 model calls
per question (1,534 assertion writes for 2.99 assertions each). Its cost is in the same run: 12,194 calls
against `none`'s 1,534.

### The pool at 1,534 questions, and what the content signals do at 4.4× the population

`pnpm eval:pool --bird` on the same artefact, zero calls: 7,670 candidates, 7,669 signed, **distinct
answers per question mean 1.33, median 1** — 1,157 of 1,534 questions produced one distinct result across
five draws. The registered bar calls that **NARROW** (≤ 0.33 of the draws), and it is the same verdict R69
got at k = 10.

| signal | AUC, 95% | top-pick on 383 eligible |
| --- | --- | --- |
| `value-type` (shape) | **0.561 [0.541, 0.582]** | 29.2% |
| `column-shape` (shape) | **0.553 [0.532, 0.574]** | 29.2% |
| `empty` (shape) | **0.546 [0.528, 0.564]** | 28.5% |
| `row-shape` (shape) | 0.541 [0.519, 0.562] | 28.7% |
| `null-share` (shape) | 0.541 [0.521, 0.562] | 28.7% |
| `literal-match` (content) | 0.497 [0.490, 0.502] | 27.2% |
| `column-mention` (content) | 0.489 [0.460, 0.518] | 26.6% |
| `content-mean` (content) | 0.486 [0.456, 0.516] | 26.6% |

**Every shape signal now excludes 0.5 and every content signal still covers it**, at 4.4× the population
R71 read. So R71's `Content is not free` branch replicates with a tighter instrument, and R67's shape
family is not worthless after all — it is *small* (AUC 0.54–0.56 against 0.49–0.51) and it was
unmeasurable at 350 questions. A signal worth 0.55 AUC on a 7.37pp ceiling is worth about half of what the
written reader recovers, which is consistent with `exec`'s 1.14pp against `assert`'s 1.37pp.

### The predictions, scored

| prediction | registered | measured | |
| --- | --- | --- | --- |
| `none` within 1.5pp of the published 57.63% | 56.1–59.1% | **57.24%** | holds |
| parse rate | ≥ 98% | **100%** | holds |
| assertions written | ≥ 80% of questions | **1,534 of 1,534, 2.99 each** | holds |
| eligible population | ≥ 500 question(s) with ≥ 2 distinct | **383** | **fails, by 23%** |
| `assert` vs `first` | positive, interval excluding zero | **+1.37pp [0.52, 2.22]** | **holds** |
| `assert − none` | positive | +0.07pp | fails, level |

**The one prediction that failed is the one R73's arithmetic was built on**, and it failed for a reason
worth recording: "about 32.9% of the split will have more than one distinct result" was measured at
T = 0.7 on 350 questions and came in at **25.0%** here, because a colder five-draw pool collapses more
often than the 350-question slice suggested. The detection floor the file claimed (AUC ≈ 0.56) therefore
needed 1,534 questions and was reached anyway — the reader was detected at 0.0025 — but the pool that
feeds a cheap selector is smaller than the arithmetic assumed.

### What this licenses

**Candidate generation is now the binding constraint, and it is a prompt-shape problem, not a sampling
problem.** The selector works: it finds a fifth of a 7.37pp ceiling at 5 calls per question. What it
cannot do is find a ceiling that five draws of *one prompt* fail to open — 75% of questions never produce
a second distinct answer, and the first draw at T = 0.7 costs 1.30pp against the deterministic call. The
published systems that clear 70% do not spin one prompt; CHASE-SQL generates its candidates from a
divide-and-conquer decomposition, an execution-plan chain of thought and instance-aware examples, which
is three *different* prompts. That is the lever this file hands to the next registration, and it is the
one R70 named when it closed temperature: "different prompts rather than the same prompt spun harder".

**And the memory component is still null at this population**: −0.46pp [−1.89, +0.91] on the split the
leaderboard row is measured on, which is the same verdict R79 read on a different slice (−0.11pp).
