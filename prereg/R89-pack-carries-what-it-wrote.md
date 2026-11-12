---
id: R89-pack-carries-what-it-wrote
step: R89
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

# R89 — the pack has to carry what the writer wrote

**Registered** 2026-11-12, dispatchable after R88's readback. R88 raised the record ceiling from 700
to 2000 characters and left the pack at 1,200, and nothing in this repository compared the two numbers.
They are not independent. A pack charges a fixed wrapper, a line per item and the statement, so at
1,200 characters a record in this arm's shape can state **810** — measured by `maxStatementChars`, which
renders one through the real renderer rather than deriving the arithmetic a second time — and a record
above 810 is retrieved, ranked, **dropped at render**, and then reported by every artefact in this lane
as a request that found nothing relevant.

That is the fifth absence in this lane: the pack's own refusals have never been counted. This
registration raises the budget so the ceiling fits, and the census that now accompanies it (`pack:`) is
what makes the next such mismatch visible instead of silent.

## The two numbers, measured

| budget | capacity (chars of statement) | records of the retail corpus above it | what one recall carries |
| --- | --- | --- | --- |
| 1,200 | 810 | 47 of 114 (**41.2%**) | one 700-character record, 114 characters of headroom |
| 2,400 | 2,010 | **0 of 114** | two 744-character records, or one 1,532-character record whole |

**390 characters of every pack are wrapper and fixed fields** — the element, the note, and the record's
id, kind, confidence, task-and-domain scope and provenance payload. That constant is why the historical
700 was safe by accident rather than by design: 700 + 390 = 1,090 fits 1,200 with 110 characters left,
which is what R85 ran on. It is also why R88 is not: 2,000 + 390 = 2,390 needs a 2,400-character pack,
and at 1,200 the ceiling writes 1,190 characters of a record that will never reach the model.

**The record population makes this a majority problem, not an edge.** `eval/tools/record_length_census.py`
puts the retail record at p50 744, p95 1,260, max 1,532 characters; at 1,200 (capacity 810) the share
above capacity is **41.2%**, and at 2,400 it is **zero**. The same census says the airline population
needs 3,129 + 390 and is therefore a 3,600-character pack — a number this registration deliberately does
not borrow, for the reason R88 refused to borrow 700 from the trace unit.

## What this changes, and what it holds fixed

| | R88 | R89 |
| --- | --- | --- |
| object stored | record (`exemplar`, no model call) | **same** |
| ceiling | 2,000 | **same** |
| admission | `isEventKind`, no self-refutation | **same** |
| scope | one constant (`tau2.act`) | **same** |
| recall floor | 0 | **same** |
| pack budget | 1,200 | **2,400** |
| corpus, split, trials, model | retail, 57/57, 4, deepseek-flash | **same** |

One number moves. That is the point: R88's readback, whatever it says, cannot separate "longer records
do not help" from "the longer records were dropped", and this arm is the cell that separates them.

## Prediction

- **Nothing is dropped for size.** `pack.droppedForSize = 0` and `pack.emptiedBySize = 0`, against a
  run at 1,200 where the ceiling permits records 1,190 characters longer than the pack can carry. If
  either is non-zero at 2,400, the record shape assumed by `rawLogItemShape` is wrong — an escaping
  statement or a longer payload — and the capacity has to be measured from the store instead.
- **The budget and the capacity are in the artefact.** `pack.budget = 2400`,
  `pack.capacity = 2010`, `pack.requests = 228` (±the corpus's own episode count). A run that cannot
  state what its pack was allowed measured a pack nobody can reconstruct.
- **The write is unchanged and costs nothing.** `learning.llmFailed = 0`, `rawlog.records = 12` (±2),
  `rawlog.clipped ≤ 1`, and `learning.events = learning.candidates` — no model call at the write, as in
  R85 and R88.
- **One recall carries two records, not one.** `pack.meanIds ≥ 2` when at least two records are
  servable, against 1 in every L4 run this lane has recorded. Two 744-character records fit 2,400
  (2 × 861 + 390 = 2,112) and do not fit 1,200, so the reading distinguishes the budget from the store.
- **Coverage clears 25% at the median.** R85 read 13.04% with one servable record, R58 10.53% with a
  trace store. Two records' terms against one question is the mechanism; if coverage does not move with
  two, the pack is not the constraint and neither was the ceiling.
- **`pass^4` does not fall below the published 0.575,** reported with its interval at n = 57. No lift is
  claimed at this sample: it cannot carry one. What it can carry is the direction and the three
  intermediate readings above, which are properties of the mechanism rather than of the noise.

## Refutation

- **The arm did not run.** `rawlog.records = 0`, or the funnel's `servable = 0`. Nothing below is read;
  the failure is named by layer rather than reinterpreted.
- **`droppedForSize > 0` at 2,400.** The capacity arithmetic in this registration is wrong for the text
  this lane writes, and the record arm cannot be read for length until the capacity is measured on the
  store's own items.
- **`meanIds = 1` with `servable ≥ 2`.** Something other than the budget bounds the pack — the MMR
  limit, the coverage floor, or the ranking — and raising the budget again would buy nothing.
- **Coverage below 25% at `meanIds ≥ 2`.** Two records per request and the question still shares almost
  no content word with them: the store's text is the constraint, the object was never the ceiling's
  problem, and the next variable is the object rather than the dose.
- **`pass^4` below 0.575 with whole records served.** This is the negative-effect hypothesis the lane
  exists to test, on a treatment that is finally reaching the model intact. It would be the first
  evidence *for* it on this corpus rather than against it, and it would move the question from "can the
  store serve" to "should it".

## Cost

The write calls no model: twelve corrections become twelve records for **$0.00**. The evaluation is 57
tasks × 4 trials = 228 episodes, priced from R85's billed band at **under $1.10**, plus the prompt cost
of a pack that carries two records instead of one — about 1,100 extra characters per request over 228
requests, or **roughly $0.03** at this backbone's input price. Off-peak window, one τ² dispatch at a
time: two in one window measure each other's throttling.

## The ablation this opens, and does not perform

| cell | ceiling | budget | isolates |
| --- | --- | --- | --- |
| R88 | 2,000 | 1,200 | the write, with the pack cutting it |
| **R89** | 2,000 | 2,400 | the pack, at the same write |
| R90 (not registered) | 700 | 2,400 | the ceiling, at the same pack |

R88 against R89 prices the pack; R89 against R90 prices the ceiling. Without R90, a lift in R89 is a
lift from *more text reaching the model*, and the two causes stay entangled — which is the class of
mistake this registration exists to end, one level up from the one it repairs.

## What this does not answer

Whether a store written *during* the evaluation helps — the in-episode arm of `TECH-DESIGN 17.127` —
because the store here is frozen before the first scored trial, exactly as in R85 and R88. That arm
needs the write endpoint and a serial trial loop, and the watermark it needs (`RecallQuery.before`) is
already built.
