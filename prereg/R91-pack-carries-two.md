---
id: R91-pack-carries-two
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
packBudget: 4800
trainTasks: 57
testTasks: 57
---

# R91 — a recall has to carry two records, or the store is a store of one

**Registered** 2026-11-12, dispatchable after R90. R89 raised the pack from 1,200 to 2,400 characters,
and the outcome moved: `pass^4` 0.5614 → **0.7018**, coverage 9.09% → **25.00%**, `served` 82 → **228 of
228**, with the budget as the only variable. It also read `droppedForSize = 1,596` and `meanIds = 1.0`.

Those two numbers are the whole reason for this arm. **A record in this lane is ~1,717 characters, and
the wrapper charges 390**, so one record fills 2,107 of a 2,400 budget and leaves 293: a second is
refused, not truncated, and the eleven other candidates are refused on every one of 228 requests. The
store holds twelve records and every recall carries one of them. Nothing in this lane has ever compared
that against carrying two.

## The two ways to put two records in one pack, and why this is one of them

| | budget | ceiling | what two records cost | what it does to the object |
| --- | --- | --- | --- | --- |
| **R91** | **4,800** | 2,000 | 390 + 2 × (1,717 + 117) ≈ **4,058** | keeps the long record, adds a second |
| R92 (not registered) | 2,400 | 700 | 390 + 2 × (700 + 117) = 2,024 | keeps the budget, shortens both |

These are different treatments and a lift under one is not a lift under the other. R91 changes the dose
with the object fixed — the records are the ones R89 wrote — and that is the cell that answers whether
the +12.68pp was bought by *one good record* or would continue with two.

## What moves

| | R90 (in flight) | R91 |
| --- | --- | --- |
| the write, the ceiling, the guard, admission, scope, corpus, split, trials, model | as R89 | **same** |
| pack budget | 2,400 | **4,800** |
| record capacity | 2,010 | **4,410** |

## Prediction

Every row here is a quantity this arm's own variable controls. R89 wrote two rows it did not control and
both failed; R90's Amendment 1 replaced them. This registration states the rule and then follows it:
`droppedForSize` and `meanIds` are the pack's occupancy and the budget is what this arm sets, so both
are predictable here — and the write's population is not, so it is graded in kind.

- **The artefact states the budget and the capacity.** `pack.budget = 4800`, `pack.capacity = 4410`,
  `pack.requests = 228`. Capacity is measured through the real renderer, not derived.
- **A recall carries two records.** `pack.meanIds ≥ 2` and `pack.summary.meanChars` between 3,600 and
  4,300. This is the arm's central row: at 2,010 the second record could not fit, and 4,410 is chosen so
  that two of the mean record do.
- **Some candidates are still refused, and the row says how many.** `pack.droppedForSize` **falls below
  1,596 and stays above zero** — two of twelve records fit, ten do not. Predicting zero here would be
  R89's mistake in the other direction: `droppedForSize = 0` needs a budget of ~21,000 characters for
  twelve records, and an arm that predicted it at 4,800 would fail for a reason it could have computed.
- **Coverage rises above R89's 25.00%.** Direction only, no point estimate: a second record is more
  text a question can share terms with, and the pair count is 228, so the row is `≥ 0.25` with the
  delta reported against R89's 25.00%.
- **The write is unchanged in kind.** `rawlog.records = 12` and `learning.llmFailed = 0`. `clipped` is
  **not graded by value**: the corrections are the tasks whose episodes failed, so the population
  differs between runs (135 entity values in R89 against R88's 128), and Amendment 1 on R90 records why
  a value comparison here would be a guess wearing a measurement's clothes.
- **`pass^4` stays at or above the published 0.575,** reported with its interval at n = 57 against
  R89's 0.7018. No lift is claimed: with a half-width of ~11.9pp this sample cannot resolve a two-record
  effect from a one-record one, and the mechanism rows above are what carry the claim.

## Refutation

- **The arm did not run.** `rawlog.records = 0`, or `servable = 0`. Nothing below is read.
- **`meanIds = 1` at capacity 4,410.** The budget is not what bounds the pack. Something else — the MMR
  diversity limit, a coverage floor, or the ranking returning one id — is, and raising the budget a
  second time would buy nothing. This would be the most useful negative reading available: it would say
  that R89's +12.68pp came from *one longer record* and that the store's breadth is unreachable at any
  budget.
- **`droppedForSize = 0` at 4,800.** Twelve records do not fit in 4,800 and the census says so; a zero
  would mean the pack counted candidates that were never on the shelf, and the capacity arithmetic in
  this registration would be wrong for the text this lane writes.
- **Coverage below 25.00% with two records.** More text per recall lowered the share: the pack's cost is
  real and the next variable is the record's shape rather than the dose.
- **`pass^4` below the published 0.575 with two whole records served.** Memory that carries two records
  and makes the agent worse than no memory is the negative effect, on a treatment that finally has
  breadth as well as depth.

## Cost

The write calls no model: twelve corrections become twelve records for **$0.00**. The evaluation is 57
tasks × 4 trials = 228 episodes at **under $1.10**, plus the prompt cost of a pack that carries ~2,000
more characters per request — 456,000 characters over 228 requests, **about $0.04** at this backbone's
input price. Off-peak window, one τ² dispatch at a time.

## What this does not answer

Whether a *third* record helps, and whether the twelve-record store should be ranked or clustered rather
than packed. Both need the two-record cell first: a third record is a dose question that only exists if
the second one fits and pays.
