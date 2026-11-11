---
id: R83-consolidation
step: R83
opened: 2026-11-11
arms: full-consolidated
sample: 1534
backbone: deepseek-flash
gates: V18,V19,V77
---

# R83 — merge first, then ask what a witness is worth

**Registered** 2026-11-11, undispatched. One variable moves: the store `full` reads.

## Why this is the next question rather than another filter

R81 published a field nothing had read: `active_corroborated: **0**` beside `active_total: **258**`,
with `distill_created: 258` and `knowledge_active_mean: 51.6`. Every active claim in every fold's store
is supported by exactly one observation. The arm that asks the pack layer for two — `full-corroborated`,
the product's `minEvidence` floor — would have injected an empty pack on every question, which is
`none` under a second name. So it was never dispatched, and the record correctly refused to buy it.

The floor is not the defect. `consolidateKnowledge` exists, is tested, and answers exactly this: it
groups items that state one claim by token containment on the claim's own words (floor 0.60, measured on
a register where the true pair reads 0.700 and the closest non-repeat 0.533), folds each group into a
survivor carrying the **union** of its evidence, and reports `supportBefore` / `supportAfter` /
`crossTaskGroups`. It runs on the τ² lane and over the consolidation sweep. **The BIRD lane has never
called it** — its store is whatever the distiller wrote, one item per correction, and no pass has ever
asked which of those items are one claim. Asking for two witnesses before folding is asking a store it
does not have.

## What the numbers say the store is

| reading | R81 | what it implies for this registration |
| --- | --- | --- |
| `distill_created` | 258 over five folds | ≈ **51.6 claims per fold** — the population the pass can fold |
| `corrections_learned` | 133 | ≈ 2 corrections bought one claim; the store is a summary, not a transcript |
| `active_corroborated` | **0** of 258 | the pair counts the pass is looking for are absent by construction |
| `mean_pack_ids` | 1.84 | the pack already injects fewer than two items on average |

With 52 items a fold, there are 1,326 unordered pairs and the pass must find among them a pair it calls
one claim. That is not a large population, and it is the reason this file exists in the shape it does:
**the first reading is the census, and it is free.** It is computed before the first model call of the
fold, so the question "does this store hold anything to fold" is answered for the price of the
distillation, not for the price of the evaluation.

## The design, exactly

- **Population:** BIRD `dev`, all 1,534 questions, 5 folds, `learn_sample = 64` — R81's and R80's own
  cell. `none` and `full` are re-bought inside the dispatch, so every contrast is paired within the run.
- **Arms, three:**

| arm | what it injects | store |
| --- | --- | --- |
| `none` | nothing | — |
| `full` | the retrieved pack over the store the distiller wrote | as written |
| `full-consolidated` | the same retrieval, budget and renderer over the **merged** store | after `consolidateKnowledge` |

- **One arm, not two.** The support floor after the merge (`minEvidence: 2` over the merged store) is the
  obvious fourth arm and it is deliberately not bought: it is only a distinct arm if the merge produces a
  claim with two witnesses, and whether it does is the question this file is asking. Buying it now would
  spend half the budget on an arm that is `full-consolidated-corroborated` or an empty pack depending on
  an answer that is already in the file.
- **The merge is a copy.** `consolidatedMemoryOf` builds a second memory and leaves the source store
  untouched — verified by six tests, including one that reads the source after the merge and finds every
  item still `active` with one piece of evidence. A pass in place would change what `full` means from the
  position it ran at, and the two arms would differ in the order their questions arrived.
- **The clock is the store's own** latest write, not the wall clock: the pass stamps `updatedAt` into
  every survivor, and this lane writes nine years behind `Date.now()`.
- **The floors are the pass's own defaults**, not this lane's: a threshold chosen by a lane is a threshold
  nobody can test, and the report states the values it used.
- **Budget:** three arms over 1,534 questions ≈ **4,600 calls**, which is R81's bill (16 minutes,
  $0.2299 off-peak) rather than a multiple of it. Cap 5,400, ceiling 6,200, `not_before: 10:00`.

## Prediction

- **The merge finds something in at least one fold**: `groups ≥ 1` in the summed census, `merged ≥ 1`,
  and `support_after` containing at least one item with **2**. The claim is weak on purpose: 52 items a
  fold is a small population, and a zero here is a finding rather than a bug.
- **`cross_task_groups ≤ merged`**, and most likely `0`: two statements of one claim distilled from two
  *different* corrections are a paraphrase, and the store's items are written from 64 corrections of 11
  databases, so two of them landing on one claim and on two tasks is rarer than the fold itself.
- **The pack shrinks**: `mean_pack_ids` for `full-consolidated` lands **0.3–0.9 below** `full`'s 1.84,
  because folding two items into one removes one injected line per question it affects.
- **The accuracy is unchanged**: `full-consolidated − full` within **±1.5pp** with an interval covering
  zero. This is the prediction the whole record has produced five times, and this file expects it again —
  a merge of a store that was never the binding constraint moves nothing, and a *positive* delta here
  would be the first evidence that item count rather than item content is the problem.
- **The instrument:** parse rate ≥ 95%, `consolidation` present in `metrics` with `folds: 5`, and
  `V77` finding a row for the one bought arm.

## Refutation

The branches **partition** the space, are ordered, and the first whose conditions hold names the outcome.

- **Void** — `consolidation.merged = 0` in all five folds, or `groups = 0`. Then this store holds nothing
  the merger can fold, and the honest statement is that **the repeat the pass looks for never occurs in a
  store of 52 items distilled from 64 corrections**. The next registration is then not about merging at
  all: it raises `learn_sample` until a claim has a chance of being stated twice, or it distils the same
  correction more than once to see whether the model says the same thing twice. Both are about the size
  of the learning population, and neither is a filter.
- **Inert** — `merged ≥ 1` and `full-consolidated − full` inside ±1.5pp with a shrinking pack. Then
  corroboration can be manufactured and buys nothing, which retires the whole "one witness" reading as an
  explanation for the null: the memory's problem is not that its claims are unverified, and the next
  question is about *content* (which the record has asked four times) rather than about support.
- **Harmful** — `full-consolidated` below `full` by more than 1.5pp with an interval excluding zero. Then
  folding two claims into one loses a distinction the model was using — the MemTrim result (removing
  entries drops the harm *and* the benefit) reproduced inside this product's own pass. The merge would be
  reported as a negative result, not adopted as a default.
- **Helpful** — `full-consolidated` above `full` by more than 1.5pp with an interval excluding zero. Then
  the pack was too long rather than wrongly supported, the merge is the first mechanism in this record to
  beat `full` on this split, and the next registration buys the support floor over the merged store — the
  arm this file deliberately deferred.

## What this file does not do

It does not lower a floor. The consolidation threshold stays at the product's 0.60, because a lane-level
threshold is a number the pass cannot be defended with.

It does not claim the merge is a corroboration mechanism until `cross_task_groups > 0`: two statements of
one claim learned from the *same* task is a duplicate, and this record has refused to report a duplicate
as support at least twice.

It does not compare against R81's artefact as if the two runs shared a store. Distillation is cached, so a
re-run of a cell learns the same store when the cache hits and a different one when it does not; the
paired comparison this file reports is `full` vs `full-consolidated` **inside one dispatch**, and R81's
row is context rather than a control.
