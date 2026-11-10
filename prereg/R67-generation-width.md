---
id: R67-generation-width
step: R67
opened: 2026-11-10
arms: sample-5-random,sample-5-exec,sample-5-prior
sample: 350
gates: V1,V2,V3,V4,V5,V6,V7,V8,V12,V32,V44,V48,V51
---

# R67 — the last two-digit region is how many queries are drawn, not what the prompt says

**Registered** 2026-11-10, undispatched. **Two dispatches from the start**, because R65 measured the
between-run spread at 3–4pp on this split (Rule 13) and a single dispatch cannot decide the effect this
registration is about.

## Outcome 0 — void by configuration, in two seconds (2026-11-10)

The first dispatch, `42747647806`, never reached a question. The lane refused the arm list:
`MG_E_CONFIG: Unknown arm 'sample-5-exec'`. The selector exists (`exec` has been in
`SAMPLING_SELECTORS` since the selectors were factored into one list), the parser accepts any
`sample-N-SELECTOR`, and `sample-3-exec` is a registered arm — so the formula was constructible,
plannable and absent from `OPTIONAL_ARMS`, which is the list membership is actually checked against.

This is the third time in two iterations that one fact had two representations and only one was
updated: `RETRY_POPULATION_FLOOR` stayed 140 while the amendment said 90, `retry-values` was
registered while the arm did not exist (R66's own header says so), and now an arm whose parser form
exists but whose name does not. R66 wrote the sentence; R67 assumed the machinery. The arm is now in
the union, the list is pinned by the test that pins every other arm, and the dispatch is repeated.

The cost of this class is two seconds and no calls — the refusal happens before the first model call —
which is the right price and exactly why the arm list is checked where it is.

## Outcome — the pool is real, the selectors are at chance, and the branch it triggers is "widen the pool" (2026-11-10)

Dispatch `42749802682`, minidev, n = 350, 5 folds, 2,930 calls, **$0.4708** at 100% peak pricing
($0.2354 off-peak), cache 77.4%, all gates passed, 1,750 candidates signed and reconciled.

| arm | accuracy | vs `none` | vs `sample-5-first` |
| --- | --- | --- | --- |
| `none` | 52.29% | — | — |
| `full` | 51.43% | −0.86pp [−4.00, +2.00], p = 0.71 | — |
| `sample-5-first` | 50.86% | −1.43pp, p = 0.42 | — |
| `sample-5-random` | 52.00% | −0.29pp, p = 1.00 | **+1.14pp** |
| `sample-5-exec` | 52.00% | −0.29pp, p = 1.00 | **+1.14pp** |
| `sample-5-prior` | 53.14% | +0.86pp, p = 0.70 | **+2.28pp** |
| `sample-5-oracle` | **59.71%** | +7.43pp, p < 1e-4 | **+8.85pp** |

Four readings, in the order they matter:

1. **Temperature costs 1.43pp and the pool repays 8.85pp.** Five draws at T = 0.7 contain the answer
   on 8.85pp more questions than the first draw does, against R67's predicted band of +10…+25pp —
   *below* the band, which is the first thing the prediction got wrong.
2. **Execution-shape selection is worth exactly what a coin flip is worth.** `sample-5-exec` and
   `sample-5-random` are not approximately equal, they are the *same number*: 52.00% and +1.14pp over
   `first`. Ceiling share 12.9%.
3. **The reason is measured, not inferred.** On the 120 questions where the draws disagreed (296
   pairs), the AUC of every execution-shape signal is at chance: draw-order 0.510 [0.421, 0.596],
   null-share 0.492, empty 0.535, duplicate-share 0.537, column-shape 0.541, value-type 0.542,
   row-shape 0.546 — seven intervals, every one straddling 0.5. A selector made of signals that
   cannot rank cannot rank, and it did not.
4. **The prior selector is the only one above chance** (+2.28pp over `first`, 25.8% of the ceiling),
   and its own report says why to distrust the headline: `db-signature` reads +10.00pp on 80
   questions, 36 of them with any support, *in sample*. That is an upper bound for a verifier, not a
   result.

**The branch.** Ordered against the file's own conditions: not promoted (1.14 < 8); not narrowed to
the ceiling (the ceiling is 8.85, under 15); **narrowed to the pool** — `exec − first` under +8pp
*and* the ceiling under +15pp. The registration's own instruction for that branch is that the next
registration widens or diversifies the pool before any selector work, and that is R69.

Two predictions held and two did not, recorded rather than smoothed: `prior − exec` inside ±3pp
(measured +1.14) was right, and the cost forecast (~2,100 calls per arm, 9,000 for the dispatch) was
high by a factor of three, because one pass of five draws feeds all five selectors — the arms are
priced at 2,930 calls in total, not per arm.

## Why this file exists

R65 closed the last prompt-content lever in the register. Pooled over three valid dispatches, three
correct worked examples from the same database are worth **+3.81pp** (95 gained / 55 lost, n = 1,050,
exact p = 0.0014); `oracle`'s **+33.14pp** is what an item written for the question itself is worth, and
it is not retrievable. Schema ordering was +0.86pp, memory packs are null on four splits, pruning is
−9.58pp. So the remaining gap to the published pipelines — CHESS at 66.2% on BIRD, its self-consistency
variant at 66–78% — is not in the prompt's *content*.

It is in **how many queries are drawn and which one is kept**, and this repository has the machinery for
both (`sample-n` draws, `pool.ts`, `union.ts`, `prior.ts`, selectors `first`, `random`, `exec`, `model`,
`shape`, `value`, `prior`) without ever having registered the estimand on this split.

## The design, exactly

- Three treatment arms, each on the same five folds and the same 350 questions:
  - **`sample-5-random`** — five draws at a non-zero temperature, one kept at random. The control for
    everything below: it prices the draws *without* any selection.
  - **`sample-5-exec`** — five draws, the candidate that executes is preferred, ties by the majority
    result signature.
  - **`sample-5-prior`** — five draws, the candidate consistent with what the store says about this
    database's shapes wins (the `db-signature` scope, the strongest prior measured here).
- The honest baseline is **`first`**: the draw a selector would have taken had it decided nothing.
  `sample-5-random − first` is the price of temperature, `sample-5-exec − first` is the value of
  selection, and neither is available from `sample-5 − none`.
- **A ceiling arm, at zero marginal cost**: `sample-5-oracle` keeps the draw that scored. It is not a
  mechanism; it is the **pool's** ceiling, and the ratio `(best selector − first) / (oracle − first)` is
  the quantity that says whether better selection is worth buying.
- Temperature and prompts are the lane's existing ones; nothing about the prompt changes between arms.

## Prediction

- **The pool contains the right answer far more often than one draw finds it.** `sample-5-oracle`
  against `first` is **+10…+25pp**, which is the ceiling this registration is really measuring.
- **Execution-consistency selection recovers 20–50% of that ceiling**, i.e. `sample-5-exec − first`
  lands between **+2 and +12pp**.
- **The prior selector adds little on top of execution**: `sample-5-prior − sample-5-exec` is inside
  ±3pp, because a store with null memory accuracy has never shown it can rank.
- **Cost per arm is bounded and stated before the run**: five draws plus one selection call per
  question is about 2,100 calls per arm at n=350, and the four-arm dispatch is budgeted at 9,000 calls
  with a hard cap, which the lane forecasts against and refuses rather than overspends.

## Refutation

The branches **partition** the space (Rule 12): they are ordered, they cover every value, and the first
one that applies selects the outcome.

- **Promoted** — pooled over the two dispatches, `sample-5-exec − first` is **≥ +8pp** with the
  between-run spread reported and the pooled interval excluding zero. Then execution-guided selection
  becomes the product's default generation mode.
- **Narrowed to the ceiling** — pooled `sample-5-exec − first` is under +8pp **while** the oracle arm
  shows a pool ceiling of ≥ +15pp. Then selection is the problem, not generation, and the next
  registration is a selector rather than a wider pool.
- **Narrowed to the pool** — pooled `sample-5-exec − first` is under +8pp **and** the oracle arm shows
  a ceiling under +15pp. Then five draws at this temperature do not contain the answer often enough,
  and the next registration widens or diversifies the pool (k, temperature, decomposition) before any
  selector work.
- **Closed** — pooled `sample-5-exec − first` is inside ±3pp **and** the ceiling arm is under +8pp.
  Then generation width does not matter on this task at this model, and the two-digit gap is not
  reachable in this lane at all — which would be a finding about the benchmark's remaining headroom
  rather than about this system.

The branches are applied in the order written: the first one whose conditions hold names the outcome,
and any estimate that fits none of the four is impossible by construction.

That property is the point: R64 and R65 both produced estimates in unassigned regions, and that is the
defect this file is written to avoid.

## Cost

Four arms × 350 questions × (5 draws + 1 selection) ≈ 8,400 calls per dispatch, about **$0.8** at the
R64–R65 rate, twice for the replication. The cap is set above the forecast and the lane refuses rather
than truncating a fold (`MG_E_BUDGET_EXCEEDED` is a refusal, not a failure — R64 paid one fold to learn
that a warm-cache figure is not a cold-cache forecast).
