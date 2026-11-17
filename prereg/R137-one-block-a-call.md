---
id: R137-one-block-a-call
step: R137
opened: 2026-11-17
# R136's arm unchanged, and a defect repaired rather than varied. The block was being appended to a state
# tau2 hands straight back, so a ten-turn episode carried ten copies of it and every memory arm since R92
# was billed and prompted for a memory it had already read.
arms: memory
sample: 114
gates: V0,V1,V2,V3,V5,V8
recallFloor: 0
facadePair: off
facadeNotes: off
facadeShapes: off
distillScope: all
distillUnit: correction
distillForm: lesson
consolidate: true
consolidateKey: routine
speakMargin: 0
trials: 1
trainDomain: retail
testDomain: retail
recallDomain: retail
packBudget: 2400
packLimit: 1
taskSplit: official
trainTasks: 74
testTasks: 40
release: v1.0.1
claimRuler: interval
---

# R137 — one block a call

**Registered** 2026-11-17, after reading R136 (`44043927600`) and before the wrapper changes.

> R136's memory arm: **35 of 40 (0.875)** against the reference's **37 of 40 (0.925)**, paired
> **−5.00pp [−15.00, +5.00]**, p=0.6250, **1 repaired and 3 broken** (8.11% of the trials the control
> passed). Its bill: **$0.2033** against **$0.0923** — **2.20×** per episode on identical tasks.
>
> Its census, which is the first one that could be read: **410** packed calls,
> **11,105.9** characters of system on each of them, **705.1** characters injected, **10,400.8** of
> carriage (**2,132.2 tokens**), and **2,017.2** characters on the calls that carried no pack.

R136 built the instrument to name that 10,400 and then asked the wrong question of it. The reading it
expected was "preamble": the adapter's own words, stable, one per call, worth shrinking. What the
numbers say instead is that **the block is in the prompt more than once**.

Three measurements, one answer:

1. **The policy prompt is ~6,600 characters, not 10,400.** The control arm has no pack, so its
   `system_chars_per_call` of **5,137** over 663 calls with 450 agent turns is a mixture of the agent's
   policy and the simulator's **2,017.2**-character prompt — and 2,017.2 is exactly what the memory arm
   reports for its *unpacked* calls. Solving for the policy gives **6,614** characters (450 agent calls)
   to **7,062** (410), and the answer does not depend on which count is used.
2. **The message is 705.1 characters and the column is 11,105.9.** Budget: 6,614 of policy plus 705.1 of
   message is **7,319**. The remaining **3,787 characters** are 5.4 copies of the same 705-character
   block.
3. **An episode spends ~10 calls.** 410 calls over 41 boundaries. If one more copy is appended each turn,
   the mean number of copies a call carries is (1+10)/2 = **5.5**. Measured, 5.4.

That is not a coincidence and it is not a preamble. It is the wrapper appending the block to a state the
benchmark hands back on the next turn:

```python
state = state.model_copy(deep=True)
state.system_messages = list(state.system_messages) + [injected]
```

The copy keeps the *caller's* state from being mutated, which is what it was written for — and the comment
above it says the copy is what prevents accumulation. It is not. tau2 threads the state the agent
**returns**, so the copy is precisely the object the next turn is handed, and every turn appends to the
copies of the turns before it. `the_pack_does_not_accumulate` passed for forty-five rounds because the
fixture handed the same never-growing object back each turn: the test asserted a contract the benchmark
does not have.

The consequences are the ones the record has been calling "the memory hurts":

- **The prompt grows with the square of the episode** — 410 calls, mean 5.4 copies, so the block alone
  accounts for ~3,800 of the 11,106 characters a packed call carries.
- **The prefix moves every turn.** The block sits at the front of the prompt and a new copy is inserted
  there each turn, so everything after it shifts: the memory arm credits **3,654.6** cached tokens a call
  against the control's **4,232.7**, and pays **1,542.4** uncached against **413.6** — 3.7× the miss
  tokens on a prompt 12% longer.
- **The model reads the same instructions up to ten times**, each copy an assertion that this is the
  reference data to act on. `1 repaired and 3 broken` is what that looks like in a score.

R102.0 measured this and read it as a block: *"the block adds 1,497 prompt tokens a call and 31 uncached
ones"*. 1,497 tokens is 7,300 characters at the corpus's own ratio — ten copies of a 725-character pack.
The "cached block that costs nothing uncached" was ten blocks, cached because they are at the front.

## What is being measured

- **`memory.packCopiesDropped`** — the copies removed from the state the agent was handed. On a phase with
  **B** boundaries and **C** calls it reads `C − B` when the wrapper is idempotent and `0` when it is not.
  410 − 41 = **369**.
- **`cache.pack_copies_per_packed_call`** — `system_messages − 1` per packed call, because the policy is
  one system message and the block is the only thing this lane ever puts beside it. **1.0** is sound.
- **`cache.packed_calls_with_copies`** — the calls that carried it twice or more. A mean of 2.0 can be half
  the calls at one copy and half at three; a count cannot.

## The repair

The block is constant for an episode (`pack_for` holds it), so the correct prompt has exactly one, and any
earlier copy is this method's own output read back. `is_pack_message` identifies it by the element the
renderer emits, the copy is dropped, and the block is appended once:

```python
kept = [m for m in state.system_messages if not is_pack_message(m)]
state.system_messages = kept + [injected]
```

The policy prompt is untouched, which is a case of its own: a wrapper that reset the list to `[injected]`
would satisfy the count and delete the benchmark's instructions.

This is a **defect, not a treatment** — no registration ever varied it, exactly as with the double element
of R102. It is registered because it changes what the model is shown, and it also registers the correction:
every memory arm from R92 to R136 was prompted and billed for a memory it had already read, so every
memory-side cost figure and every memory-versus-control delta in that window carries the defect.

## The fixture that hid it

`episode_step` now threads the returned state, and the case that had been green for forty-five rounds goes
red in the same commit:

```
FAIL  one injected message, not one per turn: expected [1, 1, 1, 1, 1], got [1, 2, 3, 4, 5]
```

Nine cases are added around it: the copy count, the policy's survival, a stale block from another episode
being replaced rather than stacked, and the census arithmetic on known populations (three copies over two
calls is 1.5, and exactly one of the two calls carried more than one).

## Prediction

- **`pack_copies_per_packed_call == 1.0` and `packed_calls_with_copies == 0`.** The instrument's own
  criterion and the first one read, because a phase that reports copies has not been repaired.
- **`packCopiesDropped == calls − boundaries`** — 369 on the same arm, which is the agent-side
  corroboration of the census's mean.
- **`system_chars_per_packed_call` falls from 11,105.9 to ≈7,320** (−34%), the policy plus one message.
- **`uncached_tokens_per_call` falls from 1,542.4 toward 500**, because the prefix stops moving; and
  `cached_tokens_per_call` rises above the control's 4,232.7, because a stable front is what a cache holds.
- **Cost per episode falls from 2.20× the control to below 1.5×.**
- **The score moves up.** Stated as a direction and not a size, because the mechanism is a repeated
  instruction rather than a missing one; the harm share (8.11% of the trials the control passed) is the
  number to read against.

## Refutation

- **Copies still ≈ 5.4 with the repair in.** Then the state is not threaded the way the fixture now models
  it and the accumulation has a second cause; the fixture is wrong again and the instrument is at fault,
  which is filed as the finding.
- **Copies == 1.0 and `system_chars_per_packed_call` stays ≈11,100.** Then the 10,400 was a genuine
  preamble, R136's renderer branch is the repair, and this round's diagnosis is withdrawn.
- **Copies == 1.0 and the cost does not fall.** Then the copies were not the bill — the prefix was already
  broken by the turn's own growth — and the premium is behavioural, which sends the next dollar at the
  agent rather than at the carriage.

## Decision rule, stated before the number

| outcome | what the next dollar buys |
| --- | --- |
| copies 1.0, cost < 1.5×, harm share falls | the block itself: with one copy in the prompt, pack content is finally the variable — item count, order and form are measurable again |
| copies 1.0, cost < 1.5×, harm share unchanged | the conditioning row: the pack is not what breaks trials, and the arm is under-supplied or mis-keyed rather than over-served |
| copies 1.0, cost unchanged | the turn: a premium that survives a 34% smaller system column is the conversation, and the agent's action mix is the lever |
| copies still > 1.0 | the fixture: the contract is still mis-modelled, and no score from this arm may be read |

## Cost

**~$0.32**, from R136's own bills on the same 114 episodes ($0.2033 + $0.0923). The memory arm is expected
to come in under that; the forecast is the upper bound, not the estimate.

## What this unlocks

| reading | question it answers | what it decides |
| --- | --- | --- |
| `pack_copies_per_packed_call` | how many times the model read the memory | whether any earlier memory delta is a statement about memory at all |
| `packed_calls_with_copies` | whether the phase was uniform | whether a mean over the arm is a mean over one treatment or two |
| `system_chars_per_packed_call` | how much of the prompt is the pack | whether the next dollar is the renderer or the store |
