---
id: R70-temperature
step: R70
opened: 2026-11-10
arms: sample-5-first,sample-5-exec,sample-5-oracle,sample-5
sample: 350
temperature: 1.0
gates: V1,V2,V3,V4,V5,V6,V7,V8,V12,V18,V19,V32,V44,V48,V51
---

# R70 — the same five draws, hotter

**Registered** 2026-11-10, dispatched the same day as R69. This is **dispatch B of R69's original
design**, split out because a registration's header carries one temperature and R69's two dispatches
wanted 0.7 and 1.0: keeping them in one file meant the header lied to one of them.

The split is not cosmetic and it changed the instrument. `SOTA_SAMPLE_TEMPERATURE` was a **repository
variable**, which is the correct shape for a lane default and the wrong shape for an experiment — two
temperatures on a variable are two dispatches separated by a mutation that every queued run inherits.
The temperature is now a header key read by `eval:prereg-temperature`, exactly as the arms are read by
`eval:prereg-arms`, and the artefact records `config.sample_temperature`. Without that last part the
two dispatches would be indistinguishable from their numbers, which is the defect that made
`model_credential` necessary one iteration ago.

## Why this file exists

R67 established that five draws at T = 0.7 contain the right answer on **+8.85pp** more questions than
the first draw, and that no selector made of execution shape recovers any of it (seven AUCs, every
interval straddling 0.5). R69 asks whether *more* draws buy more pool. This file asks the other half
of the same question: whether the draws that already exist are **too alike**.

The two are not the same experiment and cannot be one dispatch. A hotter distribution changes the
pool and the baseline at once — the first draw is one of the draws — so the reading is a pair of
deltas and not a number: ceiling against R69's ceiling, and `first` against R69's `first`. That pair
is what decides whether temperature is diversity (both ends up), damage (ceiling flat, baseline down),
or neither.

## The design, exactly

- The arms are R69's five-draw arms: `sample-5-first`, `sample-5-exec`, `sample-5-oracle`, plus
  **`sample-5`** — majority over the largest agreeing group, the self-consistency every published
  pipeline uses and this lane has never run at k = 5. It costs **zero** calls: it reads draws the
  dispatch already bought, which is why it is registered here rather than in a dispatch of its own.
- **Why majority is here and not in R69.** Computed offline from R67's recorded pool, majority at
  k = 5 is **51.71%** against `first`'s 50.86% — **+0.86pp, 9.7% of the ceiling**, indistinguishable
  from the coin flip that `sample-5-exec` and `sample-5-random` both scored. That is what a pool of
  near-duplicates implies (T = 0.7, 1,750 candidates, median distinct results per question well under
  the draws), and it is the reason heat is the next variable rather than more draws: self-consistency
  needs disagreement to vote on. If T = 1.0 makes majority worth something, the mechanism is
  diversity; if it does not, voting is dead on this lane and the eight remaining points are a
  *reading* problem, which is R71.
- **The only thing that changes is the temperature**, now declared in this header: `temperature: 1.0`
  against R69's lane default of 0.7. Same 350 questions, same five folds, same prompt, same judge,
  same backbone, same day.
- Cost: 350 × 5 draws + 700 baseline ≈ **2,450 calls**, about **$0.35** off-peak. It is dispatched
  outside the 01:00–04:00 UTC double-priced window, which R66's second dispatch was not.

## Prediction

- **The ceiling rises and the baseline falls.** `oracle − first` at **+10…+20pp** against R69's same-
  dispatch k = 5 ceiling, with `sample-5-first` **2–5pp below** R69's `sample-5-first`. A hotter first
  draw is a worse answer, and a pool's gains are paid for out of the baseline it is measured against.
- **The selector stays at chance, and voting does not.** `exec − first` under +3pp, while
  **`sample-5 − first` reaches at least +2pp** — the prediction that separates "the draws are too
  alike to vote" from "voting does not work here". The two are different futures: the first says buy
  heat, the second says stop buying draws.
- **`V3-parse-rate` holds at 100%.** Temperature changes which answer is drawn, not the format it is
  drawn in; a parse failure here would mean the hotter draw is a different kind of failure.
- **The draw count is 5 for every arm** and `V18`/`V19` reconcile every candidate, so a null result
  cannot be a distribution that was never sampled.

## Refutation

The branches are ordered, the first that applies names the outcome, and the axis is the **pair**
`(Δceiling, Δfirst)` against R69's same-day, same-cache five-draw arms.

- **Void** — `V3-parse-rate` fails, or `V18`/`V19` fails, or the artefact's `sample_temperature` is
  not 1. Then the dispatch did not run the experiment this file registers, and the number is about
  something else.
- **Heat pays** — ceiling **at least 5pp above** R69's and `first` **within 2pp** of R69's. Then
  diversity, not width, is the missing ingredient: the same draws buy more pool without costing
  baseline, temperature becomes the lane's default for draw-based arms, and the next registration
  varies the prompt instead of k.
- **Heat at a price** — ceiling up at least 5pp **and** `first` down at least 3pp. Then the pool's
  gain is purchased from the baseline, the net is what matters, and the axis is not temperature but
  **heterogeneity of the draws**: the next registration draws from *different prompts* (decomposition,
  or a second model) rather than spinning the same prompt harder.
- **Heat costs** — ceiling within **3pp** of R69's and `first` down at least 2pp. Then temperature is
  not the lever, the temperature line closes, and the remaining gap is not in the sampling
  distribution at all.
- **Otherwise** — a ceiling gain under 5pp without a baseline loss, or any mix the four conditions
  above do not name. Reported as measured, no line adopted, and the next registration is R69's
  branch taken on its own reading.

The five branches are a partition of the `(Δceiling, Δfirst)` plane with the boundaries written down,
so a number that lands between them cannot afterwards be described as a confirmation.

## Outcome — heat moved the draws around and left the ceiling where it was (2026-11-11)

Dispatch `42965249014`, 05:21 → 05:45 UTC, **2,966 calls, $0.2385**, 100% off-peak, 77.3% of prompt
tokens served from cache, no timeout, no retry, no failed call. `config.sample_temperature = 1`,
five folds, 350 questions, every gate passed.

| arm | accuracy | against `full` |
| --- | --- | --- |
| `none` | 52.29% | — |
| `full` | 53.43% | — |
| `sample-5-first` | 50.29% | −3.14pp [−6.29, 0.00], p = 0.080 |
| `sample-5` — majority vote | 50.57% | −2.86pp [−6.00, 0.29], p = 0.099 |
| `sample-5-exec` | **48.57%** | **−4.86pp [−8.57, −1.14], p = 0.016** |
| `sample-5-oracle` | 58.86% | +5.43pp [2.29, 8.86], p = 0.0019 |

**The branch, on the axis this file registered** — `(Δceiling, Δfirst)` against R69's same-dispatch
k = 5 arms: R69's ceiling was 7.43pp and its `first` 51.71%; R70's ceiling is **8.57pp** and its `first`
**50.29%**. So **Δceiling = +1.14pp, Δfirst = −1.42pp**.

- `Void` — parse 100%, `V18`/`V19` reconcile 1,750 candidates, `sample_temperature` is 1. Not void.
- `Heat pays` — needs +5pp of ceiling. No.
- `Heat at a price` — needs +5pp of ceiling. No.
- `Heat costs` — needs the ceiling within 3pp (1.14, yes) **and** `first` down at least 2pp (1.42, **no**,
  by 0.58pp).
- **`Otherwise` applies**, and it is what the file says to do with a ceiling gain under 5pp that does not
  meet the baseline-loss bar: report as measured, adopt no line, and take R69's branch on its own
  reading.

**That is the letter of the partition and it should not be read as a stay of execution.** The substance
is on the third row of the table above: the deployable arm is **−4.86pp against `full`, p = 0.016**, and
−2.00pp against R69's `sample-5-exec` (50.57%). Temperature bought 1.14pp of ceiling, paid 1.42pp of
baseline for it, and cost the selector two more — a hotter pool is a pool whose candidates are *more*
alike in correctness and *less* separable by what they return. **The temperature line is closed.**

### The predictions, scored

| prediction | registered | measured | |
| --- | --- | --- | --- |
| ceiling `oracle − first` | +10…+20pp over R69's | **+1.14pp** | **fails** |
| `first` below R69's | 2–5pp | −1.42pp | fails, under the band |
| `exec − first` | under +3pp | −1.71pp | holds |
| `sample-5 − first` | at least +2pp | **+0.29pp** | **fails** |
| parse rate | 100% | 100% | holds |
| five draws on every arm | 5 | 5 | holds |

**The second failing prediction is the one that closes a question.** The file was written to separate
"the draws are too alike to vote" from "voting does not work here": heat was supposed to make voting
pay. Voting paid **+0.29pp** on hotter draws and −2.86pp against the pack. So the draws were never too
alike — voting simply does not work on this task, at either temperature, and the answer to R69's width
question is not "buy heat" either.

### What the pool actually did

Same questions, same model, same five draws, one number changed:

| | R67, T = 0.7 | R70, T = 1.0 |
| --- | --- | --- |
| distinct results per question, mean | 1.45 | **1.60** |
| histogram 1/2/3/4/5 | 231 / 85 / 30 / 3 / 1 | **201 / 100 / 39 / 9 / 1** |
| questions with the answer in the pool | 209 | 206 |
| questions the first draw got right | 178 | 176 |
| ceiling | **31 questions, 8.86pp** | **30 questions, 8.57pp** |

**Heat bought diversity and nothing else.** The distribution of distinct results widened exactly as
intended — 30 more questions disaggregated — while the pool's *coverage* fell by three questions and the
first draw's accuracy by two. A hotter sample moves wrong answers around; it does not find the right one
that a cooler sample missed. That is why the ceiling is a property of the model and the question rather
than of the sampling distribution, and it is the last of the three ceiling levers this project could pull
cheaply: width saturates (R69), heat does nothing (here), and what remains is **decomposition or a second
model** — different prompts rather than the same prompt spun harder.

### Cost, as the smallest dispatch this project has bought

| | R67 (T = 0.7) | R70 (T = 1.0) |
| --- | --- | --- |
| calls | 2,930 | 2,966 |
| band | 100% peak | **100% off-peak** |
| cache hit rate | 0% | **77.3%** |
| spend | $0.4708 | **$0.2385** |

The same experiment, half the money, from two levers that changed no science: dispatch inside the
off-peak window, and let the prompt cache see the questions a previous dispatch already asked.
