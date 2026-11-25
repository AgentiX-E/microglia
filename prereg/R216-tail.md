---
id: R216-tail
step: R216
opened: 2026-11-25
# R215 removed the harm (+4.4 pp against −5.3) and missed both of its own mechanism bars. Re-parsing its artefact
# before spending anything says the round's registered diagnosis — "a set ask cannot be settled" — was worth two
# settlements in a hundred and seven episodes. The bulk is three other defects, and the bill is an address rather
# than a cadence. This round repairs those four and moves the block behind the conversation.
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
| `board` | the contract at the tail, written only when a receipt moves it | 114 | ≈ $0.55 |

**≈ $1.06 (¥7.6)**, ~30 minutes at concurrency 3, and a 2-task pilot is dispatched first (≈ $0.02) because the
tail placement is the first time this lane puts a message of its own into `state.messages` rather than the system
block: a provider that refuses a mid-conversation system message would fail every episode, and that is worth 2 tasks
rather than 114.

## Prediction

- **P1 — the wiring.** The board renders on at least **95%** of turns after the contract exists and lists at least
  one ask on at least **80%** of episodes.
- **P2 — the placement, before the rate.** `placement == "tail"` in the artefact; the block is **written on at most
  half the turns** (`tailAppends ≤ 0.5 × renders`); at least one turn **found it already in place** (`tailHeld > 0`);
  and the arm's **bill per episode is within 20% of the control's**. The derivation: 1,034 turns × ~40 tokens of
  block ≈ 41 k, plus 247 changes × ~350 tokens behind the old position ≈ 86 k, against a control that buys 860 k
  uncached — ≈ +15%; the bar is 20%, R215's front placement was +37%.
- **P3 — attribution, which is the mechanism and not the accuracy.** At least **60%** of writing episodes end with a
  tick. The replay over R215's document predicts **69.2%** (74 of 107, 7 loose of 104 settled, 68 unrequested,
  18 unattributed).
- **P4 — the harm stays gone.** Paired pass^1 against the control is **not worse by more than 3 points**.
- **P5 — the lift.** Paired pass^1 **+10 pp**, McNemar exact p < 0.05, interval excludes zero (`BOARD_UP`), paired
  over **≥ 100 tasks** with zero unpaired.

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
