---
id: R131-the-instruments
step: R131
opened: 2026-11-16
# R123a's arm exactly — same lane, split, sample, form, model, store, and no gate — dispatched against the four
# repaired instruments. The treatment is null and the arm is an execution: the question is whether the record can
# *read* a run it already knows how to buy.
arms: memory
sample: 160
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
# No gate. R123 priced the rung the ladder chose and the rung cost 15pp of `pass^4`; a treatment that fails its
# own bar is not re-run as a treatment. This arm's subject is the instrument, and a null treatment is what makes
# the instrument's readings comparable with R123a's.
speakMargin: 0
trainDomain: retail
testDomain: retail
recallDomain: retail
packBudget: 2400
taskSplit: official
trainTasks: 74
testTasks: 40
release: v1.0.1
claimRuler: interval
---

# R131 — the four instruments, on the arm that already knows its answer

**Registered** 2026-11-16, after reading R123 (`43801571591`) and before dispatching anything against the
repairs.

> R123's phase computed the sidecar census, the turn census and the serve split, printed three lines about them,
> and the artefact carried **none** of the three. Four independent writers were broken at once (§AUDIT 34.161),
> and not one of them had ever run end-to-end on a real phase: every instrument in this lane has been certified
> by unit tests and by a Python self-check, and none by a dispatch.

## What is being tested

Not the memory. The memory arm is R123a's — the best-scoring configuration this record has (0.7750 `pass^4`,
0.9063 episode rate, harm share 29.6%) — and the dispatch exists to make a *reader* work:

| instrument | writer repaired | what proves it ran |
| --- | --- | --- |
| `tau2.memory` | the projection table had no entry, and the driver added it through a spread | the block is in the artefact, with `episodeStarts` and the ladder |
| `episodeStarts` | appended per recall, so 160 episodes were recorded as 162 boundaries | `len(episodeStarts) + recallRepeats == recalls`, and `len(episodeStarts)` equals the episode count |
| `tau2.turnCensus` | same projection hole | the block is in the artefact **on both arms** |
| the control arm's record | `run()` returned before `observed` was assigned, so no control artefact has ever had a `tau2` block | the reference arm carries `usage`, `cost` and `turnCensus` |

## Prediction

- **All four fields are present in both arms.** Any of them absent is a writer that still does not run, and the
  round reports which rather than re-reading the memory.
- **`serveSplit.measured` reproduces the arm's own episode rate.** Nothing is withheld on this arm, so every
  episode is in the served bucket and the split's rate must equal `episode_rate` to the last digit. This is the
  join's self-check: a split that reports a different rate has mis-assigned requests, and with no gate there is
  no other explanation available.
- **`attribution` is non-empty and names at least one item whose net is negative over at least two episodes.**
  This is R128's readback criterion, written two rounds ago and never met, because the field it joins on had no
  writer. An item table with zero rows on a store of 73 items is the same absence one layer further out.
- **The turn census pairs.** `toolErrors` is non-null on both arms — τ² serialises the flag on every tool result
  — and the paired line prints an interval over 160 pairs.
- **Harm share lands inside R123a's interval [15.9%, 48.5%].** A replication claim, not a new one: R124 and
  R123a agreed to 1.6pp on one store configuration, and a third draw either joins them or shows that the 1.6pp
  was luck.

## Refutation

- **A field is absent.** Then a writer is still missing, and the round's finding is that writer — not the
  memory. R123 spent $0.77 learning that the hard way; this arm is designed so the sentence is available in
  one artefact instead of one job log.
- **The serve split's rate differs from the arm's own episode rate.** Then the join mis-assigns requests and
  every future split — including R123's, had it existed — is unreadable. This is the failure the boundary
  repair exists to prevent, and it is cheap to detect because the two numbers must be equal by construction.
- **`attribution` is empty on a store of 73 items.** Then the item table's join is broken in a way the unit
  tests cannot see, and R128's list of items to quarantine does not exist.
- **Harm share outside [15.9, 48.5].** Then one store configuration's harm share is not stable across draws, and
  every cross-run comparison in Appendix AS and AT becomes a comparison of samples rather than of stores.

## Cost

**~$0.97** at the off-peak rate R123a's own bill measured ($0.9653 for its whole run; R123's eval phase alone
was $0.7716). No new phase, no new episodes: this is the cheapest configuration in the record.

## What this unlocks

| reading | question it answers | what it decides |
| --- | --- | --- |
| the item table | which claims broke which trials | which items R129's outcome counter would quarantine |
| the paired turn census | whether the memory induces wrong actions at a resolvable denominator | R125's registration, priced |
| the control arm's bill | what the control actually cost | the only cost comparison this lane cannot currently make |
| the serve split's self-check | whether the boundary join works | whether any gated arm can ever be read |
