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
