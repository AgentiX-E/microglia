---
id: R90-guard-stops-eating-references
step: R90
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
trainTasks: 57
testTasks: 57
---

# R90 — the store has to carry the identity, not a placeholder

**Registered** 2026-11-12, dispatchable after R89. R88 read `faithfulness 82 of 128` with two records
clipped, and the reconstruction in `eval/verifiers` cleared the ceiling and the writer: at the same
2,000-character ceiling the same twelve corrections keep **128 of 128** values. The loss was
`kernel/guard.ts`, whose phone rule is ten digits, and a τ² retail answer is made of ten-digit product
ids. Task 15's gold `get_product_details(product_id="7363354090")` was stored as
`product_id="[phone]"`, so the record the model read named the *shape* of the answer and put a
placeholder where the identity belonged.

That is a different defect from every one this lane has chased. It is not a store that serves too
little, or a pack that carries too little, or a writer that abstracts: it is a record that says the
right sentence with the answer missing from it. The guard has been taught the difference — a bare digit
run under a reference key is a row key — and this arm is the cell that prices it.

## What moved, and what did not

| | R89 | R90 |
| --- | --- | --- |
| the write | 12 records, no model call | **same** |
| ceiling | 2,000 | **same** |
| pack budget | 2,400 | **same** |
| admission, scope, floor, corpus, split, trials, model | as R88 | **same** |
| redaction of a reference | `product_id="[phone]"` | **`product_id="7363354090"`** |

One variable. R90 against R89 is the guard and nothing else, so whatever `pass^4` does between them is
attributable to 45 values arriving intact.

## Measured before dispatch, model-free

The write calls no model, so the population can be rebuilt from the pinned corpus: the twelve
corrections R88 named in `yieldCensus.perCorrection`, each statement built by `taskCorrection`, each put
through the real `redact`.

| | entity values kept | what is still lost |
| --- | --- | --- |
| before (R88 as measured) | 82 of 128 = 64.1% | 45 phone-rule hits, 1 email |
| **after** | **127 of 128 = 99.2%** | **the email address in `user_id`** |

The one value still removed is `daikisanchez1479@example.com`, which τ² retail uses as a `user_id`. An
address is a person's contact detail in every field and a ten-digit run under `*_id` is a row key; the
exemption is scoped to the second case, so the first stays redacted and this arm is graded with it lost.
Recovering it would trade a real privacy property for a benchmark number, which is not a trade this lane
makes.

## Prediction

- **The store contains the identities.** `faithfulness.kept ≥ 127` of `entities = 128`, and
  `faithfulness.redacted = 1`. This is the arm's signature: it is the only reading that distinguishes a
  guard that was taught from a guard that was edited and never called. `kept = 82` again means the
  exemption is not on the path the driver takes — a stale build, or a second redaction site — and
  nothing below is read.
- **The write is unchanged and costs nothing.** `rawlog.records = 12` (±2), `rawlog.clipped = 2`
  (inherited from R88 and R89, not re-predicted: this arm does not move the ceiling), `learning.llmFailed
  = 0`, `learning.events = learning.candidates`.
- **The pack is unchanged.** `pack.budget = 2400`, `pack.capacity = 2010`, `pack.droppedForSize = 0`,
  `pack.meanIds ≥ 2`. Records keep their length: the exemption restores characters the guard had been
  replacing with five-character placeholders, so a record can only grow by a few dozen characters, and
  the capacity has 390 characters of slack over the longest record in the corpus.
- **Coverage clears 25% at the median, and rises above R89.** The identity is now a content word in the
  record instead of a placeholder, and τ² questions quote product names and order ids. If coverage does
  not move at `meanIds ≥ 2` with the identifiers restored, the store's *phrasing* is the constraint and
  the object is the next variable.
- **`pass^4` at or above the published 0.575**, reported with its interval at n = 57. No lift is claimed
  at this sample; the run can carry direction, not magnitude.
- **The negative effect, if it exists, does not live here.** Stated as a prediction so that it can be
  refuted by a number rather than by a narrative: with whole records carrying real identities, a
  `pass^4` still below the published baseline is evidence that the placeholder was not the mechanism,
  and it moves the question from "what is missing from the record" to "what the record costs the model
  that reads it".

## Refutation

- **The arm did not run.** `rawlog.records = 0`, or `servable = 0`. Nothing below is read.
- **`faithfulness.kept` still 82.** The guard change is not on the write path. The likely causes are a
  stale compiled `dist` and a second redaction site the edit missed; either way the arm measured the old
  guard and no outcome reading is admissible.
- **`faithfulness.redacted > 1`.** The exemption is taking more than its one documented case, which means
  a value is being lost that the guard's own rules would have left alone. That would make the counter an
  alibi rather than a measurement.
- **`coverage ≥ 25%` with `pass^4` below 0.575.** The store serves whole records containing the real
  identity and the model still does worse than with no memory. This is the first arrangement in which
  that reading would be clean, and it would be evidence *for* the negative effect on this corpus.
- **`pack.droppedForSize > 0`.** The exemption grew a record past the pack's capacity, and the capacity
  has to be measured from the store rather than from the shape.

## Cost

The write calls no model: twelve corrections become twelve records for **$0.00**. The evaluation is 57
tasks × 4 trials = 228 episodes, priced from R85's billed band at **under $1.10**, with the prompt cost of
the restored identifiers — under 4 characters per request on average across 228 requests — rounding to
**under $0.01**. Off-peak window, one τ² dispatch at a time.

## The ablation this completes

| cell | ceiling | pack | guard | isolates |
| --- | --- | --- | --- | --- |
| R88 | 2,000 | 1,200 | eats references | the write, with the pack cutting it |
| R89 | 2,000 | 2,400 | eats references | the pack, at the same write |
| **R90** | 2,000 | 2,400 | **keeps references** | the identity, at the same write and pack |
| R91 (not registered) | 700 | 2,400 | keeps references | the ceiling, at the same pack |

R89 against R90 prices the placeholder. R89's own ablation table reserved the label `R90` for the
ceiling cell; that cell becomes **R91**, because it must be measured on a store whose records are
correct — a ceiling priced through `[phone]` would have been the sixth time this lane measured a
mechanism through another mechanism's defect.

## What this does not answer

Whether a store written *during* the evaluation helps — the in-episode arm of `TECH-DESIGN 17.127` —
because the store here is frozen before the first scored trial. That arm is now worth building: it was
blocked on this one, since an in-episode write would have propagated `[phone]` through every episode
after the first.
