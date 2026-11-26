---
id: R236-clause-mechanism
step: R236
opened: 2026-11-27
arms: 1
sample: 60
gates: V1
---

# R236 — the clause board's mechanism, bought at sixty episodes instead of nine hundred

Registered 27 November 2026, before any dispatch. Supersedes the dispatch half of
`prereg/R235-clause-accuracy.md`, which is withdrawn on the arithmetic in AUDIT 34.332: its own B1
asked for a 3.21-point non-inferiority test on a 114-task domain whose **floor** is 3.21 points at
unlimited attempts, so the round could not pass its gate at any price and nobody had checked.

## Prediction

- **B1 holds with margin.** The clause board carries an open ask for the family a write needs on 97.2% of the
  graded writes (R234: 636 of 654 reached), so at least 55 of the 60 episodes should show one — the bar is 57 of
  60, and the prediction is that the shortfall, if any, is the 18 writes whose family the board never held.
- **B2 is a direction, not a number.** The share of episodes whose graded tool call names a family that was open
  at the time of the call should be **at or slightly above** the contract transcripts' share, but the interval at
  60 against 456 is ±9 points, so the prediction is "not below, by a margin" and not a point estimate.
- **The bill is under ¥3.** Sixty episodes at the measured $0.00584 an episode is $0.35; the prediction is that
  the run comes in within a factor of two of that, and that a larger bill means a cache that stopped hitting.
- **Instrument prediction.** The run is only readable if the driver actually serves the clause board: if B1 comes
  back below 90%, the arm was not served and the round says so rather than reporting B2.

## Refutation

- **If B2 comes back flat** — the share not above the contract's — the finding is that **coverage of the graded
  writes is not the channel**, and the next round is a domain with more tasks (1.98 points needs 300) rather than
  a fifth content rule. The line of work that ends here is "more coverage of the same work buys tasks".
- **If B1 fails**, the round was not a test of the mechanism at all and no B2 number may be quoted; the driver's
  clause path is the defect and the round is re-registered rather than reinterpreted.
- **If the bill exceeds ¥4**, the run is a cache diagnosis: a harness whose prefix stops hitting pays fifty times
  the cached rate, and that is a harness bug rather than a benchmark cost.
- The alternative readings are named so the outcome cannot be reinterpreted: a flat B2 with a passing B1 means the
  board was served and the model ignored it; a failing B1 means the board was not served, and the two are not the
  same finding.

## The question this round can actually answer

Not *does 31.8 more points of covered writes raise the task pass rate*. That question needs ~1,356
paired episodes to resolve 3.2 points on this domain (measured: `sd_diff` 0.4755 over the 456 paired
episodes in hand, so `2.802 × 0.4755 / √n`), which is ¥70 for a non-inferiority test and still cannot
detect a gain. The question that is cheap, and that no round has asked, is the one underneath it:

> When the block a model reads carries a live ask for the family it is about to write, does the model
> **write that family** — and does it do so at a rate the contract board does not reach?

That is a mechanism question with a mechanism's sample size: it is a proportion to be estimated, not
a difference to be resolved, and sixty episodes estimate a proportion to ±12 points.

## Design

* **One arm, sixty episodes**: 30 tasks × 2 trials, drawn from the same 114-task retail grid with the
  same seed set as every previous round, so each episode is comparable to the 456 already on disk.
* **One new thing**: the driver serves the **clause** board — R231's admission, R233's order, R234's
  fold — instead of the contract board. That is the round's entire engineering half, and it costs ¥0.
* **One free control**: the 456 `front` episodes already dispatched. Their transcripts hold the same
  measurement (does the model's tool call name a family the block carried), so the control arm is not
  bought twice.
* Held: placement `tail`, settlement grades `name`/`overlap`, `blockCeilingChars` 500, one attempt a
  trial, off-peak dispatch (the rate card's peak windows are 01–04 and 06–10 UTC on weekdays).

## Bars, before the money

* **B1 — the board is actually served.** On ≥95% of the 60 episodes, some block the model read carries
  an **open** ask whose family the episode later writes. Measured on the dispatched transcript, not on
  a replay: an arm that only claims to serve the clause board fails here.
* **B2 — the model acts on it.** The share of episodes whose graded tool call names a family that was
  open on the block at the time of the call is **not below** the same share on the 456 contract
  transcripts. This is a comparison of two proportions with the control already paid for; its
  resolution at 60 against 456 is ±9 points, so it is stated as a direction with a margin, not as a
  win.
* **B3 — the bill.** Total spend ≤ **¥3**, read from the run's own `agent_cost` and `user_cost` rather
  than projected.

## Price, from the card and from what the lane actually spent

| | value | source |
|---|---|---|
| episodes | 60 | this registration |
| per-episode cost | $0.00584 | the 456 `front` episodes, `agent_cost` + `user_cost`, measured |
| projected | **$0.35 ≈ ¥2.5** | off-peak, `deepseek-flash` |
| previous plan | ¥36 | two arms × 456 episodes — withdrawn |

## What this round does not claim

It does not claim a pass-rate gain, and it will not report one. Sixty episodes cannot see a 3.2-point
effect, and a round that reported an unresolvable delta as a win would be the same defect as R235's
gate, one level down. If B2 comes back flat, the finding is that **coverage of the graded writes is not
the channel** and the next round belongs to a domain with more tasks — which is the third-domain work,
not a fifth content rule. If B2 comes back positive by more than its margin, the number to buy next is
a 300-task domain (the resolution ladder's own answer: 1.98 points at 300 tasks against 3.21 at 114),
not 900 more retail episodes.

## And the two external replications, priced in the same pass

`eval/tools/bench_budget.py` prices the plan's two external benchmarks from the same rate card the
dispatchers bill against, and the twenty dollars the plan carried for them was a guess:

| benchmark | questions | documents | context | off-peak | no shared prefix | ratio |
|---|---|---|---|---|---|---|
| LoCoMo | 1,986 | 10 | 27k | **¥1.96** | ¥58.43 | 29.8× |
| MemTrapBench | 1,000 | 50 | 8k | **¥0.86** | ¥8.90 | 10.4× |
| both | | | | **¥2.82** | ¥67.33 | 23.9× |

The ratio is the point and not a detail: a long-context benchmark asks 1,986 questions of **ten**
documents, so 99.5% of its input is a shared prefix billed at the cached rate, which on this card is
one fiftieth of the uncached rate. A harness that queries one question at a time in a fresh context —
which is how most published replications of these sets are run — pays the right-hand column.
