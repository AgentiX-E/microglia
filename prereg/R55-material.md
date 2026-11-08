---
id: R55-material
step: R55
opened: 2026-11-08
arms: memory,reference
sample: 228
gates: V1,V2,V3,V5,V6,V7,V8,V32,V44
recallFloor: 0
facadePair: off
trainDomain: retail
testDomain: retail
recallDomain: retail
---

# R55 — the store is a tenth as dense as the system that wins this lane

**Registered** 2026-11-08, undispatched. Blocked on R56 by the one-lane rule: every arm is a
comparison, and no comparison may be interpreted while another is open.

**Sequencing amendment, 2026-11-08, before dispatch.** R54's readback fired its second refutation —
the conditions exist and do not name the situation — and its registration names the prompt as the
next registration, so R56 (the form) goes first. This registration's measurement stage therefore
rides on R56's dispatch: `storeItems` gains `supportTasks` there with no treatment, and the
distribution below is read from that artefact at no extra cost. R55.1 (admission at ≥3) runs after,
on whatever store R56 leaves.

## The two numbers this registration exists for

The competitive record contains one system that beats this lane with the same shape we use: a
markdown block of natural-language guidelines appended to a system prompt, no weight updates, no
fine-tuning, no retrieval. Its published ablation, read from the primary write-up on 2026-11-08:

| Retail (114 base tasks, 4 trials) | mean accuracy | pass^4 |
| --- | --- | --- |
| no guidelines | 78.1% | 57.5% |
| `sup3` (31 guidelines, each from ≥3 distinct tasks) | 78.8% | 60.0% |
| lossless (292 guidelines) | 82.5% | **67.5%** |

| Airline (50 base tasks, 4 trials) | mean accuracy | pass^4 |
| --- | --- | --- |
| no guidelines | 57.5% | 35.0% |
| `sup3` (14 guidelines) | 60.0% | **45.0%** |
| lossless (101 guidelines) | 65.0% | 40.0% |

Two things follow that the last three iterations could not have concluded from our own data.

**The unit and the position are not what separates us.** Their treatment is a block of prose in
the system prompt — the exact object our own dose curve says costs 1.7pp per item, and the exact
object four of this project's stages concluded could not work. It works there at 292, at 31 and at
14 items, on the same benchmark and the same metric we run. So "input-side prefix injection is the
wrong memory unit" is refuted as a *general* claim; what differs has to be found elsewhere.

**What differs is material.** Their 292 guidelines are distilled from a training split's agent
trajectories — successes *and* failures — and `sup3` keeps the 31 whose derivation recurred across
at least three distinct tasks. Ours is one item per user correction, distilled from the correction
sentence alone:

| Store | learning tasks | items | items per learning task | items served per request |
| --- | --- | --- | --- | --- |
| IBM ALTK-Evolve retail | ~57 | 292 | ~5.1 | all of them, every call |
| IBM ALTK-Evolve airline | ~50 | 101 | ~2.0 | all of them, every call |
| R51 (τ² retail, same shape) | 32 | 16 | 0.50 | 1.22 |
| BIRD dev (7,000 questions, 5 folds) | — | 1,296 | — | 1.78 |

The last row is the one that closes an axis. Iteration 65 ran an arm that admitted only claims
corroborated by ≥2 independent corrections, and **0 of 1,296 rules qualified**; the arm injected
nothing on all 350 questions and became the lane's noise floor (0.29pp). On BIRD that is not a
quality threshold failing, it is a corpus with no recurrence in it: every question is new, so no
claim is ever derived twice. A mechanism built on recurrence cannot be measured where recurrence
does not exist — which is the sharpest available statement of why BIRD is a hostile case and τ² is
the product lane.

So the next variable is not the prompt, the position, or the retriever. It is **what the store
contains**: whether a claim recurs, and whether anything is admitted because it recurs.

## The one variable, in two stages

Two dispatches, because a treatment applied to an unmeasured store cannot be interpreted.

**R55.0 — measure, no treatment.** The artefact's `storeItems` sample gains two counts per item:
`supportTasks` (distinct task ids among the item's evidence) and `evidence` (evidence rows). Both
are read from fields the store already holds — `EvidenceRef.taskId` exists and its own comment says
support is counted per task because eight attempts of one task are one observation by one user —
so nothing about the store's behaviour changes. This stage asks one question: **does anything recur?**

**R55.1 — treat.** Admission requires `supportTasks >= 3`, behind the policy field that already
exists for the write side (`minSupport` is a *weight* threshold of 0.8, which a single correction at
trust 0.9 clears, so today one episode becomes one rule by construction). Same store construction,
same recall, same note, same order; the only change is which items may exist.

## Prediction

For R55.0, written before the dispatch:

- **Recurrence exists.** At least 2 of the sampled items reach `supportTasks >= 3`, and at least a
  quarter reach `>= 2`. Calibrated against the reference: 31 of 292 retail guidelines (10.6%)
  reached support 3, so a 16-item store transfers to roughly 1.7 — two is the same rate at our
  density, and a quarter at support 2 is the same rate at half the bar.
- **Support and register move together.** Among items with `supportTasks >= 2`, the share whose
  `when` names the user's situation rather than the tool that resolved it is at least 15pp higher
  than among support-1 items. The test is mechanical, not a judge: a condition that contains one of
  the task's action names (`find_user`, `cancel_pending_order`, …) is in the procedure's register,
  and one that contains none is in the user's.
- **The store is the constraint, not the retriever.** Servable items stay below 40, so a retrieval
  that serves 1.22 of them is not what limits the pack. If the store is already dense, this
  prediction fails and the diagnosis moves to recall.

For R55.1, conditional on R55.0 confirming recurrence:

- `pass^4` is **reported and not claimed**. At 57 held-out tasks the pair resolves about 9pp and
  this arm changes the store's contents rather than its relevance signal; a verdict of `HARM`
  reverts under R45, and `UNRESOLVED` is the expected state, stated here so that it cannot later be
  read as a failure of the mechanism.
- The mechanism reading is the store: items admitted, their support distribution, their register
  share, and the share of requests served by an admitted item.

## Refutation

- If **no** item reaches `supportTasks >= 2`, the distiller produces sentences about single
  episodes and the support mechanism cannot be transplanted. The finding is then about the
  distillation grain — one claim per correction versus one claim per task trace — and the next
  registration is about that, not about admission.
- If support correlates with nothing (the register-share difference is under 5pp, or its interval
  spans zero), support is not a quality axis here, R9.5's BIRD curve (no knee between 4 and 20
  observations) generalises across lanes, and the axis closes with that written down.
- If the census shows 40 or more servable items before any treatment, the store is not thin, the
  density argument is wrong, and the next registration is about recall rather than material.
- If `supportTasks` is absent from the artefact, no item can be graded, and the run is
  `NO_MEASUREMENT` — an instrument that did not record its subject cannot be read as a store with
  no recurrence.

## What would make this round worthless

- Changing the learning budget in the same dispatch. `TAU_TRAIN_TASKS` is 32 of retail's 58
  training tasks; if it moves while admission changes, the density number describes the budget
  rather than the distiller.
- Reading `pass^4` as a verdict. 228 episodes at this split cannot resolve the effect size this
  arm could produce, and the readback says so before it looks.
- Grading the sample size. `sample: 228` is 57 held-out tasks at k=4, derived from retail's 115
  tasks at `trainShare 0.5` with `TAU_TEST_TASKS=0`; if the pool resolves differently the readback
  prints the episodes it saw, and a differing count is context rather than a discarded run. Only a
  differing scenario pair is `DISCARDED`.

## Cost

Two τ² dispatches, each about two hours: 32 distill calls, then 57 tasks × 4 trials × 2 arms. R55.0
adds no calls at all — it reads two integers per item.

## Why this is not the arm the review proposed

The review's first recommendation was to change the memory unit and its position — to stop putting
natural-language lessons in a prefix. The published ablation above does exactly that in the positive
direction on our lane, so the recommendation is refuted by the nearest available evidence. What it
gets right is that the store is too thin to matter; what it misses is that thinness and recurrence
are the same defect seen from two ends.
