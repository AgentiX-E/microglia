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

**Registered** 2026-11-24, not built. It exists because R206's pilot found two defects and only one of them is
about the material.

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
