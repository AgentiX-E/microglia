---
id: R218b-pass4
step: R218b
opened: 2026-11-25
# R218a read the leaderboard as data and found that sixteen of its rows state `pass^4` and this project states none.
# The round fills that cell, and its reading is the tool R218a built rather than a new script.
arms: control, front
sample: 114
gates: V0
recallFloor: 0
---

# R218b — four attempts, and the reliability column

Registered 25 November 2026, after R218a read the leaderboard as data and found that **sixteen of its rows state
`pass^4` and this project states none.** The round exists to fill that cell, and its reading is the tool R218a built
rather than a new script: a claim about a position has one place to come from.

## What is measured

Two arms, the same pair R216 dispatched, at **four attempts** instead of one:

| arm | material | what it prices |
|---|---|---|
| `control` | none | the world at four attempts |
| `front` | the R216 parser, block at the front | accuracy **and** reliability under the repairs |

Grid: **114 retail tasks × 4 attempts × 2 arms = 912 episodes**, seed 400, concurrency 6. `run_split.py` writes one
document per task per arm; `--trials 4` is the workflow input, not a new code path.

## Why four and not two

`pass^k` is defined for `k ≤ 4` in the board's own schema — `pass_1` through `pass_4`, and nothing above. A run at two
attempts produces a column the board has no slot for, so it would be a number that cannot be listed.

## Prediction

If attempts are independent draws at the arm's own rate, `pass^4 = pass^1⁴`:

| arm | `pass^1` (R216) | predicted `pass^4` | interval |
|---|---|---|---|
| control | 78.95% | 38.8% | [32, 46] |
| front | 86.84% | **56.8%** | **[50, 62]** |

- The front arm's `pass^4` lands between **50 and 62**, and above the control's by a margin the paired McNemar
  resolves.
- The front arm's `pass^1` stays inside R216's [−2.0, +17.6]: the repairs buy reliability without moving accuracy.
- The bill per episode stays inside the ±20% band, so the extra attempts are a change of metric rather than a change
  of treatment.

## Refutation

**The falsification test is in the same run.** §246.8 measured 22% turnover between two *dispatches* of the same arm
and used it to rule out drift. If the observed `pass^4` lands **above 62**, attempts are positively correlated — a
retry is not an independent draw — and the 22% figure is a between-dispatch property that says nothing about within-
dispatch variance. That would change how every interval in this lane is computed, so it is the round's second reading
and not a footnote.

- A `pass^4` above 62 does not refute the repairs; it refutes **the independence assumption every interval here
  rests on**, including the ones already published. The round is then a measurement of that assumption, and no
  ranking claim is made from it until the intervals are recomputed.
- A `pass^1` that collapses while `pass^4` rises means the arm trades accuracy for consistency. That is a finding
  about the treatment and not a win, and the submission is not made.

**The falsification test is in the same run.** §246.8 measured 22% turnover between two *dispatches* of the same arm
and used it to rule out drift. If the observed `pass^4` lands **above 62**, attempts are positively correlated — a
retry is not an independent draw — and the 22% figure is a between-dispatch property that says nothing about within-
dispatch variance. That would change how every interval in this lane is computed, so it is the round's second reading
and not a footnote.

## Bars, checked in this order

1. **liveness** — every arm reaches the model on ≥95% of the episodes the best arm reached (R216's gate; a cost
   ceiling is satisfied by an arm that stopped early).
2. **`pass^4` is stated** — the front arm's four attempts survive the merge: 114 tasks, each with four trials, no
   duplicate `(task, trial)`. `submission.py --emit` refuses the document otherwise.
3. **`pass^4` beats the control's** — paired by task, exact McNemar on the tasks that differ. This is the round's
   claim: the repairs buy reliability, not only accuracy.
4. **`pass^1` holds** — the paired `pass^1` contrast must stay inside R216's interval [−2.0, +17.6]; a `pass^1` that
   collapses while `pass^4` rises would mean the arm trades accuracy for consistency, which is a finding and not a win.
5. **the bill** — within the −20%/+20% band of the control's per-episode cost, as in R216.

## The reading

```bash
python3 eval/tools/submission.py --emit --arm front.json --harness replace \
  --injects "a state block at the front of the conversation" \
  --model deepseek-flash --model-organization DeepSeek \
  --tau2-version 1.0.1 --date 2026-11-25 \
  --reference https://github.com/AgentiX-E/microglia --out submission-r218b.json
python3 eval/tools/submission.py --check submission-r218b.json
python3 eval/tools/submission.py --position submission-r218b.json --metric pass_4 --domain retail
```

The third command is the round's endpoint. It exits `0` only if the row can be placed, and it prints the board's
sixteen `pass^4` rows with ours marked — or it exits `1` with the reason the artefact cannot support the claim.

## Cost

| item | value |
|---|---|
| 912 episodes (control $0.0044, front $0.0060) | **$4.75 ≈ ¥34** |
| wall clock at concurrency 6 | ~76 min |
| window | one opening, 10:02 UTC or later; the guard refuses a start inside a peak band |
