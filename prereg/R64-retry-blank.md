---
id: R64-retry-blank
step: R64
opened: 2026-11-09
arms: retry-blank
sample: 1534
gates: V1,V2,V3,V4,V5,V6,V7,V8,V12,V32,V44,V48,V51
---

# R64 — the arm whose number is prose, measured on the population it is about

**Registered** 2026-11-09. **Amended** 2026-11-09 before dispatch: the population this registration
was written around is 6.4% of the questions, not 47% of them. See Amendment 1.

## Why this file exists

`retry-blank` is self-correction with no memory: the retry prompt carries the failed attempt and the
execution error, and an empty pack. It is the mechanism arXiv:2606.29733 reports at **+3.06pp
(p=2e-11)** on CodeLlama-7B and **+3.65pp (p=6e-11)** on Llama-3.1-8B, and it is the arm R17 quotes at
**+0.57pp with 2 gained and 0 lost**.

That reading cannot be checked. `grep -rl retry-blank eval/results/` returns nothing, and so does the
repository's history: the dispatch that produced it left no artefact. Two of the two non-negative
readings this project has ever recorded for any arm family are retry arms, and both of them are prose.
So this registration is not for a new mechanism — it is for the evidence of an old one.

## The design, and why the population is the failures

Comparing `retry-blank` to `none` over all questions spends most of its sample on questions where the
first answer was already right and no retry was made. The quantity the mechanism is about is defined
only on the questions that failed:

  repaired      first answer wrong, retry right
  regressed     first answer right — then the question was never retried, so this is zero by
                construction on the retried population, and the population is defined by failure
  repaired rate repairs / retried

At minidev with a base accuracy near 53%, about 165 of 350 questions fail, so the repaired rate is
resolved to roughly ±7pp at 95% — enough to separate "the mechanism does nothing" from "it repairs a
third of failures", which is the published range. The mean delta over all 350 is *also* reported, and
the registration says in advance that it cannot resolve 0.57pp: at n=350 the smallest detectable paired
effect is about 6pp, so a null there is a null about power, not about the mechanism.

## Prediction

- **The retry fires.** At least **40%** of the 350 questions produce a first answer that fails to
  execute or scores wrong, so the retried population is at least 140 questions. A lower share means the
  base accuracy moved and this registration's population is not the one it was written for.
- **The repaired rate is between 15% and 45%**, with the point estimate **above 25%**. The published
  per-failure reading is in this range on models with more headroom; ours has less, so the lower half
  of the band is the expected one.
- **The arm's net over `none` is positive but unresolved**: a point estimate between 0 and +4pp with an
  interval that includes zero. This is what a +0.57pp mechanism looks like at n=350 and it is not
  evidence against the mechanism.
- **`retry-keyed` is not dispatched here.** One mechanism per registration; the failure-keyed
  retrieval is a memory arm and belongs to a registration that names a pack.
- **The bill is computable and the run is off-peak**, for the same reason R63 states: a run that cannot
  state its cost cannot be scheduled.

## Refutation

- **The retry line is promoted** if the repaired rate's lower bound exceeds 25% **and** the net delta
  is positive. The next stage is a registered comparison of `retry-blank` against `retry-keyed` on the
  same retried population, which prices what memory adds *at the moment a failure exists* — the one
  place this project has never been able to measure memory cleanly.
- **The mechanism is closed** if the repaired rate's upper bound is below 10%, or if the net delta is
  negative with an interval excluding zero. A retry that damages more than it repairs is a mechanism
  the product must not ship, and the prose number in R17 is then wrong rather than merely unevidenced.
- **The run is void** if the retried population falls below 140 questions, because the registration's
  band was computed for that population and a different one is a different test.
- **A null with an interval that includes both 0 and +4pp is the registered outcome, not a refutation.**
  It is written here so that the next reader does not have to decide after the fact whether a small
  positive was a failure.

The alternatives are named so the outcome selects one. The specific risk this registration exists to
prevent is the one R17 already suffered: an arm that measures non-negative, gets quoted for twenty
rounds, and has no artefact to re-derive it from.

## Amendment 1 — the population is not the failures, and it is not 140 (2026-11-09)

This registration says "the population is the failures" and predicts that at least 140 of 350
questions will be retried, on the reasoning that a 53% base accuracy leaves about 165 wrong answers.
That reasoning is wrong, and it is wrong in the direction that would have wasted a dispatch: a retry
arm does **not** act on every question whose answer was wrong. It acts on the questions the pipeline
itself rejected — no query, an execution error, or a result set with no rows — because those are the
three facts a deployment can see without the answer key. A confident wrong answer is not retried.

Measured, at zero model cost, from artefacts already in this repository:

```
$ BIRD_DIR=… RETRY_ARTEFACT=eval/results/poc-sota-bird-R63-recall-order.json pnpm eval:retry-population
[retry] … split=minidev retried=26/350 (7.43%) no-query=0 error=1 empty=25 repairable=26 floor=140 meets=false
$ BIRD_DIR=… RETRY_ARTEFACT=eval/results/poc-sota-bird-dev.json pnpm eval:retry-population
[retry] … split=dev    retried=98/1534 (6.39%) no-query=0 error=9 empty=89 repairable=98 floor=140 meets=false
```

So the registered floor of 140 questions **cannot be reached on `dev` either** — 98 is the whole
population there — and on minidev it would have been missed by a factor of five. The floor was not
wrong about the arithmetic; it was wrong about what the population is.

### What the amendment changes

- **Split `minidev` → `dev`.** 98 retried questions is the largest population available from a split
  whose whole cost is affordable (about 9,300 calls including the mandatory `full` arm and its
  distillation). `train` would reach ~510 and costs four hours of a CI job that has a 130-minute
  deadline.
- **Floor 140 → 90**, with the resolution stated rather than hoped for: 98 retried questions resolve a
  repaired rate of 10–20% to about ±7pp, and a population delta of +0.5pp to about ±0.4pp. That is
  enough to separate "the mechanism does nothing" from "it repairs a fifth of what it touches", and
  not enough to resolve the 0.57pp R17 quotes — which this registration already said.
- **The predictions become arithmetic over the measured population** rather than over a guess:
  retried 90–110 of 1,534 (a fresh sample moves the share a little), repaired rate 10–40%, net delta
  0…+1.5pp with an interval that may include zero.
- **Void below 80 retried questions.** A smaller population means the model changed enough that the
  dev split no longer measures the pipeline this registration describes.

### What the measurement also changed about the question

The composition was measured in the same pass, and it says the retry population is not what the
schema-linking work in R63 was about:

```
[retry] empty-results: examined=89 same-tables=54 (60.67%) value-miss=32 (35.96%)
        ranking-miss=5 missing-table=19 extra-table=16
```

Of the 89 empty results, **54 read exactly the tables the gold query reads**, and **32 of those are
missing a value the gold query uses** — the classic empty result, where the filter was written with a
spelling the database does not have. Only 35 of 89 are table-selection misses, which is the bucket
R63 has just measured as not moving (`recall-order` +0.86pp, p=0.65; `linked-additive` +2.00pp,
p=0.14).

That does not change this registration's endpoint — the arm is still `retry-blank`, and it still
measures repair rate — but it changes what a positive result would mean, and it is why the next
registration in this line is about **values** rather than about schema text. Writing it down before
the dispatch is the point: after a positive result, "the retry helped because it re-read the
question" and "the retry helped because the second attempt found the right spelling" are
indistinguishable from the arm's delta alone.

## Outcome — 2026-11-09, run `42661260446` (`eval/results/poc-sota-bird-dev-R64-retry-blank.json`)

| reading | value |
| --- | --- |
| split / n / folds | `dev` / 1,534 / 5 |
| calls / retries / call failures | 5,241 / 0 / 0 |
| bill | $0.44, cache hit 73.79%, band `off_peak` |
| `none` | 56.71% |
| `full` | 56.78%, **+0.07pp** [−1.63, +1.76], p = 1.00, 87 gained / 86 lost |
| `retry-blank` | 58.02%, **+1.30pp** [+0.78, +1.89], p < 1e-4, **20 gained / 0 lost** |
| retried population | **98 / 1,534 = 6.39%** (`empty` 88, `error` 10, `no-query` 0; 98 of 98 wrong) |
| repaired rate on that population | **20 / 98 = 20.41%** [13.27, 28.57], p = 1.9e-06 |
| repaired, by trigger | `empty` 19 / 88 = 21.6%; `error` 1 / 10 = 10.0% |
| repaired, by difficulty | simple 14 / 49, moderate 5 / 41, challenging 1 / 8 |
| gained, by fold | 1, 3, 5, 6, 5 |
| `retry-blank − full` | **+1.24pp** [−0.52, +3.00], p = 0.183, 101 gained / 82 lost |

**The predictions, as amended, all held.** Amendment 1 predicted 90–110 retried questions, a repaired
rate between 10% and 40%, and a net delta between 0 and +1.5pp. Measured: **98**, **20.41%**,
**+1.30pp**. The zero-cost measurement made from the R63 artefact predicted `98 retried (error 9,
empty 89)`; the run produced `98 (error 10, empty 88)`. One question moved between two trigger
buckets, and the total did not move at all — which is the smallest possible error for a measurement
that spends nothing.

**The mechanism is neither promoted nor closed, and both bars are the registration's fault.**

- *Promotion* required the repaired rate's lower bound to exceed 25%. The lower bound is 13.27%,
  because 98 questions resolve a rate near a fifth to ±7.6pp. The document had already said this:
  the prediction band was 15–45% "with the expected value in the lower half", because this model has
  less headroom than the published ones. A promote bar of *lower bound > 25%* at n = 98 requires a
  point estimate near **35%** — the upper half of the band the same document predicted against. The
  bar and the prediction were written in one file, one page apart, and they test different worlds.
- *Closing* required the upper bound to fall below 10%. It is 28.57%, so nothing is closed either.

What the run does establish is narrow and solid: **on the 6.39% of questions the pipeline itself
rejects, a blank retry repairs one in five** (19 of 88 empty results, 1 of 10 execution errors), the
gains are spread across all five folds (1, 3, 5, 6, 5), and nothing regressed — 20 gained, 0 lost, on
1,534 questions. The effect is real; it is also **bounded by its population**: even a retry that
repaired every rejection would move this benchmark by **+6.39pp**, and this one moved it by +1.30pp,
which is 20% of that ceiling. The ceiling is now a measured number rather than an inference, and it is
the number that should govern how much further work this line deserves.

**`full` is null on the fourth split.** Adding 1,534 dev questions to the record moves the memory
arm's reading to +0.07pp with 87 gained and 86 lost — the same shape as `minidev`, `train` and the
original panel. Whatever `full` does, it does not do it here.

**Two defects found by reading the artefact against the registration.**

1. `retry_population.meetsFloor` is **false**, because `SOTA_RETRY_FLOOR` still defaulted to the
   pre-amendment 140. The amended floor is 90 and 98 clears it. The constant is fixed in this
   iteration, with the amendment cited at the definition, because a registration that changes a
   threshold has to change the code that reads it — otherwise the artefact records a verdict the
   document does not hold.
2. The promote bar above. It is recorded here rather than quietly relaxed: the next registration in
   this line states its promotion threshold as *a point estimate above X with an interval excluding
   zero*, both chosen inside the predicted band, so that clearing it is possible for a result the
   document predicted.

**What this buys the next registration.** Amendment 1's composition measurement said the empty
results are 60.67% table-correct and 35.96% value-missed; this run says the repairs are concentrated
exactly where that analysis pointed — 19 of the 20 repairs are empty results, and the one repair in
the `error` bucket came from a question the model could re-answer rather than re-spell. The retry
line therefore has one cheap next step (the value-missed fifth of the empty results) and one
registered one (`retry-blank` against `retry-keyed` on this same 98-question population).
