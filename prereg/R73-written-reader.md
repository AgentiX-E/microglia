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

## Amendment 2 — the writer works, and the budget it was given was a guess that the first fold refuted

Run `42834602173`, 2026-11-10 14:29 UTC, stopped after its first fold at **851 calls** by the budget
forecast: `the run needs about 4596 calls, the cap is 4000 (short by 596)`. No artefact. The mechanism
is not what failed:

```
[sota] fold 1/5 assertions 70/70 calls=851 failed=0
[sota] fold 1/5 wrote assertions for 70/70 question(s), 70 written and 0 reused from the cache
```

**Seventy questions, seventy replies, zero failures, in fifteen seconds.** One call per question as
designed, and every reply parsed into at least one assertion — which is the number this amendment
exists to record, because a writer that answered nothing on half the questions would have made the arm
a measurement of obedience.

**What was wrong was the estimate.** The table in Amendment 1 said ≈2,800 calls for five folds of
seventy questions and it was 4,596. The fold decomposes into 70 writer calls, 350 draws, 140 answer
calls, 140 adjudications, 139 repairs and about 280 distillation calls — and the distillation is the
line nobody priced: `learn_sample` 0 does not mean no distillation, it means the lane's default, which
on a 280-question learning set is 280 calls of its own. Amendment 1's argument that "the pool is bought
with the writer" was right and its arithmetic missed a term.

**Re-dispatch at cap 5,600** (the forecast plus 22%), same registration, same arms, same split. The
lesson is the one R72's Outcome 0 taught at twenty times the price: a budget is a forecast and a
forecast that has never run is a guess, so the fold's own measurement is the number to dispatch on.

## Outcome — four questions moved, and a zero-width interval says why the other 111 could not

Run `42836018132`, 2026-11-10 14:37 UTC, completed in 24 minutes. `minidev`, 350 questions, arms
`sample-5-first,sample-5-assert` exactly as the header names them. **3,165 calls** against the 5,600 cap
Amendment 2 bought — the forecast was 4,596 and the run needed 69% of it, so the 22% margin was still
an over-estimate, which is the third time in three registrations that the estimate was the moving part.
350 writer replies, zero failures, all cached under `assertions-deepseek-flash`.

**The arms.**

| arm | accuracy | delta vs none | 95% CI | p | rules/question |
| --- | --- | --- | --- | --- | --- |
| `none` | 52.57% | — | — | — | 0 |
| `full` | 53.43% | +0.86pp | [−2.00, 3.71] | 0.7011 | 1.83 |
| `sample-5-first` | 51.14% | −1.43pp | [−4.00, 1.14] | 0.4049 | 0.00 |
| `sample-5-assert` | 52.29% | −0.29pp | [−2.57, 2.00] | 1.0000 | 0.00 |

The arm against its own control: **+1.15pp** (52.29% − 51.14%), `[−0.86, 3.14]`. Four questions.

**The four signals, and the two that are not signals.**

| signal | AUC | 95% CI | top pick | eligible |
| --- | --- | --- | --- | --- |
| `assertion-column` | 0.544 | [0.481, 0.604] | 28.70% | 115 |
| `assertion-value` | **0.500** | **[0.500, 0.500]** | 26.09% | 115 |
| `assertion-rows` | 0.562 | [0.494, 0.626] | 26.96% | 115 |
| `assertion-hits` (sum) | 0.581 | [0.492, 0.667] | 29.57% | 115 |

**The branch.** *The writer is not the price*: every interval straddles 0.5. The selection line does not
close on a mechanism question but on a **population** question, and the file's own prediction is what
fails first — 0.60–0.75 was registered, 0.581 is the highest reading, and no signal reaches the lower
bar. Within the registered grammar the reading is measured, it is small, and it adopts no line.

**Four things the table says that the branch sentence does not.**

**One: `assertion-value` at exactly 0.500 with a zero-width interval is a diagnosis, not a null.** The
interval is `[0.500, 0.500]` because the signal does not vary on any of the 115 eligible questions: a
`value:` assertion names a literal the question states, and all five draws of a question either return
that literal or none of them do. This is R71's `literal-match` phenomenon one step further — R71 varied
on 8 of 350 questions, this varies on none of 115. **A reader cannot rank candidates on a property the
candidates agree about**, and the width of the interval is again the tell rather than the noise.

**Two: the strongest single kind is the one the registration pre-dismissed.** The file argued that a
`rows:` assertion is "a shape signal this lane already knows is inert" and expected `column:` to carry
the claim. Measured: `rows:` 0.562, `column:` 0.544. The prior was inverted. It is worth one sentence
of humility in a lane that has now priced three readers: the shape signals keep being weaker in theory
than in measurement, which is what `prior-shape` was fitted to and what the sum exploits.

**Three: the top-pick number is the only reading above the registered floor, and it is four questions.**
`assertion-hits` picks the correct draw on 29.57% of eligible questions against `sample-5-first`'s
26.09% — **+3.48pp**, above the +3pp the branch names. Four questions out of 115, on a signal whose AUC
interval is `[0.492, 0.667]`. The registration required the interval and the gain *together*, precisely
so a four-question gain on a 115-question population could not be read as a lever, and that condition is
doing the work it was written for.

**Four: the ceiling was the population, and it was registered as 145 and measured 115.** The file
predicted 205 of 350 questions would collapse to a single distinct result; 235 did. The eligible
population — the only one where a selector can move anything — is **32.9%** of the split, one third of
what R70 counted as a disagreement pool. A 115-question population with 252 pairs detects an AUC of about
0.59 and nothing smaller, so this run's *effectiveness* is bounded by its *size*: it excludes a strong
reading and cannot exclude a weak one.

**What is settled.** The claim "writing an assertion per question recovers the CHESS gap" is not
supported at the strength the file registered, and the mechanism is not refuted either — it is
underpowered by construction. The lane's next money goes to size rather than to a new mechanism: the
same writer, the same three kinds, on **BIRD dev's full 1,534 questions** instead of 350, which turns
115 eligible into about 500 and moves the detection floor from ~0.59 to ~0.56 for roughly one dollar.
