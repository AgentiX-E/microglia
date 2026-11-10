---
id: R66-retry-values
step: R66
opened: 2026-11-10
arms: retry-values
sample: 1534
gates: V1,V2,V3,V4,V5,V6,V7,V8,V12,V32,V44,V48,V51,V76
---

# R66 — the retry that is told which spelling the database uses

**Registered** 2026-11-10. **Implemented** the same day, in the order this file demanded: the
registration first, as a target the implementation could not re-describe, then `value-correction.ts`,
the arm in `OPTIONAL_ARMS`, and `V76-values-delivered` — the gate that implements this file's own
void condition rather than a new one. `V76` fails a dispatch whose block fired on fewer than 30% of
the empty retries, which is the sentence written below in the Refutation.

## Outcome 0 — void by forecast, at 1,479 calls short (2026-11-10)

The first dispatch, `42747637476`, measured fold 1 and then refused to continue: **it needs about
13,479 calls, the cap is 12,000**. That is the same mechanism that stopped R64's first attempt, and
the cost section above predicted the trap and then walked into it — the cap was set from R64's
*bill* (5,241 calls for four arms) rather than from a cold-cache forecast, and this dispatch had no
warm distillation cache, so fold 1 spent 1,227 of its 2,496 calls learning.

Nothing about the registration changes. The forecast is the instrument's own number, taken from one
fully measured fold, and the re-dispatch uses it with a 7.6% margin (cap 15,000). The refusal is the
right behaviour — a run that stops after fold 1 and says why is worth more than a run that stops
after fold 4 with no artefact — and it cost the fold rather than the dispatch.

## Why this file exists

R64 measured the retry line for the first time: **20 of 98** rejected questions repaired (20.41%), worth
+1.30pp on 1,534 dev questions, nothing regressed. Two facts from the same iteration say where the rest
of that line is:

- **The population is 6.39% and the arm took a fifth of its ceiling.** Even a retry that repaired every
  rejection moves this benchmark by +6.39pp. Sharpening the repair is worth at most 5pp of headroom;
  widening the population is a different mechanism (R67's question, not this one).
- **The repairs are concentrated in the empty results, and the empty results are value misses.** 19 of
  the 20 repairs came from the `empty` bucket (21.6% of 88), and Amendment 1's composition measurement
  says **32 of 89** empty results read *exactly the gold tables* and filter on a value the database does
  not spell that way.

So the mechanism this registration buys is narrow and explicit: on a retry, tell the model which
spelling the database actually uses.

## The mechanism, exactly

- **`retry-values`**, evaluated beside `none`, `full` and `retry-blank`, on the same 1,534 dev questions
  with the same five folds. Its trigger is `retryTriggerOf` — the same function that counts the
  population — so a question is retried iff `retry-blank` would retry it.
- **The difference is one appended block**, produced without any model call:
  1. parse the *failed attempt's own* string and numeric literals (`retryPromptFor` already carries the
     attempt);
  2. for each literal that appears in no distinct value of the columns the attempt reads, find the three
     closest values in those columns by normalised edit distance, and render them as
     `you wrote 'Alameda County'; the column schools.County holds 'Alameda'`;
  3. cap the block at **600 characters**, dropping whole lines rather than truncating one, and cap the
     scan at 50 distinct values per column and 200 rows per table.
- **No new calls.** The arm spends exactly what `retry-blank` spends: one extra call on the 6.39% of
  questions the pipeline rejected. A mechanism that changes only what the second prompt says does not
  change the bill, and the run's `usage` should be equal to R64's within noise.
- **No memory.** The values come from the database, not from the store, so this is a *database-introspection*
  arm and its comparison against `retry-blank` prices exactly one sentence of evidence.

## Prediction

- **The block fires on at least 60% of the empty-result retries.** A question whose literal already
  matches a stored value exactly gets no line, and those are the ones that did not fail for this reason.
  Below 60% means the literal matcher is looking at the wrong columns.
- **The repaired rate rises from 20.41% to 25–40%** on the same 98-question population, i.e. **+4 to
  +16 more repairs** than `retry-blank` out of 98.
- **The benchmark delta against `retry-blank` is +0.2 to +1.1pp** [+0.1, +1.5], which at n=1,534 resolves
  a 1pp paired effect at about ±0.6pp. The upper end of that band is the whole remaining ceiling of the
  retry line (5pp), so a number near it would say the line is nearly exhausted rather than nearly solved.
- **The value block does not damage the non-value failures.** Repairs among the 10 execution errors
  should not move; a regression there means the block is distracting the model rather than informing it.
- **The bill equals R64's** within 10%, because the number of calls is identical and the prompt grows by
  at most 600 characters on 6.39% of questions.

## Refutation

- **The value-aware retry is promoted** if the paired delta against `retry-blank` on the retried
  population is at least **+8pp** (8 more repairs out of 98) with an interval excluding zero. Then the
  defect this project has been calling "values" for four iterations is confirmed causal at the moment of
  failure, and the next registration applies the same block to the *first* prompt (where it costs 1,534
  calls instead of 98, which is why it is not first).
- **The line is narrowed** if the delta is positive but under +8pp. The value explanation is then one
  contributor among several, and the composition measurement's 35.96% overstates what is recoverable.
- **The line is closed** if the delta's upper bound is below +2pp. Then a literal-by-literal correction is
  not what a second attempt needs, the empty results are not value misses in the sense that matters, and
  the retry line's remaining 5pp of ceiling is not reachable by evidence about spellings.
- **The run is void** if the retried population is below 80 questions (R64's void threshold, for the same
  reason) or if the arm fires on fewer than 30% of the empty results, because in that case the dispatch is
  measuring a block that is usually empty.

The alternatives are named so that the outcome selects one, and so that a positive under +8pp cannot
afterwards be re-described as a confirmation of the value hypothesis.

## Cost

One extra call on 98 questions of 1,534, with a prompt up to 600 characters longer on those calls: the
run is a `retry-blank` replay plus about 2% more prompt tokens, and the R64 bill was $0.44. It is
dispatched off-peak, and the cap is set from the forecast rather than from the warm-cache figure that
stopped R64's first attempt after one fold.
