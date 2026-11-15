---
id: R135-the-coverage-ledger
step: R135
opened: 2026-11-17
# R134's arm unchanged, with three instruments: the margin of every request kept in request order, the
# prompt's bill split into system and conversation, and the residual neither the message census nor the
# tools census explains. No treatment changes, because R134's decision table sent the next dollar to
# coverage and coverage is a measurement before it is an arm.
arms: memory
sample: 114
gates: V0,V1,V2,V3,V5,V8
recallFloor: 0
facadePair: off
facadeNotes: off
facadeShapes: off
distillScope: all
distillUnit: correction
distillForm: lesson
consolidate: true
consolidateKey: routine
speakMargin: 0
trials: 1
trainDomain: retail
testDomain: retail
recallDomain: retail
packBudget: 2400
packLimit: 1
taskSplit: official
trainTasks: 74
testTasks: 40
release: v1.0.1
claimRuler: interval
---

# R135 — who was harmed, at what margin, and what the 2.25× is made of

**Registered** 2026-11-17, after reading R134 (`43974181202`) and before any artefact has carried a
per-request margin or a split bill.

> R134's memory arm: `pass4` **0.875** (35 of 40) against the reference's **0.925** (37 of 40), paired
> **−5.00pp [−17.50, +7.50]**, p=0.6875, **2 repaired / 4 broken**. It served **1.0 item and 747
> characters** a request, dropped nothing for size, and cost **$0.00546 an episode against the control's
> $0.00242**.
>
> Two of its five registered criteria failed, and both were about money: `cache_hit_rate` **0.6941**
> against a registered `> 0.83`, and a per-episode bill **16.0%** below R133's against a registered
> 30%. The pack shrank 67% and the multiple did not move: **2.43× → 2.25×**.

That last sentence is the reason this arm exists. R133's AUDIT 34.166 attributed the premium to the pack
replacing the prompt prefix on every call; R134 tested that by shrinking the pack by two thirds and the
premium stayed. The attribution was wrong, and the instrument that should have caught it was measuring
the answer and throwing it away: `_census_of` has computed `system_chars` and `conversation_chars` on
every call since the census was written, summed them into a counter, and no field ever read them. The
one number every artefact reported, `prefix_tokens`, is **system + history under one name**.

## What is being measured, and why each of the three is a count

1. **`pack.margins.perRequest`** — the margin of each request, in arrival order, `null` where the pack
   carried no decision. The ladder already in the artefact counts requests *under* each rung and cannot
   say **which** ones; R134's four harmed and two repaired requests sat somewhere in it and no field
   said where, so the conditioning branch of its decision table could not be entered at all. Joined to
   `per_task`, this is the coverage measurement R134's row 3 asked for: whether the requests a rung
   would withhold are the requests that did damage.
2. **`usage.cache.system_tokens_per_call` and `conversation_tokens_per_call`** — the split. A premium
   in the system column is the memory's own text (the pack and the adapter's preamble); a premium in the
   conversation column is the agent behaving differently, which is not the pack's fault and cannot be
   fixed in the renderer.
3. **`residual_tokens_per_call`, with `tools_tokens_per_call` beside it** — `prompt − cached` minus the
   two newest messages. Whatever is left is material no message contains, and for this benchmark that is
   a dozen JSON tool schemas. An instrument that divided only message characters could never reach
   `prompt_tokens`, and the gap was silently charged to the turn.

## Prediction

- **The wiring, first and exactly.** `pack.margins.perRequest.length == pack.ledger.length ==
  per_task.length == 40`, and the reference arm carries no pack block at all. These are counts against
  declared integers, so they are resolvable at this sample; the two rates below are read as intervals.
- **The premium is not the pack's text.** The 747 served characters are ~153 tokens; the premium is
  +1,219 uncached tokens a call. So the split will put most of it in `conversation` or in `residual`, not
  in `system`. If it lands in `system`, the pack's wrapper is far larger than its text and the renderer is
  the repair — a claim this arm can state and then check.
- **The harm is not all at the bottom of the ladder.** R134's margins had p10 0.0121 and p50 0.0489, so a
  rung at 0.05 would withhold half the requests; if the four harmed ones are spread across the ladder
  rather than concentrated under it, no rung can separate them from the two repaired ones and the
  conditioning branch closes for good.

## Refutation

- **`perRequest` absent or shorter than the ledger.** The instrument did not reach the artefact. Nothing
  below is read, and the arm is a wiring cost rather than a measurement — R132's first dispatch is the
  precedent, and it died on a string two ends spelled differently.
- **The split absent in either arm.** Same class: `system_tokens_per_call` and
  `conversation_tokens_per_call` are computed from the same callback that produces `uncached_per_call`,
  so an arm that reports one and not the other has a projection that dropped a field.
- **A premium that is entirely in `conversation` and a harm that is uniform across the ladder.** Then
  neither the pack's carriage nor a rung is the lever, the store's price is the agent's behaviour, and
  the next dollar is the write side (R129's outcome counter) with the pack left at one item.

## Decision rule, stated before the number

| outcome | what the next dollar buys |
| --- | --- |
| premium in `system`, harm concentrated at low margin | the renderer: one cacheable prefix, and a rung at the measured crossover |
| premium in `conversation`, harm spread | the write side: the item that is served is the wrong one, not badly carried |
| premium in `residual` (tools/framing) | the request's carriage, which is not the memory's: every arm's bill in this lane has been over-attributed by that amount, and it is a product fix worth more than a rate arm |
| `perRequest` missing or misaligned | nothing; fix the projection and redispatch |

The rows are keyed on where the money is rather than on the rate because the rate is not resolvable at
40 tasks — R134's own `episode_half_width_pp` was **10.25**, and every arm since R123a has been read as
an interval for that reason. A cost column, by contrast, is a ratio of measured dollars.

## Cost

**~$0.32**, from R134's own bills on the same 114 episodes: $0.2183 for the memory arm and $0.0969 for
the reference. No new phases are bought. In time, R134 took 96 minutes end to end at 0.84 minutes an
episode, inside the 240-minute job with room for one rate-window boundary.

## What this unlocks

| reading | question it answers | what it decides |
| --- | --- | --- |
| `margins.perRequest` × `per_task` | which requests a rung would withhold, and what those requests did | whether conditioning is available or closed |
| `system_tokens_per_call` | how much of the bill is the memory's own text | whether the renderer is the repair |
| `conversation_tokens_per_call` | how much is the agent growing | whether the price is behavioural |
| `residual_tokens_per_call` | how much no message accounts for | whether every bill this lane published was over-attributed |
