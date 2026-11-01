---
id: R30-stage2
step: R30
opened: 2026-11-01
arms: none,full
sample: 7000
gates: V1,V2,V3,V4,V5,V6,V7,V8,V12,V32,V44,V48
---

# R30 stage 2 — the sample that can see one percentage point

## Why this file exists

Every estimate this record has of its own memory mechanism was formed and measured on the same 1,534
questions. That is not a flaw anyone can fix by being more careful: the hypothesis *is* the corpus.
`ROADMAP.md` §R30 registered the consequence plainly — the read-time gate is worth +0.98pp on dev,
its interval excludes zero, it survives eleven leave-one-database-out refits, a permutation null of
random discards (p = 0.0002) and a balanced split-half, and **none of that is an out-of-sample
test**, because both halves of every one of those readings were in the corpus the hypothesis came
from.

The two cheaper exits are closed, and both were measured rather than assumed:

| exit | why it does not exist |
|---|---|
| Mini-Dev as a second sample | **496 of its 500 questions are dev questions** (measured 2026-11-01). It is a slice of the corpus, not a second one — which the record already used correctly when it decomposed R24's +17.60pp as `925/1534 × 14.05 + 609/1534 × 22.99`, and which means it cannot supply the independence the question needs |
| a fresh split of dev | the hypothesis was formed on all 1,534 questions; any subset of them is in-sample by construction |

What is left is BIRD **train**: 9,428 questions over 69 databases that neither `dev` nor `mini_dev`
touches.

## What was checked before this file was written

§R30's registered prediction 4 said this dispatch is the one most likely to fail, and the cheapest
form of that prediction was to find out before paying for it. `pnpm eval:split-precheck` loads a
split exactly as the lane will — same manifest, same parser, same pool rule, same population check —
and stops before the first model call. Its result on the real archive, run on 2026-11-01:

| reading | train | dev (control) | mini-dev (control) |
|---|---|---|---|
| questions in the file | 9,428 | 1,534 | 500 |
| after the split's pool rule | 9,428 | 1,534 | **350** |
| after the manifest's selection | **7,829** | 1,534 | 350 |
| databases used | 58 | 11 | 11 |
| databases empty or unreadable | 0 | 0 | 0 |
| gold executed / compared | 9,428 / 9,428 | — | — |
| two copies of the gold disagree | **0** | — | — |
| verdict | **ready** | ready | ready |

The mini-dev control reading 350 is the check on the checker: 350 is the number every transfer
experiment in this repository calls that slice, and it was not given to the precheck — it fell out
of applying the same pool rule.

**Five defects were found by this check and none of them could have been found by a dev run.** They
are recorded here rather than in a commit message because each would have consumed a dispatch:

1. `poolOf` read `row.difficulty.toLowerCase()` and `train.json` has no `difficulty` field on any of
   its 9,428 rows — a `TypeError` at startup, after the download and the unpack;
2. the download buffered the archive with `arrayBuffer()`, which is 346 MB for dev and 8.9 GB for
   train — a runner's memory, before the databases are extracted;
3. the extractor looked for a nested archive called `dev_databases.zip`; train ships
   `train_databases.zip`, and the failure arrives question by question as "No database file";
4. `resolveDatabase` knew three database roots and not `train_databases`;
5. `SOTA_ARTEFACT` in `sota.yml` was `split == 'dev' && A || B`, which answers B for train — and B
   is the Mini-Dev artefact, so a train dispatch would have overwritten the Mini-Dev evidence.

## The selection, and what it costs

The archive is 8.9 GB and its nested database archive unpacks to **32.4 GB**, of which four
databases are over 4 GB each. The questions are not distributed that way: `works_cycles` carries 474
questions and 115 MB, `retail_world` 373 questions and 0.1 MB, while `donor` carries 160 questions
and 4.5 GB. Selecting on bytes per question is therefore nearly free:

| | databases | questions | unpacked |
|---|---|---|---|
| whole archive | 69 | 9,428 | 32.4 GB |
| this split's manifest | **58** | **7,829** | **2.4 GB** |

The 11 excluded databases cost 30.0 GB and 1,599 questions, so the selection keeps **83.0%** of the
questions for 7.4% of the bytes. The number is printed by the lane (`selection: 7829 of 9428 …`) and
carried in the artefact, so a smaller `n` is explained rather than discovered.

**7,829, not 9,428, is also a decision about the wall clock.** Dev at 1,534 questions over four arms
is a measured 6,504 calls in 130 minutes. Seven thousand questions over two arms is about 15,000
calls — 2.3× — against a runner's six-hour job limit and a 340-minute step timeout. **This file
registers `limit=7000`**, which gives a 15% margin on the measured ratio and costs almost nothing in
resolution (see below). A run that hits `deadline_min` writes the folds it finished rather than
being killed with nothing, and a partial run is reported as partial.

## Prediction

- **P1. The run is measurable.** The precheck says `ready` on all three splits, so the lane starts,
  prints `data ok` for 58 databases, and evaluates each of 7,000 questions exactly once. This is
  the only prediction here that is already supported by evidence, and it is listed because a
  dispatch that dies at minute three would otherwise be read as a measurement of the mechanism.
- **P2. The `full` arm is not positive, and not significantly different from the `none` arm.** Dev
  measured +0.33pp [−1.11, +1.76] on the same contrast. The mechanism has never moved raw accuracy
  on any split, and a 7,000-question sample is not a new mechanism.
- **P3. The read-time gate is worth between +0.2pp and +2.0pp on train**, centred near dev's
  +0.98pp. This is the prediction the dispatch exists for. Its interval is the answer.
- **P4. The gate shrinks, and by less than half.** A point estimate below **+0.49pp** would say the
  dev figure was carried by the corpus rather than by the mechanism; anything in [0.49, 0.98] is
  shrinkage of the size an out-of-sample test is supposed to produce.
- **P5. An imported identifier is still a negative covariate.** §140's split — questions whose
  generated query names something neither the question nor the baseline query mentions — reads
  −9.68pp against +1.45pp on dev. If the mechanism is real, the sign survives a different mixture of
  databases even if the magnitude does not.

**Resolution.** The half-width of a paired contrast scales as `1/√n`: dev resolves 2.01pp at 1,534
questions, so 7,000 questions resolve about **0.94pp**, and 7,829 would resolve 0.89pp. The 6%
difference is why `limit=7000` is acceptable — the quantity being tested is a +0.98pp effect, and
both samples can see it, barely.

## What this run cannot say

**Not one word about the leaderboard.** BIRD publishes no test cell for train, and every system's
train accuracy is measured on questions it may have trained on. The split is named
`BIRD train (out-of-sample)` in the artefact precisely so that `compareCell` cannot file it as a
reproduction of a published cell — the name matches no catalogue entry, and a test asserts that.

**Not a cross-split comparison of accuracy.** The databases are disjoint from dev's, so the absolute
accuracy on train is a different quantity. Only the *effects* — the paired differences between arms
inside this run, and the gate's improvement computed from them — are comparable to dev's.

## Refutation

- If the gate's improvement on train is **≤ 0**, or its interval excludes +0.98pp from below, then
  §140's estimate is a property of the dev corpus and the read-time filter has no out-of-sample
  support. The product statement narrows to what is measured on dev and says so.
- If the imported-identifier covariate is **not negative** on train, the one covariate that
  separated a helpful rule from a harmful one on dev does not generalise, and §141's mediation — which
  explains *where the name came from* rather than whether the name predicts — becomes the only
  account this record has of its own damage.
- If the answer rate is below 95%, or gold execution fails on more than 1% of questions, the run
  measures the harness and not the model, and no number from it may be quoted in either direction.
- If `V32-fold-learning-intact` fails, the store the `full` arm read was not the treatment the
  predictions above describe, and the run is reported as an instrument failure rather than a result.
- If the train archive cannot be verified against its digest on a runner, the honest output is
  `blocked` with the digest that arrived, not `pending`.

## Cost

About 15,000 model calls: 7,000 × 2 arms, five folds of learning at the configured sample, and
retries. One dispatch, `split=train`, `limit=7000`, `arms=` (none and full only), `max_calls=16000`,
`deadline_min=300`, `prereg=R30-stage2`.

## Amendment 1 — the call cap was wrong by 14%, and the first dispatch stopped on it

The first dispatch of this registration (run `41294945557`, `2026-11-01T09:51:50Z`) finished fold 1
of 5 and then refused to continue:

```
[sota] fold 1/5: eval=1400 learn=280 edited=95 unanswered=0 distillFailed=0 active=184 calls=3175
[sota] budget forecast after fold 1/5: the run needs about 17145 calls, the cap is 16000 (short by 1145)
[sota] failed: MG_E_BUDGET_EXCEEDED: the configured cap cannot finish the folds
```

**Corrected: 20,000.** `limit=7000`, `arms=none,full`, `folds=5`, `deadline_min=300`,
`learn_sample=280` and `prereg=R30-stage2` are all unchanged, and so is every prediction and
refutation above. The cap is a safety valve, not a parameter of the design.

**Where the estimate went wrong.** 15,000 was 7,000 × 2 arms plus a guess at learning. The guess
was made in questions and the meter counts calls: one fold of 1,400 questions over two arms is
2,800 generations before any learning, its 280-question learning pass is another 280 distinct
prompts, and the 95 edited queries the fold produced were re-asked rather than dropped. That is
3,175 against a 3,000 estimate — 5.8% per fold, 14% over five. The forecast is the lane's own
arithmetic on the first fold it completed, so the correction is its number, not mine.

**What the aborted run may and may not be read for.** Fold 1 completed and printed
`eval=1400 learn=280 edited=95`; none of it is evidence. A run that stopped because of a parameter I
set is a truncated run, and the fold it finished is the first fold, so quoting it would be reading
the one fold that happened to fit. It is discarded, and this dispatch replaces it whole.

## What happens to the three readings

`pnpm eval:query-diff`, `pnpm eval:mediation` and `pnpm eval:stability` each take their input from a
variable and write their artefact beside it. Pointing them at the train artefact with
`POC_RESULT_SUFFIX=train` produces `poc-query-diff-train.json` and its two companions without
touching the dev evidence CI compares byte for byte. That is the whole analysis path for this
dispatch: the same code, a different corpus, three readings that can be put side by side.

## Amendment 2 — the registration declared a gate its own text says cannot apply

The protocol gate rejected the first version of this file's front matter after the run:

```
FAIL eval/results/poc-sota-bird-train.json — prereg/R30-stage2.md: declares V31, which the run
never emitted; does not name V1, V2, V3, V4, V5, V6, V7, V8, V12, V48, V44, which the run emitted
```

**V31 is `cell-comparison`.** It re-derives a recorded comparison against a published cell and
refuses the record if the two disagree. This file's own section "What this run cannot say" says in
the first line that BIRD publishes no test cell for train and that the split is named so `compareCell`
cannot file it as a reproduction — so the gate V31 was declared for is the one gate this design has
already argued cannot run. Declaring it was a copy of the front matter of a dev registration, and the
contradiction sat in the file for a day because front matter is read by a program and prose is not.

**Corrected to the twelve gates the run actually emitted**, which is the list the lane produces on
every run of this shape: `V1, V2, V3, V4, V5, V6, V7, V8, V12, V32, V44, V48`. All twelve passed.

**What this amendment does not touch.** The five predictions, the five refutation clauses, the
selection, the sample, the arms and the cost are unchanged. A gate list says which instruments
adjudicate a run; it is not an instrument. The audit trail is the point: this is the second
amendment, both were about the harness rather than about the hypothesis, and both were written down
with the run's own output beside them.
