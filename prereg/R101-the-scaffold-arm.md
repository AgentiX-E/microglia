---
id: R101-the-scaffold-arm
step: R101
opened: 2026-11-13
arms: scaffold
sample: 160
gates: V0,V1,V2,V3,V5,V8
recallFloor: 0
facadePair: off
trainDomain: retail
testDomain: retail
recallDomain: retail
packBudget: 2400
taskSplit: official
trainTasks: 74
testTasks: 40
release: v1.0.1
---

# R101 — the wrapper with no rules: the arm that says which half of R93 the −2.50pp belongs to

**Registered** 2026-11-13, after R93's readback. R93 compared two arms on τ²'s own held-out forty retail
tasks, in one dispatch, at one store: **memory 0.700** against **no memory 0.725**, paired delta
**−2.50pp** [−17.50, +12.50] at exact McNemar **p = 1.0000**, with thirteen tasks repaired and ten broken
(22 informative pairs) and a minimum detectable effect of **21.02pp**.

Two things were read from that, and only one of them is safe.

The safe one: **the control arm scores 0.725**, five points above the best published cell on this
benchmark (ALTK-Evolve's 0.675) and fifteen above the published baseline (GPT-4.1, 0.575). Whatever the
four rounds of "gap to SOTA" were measuring, it was not a deficit in this lane's control.

The unsafe one: that −2.50pp is a fact about **the pack**. It is not. The two arms differ in two things
at once, and AUDIT §34.123 recorded it before this file existed:

| | R93 memory arm | R93 reference arm |
| --- | --- | --- |
| agent class | `microglia_agent` (this project's wrapper) | τ²'s stock `llm_agent` |
| facade / recall call | one HTTP `GET /v1/recall` per request | none |
| `rules` block in the system prompt | yes, with a note sentence | no block at all |
| tool-name guard, inaction census, step budget | yes | none of them |
| pack | 15 records, 1.09 items served per request | — |

A difference between those two rows is a difference between a *wrapper* and a *stock agent*, and only
the last row is the memory. **The wrapper has never been run against an empty pack** — not in R93, not in
any arm in this record — so no committed number separates its cost from the pack's.

## The three cells, and why the middle one is the whole experiment

| cell | agent | pack | source |
| --- | --- | --- | --- |
| A | stock `llm_agent` | none | **R93 reference, 0.725** |
| B | this wrapper | **empty, by construction** | **this arm** |
| C | this wrapper | 15 records | **R93 memory, 0.700** |

- `B − A` is the **wrapper's own cost**: the facade, the recall round trip, a `rules` block that says
  it has nothing to say, the tool-name guard and the extra prompt tokens (R93 measured **+36.2% prompt
  tokens** and **2.17× the cost** on the memory leg).
- `C − B` is the **pack's contribution**, with the wrapper held constant — the number three rounds of
  pack experiments were implicitly attributing to everything else.
- `C − A = −2.50pp` is their sum, and it is already known.

Without B, every future pack experiment is a comparison against a moving scaffold: a pack that gains five
points while the wrapper costs five would read as a null, and no arm in this record could tell that from
a pack that does nothing.

## The arm, stated as the two legs

| | scaffold leg | reference leg |
| --- | --- | --- |
| `TAU_SCAFFOLD` | `empty-pack` | unset |
| `TAU_MEMORY` | `true` | `false` |
| agent | `microglia_agent` over the facade | τ²'s `llm_agent` |
| store | empty: **no learn episodes, no distillation, no records** | none |
| evaluation | 40 tasks × 4 trials | 40 tasks × 4 trials |
| model / judge / seeds / caps / budget | deepseek-flash / deepseek-flash, identical | ← identical |
| dispatch | one `sota` run, `l4_arms: scaffold` | ← same run |

The store is empty **because the arm says so**, and that declaration is what the two gates invert on:
`V0` requires every stage of the pipeline to be zero (a scaffold arm that quietly distilled an item is
refused, not graded) and `V1` requires the mean pack to be exactly zero (a scaffold arm that injected one
rule is no longer the control it was registered as). Neither gate stands down; both are turned around.
An exemption that only ever passes would be the vacuous gate this project keeps finding.

## Prediction

- **Instrument.** Both artefacts carry `tasks: 40`, `k: 4`, `unscored_reported: 0`,
  `benchmark.version: v1.0.1`, and `deepseek/deepseek-flash` as both agent and judge. The scaffold
  artefact carries `declaredEmptyStore: true`, `learning.rows: 0`, `learning.distilled: 0`,
  `meanPackIds: 0` and a `funnel` of five zeros; the reference artefact carries none of those.
- **The wrapper is cheap.** `B ∈ [0.675, 0.775]` — the wrapper's cost is under ten points and the pack's
  −2.50pp is the pack's. This is the prediction the record argues for: R93's memory leg differed from
  this arm only in what the pack contained, and 1.09 items of 0.214 coverage are not ten points of
  anything.
- **Or the wrapper is the finding.** `B < 0.650`. Then no pack experiment in this record measured what it
  said it measured: the −2.67pp pooled cost of any text against no memory (R22, p = 0.0091) would be the
  wrapper appearing wherever a pack was served, and the queue's next item is the wrapper's per-turn cost
  rather than any retrieval knob. This is the outcome that costs the project its last three readings, so
  it is stated here rather than discovered in a post-hoc sentence.
- **Resolution, stated before the run.** At n = 40 paired tasks, `detectableDelta(n, d) = √(z²·d/n)` with
  z = 2.802 gives 19.8pp at d = 0.20 and 17.1pp at d = 0.30 — computed in R93 and unchanged here. **This
  arm cannot certify a two-and-a-half-point wrapper cost**, and it is not being bought to: it separates
  "the wrapper costs about twenty points" from "the wrapper costs less than the sample can see", which is
  the only distinction that decides whether the pack is the suspect.

## Refutation

- **The scaffold leg built a store.** `learning.distilled ≠ 0`, or `meanPackIds > 0`, or any funnel stage
  above zero. The declaration did not hold, the arm is a memory arm with a truncated learn half, and the
  run is discarded rather than relabelled. Both gates fire on this and neither can be waived.
- **The legs did not score the same tasks.** `l4-same-split` fires. There is no pair.
- **The declaration was inferred rather than read.** `declaredEmptyStore` absent from the scaffold
  artefact. Then the two gates graded the run as a memory arm, and a green row means nothing.
- **Neither leg carries a verdict.** Either artefact `unscored > 0`, or the pair's informative count is
  below 20. With 22 informative pairs R93 could already barely speak; fewer says the arm measured the
  provider rather than the wrapper.

## Cost

**~$1.21** for the pair, at R85's billed band **$0.0053 per conversation**: 320 evaluation episodes
(2 × 40 × 4) plus the wrapper's own overhead. The overhead is not a rounding term here — R93 measured the
memory leg at **$0.8276** against the reference leg's **$0.3807**, a **2.17×** ratio that is itself the
quantity this arm exists to price. An earlier estimate in the roadmap said **$0.38** for this arm, which
assumed the scaffold leg would cost what the wrapper-free leg costs; it cannot, and the error is recorded
here because it is the same reasoning this arm is buying.

No learn episodes and no distill calls: the scaffold leg skips the learn half entirely rather than
pinning it, because a store nobody reads is not worth 74 paid conversations.

## What this unlocks

| cell | what it measures | comparable to |
| --- | --- | --- |
| R93 | memory 0.700 vs no memory 0.725, paired | no competitor publishes this cell |
| **R101** | **wrapper with no rules vs stock agent, paired** | **no competitor publishes this cell either** |
| R99 (in flight) | the same pack at 5× the supply | ALTK's 0.675, cleared by both legs already |
| R98 | the same, with unrelated records in the pack | the competition reading, falsified or confirmed |

After R101, every pack delta in this record is quoted against a scaffold measured in the same lane rather
than against a stock agent that differs from it in four ways.
