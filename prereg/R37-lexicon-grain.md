---
id: R37-lexicon-grain
step: R37
opened: 2026-11-02
arms: full-lexicon
sample: 1534
gates: V1,V2,V3,V4,V5,V6,V7,V8,V12,V32,V44,V48,V49,V64
---

# R37 — the grain of a memory write: a term and its referent, not advice about a query

## Why this file exists

Six routes are closed with the corpus held fixed: which rules are stored (§145), how many reach the
prompt (§146, §151), whether a filter can drop the harmful ones (§147–§148), which questions they are
shown to (§149), whether an item carries a value that travels (§150), and what a correction is rendered
as — rule, repair note, procedure or verbatim event (§143, R14, R22). Every one of them changed *which*
sentences reached the prompt, or *how many*, or *what they were called*. None changed what a memory item
**is**: a sentence of advice about how to build a query.

Advice has no referent. A reader cannot check `a query that asks only for a computed rate returns the
rate, not the name` against the question in front of them, so the sentence is applied wherever it is
read — which is what the record measures when it finds a pack naming entities the question never
mentioned, at 2.6pp, on questions the rule was never about.

The corpus contains the other object, written by its authors, and R23 priced it: **142 characters, mean,
of what one term means here, worth 19–20pp when removed.** That is not a better-worded rule. It is a
different sort of thing:

```
  rule        applies to   questions that resemble the one that taught it
              can say      anything, including names the question never used
              retrieved by similarity between a question and a sentence

  definition  applies to   questions that contain the term
              can say      only what the term denotes
              retrieved by the term itself
```

R23's finding was read as "the pack competes with the curated hint" and R24 withdrew the competition. It
was never read as **a comparison of two grains in the same slot**, which is what it is: a hand-written
definition is worth +19.7pp on these questions and our rule pack is worth −0.71pp on the same ones. The
difference cannot be attributed to the author, because the rule pack was written by a model that had
seen the correction the definition would describe.

## What is being tested, exactly

One arm, built from the same corrections as `full`, on the same folds, under the same character budget:

- **`full`** — the rule grain. 1,090 items on the dev split, recalled by question-to-statement
  similarity, rendered as a block of conventions.
- **`full-lexicon`** — the definitional grain. A second store distilled from the same events by the same
  client under a different instruction (`distill-prompt/3` + form `lexicon`), where each item is
  `{term, statement}`. `term` is a phrase copied from the question that taught the entry, enforced at
  write time: a candidate whose term does not occur in its source question is refused, by
  `admitLexicon`, and counted by reason. At read time an entry is rendered only if the held-out question
  contains its term — a substring-free, word-boundary match — so the block's action radius is the words
  of the question in front of the reader.

The comparison `full-lexicon − full` is therefore one variable — **what an item is** — with the store's
contents, the folds, the budget, the position and the model held fixed. Both arms are measured in one
dispatch, on the same 1,534 dev questions, so store variance (1–2pp across dispatches, §R23) is not
inside the contrast.

## Prediction

- **P1 — the arm is not `none` under a second name.** The store learns entries, and the block renders
  on at least **25%** of held-out questions, with `V64-lexicon-is-licensed` passing: entries > 0, lines
  > 0, every rendered term read back out of its line, zero unlicensed. An arm whose store is empty or
  whose block never renders publishes the difference between `none` and `none`, which is the failure
  this programme has caught twice (R25's `V49`, R36's `V62`).
- **P2 — the definitional grain beats no memory on this split.** `full-lexicon − none` is **above
  zero** with a database-clustered interval that excludes it. This is the weaker of the two treatment
  claims and it is stated first because a grain that cannot beat nothing cannot be compared to a grain
  that does not.
- **P3 — the definitional grain beats the rule grain by at least one point.** `full-lexicon − full`
  is **≥ +1.0pp**, clustered by database, on the same 1,534 questions. This is the round's actual
  claim: two blocks of the same size, built from the same corrections under the same model, differing
  in what a memory item *is*.
- **P4 — the exchange rate clears the hurdle.** `clearance(full-lexicon)` is **≥ 1.335**, the bar R21
  fixed and R36 measured both rule arms below (0.672 and 0.737). A definition that repairs less per
  break than the bare model's base rate has not paid, whatever its delta is.
- **P5 — the definitions are about the questions they are shown on.** The licence holds on **100%** of
  rendered lines, and each prompt that carries the block carries at least one term. This is `V64` and
  it is the gate that makes the arm a grain rather than a second block of advice.
- **P6 — the arm's cost is held.** Mean rendered characters are within **±20%** of `full`'s, so a
  delta cannot be a dose difference. The two blocks share one 1,200-character budget; this prediction
  checks that the shorter object did not quietly buy a wider pack.

## Refutation

- **If P1 fails — no entries, or the block renders on fewer than a quarter of the questions — the
  round is inconclusive by feasibility and not a refutation.** The distiller did not produce a
  retrievable definition from these corrections; the refusal counts, by reason, say which clause
  failed, and the next round is about the distiller rather than about the grain. The document says so
  here so that a feasibility failure cannot later be read as evidence against the hypothesis.
- **If P1 holds and P3 holds, the grain is the mechanism, and the product statement changes** from
  *"a distilled memory does not pay"* to *"a distilled memory pays when what it stores is a
  definition"*. The next round is then the admission of entries — which of the learned definitions are
  true — because a definition that is false is worse than a rule that is vague.
- **If P1 holds and `full-lexicon − full` sits inside ±1.0pp, the grain is refuted as the lever.** The
  record's negative then survives a change in what a memory *is*, not only in what it says, and item
  10 of the progress list closes with that sentence rather than with another design.
- **If P1 holds and `full-lexicon − none` is below zero with an interval that excludes it, the
  definitional form is harmful here too.** That is the strongest form the negative has taken — a
  representation the corpus prices at +19.7pp when a human writes it costs accuracy when a model
  writes it — and it closes the grain lever as well.
- **A positive point estimate inside its own interval is not a finding.** The lane's published minimum
  detectable effect at n = 1,534 is **2.01pp**; a cell that cannot clear it is reported as a direction
  and replicated on a second store draw before it is used, exactly as R35's lead was.
- **And the refutation that would be about the round rather than the hypothesis:** if the `full` cell
  in this dispatch differs from the committed R25/R30 readings by more than the store variance the
  record has measured (1–2pp), the two blocks were not built from the same corrections and the
  comparison is void rather than negative. That is stated here because it is the one failure mode a
  within-dispatch comparison cannot rule out by construction.

## Known confounds, stated rather than hidden

- **The grain carries its retrieval.** A term memory is retrieved by its term; that is part of what the
  grain *is*, and it is also a second difference from `full`'s relevance ranker. The alternative — a
  definition recalled by question-statement similarity — would measure a definition that cannot be found
  by the word it defines, which is not a design anybody would ship. If the arm is positive, the next
  round separates the two by rendering the same entries under `full`'s recall.
- **The distiller writes the entries, so a null can be the distiller's.** A model asked for a definition
  may return a rule with a `term` bolted on, which passes the licence and is still advice. The store
  sample travels in the artefact, and the reading quotes it.
- **The corpus supplies a definition for many questions.** BIRD's `evidence` is present on most dev
  questions, so the learned entries partly duplicate a hint the model already has. R24 showed the rule
  pack does not interact with it; a duplication would show up as a smaller effect, not as a larger one,
  and the reading reports the delta separately on questions with and without evidence.

## Disclosure

The direction was **not** chosen after seeing this arm's outcome — the arm has never run. The `full-raw`
arm (the same store, the same recall, the event instead of the note) is the closest prior and it was
null (−0.86pp), which is a reason to expect a null here too and is why the decision rules above name the
refutation rather than the discovery. What *was* seen before this file was written: R23's +19.7pp for the
benchmark's own definition, R30's −0.71pp for the rule pack, and the store census that says 78% of rules
name nothing checkable in the schema.

## Cost

One `sota.yml` dispatch on `dev`: two distillations per fold (rule and lexicon, 280 learning questions
each) and three arms over 1,534 questions — forecast ≈ 7,400 calls against the 9,000 cap. No new
benchmark data, no new dependency, and the arm reuses the lane's existing generation cache for the `none`
and `full` cells.

## How the readings are produced

- `pnpm eval:sota` writes `eval/results/poc-sota-bird-dev-R37-lexicon-grain.json`, including
  `per_case[].injectedLexicon` so a later reading can attribute a flip to a definition rather than to
  the block.
- The five adjudications above are `arm_pairs` entries over the same artefact; P1/P5 are the emitted
  `V64-lexicon-is-licensed` gate, which is blocking.
