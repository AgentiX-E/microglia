---
id: R215-contract
step: R215
opened: 2026-11-25
# R214 built the state channel and measured −5.3 pp and a 77% bill. The diagnosis was two defects with one cause:
# the board read every user turn, so it grew to 10.6 asks against the 1.58 a request states and its text changed on
# nearly every turn, which is what re-billed the prefix. This round fixes the unit: a contract read from the
# request, and a block that can move only when a receipt moves it.
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

# R215 — the contract: asks from the request, and a block that moves only when a receipt moves it

**Registered** 2026-11-25, before the dispatch. R214 is the round this one repairs, and it failed in both
directions at once:

| R214 reading | value |
|---|---|
| paired pass^1 | **−5.3 pp**, [−15.0, +4.5], McNemar p = 0.2632 (13 broke against 7 moved) |
| asks listed at the last turn, mean | **10.6** — against the **1.58** a request states |
| of which ticked (P3, which held) | 1.58, 79.2% of episodes with a write ended with one ticked |
| provider cache hit rate | 90.4% → **75.1%** |
| bill per episode | $0.0045 → **$0.0080**, +77% for a 200-character block |

The cause is one rule. The board collected asks from **every user message**, and a simulated user's clarifications
("also the desk lamp", "yes, the blue one", "no, only the lamp") are sentences that name objects and follow a verb.
So the list grew, and because it grew the block's text changed on nearly every turn — and a system block at the
front of the prompt that changes every turn invalidates the prefix the provider had already cached. The 77% is not
a length, it is a cadence (PROGRESS 244.3).

## What this round changes

1. **The asks are the request's.** `board_of` reads the first user message and only the first. A clarification
   refines a clause; a parser that cannot tell which clause a "yes" refines must not add one. `scope="conversation"`
   keeps R214's reading, so the difference between the two is a measurement rather than an argument.
2. **The checker's output is split.** A receipt that settles nothing is now reported as one of two facts:
   `unrequested` (the request never asked for a call of that family — work nobody asked for, which is the failure
   τ² charges for) or `unattributed` (the family was asked for and this board could not name what the call touched —
   the parser's own blind spot). R214 reported both under one line and a reader could not tell which was which. A
   **failed** call is now on neither line: it changed no state.
3. **The negation rule was repaired, not extended.** The parser now refuses "I don't **want to** return" as well as
   "don't return", which it had been letting through as a live ask; and it does **not** refuse "if the agent doesn't
   allow **the** exchange", which a determiner makes a noun. Measured on the census: recall unchanged at 176/226,
   noise 238 → **235**.

This round cannot separate (1) from (2): both are in the arm, and the ablation that separates them is R216's. What
it can say is whether the cadence was the harm or the list was.

## The grid, and what it costs

The same 114 tasks, one attempt each, seed 400, both arms inside one `run_tasks` call per arm — R214's grid, re-run
rather than reused, because R211's drift check is about arms dispatched minutes apart and R214's control is a day
old.

| arm | material | episodes | estimate |
|---|---|---|---|
| `control` | none | 114 | ≈ $0.51 |
| `board` | the contract, re-served every turn, changing only on a receipt | 114 | ≈ $0.55 |

**≈ $1.06 (¥7.6)**, ~30 minutes at concurrency 3. The bar and the floor are the same size as R214's: at n = 114 the
noise floor is ~9 points, so +10 pp is the smallest effect this grid can honestly resolve.

## Prediction

- **P1 — the wiring, unchanged.** The board renders on at least **95%** of turns after the first user message, and
  at least one ask is listed on at least **80%** of episodes. If this fails, no other reading from the dispatch may
  be quoted.
- **P2 — the mechanism, checked before the rate.** The block **changes on at most a third of the turns it is served
  on**, the arm's **cache hit rate stays within 3 points** of the control's, and the mean block stays under **500
  characters**. This is the endpoint R214's bill bought: a state channel that cannot hold a prefix is not a
  deployable default whatever it does to accuracy.
- **P3 — the harm is gone.** Paired pass^1 against the control is **not worse by more than 3 points**
  (`delta > −0.03`). R214's −5.3 is the number to beat back to zero, and a repair that leaves the arm still
  materially worse has not repaired anything.
- **P4 — the lift, unchanged from R214.** Paired pass^1 **+10 pp**, McNemar exact p < 0.05, interval excludes zero
  (`BOARD_UP`). This is the bar that makes the channel a product default, and it is deliberately not lowered just
  because the previous round failed it.
- **P5 — attribution at run time.** Of the episodes that contain at least one successful state-changing call, at
  least **60%** end with an ask ticked. R214 measured 79.2% with a polluted list; a contract of 1.5 asks should
  attribute at least as well, and if it attributes *worse* the request's paraphrase is the binding constraint.

## Refutation

- **If P1 fails** — the request the simulator writes names no ask the parser can see. Then the arm measured the
  paraphrase, not the channel, and the next round reads the request from the evaluator's own `reason_for_call`
  rather than from the simulator's rendering of it. The dispatch is refused as a wiring defect.
- **If P2 fails on the cadence** — the block still moves on most turns — then something other than the ask list is
  moving it, and the next reading is the `changes` counter against the receipts rather than against the asks. No
  accuracy number from the dispatch is quoted.
- **If P2 fails on the cache** — the block is stable and the prefix still misses — then the cadence was not the
  mechanism and R214's 77% had a second cause this lane has not found. That is the most valuable negative result
  available here, and the next round is a cache census per request rather than another arm.
- **If P3 fails** — the arm is still materially worse — then **verified state as this parser builds it does not
  transfer at all**, both readings of it now having failed, and the state channel closes the way the lesson channel
  closed: by measurement. The product default stays memory-free, and the lane's next spend is the invocation policy
  (R216), which changes *when* the agent is shown something rather than *what*.
- **If P4 fails and P3 holds** — the harm is gone and the lift is short of the bar — then the channel is a
  *neutral* rather than a harm, the product default stays off, and R216 is justified as the mechanism that gives the
  board something to be checked against at the moment of the write.
- **If P5 fails** — attribution under 60% — then the request's paraphrase is the ceiling, the census's 77.9% is an
  upper bound on a text the board never sees, and the parser needs a second reading of the same request rather than
  a wider one.

## What this does not claim

It does not claim the contract is faithful. The board reads what the request says, not what the user means: task 5
of this corpus asks for an exchange, then changes its mind twice, and a contract that lists the first ask and not
the reversal is faithful to the text and wrong about the script. The census prices that at 176 of 226 required
objects and 235 asks no required object accounts for, and the run-time reading replaces the census rather than
confirming it.

It does not claim the `unrequested` line helps. It is registered as part of the treatment because a checker that
cannot say "nobody asked for this" is not a checker, but this round has no arm without it.

## The instrument

`eval/tools/goal_board.py` — schema `/2`: `request_of`, the scope argument, the two refusals, the repaired
negation, and 100% of its lines covered by 80 self-checks. `microglia_agent.py` gains the cadence counters
(`changes`, `stable`, `open`, `unrequested`, `unattributed`); `selfcheck_agent.py` gains three cases — the contract
does not grow from the conversation, a turn after a change is stable again, and an arm with nothing to say says
nothing — for 239 assertions over a module the workflow now measures at **98**.

The workflow's contract job gains the agent's coverage gate (98 against a measured 99) and pins the census to this
round's numbers; its paid job gains a **mechanism gate before the paired reading**, which fails the run if the
cadence, the block's length or the cache hit rate is outside the registration. A reading that cannot be quoted is
better failed loudly than reported quietly.
