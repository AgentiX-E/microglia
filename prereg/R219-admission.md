---
id: R219-admission
step: R219
opened: 2026-11-26
# R216's split put the harm where the block was not needed: it breaks 6 of the 90 tasks no-memory already solves and
# saves 15 of the 24 it cannot. The registered bar was written from those two cells. What the round now has, and what
# it did not have when it was registered, is the *reason* the block damages solved trajectories: two of its lines are
# judgments about the agent's calls, and the parser that writes them is wrong about the task nine times in ten.
arms: board, policy
sample: 114
gates: V0
recallFloor: 0
---

# R219 — the admission policy: state, and not judgment

Registered 26 November 2026, after R218c priced the grid's resolution and R219's bar was re-derived from a count
rather than from a mean. It is amended here — before it is dispatched — in three ways, and each amendment is a
correction rather than a licence.

## What the round is, and what it is not

The block has three kinds of line. Two are **state**: the asks the request stated, and the ones a tool receipt
settled. Two are **judgment**: `Not asked for by the request` and `Not attributed to any ask`. The judgments are the
only part of the block that makes a claim about the *request* rather than about what happened, and the claim belongs
to the parser, not to the evaluator.

`goal_board.py --accusations` is this round's first deliverable, and it is an instrument rather than a treatment: it
reads a τ² results document the lane has already paid for, takes the evaluator's own `evaluation_criteria.actions` as
ground truth, and judges every refusal entry the block would have shown. On R218b's front arm — 456 episodes, 1,965
entries, 107 tasks with criteria:

| reading | value |
|---|---|
| entries naming a family the task **requires** a write in | **1,808 / 1,965 = 92.0%** |
| the same over the last block of each episode only | 239 / 277 = 86.3% |
| episodes carrying at least one such entry | 178 of 456 |
| `unattributed` entries that are false | 461 / 470 = 98.1% |
| `unrequested` entries that are false | 1,347 / 1,517 = 88.8% |

So the block spends nine tenths of its refusals telling the agent it did something nobody asked for, on tasks where
somebody did, because the parser missed the ask — and `unattributed`, the line whose whole purpose is to be honest
about the parser's blind spot, is wrong about the task in 98 cases out of 100.

The treatment is one switch: **the block admits state and refuses to admit either judgment.** Placement, parser,
model, seed and grid are held fixed by construction — `policy` is the tail placement (the configuration the product
ships, `serving-defaults.json`) with `state_only=True` at the renderer, and `board` is the same arm with the rule off.

## Amendments to the registration as it stood

1. **Arms: `front, policy` → `board, policy`.** The registered pair was written before R216b confirmed the tail as the
   shipped placement. Testing the rule at `front` would measure a treatment the product does not use, and a delta
   between two placements is not the quantity this round is about.
2. **The endpoint is a count in a stratum, as registered.** `regressions 6 → ≤1` out of the 90 control-solved tasks,
   with `≥12 of 15` rescues kept. A count in one stratum is the only shape 114 tasks can resolve: 25.4% discordance
   puts the grid's resolution at 13.2 pp for a mean (R218c), which is a bar no 5-point mean can clear, while 6 → ≤1
   is a 5-in-90 move that a paired exact test reads at p < 0.05.
3. **The null is named before the run.** If the delta over the population is inside ±13.2 pp and the regression count
   does not fall, the reading is `NO_ADMISSION_EFFECT` and the honest sentence is that the blocking channel's harm is
   not in the two judgment lines. It is *not* a licence to try a fourth rendering rule in the same round.

## Prediction

- **Regressions fall from 6 to at most 1** among the tasks the no-memory arm solves, read on the same seed and the
  same 114 tasks. Point prediction: **2**, because the rule removes a channel rather than an error.
- **Rescues stay at 12 or more of 15.** The rule does not touch the asks or their ticks, so the channel the hard
  stratum uses is unchanged; a fall below 12 would mean the refusal lines were doing work in the hard stratum, which
  is the opposite of what R213 and arXiv 2608.24876 price.
- **The block gets shorter and moves less.** `charsMean` falls by 5–25% (two lines of the block are gone) and
  `tailAppends` does not rise — a shorter block that changes as often is a block that has not been short of lines.
- **`admission: state` is in the phase's `board` census**, with `renders > 0`. A policy arm that reports
  `admission: all` is the treatment never having been applied, and the reading in that case is `SHARED_PROCESS`'s
  sibling: a wiring defect, not a null.
- **The bill does not rise**: `billPerEpisode(policy) ≤ billPerEpisode(board)` within 3%. A shorter block behind the
  conversation cannot cost more; if it does, the placement is being written more often, which is a finding.

## Refutation

- **A regression count that does not fall** (≥4) refutes the mechanism this round is built on — that the harm is the
  judgment channel — and ends the rendering-rule line of work. The alternative left standing is that the harm is the
  block's *presence* (dose) rather than its *content*, and the next round on that premise is a dose round (R218e),
  not a fifth renderer.
- **Rescues below 12** refutes the separation between the two channels: it would mean the refusals were carrying the
  hard stratum's gain, and the two-line rule would then be a trade rather than a repair.
- **Accuracy down with the block shorter** refutes the "shorter is safer" reading and makes the block's length a
  variable in its own right, which no round has yet registered.
- The instrument itself is refutable and free: `--accusations` disagreeing with a hand count on the fixture in
  `goal_board.py --self-test` is a defect in the instrument, and the instrument is what the whole premise rests on.

## Cost

| item | value |
|---|---|
| 228 episodes at $0.0048–0.0058 | **$1.20 ≈ ¥8.6** |
| wall clock at concurrency 3 | ~45 min |
| window | one opening, off-peak |
| the instrument (`--accusations`) | **$0** — it reads an artefact from R218b |

## The reading

```bash
python3 eval/tools/goal_board.py --compare eval/results/working-memory/board.json \
                                 eval/results/working-memory/policy.json --json
python3 eval/tools/goal_board.py --replay eval/results/working-memory/policy.json
python3 eval/tools/goal_board.py --accusations eval/results/working-memory/board.json
```

The first is the registered contrast, the second is the attribution (does the arm's own block still tick asks once the
judgment lines are gone), and the third is the instrument that justified the round, run on the control artefact so the
number in this file can be re-derived rather than remembered.

`--compare` reports `moved` and `broke` per task; the two counters the bar is written in come from those, restricted
to the tasks the no-memory arm solved (`broke`) and to those it did not (`moved`) — the same split R216's §248.7 read
from two artefacts for nothing.
