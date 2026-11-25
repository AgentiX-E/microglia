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

Registered 25 November 2026, after R218b. The dispatch was not built at registration: `run_split.py` runs one arm at
a time, so "interleaved" was a code change, not a flag. The round is registered before the build because the
prediction is what decides whether the build is worth doing.

## As built, before the first paid call

`eval/drivers/tau2/interleave.py` — a driver rather than a flag on `run_split.py`, and the difference is the
measurement rather than the tidy-up:

- **one process per (block, arm)**, not one process for both arms. Two arms in one interpreter share the provider
  client and the `litellm` callback that counts this lane's tokens, so their bills and their latencies would be one
  object's — and the refutation below names exactly that state (`SHARED_PROCESS`) as the one that proves nothing was
  measured. The cost is thirty τ² imports; the gain is a bill, a wall clock and a resumable round per part.
- **eight tasks a block**, so the two readings of a task sit a couple of minutes apart rather than R218b's
  thirty-five. The gap is *measured* per block and reported, because a block size that buys a gap nobody looked at
  is the confound again with a smaller constant.
- **the verdict is six states, not a bar**: `UNPAIRED`, `SHARED_PROCESS`, `GRID_ORDERED`, `ORDER_ASYMMETRIC`,
  `BILL_DRIFT`, `PLACEBO_HELD`. The order is the argument — a grid whose arms never disagree is an instrument that
  measured an import, and that has to be said before any delta is quoted.
- **the `p > 0.05` bar has no branch of its own, and the arithmetic is why**: with `moved` and `broke` within two
  tasks of each other the exact McNemar p is at least 0.5 (the tightest such split, 2 against 0, is p = 0.5), so the
  symmetry bar *implies* the significance bar. The p is still reported beside it.
- **a refuted prediction does not fail the build.** The workflow gates on the instrument's invariants (every task
  twice, both arms over a hundred episodes, at least ten measured blocks, at least one disagreement) and prints the
  prediction as a finding. A red job for a refuted prediction teaches an operator to rerun until the grid is green,
  which is the opposite of what a placebo is for (AUDIT 34.231).

The reading is `python3 eval/drivers/tau2/interleave.py --read --dir eval/results/working-memory`, and it needs no
`--compare`: the two arms are compared by the same `compare_of` `goal_board.py` has taken eleven rounds of readings
with, on the two documents the merge writes.

## What is measured

**Two arms with identical material** — no block in either — over the same 114 retail tasks, seed 400, **interleaved
by task** rather than arm by arm:

| arm | material | what it prices |
|---|---|---|
| `control-a` | none | the world, measured once |
| `control-b` | none | the same world, measured again one block later rather than 35 minutes later |

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
| wall clock, concurrency 3 | ~65 min by the driver's own estimate (thirty τ² imports included); R218b's grid ran 14 s an episode, which puts the floor near 35 min |
| window | one opening, off-peak; the guard refuses a start inside a peak band |

## The reading

The endpoint is the driver's own read, which merges the thirty parts and takes the pair with `goal_board.py`'s
`compare_of` — one implementation of the pairing, not a second:

```bash
python3 eval/drivers/tau2/interleave.py --read --dir eval/results/working-memory
```

It must print `PLACEBO_HELD` with a delta inside ±5 pp, moved and broke within two tasks of each other, and a bill
ratio inside 10%. Any of `GRID_ORDERED`, `ORDER_ASYMMETRIC`, `BILL_DRIFT` is the round's failure, and it is a
failure about the **instrument** rather than about the treatment: it says that a contrast measured inside one
dispatch of this grid is contaminated by the order the arms ran in, which is precisely what R216-1's +7.9 pp and
R218b's −6.1 pp could be. `SHARED_PROCESS` (no disagreement anywhere) is a failure too, and the opposite one: the
test would have measured an import rather than a run.
