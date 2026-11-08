---
id: R57-toxicity
step: R57
opened: 2026-11-08
arms: memory,reference
sample: 228
gates: V0,V1,V2,V3,V5,V6,V7,V8,V32,V44
recallFloor: 0
facadePair: off
trainDomain: retail
testDomain: retail
recallDomain: retail
---

# R57 — what a rule costs when it is not the rule the question needed

**Registered** 2026-11-08, undispatched. Blocked on R56 and R55 by the one-lane rule.

## The question, and why it has never been answered here

Every measurement this lane has produced has been a difference in **average** `pass^4` between two
arms, and every one of them has been too small to resolve. R54's paired delta is +5.26pp against a
20.27pp resolution; the pre-R50 pair was +1.47pp against 21.41pp. That is not a failure of the
mechanism — it is a failure of the *design*: a treatment that helps one question and hurts another
has a mean near zero, and averaging is exactly the operation that hides it.

The published record says the damage is not in the average either. MemSyco-Bench attributes 61–62%
of its catalogued errors to a stage *after* the correct memory is already in place; MemTrapBench
finds five memory frameworks scoring below their own no-memory ablation; the Memory Tax result is
that the cost is per-item and nearly invariant to content. Three different literatures, one shape:
the marginal item is not free, and its sign depends on something the average does not carry.

Two of our own numbers point the same way and have never been joined. The dose curve (W8) prices an
injected item at about −1.7pp and cannot tell content from volume — a rule that is *wrong* and one
that is merely *there* cost the same. Iteration 62's harm attribution found the rules credited with a
hurt sitting at median cosine 0.232 from the question they harmed, and the rules credited with a help
at 0.228 (p = 0.86). Neither measurement had a controlled item in it: both read the store the
distiller happened to write, where "related" and "useful" are confounded by construction.

## The design: a controlled distractor, not an observed one

Instead of attributing episodes to items after the fact — which needs a per-episode join the τ² lane
does not record (`useObservations` carries the query and the pack, not the task or trial, and the
agent has no task context inside an episode) — this registration **plants** the item.

One arm adds exactly one synthetic rule to every pack, at a coverage level fixed before the run:

| arm | the planted rule's share of the query's content terms | what it is |
| --- | --- | --- |
| `none` | — | the store as R56 leaves it |
| `far` | under 5% | grammatical, domain-flavoured, topically unrelated |
| `near` | 10–20% | shares the topic, states the wrong action |
| `adversarial` | 10–20%, contradicts a known-correct rule | same text as `near`, negated |

The rules are authored once, committed, and identical across arms; each is bound to a query by the
same `recallText` coverage the floor uses, so the level is measured rather than asserted.

Two properties make this a measurement rather than a demonstration:

- **The planted rule is the only difference.** Same store, same recall, same floor, same note, same
  order, same seed. Every arm runs `paired` against `reference`, and the four arms share one store
  (built once, in the `none` arm's learning phase).
- **The level is measured, not chosen.** Each pack's coverage of the planted rule is recorded per
  request, so an arm that drifted from its band is visible as a distribution rather than as a
  failure to reproduce.

## Prediction

- **`near` costs more than `far`.** The paired `pass^4` deltas order as
  `far > near > adversarial` is false; the expected order is `far ≈ 0`, `near < 0`,
  `adversarial < near`. The quantity this lane has never had is the *sign split*: for `near`, the
  episodes it broke should outnumber the episodes it repaired.
- **The mean is not where the effect is.** Written before the run: the paired mean of `near` may
  still be `UNRESOLVED` at 57 pairs, and the repair/break ledger — 42 informative, 28 repaired, 26
  broke on R54 — is the reading that will carry the result. A registration that graded only the mean
  would be repeating the design defect it exists to fix.
- **`far` is not free but is not harmful.** The dose curve predicts a small negative; MemTrapBench
  predicts a larger one. Either is acceptable as a reading; what would refute the account is `far`
  and `near` being indistinguishable.
- **Coverage predicts the sign.** Among `near` episodes, the ones whose pack coverage sits at the top
  of the band break more often than the ones at the bottom. This is the same claim R56 makes in the
  positive direction, tested on a planted item where the confound is gone.

## Refutation

- If `far` and `near` are indistinguishable at this sample, the similarity account of negative
  transfer does not survive contact with this lane, and the next registration is about position and
  length — which the dose curve already prices — rather than about content.
- If `adversarial` is *better* than `near`, the model is reading contradiction as a signal, and the
  finding is about how this scaffold resolves conflict. That is a different paper and it closes this
  axis.
- If every arm breaks more episodes than it repairs by more than the resolution, the honest conclusion
  is that this store should not be injected at all at this density, and R58 is about retrieval
  precision rather than about rule quality.

## What would make this round worthless

- Changing the store between arms. The four arms must share one store, or the comparison is between
  two distillations rather than between two pack contents.
- Authoring the planted rules after seeing which episodes failed. The rules are committed before the
  dispatch and the file's hash goes in the artefact.
- Grading `pass^4` alone. The mean is registered as reported-not-claimed; the ledger is the reading.

## Cost

Four dispatches of the same shape as R56, or one dispatch with four arms if the lane's facade can
take a per-arm injection list: 57 tasks × 4 trials × 2 arms per arm, about two hours each. The
implementation is one field on the facade (`TAU_PLANTED_RULES`), one committed rule file, and one
artefact block carrying the per-arm coverage distribution.

## Why not the retrospective attribution

Because it cannot be made causal here. Joining an episode to the items in its pack needs a task and
trial on every recall observation, and the τ² lane does not record one: `recall(text)` is called from
the agent with no task context and the run is concurrent at four. Adding that context is a real
repair and it is registered separately (`AUDIT 34.61`), but even with it, attribution over a store
the distiller chose is confounded — an item is retrieved *because* it resembles the question, and
the questions it resembles are the ones it is most likely to help or hurt. The planted rule is the
only version of this question this bench can answer causally at this sample size.
