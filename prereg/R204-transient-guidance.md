---
id: R204-transient-guidance
step: R204
opened: 2026-11-23
# The largest published effect in the memory literature says the durable artefact is the defect: stored lessons
# 49.0%, raw logs 53.5%, per-task guidance built from the logs and discarded at 59.9%, over nine benchmark/model
# settings (*More Memory, Worse Agents*, 19 Oct 2026). This record has the first two and has never built the third.
# The arm is R99's store — raw, scope all, the same 74/40 official split — with one field changed: what the pack is
# made of at serve time. R198's fold is the same corpus for the accuracy by-product, and R201 is why the body is
# the next thing to move: two rounds moved whether and how much the memory speaks, and the 78.7% inert share did
# not follow. The accuracy delta is a by-product here too — 40 held-out tasks resolve 15–18 pp — and the registered
# readings are the guidance call, the store's size, and the inert share.
arms: both
sample: 114
gates: V0,V1,V2,V3,V5,V8
recallFloor: 0
facadePair: off
facadeNotes: off
facadeShapes: off
distillScope: all
distillUnit: raw
rawCeiling: 2000
serveBody: guidance
speakMargin: 0
trials: 1
trainDomain: retail
testDomain: retail
recallDomain: retail
packBudget: 2400
taskSplit: official
trainTasks: 74
testTasks: 40
release: v1.0.1
claimRuler: interval
---

# R204 — the transient arm: write nothing durable, and say something task-specific

**Registered** 2026-11-23, before the dispatch. Built the same day: `serve-body.ts`, the agent's guidance path,
the `serveBody` header, its wire, the artefact field, the pool key and the ledger gate are all in the tree, and
`pnpm check` is green without a single model call.

## What the last three rounds established, and what none of them moved

R200 closed `inert = served − repaired − broke` over six folds: **78.7% [73.6, 83.0]** of 291 served packs changed
nothing, and the pooled delta is **−3.44 pp**. R201 then moved the **dose** — a margin that withholds a share of
packs — and read the ladder that already existed instead of buying a new one: at rung 0.01 the gate kept 22 of 26
repairs and prevented 6 of 36 breaks, which is exactly proportional to the corpus (`selectivity +1.3 pp`), and
mid-band it was anti-selective at **−6.8 pp**. The net delta turns positive only by withholding more than 68% of
the packs. R202 made the serving policy a field, so the pool can tell a bounded fold from an unbounded one.

So the record can say *when* the memory speaks, *how often*, and *how much* — and the share that changed nothing
has not moved through any of it. What none of those rounds touched is **what the pack says**. That is the axis the
literature's largest published effect is about, and this is the arm that measures it.

## The mechanism, stated as the one field that differs

Same corpus, same split, same tasks, same trials, same learn half, same store unit as **R99** (`raw`, scope `all`,
2,000-character ceiling) and the same recall floor. The control arm is unchanged and memory-free.

At each request the memory arm retrieves the block the store ranks first, then makes **one** model call — the
block and the request, to the arm's own model — and injects the one sentence that comes back. Nothing is written
back, so no new item exists after the episode and the store's item count is the same at the end of the phase as at
the start. The prompt therefore carries a sentence written for this request rather than a 295-token block that
rides every turn of it.

The two switches that would have confounded it are deliberately **not** set: no `serveSupport` floor (a raw record
carries `supportTasks: 1`, so a floor of 2 would retire the entire store and serve nothing — the arm would then
measure an empty pack for a reason unrelated to its mechanism), and no `serveRotation` (the body is the treatment,
and a rotation would make the arm differ from R99 in two fields).

## Prediction

- **The guidance call is attributable.** The memory arm's `usage.calls` exceeds its control's by one call per
  served episode, and its prompt tokens exceed by a positive premium; the pair publishes the agent's own census
  beside it (`guidance.calls`, `sentences`, `refusals`, `failures`, `promptChars`, `sentenceChars`). The call is
  made inside the agent precisely so that it lands in the same litellm account the episode is billed to.
- **Between 60% and 100% of served episodes get a sentence.** Below 60% the arm is mostly silence and the reading
  is about the prompt rather than the mechanism; `NONE` is an accepted answer and is counted as a refusal, not an
  error.
- **The store does not grow: `storeGrowth.grew` is false on both arms, and `after === before`.**
- **The sentence is 60–160 tokens, not 400.** A paragraph would be the durable artefact this arm exists not to
  write, and the ceiling in the module is 400 characters, so anything at the ceiling refutes the prompt rather
  than the mechanism.
- **The memory arm's injected prompt tokens per episode fall below R198's 3,299.6**, because the block is paid once
  as the summariser's input instead of 11.2 times as context. If the bill rises, the arm is paying for the
  summariser *and* the block and the body is not what shipped.
- **The inert share lands within ±10 pp of 78.7%.** This is the primary reading and the one that decides whether
  the body is a mechanism: a share that moves must move *down*, and by more than the fold's noise.
- **The delta is unresolved and inside ±11 pp of zero**, quoted against the resolution 40 tasks support rather
  than as a finding.

## Refutation

- **If the guidance call cannot be separated from the episode's own calls** — one call per *turn*, or a premium a
  per-turn injection would also explain — the arm is not the arm and the round is a repair, not a result.
- **If the store grows during the evaluation phase**, this is a lesson arm with a step in front of it, and the
  claim that nothing durable was written is false.
- **If the pack is withheld on every request** (the model answers `NONE` throughout), the reading is about the
  prompt rather than the mechanism, and it is reported as that.
- **If the inert share moves up**, the published 59.9% does not transfer to a single-shot retail harness. That is a
  finding about the corpora and it is stated as one — the paper's own nine settings span 49.0% to 59.9% and nothing
  in it says the direction of the body effect is universal.
- **If `storeGrowth` is absent from either artefact**, the gate did not reach the run and the round is a repair:
  the transient arm's central claim is the absence of a write, and an unmeasured claim is not a result.

## Price

**≈ ¥3–4**: two arms × 114 tasks × 1 trial at R198's measured ¥2.75, plus one guidance call per served episode
(≈ 114 × 2,500 prompt tokens, under ¥1), minus the block that no longer rides 11.2 turns of the memory arm. The
engineering is already paid; the dispatch buys the reading.

## What this round does not settle

The inference-time critic that MemTrapBench's AdaptiveMem direction describes — a second pass that reads the pack
and the request and decides whether to serve — is not in this lane. If the body moves the inert share and the delta
stays unresolved, that is the next registered arm rather than a conclusion drawn from this one.
