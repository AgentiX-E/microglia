---
id: R82-backbone-upward
step: R82
opened: 2026-11-11
arms: sample-5-first,sample-5-assert
sample: 350
backbone: deepseek-v4-pro
gates: V1,V2,V3,V4,V5,V6,V7,V8,V12,V32,V44,V48,V51
---

# R82 — the same scaffold on the stronger model, which is the only lever R80 left standing

**Registered** 2026-11-11, undispatched. One variable moves: the backbone.

## Why this and not the fourth prompt

R80 read a written selector at 1,534 questions and found the first significant result this line has:
`sample-5-assert − sample-5-first` = **+1.37pp [0.52, 2.22], p = 0.0025**, a ceiling share of
**0.19 [0.08, 0.29]** — the first share in the record whose interval excludes zero. The file then wrote
down a next step, and the next step was **wrong**: it invited a decomposed candidate generator, and
iteration 107 had already bought four different generation procedures against one pool and found the
union ceiling `+8.57pp` over **1.557** distinct answers per question — against 1.46 for five draws from a
single prompt — with `gen-plan` at −5.43pp (p = 0.004) and `gen-decompose` at −3.14pp. A second procedure
does not make a wider pool, and the record had already said so. R80's Outcome was rewritten to point here
instead, and that correction is the reason this file exists.

So the remaining variable is not the scaffold's shape. It is **the model the scaffold holds**. Everything
this lane measured about how much breadth buys is a statement about `deepseek-flash`:

| reading | value | source |
| --- | --- | --- |
| five draws rescue, as a share of the failures | **18.0%** at a 51% baseline, **20.2%** at 28% | R67 / R68 |
| selector's share of that ceiling | **0.13 [−0.27, 0.40]** vs **0.51 [0.33, 0.67]** | R67 / R68 |
| written reader's share, 1,534 questions | **0.19 [0.08, 0.29]** | R80 |

Two of those three rows belong to backbones 23 points apart in accuracy, and the third belongs to the
stronger one. All three were paid for on **≤ 1,534 questions of one split** and none of them was paid for
on a model stronger than the one this lane ships. The question this file registers is the one the third
row cannot answer: **does the memory scaffold's value survive a better model, or was it compensation for a
weak one?**

## The instrument gap this registration found, and what closed it

The experiment could not be dispatched. `backbone` accepted a `zhipu:`-prefixed id and nothing else, so the
one swap that needs no new credential — the same host, the same key, the model beside the current one —
had to go through the repository variable `SOTA_MODEL`, which is the repository-wide mutation R68 closed
and the reason two backbones could never be run side by side.

Three things closed it, and each one is a defect that existed before this file did:

1. **The vocabulary.** `backbone` now accepts a bare model id on the default host, and refuses an unknown
   `provider:` prefix explicitly rather than swallowing it. The header's own `backbone:` field is the
   default when the dispatch names none, which is the same arrangement `arms` and `sample` already have —
   and an explicit dispatch value still wins, with the lane refusing a disagreement against the header,
   so the two representations cannot diverge in silence.
2. **The catalogue.** A new step asks the host what it serves before the first model call, and refuses a
   model the host does not list. The lane's own failure mode for a wrong id is a `4xx` per prompt,
   classified as a refusal, eight refusals tripping the breaker, and an artefact reporting that the
   endpoint stopped answering — twenty minutes and about a dollar on a host that answered every time. The
   verdict has three values and `unlistable` **does not veto**: a host may serve chat completions and no
   catalogue, and a check that cannot run must not refuse a run.
3. **The price.** The rate card held one row and an `appliesTo` list that named one model, so a run on the
   stronger model would have been billed at the weaker one's rates — **4.4× under on input and 3.3× under
   on output** — with a note calling itself an approximation. A note does not turn a four-fold error into
   a price. The card now holds one row per model, and the artefact's `usage.pricing` says
   `matches: true` when the row is the model's own.

## The design, exactly

- **350 questions, offset 0, five folds** — R67's and R68's own cell, so the three rows are one table and
  both existing rows are paid for. No new population: a scale ladder that moved the questions and the model
  would vary two things and could attribute neither.
- **Arms: `sample-5-first` and `sample-5-assert`**, plus the two the lane always buys. `none` is the
  no-memory baseline, `full` is one deterministic draw with the pack, `sample-5-first` is the honest
  five-draw baseline, and `sample-5-assert` is the written reader R80 found significant. `sample-5-exec`
  is deliberately **not** bought: it already has a row on both backbones, and re-buying it would spend
  a third of the budget on a number the file is not asking about.
- **`backbone: deepseek-v4-pro`** is in the header, and the lane now refuses a dispatch whose `SOTA_MODEL`
  disagrees with it. R82's claim is that one variable moved, and a claim of that shape cannot be checked
  from an artefact that does not know which model produced it.
- **`not_before: 10:00`** on the dispatch: the stronger model's input rate is 4.4× the current one's, and
  the band is the only lever on the bill that costs nothing.
- **Budget**: R68 bought 350 questions and 3,404 calls for three sample arms; two sample arms share their
  five draws, so this is ≈ **3,100 calls**. The cap is 3,600 and the ceiling 4,200, because a cap nobody
  can approach tells the in-run forecast nothing.

## Prediction

- **`sample-5-first` beats R67's 50.86%**, and by enough to be a different experiment: **57–63%** on the
  same 350 questions, paired per question against R67's artefact, with an interval that excludes zero. If
  the stronger model is not stronger on this split, nothing below can be read.
- **The ceiling does not widen much**: `sample-5-oracle − sample-5-first` at **+5…+12pp** against R67's
  8.86pp, because five draws rescue about a fifth of the failures on both backbones measured so far and
  this file expects that ratio to hold at a third one.
- **The written reader keeps its share and loses its points**: `sample-5-assert − sample-5-first` at
  **+0.5…+3.0pp**, and a ceiling share of **at least 0.10**. The prediction that makes this worth its cost
  is the *ratio*: R68 showed a stronger baseline captures a smaller share of its own ceiling, so a reader
  that holds its share on a stronger model is a mechanism, and one that only held its points was reading
  the baseline.
- **The bill is the strong model's bill**: `usage.pricing.matches` is `true`, `priced_as` is
  `deepseek-v4-pro`, and the off-peak total lands **$1.80–$2.80**.
- **The instrument**: the catalogue probe says `listed`; the parse rate is **≥ 95%**; the answer rate on
  `none` is **≥ 90%**. A model too strong to answer in this lane's output format would be a formatting
  result wearing a capability costume.

## Refutation

The branches **partition** the space, are ordered, and the first one whose conditions hold names the
outcome (Rule 12).

- **Void** — the probe says `absent`, or the parse rate is under 95%, or `sample-5-first` lands below 45%.
  Then no stronger baseline was bought, the registration produced no estimate about a stronger model, and
  the next attempt is a different model rather than a reinterpretation of this one.
- **Ceiling-bound** — the ceiling is at least 1.5× R67's 8.86pp *and* the reader's share stays under 0.10.
  Then a better model buys failures rather than answers, breadth is again the binding constraint, and the
  next registration goes to width or decomposition — the same place R68's `Baseline-bound` branch sent the
  record, which would make that branch's advice true in both directions and therefore uninformative.
- **Reader-bound** — `assert − first` is at least +3pp with a share of 0.19 or more. Then the written
  reader's value scales with the baseline rather than tracking it, it becomes the product's default
  selection, and every future comparison against a published pipeline is quoted as a share of ceiling
  rather than in points.
- **Flat** — `sample-5-first` rises at least 6pp and `assert − first` collapses below +0.5pp. Then the
  memory scaffold was compensating for a weak model: its value is a function of the failure population,
  the mechanism is real but bounded, and the honest product claim is that memory pays on a cheap backbone
  and not on an expensive one — which is a pricing decision rather than an accuracy claim.

## What this file does not do

It does not compare against a published pipeline. `deepseek-v4-pro` is this host's stronger model and no
published BIRD row uses it; the axis here is *within one host and one scaffold*, which is the only axis
where a single variable moves.

It does not re-open the pool question. R69 saturated width at k = 10 (`sample-10-exec` came in *below* the
first draw), iteration 107 priced four generation procedures against one pool, and R80 priced the reading
of that pool. If a branch above sends the record back to width, that branch is evidence the earlier
readings do not travel, and it should be read as a contradiction to be explained rather than a licence to
re-buy them.

It does not claim the two backbones' numbers are comparable across splits. Each row states its own split
and its own `n`, and the paired comparisons are per question between artefacts that scored the same
questions.
