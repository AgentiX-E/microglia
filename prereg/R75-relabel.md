---
id: R75-relabel
step: R75
opened: 2026-11-10
arms: none
sample: 350
gates: V1,V2,V3,V4,V5,V6,V7,V8,V12,V32,V44,V48,V51
---

# R75 — the instrument was mislabelled, and every small minidev effect has to be re-scored

**Registered** 2026-11-10. **Zero model calls.** It is a reading over artefacts that already exist.

## Why this file exists

Jin, Choi, Zhu and Kang (*Pervasive Annotation Errors Break Text-to-SQL Benchmarks and Leaderboards*,
PVLDB 19(5):931–944, 2026) measured annotation error rates of **52.8% on BIRD Mini-Dev** and 62.8% on
Spider 2.0-Snow. Re-scoring the sixteen open-source agents on BIRD's leaderboard against corrected
labels moved relative accuracy by **−7% to +31%** and ranks by up to nine places; CHESS, seventh on
the uncorrected board, moves to **first**. Their summary is not "the benchmark is noisy" but "the
rankings are poor predictors of true performance".

This repository pinned Mini-Dev at `v1-2024-06-20` (`eval/manifests/bird-minidev.json`, sha256
`cc48ba16…`, retrieved 2026-10-23), which predates the corrected release. The corrected annotations
were published as `arcwise_plat_sql_only_with_diff.json` (498 questions) and, counted against this
lane's own slice:

> **151 of 350 questions — 43.1% — have a different gold query.**

Every small effect in this lane was measured on that slice. R73's entire finding was "**four
questions moved**", on a population of 115 eligible questions. A grading instrument that disagrees
with itself on 43% of its own questions cannot settle a four-question claim, and the response is not
to re-run the experiments — a new sample of the same population would carry the same labels — but to
**re-score the artefacts that already exist**.

## The instrument

`per_case` records `predictedSql`, `baselineSql`, `dbId` and `questionId` for every question, so both
arms can be re-executed against corrected gold and compared with what the run recorded. No model is
called; the cost is statement execution against the pinned databases.

- `packages/eval/src/relabel.ts` — the accounting. Two booleans per arm per question, one under each
  grading; it reports both arms' accuracies under both labels, the paired delta under both, the count
  of verdict flips, and the count of questions on which *the pair* changed shape.
- `pnpm eval:relabel --bird path.json --gold corrected.json` — the reading, with McNemar intervals
  from `comparePaired` and a verdict classified by `relabelVerdict`.
- **`pairChanged` is separate from `flips` on purpose.** A question where both arms were wrong and
  both are now right moves two verdicts and changes nothing about who is ahead. A table that reported
  only the first number would make the correction look more disruptive than it is.

## What is being decided

The memory question, read under corrected labels, on the runs that used this slice. The treatment arm
is the memory arm as each run defined it; the baseline is the same run's no-memory arm.

**Four branches, ordered, and they partition.**

1. **The verdicts survive.** Every delta that was significant keeps its sign *and* an interval that
   excludes zero (`stable`). The minidev conclusions stand, the corrected labels become the default
   grading for every future run on this slice, and the fact that a 43% relabel changed no verdict is
   itself a result — it would say the errors are orthogonal to the effect rather than merely rare.
2. **The verdicts are fragile.** Sign preserved, interval no longer excludes zero. Nothing is
   retracted, but nothing measured on 350 questions may be called a finding again; the lane's
   minimum population rises to dev's 1,534, and R73's successor is re-scoped to it.
3. **A verdict reverses.** The correction flips the sign of a delta this lane has published. That
   conclusion is retracted in the file that published it, and **every minidev-only result in the
   backlog is marked unverified** until re-scored.
4. **The correction is not material.** Fewer than 5% of questions change the pair. The relabel is then
   recorded as harmless at this population and the 43% gold-difference is explained rather than
   dismissed — a gold can differ textually and agree on rows, and if that is what happened here it is
   a fact worth having.

**A pre-committed secondary reading.** Train's 7,829 questions are *not* covered by the corrected
release — the id overlap is 336 questions and those are collisions between split id spaces, not a
correction. So **R72's −0.84pp is outside this file's reach**, in either direction, and no branch may
be read as confirming or refuting it. If the minidev verdicts turn out fragile, that asymmetry decides
where the next experiments go: the out-of-sample split is the only population in this lane whose
labels nobody has questioned.

## Prediction

- **The flips will be numerous and roughly balanced.** Of 350 questions, 25–40 change the memory arm's
  verdict in each direction, because 43.1% of the golds differ and a differing gold usually returns a
  different row set. Balance is the prediction, not asymmetry: the correction is not a deliberate
  tightening of the criterion.
- **Both arms will get worse, and by the same amount.** The corrected gold is a different question, not
  an easier one, so no arm should be favoured. A delta that moves by more than twice the flip rate
  would say the correction is not the neutral relabelling it is presented as.
- **The significant minidev deltas will lose their intervals.** The four runs whose harm excluded zero
  were 4.0–4.9pp on 350 questions, and a 1-in-6 per-question verdict change is larger than the gap
  that produced them.

## Refutation

- **If the deltas are unchanged to within a question or two**, then the annotation error is real for
  absolute accuracy and irrelevant to paired comparisons, and the lane's existing minidev results stand
  as measured. That is branch 1, and it would be the more surprising outcome.
- **If the deltas grow**, the corrected gold is systematically harder for the memory arm, which would
  make the correction a treatment rather than a relabelling and would disqualify it as evidence here.
- **If fewer than 5% of questions change the pair**, the correction is cosmetic on this population and
  the 43% textual difference is aliasing, which is branch 4.

## What this file does not do

It does not re-run anything, does not touch the pinned manifest, and does not change what a dispatch
grades against. Adopting the corrected labels as the default is an Outcome decision, made after the
reading, and it costs a manifest revision and a digest — not a dispatch.

## Outcome — branch 2: the direction is robust, the magnitude is not, and the slice is demoted

**Read 2026-11-10, zero model calls.** Fourteen minidev artefacts in this repository, each 350
questions, each re-executed against the corrected gold. **All 350 questions matched in every file** —
the slice is the same one the correction covers, which is why this reading is possible at all.

**The headline, and then the reason it is not the headline anyone wanted.**

| artefact | original Δ | 95% CI | p | corrected Δ | 95% CI | p | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `transfer` | −4.57pp | [−7.71, −1.43] | 0.0070 | −2.29pp | [−5.14, 0.57] | 0.1849 | **fragile** |
| `evidence` | −4.86pp | [−8.29, −1.43] | 0.0076 | −1.43pp | [−4.29, 1.43] | 0.4421 | **fragile** |
| `square` | −4.29pp | [−7.43, −1.14] | 0.0107 | −3.14pp | [−6.00, −0.57] | 0.0433 | **stable** |
| `R26-channels` | −4.00pp | [−7.14, −1.14] | 0.0161 | −1.43pp | [−4.57, 1.71] | 0.4869 | **fragile** |
| `framing` | −4.00pp | [−7.14, −0.86] | 0.0201 | −2.29pp | [−4.86, 0.29] | 0.1338 | **fragile** |
| `probe` | −2.86pp | [−6.00, 0.00] | 0.0987 | −0.57pp | [−3.43, 2.29] | 0.8506 | absent |
| `poc-sota-bird` | −2.86pp | [−6.00, 0.29] | 0.0987 | −0.29pp | [−3.14, 2.57] | 1.0000 | absent |
| `dose` | −2.57pp | [−5.43, 0.29] | 0.1078 | −0.86pp | [−3.43, 1.71] | 0.6776 | absent |
| `raw` | −2.57pp | [−5.43, 0.00] | 0.1078 | +0.86pp | [−2.00, 3.71] | 0.6900 | absent |
| `clearance` | −2.00pp | [−5.14, 1.14] | 0.2810 | −3.14pp | [−6.00, −0.29] | 0.0522 | absent |
| `transfer-repair` | −2.00pp | [−5.43, 1.14] | 0.3105 | −1.43pp | [−4.29, 1.43] | 0.4421 | absent |
| `substrate` | −1.43pp | [−4.57, 1.71] | 0.4731 | −3.14pp | [−6.00, −0.57] | 0.0347 | absent |
| `anchor` | −0.57pp | [−3.14, 2.00] | 0.8318 | +0.29pp | [−2.29, 2.57] | 1.0000 | absent |
| `R63-recall-order` | +0.57pp | [−2.86, 4.00] | 0.8679 | +0.29pp | [−2.86, 3.43] | 1.0000 | absent |

**Branch 2 fires.** Five runs had a significant verdict before the correction; after it, **one keeps
its interval** (`square`, −3.14pp [−6.00, −0.57]), **four become `fragile`**, and **none reverses**.
Nine were null before and stay null — with one addition the registration did not anticipate: the
correction *creates* a verdict in `substrate` (−1.43pp p 0.47 becomes −3.14pp p 0.035), which is a
significant result produced by relabelling and is therefore `absent` by this file's own rule. So the
registered sentence is the finding: *nothing measured on 350 questions may be called a finding again.*

**Four things the branch sentence does not say, and they matter more than it does.**

**One: the direction is robust; only the size is not.** Thirteen of fourteen deltas are negative
before the correction and **eleven of fourteen after it** — the three exceptions are +0.29pp twice and
+0.86pp, all with p ≥ 0.69. Across fourteen dispatches, seven memory mechanisms (dose, framing,
transfer, anchoring, clearance, substrate, repair) and two label sets, **no memory variant has
produced a positive effect on this slice**. That is the strongest replication the lane has: not a
magnitude, a sign.

**Two: the correction halves the effect.** Mean Δ is **−2.72pp** under the uncorrected labels and
**−1.33pp** under the corrected ones — 49% of the measured harm survives. The rest was grading error,
and the direction of that error is systematic rather than random.

**Three: the correction costs the baseline more than the memory arm.** The no-memory arm drops
**54.02% → 51.26%** (−2.76pp) while the memory arm drops **51.14% → 49.81%** (−1.33pp). This is the
opposite of what "our labels were too generous" predicts, and the explanation is mechanical: the
corrected gold is often a *different question*, not a better-posed one, and a memory pack built from
the corpus's own failures happens to agree with the corrected answer more often than a bare prompt
does. **Part of the harm this project measured was the baseline being graded too kindly.** That is a
real finding and it belongs to nobody's hypothesis.

**Four: the absolute numbers were inflated by about 2.8pp.** 54.02% is not this lane's minidev
baseline; **51.26%** is. Every published minidev cell moves by that much, and the leaderboard
comparison in `COMPETITIVE.md` has to be read with it.

**What the slice can and cannot carry now.** With 350 questions, one question is 0.286pp and the
detection floor for a paired difference is about 2.5pp. The corrected effects are 1.4–3.1pp. **The
instrument is now the same size as the effect**, which is the definition of a population that cannot
answer the question it is being asked. Two consequences, both recorded as decisions:

- **minidev is demoted to a smoke test.** It may verify that a mechanism runs and moves nothing
  catastrophic. It may not carry a finding. The smallest population that may carry one is **dev's
  1,534 questions** (one question 0.065pp), and the preferred one is **train's 7,829**.
- **the corrected labels become the default grading for minidev**, which is a manifest revision plus
  a patch overlay — registered separately, because adopting it changes what every future minidev
  number means and a run before the change is not comparable to one after it.

**Two corrections to the file itself, recorded because they changed the reading.**

1. `relabelVerdict` classified a sign flip as `reversed` **before** checking whether the original
   delta had ever excluded zero. R73's +0.86pp (p = 0.70) becoming −0.57pp (p = 0.86) was therefore
   reported as `reversed` — the word for withdrawing a published verdict, applied to two nulls. A
   verdict cannot be retracted if it was never published: the classifier now returns `absent`, and
   branch 3 is read only against deltas that had an interval excluding zero. Without this, the file
   would have claimed a retraction it did not have.
2. The first version of the reading tool never closed its statement pool, so it finished its work and
   then idled at zero CPU until the timeout — three runs were killed that way, each after two minutes
   of work and forty minutes of waiting. The pool is closed in a `finally` now, and the defect is
   recorded because a reading tool that hangs is indistinguishable from a database that is slow.

**R73, the run this file was written about.** Its arm-versus-control `+1.15pp` becomes **−0.57pp**,
and its writer's four-question gain is not reproducible under corrected gold. R73's own conclusion —
"the writer is not the price" — is **strengthened**, not weakened, by this: the mechanism was
underpowered and the four questions were label noise.

**What is untouched.** R72's **−0.84pp on train** is outside this file's reach: the corrected release
covers mini-dev only, and the 336 id matches against train are collisions between two id spaces, not
corrections. The out-of-sample split is the population whose labels nobody has questioned, and it is
now the only one whose effect sizes this lane will quote.
