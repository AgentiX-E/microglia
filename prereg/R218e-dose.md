---
id: R218e-dose
step: R218e
opened: 2026-11-25
# R218d asked the cheapest question this lane has: inside one task, did the attempts that received more material
# pass more often? It could not answer, and the reason was not the statistics — a front-placement block goes into
# `state.system_messages` and never into the transcript τ² saves, so 32 MB of a treated arm's document contains
# zero board messages. The dose has to be written down where it is known.
arms: board
sample: 114
gates: V0
recallFloor: 0
---

# R218e — the dose, recorded where it is known

Registered 25 November 2026, after R218d. One arm, one attempt, and the arm is the placement this product ships
(`tail`): its block is appended into `state.messages`, so the transcript carries it and the dose is checkable from
two independent directions on the same episode.

## What is measured

One JSONL sidecar an arm writes at episode end, one line per episode:

| field | what it is | what it is for |
|---|---|---|
| `task` | the task id the driver declared | joins the line to the document's reward |
| `trial` | the attempt index | `pass^k` is per task and per attempt |
| `turns` | model calls the episode made | the confound, measured rather than named |
| `renders` | how many times the block was recomposed | the cadence the counters already report per phase |
| `chars` | characters of block served, summed | the dose |
| `changes` | how many renders produced a different block | the part of the dose that is new information |

The grid is **114 episodes**, ≈ **$0.55**, and it is not a contrast: it buys the recording, and the recording is
what every later reading about the material needs.

## Prediction

- **The `chars` the sidecar writes equal the characters the transcript carries**, on every episode. The tail
  placement puts the block in `state.messages`, so `board_dose.py`'s tag reader can check the recording against the
  artefact it describes. A recording that disagrees with the document it accompanies is worse than none.
- **`renders` is within 2% of the phase counter's own `renders`**, which is what makes the sidecar an attribution
  rather than a second census.
- **`chars / turns` is stable across tasks** (coefficient of variation under 0.5): the material is a list of asks,
  and a list that swings by an order of magnitude between tasks is a list whose length is deciding the reading.
- **The within-task sign test has power.** With four attempts an arm and a dose that varies within a task, the
  reading `board_dose.py` produces is a pair per task; the round predicts that R219 can then be read per episode
  rather than per arm.

## Refutation

- **A sidecar that disagrees with the transcript** refutes the recording and, with it, the value of every
  per-episode attribution the lane might make from it. The check is free and runs in the workflow.
- **A dose that is constant within a task** would refute the premise: if every attempt at a task receives the same
  amount of material, there is no within-task comparison and the material's effect is not identifiable from one
  arm at all — it would need a randomised dose, which is a different round.
- **`turns` and `chars` collinear above 0.9** would refute the decomposition as a *dose* reading and leave it a
  length reading: the honest response is to say so and stop quoting it against the material.

## Cost

| item | value |
|---|---|
| 114 episodes at $0.0048 | **$0.55 ≈ ¥4.0** |
| wall clock at concurrency 3 | ~18 min |
| window | one opening, off-peak |

## The reading

```bash
python3 eval/verifiers/board_dose.py --document eval/results/working-memory/board.json
python3 eval/verifiers/board_dose.py --document eval/results/working-memory/board.json \
    --sidecar eval/results/working-memory/board.dose.jsonl
```

The first must answer `DOSE_READ` rather than `NO_DOSE` — that is the whole round — and the second prints the
agreement between the recording and the transcript, which is the check the prediction above binds it to.

Neither `--sidecar` nor the writer exists yet, and the registration says so rather than assuming it: the flag is
part of this round's build, and the sidecar is written by the arm. What exists today is the reader's other half
(`--document`, with `NO_DOSE` as its answer on every arm whose transcript carries no block) and the measurement that
made this round necessary.

---

# Amendment, 26 November 2026 — before dispatch, and the registration was wrong in three places

All three were found by measuring documents this lane had already paid for, at no cost, and all three would have
spent ¥53 of grid on an instrument that could not have answered.

## 1. The transcript could not have carried the block at *either* placement

The registration's first prediction was "the `chars` the sidecar writes equal the characters the transcript carries,
on every episode", on the reasoning that the tail placement appends the block into `state.messages` and the transcript
therefore carries it. The reasoning was wrong twice over. Measured over the four documents the lane already holds —
R215's `front`, R216's tail arm, R219b's `board` and `policy`:

| document | tag occurrences | roles in the transcript |
|---|---|---|
| R215 `front` (114 ep) | 0 | `assistant`, `user`, `tool` |
| R216 `board` (tail, 114 ep) | 0 | `assistant`, `user`, `tool` |
| R219b `board` (tail, 114 ep) | 0 | `assistant`, `user`, `tool` |
| R219b `policy` (tail, 114 ep) | 0 | `assistant`, `user`, `tool` |

**τ² stores the conversation, not the prompt: there is no `system` message in any of them**, at either placement. So
R218d's `NO_DOSE` was not a fact about the front placement, and this reader's honest state for a document with no
system message is now `NO_SYSTEM` — a fact about the document rather than about the arm.

**The prediction is therefore replaced, not softened.** The recording is checked against the quantity that is
produced independently of it: the phase's own counters. Summing the rows must reproduce `renders`, `charsTotal` and
`changes` **exactly**, and `written` (the material carried) must be at most `chars` (the material served). Those three
identities are what catch a recording that lost an episode, counted one twice, or drifted from the module that
produced the counters — and unlike a transcript check, they are checkable on the artefact the run actually writes.

## 2. One attempt a task cannot produce a single pair

The registration's grid was 114 episodes, ≈ $0.55, and its own fourth prediction describes "four attempts an arm".
Those are inconsistent: the reader splits each task at its **median dose** and needs an attempt strictly above and
strictly below, so with one attempt a task it answers `NO_PAIRS` **by construction** on any recording whatsoever.

The amended grid is **114 tasks × 2 rounds = 228 episodes**, ≈ **$1.10 ≈ ¥8.0**, and `--rounds 2` rather than
`--trials 2` for a reason that is about identity rather than about money: a round is its own `run_tasks` call with
`trials=1`, so every task appears exactly once in it and the round *is* the attempt index (`merge_rounds` writes it as
the document's `trial`). `--trials 2` runs both attempts concurrently inside one call, and the attempt index is then
completion order — not recoverable. With two attempts a task the median is the mean of the two, so the split is exact
whenever the two doses differ and produces no pair when they are equal, which is the honest case.

## 3. The recording is the agent's, and the join is the runner's

`microglia_agent` keeps one record an episode — `turns`, `renders`, `chars`, `written`, `changes`, `stable` — opened at
the same single site that opens the boundary index, the injected flag and the boundary text, and mutated in place by
the renderer and the writer. The **runner** resolves the boundary text to a task (R136's reader, unchanged) and
partitions the recording into rounds by snapshotting its length after each round; `eval/drivers/tau2/dose.py` makes
the join and refuses three states rather than guessing: a slice of the wrong length, a task twice in one round with no
way to tell the attempts apart, and a record whose task the round did not run. The sidecar is one JSONL line an
episode, written beside the document.

A trial index derived from a turn count was tried first and rejected on a measurement: over R219b's `board.json` the
phase counted **1,171** agent calls and the transcript holds **1,274** assistant messages, so the two are not the same
quantity and a join on them would be off by an episode somewhere in the middle of the grid while looking correct
everywhere else.

## What still stands

The confound, the falsifications and the cost arithmetic are unchanged, and the refutations are now sharper:

- a recording that disagrees with the census refutes the recording, and the comparison is a gate in the workflow;
- **`NO_PAIRS` refutes the premise** — a dose that does not vary inside a task means the material's effect is not
  identifiable from one arm at all — and it is reported as a warning rather than as a red job, because a refuted
  prediction is a finding and a red job teaches an operator to rerun until it is green;
- `turns` and `chars` collinear above 0.9 still refute the decomposition as a *dose* reading.


---

# Amendment 2, 26 November 2026 — the estimator, fixed before the second dispatch

## What was missing, and it was the round's decisive quantity

The registration names the confound and then declines to control it: *"the quantity that decides whether it is worth a
registered round is the **sign** of the effect on the pairs whose dose differs while their turn counts are close."*
The reader implemented `turnGapMedian` — the confound summarised over **all** pairs — and no subset at all. A file whose
prose says which quantity decides, and which computes a different one, has a decisive number that does not exist; the
second dispatch would have landed on it and the reading would have been quoted from the confounded column because it
was the only column there was (AUDIT 34.267).

The subset is now `closeTurnPairs` and four companions, drawn at one tolerance, and the tolerance is a measurement
rather than a preference.

## How many close pairs a 114 × 2 grid can make, counted before spending

R218b's `front` arm holds **four attempts at each of 114 tasks in one arm** — 684 within-task attempt pairs, and the
only artefact on disk where one task's attempts can be compared without changing the arm. Measured over it
(`eval/tools/dose_power.py --document <an arm with four attempts a task>`, no model calls):

| quantity | value |
|---|---|
| within-task pairs | 684 |
| gap in length, median / mean | **1** / 1.57 turns |
| pairs tied exactly | 27.3% |
| pairs within **1** turn | **60.2%** |
| pairs within 2 turns | 80.0% |
| pairs within 3 turns | 91.7% |
| within-task outcome disagreement under exchangeability | **17.9%** |
| tasks that always pass / never pass / do both | 61 / 3 / 50 |

Two consequences, and both are about the grid rather than about the material. On 114 tasks with two attempts each the
round expects **≈ 20 discordant pairs** in total and **≈ 12** among the subset whose sides ran within one turn. A
sign test counts discordant pairs and nothing else: sixty-one tasks here pass all four attempts, so most of the grid
can never enter the test however different their doses are.

The length is the **assistant-message count**, not the recorded `turns`: R219b's phase counted 1,171 agent calls
against 1,274 assistant messages over 114 episodes (AUDIT 34.263), so these shares carry about nine percent of slack,
and a tool loop re-renders inside one user turn. The measurement is also from the `front` placement, which is not the
placement this round runs; no tail artefact holds more than one attempt a task, and that is precisely why the round is
being dispatched.

## The estimator

| | what | reported as |
|---|---|---|
| **primary, decisive** | the exact two-sided sign test on the pairs whose two sides average within **1 turn** of each other | `closeTurnPairs`, `closeHigherDosePassed`, `closeLowerDosePassed`, `closeP`, `tiedTurnPairs` |
| secondary | the same test over every pair, with the length gap beside it | `pairs`, `higherDosePassed`, `lowerDosePassed`, `p`, `turnGapMedian` |
| secondary | how much material the decided subset received | `closeDoseGapMedianChars`, `closeTurnGapMedian` |

**Not analyses of this round**, and named so they are not run afterwards and reported as if they had been registered:

- a dose-quartile reading — the grid holds two attempts a task, so a quartile split would be a split of one pair;
- a between-task dose regression — it recovers task difficulty and is the reading the reader's docstring already
  refuses;
- anything computed on the **reconstructed** block — 7,813 turn boundaries against 4,341 renders, and its ordering is
  dominated by the turn count.

## Power, enumerated rather than approximated

Pair counts here are under thirty and the normal approximation is worst exactly there, so the reject probabilities are
enumerated. Two-sided, α = 0.05:

| discordant pairs | shift 65% | 70% | 75% | 80% | 90% |
|---|---|---|---|---|---|
| 6 | 0.08 | 0.12 | 0.18 | 0.26 | 0.53 |
| 10 | 0.09 | 0.15 | 0.24 | 0.38 | 0.74 |
| 14 | 0.08 | 0.16 | 0.28 | 0.45 | 0.84 |
| 20 | 0.25 | 0.42 | 0.62 | 0.80 | 0.99 |
| 30 | 0.36 | 0.59 | 0.80 | 0.94 | 1.00 |

`shift` is the probability that the higher-dose side wins a discordant pair. At the ~12 pairs the decided subset is
expected to hold, the round has **0.4** power against a shift of 80% and **0.8** against 90%; over all ~20 discordant
pairs it has 0.80 against 80%. So the round can return a **verdict** only on a large effect and a **bound** otherwise.

## The decision rule, written before the numbers exist

- **Verdict** requires all three: `closeTurnPairs ≥ 10`; the sign test on that subset at `closeP < 0.05`; and the same
  sign over all pairs, so the decided subset is not the only place the effect appears. The reported quantity is then
  the decided subset's `closeHigherDoseRate`, with its pair count and the tie count beside it.
- **Bound** — the pre-registered default, and the outcome for any weaker sign — is reported as: *no shift in the
  pass rate of the higher-dose attempt larger than this grid can see, at the pair counts it actually made.* The
  sentence must carry both numbers, because "no effect" over 12 discordant pairs is a statement about 12 pairs.
- **Underpowered** is its own outcome: `closeTurnPairs < 10` returns no verdict at all, whatever `closeP` says. The
  workflow prints it as a warning rather than failing, because a grid whose attempts happened to differ in length is a
  fact about the population and not a defect in the build.
- **`NO_PAIRS`** still refutes the premise rather than the recording, unchanged from the first amendment.
