---
id: R214-working-memory
step: R214
opened: 2026-11-24
# The unit of memory changes. Three rounds served a sentence about a failure and measured a wash; this round
# serves *state* — the asks the request states, ticked only when a tool receipt names them — recomputed on every
# turn from the messages the episode already holds. Two arms, one attempt, the whole population.
arms: control, board
sample: 114
gates: V0
recallFloor: 0
facadePair: off
facadeNotes: off
facadeShapes: off
distillScope: all
distillUnit: raw
rawCeiling: 2000
serveBody: guidance
speakMargin: 0
trials: 1
trainDomain: retail
testDomain: retail
recallDomain: retail
packBudget: 2400
taskSplit: official
trainTasks: 0
testTasks: 114
release: v1.0.1
claimRuler: interval
---

# R214 — the state channel, and the grid the lesson channel was never measured on

**Registered** 2026-11-24, before the dispatch. R213 closed the lesson channel with its own registered refutation:
the evaluator's verdict named **82 of 82** unmet requirements — 100%, against the paraphrase's 52.1% — and repaired
**fewer** of them (45.8% against 54.1%). Naming is not causing. The material was not mis-pointed, it was inert, and
the round also found why the lane could not have known that earlier: at attempt 0, where no arm has a note and every
arm sends the same prompt at the same seed, the arms differed by **4 tasks of 20** — a 20-point noise floor on a
24-task grid, larger than every effect this lane has spent four dispatches measuring.

## What the record says, and where it points

The published ablation of the system that holds the SOTA on this benchmark prices the two channels separately
(Recuris, arXiv 2608.24876, NUS/Stanford/Oxford/Princeton, August 2026, ablation on τ²-retail):

| component | τ²-retail effect |
|---|---|
| experiential skills alone — a library of lessons | **+2.0 points, interval includes zero** |
| verified working state alone — a goal board | **+23.9 points** |
| both | +25.4 |
| the whole library dumped into context every turn | 65.6, against 83.6 for the one skill matched to the call |
| removing write review (the checker) | −13.5 on airline |

That is this lane's finding arriving from the other direction. Three rounds here measured the channel the SOTA
prices at +2.0 and found +1.8 pp with p = 1.0; the channel it prices at +23.9 has never been built here. This
round builds it — and, unlike the last three, it is **free at the material**: the board is a parser over text the
episode already carries, so the arm makes no summariser call and spends no tokens on its material.

## The mechanism

`eval/tools/goal_board.py` reads the user's messages for asks — a family (exchange, return, cancel, modify,
address, payment, transfer) and the content words that name the object — and reads the agent's tool calls for
**receipts**: state-changing calls that succeeded, with the product names of the items they touched, resolved
through the `item_id → name` pairs the episode's own `get_order_details` results already proved.

An ask is ticked only when a receipt of the same family **names the product the ask names** — containment, in
either direction, because a user says "the keyboard" about a Mechanical Keyboard. Two exchanges in one order, one
performed, is the shape this benchmark fails on, and a board that ticked both would remove the agent's reason to
look. A receipt whose product cannot be named is reported in its own line as *unattributed* rather than credited to
the nearest open ask; an ask that names no object ("cancel the order") is settled by the first receipt of its
family and by nothing else.

The board is **recomputed on every turn** from `state.messages`. That is the whole difference between this and a
note: the note is written once after a failure and read at the next attempt, while the board at turn nine knows
what turn nine's receipts proved. It is served under its own tag (`microglia-board`) so the pack the store
renders and the board cannot be confused, and the previous turn's board is removed by the same test that removes a
repeated pack (R137).

## The grid, and why it is 114 tasks

R213's floor of 20 points is a property of 24 tasks: four tasks of drift, at n = 24, is the same number as the
tolerance the drift check uses. The bank already holds **114 tasks × 4 trials** at $2.0103, and its attempt-0 pass
rate is 91 of 114 (79.8%) — which is the control this round needs. So:

| arm | material | episodes | cost |
|---|---|---|---|
| `control` | none | 114 | ≈ $0.50 |
| `board` | the goal board, recomputed every turn | 114 | ≈ $0.50 |

228 episodes, one attempt each, the same seed world for both (`--seed 400`), both inside one `run_tasks` call per
arm — no sidecar, so no one-task-per-process constraint, and 114 imports become one. **≈ $1.0 (¥7.2)**, ~35
minutes at concurrency 3. The floor at n = 114 is ~9 points, so the registered bar of +10 pp is the smallest effect
this grid can honestly resolve, and the report will say that the bar and the floor are the same size.

## Prediction

- **P1** — the board renders on at least **95%** of turns after the first user message and lists at least one ask
  on at least **80%** of episodes. A mechanical prediction about the wiring: if it fails, no other reading from this
  dispatch may be quoted.
- **P2** — paired `pass^1` moves by at least **+10 pp**, McNemar's exact p < 0.05, and the 95% interval excludes
  zero (`BOARD_UP`). This is the registered endpoint and the only one that makes the board a product default.
- **P3** — of the episodes that contain at least one successful state-changing call, at least **50%** end with a
  ticked ask. This is the attribution rule measured at run time rather than assumed from the census: if the parser
  attributes nothing, the board is a list of open lines and the next round is a checker, not a prompt.
- **P4** — the arm's bill stays within **15%** of the control's and the board's mean injected length stays under
  **800 characters** a turn. A state channel that costs a fifth of the episode budget has to clear a higher bar
  than one that is free, and a reading that hides its own price is the reading this lane keeps repairing.

## Refutation

- **If P1 fails** — the board was not served, or the request named no ask the parser could see — then the arm
  measured the wiring and the parser, not the channel. The dispatch is refused, the cause is a defect, and the next
  round re-registers.
- **If P2 fails** — no movement of the bar's size — then **verified state as this parser builds it does not
  transfer**, and the +23.9 in the literature is a property of a checker that writes the board from a *verified*
  tool receipt rather than of a board that re-reads a transcript. The next spend is R215: the checker, inside the
  write path, where an item can be marked done only by the code that performed the write. The lesson channel stays
  closed; nothing in this lane re-opens it.
- **If P2 shows `BOARD_DOWN`** — the interval excludes zero on the negative side — then a board without a verifier
  **harms**, most plausibly by telling the agent that a settled ask is open (or the reverse) and buying a
  re-confirmation the user did not ask for. Then no state channel ships without a verifier, and the product default
  stays memory-free until R215 lands.
- **If P3 fails** — attribution below 50% — then the parser's ceiling is the binding constraint, the +23.9 cannot
  be reached from a transcript alone, and the roadmap's next step is unchanged (R215) but its justification changes
  from "the catalogue says a checker matters" to "the parser cannot attribute".
- **If P4 fails** — the board costs more than 15% — then even a positive P2 is not a deployable default without a
  cheaper render, and the arm is reported as a research result rather than a product configuration.

## What this does not claim

The board reads what the user said, not what the user *meant*. Task 5 of this corpus asks for an exchange, then
changes its mind mid-conversation and asks for a return; a board that lists both is faithful to the text and wrong
about the script, and the parser's census (79.6% of required objects, 41.4% precision, 3.8 asks a task) prices
that. This round measures whether an imperfect, free, receipt-checked list of asks helps — not whether a perfect
one would.

It also does not claim the census's numbers for the run. The census reads `reason_for_call`, the text the user
simulator was given; the board at run time reads the simulator's **paraphrase**, which is shorter, first-person and
sometimes wrong. P1 and P3 are the run-time readings that replace the census, and the report quotes both.

## The instrument

`eval/tools/goal_board.py` — one file, standard library only, 60 self-check cases, 99% line and branch coverage:
the clause parser, the receipt reader, the containment rule, the renderer, the census, and the paired reader
(McNemar exact, Newcombe interval quoted as conservative). `run_split.py` gains `--note-source board` and refuses
`--notes` beside it; `microglia_agent.py` gains `board_for`, the two-tag removal test and the arm's own counters;
`selfcheck_agent.py` gains the case that proves the board is recomputed and never accumulates. The workflow is
`.github/workflows/working-memory.yml`, whose contract job also runs the agent's 223 assertions — a suite that no
workflow had run until this round (AUDIT 34.216).
