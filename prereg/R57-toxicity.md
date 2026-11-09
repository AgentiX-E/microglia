---
id: R57-toxicity
step: R57
opened: 2026-11-08
arms: memory,reference
plantedArms: far,near,adversarial
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

## Amendment 2, 2026-11-09 — read after `near`, written before `adversarial`

`near` ran (`42544865267` on `71457278`) and the readback returned **`ABANDONED`** on two graded
predictions. One of them is a result. The other is a defect in this registration, and it is repaired
here before the third arm is dispatched rather than explained afterwards.

**The result.** `near` broke 5 episodes and repaired 7 of 57: excess **−2**, paired `pass^4`
**+3.51pp** against a half-width of 11.91pp, `UNRESOLVED`. The registration predicted `near < 0`; the
measured direction is the opposite, inside the drift a control arm moves on its own (3.51pp, R58→R59),
so it is not evidence of a benefit — it is the absence of the predicted cost at this sample.

**The defect.** The registration graded "the band landed on at least 60% of requests" and the census
measured **35.4% of 1972**. The 60% was calibrated, in Amendment 1, on *task instructions* ("counted
over the 114 requests in `retail.json`"). The census counts *every recall request*, and
`eval/drivers/tau2/microglia_agent.py` sends the current message's content on each turn — 8.6 requests
per episode, of which only the first carries the task's own words. So the prediction and the
measurement named different populations, and the arm was graded against a number that could not apply
to it. This is R51's defect one layer down: not a store graded on another domain's questions, but a
level graded on another population's texts.

**What the band becomes, for `adversarial`.**

- The per-request band share is **reported, not graded**. It is a distribution over a population the
  registration does not control, and it will be compared arm to arm.
- The graded prediction is the one this contrast exists for: **the adversarial arm sits at the same
  level as `near`** — its per-request band share within 10 percentage points of `near`'s measured
  share, and its `byRule` census non-empty for every rule it used. Amendment 1's whole point was that
  polarity must not move the dose; that is a between-arm equality, it needs no absolute threshold, and
  it is measurable on exactly the population the census already records.
- "One rule in every served request" stays graded for both arms, because it is a property of the
  instrument and it held for both arms that ran (`1934 of 1934`, `1972 of 1972`).

**What does not change.** The ledger is still the primary reading, the order `far ≈ 0 < near <
adversarial` is still graded as a difference of excesses against the 3.51pp drift, and
`adversarial`'s dispatch is unchanged: `TAU_PLANTED_RULES=adversarial`, the published population,
`TAU_DISTILL_UNIT=trace`.

## Amendment 3, 2026-11-09 — the three arms move onto one clock, and what a reproduction may decide

Written before the dispatch, and it is the amendment the two above made possible.

**What was wrong with how the three arms were measured.** `far`, `near` and `adversarial` were three
dispatches (`42534241219`, `42544865267`, `42556573088`), not one: `TAU_PLANTED_RULES` was a repository
variable, a variable is global, and the dispatch menu is at its twenty-five-input ceiling. So each arm
was measured on a different run, a different commit and a different slice of API latency atop the same
tasks, and the arm-to-arm comparison carries between-run noise that the 3.51pp drift only *prices* — it
does not remove it. The header now carries `plantedArms: far,near,adversarial`, and one dispatch fans
out one leg per arm on one commit. The reproduction is the point: the same three arms, one clock.

**What a reproduction is allowed to decide, fixed in advance.**

| reading | threshold | what it settles |
| --- | --- | --- |
| every arm's excess is within 3.51pp of its published value | the same drift the ordering is graded against | the ladder is reproducible, and the two-rung conclusion stands as published |
| any arm moves further than the drift | — | that arm's published excess is marked **not reproduced**, the ladder's conclusion is downgraded to a single measurement, and the movement is recorded in `COMPETITIVE` as an instrument difference |

**What it may not do.** No decision rule changes, no population change, no change to the committed
rule file (`0585fafcc817841a`), and the reproduction does not **replace** the published readings: a
reproduction is a second measurement of the same quantity and both stay in the record, side by side,
labelled by the dispatch that produced them. If the two disagree beyond the drift, the honest report is
two numbers and a named instrument problem, not the newer one.

**Why this is worth three legs of compute.** The conclusion this round reached — *proximity costs
nothing, contradiction costs 7pp* — is the premise of the next four experiments, and it rests on an
ordering measured across three clocks. An ordering that survives one clock is a finding; an ordering
that only exists across three is a coincidence with a schedule.

## Amendment 4, 2026-11-09 — the pack is settled once per episode, and the published arms were measured under a moving one

**What was wrong.** `MicrogliaAgent` recalled a pack on *every* turn from that turn's own message and
prepended it as a second system message. Two consequences, found together and both structural:

1. **The intervention moved.** A pack that changes each turn is a different treatment each turn, so a
   delta over episodes was never a delta from "the memory" — it was a delta from a *sequence* of
   memories. Every arm of this round, and every earlier arm that ran with a facade, was measured that
   way.
2. **It destroyed prefix caching for the rest of the prompt.** The provider caches on a token-block
   prefix. With a per-turn second system message, the divergence point is the *second message of the
   conversation*, so every token after it — the whole growing history, which is what an episode spends
   most of its prompt on — was billed at the cache-miss rate on every turn of the memory arm and on no
   turn of the reference arm. The two arms were not billed differently by 7%; they were billed
   differently by the cache, and the lane could not see it because it recorded no token counts at all
   (`calls: 0` on every arm).

**The repair, and why it is a repair rather than a redesign.** The pack is recalled once, on the
episode's first turn, and held for the rest of that episode (`eval/drivers/tau2/microglia_agent.py`,
`selfcheck_agent.py`). The treatment is now a single intervention per episode — which is what "the
store was frozen and the agent answered with it" was always supposed to mean — and the second system
message no longer moves, so the conversation prefix is stable and cacheable.

**What this does to the three published readings.**

| quantity | measured under | still valid as |
| --- | --- | --- |
| `far` +0.00pp, `near` −3.51pp, `adversarial` +7.02pp | a pack recalled per turn | *the effect of a per-turn re-recall*, which is a different mechanism from a frozen store |
| the ordering (near ≤ far < adversarial) | three separate dispatches, per-turn recall | the premise the next four experiments were registered against |

**No decision rule changes, and no threshold moves.** The three readings are not withdrawn and they are
not replaced: they are re-labelled by the mechanism that produced them, which is the rule Amendment 3
already states for a reproduction. What changes is what the *next* dispatch measures, and its number
will not be comparable to `+7.02pp` without saying so.

**Why the cost matters to the science and not only to the bill.** A lane that cannot afford to run its
own arms will run fewer of them, on smaller slices, with fewer trials — and every one of those is a
power loss disguised as a result. The unit repair (`fc23de1`), the thinking-mode default, the retired
model name, and this one are the same class of defect: **a number about the experiment that the
experiment did not choose.** They are fixed together because each of them independently made a
dispatch cost several times what its design assumed.

## Cost

Three legs of one dispatch, not four dispatches: the registration's `plantedArms` header renders a
matrix and the `l4` job runs one leg per arm on one commit (`f2330f8`). 57 tasks × 4 trials × 2 arms
per leg, about two hours each and running in parallel, `fail-fast: false` because the three arms are
independent readings. The implementation is a header line, one committed rule file, and one artefact
per leg carrying the per-arm coverage distribution.

## Why not the retrospective attribution

Because it cannot be made causal here. Joining an episode to the items in its pack needs a task and
trial on every recall observation, and the τ² lane does not record one: `recall(text)` is called from
the agent with no task context, and the run is concurrent — one episode at a time since `fc23de1`,
which makes a per-recall task label cheap but does not make the attribution causal. Adding that
context is a real repair and it is registered separately (`AUDIT 34.61`), but even with it, attribution
over a store the distiller chose is confounded — an item is retrieved *because* it resembles the
question, and the questions it resembles are the ones it is most likely to help or hurt. The planted
rule is the only version of this question this bench can answer causally at this sample size.
