---
id: R34-admission
step: R34
opened: 2026-11-01
arms: none,self-knowledge,coverage-high,coverage-low,pack-two,conjunction,random
sample: 7000
gates: V55,V56,V57,V58
---

# R34 — is the memory wrong, or is the population wrong?

## Why this file exists

§147 measured the exchange rate and §148 closed the product. Both treated the failure as a property
of the injected item: repairs 6.39%, breaks 5.82%, a ratio of 0.79, and a filter that recovers a sixth
of its own ceiling. Shape 3 — "a weaker injection" — was left open with the note that nothing measured
suggested a dose that raises repairs without raising breaks.

That note was about the wrong variable, and the arithmetic in this file says so before any new number
is computed.

**The exchange rate is not the bar.** A repair can only happen on a question the bare model got wrong
and a break only on one it got right, so the two rates sit on different bases: 2,925 questions can
only be repaired and 4,075 can only be broken. Equal rates are therefore a loss. The rate at which
memory breaks even is the **odds of the bare model being right**, not parity:

| quantity | value | derivation |
|---|---|---|
| bare wrong (repairable) | 2,925 | §147 |
| bare right (breakable) | 4,075 | §147 |
| repairs | 187 | 6.393% of 2,925 |
| breaks | 237 | 5.816% of 4,075 |
| exchange rate | 0.7890 | 187 / 237 |
| **break-even exchange rate** | **1.3932** | 4,075 / 2,925 |
| repairs needed at fixed breaks | 8.10% (**+1.71pp**) | 5.816% × 1.3932 |
| breaks needed at fixed repairs | 4.59% (**−1.23pp**) | 6.393% / 1.3932 |

Memory is not 21% short of useful. It is **43% short**: 0.79 against a hurdle of 1.39. Every sentence
this project has written about "close to a wash" was measuring against the wrong zero.

**And the population is where the asymmetry lives.** A question the bare model already answered cannot
be repaired; a question it got wrong cannot be broken. If the injection were shown only to questions
in the left column the break rate would be zero *by construction*, and the whole 6.39% repair rate
would arrive as net gain — **+2.67pp, the largest figure this programme has ever had in front of it**.
That is not a better item. It is a smaller population, decided before generation, from the question
alone.

So shape 3 is restated. The question is not whether an injection exists that repairs more than it
breaks. It is whether a **gate** exists that identifies the repairable subpopulation well enough to be
worth the coverage it costs.

## What the gate has to do, exactly

Admit a share τ of questions, of which a fraction q were ones the bare model would have got wrong.
Net gain on the full corpus is `τ · (q·r − (1−q)·b)`, and it is positive when

```
q·r > (1−q)·b   →   q > b / (r + b) = 5.816 / 12.209 = 47.64%
```

**47.64% against a base rate of 41.79%.** The gate needs a 5.85pp lift over admitting questions at
random. It does not need to be accurate, calibrated, or even good — it needs to be *better than
random by six points*. Nothing this programme has measured has been asked for so little.

| gate precision q | coverage τ = 0.4 | τ = 0.6 | τ = 1.0 |
|---|---|---|---|
| 0.42 (base rate) | −0.24pp | −0.36pp | −0.71pp |
| 0.50 | +0.06pp | +0.09pp | +0.14pp |
| 0.55 | +0.18pp | +0.27pp | +0.45pp |
| 0.60 | +0.30pp | +0.45pp | +0.91pp |
| 1.00 (oracle) | +1.07pp | +1.60pp | **+2.67pp** |

## What the literature says the gate should be

Four bodies of work bear on the design, and one of them is a direct precedent with published numbers.

1. **Selective retrieval is a solved-shaped problem with a standard instrument.** SKR (Wang et al.,
   2023, Findings of EMNLP) splits a training set into questions the model answers correctly without
   retrieval (D+) and questions it only answers with it (D−), then predicts the split for a new
   question — by direct prompting, in-context examples, a BERT classifier, or **kNN over similar past
   questions**. The kNN variant is the strongest and beats *full* retrieval by 2.91pp (InstructGPT)
   and 4.20pp (ChatGPT) across five benchmarks. That is the mechanism this iteration replicates in the
   cheapest possible form, and its reported gain is the number to beat.
2. **The failure mode SKR names is the one measured here.** Its stated problem is the *distraction*
   effect: when a model already knows an answer, semi-related retrieved passages override correct
   internal knowledge. That is break, described from the other side — and it is why the D+/D−
   boundary, not the item, is the variable.
3. **Admission is selective classification, and it has an oracle.** Chow (1957), El-Yaniv et al.
   (2010), Geifman & El-Yaniv (2017) formalise abstention as a risk–coverage trade-off, and Geifman
   et al. (2019) and Rabanser et al. (2023) give the perfect-ordering bound `acc(c) = min(1, a_full/c)`
   — the accuracy a scorer achieves if it admits exactly the c-fraction most likely to be correct.
   Applied to a *paired* treatment the bound is sharper than it is for accuracy: admitting the
   repairable questions first makes the gain 100pp on that sliver, and +2.67pp on the corpus. This
   file computes that bound rather than describing it.
4. **Relevance scoring is the competing mechanism, and it has been tried at scale.** CRAG (Yan et al.,
   2024) classifies retrieved documents as correct, incorrect or ambiguous before generating; SIM-RAG
   (Yang et al., 2025) trains a critic for sufficiency; Adaptive-RAG (Jeong et al., 2024) routes on
   query complexity. §148 already measured this project's version of the relevance signal and found
   the flag fires on 94.8% of attempts — but that was the flag on the *query*, which is a different
   quantity from the pack's coverage of the question, and the coverage score has never been read as an
   admission rule.

## The design

**Corpus.** `eval/results/poc-sota-bird-train.json`, 7,000 questions over 58 databases, the artefact
§146 and §147 already paid for. No model call. Nothing here is a new measurement of the model; it is a
new measurement of a decision.

**Split.** The 58 databases are ordered by a stable hash of `dbId` and dealt alternately into a
discovery half and a confirmation half. A database is never in both. The split is by cluster rather
than by question because a gate that admits one question in a database and not its neighbour is not a
deployment anyone can run, and because §143 established that questions inside a database are not
independent.

**Gates, all registered before the curves are computed.** Each is a predicate on a field the run
recorded, evaluated per question, with a threshold swept over that field's own percentiles on the
discovery half only.

| id | gate | admits when | why it is here |
|---|---|---|---|
| **G1** | `self-knowledge` | the share of lexically similar questions in the same database that the bare model got **wrong** is ≥ t | SKR's kNN variant. Leave-one-out: a question is never a neighbour of itself, and its own outcome is never read. k = 10, similarity is Jaccard over content words, ties broken by question id |
| G2 | `coverage-high` | the pack's coverage of the question ≥ t | CRAG's relevance assessment, in this project's cheapest form |
| G3 | `coverage-low` | coverage ≤ t | G2's mirror. Registered because a direction chosen after the fact is not a prediction, and because §148's imported-name result argues the mechanism may point the other way |
| G4 | `pack-two` | the pack carried ≥ 2 items | the only dose split the corpus can support; R16 measured quantity on accuracy and never on the exchange |
| G5 | `conjunction` | G1 at its selected t **and** coverage ≥ G2's selected t | a gate is allowed to be two signals; the thresholds are borrowed, not re-fitted, so the multiplicity cost is one, not two |
| G6 | `random` | a seeded random share matched to G1's coverage | the control. Net must scale with coverage and sign; if it does not, the estimator is wrong and every other number in the file is void |

**Thresholds.** Six quantiles per gate, computed on the discovery half: the 10th, 25th, 40th, 50th,
60th, and 75th percentile of the swept field, oriented by the gate's direction. G5 uses the percentile
of G2's grid that G2 selected on discovery.

**Selection.** For each gate, the threshold that maximises net gain on the **discovery** half, subject
to coverage ≥ 20% and at least 5 databases represented. The selected (gate, threshold) is then applied
unchanged to the **confirmation** half.

**Endpoints.** The primary is G1's confirmation net gain: percentage points on the full corpus, on a
percentile interval that resamples databases, requiring the interval to exclude zero and the point
estimate to be positive. G2–G6 are secondary, reported against α = 0.05/5. Net gain is `Σ(correct −
withoutMemoryCorrect)·1[admitted] / N` — one number per question, defined on every question whether
admitted or not, so the interval resamples databases rather than subsets.

**Multiplicity.** Six gates, one primary, five secondaries at Bonferroni α. Thresholds are selected on
discovery and evaluated on confirmation, so the confirmation number is an out-of-sample estimate of a
rule that was chosen in-sample; no further correction is applied to the primary, and any shrinkage
between the two halves is reported rather than adjusted away.

## Prediction

- **P1 — instrument.** Both halves hold ≥ 2,500 questions and ≥ 25 databases, and 240 of the 424
  discordant questions each. A split that leaves a half without discords cannot answer anything.
  *(As registered — unreachable, because two halves cannot each hold 240 of 424 between them. See
  Amendment 3; the bar evaluated is 150, and both halves clear it at 208 and 216.)*
- **P2 — the hurdle reproduces.** Full-corpus exchange rate 0.789 against a hurdle of 1.393, both
  recomputed from the corpus rather than transcribed, so §147's numbers are checked as a side effect.
- **P3 — the control is neutral.** G6's confirmation net gain is within 0.15pp of `τ × (−0.714pp)` at
  every matched coverage. If random admission does not scale linearly, dose is a moderator after all
  and R16's "quantity is not the variable" needs re-reading.
- **P4 — the oracle bounds hold.** Admitting exactly the bare-wrong questions yields +2.67pp with zero
  breaks; admitting exactly the bare-right ones yields −3.39pp with zero repairs. These are
  identities, and a corpus that fails them is not the corpus this file describes.
- **P5 — the self-knowledge gate clears the bar.** G1's confirmation precision exceeds 47.64% and its
  net gain is positive on an interval excluding zero, at a coverage between 25% and 70%. This is the
  prediction the file is worth writing for: SKR reports 2.9–4.2pp over full retrieval, and the bar
  here is a 5.85pp lift over the base rate, not a mechanism that has to work well.
- **P6 — relevance does not.** Neither G2 nor G3 clears 47.64% precision on confirmation. §145 and
  §147 both say the content of what arrives is not what decides the sign, and a coverage gate that
  cleared would contradict them.
- **P7 — selection shrinks.** G1's confirmation net gain is at most 70% of its discovery value. The
  threshold was chosen on the half it was measured on, and a programme that has been burned by
  in-sample gate estimates four times should predict the shrinkage rather than be surprised by it.

## Refutation

- **G1 fails P5.** Selective retrieval, the mechanism with the best published evidence in this area,
  does not transfer to a rules store on BIRD. Then the failure is not that memory is used on the wrong
  questions either, and the remaining account is that the store's content is not a *fact* the model can
  use — which would send the programme to R13's admission ledger and R15's missing-database ceiling
  rather than to another gate. Shape 3 closes with the arithmetic intact and no direction left.
- **G1 clears, and G2/G3 also clear.** Relevance is the operative signal and §147's negative was about
  the item's wording rather than its topic. Then the filter, the admission gate and the coverage score
  are one mechanism and should be measured as one.
- **G1 clears but P7's shrinkage is violated** (confirmation ≥ discovery). The gain is not a property
  of the rule; the two halves differ in a way the split did not control, and the number is not usable
  until the difference is named.
- **The control fails P3.** Every reading in this file is void and the report says so; a net gain that
  does not scale with coverage is an estimator defect, not a finding.
- **P4 fails.** The corpus does not contain the 2,925 / 4,075 split §147 published, and the artefact
  must be re-read before anything else in this file means anything.

## What a positive result licenses, and what it does not

A positive G1 licenses one product sentence — *memory is worth keeping, for the questions the gate
admits* — and one implementation: a gate evaluated before generation, on the question and the
database's own history, with a coverage ceiling and a precision floor written into it. It does **not**
license calling the mechanism repaired: +0.5 to +1.0pp is the size on offer, it is a fifth of the
2.67pp the oracle shows is available, and the same arithmetic that makes it possible is the arithmetic
that says the memory is a net cost on 58% of questions.

A negative G1 licenses something narrower and more useful: **the label**. Three shapes have now been
refuted — the item's content, the item's quantity, and (if this fails) the population's selection — and
what remains is the store. That is where R13 and R15 already put the ceiling, and this file would be
the measurement that sends the programme back to it with a number rather than an impression.

## Outcome

One run, no dispatch, no model call: `pnpm eval:admission` over
`eval/results/poc-sota-bird-train.json`, producing `eval/results/poc-admission.json`. 7,000 questions,
58 databases, dealt 29/29 across the wall — 3,230 questions with 208 discordant on one side and 3,770
with 216 on the other. Four instrument gates, all green. Seven registrations, five holding.

| Reading | Value | Predicted | |
|---|---|---|---|
| exchanges between the halves | 2,925 repairable / 4,075 breakable, split 1,409 / 1,821 and 1,516 / 2,254 | ≥ 150 discords each (amended) | ✓ 208 / 216 |
| exchange rate | 6.39% repaired, 5.82% broken, **0.789** | below the hurdle | ✓ |
| the hurdle | **1.393** = 4,075 / 2,925 | — | recomputed, not transcribed |
| clearance | **0.566** — 43% short of paying | — | the round's reframing |
| repair rate that would break even | **8.10%**, +1.71pp on the measured rate | — | — |
| or break rate that would | **4.59%**, −1.23pp | — | — |
| admission ceiling | **+2.67pp** with zero breaks | identity | ✓ |
| removal ceiling | **−3.39pp** with zero repairs | identity | ✓ |
| control | six shares, widest deviation 0.186pp against a 0.264pp half-width | inside its own interval | ✓ (amended) |
| **P5, the primary** | 35.6% coverage at **62.35% precision**, **−0.05pp** [−0.50, +0.45] | precision > 47.64%, interval excludes zero | **✗** |
| P6, relevance | coverage-high −0.11pp, coverage-low −0.19pp | neither clears | ✓ |
| P7, shrinkage | −0.05pp against −0.19pp | ≤ 70% of discovery | ✗, see below |
| best point on any curve | **+0.11pp** at 14.8% coverage, [−0.19, +0.44] | — | 4% of the ceiling |

**The gate does what the registration asked and the product still does not move.** The self-knowledge
gate reaches 62.35% precision where the registered bar was 47.64% — a 20.6pp lift over the base rate,
three and a half times the lift the file said would be enough — and returns −0.05pp on an interval
that covers zero. The arithmetic that predicted a +0.9pp gain at that precision was not wrong about
the arithmetic. It was wrong about what the arithmetic is about.

**The bar moves with the selection, and that is the finding.** `q > b / (r + b)` was written with `r`
and `b` as properties of the corpus. They are properties of *the population being admitted*, and the
gate changes the population. Across the self-knowledge sweep, on the confirmation half:

| threshold | coverage | precision q | bar `b/(r+b)` inside the set | gap | repair rate | break rate |
|---|---|---|---|---|---|---|
| 0.10 | 94.5% | 41.8% | 46.5% | −4.7pp | 6.32% | 5.50% |
| 0.20 | 81.9% | 45.1% | 48.7% | −3.6pp | 6.39% | 6.07% |
| 0.30 | 64.5% | 50.8% | 52.3% | −1.5pp | 6.23% | 6.84% |
| 0.40 | 49.1% | 56.2% | 57.0% | −0.8pp | 5.86% | 7.77% |
| 0.50 | 35.6% | 62.4% | 63.3% | −0.9pp | 5.61% | 9.68% |

Precision climbs 20.6pp and the bar climbs 16.8pp with it, because **the break rate inside the admitted
set nearly doubles while the repair rate does not move**. A question whose neighbours were answered
wrongly is not a question the pack can repair; it is a question the model is unstable on, and an
unstable answer is one the pack can break as easily as it can fix. The gate is selecting variance, and
variance is symmetric — which is exactly the property that makes memory a wash in the first place.

So the honest reading of P5 is not "the gate was not good enough". It is that **the gate was good
enough and the target moved**, and the two moved at the same rate to within a percentage point across
the whole sweep. The prediction that a 47.64% precision gate ships was conditional on a homogeneity
the corpus does not have.

**Two predictions were refuted and one of them for a defect in the file.** P7 required the confirmation
gain to be at most 70% of the discovery gain; the discovery gain is −0.19pp, so the inequality inverts
and a *better* confirmation half is recorded as a failure. The prediction was written for a positive
effect and there was none. It is left refuted rather than repaired, because the meaningful content —
that a rule selected in-sample loses most of its value out of sample — has nothing to test when no
rule had value to lose. AUDIT §32.2 records both this and the tolerance defect below as one family.

**The ceiling is what closes the shape.** Admission puts 2.67pp above the memory and the whole
registered family — five gates, 30 points, thresholds swept over six quantiles each — reaches +0.11pp
of it out of sample, 4.0%, on an interval that covers zero. The best point is the conjunction of a
failure-dense neighbourhood and a well-covered question, at 14.8% coverage, and it is the only
configuration in the entire grid above water. Set that beside §147's filter, which realised 15.2% of
its own 3.39pp ceiling: **the removal route was four times as efficient and still did not pay.**

**What survives, and it is not nothing.** Four things, in descending order of how much they change:
the hurdle reframing, which converts "close to a wash" into "43% short" and gives any future design a
target — a memory that repairs 8.10% instead of 6.39%, or breaks 4.59% instead of 5.82%, at fixed
counts; the admission ceiling, which is the first time this programme has had a 2.67pp number in front
of it that is not a loss; the anti-correlation between precision and exchange rate, which is a
mechanism that any gate on any corpus will have to answer; and the confirmation that the topic of what
arrives is still not the variable, now measured a third way.

### What it does to R33's last open shape

| shape | before §149 | now |
|---|---|---|
| 3. a weaker injection | untested, and the only open one | **closed, and not by dose.** The shape was mis-specified: the problem was never how much is injected but to whom. Restated as admission and tested, the population route reaches 4% of its ceiling out of sample. No injection, and no gate, changes the product |

### Amendments

**Amendment 1 — P3's tolerance could not be met by a correct estimator.** The file registered
"within 0.15pp of `τ × (−0.714pp)` at every matched coverage". At the 15% share the admitted set is 561
questions and the net over it has a sampling error of roughly ±0.26pp, so the widest deviation (0.186pp)
was inside the noise when it failed. The criterion is now **the expected value must lie inside the
reading's own clustered interval** — the instrument this repository uses everywhere else — and the
numbers are published both ways: the registered form fails on one of six points, the amended form passes
on six of six. This is the same defect as AUDIT §31.2, a threshold written without doing the arithmetic
that decides whether it can be reached, and it was written in the same week.

**Amendment 2 — the precision bar is not a property of a gate.** §"What the gate has to do" derives
`q > b / (r + b)` from corpus rates and then treats the result as a threshold any gate must clear. It is
a threshold the *admitted set* must clear, and the admitted set has its own rates. The registration's
central claim stands in the form "a gate ships when its precision exceeds the bar its own admitted set
implies"; the number 47.64% applies only under homogeneity, which this corpus does not have and which
nothing here measured before the run. The artefact now reports the within-set bar beside every point,
and no verdict changes: P5 was already refuted and is still refuted.

**Amendment 3 — P1's discordant floor was arithmetically impossible.** The file registered "240 of the
424 discordant questions each", which requires the two halves to hold 480 discordant questions between
them. The corpus has 424. The bar was therefore unreachable in the same way R33's P6 was, written the
same week, by the same hand, and the implementation silently used 150 instead — a divergence between
registration and code that `protocol` would have caught had the two been files. It is recorded rather
than quietly corrected: as registered, P1 fails on a number no split could produce; as amended to 150,
it holds at 208 and 216. AUDIT §32.2 names the three instances together.
