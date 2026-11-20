# R162 — the shape of a memory, not its presence

**Registered** 2026-11-20, before any arm on this corpus has been driven.

**Why this registration is not in `prereg/`.** That directory is the dispatch schema: `gates` must be a
`V`-code, `split` must be one of `minidev`/`dev`/`train`, and `sample` is checked against what a dispatch
draws. None of the three describes an ALFWorld arm, and writing a `V`-code that nothing will grade would be
a registration that lies in its own header — which is the failure `prereg-pack.test.ts` exists to catch, and
it caught this file's first version. The file therefore lives beside the driver it registers, and the
schema gap is recorded in `AUDIT.md` 34.210 rather than papered over.

# R162 — the shape of a memory, not its presence

**Registered** 2026-11-20, before any arm on this corpus has been driven, and before the floor finish
line was known. This is the first registration in this record whose treatment is a *form* rather than a
*dose*.

## What twelve rounds on text-to-SQL established, and what they could not

R159 found that the harm a pack does is **prescription** rather than contradiction: a lesson that tells
the reader how to build an answer is wrong on any question it was not written for, and it stays wrong
without ever being false. R160 then asked whether anything in the corpus predicts which questions a
lesson is right for, and answered no — the band that reads best on dev reads worst on train, and every
band on the corpus that can see is negative or inside noise.

Both readings are about a pack that is **injected**: selected per question, written into the prompt of
that question, and absent from every other. The strongest published system in this line does not do
that. ExpeL's memory is a numbered list capped at twenty, rendered **whole into every prompt**, and its
retrieval runs over *trajectories*, not rules (`fewshot_strategy: task_similarity`, `retriever_type: knn`
in `configs/agent/expel.yaml@LeapLabTHU/ExpeL`). A rule that is always present cannot be present for the
wrong question — the failure R159 measured is structurally unavailable to it.

So the question this record has been asking is not the only question. **The axis is form**: a short
always-present list against a long selectively-injected pack. `rule-bank.ts` ports the competitor's
maintenance arithmetic so the always-in arm is the competitor's mechanism rather than an impression of
it, including the four places that arithmetic leaks (one-directional substring identity, a substring
banned-word filter, a cap nothing enforces, and a reply that is not deduplicated against itself).

## The three arms

| arm | what it carries | what it is a control for |
| --- | --- | --- |
| `none` | the task and the transcript | the corpus's own difficulty at this model |
| `always-in` | the same, plus up to 20 rules rendered whole on every turn | the competitor's mechanism |
| `retrieved` | the same, plus the entries a lexical anchor admits, per turn | this record's mechanism, on the same corpus |

All three run the same 134 held-out games, the same prompt skeleton, the same model, the same step cap,
and the same decoding. The only difference between arms is what the prompt carries above the transcript.

## Three predictions, and what refutes each

1. **`always-in` beats `none`.** Refuted if the paired interval for `always-in − none` contains zero. A
   null here would say this corpus is not the object either, and the direction of the whole programme
   changes rather than its parameters.
2. **`always-in` beats `retrieved`.** Refuted if that interval contains zero *or* is too wide to have
   excluded a 5-point effect. This is the prediction that carries the record's actual claim: that the
   harm was in the *form*, not in the idea of reuse.
3. **`retrieved` is not worse than `none` by more than the dev band.** Refuted if it is, which would
   reproduce R159's prescription reading on a second corpus and make it a property of packs rather than
   of text-to-SQL.

## What 134 games can and cannot settle, in arithmetic

Paired design, two-sided 5%, 80% power: `mde = 2.802·√(b+c)/n`, where `b+c` is the number of games the
two arms disagree on. At the discordance two arms of this shape usually show (30%), the split's own size
buys:

| games | MDE at 30% discordance | what it settles |
| --- | --- | --- |
| **134** | **13.3pp** | `always-in − none`, if the effect is the 19pp the literature reports |
| 268 | 9.4pp | the same, with room for a weaker effect |
| 536 | 6.6pp | `always-in − retrieved`, if the form difference is 7pp or more |
| 942 | 5.0pp | `always-in − retrieved` at a 5pp effect |
| 2,617 | 3.0pp | the same at 3pp, which is where a two-arm difference stops being worth a dispatch |

**Read the first row honestly: the split can see prediction 1 and cannot see prediction 2.** 134 games
resolve 13.3 points; a form difference worth 5 points needs 942 episodes, which is seven passes of a
split that has 134 games in it. Prediction 2 is therefore registered as *unresolvable at one pass*, and
the only ways to resolve it are stated below rather than assumed away.

### The two ways to buy power, and what each costs in validity

- **Repeat the split.** `R` passes over 134 games gives `134R` observations, but they are not
  independent: two passes of the same game share the game. The effective sample sits between 134 and
  `134R` and the honest interval is a **cluster bootstrap over games**, never a binomial over episodes.
  At `R = 4` the naive reading is 6.6pp and the clustered one is worse; the amount by which it is worse
  is measured, not assumed, because `rule-bank`'s votes are deterministic but the model's decoding is
  not.
- **Pool a second split.** `valid_seen` has 140 games, but ExpeL trains on it, so it is not held out for
  a comparison against ExpeL — only for an internal one. Using it would make arms comparable to each
  other and not to any published number, which is a trade this registration does not take silently.

## The gate before any money is spent: both readings are now in hand

Nothing here runs until two zero-cost readings are in hand, and both are assertions rather than estimates.

**1. The floor pass is green — run `44644387139`, job `135983146374`, 00:15:33 to 00:47:05 UTC.**

| reading | value | what it settles |
| --- | --- | --- |
| games covered | **134 of 134**, no duplicate | the split is the split |
| episodes terminated | **134 of 134** at the environment's own 50-step cap | no walk was cut off by the driver |
| floor | **0 wins, Wilson 95% [0.0%, 2.8%]** | the task family is not navigable by accident, so the headroom above chance is the whole board |
| replay | **134 of 134 identical**, 0 mismatches on gamefile, win, steps, action digest, observation fingerprint | the paired power arithmetic applies |
| commands at reset | 25.05 on average | the action space is closed and small, which is what makes a scored candidate set possible |
| transcript | **mean 5,367 chars, median 5,217, p90 6,846, max 8,405** | the cost model's only measured input |
| environment time | 852 s for the first pass, 884 s for the second, 6,360 / 6,596 ms per game | two passes of the split cost 29 minutes of runner time and no calls |

The floor being **exactly zero** is the important row and it is the one that cannot be inferred from the
literature. A random walker that scored even five percent would have meant part of the split is reachable
without understanding it, which would have compressed the headroom the treatment is measured against.

**2. The price is measured, not modelled.** With 5,367 characters of transcript for a 50-turn episode, a
fixed prompt prefix of roughly 8,000 characters and DeepSeek's published rate card
(`eval/manifests/model-rates.json`, off-peak, USD per million tokens), one episode costs:

| layout | input tokens | bill per episode | 134 games × 3 arms |
| --- | --- | --- | --- |
| no prompt cache | 138,042 in, 750 out | $0.02116 = **¥0.150** | ¥60.4 |
| prefix held by the cache | 3,492 miss + 134,550 hit | $0.00138 = **¥0.0098** | **¥3.93** |

The fifteen-fold difference is not an optimisation detail; it is the difference between a ¥60 experiment and
a ¥4 one, and it is decided by a property of the arm rather than of the provider: a turn-based transcript
that is *appended to* keeps a stable prefix and hits, while a pack re-injected per turn moves the prefix and
misses. This record has paid for that lesson once already on τ², where the memory arm was billed 3.7× the
control's uncached tokens on the same sixteen calls.

**So the calibration dispatch is 20 games, one arm, ≈ ¥0.20**, and its purpose is not the unit price — that
is now arithmetic over a measured distribution. Its purpose is the **headroom**: 134 games resolve 13.3pp, so
an `always-in` effect is measurable only if the `none` arm lands far enough above the floor to leave 13.3pp
of room. ExpeL reports its control at 40.0 with a different model; this project has never run any arm on this
corpus with this model. If `none` lands near 8%, prediction 1 is unmeasurable at one pass and the answer is a
stronger backbone, not a bigger sample.

## What would make this registration void

- The floor pass failing to cover or to replay, which would mean the 134 is not 134. **Satisfied as of run
  `44644387139`: 134 of 134 covered, 134 of 134 replayed identically.**
- The `always-in` arm not actually rendering whole: a rule list that is truncated by the prompt budget
  rather than by its own cap is a fourth arm nobody registered, and it must be counted and reported.
- A model whose cache-hit rate on the fixed prefix is near zero, which would make the arms differ in
  cost by more than they differ in content — the per-arm bill is reported beside the per-arm rate for
  exactly this reason.
- A `none` arm landing so close to the floor that 13.3pp of headroom does not exist. That is not a defect
  in the design; it is the design telling the truth about which model this question needs.
