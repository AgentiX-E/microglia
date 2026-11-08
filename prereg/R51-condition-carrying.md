---
id: R51-condition-carrying
step: R51
opened: 2026-11-08
arms: memory,reference
sample: 200
gates: V1,V2,V3,V6,V7,V8,V32,V44
recallFloor: 0
facadePair: off
---

# R51 — the pack is thin because the rule never carried the question

**Registered** 2026-11-08, on the census R49 published, before any R51 dispatch.

## What R49 measured, as a census rather than an accuracy number

| Reading | Value |
| --- | --- |
| store | 10 items, 10 active, 10 servable, 0 without a domain, 0 distiller failures |
| requests served a pack | 949 of 1,528 — **38% empty** |
| mean items per request | 0.76 (1.23 per non-empty pack) |
| rule/query coverage | p50 4.7%, p90 11.1%, max 40% |
| corrections learned from | 5, over 32 tasks |

An intervention absent on 38% of the agent's decisions has its measured effect
diluted by that share before anything else about it is considered. The standing
hypothesis — that memory hurts because its content or its use is wrong — is not
what this run can speak to. The memory is barely present.

## The two defects that make it absent, both of them the same omission

A τ² correction was distilled into

> A request of this shape is resolved by calling find_user, then
> cancel_pending_order, in that order.

That sentence shares no term with any question a person asks, and it is the
**only** text the rule carried. Two mechanisms then had nothing to match:

1. **The question was thrown away at the write boundary.** `parseTauTasks` read
   `task.id`, `evaluation_criteria.actions`, `communicate_info` and
   `nl_assertions`, and dropped `user_scenario.instructions` — the one field that
   holds the user's own words. The driver then passed `correction.taskId` as
   `input.question`, so the distiller was instructed to write a trigger *"in the
   question's own terms"* while being shown `"7"`. No trigger could have been
   written, and none was: ten items, ten servable, **zero conditions**.
2. **The condition was ignored at the read boundary.** `KnowledgeItem.when` exists
   since iteration 62 precisely because "a statement records what was true; it says
   nothing about when it is true", and the renderer prints it ahead of the
   statement. Recall did not follow. The lexical index built its document from
   `statement + kind + scope`, the `minCoverage` gate measured `queryCoverage(query,
   item.statement)`, and MMR diversified on `item.statement`. All three had decided,
   separately, that half a rule is the whole rule.

## The one thing that changes

Six lines of behaviour, in three files, with no new knob and no new switch:

| Where | Before | After |
| --- | --- | --- |
| `parseTauTasks` | instruction dropped | `TauTask.instruction`, both upstream shapes, `''` when absent |
| the learning event | `input.question = taskId` | `input.question = instruction \|\| taskId`, with `taskId` beside it |
| the lexical index | `statement + kind + scope` | `recallText(item) + kind + scope` |
| `minCoverage` | `queryCoverage(q, item.statement)` | `queryCoverage(q, recallText(item))` |
| MMR text | `item.statement` | `recallText(item)` |
| the store census | servable count only | `conditioned` / `unconditioned` added |

`recallText` is one function in `kernel/similarity.ts` rather than three call
sites, because the three had already drifted from each other and from the
renderer.

The floor is `minCoverage: 0` — the as-is facade, not the floored one. R49 already
measured what a 0.01 floor does on this store (−486 packs, no accuracy change), and
this registration asks whether the pack *exists*, not whether a floor prices it.

## Prediction

- **The store states conditions.** `store.conditioned >= 4` of the servable items.
  R49's store was 0 of 10. If it is still 0, the trigger is not being written and
  defect 1 is not the defect.
- **The empty pack share falls.** `recall.empty / recall.requests <= 0.25`, against
  0.379 on R49. Predicted mean pack 1.4–2.4 rules per request, against 0.76.
- **Coverage rises at the median.** p50 rule/query coverage ≥ 12%, against 4.7%.
  This is the number that says the packs are *about* the question rather than
  merely non-empty.
- **Accuracy stays inside the interval.** The primary readout is the same
  `l4-paired` harm gate R50 registered; the prediction is only that no revert
  branch fires. With an MDE of 9–14pp on this scenario, an accuracy prediction
  finer than that would be a prediction the lane has already certified it cannot
  check.
- **The instrument holds.** `V1` non-empty, `V32` learning intact, `V44` domains
  accounted, 0 distiller failures, and the same 200 episodes at 4 trials.

## Refutation

- **If `conditioned` is 0**, the write path still produces statements without
  conditions. Defect 1 is not the defect, the arm is abandoned, and the next
  registration measures the distiller's own output rather than the store's.
- **If `conditioned >= 4` and `empty/requests` is unchanged above 0.30**, the
  condition exists and does not reach the pack. That points at the retrieval path
  or at the pack budget, and it refutes this registration's account of *why* the
  pack is thin — the arm is abandoned, not reinterpreted.
- **If the empty share falls but p50 coverage does not rise**, the pack is being
  filled with rules that merely share scope, which is the failure `minCoverage`
  exists to prevent; the arm is abandoned and the floor becomes the next question,
  the exact question a 0.01 floor already failed to answer.
- **If `l4-paired` reports HARM**, the R45 revert rule fires on the reading, not on
  the explanation, and the condition-carrying write path is reverted.
- **If any of `V1`, `V32`, `V44` fails**, the run certified nothing and is
  re-dispatched rather than read.
