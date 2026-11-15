---
id: R136-the-boundary-and-the-carriage
step: R136
opened: 2026-11-17
# R135's arm unchanged. Its two instruments worked and its join did not, so this arm buys the join and the
# one column the census cannot see -- no treatment, because the conditioning row cannot be entered until a
# request can be named and the renderer row has no target until the carriage is a number.
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

# R136 — name the boundary, size the carriage

**Registered** 2026-11-17, after reading R135 (`44019972203`) and before either instrument exists.

> R135's memory arm: **34 of 40 (0.85)** against the reference's **34 of 40 (0.85)**, **0.00pp
> [−15.00, +12.50]**, p=1.0000, 4 repaired and 4 broken. With R134's −5.00pp the same arm now brackets
> zero across two draws.
>
> Its bill: **2.23×** per episode ($0.00554 against $0.00248). Per call, prompt **+675.7** — system
> **+559.3**, conversation **+26.7**, tools **+5.5**, framing **+0.5** — and cache credit **−558.3**.
> The served text is 725 characters, about **149 tokens**, so **~410 tokens a call are carriage**.

Two things are wrong with that reading and neither is the treatment.

1. **The join refused.** The facade opened **41** boundaries for **40** scored episodes — `queries.distinct`
   is 41 with 41 different texts and `recallRepeats` is 0, so one task was simulated twice and the retry's
   pack is a ledger row no `per_task` row names. `serve split` printed *boundary-disagrees*, and
   `itemLedgerOf` refused, so there is no per-item net for the arm. Every positional join in this lane
   assumes one row per episode.
2. **The carriage is a remainder.** A census that counts every system message together cannot separate a
   725-character pack from the 2,700 characters the system column actually grew by.

## What is being measured

- **`boundary.tasks`** — the task each boundary opened for, taken from the query text the agent already
  holds. A retried task then has a *second* boundary of a known task rather than an unattributable row, and
  the ledger joins by identity.
- **`memory.injectedChars`** — the length of the message that is actually injected, recorded where the
  injection happens. Subtracted from the system column, it says how much of the growth is the pack's
  carriage rather than its text.
- **`residual_tokens_per_call`** stays defined against the prompt (AUDIT 34.172): as shipped in R135 it was
  a residual of the uncached column and therefore inherited the whole premium — 1409.7 against the
  reference's 179.5, which is 99.7% of a premium that is 45% prompt and 45% cache.

## Prediction

- **`pack.requests == per_task.length`.** Exactly resolvable, and the first criterion because a mismatched
  pair is a refused pair and nothing downstream is read. R135's 41-versus-40 becomes either 40-versus-40 (the
  retry was not a real episode) or 41-versus-40 with the extra boundary *named*, which is a reading.
- **The carriage is most of the system growth.** 559 tokens of system against a 725-character pack: if
  `injectedChars` is ~750 then the pack's carriage is ~150 tokens and **409 are something else in the system
  column that no field has ever named**. If `injectedChars` is ~2,700 then the renderer is adding 2,000
  characters around 725 of knowledge, and the render is the repair.
- **The arm does not move.** No treatment changes, so a rate that differs from R135's by more than the
  draw's own noise is a defect in the harness rather than an effect. This is a *negative control* built into
  an instrument arm, and it is stated so that a 10pp change cannot be read as a finding.

## Refutation

- **`pack.requests != per_task.length` and the extra boundary is unnamed.** The identity instrument did not
  reach the boundary; the arm is R135 rerun and its join refuses for the same reason.
- **`injectedChars` absent.** Same class: the field is recorded where the message is built, so an arm that
  reports the system column and not the injection has a projection that dropped it.
- **`injectedChars` ÷ (system delta) ≈ 1 and the premium is unchanged.** Then the carriage is the pack's own
  text, the extra 409 tokens were an artefact of comparing arms with different conversation lengths, and the
  renderer is not a lever — the item's length is.

## Decision rule, stated before the number

| outcome | what the next dollar buys |
| --- | --- |
| 40 == 40, carriage ≈ 150 tokens, 409 unexplained | name the 409: a per-system-message census, because 33% of the premium is in a column nothing has ever opened |
| 40 == 40, carriage ≈ 2,700 characters | the renderer: strip the wrapper down to the knowledge and re-measure the pack's own bill |
| 41 == 40 and the retry is named | the retry path itself: a re-simulated task must not buy a second pack, and the guard that refuses the join becomes a guard that repairs it |
| the arm's rate moves by more than the draw's noise | the harness: no treatment changed, so the difference is a defect and is filed as one |

## Cost

**~$0.32**, from R135's own bills on the same episodes ($0.2214 + $0.0993). No new phases.

## What this unlocks

| reading | question it answers | what it decides |
| --- | --- | --- |
| `boundary.tasks` | which task each pack was served into | whether any per-item number can be computed at all |
| `injectedChars` | how much of the system column is the message | whether the renderer or the item's length is the repair |
| prompt composition | where 559 of 676 tokens are | whether the premium is the memory's text or the request's carriage |
