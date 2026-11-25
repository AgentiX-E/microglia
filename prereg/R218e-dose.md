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
