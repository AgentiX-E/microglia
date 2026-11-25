---
id: R219b-replication
step: R219b
opened: 2026-11-26
# R219 read +10.5 pp for the admission rule and a McNemar p of 0.029 — the largest delta this lane has measured that
# also clears its own test. It is also a single dispatch on a grid whose identical arms turn over 25.4% of their tasks,
# so the only thing that can turn the number into a claim is the same two arms run a second time.
arms: board, policy
sample: 114
gates: V0
recallFloor: 0
---

# R219b — the same two arms, again, because a single dispatch is a draw

Registered 26 November 2026, the hour R219 was read. R219's contrast is `policy − board` = **+10.5 pp**
[+0.4, +20.5], McNemar exact p = 0.0290, 19 tasks moved up and 7 down. Three things are true of that number at once:

1. It is the largest effect this lane has measured that survives its own test.
2. Its interval's lower bound is **0.4 points** — it excludes zero by four tenths of a point.
3. The grid's identical arms turn over **25.4%** of their tasks between dispatches (R218c), so a 26-pair discordance
   is exactly what noise produces, and only the *asymmetry* is the signal.

A single dispatch cannot separate an effect from a favourable draw, and this project has already published two
contrasts (+7.9 pp and −6.1 pp) that were the same code on the same seed. The round therefore repeats the identical
experiment — same arms, same seed world, same 114 tasks, same model — and asks one question: **does the sign hold?**

## What is measured

The paired contrast `policy − board`, its McNemar exact p, and the two mechanism readings that say the treatment ran
(`admission: state` on the policy arm, `charsMean` lower). Everything else is held fixed by construction, which is what
makes this a replication rather than a second experiment.

## Prediction

- **The sign holds**: policy above board, with the delta between **+3 and +15 pp**. A replication does not repeat the
  magnitude — it repeats the direction, and the two dispatches are then pooled.
- **At least 15 of the discordant pairs favour policy.** R219 had 19 of 26; a draw that produced 15 of 26 would still
  be p ≈ 0.28 on its own, so the pooled reading across both dispatches is what the claim will be made on.
- **The mechanism numbers repeat within 10%**: `charsMean` 140 ± 14, `changes` 211 ± 21, and `admission: state` on
  every policy phase. A replication whose mechanism counts disagree is a replication of a different treatment.
- **The bill does not rise**: `policy ≤ board` within the same 20% band.

## Refutation

- **Policy at or below board** refutes R219's effect. The honest record is then that the admission rule's +10.5 pp was
  a draw, the rule is **not** promoted to a product default, and the accumulated evidence says the block's harm — if
  any — is not in its two judgment lines.
- **A sign that holds but a magnitude below +3 pp** means the rule is real and small: it stays a default only if the
  pooled interval excludes zero, and the record says so rather than quoting the larger dispatch.
- **A mechanism count outside its band** refutes the replication regardless of the accuracy numbers: two arms that did
  not run the treatment cannot confirm or deny it.

## Cost

| item | value |
|---|---|
| 228 episodes at $0.0054 | **$1.23 ≈ ¥8.8** |
| wall clock at concurrency 3 | ~30 min |
| window | one opening, off-peak |

## The reading

```bash
python3 eval/tools/goal_board.py --compare board.json policy.json --json
```

and the pooled reading is the two dispatches' discordant pairs added: `moved` and `broke` are counts of the same
quantity, so they pool without an estimator, which is the reason this round is cheap.
