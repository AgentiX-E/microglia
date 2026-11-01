---
id: R26-channels
step: R26
opened: 2026-11-01
arms: values,linked
sample: 1534
gates: V1,V2,V3,V4,V5,V6,V7,V8,V12,V32,V44,V48,V51
---

# R26 — the two channels that change what the model knows

## Why this file exists

Twenty-five iterations have varied the *memory* along nine axes and measured one position: a note injected
into the prompt before the question. Every arm landed at or inside the control, the last two with an
instrument that resolves 2.01pp. R25 closed that line by its own registered clause, and the sentence that
closes it is not "the mechanism is small" but "the item this store produces has nothing to say":

| quantity | reading | what it bounds |
|---|---|---|
| oracle ceiling, drop every net-harmful item | **+2.35pp** | the best a perfect selector can do with *these* items |
| oracle ceiling, keep the pack only where it helped | **+4.17pp** | the best a perfect *oracle* can do, including selection it cannot know |
| minimum detectable effect, 1,534 questions | **2.01pp** | what this split can see at all |

A ceiling of 2.35pp is a statement about **content**, not about noise. Buying resolution would only price it
more precisely. The question this iteration registers is therefore the one the record has never asked in the
right place: **the two arms that change what the model knows, rather than what it is told about its own past
mistakes.**

Both already exist in the lane and both were measured once, on 350 questions, with too few decisive outcomes
to conclude anything:

| arm | what it changes | first reading (n=350) | decisive | verdict recorded then |
|---|---|---|---|---|
| `values` | the DDL, annotated with the values each column holds | **+0.29pp** | 12 gained / 11 lost | "indistinguishable from zero" |
| `linked` | the schema, pruned to the tables the question names | **−7.43pp** | 7 gained / 33 lost | "resolved harm" |

Those two numbers are this record's weakest claims and its strongest, sitting in the same table. The value
channel was compared on **23** decisive questions and the pruning channel on **40**; at 350 questions the
split's floor is 4.87pp, so the first reading could not have resolved anything below it and the second is a
harm four times the floor. **One of them is a null that was never powered and the other is a harm that has
never been replicated**, and both are the direct analogue of the ablations competitors publish: CHESS prices
column selection at **14.36pp** and RSL-SQL prices schema linking at **12.71pp**, on this same split. Our own
gap to those systems is 24.86pp on the unablated prompt, and the arithmetic-attractive explanation has always
been that the difference is the schema-and-value channel. That explanation has never been tested where it can
be seen.

## The design

Four arms, one store, one split, one dispatch. `none` and `full` run because `full` is this record's anchor —
it has now been measured on three stores and its interval against `none` is the stability check that a
fourth store must reproduce — and because the two channel arms are compared against `none`, not against it.

| arm | prompt | what it certifies |
|---|---|---|
| `none` | schema + question + evidence | the control, unchanged from R24/R25 |
| `values` | the same, with the DDL annotated by the values each column holds | `V51` reads ≥95% of prompts rewritten |
| `linked` | the same, with the schema pruned to the tables the question names | `V51` reads ≥1% of prompts rewritten |
| `full` | the same as `none`, plus the store's pack | anchor: `full − none` must land inside [−2, +2] |

## The gate this iteration adds

`V51-channel-applied` is blocking, and it exists because this lane has already published a channel result
without checking which arm it had. A value annotator that annotated no column and a pruner that pruned no
table are both `none` under another name, and the difference either reports is a difference of nothing — a
clean null that reads as a finding. The two kinds need different floors and the kind travels with the count
rather than being inferred from the arm's name: annotation is unconditional (95%), pruning is not (1%). The
gate prints the share either way, so a pruner that fired on 41 of 1,534 questions is visible as such instead
of being thresholded into a pass.

## Prediction

- **`linked − none ≤ −2pp`, interval excluding zero.** A replication, not a discovery: the earlier reading
   is 4.9 times minidev's floor, and if pruning destroys evidence links the harm is a property of the prompt
   rather than of a store.
- **`values − none` inside [−2, +2] with a half-width of at most 1.6pp.** The earlier +0.29pp is 23
   decisive questions and cannot be quoted; the prediction is a bound, not a sign, because a value annotation
   adds tokens and this record has measured token additions at −2 to −4pp before.
- **`full − none` inside [−2, +2].** The anchor's third store. R24 read −0.07pp, R25 −0.07pp, R23-family
   stores spanned ±1.7pp; a fourth store outside [−2, +2] would mean the anchor is not an anchor.
- **`V51` passes on its first run**, with `values` at 100% and `linked` between 1% and 40%.

## Refutation

- **If `values − none` has an interval containing zero and a half-width of at most 1.6pp, the value channel
  is closed as a prompt annotation.** The consequence is specific and it is the one that matters to the
  programme: the competitors' 14.36pp and 12.71pp cannot then be attributed to putting column values and a
  pruned schema in the prompt, and the difference has to live in candidate generation, selection or
  fine-tuning instead. That would close the last explanation this record has for its own 24.86pp gap.
- **If `linked − none ≥ −2pp`, R21's −7.43pp does not replicate.** The pruning story is then a single-store
  artefact, the arithmetically attractive "the pruner cut the table the evidence pointed at" reading is
  withdrawn, and the record carries one more case of a harm that was a store rather than a mechanism.
- **If `V51` fails, the dispatch is void and the gate output is the finding.** A channel arm that did not
  change the prompt cannot report a delta about the channel, whatever the delta is.

## Cost and reproducibility

Four arms over 1,534 questions, five folds, `learn_sample=280`: about 7,000 model calls, 35 minutes on the
runner that produced R24 (32 minutes, 6,571 calls). Statements run under the same 20 s deadline and 10,000-row
cap, and `V48` fails the run if more than 1% of them are killed by it. The artefact is written under a name
that carries the design as well as the split, and `pnpm eval:protocol` re-derives the registered cells from it.

## Outcome

To be written after the dispatch, against the four predictions and the three clauses above, with no reading
added that was not registered here.
