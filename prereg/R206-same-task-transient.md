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

## Amendment 1 (2026-11-24) — the gates this material can actually be graded by

Written after the engineering, before any dispatch, and it changes no claim — it changes what the run is
*checked* against, because the header inherited six gates from the pack lane and none of them can grade an arm
with no pack in it.

- `V1` asks whether the served block was non-empty. This arm has no facade, no store and no block: `recalls` is
  zero by construction, and a gate that reads a zero as a defect would fail every clean run of the arm.
- `V2`, `V3` and `V5` are about the pack's *census* — items served, units shaped, coverage of the retrieve set.
  There is exactly one item here and it is a sentence about one task.
- `V0` and `V8` survive, and they are the two that matter: the run's specification is that the treatment is
  wired at all, and its calls must not fail. `V8` is the reason a note-free round cannot be quoted as the
  material being inert.

The arm's own gates, registered now:

- **N0 — the control is the same scaffold.** Both arms run `microglia_agent` with the same rounds, the same four
  seeds and no facade. The only difference is `--notes`. An arm whose control is τ²'s stock agent would measure
  the wrapper, which is R93's defect and R101's correction.
- **N1 — the handoff happened.** `notes.hits > 0` on the treatment and `0` on the control, and the two arms ran
  the same number of episodes. A treatment with no hit is a file the agent never read.
- **N2 — coverage is quotable.** `written / failed ≥ 0.6` over the rounds after the first. R204 measured 6 of 40
  (15%) with records retrieved from other tasks; the prediction is that the same summariser, shown the task's
  own failure, clears this bar. Below 40% is the registration's first refutation.
- **N3 — the note is specific.** `specificity.share ≥ 0.5`: at least half the notes name an entity that appears
  in their own task's failure and in no other task's. Below that, the summariser copied the request.
- **N4 — the reading is paired and the interval decides.** pass^4 per arm over the same tasks, and the
  difference is quoted only if its interval clears the ±11 pp resolution R200 published for 40 tasks.

`arms: both` and `claimRuler: interval` are unchanged; `sample: 40` is unchanged for the fold. The pilot below
runs on 6 tasks and is a *wiring* run — it grades N0/N1 and reports N2/N3, and it makes no claim about pass^4.

## Amendment 2 (2026-11-24) — the pilot, because a 320-episode first dispatch is the expensive way to find a typo

**R206a, ≈ ¥1.5, ~50 minutes.** 6 held-out retail tasks × 4 rounds × 2 arms = 48 simulations, both arms
`microglia_agent`, the treatment carrying `--notes`. What it buys:

1. the handoff observed in a real harness rather than in a fixture — the sidecar written by the runner between
   two `run_tasks` calls, and read by an agent in the next one;
2. the summariser's own coverage and specificity on real retail failures, which is the registration's first
   prediction and the one that decides whether the material is worth 320 episodes;
3. the bill, per arm, for the fold's price estimate — `usage.promptTokens` with the summariser's share visible,
   because its calls go through the same litellm callback the episodes do.

It cannot and does not decide the fold. The fold is 40 tasks, and 6 tasks have a resolution of ±30 pp, which is
why the pilot's artefact says `claim: none` in as many words.

## What the engineering changed about the mechanism, stated plainly

- **Rounds, not trials.** τ²'s `run_tasks(trials=k)` runs every task's k attempts inside one thread pool, so
  there is no point at which a runner holds a reward and the next attempt has not started. The phase therefore
  runs `--rounds k` — k separate `run_tasks` calls with seeds `base .. base+k-1` — and merges them into one
  `results.json` with each round written as that trial's index. Both arms get the same four seeds, which
  `--trials` on two arms cannot give.
- **The key is the opening message on both sides.** The runner takes it from the simulation's first user
  message, the agent from the message τ² handed it, and both call `notes.note_key`. Collisions are counted by
  the runner (it holds the task id) and travel in the sidecar.
- **The file is re-read between rounds.** Rounds share one process, so a document cached at the first read
  would serve round one's notes to round four; the cache is keyed on `(mtime, size)` and the case that proves it
  is in `selfcheck_agent.py`.
- **One material per arm.** A facade pack wins over a note, because an arm carrying both is a third treatment
  nobody registered.

## Amendment 3 (2026-11-24) — the path, and the two files that exist because the pilot needed one

The engineering of Amendment 1 built a mechanism with no way to dispatch it: `run_split.py` takes `--rounds` and
`--notes`, and neither `sota.yml` nor `tau2-driver.ts` builds those argv. This amendment is that way, registered
before the first dispatch so the pilot's readings are graded by gates rather than by whatever the log happened to
print.

**`.github/workflows/note-pilot.yml`**, two jobs and the split is the cost model:

- `contract` runs on every push that touches the material, spends nothing, and runs **the same four commands the
  paid job runs** over a generated fixture pair, requiring the reading to come back `GRADED`. A push that breaks
  the task list or the path convention between the builder and the verifier fails here rather than on a dispatch
  that has already bought forty-eight simulations.
- `pilot` is dispatch-only: two phases at `--rounds 4 --seed 300 --require-off-peak`, the control without
  `--notes` and the treatment with it, in one job and in that order.

**Two files, because the reading is arithmetic and the arithmetic is testable without a provider:**

- `eval/drivers/tau2/note_pilot.py` assembles the artefact from the two phase logs, the two `results.json` files
  and the sidecar. It refuses three states — two agents, a control carrying a notes block, no shared task — and
  leaves every *outcome* to the verifier. `pass^k` is computed over tasks whose trial count is exactly `k`; a task
  with fewer leaves the denominator and is named in `short`, because averaging it as a zero is the biased estimate
  this lane exists to avoid.
- `eval/verifiers/r206_readback.py` grades `N0`–`N4` and recomputes each arm's headline from its own per-task rows
  before using it: a document that states a score it cannot reproduce is a document whose score is a transcription.

**What the pilot is allowed to conclude.** Nothing about `pass^4`. Its registered claim is `none`, and the
artefact says so in a field rather than in a paragraph: with six tasks the paired interval is ±30 pp, and the
decision the pilot actually makes is whether the material is worth 320 simulations — `N2` coverage ≥ 0.6, `N3`
specificity ≥ 0.5, `N1` a handoff observed, and zero collisions.

## Amendment 4 (2026-11-24) — the pilot ran, and the identity it binds by does not exist

**The pilot.** Run `45299603895`, 6 held-out retail tasks (`5,9,12,17,18,26`), 4 rounds, both arms, ¥0.64
($0.0897). The state is `ABANDONED`, and the two reasons it gives are the two defects this amendment records.

**The material was starved.** Of 24 treatment episodes, **2 failed**, and the summariser answered `NONE` on both:
`written 0`, coverage `0.000`, specificity ungraded. The control's own grid passed 20 of 24 (83.3%), treatment 22
of 24 (91.7%) — so at this difficulty four rounds on six tasks produce about one failure per arm, and one failure
is not a population. Reading the failing attempt (task 5, trial 0) shows why a refusal can be correct: the user
simulator could not authenticate and the agent escalated to a human, which is the policy's own answer. **A failure
whose cause is outside the agent's control contains no actionable note**, so the arm's coverage is a function of how
many failures are the agent's — a quantity nobody had measured on this corpus before this pilot.

**The identity does not exist, and that is the defect that matters.** The registration said the opening request is
"stable within a task and different across tasks". Measured on the pilot's own 48 episodes
(`eval/verifiers/opening_stability.py`):

| reading | value |
|---|---|
| exact key reuse over 168 same-task pairs | **0.006** (one accidental match) |
| within-task similarity, min / mean | 0.132 / 0.444 |
| cross-task similarity, max / mean | **0.562** / 0.099 |
| separable (within-min > across-max) | **no** |
| best threshold for a fuzzy matcher | θ=0.30 — 31 same-task pairs missed, 29 cross-task pairs wrong |

τ²'s user simulator samples the opening afresh on every attempt, so the same task opens with four different
sentences; and two retail tasks can share a *scenario* (5 and 9 are both "exchange a water bottle and a desk
lamp"), so a paraphrase of one task's opening is closer to the other task's than to its own sibling's. **No
threshold on text can bind this material to a task**, and the shipped mechanism would have served nothing even if
the summariser had written every note.

**Consequences, stated as consequences rather than as plans.**

1. **R206's fold is not bought.** 320 simulations at the measured ¥4.3 would spend that on an arm whose binding
   cannot fire, and a zero delta would be reported as "the material is inert" — the collapse this file exists to
   prevent, one layer below where it usually happens.
2. **The identity must be structural.** `R207-transient-identity` is registered for it: one task per invocation and
   one sidecar per task, so the file the runner chose *is* the task, and the sidecar declares `scope: task` so that
   a mis-scoped file is refused rather than silently served.
3. **The pilot's grid is worth keeping.** The same six tasks, four rounds and two arms cost ¥0.64 and took 26
   minutes, which makes a wiring run affordable whenever the mechanism changes — and the next one reuses this
   grid so the two are comparable.
4. **The price in the header was wrong in the safe direction.** 48 simulations cost $0.0897, i.e. $0.0019 each, so
   320 are ≈ ¥4.3 rather than the ≈ ¥5–7 registered. A retail episode is short (379 calls over 24 episodes), and
   the material itself is 990 prompt tokens for the whole arm.
