---
id: R23-evidence
step: R23
opened: 2026-11-01
arms: none-noevidence,full-noevidence
sample: 350
gates: V1,V2,V3,V4,V5,V6,V7,V8,V12,V32,V44,V47
---

# R23 — the positive control, and the hint the benchmark already gives

## Why this file exists

Twenty-two iterations have varied seven axes on a distilled store — content, substrate, quantity,
position, framing, delivery order, and membership at a fixed dose — and every one of them has landed at
or below no memory. R22 closed the last one. The record's summary sentence is now *"showing any text costs
about two and a half points"*, published at exact p = 0.0091 over 1,050 arm-question cells.

**That sentence rests on an instrument that has never been shown to detect an effect.** Every number in
this record — including the anchors — was produced by a 350-question panel whose resolution is ±3.7pp on a
paired difference. Not one of the twenty-two iterations ran a manipulation the literature already agrees
about, of a size the panel could see. A lane that reports nulls without a positive control has not measured
a null; it has measured its own sensitivity and reported the result as a property of memory.

R23 is that control, and it costs no store, no retrieval and no distillation, because the manipulation is
already in the prompt.

## What is already in the prompt

`none` is not a bare prompt. It carries the schema, the question, and BIRD's per-question **`evidence`**
field: a sentence of curated, human-written, domain knowledge that the benchmark itself attaches to the
question. On this panel it is present on **350 of 350** questions, 25 to 468 characters, mean **142**,
median 135. Two of the 350:

```
league that had the most goals refers to MAX(SUM(home_team_goal, away_team_goal));
2016 season refers to season = '2015/2016';
```
```
Excellence rate = NumGE1500 / NumTstTakr;
Eligible free rates for students aged 5-17 = `Free Meal Count (Ages 5-17)` / `Enrollment (Ages 5-17)`
```

Every published number in this repository — every arm, every anchor, every "−2.57pp against `none`" — was
measured **on top of that block**. It has never been removed.

## What three independent records say removing it costs

| Source | System | With evidence | Without | Δ |
|---|---|---|---|---|
| BIRD (Li et al., NeurIPS 2023) | GPT-4 | 54.89 | 34.88 | **−20.01pp** |
| Companion Agents (arXiv 2601.08838), Table 1 | RSL-SQL / qwen-plus | 64.67 | 51.96 | −12.71pp |
| " | CHESS / qwen-plus | 62.14 | 47.78 | −14.36pp |
| " | DAIL-SQL / qwen-plus | 57.89 | 39.52 | −18.37pp |
| SEED (arXiv 2506.07423) | CHESS | — | — | −8.35 to −12.73pp |
| " | CodeS | — | — | −15.11 to −15.26pp |
| " | DAIL-SQL | — | — | −20.86pp |

Seven cells, four systems, three papers, two model families: **the effect is 8 to 21 points, and the mean
is 15.2.** Companion Agents also breaks it down by difficulty, and the gradient is the part that matters
for a panel: Simple −10.3 to −11.4, Moderate −15.5 to −18.9, Challenging −19.3 to −20.2. Evidence matters
more the harder the question.

This is the largest, most replicated effect available anywhere in the text-to-SQL literature, it requires
no infrastructure, and no arm in this record has ever been run without the block it removes.

## The design

A 2×2 factorial over the two blocks a `none` prompt can carry, with `none` and `full` already shipped:

| | + evidence | − evidence |
|---|---|---|
| **no pack** | `none` (shipped anchor) | `none-noevidence` |
| **+ pack** | `full` (shipped anchor) | `full-noevidence` |

1. **`none-noevidence`** — the shipped `none` prompt with `evidenceBlockOf('')` in place of the sentence,
   and nothing else changed. Planned through the same `call()` the anchor uses, with one argument
   different, which is the whole guarantee that the two cells differ by the block.
2. **`full-noevidence`** — the same pack `full` carries, on the prompt `none-noevidence` sends. Same
   recall, same 1,200-character budget, same position, same rendering.
3. **One implementation point.** `ARM_DROPS_EVIDENCE` in the lane is the only thing the ablation touches;
   `promptFor`, `retryPromptFor` and `anchorPromptFor` all render the block through `evidenceBlockOf`, so
   there is exactly one place a label could drift and exactly one place a check can look.
4. **`V47-evidence-ablated` is a new blocking gate, and it reads the prompts that were sent.** It counts,
   per arm, how many prompts contained the exact string `EVIDENCE_LABEL + "\n" + the row's own sentence`.
   It fails the run if a shipped arm missed a question that had one, if an ablated arm carried one anyway
   (an ablation that removed nothing is `none` under a second name — the failure this record has caught in
   a framing arm, a dose control and a verbatim checker), or if the ablated arm reached fewer questions
   than the arm it ablates (0 of 300 is a perfect ablation of a smaller experiment).
5. **`V3-parse-rate` and `V4-gold-executable` are the manipulation check.** A 20-point drop in accuracy
   with a 20-point drop in parse rate would mean the removal changed the *task* — a prompt with a dangling
   dependency reads differently — rather than the knowledge available. The registration therefore reads
   the main effect as a knowledge effect **only if the parse rate moves by less than 5pp**.
6. **No retry arms, no sampling arms, no store changes.** Four cells, one variable, 1,400 calls.

## Resolution, computed before the run

The audit's rule from R22 is applied here rather than discovered afterwards: **a confirmatory claim must
exceed `1.96 · sqrt(discordant) / n`**, and `discordant` is estimated from the effect the claim is about.

For a true effect of 10pp at n = 350, the flipped questions number ~35. The literature's asymmetry — every
system loses far more than it gains — puts the wrong→right arm of the 2×2 small, so **b = 40, c = 5,
discordant = 45** is the design point. That gives a paired standard error of `sqrt(45)/350 = 1.92pp` and a
half-width of **±3.8pp**. The smallest claim this design can carry at 80% power is therefore ~5.4pp, and
the smallest it can *report* with an interval that excludes zero when the truth is 10pp is ~8pp.

**The confirmatory claim is stated at ≥8pp**, which clears the design's own bar with 2.4 standard errors.
Anything smaller would repeat R22's error in the opposite direction: a claim the panel cannot see, answered
by a null that means nothing.

## Prediction

- **`none` − `none-noevidence` ≥ 8pp, and the point estimate is near 12pp.** This is the confirmatory
  claim. The interval spans 8 to 21 across seven published cells with a mean of 15.2; this record's model
  is stronger at reasoning than the 2023 GPT-4 baseline and `minidev` is a different slice, so the
  prediction is set at the low end of the literature rather than at its mean.
- **The effect is larger on harder questions.** The monotone gradient is reported by Companion Agents
  (Simple −10 to −11, Moderate −15 to −19, Challenging −19 to −20) and it is a prediction about the *shape*
  of the effect, not its size, so it is a second independent way for the run to be wrong. `difficulty` is
  in every case row already.
- **`full-noevidence` is not simply `none-noevidence`.** The pack costs 2 to 4 points wherever it is shown,
  and nothing in this design predicts that a smaller prompt removes that cost. This is a prediction of a
  *null* on a comparison already measured three times, included so that the run can contradict it.
- **The interaction is negative or null, and it is a secondary claim.** `(full − full-noevidence) −
  (none − none-noevidence) < 0` is what substitution looks like: a retrieved rule competes with a curated
  hint that already supplies the vocabulary and the value mapping, so removing the hint should hurt less
  where a pack is present. Its expected discordance is the union of four cells, so its interval is roughly
  twice as wide as the main effect's and **it is read only if the main effect clears 8pp**, with a bar of
  |DiD| ≥ 4pp and a bootstrap interval excluding zero. Anything else and it is reported as unresolved
  rather than as a sign.
- **Accuracy stays inside its historical range.** `none` has been 54.00% on this panel in every dispatch
  since R19. A `none` cell that moves by more than 3pp would say the endpoint or the dataset changed under
  the record, and the run would be reported as an environment change rather than as a measurement.

## Refutation

- **If `none` − `none-noevidence` is within ±1pp with an interval that excludes +1pp, the panel is the
  finding and every null in this record becomes unreadable.** A manipulation the literature prices at 8 to
  21 points, returning zero on 350 questions, means the instrument cannot see effects of that class, and
  the twenty-two iterations of "text does not help here" are statements about sensitivity rather than about
  memory. The next iteration then rebuilds the panel — more questions, or the full 1,534 — and no further
  arm is built until it can reproduce this effect. The registration commits to that ordering now, before
  the number exists.
- **If the ablation is above `none` by ≥2pp with an interval excluding −1pp, the record's baseline is
  poisoned.** Every published arm was measured on a prompt carrying a block that costs points, and the
  honest response is to re-anchor the entire line at `none-noevidence` rather than to compare arms against
  a baseline that is 2 to 20 points below its own ceiling.
- **If `V47-evidence-ablated` fails, the run is not read at all.** This is the clause R21 and R22 both
  carried and both needed: a validity gate that fails says the cells are not the cells, and reading the
  score anyway would be reading a number about something else.
- **If the parse rate moves by more than 5pp, the effect is not attributable to knowledge.** A prompt whose
  evidence block was half of what told the model which columns exist is a different task, and the run then
  measures task difficulty rather than available knowledge. The gate does not fail in that case — the
  reading does.
- **If the main effect clears 8pp and the interaction's interval excludes −4pp**, the substitution story is
  refuted: the pack and the hint are independent, the two-block competition this record has been telling
  itself for eight iterations does not exist, and the deficit has to be explained by something that is not
  a competition for attention.

## What this cannot answer

It cannot say whether a *retrieved* note would help on a question that arrives **without** a hint, because
that requires a task whose questions do not carry curated knowledge, and BIRD is not that task. What it can
do is separate the three readings that this record's twenty-two iterations have fused into one sentence:
that text cannot help on a task whose question already carries its schema and its evidence; that retrieved
text cannot help because it is written for a different question; and that our text cannot help because we
write it badly. Each of those predicts something different about this 2×2, and the first one predicts that
the whole line is closed by 20 points of evidence that we never thought to remove.

## Outcome

Dispatch `41223844474` (success, 1,758 calls, 8 retries, 0 timeouts, 0 call failures, twelve gates pass,
16 minutes, `config.prereg` = this file). Artefact `eval/results/poc-sota-bird-evidence.json`. 350
questions, 5 folds, 11 databases, minimum detectable effect 4.87pp.

| Cell | ACC | vs `none` |
|---|---|---|
| `none` | 54.57% (191/350) | — |
| `full` | 49.71% (174/350) | −4.86pp [−8.29, −1.43], p = 0.0076 |
| `full-noevidence` | 30.86% (108/350) | −23.71pp [−29.14, −18.57] |
| `none-noevidence` | 29.71% (104/350) | −24.86pp [−30.00, −19.71] |

| Contrast | Δ | 95% CI | gained / lost | p |
|---|---|---|---|---|
| evidence, no pack — `none` − `none-noevidence` | **+24.86pp** | [+19.71, +30.00] | 96 / 9 | < 0.0001 |
| evidence, with pack — `full` − `full-noevidence` | **+18.86pp** | [+14.00, +24.00] | 80 / 14 | < 0.0001 |
| pack, with evidence — `none` − `full` | +4.86pp | [+1.43, +8.29] | 27 / 10 | 0.0076 |
| pack, no evidence — `none-noevidence` − `full-noevidence` | **−1.14pp** | [−4.29, +2.00] | 13 / 17 | 0.5847 |
| interaction — (both evidence contrasts subtracted) | **−6.00pp** | [−10.57, −1.71] | 19 up / 37 down / 294 flat | — |

**The confirmatory claim is confirmed, and the panel under-predicted itself by more than half.** The
registered bar was ≥8pp with a point estimate near 12; the measurement is **+24.86pp**, 96 questions gained
against 9 lost, exact p below 1e-4, and the interval lies entirely above the bar's upper end. The first
positive control this record has ever run did not merely pass — it shows a panel that resolves an effect
three times larger than the one it was asked to see. **The panel-is-the-finding clause does not fire, and
the twenty-two nulls above it stay readable.**

**The prediction the run refuted is the interesting one.** The registration said `full-noevidence` would
still sit below `none-noevidence`, "because the pack's 2–4 point cost is not something a smaller prompt
removes". It does not: **the pack is 1.14pp *above* no memory once the hint is gone** (13 gained, 17 lost,
p = 0.5847) — the first cell in this record that is not negative, and the first evidence that the cost of
showing a note is not a property of the note.

**The interaction is the mechanism, and it fires.** `(full − full-noevidence) − (none − none-noevidence)` =
**−6.00pp**, bootstrap 95% CI [−10.57, −1.71], which excludes zero and clears the registered |DiD| ≥ 4pp
bar. A retrieved pack absorbs **6.00 of the hint's 24.86 points — 24.1%** — and the rest of the hint's value
is stuff the pack cannot supply. Read against the two pack contrasts, the substitution is exact and
one-directional: with the hint present the pack costs 4.86 points; with the hint absent it is worth 1.14
points. **The deficit this record has spent eight iterations on is a competition, not a content problem.**

**The difficulty prediction is neither confirmed nor refuted, and the panel cannot answer it.**
Moderate `n = 248` at +25.00pp [18.95, 31.05]; challenging `n = 102` at +24.51pp [14.71, 34.31]. The two
levels are 0.49pp apart, which is nothing, and **there are no simple questions on this panel at all** —
`poolOf` filters the easiest third out. The literature's gradient (Simple −10 to −11, Moderate −15 to −19,
Challenging −19 to −20) predicts a rise across three levels; this panel has two and they are flat. The
prediction was about shape and the panel has one data point plus a copy.

**The manipulation check passes without ambiguity.** Both ablated arms produced SQL on 350 of 350 prompts
(100%), against `full`'s parse rate of 100% and execution rate of 99.43%. The 24.86pp is knowledge that
left the prompt, not coherence.

**Instrument readings.** `V47-evidence-ablated`: `none 350/350, full 350/350, none-noevidence 0/350
expected none, full-noevidence 0/350 expected none`. `V12` 626/626 injected rules carried a condition.
`V32` 632 corrections from 1,400 learn rows, 0 unanswered, 4 distillation failures (0.3%). `V44`
168 item(s) with no domain, 168 arrived unscoped, 0 widened — the fifth dispatch running.

**Two anchors moved, and that is a reading of its own.** `none` came in at 54.57% against 54.00% in every
dispatch since R19 (+0.57pp, 2 questions), and `full` at 49.71% against R22's 51.43% (−1.72pp, 6 questions).
Neither is a treatment: the store is rebuilt per dispatch and this one held 632 corrections and 1.79 items
per question against R22's 640 and 1.82. **Cross-dispatch cells on this lane carry one to two points of
store variance**, which is larger than several deltas this record has published; every claim in this file is
within-dispatch and unaffected.

## What this leaves

The record's central negative now has a mechanism instead of a mystery, and the mechanism says the opposite
of what eight iterations assumed. A note written for one question does not cost points because it is
irrelevant, badly written, wrongly scoped, too long, too raw or badly framed — all six of those were varied
and all six came back null. It costs points **because it competes with curated, per-question knowledge for
the same job, and loses**, and when that competitor is removed the note stops costing anything and starts
paying a little.

Three consequences, in order of how much they change the plan:

1. **The product rule is now conditional rather than absolute.** R22 concluded "abstention by default". This
   run says abstention is correct **where the question already arrives with curated knowledge** — the
   common case in an annotated enterprise warehouse — and wrong where it does not. The condition is
   testable per deployment: does the incoming question carry a hint? That is a switch, not a policy
   research programme.
2. **4.6% is the number the memory line has to beat.** The pack supplies 1.14 of the 24.86 points a curated
   hint supplies. Nothing in this record has ever measured a memory's ceiling against a known-good item
   before, because there was never a known-good item in the prompt to measure against. There is now.
3. **Most of the 24.86pp is not memory's job.** This lane's `none` prompt is thin: no examples, no
   chain-of-thought, no schema linking, no value index. Systems that report −12.7 to −18.4 on the same
   ablation (Companion Agents' RSL-SQL and CHESS rows) recover part of that dependence by extracting the
   missing information *from the database* rather than from a hint. **The gap this record has been trying
   to close with memory may be a schema-linking and value-indexing gap**, and that is measurable with
   machinery the lane already has: `valuesDdl` annotates the schema with column contents, and the `values`
   arm has only ever been run on the *unablated* prompt, where the hint was doing that job for it.

The next registration is therefore a 2×2 of evidence {present, absent} × value annotation {present, absent}:
how much of the hint's 24.86 points can be recovered from the database alone, and does the answer survive
removing the competitor. It is cheap, it uses an arm that already exists, and it is the first experiment in
this line whose success criterion is "recover a measured fraction of a measured effect" rather than "beat
no memory".
