# Glossary

Every term the library uses in code, docs, and error messages, with the meaning it has *here* rather
than in the wider literature. Where a term is contested, the note says how this project uses it and
why.

## Core concepts

**Activation** — the transition of a knowledge item into the `active` state, which is the only state a
prompt may carry. Requires both confidence above `activationThreshold` and evidence at or above
`minSupport`; neither alone is enough.

**Admission** — the whole decision of whether new evidence may steer output. Implemented in one
function (`decideStatus`) so the answer is inspectable rather than emergent.

**Candidate** — (1) a `DistillCandidate`: a claim an interpreter proposes, before it is deduplicated,
screened, or admitted. (2) A knowledge item in the `candidate` state: stored, not injected.

**Confidence** — a scalar in `[0, 1]` computed from evidence weight, trust, contradiction penalty,
empirical success rate, and temporal decay. It is a decision input, not a probability that the claim
is true; calibration against human judgement is future work, and the docs say so rather than implying
otherwise.

**Contradiction** — a trusted claim that asserts a different payload for the *same* scope as an active
item. Different scopes are not contradictions: a domain-specific exception is supposed to disagree with
the general rule, and specificity resolves it at read time.

**Condition** — the `when` field on a knowledge item: the property of a task under which the claim
applies, distilled beside the statement and rendered *before* it. It is text for a reader, not a filter:
measured on BIRD, rendering it changed half the answers and none of the scores. A condition the runtime
must enforce belongs in `tables`/`columns` logic, not in prose.

**Correction** — a structured statement of what the output should have been. Distinct from a rating
(an opinion about it) and from an outcome (a measurement of it).

**Corroboration** — a claim observed more than once, counted as the number of independent feedback
events behind it (`evidence.length`). The pack can require it (`minEvidence`); on the two workloads
measured here it is the property that separates a rule worth injecting from one that is noise, because a
single correction is a hypothesis rather than a rule.

**Credit assignment** — attributing a later outcome to the knowledge that was in the prompt at
generation time. Counts `applied` and `succeeded` on exactly the items whose ids the run cited.

**Decay** — the reduction of confidence as world-time validity passes (`validUntil`), with a 30-day
half-life floored at 0.2 so fresh evidence can revive a rule. Distinct from retirement, which is a
status change.

**Distillation** — the batch process that turns feedback events into knowledge items. Idempotent:
replaying the same events creates nothing new, because evidence is deduplicated by feedback id.

**Domain pack** — a package that teaches the core what an edit means in one product's output format.
Implements canonicalisation, validation, edit classification, semantic distance, and the payload
shape. `nl2charts` is the reference.

**Evidence** — one `EvidenceRef` pointing at a feedback event, carrying its weight. Evidence is what
support sums; it is never edited, only added.

**Generalisation** — widening a claim from `(domain, intent)` to `(intent)` when the same claim recurs
in another domain, retiring the domain-scoped siblings. The mechanism behind transfer to an unseen
domain; measured at **100% vs 32.86%** on a domain that received no feedback.

**Guard** — the injection screen applied to candidate statements. Findings are severity-coded; high
severity means the claim is stored in quarantine rather than dropped, so a human can review it.

**Knowledge item** — an admitted or pending claim with scope, payload, evidence, and a lifecycle
status. The unit that is retrieved and rendered.

**Namespace** — the tenancy boundary, present on every record and every query. Retrieval never crosses
it; a test asserts the leakage count is zero.

**Pack** — a `KnowledgePack`: the items selected for one request, their ids, the rendered block, its
hash, and the truncation count. What the host injects and what the run records.

**Policy** — the numeric knobs that decide admission and retrieval. Defaults are documented with the
reasoning for each number, because a policy whose numbers are unexplained cannot be trusted or tuned.

**Quarantine** — the state for evidence that is stored but not injected, because its source trust is
below `quarantineBelowTrust` or because the injection screen flagged it.

**Retirement** — removal from injection. Reversible: a retired item that receives fresh trusted
evidence is rehabilitated and its application ledger resets.

**Scope** — the structured context a claim is true in: `task` plus any of `domain`, `intent`, `field`,
`schemaDigest`, `reasonCode`. Scope is both a filter and an index: supplying it lets a widened rule
reach a question whose text does not contain the domain word.

**Specificity** — the number of scope dimensions an item states (plus one). At equal confidence, the
more specific rule wins, which is how a domain exception overrides a general rule.

**Support** — the sum of evidence weights. A threshold rather than a count, so one strong observation
can equal several weak ones.

**System time / world time** — the bitemporal pair. `validUntil` is when the claim stopped being true
in the world; `systemUntil` is when the store stopped believing it. A rule can be superseded in system
time while still being true in world time, and the reverse.

**Trust** — a scalar in `[0, 1]` attached to a feedback event, derived from the *signal* (execution
result > clarification > preference > rating with reason > edit > bare rating) and optionally capped by
the host. Never derived from the actor's identity.

**Trust ceiling** — a per-call cap on trust, for feedback arriving through a channel the host trusts
less. Below the quarantine floor, the resulting knowledge is stored but never injected.

**Write admission** — the decision a store makes *before* storing a claim: add it, merge it into a
neighbouring rule, or decline to write. Distinct from **evidence admission**, which decides whether a
stored rule may be injected; one is about the door, the other about the shelf. Similarity to the
nearest stored rules is what the decision reads, and refusal (`noop`) is a result worth counting: it
is how much repetition the store declined to keep.

## Evaluation terms

**Ablation** — an arm or micro-experiment that disables exactly one module so its contribution is
measurable. Nine arms vary one knob each; three micro-ablations cover modules a clean corpus cannot
exercise.

**Arm** — one configuration in the study. "Arm" rather than "condition" because each is a policy
choice, not a treatment in a clinical sense.

**Bootstrapped interval** — a percentile interval over resampled paired deltas. Reported width, not a
significance claim; the McNemar test carries the inference.

**Gate** — a named predicate over the study artefact with a threshold, a measured value, and a
blocking flag. Fifteen gates; a failing blocking gate fails the build.

**Held-out domain** — a domain that receives *no* feedback in any arm and is still evaluated. The only
clean test of generalisation, because everything else can be memorised per domain.

**McNemar test** — the exact paired test used to compare arms, because the outcomes are paired
(correct/incorrect on the same question) and the sample is small.

**Out-of-sample** — measured on questions the hypothesis was not formed on. In this project the split
that supplies it is BIRD **train**: 9,428 questions over 69 databases, none of which dev or Mini-Dev
contains, restricted by the manifest to 7,829 over 58 for wall-clock reasons and dispatched at 7,000.
Mini-Dev is *not* out of sample — 496 of its 500 questions are dev questions — and neither is any
subset of dev, because the hypothesis was formed on all 1,534.

**Clustered interval** — a percentile interval whose resampling unit is the database rather than the
question. Questions inside one database are not independent: one package of rules reaches all of them,
so resampling them as if they were shrinks the interval by roughly the square root of the cluster size.
This project reports the clustered interval for any claim that decides something, and keeps the
question-level one only as a comparison. It is the check that closed R32's first axis and, separately,
the one the out-of-sample headline had to pass before it was quoted.

**Fold sign test** — the exact two-sided binomial over how many cross-fitted folds point in the pooled
direction. Five folds cannot reach p < 0.05 however unanimous they are — the floor is 0.0625 — so this
is reported beside the interval rather than instead of it, and the floor is stated rather than rounded.

**Imported name** — a table or column that appears in a generated query and in neither the question nor
the bare attempt at it. The one covariate in this project that separates help from harm: questions whose
memory query imports one run −6.57pp out of sample against −0.22pp for the rest, and they are 7.8% of
the corpus and 72% of the net harm.

**Read-time filter (the gate)** — the product that survived: discard a generated statement that imports
a name the request never implied, and execute the bare attempt instead. Chosen because it is a
comparison against text you already have, not a judgement about a rule. Worth +0.51pp out of sample,
stable under leave-one-database-out, split-half and a permutation null at p = 0.0002 — and still not a
net gain, because it only recovers 72% of what the rules cost.

**Repair rate and break rate** — of the questions the bare attempt got wrong, the share a memory query
turns right; and of the ones it got right, the share the memory query turns wrong. Two rates over two
different bases, so they have to be quoted together. Out of sample the pack repairs 6.39% of 2,925 and
breaks 5.82% of 4,075: per question help is the likelier outcome, and per corpus harm still wins. A
single delta cannot say which of the two moved, which is why the artefact carries both.

**Exchange rate** — repairs per break, `repaired / broken`. Out of sample 0.79 (187 repairs against 237
breaks); on dev 1.08 (67 against 62). The sign of the arm follows this ratio crossing one, and the
mechanism does not change across the split: both directions run at rates of the same order on both
corpora. Quoting the two rates without their bases is how a reshuffle gets read as a decline.

**Perfect-filter ceiling** — what a filter that removed exactly the broken questions and none of the
repaired ones would be worth, in percentage points of the corpus: 3.39pp out of sample, because 237 of
7,000 questions were broken. Not the same object as *Ceiling* below, which is the accuracy an oracle
selector could reach over the generated candidates. The read-time filter realises 0.51pp of this one,
15.2% of it.

**Baseline anchor** — the second query a grounding rule is compared against. The read-time filter is
defined on the *difference* between two statements: a name is imported when it appears in the served
query and in neither the question nor the bare attempt. Remove the anchor and the rule stops measuring
imports and starts measuring the schema vocabulary any correct query must use — it then flags 94.8% of
bare attempts. Every finding about the filter in this record is a finding about the anchored version.

**Youden's index (J)** — `sensitivity + specificity − 1`, the share of the corpus a binary rule sorts
correctly beyond chance. It is reported instead of a raw accuracy gap because the gap moves with the
flag rate: a rule that flags 95% of a corpus will show a gap between its two leftovers that says
nothing about the rule. Out of sample the question-only check scores **0.0257** and the diff-anchored
filter **0.1068**, which is the comparison that decided R33.

**Mechanism study** — a controlled experiment that isolates whether feedback becomes transferable
knowledge, holding the generator fixed. Not a benchmark result, and never quoted as one.

**Micro-ablation** — a targeted experiment that constructs the smallest workload in which a module
binds, because a whole-corpus arm would report zero for a module that simply never fires.

**Ceiling** — the best accuracy any selector could reach on the candidates a run actually produced,
computed from the answer key. A selector's delta is only meaningful beside the ceiling it was aiming
at: retrieving one point of a seven-point ceiling and retrieving one point of a twenty-point ceiling
are different results, and this project reports them as such.

**Dose control** — an arm that receives the *same* ranked pack as the treatment, truncated to a fixed
number of items, so that "more notes helped" can be separated from "the notes went to the questions that
had more to say". The distinction is not academic: the store reported a 4.13pp advantage for two items
over one, and the truncated arm measured **−0.33pp**, because the second item had been allocated to the
questions where any note was worth more. Any retrieval budget that varies per question needs this arm.

**Admission floor** — the per-question threshold above which a pack is shown at all, fitted on a fold's
own learning rows by maximising `helped − harmed` subject to keeping a minimum share of decisions and a
minimum number of decisive rows. Reported with the fold it was fitted on, because a floor that is not
re-fitted per fold leaks the evaluation rows into the decision. It is the only allocation rule this
record has measured that points up (+0.85pp) and the only one whose interval does not exclude harm.

**Oracle ceiling** — what a mechanism would be worth if the answer key chose for it: drop every item that
net-harmed, or keep the pack exactly where it helped. Compared against the run's minimum detectable
effect, it answers a question no interval can: *is there anything here for a better selector to find?*
A ceiling of 2.35pp against an instrument that resolves 2.01pp means no further experiment on that split
can distinguish a perfect mechanism from an inert one — the line is closed by arithmetic, not by defeat.

**Channel arm** — an arm that changes what the model *knows* rather than what it is told about its own past
mistakes: the schema annotated with the values each column holds (`values`), or pruned to the tables the
question names (`linked`). Its validity condition is that it rewrote the prompt at all — an annotator that
annotated no column and a pruner that pruned no table are the control under another name, and the null
either publishes is about the name rather than about the channel. `V51-channel-applied` is the gate, and it
holds the two kinds to different floors because annotation is unconditional and pruning is not.

**Outcome-blind stratifier** — a division of the questions computed from the inputs alone — question, hint,
schema — and never from any arm's result. A stratum defined by one arm's outcome cannot be used to estimate
a contrast involving that arm: conditioning on "failed without the hint" pulls that arm's rate down inside
the stratum, and part of the difference that follows is regression to the mean. Every stratification this
record publishes is outcome-blind for that reason.

**Memory prior** — a table keyed on the shape of an executed result, holding how often results of that
shape turned out to be correct, read from the other folds. It is the object a verifier reads when memory
*judges* a candidate instead of proposing one: no rule text, no relevance filter, no embedding, only
"on this shape, were we right before". The strength of the idea is that the key is a property of the
attempt rather than of the wording of a lesson, so it is complete at one observation.

**Position (of memory)** — where a stored item acts, of four: the prompt prefix, the retry, a feature
the verifier reads, or the prior the verifier is built from. This project measures the four separately,
because a rule that helps in one position and hurts in another is not a single claim: the same store
that costs 3.14pp as a prefix is worth nothing on retry, and the object that replaces it is not a rule
at all.

**Panel (density family)** — the fixed set of questions, one set per database, that every selected rule
from that database is shown. Shared rather than drawn per rule, so that two rules are compared on the
same questions and the control is measured once per question instead of once per rule.

**Density family** — a workload built to give every rule a fixed number of chances: a rule set held
constant across the measurement, one rule in each prompt so a flip has exactly one candidate cause, and
a panel of twenty questions per rule. It exists because the alternative — a pack of rules and an
attribution instrument that credits a flip to everything in the prompt — cannot separate "this rule did
nothing" from "this rule was shown twice".

**Floor (density family)** — the flip rate of a rule from a *different* database, shown on the same
panel. It prices the possibility that any text in the pack block moves answers, which would make every
per-rule attribution in this project an artefact of the block rather than of its content.

**Cross-fit (density family)** — a per-rule policy fitted on the questions it is *not* being scored on.
Each rule's panel is cut into five folds, the rule's sign is decided on four and scored on the fifth,
and the whole cut is repeated ten times so every question is scored once per repeat. The single split it
replaces decides on the first half and is scored on the second; that is one draw of a noisy estimate,
and the run that measured it found the two halves were not exchangeable. A cross-fit that earns no more
than the same machinery run on foreign rules says the fit is what moved the answers, not the content.

**Foreign panel (density family)** — the questions from *other* databases that every exercised rule is
also shown, ten per rule, drawn round-robin across schemas. The family's own panel keeps a rule inside
the database it was distilled from, which is the only setting in which a store that is retrieved across
databases has ever been measured here; the foreign panel is the other setting.

**Transfer stratum (density family)** — the group a rule is placed in by the net effect it had *at home*
— positive, zero or negative — before its foreign injections are counted. Stratifying by what the rule
did away from home instead would sort rules by the number the reading then reports. The claim under test
is about the positive stratum: a rule that never worked at home cannot have kept working away.

**Evidence curve (density family)** — the cross-fit re-read with the fit pool capped at the first *m*
observations of each rule, for *m* from four to the whole panel, scoring every trial each time. It
separates "this rule's sign is wrong" from "this rule has not been seen enough times to have a sign",
and the smallest *m* at which the policy clears its floor is the number of chances a deployment has to
pay for before it may show a rule at all.

**Power** — the sample size needed to detect an effect at a stated confidence. Stated per benchmark so
a null result is not confused with an underpowered one. `detectableDelta` implements it; `n ≥ z²·d/δ²`
with `d` the share of pairs that disagree and `z = 2.802` for 80% power at α = 0.05 two-sided.

**Minimum detectable difference (resolution)** — the smallest true effect a given sample would detect 80%
of the time: `2.802 · sqrt(b + c) / n` for `b` helped and `c` hurt among `n` paired cases. It is a
property of the *design*, computed from the discordance, and it is the number that says whether a
reported delta was worth reporting at all. On this project's record the sharpest design — 1,534
questions, 115 discordant — resolves **1.96pp**, and every mechanism claim the project has made is
smaller than that. `pnpm eval:power` prints every published delta beside its own resolution.

**Half-width** — `1.96 · sqrt(b + c) / n`, the 95% interval around a paired delta. It is **not** the
resolution: the ratio between them is a constant 1.43, so a report that says "±4.5pp" beside a gate that
reads "6.4pp" is quoting two different measurements that share a name. Any number in this documentation
that carries a `±` is a half-width; anything the word *resolvable* is applied to is a resolution.

**Dose** — the number of knowledge items a recall returns for a question, and the only quantity the pack
layer's character budget actually controls. The layer adds whole items in rank order and returns an
empty pack when none fits, so a budget is not a linear dial: on this project's store an item renders to
500–824 characters, a 600-character budget admits one item on 29% of questions, and the 1,200-character
default admits 1.83. A dose response is read in `mean_pack_ids`, never in the budget that produced it.

**Coverage (dose)** — the share of questions on which a dose arm injected at least one item. A cell at
0.29 items per question is 71% control, and its interval cannot bound a per-item effect better than
about ±5pp; the number to read before any delta from a reduced budget.

**Standing** — what the prompt says the model may do with a block of knowledge: whether it is
reference data it may disregard, or a record of failures it should avoid repeating. It is a property of
the *prompt*, not of the store, so changing it changes nothing about what was learned. Measured once
(R17): permission to disregard a block cost 0.57pp against the same block without it, and the sentence
that grants permission cost 2.00pp on its own when there was no block to disregard.

**Framing axis** — the set of dimensions along which the same knowledge can be presented: the register
(fact or recorded error), the standing (asserted or defeasible), and the label. One of the four axes
this project has closed, with content, quantity and position. That it is closed is itself a result: the
harm survived every re-description of the same text, which is why the remaining candidates are
mechanisms that change *when* knowledge arrives rather than *how* it reads.

**Anchored** — a delivery order in which the model drafts an answer first and then revises it against
the block, instead of reading the block before the question. The only mechanism in this record that is
not measurably harmful: +2.86pp against plain injection pooled over 700 questions (p = 0.0205), and
against a second pass that injects nothing **+3.43pp pooled over 700 question-pairs (53 gained, 29 lost,
p = 0.0106)** while sitting between no memory and a losing control. Read together, those numbers say the
anchored cell repairs a loss rather than producing a gain, that most of the repair is a licence to stop
rather than the note's content, and that the store's usefulness is stated as conditional on an existing
draft.

**Blind revision** — the second call of an anchored delivery with no block in it: show the model its own
draft, ask it to revise, add nothing. It is 4.00pp *below* answering once (R18, p = 0.0336, one sign in
all five folds), which makes it the control that turns the anchored reading from a gain into a repair,
and the reason a revision request is never assumed to be free.

**Licence to stop** — the clause that tells a revising model the draft may stand: "if none applies,
return the first attempt unchanged". It is the only text in the anchored prompt that speaks about the
draft rather than about the block. Measured once on its own (R20): 2.00pp better than a blind revision
when there is no block, and 0.57pp *worse* than the conservative clause when there is one — the two are
**substitutes**, because the conservative instruction already carries a licence of its own.

**Substitutes (standing and licence)** — two interventions that deliver the same thing, so that running
both is worth no more than running the better one. R20's interaction is −2.57pp: the permissive clause
recovers half of a blind revision's cost when it is the only licence present and nothing when the block's
own instruction supplies one. The practical rule this record now applies: adding a second sentence to a
prompt that already contains the first is not a second improvement.

**Precision (knowledge)** — the share of active rules whose payload matches the reference policy on a
probe grid of every context they claim. Separates "learned a lot" from "learned the right thing".

**Exchange rate (`helpPerHarm`)** — repairs per break: 187 / 237 = **0.789** out of sample. Never quoted
alone, because the two rates sit on different bases and the ratio that matters is the one below.

**Break-even exchange rate (the hurdle)** — the exchange rate at which memory pays for itself, which is
the **bare odds of being right** rather than parity: 4,075 breakable / 2,925 repairable = **1.393**. A
repair can only happen on a question the bare model got wrong and a break only on one it got right, so
equal rates are a net loss. The measured 0.789 against this hurdle is a 43% shortfall, not a near miss.
The same arithmetic gives the two ways out: repairs of 8.10% at fixed breaks, or breaks of 4.59% at fixed
repairs.

**Clearance** — the exchange rate divided by the hurdle. Below one is a memory that loses; 0.566 here.
One number, so that "close to a wash" cannot be said again without contradicting a ratio.

**Admission ceiling** — the most a gate that decides *which questions get memory* could be worth: admit
every repairable question and nothing else, and the break rate is zero by construction, so the gain is
the whole repair rate, **+2.67pp**. It is the mirror of the **removal ceiling** (+3.39pp, §8.7's filter),
and the two sum to the 6.06pp an oracle that knows the outcome could reach. Ceilings are quoted with the
share their mechanism realised, because a ceiling alone flatters every reading.

**Admission gate** — a predicate evaluated *before* generation, on the question and the database's own
history, that decides whether the pack is shown at all. Distinct from the read-time filter, which is
evaluated after generation on the difference between two queries, and cheaper: it cannot destroy a
correct answer, because it never touches one. Scored on **precision** — the share of admitted questions
the bare model would have got wrong — against the bar `b / (r + b)` = 47.6%, not on accuracy.

**Precision bar (admission)** — `b / (r + b)`, the share of an admitted set that must be repairable for
the gain to be positive. 47.6% on the corpus against a 41.8% base rate. **It belongs to the admitted
set, not to the corpus**: selecting questions moves their own repair and break rates, and on this corpus
the bar rises 16.8pp across the self-knowledge gate's sweep while the gate's precision rises 20.6pp —
close enough that the gate never crosses it.

**Variance selection** — what a question-level gate actually does when it selects on neighbourhood
failure. The admitted questions are ones the model is *unstable* on rather than ignorant of, so the break
rate inside the set nearly doubles (5.50% → 9.68%) while the repair rate does not move. The mechanism
that makes memory a wash — symmetry — is the same mechanism that defeats selection on a covariate.

**Injection** — one rule shown on one question. A pack of two rules over 7,000 questions is **13,578
injections**, and a flip is counted once per rule in the prompt because attribution is not exclusive. The
unit matters: 349 injections name a repaired question and 462 a broken one, against 424 flips.

**Dispersion statistic (the ledger's)** — a χ² over per-rule counts, summed across rules, compared against
a null that permutes **outcomes across questions** while every rule keeps the questions it was shown on.
That null is the whole design: packs of two make rules correlate, and a binomial null would report the pack
structure as heterogeneity. Observed 293.3 against a null whose 99th percentile is 280.4 — real, at
p = 0.0047.

**Rule reliability** — the split-half correlation of per-rule net rates across two disjoint sets of
databases, extrapolated to full length by Spearman–Brown (`2r / (1 + r)`). It decides whether a prune is
evidence or noise, and here it is **−0.31**: the second measurement would be better inverted. A reliability
below roughly 0.7 means an item's measured value is mostly its own noise.

**Per-item value** — the claim that a stored rule has a net effect which travels from the questions it was
measured on to the questions it will be shown on. Pruning needs it. This store does not have it: the
heterogeneity is an interaction between a rule and a database, not a quantity attached to the rule.

**Prune flag** — the coarse, deployable form of the ledger: a rule whose net is negative over at least ten
showings. It covers 58 rules and 2,545 questions which returned −0.55pp against −0.49pp for the rest — a
0.06pp difference on [−1.97, +1.56], i.e. no signal rather than a weak one.

**Pack size** — how many rules a prompt carries, which retrieval decides rather than the experiment. One
rule returned **+3.07pp** and two returned **−0.96pp** on the same corpus, a difference of +4.03pp
[+0.76, +6.62]; the contrast is positive on every artefact above a thousand questions and negative on
every 350-question pilot. A **lead**, not a finding: the singleton questions are harder (47.3% unanswerable
by the bare model against 41.4%) and pack size was not assigned.

## Terms this project avoids, and why

| Avoided | Used instead | Why |
|---|---|---|
| "Memory" as a synonym for the store | *store*, *knowledge* | Memory implies recall of episodes; this stores claims |
| "Accuracy" for the whole product | *first-pass acceptance*, *adherence* | Different questions; conflating them hides regressions |
| "Learning" for distillation | *distillation*, *admission* | Nothing is trained; the word invites the wrong expectation |
| "Prompt injection defence" | *injection screen*, *quarantine* | A screen plus a state, not a guarantee |
| "Semantic search" | *lexical retrieval with an optional embedding channel* | BM25 is the default because it wins on the measured workloads |
| "Hallucination" | *defect family*, *correction* | A correction is about a specific wrong output, not a model property |

**Subpath export** — a named entry into one package (`@agentix-e/microglia-core/apply`). It lets a
host import one module without importing the package's whole graph, which is what keeps "one
install" from meaning "one bundle".

**Provider** — a host-supplied model client: `LlmProvider` has one method (`complete`),
`EmbeddingProvider` has one (`embed`). The library never constructs one, and has no default.

**Provider registry** — the name-to-factory map a declaration resolves against. Resolution order is
instance, then registered factory, then a named error; there is no silent fallback to an environment
variable.

**Outbox** — the browser's local queue of corrections not yet accepted by the server. Entries carry an
idempotency key so a retry cannot record the same correction twice.

**Idempotency key** — a client-chosen string that makes a retried write a no-op. The server's map is
per process and the documentation says so: durability of the key store is the deployment's job.

**Task instance** — the unit of intent: a `taskId` and `taskType` under which one or more attempts are
opened and one terminal decision is taken. Distinct from a run, which is one generation.

**Attempt** — one run inside a task, numbered from 1 and never reused. `parentRunId` points at the
attempt it revises, so a chain can be walked without guessing.

**Terminal decision** — `accepted`, `abandoned` or `escalated`, recorded once per task and written as an
`outcome` event on the final attempt.

**Evidence independence** — the rule that support is counted per task rather than per event. Six
attempts of one task are one observation; six tasks are six. Without it, one persistent user can admit a
rule alone.

**Task support** — the number of distinct tasks that endorse a claim. It is the denominator admission
uses, and the reason a single long conversation cannot manufacture confidence.

**Utility** — `{ injected, flippedUp, flippedDown }` on a knowledge item: how many outcomes landed on runs
that cited it, and which way each went. The denominator that makes retirement a measurement rather than a
guess.

**Utility density** — `(flippedUp + 1) / (injected + 2)`, Laplace-smoothed. An unmeasured rule sits at 0.5,
so silence is not treated as failure.

**Curation** — the pass that merges near-duplicate statements and, only when asked, retires the
lowest-density items above a cap. Deterministic, dry-runnable, and never a rewrite.

**Merge closure** — a merged item is retired with `statusReason: merged:<id>` and a closed `validUntil`
rather than deleted, so the audit trail and past-tense queries survive.

**Provenance tier** — the shape of a signal: `user-text`, `structured-edit`, `outcome`, `host-asserted`.
Set from the event kind, never by configuration, and used to cap how far a lesson may travel.

**Promotion gate** — the rule that a `user-text` item cannot activate on one task's word. It stays a
candidate with `needs-corroboration` until a second distinct task, or evidence of a stronger tier, endorses
the same claim.

**Abstention** — a knowledge item recording that a kind of question cannot be answered as asked. Rendered in
its own block with an instruction not to invent an answer, and it speaks only when no positive rule clears
the activation threshold.

**Endorsing task** — a distinct task instance whose evidence supports a claim. Support is counted in
endorsing tasks, never in events, which is why the number appears in both the admission score and the
widening gate.

**Widening bound** — the meet of the endorsing scopes: the widest scope that still applies to every
endorser. A dimension survives only when all endorsers constrain it identically, and only `domain` may
be dropped, so widening can never claim more than its evidence asserted.

**Widening gate** — three distinct endorsing tasks before a claim may widen and its domain-scoped copies
are retired. A pair is the evidence one persistent user can manufacture; a destructive act needs more.

**Order invariance** — the property that the store rebuilt from a log is identical whatever order the
events were written in. It is a property of sorted reads and id tie-breaks, and it is measured, not
assumed.

**Replay determinism** — the property that the same log replayed twice builds the same store: no wall
clock, no ambient randomness, no id collision. Distinct from order invariance, which is about *which*
order.

**Mutation control** — a replay whose order-dependence is known in advance, run alongside the invariant
it is meant to falsify. If the control passes, the instrument is blind and the reported number is
vacuous; the integrity lane fails in that case rather than reporting a 1.00 it cannot defend.

**Erasure** — `forget({ ids | taskId | actorHash })`: delete the matched events and runs, re-derive every
claim that cited them from the evidence that survives, and rewrite the journal. Scoped to one namespace
by the facade, because a person is not a tenant.

**Tombstone** — the record left by an erasure: selector, time, ids erased. It never carries a statement or
a payload, because a copy of the erased data would defeat the erasure it documents.

**Erasure cascade** — the second-order effect of erasing evidence. A claim that loses support may fall
below the retirement line, lose a provenance tier it no longer has evidence for, and drop back behind the
promotion gate. That is the intended behaviour: a deletion that leaves a promotion behind has not deleted
the thing that mattered.

**Formation route** — a way to corrupt a memory without planting a false record: content, evidence, scope,
selection, path (MemForm, 2026). Each is an executable attack in this repository rather than a paragraph
in a threat model.

**Attack success** — the share of attempts in which a false claim becomes active *and* reaches the pack
for the question it should not answer. A claim that is stored but never injected is not a success, and the
harness counts the difference (`active-not-injected`).

**Capability-limited attacker** — the adversary the gate is written against: it controls content,
citations, scope claims, paraphrases and arrival order, but not the trust the host assigns to the channel
it writes through. A fully trusted attacker is a user, and its success is reported as a limit.

## reasonCode

The one scope dimension that says *what went wrong* rather than *what the claim is about*. A host
fills it from its own classifier — `no-rows`, `missing-column`, `syntax`, `row-count` — and the
library writes it on the claim at distillation time and filters on it at recall time. A note about a
failure is only findable by a failure if this is filled; measured on the public lane, filling it took
a keyed recall from 0 hits in 22 attempts to 25 in 26, and the accuracy did not move.

See also: scope, tier, reason code in `USER-GUIDE` §3.1.

## Protocol terms

**Candidate contract** — The interface between a generator and the harness: a module exporting
`contract`, `name`, `version` and `generate(request)`, where the request carries the question, its
evidence and the schema. Deliberately minimal, so a third party can be measured without porting their
system into ours, and deliberately placed outside `packages/eval`, which the loader enforces.

**Run artefact** — One run as a JSON document: the generator, every case with its answer or the reason
there is none, the metrics those cases imply, and the gates that judged them. Published as a JSON
Schema and validated by code that also checks the arithmetic — `accuracy` must be `correct / n`, the
per-database rows must sum to the totals. The report beside it is rendered *from* the artefact, so a
number in the prose that is not in the JSON fails the build.

**Pre-registration** — A file, `prereg/<id>.md`, with a machine-readable header (arms, sample, gates)
and two mandatory prose sections: the prediction and the refutation. The gate refuses a missing
section, an unfilled placeholder, or an id that disagrees with the filename; the benchmark workflow
refuses a dispatch that names none.

**Published cell** — A competitor's reported number together with the four facts that make it
comparable: model, schema representation, sample count and split. A cell without them is a headline.

**Admissibility** — The rule that a comparison may be called `reproduced` only when it was measured on
the same split, and is otherwise `indicative`. The difference between two estimates is judged against
1.96 standard errors of *each*, added: our 53.71% on 350 questions and XiYan's 53.52% on 1,534 are
`indicative`, and the 0.19pp between them is one fortieth of the 7.72pp band that would be needed to
call them distinguishable.

**Evidence sentence** — The curated, human-written, per-question knowledge BIRD attaches to every
question: 25 to 468 characters on this panel, mean 142. It is not written by this project and it is
present in `none` as much as in `full`, so every published number here was measured on top of it. It is
worth **24.86pp** on this panel, and removing it is the only *positive control* in the record.

**Positive control** — A manipulation whose answer the literature already knows, run to prove the
instrument can detect it. R23's is the evidence ablation, which three papers price at 8 to 21 points;
it came back at 24.86pp, which is what licenses reading the twenty-two nulls above it as nulls about
memory rather than about sensitivity.

**Substitution** — A retrieved note competing with the curated evidence sentence for the same job. It is
measured as a difference in differences, `(full − full-noevidence) − (none − none-noevidence)`, and it is
**−6.00pp** on this panel with an interval excluding zero: the pack absorbs 24.1% of the sentence's value
and costs 4.86 points when the sentence is present. Remove the sentence and the same pack is worth
+1.14pp — the cost belongs to the competition, not to the note.

**Store variance** — The part of a cell's movement that is neither the treatment nor sampling noise under
a fixed store. The store is rebuilt by a live distillation pass on every dispatch (632 corrections in
R23, 640 in R22), so the anchors move between runs on identical questions: `none` 54.00 → 54.57, `full`
51.43 → 49.71. It is **one to two points**, larger than several published deltas, and the reason every
claim here is made *within* a dispatch.

**Split** — A division of a benchmark's questions. Two are measured here: `minidev`, the 350-question
slice the transfer experiments use, and `dev`, all 1,534 questions. The split decides the manifest, the
question file, and one filter — `simple` questions are dropped on `minidev` because a question answered
without memory carries no signal for a transfer experiment, and kept on `dev` because the sample size
*is* the claim being reproduced.

**Split-dependent artefact** — A run writes the artefact of the split it measured:
`poc-sota-bird.json` for Mini-Dev, `poc-sota-bird-dev.json` for dev. Two files rather than one
rewritten, because a row in the comparison table is only honest while the artefact behind it is in the
repository to be recomputed. `chooseArtefact` resolves which one a downstream command reads, and
`SOTA_ARTEFACT` overrides it.

**Design-suffixed artefact** — The split is not enough to name a file. A run that names a
pre-registration appends that id to the split's own — `poc-sota-bird-dev-R24-dev-split.json` — so two
designs measured on the same 1,534 questions cannot land on one path, while a re-dispatch of one design
still writes one file. Without it the second design's write *replaces* the first's evidence and nothing
fails, because what lands is a valid artefact with a different number in it; the only reader that
notices is the one that re-derives a published cell instead of quoting it. A run with no
pre-registration keeps the split's plain name.

**Template slot** — An identifier in a rule's statement that the rule's *own* database has, lifted out
of the sentence: `Cast {price} to real when {price} is text`. The structure is what survives a
database boundary; the slot is the part that has to be replaced. A rule with no such identifier is
*slotless* and travels as prose, because there is nothing in it a binding could touch.

**Binding** — Filling a template's slots from the schema of the database the rule is about to be
shown in, by the Jaccard overlap of the two names' `snake_case` parts (identity 1, `price` →
`unit_price` 0.5, nothing below 0.5). Ties go to the shorter name. Two slots never bind to one
candidate, and a slot with no candidate withholds the rule.

**Link binding** — Filling a template's slots from the schema the *question* links rather than from
the whole target schema: a table slot binds to a table the question names, and a column slot binds
inside the table its template reached, by name overlap **and** agreement in kind (`integer`, `text`,
`real`, `temporal`, `blob`, with an undeclared type agreeing with everything). It halves the withheld
share of a store (66.8% → 48.6% of rules) and does not carry a rule across a schema boundary in
practice: of the attempts it still refuses, six in ten are a column the target database does not have
at all.

**Own-case probe** — The store asked to reproduce the correction it was built from: each corrected
learning question is re-asked twice, once with a blank retry and once with the rules distilled from
it, and the two answers give one of four verdicts. Two calls per corrected case, learning rows only,
so it cannot see the questions it filters. The instrument decides whether a pack is a mechanism or a
noise generator, which no pack-versus-no-pack comparison can.

| | retry alone right | retry alone wrong |
|---|---|---|
| **with the rules right** | `redundant` | `supplied` |
| **with the rules wrong** | `broke` | `useless` |

**Supplied** — The rules turned a failure into the correction that a blank retry did not reach. The
only verdict that shows the extraction doing work. Measured at 19 of 156 corrected BIRD cases (12.2%).

**Useless** — Neither the blank retry nor the retry with its own rules reached the correction, so the
experience did not reproduce its own case. 103 of 156 on the same run (66.0%), which is the number
that makes the extraction, rather than retrieval or injection, the bottleneck.

**Broke** — A retry alone was right and the same retry with the rules was wrong: the sharpest
available evidence of a *wrong* rule rather than an unhelpful one. 3 of 156 cases, and 6 of 296 rules
excluded from a store by it.

**Admitted rule** — A rule that reproduced at least one of its own cases and broke none. The store a
`full-verified` arm answers with: 38 of 296 rules on BIRD (12.8%). Admission is a filter on evidence,
not a claim that the rule helps — the admitted store moved 342 of 350 packs and 0.00pp.

**Withheld** — A rule the binder refused to show because at least one slot had no referent in the
target schema. A withheld attempt makes no model call, contributes no trial, and is counted: `V28`
holds `bound + slotless` equal to the rule-database pairs the foreign ledger carries, so a rule that
vanishes is visible as a defect rather than plausible as a result.

**Binding census** — The withheld share of a store, computed from the artefact and the schemas with
no model call (`pnpm eval:template`). It is the number that decides whether a transfer arm is worth
dispatching: at 66.8% withheld, an experiment on this store would measure the binder. `homeless`
rules (no home database) and `unplaced` ones (no foreign schema to be shown in) are counted
separately, because neither is a failure of the binder. Two censuses run: `name` against whole
schemas (one attempt per rule-database pair) and `link` against questions (one attempt per
rule-question pair), and each writes its own artefact so the two readings cannot be confused.

**Attempt timeout** — How long one request may take, derived from the reply it was allowed to
produce: `25s + 140ms/token`, capped at 300s. A constant is a bug that hides until a run is long,
because the client then aborts requests that are succeeding and retries them as though the provider
had failed. `timeouts` and `retries` are counted separately for exactly that reason.

**Deadline** — A wall-clock limit the run holds over itself (`MG_E_DEADLINE`), checked between
attempts and set below the runner's step timeout. A step timeout kills the process and takes the
measured folds with it; a deadline stops the run and writes what it has. The two are different
answers to "the run cannot finish", and only one of them is a result.

**Transfer trial** — One admitted rule shown one *other* corrected question from the same database,
paired with the bare retry of that question. The pair yields four counts: `repaired` (a target the
retry could not fix, which the rule fixed), `broke` (a target the retry already fixed, which the rule
destroyed), `blank_right` (needed nothing, stayed right) and `unchanged` (needed help, got none).
Repairs per question ≈ (admitted rules per pack) × `rate`, which is why the ratio and the pack size
are published together: 0.42 × 7.3% is three questions in a hundred, and that is the whole claim.

**Break rate** — Of the transfer targets a bare retry already repaired, the share the rule then
broken: 30 of 50, 60%, on the BIRD store, against 32 of 62 for the repair substrate in the same run.
It is the loss side that `rate` cannot see, and the reason `net_pp` is a gate (V17, V42) rather than a
column somebody may or may not read.

**Reproduction** — The share of a store's own corrections it can re-derive when the correction is in
the prompt: 29.73% for the rule substrate, 47.97% for the repair one, paired at +18.24pp. It is a
property of the *extraction*, and the measurement that shows it is not a property of the product is
**transfer**: the same two stores repair a foreign question at 6.28% and 6.21%, a tie.

**Transfer rate** — Repairs over informative trials: of the foreign targets a bare retry could not
repair, the share the item repaired. The denominator excludes every trial where the item can do
damage, so the ratio can only go up and is never an answer alone; `break_rate` and `net_pp` are read
beside it. Measured per substrate and never merged: 6.28% for the sentence, 6.21% for the account.

**Control hole** — A transfer trial whose *blank* call never returned. It is not "the retry failed":
without a control there is no denominator, so the trial is `unmeasured`, is counted in
`unmeasured_blank`, and can never be a repair. The defect this rule closes was the opposite — a hole
recorded as `false`, which put the trial in the informative set and credited the rule with work nobody
measured.

**Substrate** — What a correction is turned into before it is stored. The *rule* substrate is one
declarative sentence about the workspace; the *repair* substrate is three sentences that compare the
failed attempt with the correction — what it did, why that returns a different answer, what replaced
it. Both are built from the same events by the same pipeline and differ in one instruction, which is
what makes them comparable at all.

**Paired substrate comparison** — Both stores asked to reproduce the *same* source question, with one
shared control, and compared with McNemar's exact test over the discordant pairs. Two independent
rates of 20% and 26% at n ≈ 300 carry intervals wide enough to overlap; on the same questions the test
uses only where they disagree. The questions only one store covered are counted and gated (V36),
because an intersection chosen by the stores is not a set anyone designed.

**Shared control** — The blank retry verdict for a source question, measured once and reused by every
substrate. The blank prompt is built from the question, the attempt and the observed failure — none of
which depend on the store — so re-asking it would only re-sample the endpoint: 16.4% of questions come
back with a different query under the same prompt. A hole is carried as a hole rather than re-asked.

**Prefetch** — The optional second phase of an interpreter: told the batch's contexts before the first
claim is applied, it may pay the calls' round trips concurrently, while the claims themselves are
still applied in corpus order. The prompt for a claim depends only on its own event, which is what
makes the split safe; the order of the claims matters because a claim's effect on the store depends
on what is already in it.

**Warm-up** — What a prefetch does when the model port memoises its replies. An interpreter with no
prefetch and a prefetch that warms nothing both leave the serial pass unchanged, which is why the
default width is one and why the option is invisible to every caller that does not set it.

**Clearance** — Removing records from a *pack* because their measured utility is negative, as opposed to
retiring them from the *store*. The distinction decides what an experiment can conclude: a retirement
shrinks every later pack and is therefore confounded with dose, while a clearance leaves the store
intact and changes only what one question is shown. In this project a clearance removes a rule whose
counterfactual record shows more harms than helps, keeps every rule it has no record of, and is always
run against a control that drops the same amount at random.

**Decisive comparison** — One learn-row question whose answer *changed* depending on whether the pack was
present. Questions answered correctly both ways, or wrongly both ways, teach nothing about the pack and
are excluded, which is what removes the difficulty confound: difficulty is the part that is identical in
both halves of a pair. The count is small — 7.4% of this corpus's learn rows — and that scarcity is the
binding constraint on every utility-based filter here.

**Dose-matched control** — A control that removes the same *amount* of text as the treatment, so a delta
is attributable to which items were kept rather than to how many. Matched on characters or on items
whichever the treatment moves; matching on items alone is degenerate on a pack of one, where removing the
single item leaves nothing for either arm to keep.

**Raw event** — One correction as it happened: the question asked, the query that came back wrong, and the
query that fixed it, all three verbatim. Everything the store holds is an interpretation of one of these,
and the raw form is the only substrate in this project that adds no verb, no condition and no
generalisation — nothing a reader can imitate as a rule.

**Domain scope** — The `scope.domain` field on a claim: which database, site or tenant it was learned
in. It is the one scope field a *host* must fill in, because the prompt forbids the distiller from
guessing one and the run's input already states it. Its presence is what makes two things possible at
once: a claim can be withheld from a foreign question, and a claim that recurs across domains can earn
the right to be widened beyond them. A store whose items all arrived without a domain has neither
property, and `V44-domain-accounted` is the gate that says so.

**Composition** — What a split's question mix does to an effect measured on it. A hint worth 22.99pp on
moderate-and-challenging questions and 14.05pp on simple ones is worth 17.60pp on a panel that is 60% simple,
and that weighted average is the number a whole-split comparison must use. It is the opposite of an
**inflation**, which is the same effect measured wrong on a small sample: inflation shrinks when the sample
grows, composition does not, because it is not an error. The distinction is decidable inside one dispatch —
restrict both sides of a *paired* comparison to a subset of questions, and the pairing and the store are held
while the population is not — and it is undecidable across two, because the store is rebuilt each run.

**Same-unit control** — a system cited not as an alternative product but because it published **one
measurement in the unit we also measured in**. RSL-SQL is the clearest case: its 12.71pp schema-linking ablation
and this project's 17.60pp evidence ablation are both Δpp on the same 1,534 questions at the same model family,
so the two can be subtracted; its leaderboard EX cannot be subtracted from ours, because the systems differ in
the generator's training, the candidate pool and the schema form at once. The distinction decides what a number
licenses: a **product competitor**'s figure says where to spend engineering on the artefact, a same-unit
control's says which of our own components is mispriced. Three misreadings in this project's own documents came
from running the second comparison through the first question.

**Adapter cut rule** — the single question that decides whether a measurement module belongs to the protocol or
to a scenario: *does the function signature mention a scenario type?* A gate reading `pack.admitted`,
`arms[].discordant` or `folds[].partition` does not and belongs to the protocol; a gate executing gold SQL or
parsing a fenced example does and belongs to the adapter. Of this project's 39 gates, **37 fall on the protocol
side and 2 on the adapter side** — and the first estimate, made by reading gate *names*, put nine portable gates
on the wrong side, which is why the rule is applied to field reads rather than to vocabulary.

The rule is necessary and not sufficient, which the second scenario established: **a signature can be
scenario-free and a gate still unreachable**, because the field it reads may exist only in an arm the lane never
ran. The cut rule answers "does this belong to the protocol", not "will it fire here", and `V45` is the counter-
example that made the difference visible. The second question belongs to the **arm index**.

**Arm-indexed gate** — a gate whose firing depends on the lane having run the experiment whose bookkeeping it
reads. Thirty of the 39 gates are arm-indexed for τ²-bench: `V46-raw-is-verbatim` needs a raw arm,
`V45-clearance-dose-matched` needs a clearance arm and its dose-matched control, `V34`–`V36` need a second store.
This is why "the gate set is scenario-agnostic" was a wrong claim and "the apparatus is scenario-agnostic" is a
right one: the gates are a **catalogue of validity conditions**, and each lane instantiates the subset its arms
can support. A lane reports that subset, plus the arm each remaining gate would need — which turns the gap into
a work plan rather than into a number nobody can interpret.

**Vacuous gate** — a gate that fires, passes, and certifies nothing, because the collection it quantifies is
empty. `V6-controls-inject` evaluates `every` over the list of pack-based control arms: with no such arm the
predicate is vacuously true, and the gate prints *"no pack-based controls configured"*. All seventeen published
artefacts that carry `V6` carry that sentence, and sixteen of seventeen carry `V7-channel` the same way. They are
kept rather than removed — the sentence is a true statement about the run, and deleting it would change seventeen
published files — but every report that counts its gates counts these separately, because folding them into the
informative ones would report four gates where two do work.

**Lane adapter** — the five-method contract (`load`, `prompt`, `parse`, `score`, `strata`) a scenario implements
to be measured by the shared protocol. It is deliberately small: anything more pushes a decision into the lane,
anything less makes the lane copy the protocol. Two properties are load-bearing beyond convenience — `parse`
returns `undefined` rather than throwing, so a malformed reply is scored as unparseable instead of killing a
fold, and `strata` receives a task and nothing else, so an **outcome-blind stratifier** is enforced by the type
signature instead of by discipline.

A third property was learned from the first implementation. The contract reads as though a lane sees the model's
raw reply; a lane whose agent is a separate process does not. For τ²-bench, `parse` parses **the evaluator's
receipt** and `score` reads the verdict out of it — and that is enough, because no gate inspects a candidate's
shape, only its outcome. What the contract needs is a verdict per attempt, not a transcript.

**Imported identifier** — A schema name that appears in the memory-assisted query and in neither the
no-memory query nor the question. `pnpm eval:query-diff` counts them, and the count is the only covariate in
this project that separates a rule that helped from a rule that hurt: questions with one or more lose 9.68pp
while the rest of the corpus gains 1.45pp.

The older wording of this entry said the identifier is imported *from the rule*, which is to say the rule
supplied a fact the question did not. That is now measured and it is false in most cases — see
**pack-supplied name** below.

**Pack-supplied name** — An imported identifier that the text of the injected rules contains. Detected by
`pnpm eval:mediation`, which holds the exact text the model read for every question. 60 of the 155 importing
questions on dev are pack-supplied (38.7%; 79 of 285 names, 27.7%).

**Schema-supplied name** — An imported identifier the pack's text does **not** contain, in a query that
executed. Execution is what makes the name real: a statement that runs cannot have named a column its table
does not have, so the model took a real column out of the `CREATE TABLE` block and the question never asked for
it. 94 of the 155 are schema-supplied.

**Unverifiable name** — An imported identifier the pack does not contain, in a query that did **not** execute.
It is not called *invented*: a failed statement may have named a real column and failed on a date format, a
function or an ambiguity, and the record does not say which. One question on dev is in this bucket.

**Mediation** — The reading that separates the three above. Its result is that pack-supplied and schema-supplied
questions are damaged by the same amount (−8.33pp against −9.57pp, a gap of 1.24pp with a 14.74pp half-width),
so the damage is not caused by a rule naming a column; the pack changes what the model writes and the imported
name is the symptom. The product consequence is that a filter on *rules* cannot reach it and a filter on
*queries* can.


**Grounded** — A name is grounded when the question or the evidence contains it. The check has two modes and
both are reported: **strict** requires the name as a whole word (so `raceId` is *not* grounded against
"qualifying race No.903", though it is the right column), and **morphological** also accepts a name that begins
with a question word of three letters or more. A finding that survives both is not a tokeniser artefact; one
that survives only the strict rule is.

**Resolution gap** — The difference between two paired deltas, with a half-width of
`1.96 · sqrt(SE₁² + SE₂²)` because the two groups are disjoint and their standard errors add in quadrature.
It is the number that decides whether a covariate *separates*: a split whose gap is smaller than its own width
is a split with nothing in it, and this project has measured four of those.

**Split** — One of the three BIRD question sets the lane can measure, named `minidev`, `dev` or `train` and
refused rather than defaulted when it is anything else. The three answer different questions and only one of
them is comparable to a published cell: `minidev` (350 questions, the easiest third dropped) is for transfer,
`dev` (1,534) reproduces a published measurement, and `train` (7,829 over 58 databases) is the only
out-of-sample set this benchmark offers. **A split is a manifest**, not a constant: the archive, its digest, the
question file, the nested-archive layout, the questions scored and the databases selected all live in
`eval/manifests/bird-<split>.json`, because each of the three differs in at least one of them.

**Selection** — The databases a manifest declares, which is not the same as the databases the archive carries.
For `dev` and `minidev` the two coincide. For `train`, 69 databases unpack to 32.4 GB while the questions sit on
the small ones, so the manifest names 58 and the lane scores **7,829 of 9,428** questions from 2.4 GB. The
dropped count is printed and carried in the artefact: a smaller `n` is explained rather than discovered.

**Out-of-sample** — A measurement on questions the hypothesis was not formed on. This project had none until
R30 stage 2: every estimate it holds was formed and measured on the same 1,534 dev questions, and the two
cheaper exits are both closed by measurement rather than by argument — a fresh split of `dev` is in-sample by
construction, and **496 of Mini-Dev's 500 questions are dev questions**, so it is a slice and not a second
sample. `train` is the only source, and its accuracy is deliberately **not comparable to any leaderboard row**:
BIRD publishes no test cell for it, and every system's train accuracy is measured on questions it may have
trained on.

**Precheck** — `pnpm eval:split-precheck`. Loads a split through the lane's own manifest reader, question
parser, pool rule, selection and population check, and stops before the first model call, returning `ready` or
`blocked` with the reasons. It answers the one question a lane can otherwise only answer by spending a
dispatch. On `train` it was worth five defects, four of which fail *after* the 8.9 GB download — and the reason
no unit test found them is that every test loads a fixture written against the same split the code was written
against.

**Assignment test** — A contrast measured by *giving* every unit the treatment, rather than by comparing the
units that happened to receive it. R35 found that questions whose pack held one rule outscored questions whose
pack held two by 4.03pp; that is an observation, because retrieval decides pack size and the two groups are
different questions. R25 had already paid for the assignment: a `full-one` arm that serves the first rule to
every question. It reads −0.33pp, so the contrast was the questions. **A variable a system assigns is a
candidate mechanism; a variable its own retrieval assigns is a candidate confound**, and only an arm that
assigns it can tell the two apart.

**Marginal item** — What the item a prompt did not carry would have done, counted in the four cells the two
arms can disagree in: repairs it carries (a question the bare model missed that only the pair fixes), repairs
it prevents (only the single rule fixes it), breaks it prevents, and breaks it causes. On the 1,534-question
dev split the second rule carries 23 repairs and causes 27 breaks — 0.85 per break — while preventing 15
repairs and 24 breaks, so its net effect is **+5 questions** and its own record is a net harm. The two are not
in contradiction: the item changes what the other item does.

**Additive pack** — A pack whose effect is the sum of its items' effects. This one is not: removing an item
changes the answers the remaining items produce, which is why an exchange rate computed per item does not
predict the pack's, and why no budget, top-k or density threshold can be tuned by asking how many items fit.
The identity that makes it checkable is that the four marginal cells sum to the measured contrast — −5
questions on the dev split — and it is a test in `assignment.test.ts`.

**Grain (of a memory write)** — What a stored item *is*, as opposed to what it says. Every earlier round of
this programme changed the wording, the count, the filter or the audience of a memory item; the grain is the
object itself. The rule grain is a sentence of advice about how to build a query: it has no referent, so a
reader cannot check it against the question in front of them, and it is applied wherever it is read. The
definitional grain is `{term, statement}`, where the term is a phrase copied from the question that taught the
entry, so the item can only be retrieved by that term and can only speak on a question that contains it. R37
measured the second against the first on the same store, the same folds, the same budget and the same model:
**−0.59pp [−2.09, +0.91]**.

**Referent** — The thing a term names in this database. A definition has one; advice does not. This is why the
licence below is enforceable at all: if an item names a referent, the question either contains that name or the
item does not apply.

**Licence (lexicon)** — The pair of predicates that make the definitional grain a grain and not a second block
of advice. At write time `admitLexicon` refuses a candidate whose term does not occur in the question that
taught it (reasons: `lexicon-no-term`, `lexicon-term-not-in-question`, `lexicon-term-too-short`,
`lexicon-looks-like-query`). At read time `lexiconPackOf` renders an entry only on a question that contains its
term, matched on word boundaries with an optional plural and no substring matching, so `rate` cannot be licensed
by `separate`. `V64-lexicon-is-licensed` re-checks the *rendered lines* rather than the store, because a
licensed store and a renderer that ignores the licence produce the same store and a different prompt.

**Reach (of a representation)** — The share of held-out questions on which a representation renders at all.
R37's arm was licensed and reached **132 of 1,534 questions (8.6%)**, because 179 entries distilled from 547
corrections collapsed to **13 distinct terms** the corpus repeats, with two terms covering 107 of the 132. A
representation that reaches a twelfth of a split cannot be measured on that split; this is why the round
registered a feasibility clause before it ran.

**Inconclusive by feasibility** — The adjudication for a round whose arm was not `none` under a second name and
was not a refutation either: the store was built, the licence held, and the block rendered on too little of the
split for the contrast to be about the hypothesis. It is a distinct outcome from "not met", and R37 shipped the
clause *before* the run so that a feasibility failure could not later be read as evidence against the grain.

**Bridge (annotation)** — One mapping the benchmark's `evidence` block carries: a phrase a question uses,
and the database vocabulary that phrase denotes. `Eligible free rate for K-12 = \`Free Meal Count (K-12)\` /
\`Enrollment (K-12)\`` is a bridge. 90.35% of BIRD's dev questions carry an evidence block and 91.3% of those
parse into at least one bridge, so the annotations are the key universe a definitional memory could have
had — which is what makes a reach ceiling measurable without a model.

**Density (of a key)** — How often the corpus annotates a key, over how often its questions mention it. It
is the corpus's own judgement about whether a phrase needs defining wherever it is used, and it is the only
separator this project found between a term and a word: `single bond` is annotated every time it appears
(density 1.0) and `list` is annotated once in 272 (0.004). Mean density is **0.967** for keys mentioned in
three questions or fewer and **0.077** for keys mentioned in fifty or more — the inversion that explains why a
definitional store runs out of reach.

**Frontier (of a term store)** — Reach as a function of how many distinct keys a store holds, computed over
the corpus's own keys. It answers a question a single reach number cannot: whether a low reach was the
corpus's ceiling or the store's construction. At the 13-key size the definitional arm used, the frontier is
**241 questions at density 0.5**, 148 at 0.8 and 78 at 1.0, against the arm's licensed 132 — so the arm was
near the frontier and the frontier itself is the limit.

**Reach ceiling** — The share of a split a representation can never render on, whatever its store. Holding
every key the annotations treat as vocabulary, **34.1% of BIRD dev is never reached** at density 0.5 and
**47.7%** at density 1.0. This is a property of the corpus and not of a store, which is why it closes a route
rather than a round.


**Resolution (of a contrast)** — The smallest difference a paired sample could detect at 80% power,
`√(z²·d/n)` with `d` the share of discordant pairs and `z = 2.802`. It is a property of the design rather
than of the result, and it is the column that decides whether a delta is a measurement or a number. The
record's design sizes impose median floors of **4.38pp at 350 questions, 2.07pp at 1,534 and 0.82pp at
7,000**.

**Decided (a row)** — A published contrast whose delta is larger than its own resolution. Distinct from
*significant*: the 80%-power bar is stricter than a 95% interval, so a row can clear the interval and still
be undecided. The 7,000-question memory run is exactly that shape — −0.71pp against a 0.82pp floor. **18 of
the record's 98 arm rows are decided, and the smallest of them is 4.57pp.**

**Price (of a question)** — The number of questions it would take to decide an effect of the size a run
found, at the discordance it observed: `n = z²·d / δ²`. A price is a reason to stop asking rather than a
plan to ask: the cheapest undecided row in the record costs 352 questions and the dearest costs 1,457,294.
A zero effect has no price and is reported as `null`.

**Shrinkage** — Whether a contrast's median magnitude falls as the sample grows. A real effect does not
shrink because more questions were asked, so a fall is evidence that a pilot exaggerated. `full − none`
falls from **2.86pp at 350 questions to 0.33pp at 1,534**; `linked` rises from 7.71pp to 9.26pp and is the
one contrast in the record a larger sample confirmed.

**Two baselines** — An arm can be compared against the no-memory run (`none`) or against the `full` arm, and
the record publishes both for the same arm: `values` is **+1.17pp against `none`** and **+0.85pp against
`full`**. Neither is wrong and they answer different questions, which is why every row in the resolution
ledger carries its `control` in the row and in the contrast name.

**Adapter (layer)** — The package that owns everything a scenario needs and nothing else:
`@agentix-e/microglia-sql` holds the seven modules that execute, guard, differ, link and render SQL,
**1,766 lines**. The cut is one question about a signature — *does the function mention a database?* —
and the reason it is a package rather than a folder is that a rule can only be enforced across a
boundary the compiler can see.

**Layer rank** — `core ← protocol ← sql ← eval`, with `browser` beside `eval` and `node` above
`browser`. A package may import only from a strictly lower rank, and `V73` fails the build on any edge
that points at an equal or higher one. Five edges exist today and every one is downward.

**Coupling (of a module)** — Whether the module names a database in **code**, by the strict list
`sql`, `sqlite`, `nl2sql`, `text-to-sql`, `bird`, `m-schema`. Comments are excluded, because a module
that explains why it is *not* SQL-specific is not coupled to SQL. `query`, `schema`, `table` and
`column` are excluded on purpose: they are also a memory store's vocabulary, and a gate that cries wolf
gets suppressed.

**Deferral** — A module outside `packages/sql` that names a scenario anyway, with the dependency that
keeps it there written into `DEFERRALS`. There are twelve, from *the dataset loader* through *the
record field is a string* to *the lane that has not been split yet*. A thirteenth cannot arrive
silently: `V72` fails until it is moved or a reason is written.

**Verdict** — `adapter` (it lives in the adapter package), `deferred` (it names a scenario and has a
reason), or `general` (it names none). The verdict is derived from the package and the word count, so a
row cannot disagree with where the file is.

**Cross-domain arm** — An arm that learns from one scenario and is scored on another: the store is
built from τ²-retail corrections and answers τ²-airline tasks, with the same task set scored by a
memory-free reference. It exists to put the protocol's transfer gates in front of a scenario they were
not written for, not to improve a score.

**Scenario-qualified id** — `airline/3`. τ² numbers every domain's tasks from zero, so a bare `3` is a
name two scenarios can both claim; qualifying it is what keeps an evaluation set from intersecting the
training set it was drawn from. The qualification happens where the result document is read, so the
split, the pair and the ledger all use names that cannot collide.

**Transfer trial (τ²)** — One evaluated episode, scored twice: once by the reference arm and once by
the memory arm. **Informative** means the reference failed, so the pack had something to repair;
**broke** means the reference passed and the memory failed; **unmeasured** means one of the two
verdicts is `null`. It is the episode-level analogue of BIRD's rule-by-question trial, and it can say
whether the pack helped but not which item in it did.

**Informative floor** — 100 informative trials. Below it the transfer rate is a direction rather than a
rate, and `V16-transfer-resolvable` fails rather than reporting a number. A foreign pack is expected to
fail this floor; passing it on a cross-domain arm would mean the floor was being cleared by trials that
were not informative.

**Scenario bar** — The published `pass^4` a run is graded against **and the scenario it belongs to**.
ALTK-Evolve's 0.575 is a τ²-retail number; grading an airline run against it would publish a difference
between two scenarios as a difference the memory made, so the artefact records
`published_bar_applies: 0` and the run's only comparison is the paired one.

**Recall scope (of a store)** — The scenario an item was stored under, which recall filters by. A
`retail` store serves nothing to an `airline` question unless the caller asks in the store's own terms,
so a transfer arm recalls under the learned scenario deliberately — that recall is the treatment, not a
configuration detail.
