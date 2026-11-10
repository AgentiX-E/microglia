---
id: R69-pool-width
step: R69
opened: 2026-11-10
arms: sample-5-first,sample-5-exec,sample-5-oracle,sample-10-first,sample-10-exec,sample-10-oracle
sample: 350
gates: V1,V2,V3,V4,V5,V6,V7,V8,V12,V18,V19,V32,V44,V48,V51
---

# R69 — the pool is where the answer is, so the next question is how wide and how hot

**Registered** 2026-11-10, dispatched the same day. Two dispatches from the start (Rule 13): this one
and R70, which was split out of it at the first header review.

The arms `sample-10-first`, `sample-10-oracle` and `sample-10-exec` **were not in `OPTIONAL_ARMS`**
when this file was written: the parser accepts any `sample-N-SELECTOR` and the union listed only k = 3
and k = 5, which is the same gap that cost R67 a dispatch. They are in the union now, pinned by the
test that pins every other arm, and the draw count is pinned too — a `sample-10-*` arm that quietly
drew five would report a width effect of exactly zero and read as a saturated pool.

Three sentences above this one were written as a claim about the future. The fourth is a correction
made before the dispatch and it is here on purpose: the **five-draw arms are registered beside the
ten-draw arms in the same dispatch**. R69 as first written would have compared its k = 10 ceiling with
R67's k = 5 ceiling measured on another day, through another cache, and — as R66's outcome records —
inside the double-priced window. One pass of ten draws contains the five-draw pool as its first five,
so adding the k = 5 arms costs **zero calls** and turns the width effect from a comparison across two
dispatches into a paired difference within one.

## Outcome 0 — void before the first model call, twice, on a shell quote (2026-11-10)

The first dispatch, `42794305166`, and R68's first dispatch beside it, `42794459960`, both died **one
second** into the BIRD job, at `Resolve the sampling temperature` — the step this iteration added.

The step ended with `echo "${VALUE:-the lane's default (…)}"`. Inside the `word` part of a parameter
expansion the shell parses quote characters **even though the whole expansion sits inside double
quotes**, so the apostrophe opened a string that never closed:

```
/home/runner/work/_temp/….sh: line 10: unexpected EOF while looking for matching `'
Process completed with exit code 2.
```

Reproduced locally in one line before the re-dispatch (`bash t.sh` → exit 2), which is what the local
rehearsal of a new workflow step is for and what this iteration skipped: the step was written,
committed and dispatched without ever being executed.

The cost is the smallest this class can have — two dispatches, no model calls, no artefact, no folds
— and the fix is not the sentence but the **checker**: `scripts/check-workflows.py` now runs `bash -n`
over every `run:` block in every workflow. It parses and does not execute, so no step runs, and it
catches the whole class — an unbalanced quote, a missing `fi`, an unclosed heredoc — in five files
rather than in the one that broke. Two self-test cases were added beside it: the apostrophe case that
would have failed, and a well-formed loop that must stay clean.

This is the fourth instance of one shape in three iterations: a value existed, the place that reads it
existed, and nothing checked that the two agreed. The first three were registrations against arms;
this one was a workflow against a parser.

## Why this file exists

R67 measured the pool for the first time and the result is not ambiguous: five draws at T = 0.7
contain the right answer on **+8.85pp** more questions than the first draw, while the best selector
made of execution shape recovers **12.9%** of that and scores *identically to a random pick*
(`sample-5-exec` and `sample-5-random` are both 52.00%). The reason is measured: **seven AUCs, every
one straddling 0.5** (0.492 to 0.546 on 296 disagreeing pairs).

So the shortest path to the two-digit gap is not a better selector — it is a pool that contains the
answer more often, because selection can only recover what generation produced. R67's own refutation
names this branch and asks for exactly this registration: widen (k) or diversify (temperature) before
any selector work. This file does both, one variable per dispatch.

## The design, exactly

- **Dispatch A — width.** `sample-10-first`, `sample-10-exec`, `sample-10-oracle` at the lane's
  existing T = 0.7. The estimand is the ceiling, `oracle − first`, and every arm rides one pass of
  ten draws.
- **Dispatch B — temperature** moved to **R70**, and the reason is mechanical rather than editorial:
  a registration's header carries **one** temperature, and this file's two dispatches wanted 0.7 and
  1.0. Keeping them together meant the header lied to one of them, and a header that lies is worse
  than two files. R70 carries `temperature: 1.0` and the same three five-draw arms; the comparison
  against this dispatch's T = 0.7 arms is then a same-day, same-cache, same-endpoint reading.
- **The comparison that decides the line** is the ceiling at k = 10 against the ceiling at k = 5
  **measured in this dispatch**, and the *ceiling share* an execution selector recovers at each width.
  Points are not the axis (Rule 14); the share is.
- Cost: 350 × 10 draws + 700 baseline ≈ **4,200 calls**, one dispatch, capped from the forecast rather
  than from a warm-cache bill, which is how R66's first dispatch died — and dispatched outside the
  01:00–04:00 UTC double-priced window, which is how R66's *second* dispatch lost $0.235.

## Prediction

- **Width buys ceiling, less than linearly**: `sample-10-oracle − first` at **+12…+20pp** against the
  *same dispatch's* k = 5 ceiling. Ten draws to buy four points is the honest shape of diminishing
  returns, and the prediction is a band rather than a point because the only prior reading (+8.85pp at
  k = 5) was taken on another day.
- **The k = 5 arms reproduce R67 within ±3pp on all four readings** (`first`, `exec`, `oracle`, and the
  `none` baseline). This is not decoration: the width delta is within-run and paired, so it survives a
  bad day, but the *comparison with R67's +8.85pp* does not. A k = 5 ceiling five points off R67 makes
  the day the explanation, and the row says so before the number is read.
- **The selector stays at chance at both widths**: `exec − first` under **+3pp** at k = 10, and the
  ceiling share it recovers still under 20%. If a wider pool makes execution shape informative that is
  a finding and it contradicts R67's mechanism; predicting it stays at chance is what makes the
  contradiction visible if it does not.
- **The instrument**: 100% parse, `V18`/`V19` reconcile every candidate, and the draw count per
  question equals k for every arm — a k = 10 arm that silently drew five would report a width effect
  of exactly zero.

## Refutation

The branches partition the space (Rule 12), are ordered, cover every value, and the first one that
applies names the outcome. They are written on the **within-run** ceiling delta,
`ceiling(k=10) − ceiling(k=5)`, because that is the only quantity here that no day can move.

- **Void** — `V18-pool-complete` or `V19-pool-reconciles` fails, or the mean draws per question is
  below k − 0.5. Then the width was not delivered and the number describes a pool nobody asked for.
- **Width pays** — the k = 10 ceiling is **at least 5pp above** the k = 5 ceiling in the same
  dispatch, and at least **+15pp above `first`**. Then generation width is the lever, the lane adopts
  k = 10 as the pool it selects from, and the next registration is a selector again — a pool that
  contains the answer materially more often changes what a selector is worth even at AUC 0.5.
- **Width saturates** — the k = 10 ceiling is **within 3pp** of the k = 5 ceiling. Then five draws
  already contain what this model can produce at this prompt, doubling the draws buys nothing, and the
  next registration stops buying draws and goes after the one thing R67 did not vary: **what the draw
  is asked** — decomposition, or a second model.
- **Otherwise** — between 3 and 5pp. Width pays a little; the next registration repeats this one at
  k = 20 only if the ceiling share *also* rose, and otherwise the answer is that a selector is the
  binding constraint after all and the spend moves to one.

Any estimate that fits none of the four is impossible by construction: the branches are a partition of
the real line cut at 3pp and 5pp.

## Outcome — width buys two points, and the run published five arms of six (2026-11-10)

Dispatch `42796339905`, minidev, n = 350, 5 folds, **4,829 calls, $0.3967**, `off_peak`, pool
3,500 candidates all signed and reconciled, 14 gates, every one passed.

| arm | accuracy | vs `none` (52.00%) | gained / lost |
| --- | --- | --- | --- |
| `full` | 50.57% | −1.43pp [−4.57, +1.71] | 13 / 18 |
| `sample-5-first` | 51.71% | −0.29pp [−3.14, +2.57] | 13 / 14 |
| `sample-10-first` | 51.71% | −0.29pp | 13 / 14 |
| `sample-5-exec` | 50.86% | −1.14pp [−3.71, +1.14] | 7 / 11 |
| `sample-10-exec` | 50.57% | −1.43pp [−4.57, +1.71] | 13 / 18 |
| `sample-5-oracle` | **61.14%** | +9.14pp [+6.29, +12.29] | 32 / 0 |
| `sample-10-oracle` | **absent** | — | — |

**The row labelled `sample-5-oracle` is the ten-draw ceiling.** The lane searched the union for *the*
oracle arm, kept the first in union order, and let it read the pool whole; `sample-10-oracle` was
dropped without a word and every gate passed. So the registration's primary estimand —
`ceiling(10) − ceiling(5)` — was missing from the table while the artefact read as a complete result.

It is recoverable from the pool at zero cost, which is what the pool is for:

| reading | value |
| --- | --- |
| `first` (same draw at both widths) | 181 / 350 = **51.71%** |
| `ceiling(k=5)` — best of the **first five** draws | 207 / 350 = **59.14%** |
| `ceiling(k=10)` — best of all ten | 214 / 350 = **61.14%** |
| **width effect, paired within this run** | **+2.00pp** |
| ceiling over `first`, at k = 5 / k = 10 | +7.43pp / +9.43pp |
| majority of the largest agreeing group, k = 5 / k = 10 | 51.71% / 52.29% (+0.00 / +0.57pp) |

**The branch: width saturates.** The registered condition was a k = 10 ceiling within **3pp** of the k =
5 ceiling, and the delta is 2.00pp. Doubling the draws from five to ten buys two points of ceiling and
nothing at the selector: `sample-10-exec` is *below* the first draw (−1.14pp), and its ceiling share
is negative at both widths. The file's own instruction for this branch is to stop buying draws and go
after the one thing it has not varied — **what the draw is asked** — which is R71.

**Four predictions, and the honest count is two.**

- *Width buys ceiling less than linearly, +12…+20pp* — **missed**. The ceiling moved +2.00pp, far
  below the band, and the k = 5 ceiling itself came in at +7.43pp rather than R67's +8.85pp.
- *The k = 5 arms reproduce R67 within ±3pp* — **held**: `first` 51.71 vs 50.86 (+0.85), ceiling 59.14
  vs 59.71 (−0.57), `exec` 50.86 vs 52.00 (−1.14). The day moved by under a point, which is what makes
  the within-run delta readable at all.
- *The selector stays at chance at both widths* — **held, and more emphatically than predicted**:
  −1.14pp at k = 10 and −0.86pp at k = 5, both *below* taking the first draw.
- *Draw count equals k for every arm* — **held**: 3,500 candidates over 350 questions, 10 per question,
  `sample-5-*` reading the first five.

**A reading the shape gate produced and that the arm refutes.** With 3,500 candidates the signal gate
now finds three survivors by Holm — `empty` (AUC 0.545), `column-shape` (0.556), `value-type` (0.562) —
and a composite that beats the draw-order baseline by +2.9pp on the 138 questions where a choice
existed (5 gained, 1 lost). The arm built from the shape composite scored **1.14pp below** the first
draw. Both numbers are true and they are about different populations: the gate reads the 138 questions
where a choice existed, and the arm is scored over all 350, where two thirds of the questions had one
result and the choice was vacuous. That gap is now the reason R71's readout must report the *eligible*
population beside the whole one, and it is the second time this iteration found a number that was true
of its own denominator and false of the run.

**The defect, and what now refuses it.** Two fixes, both of which the run would have needed:

- `ceilingAmong(verdicts, width)` reads the best of *the first n draws*, so two ceiling arms are two
  readings of one pool rather than one reading wearing two names. Four tests pin it, including the
  case that matters: the right answer at draw 7 is invisible to a five-draw ceiling.
- `V77-every-requested-arm-is-a-row` is a blocking gate. An arm that is bought and not reported is the
  most expensive kind of silence this lane can produce — the dispatch is paid for, the number is
  missing, and the artefact reads as complete. R69's own artefact would fail it now, which is the
  point: the gate is written against the run that produced it.

**Cost.** 4,829 calls for **$0.3967**, `off_peak`, against R66's 5,594 calls for $0.7078 inside the
double-priced window — the same order of work for 56% of the money. The lesson from R66's outcome is
already paying.
