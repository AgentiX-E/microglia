---
id: R208-verdict-material
step: R208
opened: 2026-11-24
# R207's pilot ran 48 episodes, failed one, and the summariser declined it. R206's pilot failed two of
# twenty-four and the summariser declined both. Four failures, four refusals: the material is not starved of
# attempts, it is starved of *the reason an attempt failed*, because the transcript shows an agent that behaved
# plausibly and only the evaluator knows the required action was never taken. This arm keeps R207's mechanism
# exactly — one sentence, one attempt forward, the file as the identity — and adds the evaluator's verdict to the
# summariser's prompt.
arms: both
sample: 6
gates: V0,V8
recallFloor: 0
facadePair: off
facadeNotes: off
facadeShapes: off
distillScope: all
distillUnit: raw
rawCeiling: 2000
serveBody: guidance
speakMargin: 0
trials: 4
trainDomain: retail
testDomain: retail
recallDomain: retail
packBudget: 2400
taskSplit: official
trainTasks: 0
testTasks: 6
release: v1.0.1
claimRuler: interval
---

# R208 — the verdict beside the attempt

**Registered** 2026-11-24, **built** 2026-11-24 before any dispatch. It exists because R207's pilot measured a
refusal, not a defect in the identity.

## What the last two pilots measured

| round | grid | treatment episodes | failed | summariser refused | notes written |
|---|---|---|---|---|---|
| R206a | 6 tasks × 4 rounds × 2 arms | 24 | 2 | 2 | 0 |
| R207 | 6 tasks × 4 rounds × 2 arms | 24 | 1 | 1 | 0 |

R207's one failure is the case in full. The agent's second turn called `transfer_to_human_agents` on a routine
exchange of a water bottle and a desk lamp; the tool answered "Transfer successful"; the agent announced the
hand-off and the simulated user stopped. The transcript reads as a *competent escalation*. Nothing in it says the
policy requires `return_delivered_order_items`, and the summariser answered `NONE` — correctly, given what it was
shown. The evaluator knew: `ACTION not met: return_delivered_order_items`, `DB CHECK not met`.

The control arm passed 24 of 24 episodes, so R207's grid is also **saturated**: at `deepseek-flash` with thinking
disabled, these six tasks produce one failure per forty-eight episodes, and a failure in the last round is never
distilled. `r206_readback.py` now reports such a grid as `NO_MEASUREMENT` with the reason `no-distilled-failure`
rather than firing three refutations about a file that never held a sentence.

## The one thing that differs from R207

**What the summariser is shown.** `notes.note_prompt` takes a second, optional block: the reward, the database
verdict, and every environment assertion, action check, communicate check and natural-language assertion with its
outcome, rendered by `notes.verdict_text`. With the block empty the prompt is byte-identical to R207's, which is the
property that makes a verdict run comparable to the pilot before it rather than merely similar to it. Nothing else
changes: the same summariser model, the same one sentence, the same drop at the end of the task, the same schedule.

It is a dispatch argument (`--note-verdict`, `note_verdict=true`) and not a default, because a change of material is
a change of arm: the fold refuses a corpus whose phases disagree about it (`tau2-note-pilot-mixed-verdict`).

## The failure bank, because a saturated grid cannot test this

The gate below needs failures, and the six-task grid has none to spare. So the arm is measured in two steps, the
first of which is a census rather than an experiment:

1. **Bank.** One control arm over the retail **test** split — 40 held-out tasks, four trials each, 160 episodes —
   `deepseek-flash`, thinking disabled. (The submissions report on the 114-task base split, 74 train plus these 40,
   which is why a bank on the held-out half is the comparable population and not the identical one.) Its
   purpose is to find the tasks the arm fails and to keep their transcripts and verdicts. At the lane's measured
   $0.0019 an episode this is about **$0.21 (¥1.5)** and about an hour.
2. **Material ablation.** On every failed attempt in the bank, call the summariser twice: once with the attempt
   alone, once with the attempt and the verdict. Two calls per trajectory, no episodes, no simulator. The comparison
   is paired by construction — the same failures, the same model, one block different.

The bank is a measurement and not a fold: it says which tasks the arm fails, not whether memory helps. Its value is
that it is the population every later round of this lane is drawn from, and it is the first time this project will
have one.

## Prediction

- **P1, the verdict is read.** Every verdict the bank's failures produce renders at least one line — `DB CHECK`,
  `ACTION`, `COMMUNICATE`, `ASSERTION` or `REWARD` — and fewer than a fifth of the failures render none. A failure
  whose verdict renders nothing is an evaluator that reported no detail, which is a fact about τ² and not about this
  arm; if more than a fifth of them do, the material is thinner than the design assumes and the block is not worth
  its tokens.
- **P2, the refusal rate falls.** Over the bank's failures, the share the summariser declines (`NONE`) is lower with
  the verdict than without it, on the same failures and the same model: at least half of the attempts the
  trajectory-only arm declined are written by the verdict arm. Below a third, the block is not doing what it was
  added for.
- **P3, the note names the check.** A note is specific if it contains a token the evaluator's verdict for its own
  failure contains and no other failure's verdict contains, measured by the same `notes.specificity` reader the fold
  uses. The bar is `share ≥ 0.5`, which is the arm's own `N3` bar, because a material that changes the prompt and not
  the content of the sentence has changed nothing that reaches the next attempt.
- **P4, the block is cheap.** The verdict block adds at most a third of the attempt's prompt characters per failure
  (`verdictChars ≤ TRAJECTORY_CHARS / 3`, measured rather than assumed). Above that the block is a second trajectory
  and the summariser is being asked to read two failures at once.
- **P5, the schedule is untouched.** Both summarisers see the same failures, the same model and the same character
  ceiling, so the comparison is paired by construction; a paired difference is quoted only if the intervals clear the
  sample's resolution, and no `pass^k` claim is made from a material ablation at this n.

## Refutation

- If P2's share is below a third, the verdict is not what the summariser was missing: the next round changes the
  summariser (a stronger note model) rather than the material.
- If P3's share is below 0.5 while P2 passes, the notes are being written but not from the verdict, and the block is
  decoration that costs tokens on every distilled failure.
- If P1 fails, the evaluator is not reporting enough for this material to exist, and the lane returns to the prior
  question: which benchmark can grade a failure at all, before asking what a note is worth.
- If the bank itself yields fewer than eight failures over its 160 episodes, the retail split is saturated at
  this model and the note lane's next round is a different domain rather than a different material.

## Price, measured rather than estimated

- **Bank.** 40 tasks at four trials, one arm, one invocation, at the lane's measured $0.0019 an episode: about
  **$0.30 (¥2.2)** and about forty minutes at two episodes at a time, including the τ² install.
- **Ablation.** Two summariser calls per failed attempt, at roughly four thousand prompt characters each: a hundredth
  of a yuan per failure. The whole ablation is under **¥0.5** at the bank's expected size.
- **What is not bought.** The 320-simulation fold is about ¥4.3 and is not dispatched on this material until P2 and
  P3 have been measured on a population that has failures in it.

## What the product uses

`serveBody` remains host-side and is not a knob of this arm: the note is served as a guidance line, the same way R206
and R207 served it. Nothing here changes what the library renders. What changes is what the *distiller* is shown, and
the distiller is `eval/drivers/tau2/notes.py` — one caller, one prompt, one flag.
