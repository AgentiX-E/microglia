---
id: R218c-interleave
step: R218c
opened: 2026-11-25
# R218b found the same treatment arm reading 86.84%, 81.60% and 78.07% across three dispatches of one afternoon, with
# the two arms of its own grid starting 35 minutes apart. This round buys the cheapest possible test of whether that
# is a time confound: two arms that are the same code, interleaved task by task, which must read zero.
arms: control, control
sample: 114
gates: V0
recallFloor: 0
---

# R218c — the placebo, interleaved: two identical arms, and a registered delta of zero

Registered 25 November 2026, after R218b. The dispatch is not yet built: `run_split.py` runs one arm at a time, so
"interleaved" is a code change (an arm-pair flag that runs task *i* on both arms before task *i+1*), not a flag. The
round is registered before the build because the prediction is what decides whether the build is worth doing.

## What is measured

**Two arms with identical material** — no block in either — over the same 114 retail tasks, seed 400, **interleaved
by task** rather than arm by arm:

| arm | material | what it prices |
|---|---|---|
| `control-a` | none | the world, measured once |
| `control-b` | none | the same world, measured again, 40 seconds later rather than 35 minutes |

Grid: **114 tasks × 2 arms × 1 attempt = 228 episodes**, ≈ **$1.3**. Every task appears twice; the only thing that
differs between the two readings of it is when it ran.

## Prediction

- The paired delta is **0 within the grid's resolution**: **|δ| ≤ 5 pp**, exact McNemar `p > 0.05`. Two identical
  arms must be indistinguishable, and a grid that cannot produce that cannot measure anything else.
- The **moved and broke counts are symmetric** within two tasks of each other. A systematic direction would mean the
  second arm benefits from something the first one left behind — a warm cache, a warmed user simulator, a database
  the first arm wrote.
- The **bill per episode agrees within 10%**. Identical material on identical tasks should cost the same; a gap is a
  provider-side difference between the two halves of the run.

## Refutation

- **A delta above 5 pp in either direction refutes the grid, not the memory.** It would mean that a contrast measured
  inside one dispatch is contaminated by the *order* of the arms — which is precisely what R216-1's +7.9 pp and
  R218b's −6.1 pp could be. No treatment contrast would be publishable from this grid until the interleave is the
  default.
- **A bill gap above 10%** refutes the assumption that the two halves ran under the same provider conditions, and the
  interleave is then necessary but not sufficient: the arms also have to be *close in time*, which is what running
  task-by-task buys.
- **A delta of exactly zero on every task** would be suspicious rather than reassuring: it would say the two arms
  shared a process, and the test would have measured an import rather than a run.

## Cost

| item | value |
|---|---|
| 228 episodes at $0.0044 | **$1.00 ≈ ¥7.2** |
| plus the front arm's re-read if the first pass is clean | $1.30 total ceiling |
| wall clock at concurrency 6 | ~30 min |
| window | one opening, off-peak; the guard refuses a start inside a peak band |

## The reading

The endpoint is the paired reader the other rounds use, with the arm names swapped:

```bash
python3 eval/tools/goal_board.py --compare control-a.json control-b.json --k 1
```

and it must print `NO_LIFT` with a delta inside ±5 pp. A `LIFT` on two identical arms is the round's failure, and it
is a failure about the instrument rather than about the treatment.
