---
id: R76-corrected-labels
step: R76
opened: 2026-11-10
arms: full
sample: 283
gates: V1,V2,V3,V4,V5,V6,V7,V8,V12,V32,V44,V48,V51
---

# R76 — the corrected labels, on a real dispatch rather than a re-scoring

**Registered** 2026-11-10. `minidev`, 283 scoreable questions, `gold: corrected`. **≈916 calls
projected, ceiling 2,490** (`pnpm eval:budget --bird poc-sota-bird-R74-rule-causal.json --arms
none,full --questions 283 --learn 0`), **≈$0.20**.

## Why this file exists

R75 re-scored fourteen artefacts against the corrected labels, and its amendment split that population
in two: **283 questions the correction relabels and 67 whose text it rewrote**, because BIRD shipped
Mini-Dev revisions after the `v1-2024-06-20` this repository pins and the correction was built on a
later one. On the 283 the baseline is **62.69%** under the pinned labels and **59.64%** under the
corrected ones; the mixture reported **54.02% → 51.26%**, because the 67 mis-paired rows score 14.93%
and 16.31% and drag both arms down by seven points.

That reading came from re-executing statements inside artefacts that were produced by a different
instrument. It is the strongest evidence available and it is still second-hand: **no dispatch has ever
asked the loader for the corrected labels.** The machinery that does — a pinned revision beside the
pinned corpus, `reviseGold` dropping what it cannot score, a `dataset_gold` block in the artefact — is
covered by unit tests and by one offline replay against the archive in this sandbox. Nothing has run it
end to end, and an instrument that is only tested in pieces is the shape of every silent failure this
lane has recorded.

So this dispatch is a **validation**, and it is registered as one because its refutations are all
instrument failures rather than findings.

## Prediction

- **`n` will be 283**, and the artefact's `dataset_gold` will report **67 dropped**, `applied` equal to
  the number of gold-only corrections inside that slice, and **0 unmatched** — every entry in the
  revision names a row this corpus has, which is what makes it a revision of this corpus rather than of
  a neighbouring one.
- **The `none` arm will land between 57% and 63%.** The re-scored reading put the baseline at 59.64% on
  this population, and 283 questions carry about ±2.5pp of paired noise around a level, so anything
  inside that band is the same measurement made twice.
- **The memory arm will be within 4pp of the baseline**, because the whole point of the fourteen
  artefacts is that it is, and a validation run that produced a large delta would be reporting the
  instrument rather than the memory.

## Refutation

- **If `n` is 350**, the revision was applied after the pool was drawn, and the slice was scored on a
  population the fold assignment did not see. That is a defect in the wiring, not a result.
- **If `dropped` is not 67**, the manifest and the corpus disagree about which questions those are — and
  the whole offline replay would have to be re-run, because the two readings would be measuring
  different pairs.
- **If `dataset_gold` is null**, the dispatch's `gold: corrected` did not reach the loader, and the
  number is another vendor-label measurement wearing a correction's name.
- **If the baseline is within 1pp of 51.26%**, the revision was not applied and the 67 mis-paired rows
  are still in the denominator.

## What this file does not do

It does not measure whether memory helps. One minidev population, one arm contrast, and a split that
R75 established cannot carry an effect of the size this lane can produce: **1.4–3.1pp against a paired
detection floor near 2.5pp**. Its subject is the instrument, and its answer is "the correction reaches
the scorer, and here is the number it produces".

## Amendment 1 — the budget, restated from the planner that now exists

**2026-11-10, before dispatch.** This file opened with **≈916 calls projected, ceiling 2,490**, computed
by `pnpm eval:budget` at the time. Two changes landed under it and both move the number: the planner now
takes the prior run's own learning pass out of its bill before turning what is left into a per-question
rate, and `forecastBudget` no longer charges a cold fold's learning to the folds that read it from the
cache. The figures above are withdrawn and replaced by the tool, unchanged in every other respect:

```
R74_ARTEFACT=eval/results/poc-sota-bird-train-R74-rule-causal.json
pnpm eval:budget --bird "$R74_ARTEFACT" --arms none,full --questions 283 --folds 5 --learn 283
  rate       1.0043 calls per question per draw   (23,589 marginal calls over 7,829 × 3)
  learning   283 per fold × 5 = 1,415 requests; the prior cache answered 75%
  projected  1,015
  ceiling    2,494 — the bound, which prices learning cold
```

**Authorised: `max_calls` 1,015, `ceiling_calls` 2,494, `learn_sample` 283, five folds, deadline 130.**
≈$0.08 at the rate R74 paid.

The projection is 1,015 and not 916 for a reason worth stating, because it is the third registration in
a row whose estimate moved: **916 priced the evaluation and omitted most of a learning pass.** A dispatch
that distils from 283 questions per fold makes 1,415 requests, the cache answers about three quarters of
them, and the remaining 354 calls are real. A number that leaves them out is not conservative, it is
short — and short is the direction that stops a run after it has paid for its first fold.

Nothing else in the registration moves: the same three predictions, the same four refutations, the same
283-question population and the same `gold: corrected`.

## Amendment 2 — what the dispatch buys, and what it does not

The arm list is `none,full` and **`learn_sample` is 283 rather than zero**, which is a choice about the
instrument rather than about the memory. A `full` arm with no learning pass has an empty pack, and an
empty pack is refused by the pack gate before it can report anything; the validation would then be a
`none`-only run wearing two arm names. Distilling from the same 283 questions the evaluation scores is
what R74 and R77 already do, so the shape of the dispatch is the shape the published cells were produced
in — which is the property a validation of the *label* path needs and the property a measurement of the
*memory* would not survive.

## Outcome — 2026-11-11, dispatch `42931789908`

**910 calls, five folds, 283 questions, `none,full`, `temperature: 0.7`, gates all pass.** Every
refutation this file named stayed silent and every prediction held; the payload is the size of the
agreement rather than the fact of it.

| the file said | the artefact says |
| --- | --- |
| `n` is 283, not 350 | **`n.total` 283, `n.eval` 283, `qualifying` 283** |
| 67 of the slice's questions are unlabelable | 350 − 283 = **67**; the revision's own drop list holds **81** for the whole of Mini-Dev, of which 67 fall inside this slice, which is the arithmetic R75's amendment predicted |
| `dataset_gold` is not null | `gold/bird-minidev-arcwise-sql-only.json`, digest `e7bf7640…e8395`, **498 entries, 129 labels replaced, 288 already agreed, 0 unmatched, 81 dropped** |
| the baseline lands in 57–63% | **59.36%** (168 of 283) |
| the baseline is not near 51.26% | 8.1pp above it, which is the 8.7pp the mixture was short by |
| the memory arm is within 4pp | **0.00pp** — 59.36% against 59.36% |

**The number that matters is 59.36 against 59.64.** R75 re-scored fourteen artefacts that were produced
by a different instrument and put the corrected baseline at 59.64%; this dispatch asked the loader for
the correction and got 59.36%. Two measurements, one second-hand and one end to end, **0.28pp apart**,
which is a tenth of the paired noise on 283 questions and is the first time this lane has predicted a
level rather than a direction.

**The delta is a dead heat, and the statements are not.** 283 of 283 questions produced a different
`full` statement from their `none` statement, and **168 were correct in both arms**. So the pack moved
every answer's text without moving a single verdict on this slice — the reshuffle R74 found at 7,829
questions, reproduced at 283 at temperature 0.7. A delta of exactly zero with 283/283 differing
statements is not the memory doing nothing; it is the memory doing something that nets to nothing, and
the two are only distinguishable because the statements are in the artefact.

**What the dispatch cost against what it was authorised for.** 910 calls against 1,015 projected, 10%
under, with 859 of 920 distillation requests answered from the restored cache — the amortised shape
Amendment 1 priced.

**What this file does not license.** Every mini-dev level this record has published before R75 is about
8.7pp low, and this run is the reason they can be restated rather than re-run: the correction is a
pinned revision with a digest, `reviseGold` drops what it cannot score, and the artefact names the gold
it was measured against. The dev cells are **not** affected — the revision is built on Mini-Dev — so the
competitive ranking, which is quoted on dev, stands where it stood.

