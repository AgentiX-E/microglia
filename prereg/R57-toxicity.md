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

| arm | the request's content terms the planted rule shares | what it is |
| --- | --- | --- |
| `none` | — | the store as R56 leaves it |
| `far` | none | grammatical, domain-flavoured, topically unrelated |
| `near` | two or more | shares the topic, states the wrong action |
| `adversarial` | its `near` twin's, by construction | the same words as `near`, the correct action forbidden |

The rules are authored once, committed, and identical across arms; each is bound to a query by the
same `recallText` coverage the floor uses, so the level is measured rather than asserted. The level
is a count rather than the share this section first stated — see the amendment below, which was
written before any arm ran.

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

## Amendment, 2026-11-09 — the level is a term count, and the pair is measured on one text

Written before any arm was dispatched, and before any episode existed to look at. Two defects were
found by measuring the committed rules against this domain's own requests.

**The share band was unreachable.** A retail request carries 11 to 126 content terms — median 40,
p90 78, p10 21, counted over the 114 requests in `retail.json` with the lane's own tokenizer. A rule
that shares four of a request's terms therefore covers 0.10 of a short one and 0.03 of a long one,
and no rule that shares a request's topic lands in 10–20% of it: measured, the drafted `near` rules
reached 10–20% on 11% and 12% of requests, and `far` on 0%. A band that reports `inBand: false` on
nearly every request measures its own arithmetic.

The band is therefore a count of the request's content terms that the rule shares: `far` is none,
`near` and `adversarial` are two or more. That is the same distinction with the request's length
taken out of it, and it is what "shares the topic" means when a topic is forty words long. The share
is still recorded per request and in the census, because it is the quantity the recall floor uses;
it no longer decides the band.

**The pair was not matched on level.** The drafted `adversarial` rules were the `near` rules with an
action forbidden *and* one word added — `keep`, in the address pair, a term 30% of retail requests
carry — so the adversarial arm sat at median 0.067 coverage against the near arm's 0.048 and on 64%
of requests in band against 49%. Polarity would have moved the dose, which is the one confound this
contrast exists to remove. Two repairs, both enforced in code rather than by care:

- `validatePlanted` refuses a twin pair whose token sets differ by anything other than a declared
  negation marker, so a future edit to one side of a pair cannot silently change its level.
- A pair's level is measured on the `near` text and inherited by both arms, because a negation
  marker is itself a token and a third of retail requests say "not" themselves.

After the amendment: `far` shares nothing with 100% of requests, and the `near`/`adversarial` arm
reaches its band on 76% of them, the rest recorded as drift rather than repaired. The rules were
re-authored once, on the request-length distribution, before any dispatch and before any episode
was scored.

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
