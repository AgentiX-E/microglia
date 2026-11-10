---
id: R69-pool-width
step: R69
opened: 2026-11-10
arms: sample-10-first,sample-10-oracle,sample-10-exec
sample: 350
gates: V1,V2,V3,V4,V5,V6,V7,V8,V12,V18,V19,V32,V44,V48,V51
---

# R69 — the pool is where the answer is, so the next question is how wide and how hot

**Registered** 2026-11-10, undispatched. Two dispatches from the start (Rule 13). The arms
`sample-10-first`, `sample-10-oracle` and `sample-10-exec` **are not in `OPTIONAL_ARMS`**: the parser
accepts any `sample-N-SELECTOR` and the union lists only k = 3 and k = 5, which is the same gap that
cost R67 a dispatch. They are added before this file is dispatched, and this sentence exists so the
next reader can tell a plan from a claim.

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
- **Dispatch B — temperature.** R67's five-draw arms at **T = 1.0** (`SOTA_SAMPLE_TEMPERATURE`),
  same arms and same folds. `sample-5-first` at T = 1.0 against R67's `sample-5-first` at T = 0.7
  separates "hotter draws are more diverse" from "hotter draws are worse", which a single
  temperature cannot.
- **The comparison that decides the line** is the ceiling in each dispatch against R67's **+8.85pp**,
  and the *ceiling share* an execution selector recovers in each. Points are not the axis (Rule 14);
  the share is.
- Cost: A is 350 × 10 draws + 700 baseline ≈ **4,200 calls**; B is R67's ≈ 2,900. Both capped from
  the forecast rather than from a warm-cache bill, which is how R66's first dispatch died.

## Prediction

- **Width buys ceiling, less than linearly**: `sample-10-oracle − first` at **+12…+20pp**, against
  +8.85pp at k = 5. Ten draws to buy four points would be the honest shape of diminishing returns.
- **Heat buys diversity up to a point, then damage**: at T = 1.0 the ceiling is **+9…+18pp** while
  `sample-5-first` *falls* by 2–5pp against its T = 0.7 reading, because a hotter first draw is a
  worse answer and the pool's gains are paid for out of the baseline.
- **The selector stays at chance on both**: `exec − first` under **+3pp** in both dispatches, and all
  seven AUCs still straddling 0.5. If a wider pool makes execution shape informative, that is a
  finding and it contradicts R67's mechanism; predicting it stays at chance is what makes the
  contradiction visible if it does not.
- **The instrument**: 100% parse, `V18`/`V19` reconcile every candidate, and the draw count per
  question equals k for every arm — a k = 10 arm that silently drew five would report a width effect
  of zero.

## Refutation

The branches partition the space (Rule 12): ordered, exhaustive, first match names the outcome.

- **Void** — `V18-pool-complete` or `V19-pool-reconciles` fails, or the mean draws per question is
  below k − 0.5 in either dispatch. Then the width was not delivered and neither number describes one.
- **Width pays** — the k = 10 ceiling is at least **+15pp** and at least **5pp above** R67's +8.85.
  Then generation width is the lever, the lane adopts k = 10 for the oracle-style pool, and the next
  registration is a selector again — because a pool that contains the answer twice as often changes
  what a selector is worth even at AUC 0.5.
- **Heat pays** — the T = 1.0 ceiling is at least **+15pp** and at least 5pp above R67's, while
  `sample-5-first` at T = 1.0 is within 2pp of its T = 0.7 reading. Then diversity, not width, is the
  missing ingredient and the next registration varies the prompt instead of k.
- **Neither pays** — both ceilings are under +12pp. Then five draws already saturate what this model
  can produce on these questions at this prompt, the two-digit gap is not in generation on this lane,
  and the next registration stops buying draws and goes after the one thing R67 did not vary: **what
  the draw is asked** — decomposition, or a second model.

The branches are applied in the order written, and any estimate that fits none of the four is
impossible by construction.
