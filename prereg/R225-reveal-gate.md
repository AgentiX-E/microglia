---
id: R225-reveal-gate
step: R225
opened: 2026-11-26
arms: none
sample: 456
gates: V0
recallFloor: 0
---

# R225 — the reveal, screened before it is armed

Registered 26 November 2026. **No dispatch.** The instrument is `eval/tools/serve_policy.py` replayed over grid R218b,
which holds a no-memory arm and a treated arm over the same 114 tasks with four attempts each. R223 closed the space of
things a *request* declares and named its own successor in the same document: read what the episode **reveals** — the
order, the item, the returned attribute row — because that is the first content in the transcript that can differ
between a task the control already solves and one it does not.

This round is that successor, and R223 pre-committed its consequence: *a successor proxy that reads the revealed
content and still yields nothing refutes the serving hypothesis altogether.* The rule below is the one R223 wrote
before the instrument existed.

## What moved, and why the move is the claim

`observables()` used to stop **at** the first tool call outside the authentication family. That boundary is correct for
a policy timed at the request and wrong for one timed at the write — and R219's invocation policy serves at the write,
which necessarily has the reveal's answer in hand. So the boundary is now the reveal's **result**: the payload the
episode was shown before it chose what to do, and nothing after it. The prefix test is unchanged in form and stricter in
content: a transcript truncated immediately after that result must read identically, and a transcript that ends *before*
it must report `revealShape = none` rather than the smallest possible record.

That is what makes a reveal-keyed gate **implementable** rather than a counterfactual: a policy that reads the payload
and then decides whether to serve is a policy that can ship, because the decision point exists at a turn the agent
actually reaches.

## The declared family, and why declaring it is the protection

Six quantities, fixed in the instrument's docstring before the screen ran, each with a mechanism sentence:

| field | what it is | why it could be the decision |
|---|---|---|
| `revealShape` | object / array / scalar / unparsable / none | a payload that is not a record is not the state a block summarises |
| `revealChars` | the payload's length | a summary of a long record leaves more out than a summary of a short one |
| `revealKeys` | top-level keys | breadth of the record rather than its size |
| `revealEntries` | `items` of an order, or an array's length | the benchmark fails on "one of two items done", so the count is the failure's own shape |
| `revealLeaves` | scalar values, to a ceiling of 400 | two payloads of one length can be one long field or forty short ones |
| `revealOptions` | variant axes under every `options` map | an exchange against one variant is a lookup; against six it is a decision |

A family chosen after the outcomes are known has a multiplicity column that is a lie, so the family is declared, the
screen is deterministic, and the split is derived from the grid's own task order rather than from a seed — the reading
is reproducible from the artefacts alone.

## The estimator, unchanged from R223

For a policy π mapping an episode's prefix to {serve, skip}, `skipDelta` is the mean over the skipped pairs of
`y_control − y_treated` and `serveDelta` the mean over the served pairs of `y_treated − y_control`, each with its own
two-sided exact sign test. `ADMISSIBLE` requires a positive `skipDelta`, `skip.p < 0.05`, `serveDelta ≥ 0`, at least ten
discordant pairs, and a served share at or below 90%. The chosen cut is taken on the **screen half** and judged on the
half it never saw; `CONFIRMED` requires an independent positive `skipDelta` at p < 0.05 on at least six discordant
pairs, which is the smallest count at which a unanimous sign test clears 0.05.

New this round: **`excess`**. The number of admissible cuts a screen produces is binomial with `p = 0.025` per cut, so
the yield has a standard deviation and a tail probability, and the sentence now carries `z` and `p` rather than inviting
a reader to compare two numbers. The cuts are not independent — thresholds a few units apart are nearly the same subset
— so the binomial treats the family as more multiplied than it is, which errs in the direction that makes a claim
harder. That is the direction a screen may err in.

## Bars

| gate | bar | why |
|---|---|---|
| the family is live | the positive control confirms at z > 1.5 | a reader that silently sees no payload would return `NOTHING_ADMISSIBLE` for ever and read as a permanent negative |
| the yield beats chance | `excess.z > 1.96` before any cut is armed | 565 cuts at 2.5% produce about 14 admissible from noise alone |
| the cut replicates | `CONFIRMED`, i.e. confirm-half `skipDelta > 0` at p < 0.05 on ≥ 6 discordant pairs | a cut chosen in sample is a cut chosen on its own outcome |
| the policy is not dominated | pooled `serveDelta ≥ 0` | a gate that refuses well and serves at a loss has improved on nothing |

## Prediction

- **The reveal family will not beat chance.** The reveal is a property of the *task* — the order is the same across a
  task's four attempts — so a cut on it is an admission rule for a task class, exactly like R223's, and R223's class
  rule did not transfer. `excess.z` will sit inside ±1.96 and the chosen cut will not replicate.
- **The reveal is nearly as task-constant as the request.** `revealEntries` and `revealChars` will be constant within a
  task on about 90% of tasks, against 96% for the first tool call. The difference is the eleven per cent of tasks whose
  order record changed between attempts, and it is too thin to gate one attempt and serve another.
- **No observable decision recovers the +7.5 / −9.5 stratification**, and the honest consequence — written by R223 in
  advance — is that the harm is a property of the material's *presence*, not of its content, its amount, or its timing.

## Refutation

- **A cut that confirms on the held-out half with a positive `skipDelta` and a serve half that does not lose** re-opens
  the dispatch: 228 episodes, ≈ 9 CNY, and the round becomes the replication of that cut rather than the absence of one.
- **An `excess.z` above 1.96 with no single cut confirming** would be a family that carries signal the split cannot
  locate, and the next round would be a screen at a finer granularity rather than a dispatch.
- **A positive control that fails** refutes the instrument rather than the hypothesis, and no reading from this grid is
  admissible until it is fixed: the control is the only thing standing between a broken reader and a permanent,
  unfalsifiable negative.
