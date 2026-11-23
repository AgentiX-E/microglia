---
id: R206-same-task-transient
step: R206
opened: 2026-11-24
# The largest published effect in the memory literature is not a body, it is a *material*: summarise the failing
# trajectory of the task at hand, inject the summary into the next attempt at the same task, and discard it. 49.0
# stored lessons, 53.5 raw logs, 59.9 that. R204 measured why the body alone cannot buy it here: the summariser was
# shown records retrieved from *other* retail tasks and declined on 34 of 40 episodes. This arm changes the material
# and nothing else — no store, no cross-task retrieval, one note per task carried from attempt k to attempt k+1,
# discarded at the end of the task. It is registered and NOT built: the corpus is the held-out half alone, so the
# reading it produces is a pass^4 on the leaderboard's own scale, which is the first time this lane would have one.
arms: both
sample: 40
gates: V0,V1,V2,V3,V5,V8
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
testTasks: 40
release: v1.0.1
claimRuler: interval
---

# R206 — the same task twice: guidance distilled from attempt k, injected into attempt k+1, discarded

**Registered** 2026-11-24, not built. It is written down before the engineering because the shape is the finding: the
last four rounds varied whether the memory speaks (R123), how much (R151, R201) and what the pack is made of at serve
time (R204). None of them varied **where the material comes from**, and the literature's largest effect is a
statement about exactly that.

## The two arms, stated as the one thing that differs

- **Control.** τ² retail, the 40 held-out tasks, `trials: 4`, no store, no notes. This is pass^4 on the same 40 tasks
  every fold since R99 has evaluated on.
- **Treatment.** The same 160 simulations. Trial 1 of a task is identical to the control. After a trial that **failed**,
  its trajectory (the user messages, the tool calls, the policy violations) is summarised into one sentence; trial 2
  of *the same task* is handed that sentence, trial 3 gets the summary of trial 2, and so on. Nothing crosses tasks,
  nothing survives the task, and there is no store to query: the note lives in the sidecar, keyed by the task's own
  opening request text, and is dropped when the last trial of that task ends.

That is the published mechanism, replicated rather than paraphrased: **per-task, cross-attempt, transient**. R41 ran
the cross-task version (learn retail, answer airline) and R204 ran the cross-task version at serve time; this is the
axis neither touched.

## What it needs, and what it deliberately does not

- **The task's identity on the agent side.** The agent is never told which task it is in (R136), and the note has to
  be keyed to *this* task. The key is the first user message of the trial — already carried as `boundaryTexts` — which
  is stable within a task and different across tasks. Approximate by construction, and the artefact records how often
  two keys collided.
- **An outcome the runner owns.** The note is distilled only after a *failed* trial, and only the runner knows the
  reward. The runner writes `{ key, reward, trajectory }` to the sidecar at the end of each simulation; the agent reads
  `{ note }` at the start of the next one. No new service: the sidecar already has a per-phase URL.
- **No store.** The learn half is not run, so `trainTasks: 0`. This is what makes the arm affordable: 320 simulations
  instead of 4 × 114, and no distillation of 73 corrections.

## Prediction

- **pass^4 is the primary reading**, and it is the first time this lane can be placed on the leaderboard's own scale:
  four trials on 40 retail tasks, the same quantity the board's retail column reports (which uses 114 tasks; the
  comparison is therefore stated as *indicative*, not as a ranking).
- **The treatment's pass^4 exceeds its control's by more than the fold's resolution.** With 40 tasks and 4 trials the
  paired reading is over 40 tasks, so the resolution is the one R200 published for that sample — ±11 pp — and a
  smaller move is reported as unresolved rather than as a win.
- **The note is short and specific.** 60–160 tokens, and it names a policy or an argument order rather than restating
  the task: the check is that the note for a task mentions at least one entity that appears in *that* task's failure
  and in no other task's, which the artefact can compute from the trajectories it already carries.
- **Coverage is high on this arm**, unlike R204: the summariser is shown the task's own failed trajectory, so it
  should almost never answer `NONE`. This is the prediction that separates the two materials, and it is the one the
  registration is really about.
- **The bill rises by the summariser's input and nothing else**: one call per failed trial, ~2,000 characters each.

## Refutation

- **If coverage is as low as R204's (≤ 40%)**, the material is not the problem and the paper's mechanism does not
  transfer to τ²-retail as implemented. That would be a finding about the benchmark, and it would be stated as one.
- **If the note's entities are the task's own opening text restated**, the summariser copied the question instead of
  reading the failure, and the arm measures a verbatim echo.
- **If pass^4 moves down**, carrying a note between attempts of one task is harmful on this benchmark, which
  contradicts the published direction and is reported as a contradiction rather than as noise.
- **If the control's pass^4 is not reproducible against R198's 82.5% pass@1 fold** at the same tasks, the 40-task half
  is not the sample the earlier folds used and every comparison to them is void.

## Price

**≈ ¥5–7**: 320 simulations at R198's ¥2.75 per 114-task fold scaled down (≈ 40 tasks), plus one summariser call per
failed trial. The engineering is the sidecar key and the runner's write, not a dispatch.

## What this round does not settle

Whether the note should be *validated* before it is injected — the inference-time critic that MemTrapBench's
AdaptiveMem describes. If this arm shows a real effect, the critic is the next arm; if it shows none, the critic is
not worth building.
