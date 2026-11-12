---
id: R88-record-not-claim
step: R88
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
trainTasks: 57
testTasks: 57
---

# R88 — a record is not a claim, and three separate things were treating it as one

**Registered** 2026-11-12, dispatchable. R85 ran the record arm and its readback returned `ABANDONED`
on a number that turned out to be the most informative failure this lane has recorded: **twelve records
were written, twelve were clipped by the ceiling, eleven were admitted as `candidate`, and one was
servable.** The store built from the episode could not serve the episode.

Each of the three numbers has one cause, and the causes are in different layers, which is why this
registration changes three things at once and predicts a separate reading for each.

## What R85 actually measured

```
records              12
clipped by ceiling   12 of 12   (700 characters, borrowed from R84's 640-character *trace* statement)
faithfulness         58 of 137 entity values kept (42.34%), whole in 0 of 12 corrections
admission            measured 12, support mean 0.4875, confidence mean 0.4696
statuses             active 1, candidate 11  (reason: insufficient-evidence)
servable in retail   1
mean pack size       1 item
coverage p50         13.04% (R58's trace store: 10.53%)
pass^4               0.6842 ±12.07pp against the published 0.575
```

The support mean is the tell. `RAWLOG_TRUST` is 0.9 and every record is created with
`support = evidence.weight`, so an untouched store reads 0.9000. **0.4875 over twelve items is
`(0.9 + 11 × 0.45) / 12`**, and 0.45 is exactly `recordContradiction`'s `support - weight × 0.5`. The
store had refuted eleven of its own records.

## The three defects, and why they are separate

| layer | what it did | reading it moves |
| --- | --- | --- |
| ceiling | `RAWLOG_STATEMENT_CEILING = 700` cut the `A:` line off twelve of twelve records | `faithfulness`, `rawlog.clipped` |
| contradiction | two `exemplar` items in one scope with different payloads were recorded as contradictory, halving the older one's support | `store.statuses`, `servable` |
| scope | every task opens as `tau2.act`, so all twelve records share one scope | — (unchanged here; see below) |

**The ceiling.** 700 was inherited from R84's 640-character statement ceiling, which bounds a *trace*
unit — a summary of one tool call. A record is the whole question plus the whole answer, and
`eval/tools/record_length_census.py` over the retail corpus puts that at **p50 744, p95 1260, max
1532** characters. The constant was never measured on the unit it was applied to. 2000 is the corpus
maximum plus the `note:` line the run also writes, and it is stated in this header rather than in a
variable so this run can be told apart from R85's.

**The contradiction.** `contradictSameScope` walks the pool for an item of the same kind in the same
scope with different content, records a contradiction, and halves the older item's support. That rule
is right for claims — two rules of one kind in one scope answer one question, so different content is a
disagreement — and wrong for records, because an event does not disagree with another event. Two orders
cancelled on two afternoons both happened. `isEventKind` now exempts the kind, the exemption is
reported rather than silent, and the claim path is tested beside it so the guard cannot be widened by
accident.

**The scope is deliberately not changed.** The driver opens every task as `tau2.act`, so records share
one scope and every recall (which asks with the same constant) reaches all of them. Making the scope
per-task would restrict each record to the task that produced it, which is the opposite of what a
retrieval arm wants, and changing it here would confound the two readings above. It is recorded as the
next candidate variable, not fixed in this run.

## Prediction

- **The store is made of records, and says so.** `distillUnit.unit = raw`, `rawlog.records = 12`
  (±2, the corpus decides), `rawlog.toolBan = false`, `distillForm.form = record`, every sampled item
  `kind = exemplar` with a statement opening `Q: `.
- **The write costs no model call.** `learning.events = learning.candidates`, `learning.dropped`
  empty, `learning.llmFailed = 0`.
- **At most one record is clipped.** `rawlog.clipped ≤ 1` of twelve, against twelve of twelve at 700.
  If more than one is clipped, 2000 is still below the population and the census undercounted the
  `note:` line — the ceiling is wrong again, in the same direction, and this is the third number it
  would take.
- **Faithfulness is at least 0.95.** Against 42.34%. A lower number with `clipped ≤ 1` would mean the
  write abstracts somewhere other than the ceiling, which no other reading in this lane can see.
- **Every record is admitted.** `store.statuses.active = 12` and `servable = 12`, against 1 and 1.
  This is the prediction the contradiction fix stands or falls on, and it is measurable without a
  single evaluation episode: admission is a property of the write.
- **Coverage clears 25%.** Median non-zero coverage against R85's 13.04% and R58's 10.53%. Twelve
  servable records where one was servable before is the mechanism; if coverage does not move with it,
  the pack's budget — not its store — is the binding constraint, and that is a different next variable.
- **`pass^4` does not fall below the published 0.575,** reported with its interval at n = 57. A lift is
  not claimed at this sample: R85's 0.6842 already sits 12.07pp wide and includes the bar. What is
  claimed is the direction and the three intermediate readings above, which are the ones this sample
  can carry.

## Refutation

- **The arm did not run**: `rawlog.records = 0`, or the funnel's `servable = 0`. Nothing below is
  read, and the failure is named by layer rather than reinterpreted.
- **More than one record clipped**: the ceiling is still below the population, and the next dispatch
  raises it by the measured maximum rather than by another guess.
- **Faithfulness below 0.95 with `clipped ≤ 1`**: the write abstracts somewhere the ceiling does not
  explain, and the record arm's central claim — that a record cannot lose a detail it never removed —
  is false here.
- **Fewer than twelve active with `clipped ≤ 1`**: contradiction was not the only thing suppressing
  records, and the admission model is wrong for events in a second way this registration did not name.
- **Coverage below 15% with `servable = 12`**: reachability was never the constraint, the pack is, and
  the record arm's mechanism does not transfer to this retrieval budget.
- **`pass^4` below 0.575**: records written whole and served reachable still make the agent worse. That
  is the negative-effect hypothesis the whole lane is about, and it would be the first evidence for it
  on this corpus rather than against it.

## Cost

The write calls no model: twelve corrections become twelve records for **$0.00**. The evaluation is
57 tasks × 4 trials = 228 episodes, the same shape as R85, priced from R85's own billed band at
**under $1.10**. Off-peak window, one dispatch at a time: two τ² dispatches in one window measure each
other's throttling, which is a confound this registration will not accept.

## What this does not answer

Whether a store written *during* the evaluation helps — the in-episode arm of `TECH-DESIGN 17.127` —
because here the store is still frozen before the first scored trial. That arm needs the write
endpoint and a serial trial loop, and it is the one that would make accumulation measurable at all.
