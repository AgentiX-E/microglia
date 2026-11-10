---
id: R73-written-reader
step: R73
opened: 2026-11-10
arms: sample-5-first,sample-5-assert
sample: 350
gates: V18,V19,V69
---

# R73 — the writer is the price, and the reader is arithmetic

**Registered** 2026-11-10, before the reading exists. It is written the same day as R71's outcome and
its numbers are R71's, because R71's branch says what the next experiment is and a branch that is only
described in prose is a plan rather than a prediction.

## What R71 established, in one sentence

Two deterministic readers of a candidate's content — the share of the question's words its columns
mention, and the share of the question's literals its query writes — sit at **AUC 0.514 and 0.509**
with question-clustered intervals that fail to exclude 0.5, and on the questions where they could
possibly discriminate they are also constant (`literal-match` varies on 8 of 350 questions,
`column-mention` on 107). Reading a candidate for free does not work, twice, on two families of
signal.

## The claim this file prices

CHESS's selection step does not read the result; it **writes a question-specific assertion and then
executes it**. "The answer must have a column named `County`." "The answer's `T1` must be one of the
values the question names." The assertion is authored by a model once per question and is then
*arithmetic over the candidate's result* — no second model call per candidate.

That distinction is the whole registration, and R71 is the reason it is legible. The free reader
failed because the property it read (words in column names, literals in the query) is shared by every
draw of a question: where it applies, it applies to all five candidates and ranks nothing. A written
assertion is *chosen for this question against these results* — it can distinguish, because it was
written while looking at what the results are.

Cost: **one call per question**, 350 calls for the Mini-Dev readout, about **$0.03** off-peak. The
candidate set is R70's, already paid for; the assertions are executed against the pool's own SQLite
files. This is the cheapest decisive experiment this lane has ever registered, and it is cheap only
because the previous one was free.

## The design, exactly

- **Population:** R70's pool — 350 questions × 5 draws, 1,750 candidates, every candidate carrying its
  query and its result columns. Same `V18`/`V19` reconciliation as every pool reading.
- **The writer:** one call per question, given the question, the schema and the **candidate result
  signatures** (columns and shapes, never the SQL and never the gold), producing **three assertions**
  in a fixed grammar — `column` (a named column must be present), `value` (a literal the question
  states must appear in the result), `rows` (the result's row count). The grammar is deliberately tiny
  and the model is not asked for SQL, so what it writes is checkable by code and not by judgement.
- **The reader (free, deterministic):** a candidate scores the number of its assertions it satisfies;
  ties break to the earlier draw, exactly as every other selector in this lane. Satisfying an
  assertion is decided by `column` presence, literal containment in the result's own values, and row
  count, with no model in the loop.
- **The arm:** `sample-5-assert`, scored against **`sample-5-first`** — the draw it would have taken
  had it decided nothing — on all 350 questions and on the eligible population, both reported. R69's
  lesson is that the two denominators can disagree in sign, so neither alone is the reading.
- **Where it runs:** a dispatch on `minidev`, not offline, and the amendment below says why the
  first version of this line was wrong.

## Prediction

- **The written reader carries real signal:** AUC **0.60–0.75**, interval excluding 0.5, and a
  top-pick gain over `sample-5-first` of **+3…+9pp** on the eligible population — below the oracle
  ceiling's +10.00pp, which is what a selector is allowed to be.
- **It beats the free readers by construction, and by how much is the question:** at least +2pp of AUC
  over `content-mean` (0.523). If it does not, the mechanism is not "the assertion was written" but
  "the assertion was executed", and the writer is not the price.
- **Assertion satisfaction is mostly vacuous on the collapsing questions:** 205 of 350 questions have
  a single distinct result, so the arm cannot move them; the gain has to come from the 145 where a
  choice existed, and the whole-350 gain will be roughly 40% of the eligible one.
- **No gate is being written here.** The lane has spent two iterations on gates over memory; this
  experiment asks whether a *selector* can read, and a null is a finding about reading rather than
  about routing.

## Refutation

The branches are ordered and partition on the pair (AUC, top-pick gain over `sample-5-first`).

- **Void** — fewer than 300 questions produced three parseable assertions, or the arm's eligible
  population is under 100 questions, or a re-read from cache disagrees with the first read. Then the
  writer was measured on the questions it found easy and the number describes neither.
- **Reading is the missing lever** — the interval excludes 0.5 **and** the eligible gain is at least
  +3pp. Then the 8.2 points between DAIL-SQL+SC and CHESS+SC are substantially a *reading* effect, the
  arm becomes the lane's default selector over draws, and the next registration prices the writer's
  own input (schema-only against schema-plus-results) to find what the assertion needed to know.
- **Executing is not reading** — the interval excludes 0.5 but the gain is under +3pp. Then the writer
  produces something real and small, the free-reader conclusion stands with a price attached, and the
  next registration is the one R66 opened: evidence shown **after** a failure, where the model can see
  what went wrong instead of what the answer should look like.
- **The writer is not the price** — the interval straddles 0.5. Then no per-question reader — free,
  cheap, or written — recovers the gap on this corpus, the selection line closes, and the remaining
  programme is R72's routing question plus the retry position, with no selector left to try.

The order matters: a number that lands between the bars is described as measured and adopts no line.

## What this file does not do

It does not run on `train`, and it does not change a default. R72 already holds the registered claim on
the lane's memory behaviour, and two open experiments on one population is how a record ends up with a
number it cannot attribute. R73 reads R70's pool and nothing else.

## Amendment 1 — the pool is bought with the writer, and the control is bought with the treatment

**Written before dispatch.** Three things changed while the arm was implemented, and each of them is a
fact about the mechanism rather than a preference.

**The control is in the header.** The arm's baseline is `sample-5-first` — the draw it would have taken
had it decided nothing — and a header that names only the treatment is a header that lets the dispatch
omit the control. R66 taught this the expensive way: its header named `retry-values` while its dispatch
bought `retry-blank` beside it, and the arm-check rule was loosened to accommodate the file rather than
the file corrected. The rule is equality in both directions now, so the header names both:
`sample-5-first,sample-5-assert`.

**The writer runs inside the dispatch, not beside it.** The first version of this file said offline:
read R70's pool, write 350 assertions, score them. That works, and it is what `pnpm eval:assertion`
does — but it produces a *derived* file, and the promise this project keeps making about a pool is
that the reading is a computation over the artefact the run wrote. An assertion written against a
pool re-read from another day's file is an assertion about a schema and a set of draws that are only
believed to be the same ones. The writer therefore runs in the lane, one call per question, and lands
in the same `per_case` entry as the candidates it is scored against.

**The cache makes the replay free, not the first run.** `SOTA_ASSERTION_CACHE` keys a writer's reply on
the full prompt, so a second dispatch of the same split pays nothing for the assertions and measures the
same ones — the distillation cache's argument, and the reason a re-run can be a replication rather
than a second experiment. The first run pays 350 calls.

| item | calls | note |
| --- | --- | --- |
| the writer | 350 | one per question, `learn_sample` 0 |
| five draws × 350 | 1,750 | the pool the arm selects from |
| two answers × 350 | 700 | `none` and `full` are always measured |
| **total** | **≈2,800** | ≈$0.23 off-peak, ≈25 minutes |

**The reading is still offline.** `pnpm eval:assertion` takes the artefact and prints the four signals
— `assertion-column`, `assertion-value`, `assertion-rows` and their sum — with zero calls. The three
kinds are reported separately because the arm is a claim about which sentence carries the ranking, and
a combined number alone could not say that a `rows:` assertion was a shape signal this lane already
knows is inert.
