---
id: R84-thinking-budget
step: R84
opened: 2026-11-11
arms: sample-5-first
sample: 350
split: minidev
backbone: deepseek-v4-pro
gates: V1,V2,V3,V4,V5,V6,V7,V8,V12,V32,V44,V48,V51
---

# R84 — the strong model was given no reasoning at all, which is the only throttle R82 left standing

**Registered** 2026-11-11, undispatched. One variable moves: the thinking switch.

## What R82 established, and the one explanation it did not test

R82 compared `deepseek-v4-pro` against `deepseek-flash` on the same 350 questions of `minidev`, the same
five folds, the same decoding budget, and the same prompts. The strong model lost, paired per question:

| same prompt, same budget, same 350 questions | both | flash only | pro only | neither | pro − flash | exact McNemar |
| --- | --- | --- | --- | --- | --- | --- |
| `none` | 149 | 34 | 13 | 154 | **−6.00pp** | **p = 0.0031** |
| first draw of five | 140 | 38 | 19 | 153 | −5.43pp | p = 0.0163 |

Three explanations were ruled out from the paid artefact. **Truncation** is not one of them: pro spent 276,047
completion tokens over 3,346 calls — 82.5 per call against a `max_completion_tokens` of 700 — and truncated 48
of 7,485 statements (0.64%) against flash's 49 of 7,270 (0.67%), with **zero dangling SQL** on the `none` arm of
either run. **Execution** is not one of them: the pool's failure rate is 2.2% against 0.4%, and none of the 47
discordant questions is discordant because a statement failed to run. **Formatting** explains a fifth of it:
of the 34 questions pro lost, 7 changed the result's column count and 4 changed its row set, while 23 produced
the same shape with different values — the query is wrong, not dressed differently.

What is left is the one thing `thinking: off` actually does: it removes **every** reasoning token
(`reasoning_tokens: 0` in both runs). A model built to think was judged on the one regime it was not built
for, and nothing in the record says whether that is the cause. This file buys that answer for about a dollar.

## The instrument, which already exists and already has a price

`SOTA_THINKING=on` sets `answerBudget(700, 'on') = 700 + 1,200`, and `THINKING_HEADROOM` exists precisely
because the switch without the budget cost a run: an earlier cell spent **1,354,007 reasoning tokens out of
1,423,622 completion tokens (95%)** across 1,989 replies, left about nineteen tokens for the answer, and failed
its own validity gate at `V3-parse-rate: 51.43%`. That measurement is also this file's cost model — 680
reasoning tokens a reply, covered four times over by the 1,200-token headroom — and it names the failure this
cell must watch for: a parse rate that collapses because the model thinks through the answer budget.

No code is required. The switch, the headroom, the token accounting in `usage` and the gate that would catch the
old failure all ship.

## The design, exactly

- **The same 350 questions, offset 0, five folds, `split: minidev`, `seed: 7`, `learn_sample` at the lane's
  default** — R82's cell, question for question, so the contrast is paired per question against a run that is
  already paid for. A different population would make this a second experiment rather than a comparison.
- **One arm: `sample-5-first`.** It buys `none` as the baseline, and `none` is the arm this file reads: same
  prompt, no memory, one answer, and the only difference from R82's `none` is the switch. The five-draw arm is
  the record's standard honest baseline and comes with it; it is not analysed here.
- **`backbone: deepseek-v4-pro` in the header**, so the lane refuses a `SOTA_MODEL` that disagrees. The
  catalogue probe and the rate card from §173.56–§173.58 apply unchanged, and `usage.pricing.matches` must be
  `true` for the bill to mean anything.
- **Budget**: 350 answers plus the fold distiller's 1,400 calls, with output now carrying reasoning tokens. The
  cap is **2,600 calls** and the ceiling **3,200**; the expected bill is **$1.00–$1.80** at off-peak rates
  ($0.66/M input missed, $0.022/M cached, $1.98/M output).

## Prediction

- **The switch takes and the lane survives it**: `usage.reasoning_tokens > 0`, parse rate **≥ 95%**, and fewer
  than 8% of statements truncated at the deadline. If the parse rate collapses to the historic 51.43%, the
  headroom is not enough for this model and this file produced a formatting result instead of a capability one.
- **`none` moves up, and not by six points**: **+1…+5pp** over R82's 46.29%, which would leave pro behind flash's
  52.57% and close the backbone question in the direction the cost argument already points.
- **The bill stays under two dollars**, and `priced_as` stays `deepseek-v4-pro`.

## Refutation

The branches are ordered and the first whose conditions hold names the outcome (Rule 12). They are checked for
**totality** before dispatch, which is the defect §173.71 found in R82's own set: the three reading branches
partition the contrast line (−2pp … +6pp … +∞) with no gap and no overlap, and `Void` is a validity gate over
the whole run rather than a fourth region of that line.

- **Void** — `reasoning_tokens` is 0 (the switch did not take), or the parse rate is under 95%, or more than 8%
  of statements are truncated. Then the regime was not bought: the knob does not do what its name says on this
  model, the record says so, and the backbone question stays open with `thinking: off` named as its boundary.
- **Throttled** — `none` at `thinking: on` is **at least +6pp** over R82's `none`, paired per question. That is
  above this cell's ~5pp floor and it means the deficit was permission, not capability. Then the 2 × 2 is
  earned — flash at the same budget, so the attribution is not a second one-variable claim riding on a first —
  and it is the next registration with a predicted bill of about $3.
- **Unexplained** — the contrast lands between **−2pp and +6pp**, i.e. inside the floor. Then this cell bought a
  null, the reversal stands unexplained, and the model axis closes on evidence rather than on preference: the
  record stops proposing backbones, quotes the cheap one, and every future comparison is made at
  `thinking: off` with that boundary stated.
- **Worse** — the contrast is **at or below −2pp**. Then reasoning actively harms this lane's output at this
  budget — a second instance of the 700-token failure, now with headroom and on a model that asks for it — and
  the record treats the switch as harmful rather than neutral, which is a stronger statement than R82 could make.

## What this file does not do

It does not re-open the memory line. R81 closed it with four mechanisms measured null on one population, and
this cell buys no memory arm beyond the baseline `none`.

It does not compare against a published pipeline, and it does not claim a stronger model would not win at a
larger budget: `SOTA_THINKING` is a switch, not a scaling study, and one budget point cannot describe a curve.

It does not spend the 2 × 2 up front. A sequential design that escalates only on a +6pp move is cheap and
honest; escalating on a p-value is how a peek becomes a claim, which is why the trigger here is a magnitude
fixed before the run and not a significance test read after it.
