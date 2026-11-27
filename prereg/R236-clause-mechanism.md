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

## Stopping rule, registered before the first episode

Sixty is the ceiling, not the target. B1 is a proportion with a bar at 0.95, so it can be decided early in one
direction and never early in the other: after every **fifteen** episodes the run recomputes B1's exact binomial
interval, and

* stops if the interval's **lower** bound is at or above 0.95 — the board is demonstrably served, and the remaining
  episodes would only narrow a number that has already passed;
* stops if the interval's **upper** bound is below 0.90 — the board is demonstrably not served, which is a driver
  defect and not a mechanism reading, and buying forty-five more episodes of it is buying the same defect.

Otherwise it runs to sixty. The expected bill is therefore **¥1.3 to ¥2.5** rather than ¥2.5, and the stopping
points are fifteen, thirty, forty-five and sixty episodes — fixed before the first one, because a stopping rule
chosen after seeing the data is a rule that stops when the answer is convenient.

This is the only place in the plan where a round can come in under its own estimate, and it is the honest shape of
one: the ceiling is what the question costs if it is close, and the floor is what it costs if it is not.

## Price, from the card and from what the lane actually spent

| | value | source |
|---|---|---|
| episodes | 60 | this registration |
| per-episode cost | $0.00584 | the 456 `front` episodes, `agent_cost` + `user_cost`, measured |
| projected | **$0.35 ≈ ¥2.5**, or **¥1.3** if the stopping rule fires at fifteen | off-peak, `deepseek-flash` |
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

---

# Amendment 1 — B1's bar is the wiring's, and B2's is the ceiling's

Registered 27 November 2026, **before the first paid episode**. No money has been spent and no clause-arm episode
exists; both documents below are the control arms of earlier rounds, already on disk.

## What was read, for nothing

The reader this round needs did not exist, so it was built first and pointed at the 456 control transcripts at both
scopes. It recomputes the block as it stood before every write — `read_anchor.moment` at the arm's scope and rung,
which is the renderer the driver runs — and then asks two questions per episode:

| reading | scope | wiring: episodes holding an ask the request board does not | acted: graded episodes whose write named a family the window carried |
|---|---|---|---|
| `control.json` (456) | `request` | 0 of 456 (**0.0%**) | 318 of 403 (**78.9%**) |
| `control.json` (456) | `clause` | 431 of 456 (**94.5%**, 3,025 extra asks) | 394 of 403 (**97.8%**) |
| `front.json` (456) | `clause` | 430 of 456 (**94.3%**, 2,876 extra asks) | 385 of 398 (**96.7%**) |

`eval/manifests/r236-replay.json`, both documents pinned by sha256, re-checked by `board_mechanism.py --check`.

## The defect in the registered B1

B1 was written as "on ≥95% of the 60 episodes, some block the model read carries an open ask whose family the
episode later writes", with the bar taken from R234's **97.2%** display coverage. Those are two different rates over
two different denominators: 636 of 654 is a share of **required writes**, and B1 is a share of **episodes**. Measured
on the same 456 episodes the episode-level quantity is **89.5%** at the clause scope and **71.1%** at the request
scope — so the bar, as registered, is one the correct arm fails and the incorrect arm also fails, which is a bar that
cannot distinguish anything. It is R235's defect one level down (AUDIT 34.332: a margin taken from the wrong
quantity) and it was found the same way, by printing the quantity beside the rate.

## The amendment

**B1 becomes a wiring certificate, and the bar is 80%.**

> The recomputed block holds at least one ask the request board does not, on ≥80% of episodes.

It reads **94.5%** on the control grid and **0.0%** when the same reader is pointed at the request scope — that is,
zero for an environment that lost the switch, which is the failure B1 exists to catch. The bar sits fourteen points
under the measured level and a hundred points over the failure, so sixty episodes cannot fail it for noise and a lost
environment cannot pass it. The episode-level "any write named a carried family" quantity — 89.5% against 71.1% —
is **reported beside it as a diagnostic and is not a bar**: it moves with the grid's task mix, and this round has no
use for a second number that cannot fail.

**B2's comparison becomes the replay ceiling, and the bar is 88.8%.**

> Of the episodes that made a graded write, the share whose write named a family that was open on the window at that
> moment is ≥ **ceil − 9 points**, where the ceiling is the same board replayed over the 456 control transcripts.

The registered form compared against the *contract board* (78.9%). That comparison prices the window's **width**,
which is a superset by construction — the clause board holds strictly more asks on 94.5% of episodes, so its share
must rise whether or not the model does anything differently. A number that is a consequence of the arithmetic
cannot be evidence about the model. The falsifiable risk that remains is the opposite one, and it is real: a window
of nine lines instead of two may **distract**, and a model reading more may act on less. B2 is therefore a **harm
bar** — the dispatched share must not fall more than the registered resolution (±9 points at 60 against 456) below
the ceiling of 97.8%, i.e. **88.8%** — and the point estimate is reported against both references.

The ceiling replicates: **97.8%** on `control.json` and **96.7%** on `front.json`, two independent 456-episode grids,
1.1 points apart with overlapping intervals. It is a property of the board and not of the grid it was taken on.

**B3 is unchanged**: total spend ≤ ¥3, read from the run's own `agent_cost` and `user_cost`.

## What this does not do

It does not make the round cheaper or easier to pass: every bar is computed by a tool that re-derives it on every
push, and both documents' digests are in the manifest. It does not change the question, either. The round still
cannot say the wider window **helped** — B2's point estimate will be near the ceiling by construction, and the only
claim available is the negative one (a wider window did not make the model worse) plus the descriptive share at the
window the model actually read. What would have happened without the amendment is the thing worth writing down:
sixty episodes bought, B1 read at 89.5% against a 95% bar, and a round that reported "the board was not served" about
an arm that served it perfectly.

## Amendment 2 — which thirty tasks, registered before the dispatch

The design says "30 tasks × 2 trials, drawn from the same 114-task retail grid". It does not say **which** thirty, and
the omission is not repairable after the fact: a subset picked by anything measured — the tasks R234 wired, the tasks
whose write the board already reached, the tasks that passed before — is a selection on the outcome, and B1's 94.5%
would become a lower bound on a sample chosen to be high.

The rule, stated before the first episode:

> The thirty tasks are positions **floor(i × 114 / 30)** for i = 0…29 in the bank's own id order — a systematic sample
> over the ordered frame, taken every 3.8 tasks — which is
> `0,3,7,11,15,19,22,26,30,34,38,41,45,49,53,57,60,64,68,72,76,79,83,87,91,95,98,102,106,110`.

Two reasons for a stride rather than a prefix: the bank's ids are contiguous and its task types are not shuffled, so
"the first thirty" is a slice of whatever the first quarter of the file happens to be; and a stride is fixed by the
frame size alone, so no quantity measured on any episode can move it. Trials are two (`--trials 2`), the seed set is
`400` as in every previous round, so the grid is thirty tasks twice = **sixty episodes**.

Nothing else changes. The bars, the stopping rule and the price are the ones above, and the estimate the window guard
will be armed with is `(1 × 30 × 2 × 26) / 3 / 60 + 10 = 18` minutes, which is what the dispatch will be held to.
