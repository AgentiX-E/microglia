---
id: R216-tail
step: R216
opened: 2026-11-25
# R215 removed the harm (+4.4 pp against −5.3) and missed both of its own mechanism bars. Re-parsing its artefact
# before spending anything says the round's registered diagnosis — "a set ask cannot be settled" — was worth two
# settlements in a hundred and seven episodes. The bulk is three other defects, and the bill is an address rather
# than a cadence. This round repairs those four and moves the block behind the conversation.
arms: control, front, board
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

# R216 — the set rule, the overlap grade, the sealed contract, and a block behind the conversation

**Registered** 2026-11-25, before the dispatch, and **after** a free measurement that changed what the round is.

R215's reading was +4.4 pp with an interval through zero, one mechanism bar passed of four, and an attribution
collapse: 32.7% of writing episodes ended with a tick against a 60% bar. Its own diagnosis was that a set-phrased
ask ("return everything from my two most recent orders") names no product and therefore cannot be settled by
containment. That diagnosis is **wrong about the bulk**, and the way it was found cost nothing:

```
python3 eval/tools/goal_board.py --replay eval/results/working-memory/board.json
```

`--replay` re-parses a document the arm already produced. Over R215's 107 writing episodes it reports **40 ticked
(37.4%), 2 absorbed**, and the failing episodes classify into four causes rather than one:

| cause | episodes | example |
|---|---|---|
| a call of a family the contract never stated | 25 | the contract says *exchange*, the agent *returned* |
| an ask one word short of the product it names | 28 | `specifically boots ordered` against **Hiking Boots** |
| a contract sealed on a greeting that contained no ask | 14 | `""` against a `modify_pending_order_items` |
| a set ask | **2** | `return everything related` |

## Amendment 1 — the first dispatch's arm collapsed, and the cause was a provider rule

Dispatch `45546028726` (04:19–05:42 UTC, $1.2739) returned two usable arms and one that never ran:

| arm | pass^1 | bill / episode | what happened |
|---|---|---|---|
| control | 90/114 (78.9%) | $0.00442 | the world |
| front | 99/114 (86.8%) | $0.00604 (+37%) | **+7.9 pp** [−2.0, +17.6], p = 0.0784, 15 moved against 6 broke |
| tail | 10/114 (8.8%) | $0.00071 | the arm did not run: 94 of 114 episodes carried no messages |

The tail arm's failure is exact and the provider said so: `An assistant message with 'tool_calls' must be followed
by tool messages responding to each 'tool_call_id'`. `serve_tail` appended the block at the end of
`state.messages`, and on the turn a call is made that put a system message between the call and the results about
to arrive. Every episode raised `BadRequestError`, four attempts were made, and the run recorded an episode with no
messages.

Two repairs, both made before the second dispatch and both pinned by a test that fails on the old code:

1. `tail_index(messages)` computes the insertion point instead of assuming it: the last assistant message carrying
   calls is found, the run of tool messages after it is counted, and if the run does not answer every call the
   insertion moves to **before** that assistant message.
2. The mechanism gate now requires **liveness** — every arm must reach the model on at least 95% of the episodes the
   best arm reached — and its cost bar became a **band, −20% to +20%**, because a ceiling is satisfied by an arm
   that stopped early: the collapsed arm passed the one-sided bar at 0.16 of the control's bill (AUDIT 34.231).

The round's endpoints are unchanged. The re-dispatch re-runs **all three arms**, because the control has now read
86.0% (R214), 83.3% (R215) and 78.9% (R216) on the same 114 tasks at the same seed and the drift between dispatches
is larger than the effect being measured.

## What this round changes

1. **The contract seals at the first user turn that yields an ask.** R215 sealed it at the first user turn, which is
   the same message in most episodes and not in 14 of them: a request that opens "hi, I need help with a couple of
   orders" and states its asks in the next sentence produced an empty contract, and an empty contract calls every
   change the episode makes *unrequested* — the board's most damning line, printed at an agent doing what it was
   told. The growth defect is not re-opened: a rule that stops at the first productive turn takes one message, and
   R214's rule took twenty-five.
2. **A second settlement grade: overlap.** Containment is unchanged and remains the strict grade. An ask and a
   product whose word sets share at least one content word *and* at least half of the shorter side now settle, at a
   grade called `overlap`. The cost is stated and counted: `loose` travels in the artefact, and a reading whose
   ticks are mostly loose is a reading about a looser rule than the registered one.
3. **The family rule covers asks with words, not only wordless ones — guarded by the catalogue.** An ask that names
   no product the episode has read is settled by the first successful call of its family. The guard is what makes
   this safe rather than the over-credit R215 refused: with no catalogue read the board cannot judge, so it does not
   act; and an ask that does name a product (at either grade) is never settled by family. This is what reaches the
   account families — address, payment, transfer — whose receipts carry no item id at all.
4. **The set rule.** Kept, and demoted to what the measurement says it is worth: two settlements in R215's corpus.
   A set ask settles by family and **absorbs** the later calls of that family, which are the same ask performed
   several times rather than work nobody asked for. Only a quantified ask absorbs; an order-level ask ("cancel the
   order") settles once and reports a second cancel as unattributed, because a duplicate is the only anomaly that
   shape can produce.
5. **The block moves behind the conversation.** A block in the system message sits in front of every token the
   episode will send, so a change re-buys the whole prompt; R215's 247 changes × 4,756 tokens = 1.17 M of re-bought
   prefix against a control that buys 860 k in total. Appended after the conversation and **left in place when
   nothing moves it**, a change re-bills only what came after the old position, and an unchanged turn re-bills
   nothing at all.

The front placement stays reachable (`--note-source board-front`) because a dispatch has to be able to reproduce
the arm a previous reading came from.

## The grid, and what it costs

The same 114 tasks, one attempt each, seed 400, both arms re-run in one dispatch — R211's drift check is about arms
minutes apart, and R215 measured the control moving 98 → 95 across two dispatches on the same grid and seed.

| arm | material | episodes | estimate |
|---|---|---|---|
| `control` | none | 114 | ≈ $0.51 |
| `front` | the same parser, R215's placement — the block in the system message | 114 | ≈ $0.69 |
| `board` | the contract at the tail, written only when a receipt moves it | 114 | ≈ $0.55 |

**≈ $1.75 (¥12.6)**, ~55 minutes at concurrency 3. Three arms rather than two, and the reason is the ablation this
round cannot do later: `front − control` is what the three parser repairs are worth under the placement R215
measured, and `board − front` is what moving the block buys. A two-arm grid reports their sum, which is the one
number nobody can act on — and this lane has already paid for that lesson once (R214 changed the supply rule and the
cadence together and could not say which was the harm).

Two pre-flight checks before the grid, because the placement is the first change here that puts a message of its own
into `state.messages` rather than the system block: a **one-call smoke test** that the provider accepts a system turn
after the user's (≈ $0.0002, and it fails the job rather than the grid), and the dispatch is **armed for the first
minute of the off-peak window** (04:05 UTC, the rate card's peak bands being 01-04 and 06-10 on weekdays) rather
than paid for at twice the rate.

## Prediction

- **P1 — the wiring.** The board renders on at least **95%** of turns after the contract exists and lists at least
  one ask on at least **80%** of episodes.
- **P2 — the placement, before the rate.** `placement == "tail"` in the artefact; the block is **written no more
  often than it changes** (`tailAppends ≤ changes`, i.e. one write per change and no re-write on a stable turn); at
  least one turn **found it already in place** (`tailHeld > 0`); and the arm's **bill per episode is within 20% of
  the control's**. The cadence bar of R215 (≤ a third of turns) is applied to the **front** arm and only to it: a
  change at the front re-buys the prompt, a change at the tail does not, and a bar whose price has been removed is a
  bar that would fail a mechanism working as specified. The derivation: 1,034 turns × ~40 tokens of
  block ≈ 41 k, plus 247 changes × ~350 tokens behind the old position ≈ 86 k, against a control that buys 860 k
  uncached — ≈ +15%; the bar is 20%, R215's front placement was +37%.
- **P3 — attribution, which is the mechanism and not the accuracy.** At least **60%** of writing episodes end with a
  tick. The replay over R215's document predicts **69.2%** (74 of 107, 7 loose of 104 settled, 68 unrequested,
  18 unattributed).
- **P4 — the harm stays gone.** Paired pass^1 against the control is **not worse by more than 3 points**.
- **P5 — the lift.** Paired pass^1 **+10 pp**, McNemar exact p < 0.05, interval excludes zero (`BOARD_UP`), paired
  over **≥ 100 tasks** with zero unpaired.
- **P6 — the decomposition.** `board − front` reports the placement's own contribution separately from
  `front − control`, both printed with their intervals. Neither is required to clear the bar on its own; what is
  required is that the sum is reported as a sum **and** that the two halves are visible. A round where the parser
  arm is materially worse and the tail arm is better is a finding about placement, not about state.

## Refutation

- **If the pilot fails on the provider** — episodes error on a system message inside the conversation — then the
  tail placement is not available on this harness, and the round continues with the parser repairs alone at the
  front placement, which is R215's arm and R215's price. The pilot is what makes that a ¥0.02 finding.
- **If P2 fails on the bill** while `tailHeld > 0`, then the tail is not where the money was and the price is
  somewhere else: the next reading is a per-request cache census, not another arm.
- **If P3 fails** — under 60% — then the replay's prediction is wrong about the live arm, which can only mean the
  board's presence changes what the agent does. That is a finding about the *treatment* being behavioural rather
  than informational, and it would be the first evidence in this lane that showing state changes the policy.
- **If P3 holds and P5 fails** — the mechanism is right and the accuracy is flat — then a ticked status list is
  worth about nothing on this benchmark, which is the outcome the Recuris ablation prices at +23.9 for *verified
  working state* rather than for a list. The next round would then be the invocation policy: show the ask at the
  moment a write is being drafted, not on every turn.
- **If P4 fails** — the arm is materially worse again — the change with the most to answer for is the family rule
  (5 above), which is the only one that can add a tick to an ask no call touched. The next dispatch ablates exactly
  that, by re-running the round with `ACCOUNT` families excluded.
- **If P5 passes** — +10 pp with the interval excluding zero — the channel becomes a candidate default and R218's
  product-side `state` field stops being a formality.

## What this does not claim

It does not claim the overlap grade is right. "Desk Lamp" against "Table Lamp" now ticks where it used to refuse;
that is the price of the 28, it is counted in `loose`, and this round cannot separate a correct loose tick from a
wrong one. The ablation that could is a round that reports accuracy by grade.

It does not claim the tail placement is free. It is the first change in this lane that puts a message of its own
into the conversation rather than the system block, and the model may read a system turn that arrives after the
user's as a new instruction. Nothing in this round distinguishes "the board helped" from "the board's placement
helped".

## The instrument

`eval/tools/goal_board.py` — schema `/3`: `grade_of` (two grades), `settlement`, `settles_by_family` with the
catalogue guard, the sealed contract, the absorbing set rule, `replay` and `--replay`; measured at **99.9%** of
lines and branches by its own self-test. `microglia_agent.py` gains `board_placement()` and `serve_tail()`, with
`tailAppends` / `tailHeld` in the artefact; measured at **99.5%**. `selfcheck_agent.py` gains three cases — the
block sits behind the conversation and moves only on change, the placement is read from the environment, and a
placement with nothing to say writes nothing — for 264 assertions.

The workflow's paid job gains a **replay gate on attribution** before the paired reading, and its mechanism gate
replaces R215's cache bar with the two readings that bar was a proxy for: the writes per turn and the bill per
episode.

## Amendment 2 — the second dispatch buys two arms, not three

The first dispatch could not price the placement: the tail arm died at the provider (94 of 114 episodes with no
messages) and the round's own endpoint, `tail − front`, was left unmeasured. The re-dispatch was armed as the same
three-arm grid, and asking what it costs made the answer obvious — **it was buying something the round does not read.**

| arm | episodes | measured bill (R216-1) | what it answers | is it this round's question |
|---|---|---|---|---|
| control | 114 | $0.5039 | what no memory does | **no** — priced in dispatch 1 as `front − control` = +7.9 pp |
| front | 114 | $0.6889 | R216's parser under R215's placement | yes, as the left side of the contrast |
| board (tail) | 114 | **$0.0812** in dispatch 1 (20 of 114 alive); ~$0.60 predicted alive | the placement | **yes** — this is the endpoint |

Three arms at 342 episodes is ~**$1.79**; the two arms that answer the registered question are 228 episodes at
~**$1.29**. The $0.50 difference buys a second measurement of `front − control`, and it does not buy a *comparable*
one: §246.8 measured the same arm turning over 22% of its tasks between two dispatches (15 pass→fail, 10 fail→pass,
p ≈ 0.42), so the second measurement would be a new number rather than a confirmation. **Cross-dispatch pairing is
the one thing this lane has established it cannot do**, so a control re-run is not insurance — it is a third
statistic nobody reads.

So the dispatch is `arms=placement`: `front` then `board`, one contrast, `tail − front`.

**What that changes in the gate, stated because a gate that skips silently is worse than no gate.** Two readings had
`control` as their left arm by name: the bill band (`board / control` within −20%…+20%) and the paired reading. With
no control arm both would have taken a branch that does not execute — `if control and treated:` is false, and
`--compare control.json ...` would have killed the step under `set -e` *after* the money was spent. Both now fall
back to `front` as the baseline, and the reading carries the names of the files it compared, so a sentence can no
longer call its left arm "control" when the file was `front.json`. The band's meaning changes with the baseline and
is restated: **the placement may cost the parser arm −20% to +20%**, which is the design's own derivation (~15%
cheaper in the bill, because the prefix survives) with the same two-sidedness that caught R216-1's dead arm.

**The cost line for this round, after the change:** 228 episodes ≈ **$1.29 (¥9.3)**, against $1.79 (¥12.9) as armed.
The registered prediction is unchanged — the placement's bill within ±20% of the parser arm's, attribution ≥60%,
`tail − front` reported as the price of the move — because none of those numbers is about the control.
