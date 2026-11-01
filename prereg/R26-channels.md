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

`41264432646`, 28 minutes, four arms, 1,534 questions, 6,504 calls, 0 call failures, 13 gates pass, `V51` among
them on its first run. Statements: 14 of 10,135 hit the 20 s deadline (0.14%), 126 truncated at the row cap
(1.24%). `V5-resolution` read a **2.07pp** minimum detectable effect.

| arm | accuracy | n | delta vs `none` | 95% CI | discordant | p | rules/question |
|---|---|---|---|---|---|---|---|
| `none` | 57.43% | 881/1534 | — | — | — | — | — |
| `full` | 57.76% | 886/1534 | +0.33 | [−1.11, +1.76] | 67/62 | 0.7249 | 1.75 |
| `values` | **58.60%** | 899/1534 | **+1.17** | [−0.13, +2.48] | 64/46 | 0.1046 | 0.00 |
| `linked` | **48.17%** | 739/1534 | **−9.26** | [−10.95, −7.63] | 24/166 | <1e-4 | 0.00 |

The lane's own pairwise computation agrees and is the stricter of the two: `values` **+0.85pp [−0.78, +2.54]**
(87 gained / 74 lost), `linked` **−9.58pp [−11.54, −7.56]** (55 gained / 202 lost).

`V51-channel-applied`: **`values` 1534/1534 = 100.0%**, **`linked` 558/1534 = 36.4%** — both inside the ranges
the registration predicted, and the pruner's share was printed rather than thresholded, which is the whole
reason the gate has two floors.

### The four predictions

1. **`linked − none ≤ −2pp`, interval excluding zero — confirmed, and by a wide margin.** −9.26pp
   [−10.95, −7.63] is 4.5 times the split's floor and the largest single-arm effect this record has measured
   in either direction. R21's −7.43pp was not a store artefact: the harm survives 4.4× the sample and the
   interval excludes zero by 7.6pp. **Pruning the schema to the tables the question names costs nine points.**
2. **`values − none` inside [−2, +2] with a half-width of at most 1.6pp — the point estimate held, the
   interval did not, and the refutation clause fired.** +1.17pp with a half-width of 1.31pp, but the upper
   bound is **+2.48**, so the interval is not inside the registered band. The clause was written on the
   interval, not the point estimate: *"if `values − none` has an interval containing zero and a half-width of
   at most 1.6pp, the value channel is closed as a prompt annotation."* Both conditions hold. **The value
   channel is closed**, and it is closed while carrying the largest positive prompt-side estimate this record
   has ever produced (+1.17pp, 64 gained against 46 lost, p = 0.10).
3. **`full − none` inside [−2, +2] — confirmed.** +0.33pp [−1.11, +1.76]. The anchor's third store reads
   +0.33 where R24 and R25 read −0.07 and −0.07, and all three are inside one interval of each other.
4. **`V51` passes on its first run — confirmed.** `values` at 100%, `linked` at 36.4%, inside the registered
   1–40% band. The gate's own reason for existing is visible in the same reading: had `linked` fired on no
   question, the arm would have been `none` under a second name and its −9.26pp would have been +0.33pp,
   published as a null about pruning.

### What the two channels actually did, by difficulty (outcome-blind stratifier)

| difficulty | n | `none` | `values` | `linked` |
|---|---|---|---|---|
| simple | 925 | 61.8% | **63.2%** | 51.6% |
| moderate | 464 | 50.9% | **52.2%** | 42.5% |
| challenging | 145 | 50.3% | 49.7% | 44.8% |

The value annotation points the same direction on the two populations that carry the split and stops doing so
on the third, which is the shape a real but small effect has — and it is a shape at 145 challenging questions,
not a result. The pruner moves every population down and furthest on the easiest third (simple −10.2pp,
moderate −8.4pp, challenging −5.5pp), which is the shape of a prompt that has deleted schema the question
needed rather than one that has been made harder to read.

### What this run settles about the 24.86pp gap

The record's last local explanation for its own gap to XiYan/CHASE was that the difference is the
schema-and-value channel: those systems read a pruned schema annotated with column values, we read the whole
DDL, and their ablations price the two at 12.71pp and 14.36pp. **Both halves of that explanation now have a
dev-scale interval.** Pruning is not a missing feature but an active harm in this lane (−9.26pp), and the value
annotation is indistinguishable from zero at the largest sample this benchmark offers. **The gap is therefore
not being lost in the prompt**, and the successor designs have to change the candidate pool, the selector, or
the generator — the three positions this lane has measured least.

### Cross-scale consistency, and one thing the pilot bought

The dispatch was preceded by a 350-question pilot (`41263187629`, 1,759 calls) that exercised the new gate on
the split the old readings came from. It read `values` +1.43pp [−1.43, +4.29] (15/10), `linked` −7.71pp
[−11.14, −4.57] (4/31), `full` −4.00pp [−7.14, −1.14], and `V51` at 100.0% / 34.9%. The channel readings are
the same two numbers to within their intervals at 4.4× the sample; the pack's is not, which is the ninth
recorded instance of a minidev reading that does not survive the split. Both artefacts are committed, and the
pilot's value is that the gate was proven before the registered run rather than after it.
