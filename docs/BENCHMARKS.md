# Benchmarks, leaderboards, and the column none of them publishes

The project's claim is about a **data flywheel**: extract an experience from one episode, and use it to raise the
success rate of the next. That claim can only be settled on a benchmark where the same agent runs the same tasks
twice — once with the experience and once without. This page states which benchmarks can do that, what each
leaderboard publishes, and where this implementation sits.

![accuracy against cost, three panels](benchmarks/accuracy-cost.svg)

Regenerate with `python3 scripts/accuracy-cost.py`. Every number in it is either a fold committed to this repository
or a leaderboard row with a date; nothing is estimated.

## What the three panels are

| panel | quantity | sample | why it is separate |
| --- | --- | --- | --- |
| left | pass@1 against prompt tokens **per task**, both coordinates from one run | 40 held-out retail tasks, one trial, 74 learned | the only place this project has both coordinates |
| middle | published pass^4, τ²-bench **retail** | 114 tasks, four trials | the field publishes the accuracy and no bill |
| right | published pass^4, τ²-bench **airline**, including this lane's own R41 | 50 tasks, four trials | the one column where microglia has a pass^4 on the leaderboard's own scale |

Three panels rather than one scatter, because pass^4 over four trials on 114 tasks and pass@1 over one trial on 40
are different quantities. A single axis carrying both would be the category error this project spends its rounds
refusing.

**The left panel's arrows are the treatment effects and they are the whole story of the last two rounds.** R198's
block arm bought +2.5 pp for 3,299.6 extra tokens an episode. R204's guidance arm came back with a *negative*
premium — the arm spent less than its control — because 34 of its 40 episodes carried nothing at all: a refusal
costs a summariser call and saves a block. That is not an efficiency, and the readback grades it as a failed
prediction rather than a saving.

## The benchmarks this claim can be tested on

| benchmark | leaderboard | LLM in the loop | reference stack | what it scores | cost published | this project |
| --- | --- | --- | --- | --- | --- | --- |
| **τ²-bench** (retail, airline) | its own board; submissions carry trajectories | **yes** — agent loop with a user simulator | **Python** (upstream), **TypeScript** in this repo's driver | pass^k on task completion | **no** — no row reports tokens or dollars | measured: pass@1 82.5 / 85.0 / 87.5 on 40 retail tasks; pass^4 36.0 (void) and 46.0 on 50 airline tasks |
| **BIRD** (dev / Mini-Dev) | its own board, EX by submission | **yes** — generator, optional selector ensemble | **Python** | execution accuracy | **no** | measured: 57.63 dev (n = 1,534) no memory, 56.26 memory arm |
| **ALFWorld** | its own board | **yes** — embodied agent | **Python** | task success | **no** | measured, with 8 failure trajectories unexplained |
| **LongMemEval** | paper tables, no public board | **yes** | **Python** | answer accuracy over long sessions | **no** | not run here |
| **LoCoMo** | paper tables (Mem0 et al.) | **yes** | **Python** | QA over very long conversations | tokens per call, unusually | not run here |
| **MemoryAgentBench** | paper tables | **yes** | **Python** | multi-turn memory operations | **no** | not run here |
| **MEME** | paper tables | **yes** | **Python** | memory-editing accuracy | **no** | not run here |
| **MemTrapBench** | paper tables | **yes** | **Python** | whether a memory *misleads* | **no** | not run here; its AdaptiveMem direction is registered as a candidate arm |

**Answer to "is the field's instrumentation complete?" — no, and the gap is one column.** Every leaderboard above
publishes an accuracy. None publishes the bill, the pack's size, whether the treatment was applied, or the sample's
own resolution. That is why the middle and right panels end in a hatched block: the cost axis for the field does not
exist, and drawing it anyway would be inventing numbers.

## Where this implementation sits

| axis | microglia | the field's best published | gap |
| --- | --- | --- | --- |
| τ² retail, pass@1, 40 tasks | **82.5% control, 87.5% with a transient sentence** | no comparable row (the field reports pass^4) | not comparable |
| τ² retail, pass^4, 114 tasks | not measured at k = 4 | **72.8** (SapientAI), **67.5** (IBM, with disclosed train/base overlap) | unmeasured |
| τ² airline, pass^4, 50 tasks | **46.0** reference, 36.0 memory (void: empty store) | **82.0** (IBM), 72.0 (SapientAI) | −36 pp on the reference arm, before any treatment |
| memory's marginal effect, measured on the same episodes | **−3.44 pp pooled** over six folds, 78.7% of served packs inert | the literature's largest published effect is *how* the pack is made (49.0 → 59.9) | this lane is at the "no effect" end on retrieved records |

The honest summary: **this project is not SOTA on any leaderboard, and it is the only entrant that publishes the
numbers that would show whether anyone else is.** The 82.5% control against a 72.8 top is a statement about the
agent and the sample, not about memory — a pass@1 over 40 tasks is easier than a pass^4 over 114, and the two rows
must not be placed on one axis.

## What the field does not publish, and this repository does

| quantity | microglia | the field |
| --- | --- | --- |
| whether the treatment was applied | `V1-pack-not-empty`, blocking, and `serveYield.withheld` since R205 | not reported |
| paired per-episode ledger | `V33`, every request, holes included | not reported |
| net marginal effect with its own repair/break counts | `V17`, `serveYield`, `conditional` | a delta without the counts behind it |
| the sample's own resolution, beside the delta | `V5`, and the interval in every readback | rarely reported |
| the population a share was taken over | `withheld` + `injectedEpisodes` (R205) | not reported |

## What would move this project onto the board

1. **A pass^4 on 114 retail tasks** with the same folds — the only way to compare against the middle panel. Cost
   scales with 4 trials, so it is a priced decision rather than a free one.
2. **The material axis**, which is where the literature's largest effect lives: summarise the failing trajectory of
   the task at hand and discard it, rather than retrieving records from other tasks. R204 measured why this matters
   here — 34 of 40 episodes had nothing to say about the request.
3. **The store's governance flags as a treatment**: same items, same text, one validity flag flipped. The published
   audit reports −40.54 points on LongMemEval from bookkeeping alone, and this store already carries the flag.
