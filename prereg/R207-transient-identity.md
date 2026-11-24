---
id: R207-transient-identity
step: R207
opened: 2026-11-24
# R206's pilot measured the sentence that binds its material to a task, and it does not exist: τ² re-samples the
# opening on every attempt (exact key reuse 0.006 over 168 same-task pairs) and two retail tasks can share one
# scenario (cross-task similarity up to 0.562, above the within-task minimum of 0.132), so no threshold on text can
# tell a task from its neighbour. This arm keeps R206's material exactly — one sentence distilled from this task's
# failed attempt, carried one attempt forward, discarded with the task — and moves the identity from the message to
# the file: one task per invocation, one sidecar per task, and the runner choosing which file the agent reads.
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

# R207 — the same task twice, bound by the file rather than by the sentence

**Registered** 2026-11-24, **built** 2026-11-24 before any dispatch. It exists because R206's pilot found two
defects and only one of them is about the material.

## What the pilot measured

`prereg/R206-same-task-transient.md`, Amendment 4. Six held-out retail tasks, four rounds, two arms, ¥0.64:

- **the binding cannot fire.** 168 pairs of attempts at the same task produced **one** identical key. Within-task
  similarity has a minimum of 0.132 while cross-task similarity reaches 0.562, because tasks 5 and 9 are both
  "exchange a water bottle and a desk lamp" with different users — so the closest text to a paraphrase of task 5 is
  sometimes task 9's opening. `eval/verifiers/opening_stability.py` reports `NOT_SEPARABLE`, and the best threshold a
  fuzzy matcher could pick misses 31 same-task pairs and serves 29 wrong ones.
- **the material was starved.** 2 of 24 treatment episodes failed, and the summariser declined both. One of the two
  failures is an authentication dead end where escalating to a human is the policy's own answer; a failure outside
  the agent's control contains no actionable note.

The first defect is fatal to the mechanism and the second is a fact about the corpus. This arm fixes the first and
measures the second at a sample that can argue.

## The one thing that differs from R206

**How the agent knows which task it is in.** Nothing else changes: the same summariser, the same prompt, the same one
sentence, the same drop-at-the-end-of-the-task.

- The workflow runs **one task per `run_split.py` invocation** (`--tasks TASK --rounds 4 --notes notes-TASK.json`), so the
  sidecar the runner writes holds exactly one task's notes and the runner — not the agent — chose it.
- The sidecar declares `scope: {kind: task, task: TASK}`. The agent serves the file's entry when the key matches, and
  **only when the file declares one task** it serves the single entry on a key miss. A file holding several tasks
  answers nothing, because that is the case where the identity is unknown again.
- The cost is process overhead: 40 imports of τ² at ~10 s each, about seven minutes on the fold. Cheaper than one
  wrong-note serving, and it is the only identity the harness actually offers.

## Prediction

- **`N5` is the arm's own gate**: every treatment invocation's sidecar declares exactly one task, and a run whose
  sidecars declare more than one is `DISCARDED` rather than graded — a mis-scoped file is the R206 defect wearing a
  fix's clothes.
- **A written note is served.** If the summariser writes a sentence for a failed attempt, the next attempt at that
  task reads it: `hits > 0` on the treatment and `0` on the control. R206 could not have shown this even with
  perfect coverage.
- **Coverage is the population's, not the mechanism's.** With the pilot's grid (six held-out tasks, four rounds) the
  arm sees about two failures; the estimate therefore needs a grid where failures are the agent's. The arm runs the
  pilot's six tasks first (¥0.64) and only then a grid chosen **before** the numbers are seen: the ten held-out
  tasks whose control attempt 1 failed in the fold's own control arm.
- **The delta stays unquoted at n=6.** A pilot resolves ±30 pp; what it decides is whether to buy the fold, and the
  fold is 40 tasks with the same interval R200 published (±11 pp).

## Price, measured rather than estimated

R206's pilot cost **$0.0897** for 48 simulations — $0.0019 each, ¥0.64. The fold's 320 are therefore ≈ **¥4.3**,
not the ≈ ¥5–7 R206 registered, and the material is 990 prompt tokens for a whole arm. R207's pilot reuses R206's
grid so the two are comparable line for line.

## Refutation

- **the sidecar is mis-scoped** — a treatment invocation's file declares more than one task, which is R206's defect
  wearing this arm's clothes; the fold is `DISCARDED` rather than graded.
- **a written note is not served** — `notes.written > 0` and `notes.hits == 0` on the treatment: the file carried a
  sentence and the agent did not read it, which is a mechanism defect and not a material one.
- **coverage stays below 0.6 with the identity fixed** — the material is not starved by the binding; it is starved by
  the corpus, and the next arm changes what the summariser is shown rather than how the note is filed.
- **a key collision** — two entries under one key inside one task's file, which would mean the runner wrote another
  task's note into this task's sidecar.

## What this arm deliberately does not do

It does not change the summariser's prompt, and it does not add the evaluator's verdict to what the summariser is
shown. Both are candidate repairs for the starvation, and both change the *material* — which would make this arm's
result unattributable to the identity that is its subject. They are registered as the next arm if coverage stays
below the bar with the identity fixed.

## Built, and what the build had to add

Written before the dispatch, so the reading cannot be fitted to it afterwards. The arm is the one registered above;
these are the facts an implementation had to settle, each of which the reading depends on.

**The schema moved.** `microglia.notes/2`, because the document's meaning changed: an entry is addressed by the
file's scope as well as by its key. A `/1` sidecar is refused by `load` rather than reinterpreted, which is the safe
direction — the agent serves nothing and records the problem instead of serving a note under a rule its writer did
not know about.

**The fallback is narrow on purpose.** It fires only for `scope.kind == "task"`, serves the entry from the highest
`attempt`, and returns nothing at all if any entry in that file names a different task. The last clause is the one
that matters: a file holding two tasks' entries is the cross-task mechanism R41/R204 measured, and the merge that
produces such a file (`notes.merge_sidecars`) records it as a collision rather than dropping it silently.

**Two refusals, both before the first paid call.** `--notes` with more than one task is
`tau2-notes-need-one-task:N`; a sidecar path reused for another task is `tau2-notes-scope-changed:A->B`. The first
makes N5 true by construction on the runner's side; the second stops the one route by which R207 could reintroduce
R206's defect.

**An arm is now a list of phases, so the reading merges.** `note_pilot.py` takes every flag as a comma list and
merges the grid (`merge_documents`), the phase (`merge_summaries`) and the corpus (`merge_sidecars` +
`merge_trajectories`), refusing a duplicate task, a duplicate `(task, trial)` and two models inside one arm.

**Specificity moved to the merge.** A share over one task is 1.0 by construction, so `notes.specificity` returns
`null` with a reason below two tasks and the runner writes each task's failed attempt to
`<notes>.trajectories.json`; the builder recomputes the share over all six. Without `--notes` the artefact carries
`specificity: null` and N3 is reported as unmeasured, not refuted: an absent diagnostic is not a finding about the
material, and turning it into an abandonment would throw away a paid fold over a missing file.

**The instrument is floored, measured, and the number is in the record.** The lane's four Python files had
self-checks and no coverage gate; measured before this round's cases, they stood at 89.4% together
(`r206_readback.py` 86.6%, `opening_stability.py` 80.0%). The contract job now runs them under `coverage --branch`
and fails below 95% per file, and the four stand at 96.9 / 95.7 / 98.1 / 96.6 — which is why this arm's regression
suite is 137 + 132 + 44 + 35 cases rather than the 82 + 76 + 27 + 21 it was.

**What is still unmeasured, stated before the run.** Whether the file binding actually fires (`taskHits > 0`), and
whether coverage clears 0.6 once failures are the agent's. The pilot answers the first with 24 looked-up episodes and
the second with the same grid R206a used; neither is a claim, and the artefact carries `claim: none`.
