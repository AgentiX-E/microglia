---
id: R71-content-readout
step: R71
opened: 2026-11-10
arms: sample-5-first,sample-5-exec,sample-5-oracle,sample-5
sample: 350
gates: V18,V19,V69
---

# R71 — can a selector read a candidate for free?

**Registered** 2026-11-10 **before the reading is computed**, and it buys no model calls. It is a
prediction about arithmetic over a pool that another dispatch has already paid for; the "dispatch" is
`pnpm eval:pool` against R70's artefact, and the registration exists because a prediction made after
seeing the number is not a prediction.

## Why this file exists

R67 priced seven signals and every one of their AUC intervals straddled 0.5. R69 doubled the pool and
three of them survived Holm at AUC 0.545–0.562 — and the arm built from the composite scored *below*
the first draw at both widths. So the shape family is now measured twice, at two widths, on the same
split, and the answer is the same: a signature says how big an answer is, never whether it answers
*this* question.

The competitor's selection step does something this lane has never tried: CHESS writes assertions from
the question itself — "the result must have a column named `County`" — and executes them per
candidate. The assertions are content-aware. The published 17.6 points between DAIL-SQL+SC and
CHESS+SC sit partly there, and this project has been unable to say whether that is the mechanism or
the model.

`content-signal.ts` asks the free half of that question. Two signals, no model:

- **`column-mention`** — the share of the question's content words that the result's column names
  account for. A query that returns `County` for a question about counties is evidence; a query that
  returns `count` is not.
- **`literal-match`** — the share of the numbers and quoted strings the question states that the query
  actually writes. A question naming `2015/2016` is answered by a query containing it.

Both are read on the same question-clustered interval as the shape signals, by the same function, so
the comparison between reading and measuring is a comparison and not an analogy.

## The design, exactly

- Population: R70's pool, 350 questions × 5 draws, **every** candidate carrying its query and columns.
  A question whose pool is only half recorded is dropped and the drop is reported; a run that recorded
  nothing produces no reading at all, which is a different statement from "the signals were at chance".
- Estimand: candidate-level AUC against correctness, with the question-clustered interval, for both
  signals and their mean. Plus the top-pick accuracy on the **eligible** population (questions where at
  least two distinct results existed) *and* on all 350, reported side by side — R69's second-order
  finding is that the two denominators can disagree in sign and the record had been quoting whichever
  was convenient.
- Cost: **zero calls.** The pool exists; the arithmetic is local.

## Prediction

- **`column-mention` carries real signal**: AUC **0.58–0.72**, interval excluding 0.5. A correct query
  names the thing the question asks about; that is close to a tautology and it should show.
- **`literal-match` carries less**: AUC **0.52–0.64**, and I expect its interval to be the wider of the
  two, because BIRD's questions paraphrase their literals (`'Rock'` for `'rock'`, `2015/2016` written
  as `2015`).
- **Neither beats the ceiling by much**: top-pick gain over `first` on the eligible population
  **+2…+10pp**, i.e. a share of the ceiling between 20% and 60% — above the shape composite's negative
  share and below what a model-written verifier is worth in a competitor's ablation.
- **The two denominators disagree in magnitude and agree in sign.** The gain over all 350 questions
  should be smaller than the gain over the eligible 138, because two thirds of the questions have one
  distinct result and a selector has nothing to do there.

## Refutation

The branches are ordered and they partition on the two intervals, so a number between them cannot
afterwards be described as a confirmation.

- **Void** — R70's pool records no query for a candidate that produced one, or fewer than 300
  questions are complete. Then the reading is of a partial pool and describes neither the signals nor
  the run.
- **Content is free** — `column-mention`'s interval excludes 0.5 **and** its top-pick gain on the
  eligible population is at least +4pp. Then a deterministic reader recovers a real share of the
  ceiling at no cost, the next registration is a selector arm built on it (R71b), and every future
  pool reading reports it beside the shape signals.
- **Content is cheap but thin** — the interval excludes 0.5 but the gain is under +4pp. Then the
  signal is real and the mechanism is weak, and the honest next step is to combine it with the shape
  family and measure whether the union beats either part — not to build a selector on 2pp.
- **Content is not free** — both intervals straddle 0.5. Then the 8.2-point gap is **the price of
  reading**, not a missing cheap signal: CHESS's assertions are written by a model per question, and
  the next registration prices exactly that (one call per candidate, 5 calls per question, which is
  the most expensive lever this project has considered and the first one with a measured reason).

The branches are applied in the order written. An estimate that fits none of the four is impossible by
construction: the two conditions are "interval excludes 0.5" and "gain ≥ 4pp", which cut the space
into four.

## Outcome — content is not free, and the gap is the price of reading (2026-11-11)

Read from R70's pool with `pnpm eval:pool --bird`, **zero calls**: 350 questions × 5 draws = 1,750
candidates, **all 1,750 signed** — every candidate carries its query and its columns — so the `Void`
branch (a partial pool) does not apply, and 150 questions carried at least two distinct results against
the 138 this file expected.

| signal | AUC, 95% | top-pick on 150 | against the first draw's 30.0% |
| --- | --- | --- | --- |
| `column-mention` (content) | **0.514 [0.464, 0.567]** | 28.7% | **−1.3pp** |
| `literal-match` (content) | **0.506 [0.500, 0.520]** | 30.7% | +0.7pp |
| `content-mean` | 0.520 [0.468, 0.574] | 29.3% | −0.7pp |
| `column-shape` (shape) | 0.565 [0.532, 0.606] | 32.7% | +2.7pp |
| `value-type` (shape) | 0.567 [0.527, 0.610] | 30.7% | +0.7pp |
| `empty` (shape) | 0.553 [0.523, 0.590] | 31.3% | +1.3pp |
| `null-share` (shape) | 0.511 [0.482, 0.543] | 30.0% | 0.0pp |

**Branch: `Content is not free`.** Both content intervals straddle 0.5 and the gain is negative. The
branch's own sentence is the finding: **the gap to the published pipelines is the price of reading, not
a missing cheap signal.** CHESS writes its assertions with a model, per question, and executes them per
candidate — that is one call per draw, five per question, and it is now the only selection lever with a
measured reason behind it rather than an intuition. The next registration prices exactly that.

### The predictions, scored

| prediction | registered | measured | |
| --- | --- | --- | --- |
| `column-mention` AUC | 0.58–0.72, interval excluding 0.5 | **0.514 [0.464, 0.567]** | **fails** |
| `literal-match` AUC | 0.52–0.64, the wider of the two intervals | **0.506 [0.500, 0.520]** | **fails, and narrowest** |
| top-pick gain over `first` | +2…+10pp on the eligible population | **−1.3pp** | **fails** |
| the two denominators disagree in magnitude, agree in sign | — | **not scoreable** | the prediction assumed a positive gain |

**"A correct query names the thing the question asks about; that is close to a tautology and it should
show" — it does not show, and the reason is the fourth prediction's own subject.** Two thirds of these
questions have one distinct result across five draws, so the eligible population is small, the column
names agree across candidates, and a signal computed from a name that all candidates share cannot rank
them. Content-aware selection needs candidates that differ in *content*, and five draws of one prompt
mostly differ in shape.

The fourth prediction is recorded as not scoreable rather than as held: it was written as "the gain over
all 350 should be smaller than the gain over the eligible 138", which presumes a positive gain. The
measured gain is negative, so the comparison the sentence describes has nothing to shrink.

### The reading that is not about content at all

Three pools, three backbones and temperatures, the same three questions asked of each — how much room is
there, and can anything in the artefact find it:

| pool | model | T | eligible | `first` | `oracle` | ceiling | `empty` AUC | `column-mention` AUC |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R67 | `deepseek-flash` | 0.7 | 120 | 50.86% | 59.71% | 8.86pp | 0.535 | — (no text recorded) |
| R70 | `deepseek-flash` | 1.0 | 150 | 50.29% | 58.86% | 8.57pp | 0.553 | 0.514 |
| R68 | `glm-4.7-flashx` | 0.7 | 263 | 28.00% | 42.57% | 14.57pp | **0.706** | **0.633 [0.590, 0.681]** |

**Signal strength tracks the failure population, not the temperature and not the signal.** The same
`empty` feature is worth 0.535 where 49% of questions are wrong and 0.706 where 72% are; every content
and shape signal on the hot pool sits within 0.02 of chance while the same signals at the weak backbone
clear it comfortably. That is R68's finding measured at the level of one candidate, and it says where the
next selector experiment belongs: **on a baseline low enough for the ranking to be possible**, and with a
reader expensive enough to use the content the cheap signals cannot.
