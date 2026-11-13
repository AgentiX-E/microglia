---
id: R91-store-frozen-to-the-failures-it-read
step: R91
opened: 2026-11-12
arms: memory
sample: 228
gates: V1,V2,V3,V5,V6,V7,V8,V32,V44
recallFloor: 0
facadePair: off
trainDomain: retail
testDomain: retail
recallDomain: retail
distillUnit: raw
distillScope: edited
rawCeiling: 2000
packBudget: 2400
storePin: eval/pins/r90-retail.json
trainTasks: 57
testTasks: 57
---

# R91 — the store has to be the same store, or no arm is one variable

**Registered** 2026-11-12, dispatchable after R90. R90's readback fired a refutation its registration did
not contain, and the row is worth more than the arm it graded:

> R89 wrote **12** corrections from the retail learn half. R90 wrote **15** from the same 57 tasks at the
> same one trial. Eight task ids are shared, seven exist only in R90, four only in R89.

R90's header said "One variable. R90 against R89 is the guard and nothing else." That sentence was false
when it was written and nothing in the lane could have caught it, because the mechanism is structural:
the store is built from *whichever learn tasks failed*, and the learn half is **one trial per task**. One
trial of a sampled model is a draw. So every arm this lane has run changed its treatment **and** its
store, and the `pass^4` differences between them — R85 0.5752, R88 0.5614, R89 0.7018, R90 0.6316 — were
read for four rounds as properties of the treatment. R88 against R89 is the one pair that survives that
criticism, because both wrote 12 records and R89's only change was the pack. Every other comparison is
two variables, and the intervals (±11.88pp at n = 57) are wide enough to hide it.

This arm does not test a hypothesis about memory. It fixes the instrument.

## What moved, and what did not

| | R90 | R91 |
| --- | --- | --- |
| the learn half | run: 57 episodes, 15 failed | **pinned: no episode, 15 named failures** |
| ceiling, pack budget, admission, scope, split, trials, model, guard | — | **same** |
| the store | 15 records from a draw | **15 records from `eval/pins/r90-retail.json`** |

One variable, and this time the variable is the measurement rather than the treatment: R91's store is
R90's store by construction if — and only if — a correction is a function of the corpus and the list.

## Why that premise holds, stated so it can fail

`taskCorrection` reads `evaluation_criteria.actions` and `user_scenario.instructions`: both are fields of
the pinned τ² checkout, not of the episode. `distillScope: edited` decides only *which* tasks contribute —
the ones whose reward was below 1 — and a pinned list states exactly that. So the read path from corpus
to record has no model call in it, which is why R85 measured `$0.00` for the write and why this arm can
rebuild the store without paying for 57 episodes.

If the premise is false the arm says so in a field rather than in prose: `faithfulness.entities` would
differ from R90's 172, or `pack.summary.meanChars` from 1,825.3, and both are read below.

## Prediction

- **The pin is on the path.** `learning.pin` exists with `source` naming R90's run, `failures = 15`,
  `tasks = 57`, and the run prints the line before any episode starts. Absent means the header did not
  reach the driver, and nothing below is read.
- **The write reproduces R90 field for field.** `rawlog.records = 15`, `faithfulness.entities = 172`,
  `faithfulness.kept = 171`, `faithfulness.redacted = 1`, `store.stored = store.servable = 15`. These are
  equalities rather than directions: the pin's whole purpose is that the write is deterministic, and a
  near-miss is a defect rather than noise. `rawlog.clipped` inherits R90's 2 and is not re-predicted.
- **The pack and the coverage are inherited, because their inputs are.** `pack.summary.meanChars =
  1,825.3`, `pack.droppedForSize = 1,596`, `pack.meanIds = 1`, `pack.filled = 228`, and
  `coverage.nonzeroQuantiles.p50 = 0.28`. A single record whose text is identical produces a single pack
  whose text is identical; if one of these moves, the store is not identical and the arm measured
  something else.
- **`pass^4` is reported with its interval and no direction.** The evaluation half is still a draw — 57
  tasks × 4 trials of a sampled model — so this arm's number is the **first estimate of that draw's own
  spread at a fixed store**. Against R90's 0.6316 the difference is noise by construction; what it
  measures is how large "noise" is, and that number is what every later delta will be read against.
- **The cost falls by the learn half.** 57 episodes fewer than R90 at the same evaluation, because the
  half that produced the store is read instead of run.

## Refutation

- **The pin is not on the path.** `learning.pin` absent, or `failures ≠ 15`. The header, the workflow's
  join of the path, or the driver's branch is wrong; the run is discarded before its outcome is read.
- **The write does not reproduce.** `faithfulness.entities ≠ 172` or `kept ≠ 171` with the pin in place.
  A correction would then not be a function of the corpus and the list, which is the premise the whole
  design rests on — and the honest conclusion would be that this lane cannot freeze a store at all.
- **The pack or the coverage moves.** `meanChars ≠ 1,825.3` or `coverage.p50 ≠ 0.28`. Two runs holding
  the same records served different text, which means a renderer, an admission decision or a clock is
  still reading something the pin does not fix.
- **`store.stored ≠ 15`.** The pin is partial: some named failure produced no record. That is a corpus
  mismatch (a task whose criteria this checkout does not carry), and it makes the arm a smaller store
  than the one it claims to reproduce.

## Cost

No learn half: **$0.00** for the write, and 57 episodes fewer than R90. The evaluation is 57 tasks × 4
trials = 228 episodes at R85's billed band, **under $1.05**, with no change to prompts — the store's text
is byte-identical to R90's, so the prompt cost is R90's. Off-peak window, one τ² dispatch at a time.

## The ablation this makes possible

| cell | store | ceiling | pack | isolates |
| --- | --- | --- | --- | --- |
| R88 | drawn (12) | 2,000 | 1,200 | the write, with the pack cutting it |
| R89 | drawn (12) | 2,000 | 2,400 | the pack |
| R90 | drawn (15) | 2,000 | 2,400 | the identity — through a store that also moved |
| **R91** | **pinned (15)** | 2,000 | 2,400 | **the instrument: nothing but the draw** |
| R92 (not registered) | pinned (15) | 2,000 | 4,800 | the pack carrying two, at a fixed store |
| R93 (not registered) | pinned (15) | 700 | 2,400 | the ceiling, at a fixed store |

R92 and R93 were both known before this arm and both were unpriceable: a pack that carries two records
cannot be priced through a store whose record count changes between runs, and a ceiling cannot be priced
through a record whose length changes with which tasks failed.

## What this does not answer

Whether two runs of the **evaluation** half at a fixed store give the same `pass^4`. That is the other
half of the instrument, it costs a second dispatch, and it is the next thing to price after this one — a
report of `pass^4` without a measured spread is a point estimate this lane has been quoting as if it
were a measurement.
