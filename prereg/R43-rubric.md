---
id: R43-rubric
step: R43
opened: 2026-11-03
arms: memory,reference
sample: 200
gates: V1,V2,V3,V5,V6,V7,V8,V15,V16,V17,V32,V33,V44
---

# R43 — the pack that served nothing, and the half of the failures that taught nothing

**Registered** 2026-11-03, after reading R42 (run `41468737074`) and before the dispatch that
measures this round. **Stage**: the treatment R41 and R42 both failed to deliver.

## What R42 measured, in full

R42 was dispatched to repair the store R41 never built, and it did: the model name is translated at
the endpoint that knows the endpoint, the distiller answered seven of seven events, and the store
held fourteen items when evaluation began. Then the memory arm published `V1-pack-not-empty` at
**0.00 rules/question** for the second round in a row, from a store that was no longer empty.

| reading | value | what it means |
|---|---|---|
| `tau2.meanPackIds` | **0.00** over 200 requests | the façade served nothing, 200 times |
| store after distillation | **14 items**, 0 failed | the distillation worked |
| `tau2.learning.edited` | **7** of 32 training tasks | the learner could read 7 failures |
| `tau2.learning.unanswered` | **25** | the other 25 taught nothing |
| `V32-fold-learning-intact` | **FAIL**, 25/32 (78.1%) | the gate that grades that gap |
| `V8-call-reliability` | pass, 0/7 calls | seven distiller calls, none refused |
| `V44-domain-accounted` | pass, **0 of 14** without a domain | every item carried one |
| `V15-transfer-reconciles` | pass, 200/200 (88 informative) | the ledger reconciles |
| `V16-transfer-resolvable` | **FAIL**, 88 informative < 100 | the floor is out of reach here |
| `V17-transfer-net-reported` | pass, **+4.00pp**, 23 repaired / 15 broken | a direction, not a rate |
| `l4-paired` | **FAIL**, +4.00pp, p = 0.6875, n = 50 | 2 lost, 4 gained |
| `pass^4` | memory 0.44, reference 0.40 | the arm was never given memory |
| `V5-resolution` | **FAIL**, minimum detectable 13.73pp | 50 paired tasks, 12% discordance |
| scenario sizes | retail 114, airline 50 | whole-scenario ceiling ≈ 13.7pp |
| gate census | 13 fired, 2 vacuous, 26 absent | 13 supplyable, 26 arm-indexed |

Two facts sit beside each other and neither explains the other: **a store of fourteen items**, and
**a pack of zero**. Every gate that could have reconciled them was either quiet by construction
(`V44` counts items without a domain, and these had one) or absent (`V1` had no population to
report).

## The two defects this round repairs

**1. The domain on a claim is the model's spelling, not the host's.** `parseScope` takes `task` from
the event and `domain` from the model's own JSON. The prompt forbids a guess; nothing validates one.
`MemoryStore.search` then filters items by `scope.task` *and* `scope.domain`, and the façade asks in
the host's spelling — so a claim stored as `Retail (US)`, `retail_domain` or `Retail` is active,
counted, ledgered by `V44`, and unreachable. The pack is empty for every question and the record
says `0.00 rules/question` beside fourteen items.

The host is the only party that observed the scenario, so the host owns the key: `stampDomain`
overrides the domain on every claim its interpreter returns, on both branches of the fallback. The
suite holds the experiment in two halves — the same store, the same claims, the same question, one
with the stamp and one without — so the claim "this is the mechanism" is a test rather than a story.

What this round **cannot** claim is that R42's items were mis-spelled. The twelve items were in a
temporary store that the job deleted. The stamp removes the class; the census names the instance.

**2. Two thirds of the failures had nothing to teach, and the reason was the reader, not the
record.** τ²'s domains disagree about how to write a rubric. `airline` names the expected calls;
`retail` checks database state and states `nl_assertions`. `taskCorrection` read `actions` only, so
25 of 32 failed retail tasks produced no correction — and `V32`, which grades exactly that gap,
reported 78.1% unanswered for a run whose store held every failure it could read.

`TauTask.assertions` carries the prose rubric, and `taskCorrection` falls back to it: the calls when
the task names them (the sharper lesson), the rubric when it does not, nothing when it states
neither. `teachingOf` is still the single decision, so `learnableCorrections` and `unansweredTasks`
cannot disagree.

**The third change is instrumentation, because the first defect was invisible.** The arm now records
`store` (stored / active / servable-in-scope, plus a status histogram) and `recall` (requests /
served / empty), and `V1`'s sentence states them: `0.00 rules/question: 0 of 200 request(s) carried
an item, from a store of 14 (14 active, 14 in scope)`. The three zeros — never asked, nothing
active, nothing servable — are different defects in different layers, and a gate that prints the
rate alone sends its reader to the wrong one.

## The claim under test

> The memory arm's pack was empty because the store's keys and the learner's reader were wrong, not
> because the mechanism does not transfer; repaired, the same arm serves a pack on every request, and
> the transfer reading either moves or is stated as a direction at a resolution the benchmark fixes.

## Prediction

- **The learn half reads all 32 tasks.** `learning.edited` goes 7 → 32 and `unanswered` 25 → 0,
  because retail's failures state rubrics and the reader now reads them. A store of roughly 64 items
  (two candidates per correction) is the expected size, and a size near 14 means the rubric path did
  not reach the distiller.
- **`V32` passes**, for the first time in this lane, on a population of 32 rather than on a subset
  the reader happened to understand.
- **`V1` fires on a non-empty store and passes**, or fails with a sentence that names the layer. It
  may no longer fail as a bare rate: `packPopulation` is supplied whenever the rate is.
- **The census is the round's evidence, not the delta.** `servable > 0`, `requests = 200`, and
  `served = 200` is the delivery claim. `served = 0` with `servable > 0` moves the next round's
  subject to the façade; `servable = 0` keeps it in the store.
- **`V8` fires on at least 32 calls**, since each correction is one distiller call, and passes.
- **`V15` stays reconciled at 200/200** and `V16` still fails: 88 informative of 200 is a property of
  the scenario's easy episodes, not of the pack.
- **`V5` still fails at ~13.7pp, and the bar is not moved this round.** The whole of τ²-airline is 50
  tasks and the pair already scores all of them: no dispatch of this lane can decide 5pp on this
  scenario. Moving the bar is a registration decision that needs its own field and its own round
  (`WHITEPAPER` §3.6.37); taking it in the same round that first delivers the treatment would make
  the treatment and its bar one decision.
- **`l4-paired` remains not significant at n = 50**, and the sign is not predicted.

## Refutation

- **If `learning.edited` stays at 7**, retail's task documents do not carry `nl_assertions` where the
  reader looks, and the corpus is the constraint rather than the reader. The census will show a
  small store and the round after that reads the task documents themselves.
- **If the store is 32+ items but `store.active` is 0**, the defect is confidence and contradiction,
  not the key: the stamp was necessary and not sufficient, and the next round reads
  `contradictSameScope` rather than the scope.
- **If `servable > 0` and `served = 0`**, the façade is dropping what the store offered, and the
  next round instruments `/v1/recall` rather than the store.
- **If `V15`'s informative count falls below 88**, the rubric-form lessons are prompt noise: they
  changed which episodes the pack could repair, and the round after must ablate them as their own
  arm instead of blending them with the call-form ones.
- **If `l4-paired` falls below −5pp with a served pack**, the memory now costs accuracy, and the
  round is a regression by this project's rule — reverted on the reading, not on the explanation.

## What would make this round worthless

Reading the delta. A pack that serves for the first time and an effect that is not resolved are both
true at n = 50, and only one of them is the round's deliverable. The other failure is subtler:
treating `served = 200` as "the memory works". It says the memory *arrived*; whether what arrived
helps is what `V17` and `l4-paired` are for, and neither can answer at this sample.

## Cost

One dispatch through `sota.yml`: the same scenario pair (learn `retail`, answer `airline`, recall
`retail`), the same 32-task learn half, whole-airline evaluation at four trials, two arms, about
1 h 20 min per arm. No new dataset, no new model family, no change to the merge gate.
