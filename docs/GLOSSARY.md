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
applies, distilled beside the statement and rendered *before* it. It is text for a reader before it is
anything else — measured on BIRD, rendering it changed half the answers and none of the scores — and it
is also half of the item's *recall text*, so a condition that names the situation a question is about
raises that rule's coverage and a condition that is always true raises nothing. A condition the runtime
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

**Fold** — collapsing items that state the same routine into one line at the render boundary, keeping
the group's medoid and reporting the support the group carries. A delivery decision, not a store
mutation: the items the store holds are untouched, so one dispatch can serve the per-failure pack and
the folded one from the same recall. Requires two distinct tasks behind a group; folding two records of
one task would report a task as having been taught twice.

> **Not to be confused with a fold of a cross-fit**, which is one *half* of a corpus read in one direction —
> `official` learns from the 74 published train tasks and answers the 40 published test tasks, and
> `official-swapped` does the reverse. The two meanings share a word because both are about putting two things
> together; one folds items, the other folds a corpus. Where a sentence could be read either way, this record
> says "fold (render)" or "fold (cross-fit)".

**Fold record** — the file a cross-fit is actually run on: one fold's ledger, its two id sets and its treatment
identity, composed from the run's pair artefact by `pnpm eval:fold-records`. It exists because a pair artefact
can be silent about its learning half and its treatment — the reference arm has neither to state — and a pool
that guessed would be checking nothing. Every value a record did not read from its own artefact is named in its
`derivation` field, so the composition is auditable without re-running it.

**Routine (shape)** — the ordered list of tool names a record states, without their arguments:
`get_order_details > exchange_delivered_order_items`. The arguments are the instance, the sequence is
the routine. This is the unit ExpeL's `UPVOTE` merges and the unit a workflow-shaped memory is organised
by; `RecallQuery.shape: 'collapse'` is how a pack delivers one line per routine instead of one per
failure.

**Containment control** — the check that makes a two-unit run a comparison rather than two experiments:
on every request the character budget did not cut, the folded pack's ids must be a subset of the
per-failure pack's, and the two sizes must differ by exactly what the fold reports removing. Requests a
cut pack excludes from the assertion are counted and printed, never silently skipped. Its counterpart in
a note or floor experiment is an *identity* control, which asserts the packs are equal; a fold cannot
have that, because changing the pack is what it does.

**Support** — the number of distinct tasks behind an item, as distinct from the number of feedback
events. `evidence.length` counts observations; support counts the tasks they came from, and a memory
whose items each came from one task has support 1 however many events it holds. Reported per rendered
unit on `KnowledgePack.fold.support`, at the two levels the literature's cells are named after (≥2 and
≥3 tasks).

**Distillation** — the batch process that turns feedback events into knowledge items. Idempotent:
replaying the same events creates nothing new, because evidence is deduplicated by feedback id.

**Domain pack** — a package that teaches the core what an edit means in one product's output format.
Implements canonicalisation, validation, edit classification, semantic distance, and the payload
shape. `nl2charts` is the reference.

**Event kind** — the kind whose items are records of episodes rather than claims about them, and
therefore the one kind exempt from the contradiction rule (`isEventKind`). Every other kind asserts
what is generally the case, so two items of one kind in one scope with different content are a
disagreement and the store resolves it. An `exemplar` asserts that something happened once: two orders
cancelled on two afternoons both happened, and refuting the first when the second is written would be
reading chronology as contradiction. The exemption is a statement about the object, not a tolerance in
the ranking — records are admitted on source trust and their own confidence, so a second similar record
does not corroborate the first, and `applied` stays zero because a record advises nothing.

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

**An absent scope dimension is a wildcard, and that is a decision rather than a detail.** A rule that
states a `domain` and no `intent` matches every intent; a rule that states neither matches every
question in its task. This is what makes a store written from few examples usable at all, and it is
also the difference between *bounded* and *unbounded*: only `when` (the condition the rule was learned
under) survives as a bound once every dimension is open. The asymmetry is worth knowing because the
neighbouring field does the opposite — an absent `polarity` means **unclassified, never `pass`** — so a
record that is silent about *where* it applies is treated as universal while a record that is silent
about *which side* it came from is treated as unknown. Read the two together before trusting a store's
width.

**Universal rule** — a stored record that states no condition (`when`) **and** declares no optional
scope dimension. It applies everywhere in its task and to everything, which makes it the object the
memory-harm literature measures: *The Memory Trap* (arXiv 2611.07554) finds notes from benign sessions
governing high-stakes ones in 35–81% of episodes, *Useful Memories Become Faulty* (2605.12978) shows
consolidation stripping the applicability condition, and *MemDev-Bench* (2610.27524) attributes its
failures to reusing a rule without reassessing its applicability. `universalityCensus` counts them from
any artefact that carries `storeItems`, at no cost, and `pnpm eval:retrospect` prints the number beside
the side reconciliation.

**Applicability** — whether a stored rule holds *for the task in front of it*, as distinct from whether
it is in scope. Scope is a filter over declared dimensions; applicability is a judgement about the
current request, and microglia does **not** make one: retrieval ranks by BM25 and filters by scope, and
nothing reads a rule against the task. This is a named gap rather than an oversight — it is the
operation 2610.27524 reports as the failure mode, and no system surveyed in this project's competitive
record implements it either.

**Specificity** — the number of scope dimensions an item states (plus one). At equal confidence, the
more specific rule wins, which is how a domain exception overrides a general rule. Specificity is a
ranking weight, not an admission rule: a rule at specificity 1 is still delivered.

**Support** — the sum of evidence weights. A threshold rather than a count, so one strong observation
can equal several weak ones.

**Support (distinct tasks)** (`supportTasks`) — how many *different* tasks stand behind an item, which
is a different number from `support` and the one a corroboration question asks about. Eight attempts
at one task are one observation by one user; the score groups evidence by task for that reason, and
this count uses the same grouping so a recurrence reading cannot disagree with the fusion it explains.
An item derived by three tasks reports 3 here and can report any `support` at all.

**Consolidation** — a pass over a store that has already been written, which groups items stating one
claim and folds each group into a survivor carrying the union of its evidence. It is the only
mechanism that can raise `supportTasks` after the fact: the write path sees one claim at a time, and
"two items said the same thing" is a property of the finished store rather than of either write. It
refuses to merge items whose payloads differ, whose evidence is the same, or whose conditions
disagree, and counts each refusal.

**Containment** — the similarity consolidation merges on: shared content terms over the *smaller* of
the two claims, so a claim and the same claim with a different closing clause score 1.0-minus rather
than 0.48 as Jaccard does. Measured on a real τ² store, the one pair of repeats reads 0.700 and the
closest pair that is not a repeat reads 0.533, which is where the 0.60 floor comes from. The
condition is compared by a *count* of shared terms instead (floor 3), because as a ratio a
paraphrased trigger and an unrelated one are indistinguishable.

**Trace** — one task's episode as the distiller can see it: what was attempted (the calls, in order),
what the reference trajectory does instead, and the rubric the attempt failed. A trace is the unit a
multi-claim distillation reads, in the same way a correction is the unit a single-claim one reads.

**System time / world time** — the bitemporal pair. `validUntil` is when the claim stopped being true
in the world; `systemUntil` is when the store stopped believing it. A rule can be superseded in system
time while still being true in world time, and the reverse.

**Pack budget / capacity** — the budget is a character ceiling on one rendered pack; the capacity is
the longest *statement* a pack of that budget can carry, and it is measured (`maxStatementChars` renders
a one-item pack and binary-searches the boundary) rather than derived, because the fixed cost belongs to
the line and not to the library. A record line costs **390** characters of wrapper, payload and id, so a
2,400-character budget states 2,010 — **one** record. Capacity is per record: two records need two
wrappers, and a candidate that does not fit is refused at render rather than truncated, which the census
counts as `droppedForSize`. A pack whose budget is below the wrapper renders nothing at all.

**Recall text** — what a rule is matched by: its condition followed by its statement (`recallText` in
the kernel). One definition rather than three, because the BM25 index, the `minCoverage` floor and the
MMR diversity ranking each used to decide for themselves, and all three had settled on the statement
alone. A rule distilled without a condition therefore has only its claim to be found by, which on an
agentic benchmark meant an empty pack on 38% of 1,528 requests.

**Reference** — a value that names a row rather than describing a person: a bare digit run under a field
whose name declares it (`id`, `*_id`, `*_ids`). The distinction exists because a ten-digit run has no
shape of its own that separates a product id from a telephone number, so the guard reads the field
instead. A reference is **not** redacted; an address or a credential under the same key still is, and a
formatted number always is.

**Redaction** — the rules applied *before* persistence, so that a store built from real traffic is safe
to keep: email addresses, telephone numbers, and `sk-…` / `gh…_` / JWT / AWS key shapes. The phone rule
is the only one withheld from a **reference**, and it is withheld by rule id rather than by bypassing
redaction, so a rule added later still applies to the values that arrive under `*_id`.

**Store pin** — a list of the learning tasks whose episodes **failed**, kept as a file, so that a store
can be rebuilt without running those episodes again. The store is otherwise a *draw*: which tasks teach
is decided by one sampled trial each, so two runs of the same configuration build different stores (12
records in one measurement, 15 in the next, 8 task ids in common) and nothing measured across them is a
single-variable comparison. A correction's *content* is a function of the corpus — the expected calls and
the question — so pinning the list makes the store deterministic, and `pinnedLearn` refuses a list naming
a task the corpus does not hold rather than building a smaller store that still reads as measured. The
pin costs the episodes it replaces: a pinned run does not pay for its learning half.

**Query pin** — the list of recall queries an arm replays, kept as a file, so that a pack becomes a
function of the store and the options alone. The pack is otherwise a *second* draw: it is ranked on BM25
over the question, and in a simulated conversation the question is the user's sampled first turn. A store
pin therefore does not make a pack reproducible — one measurement replayed fifteen records character for
character and still served 1,812.1 mean characters against the previous arm's 1,825.3. Unlike a **store
pin**, a query pin is not for arms quoting an absolute benchmark number: a fixed phrasing is a retrieval
stimulus no user typed, and the number is meant to be comparable to a competitor's. It is for arms whose
subject *is* the pack, where two levels must be read against one question.

**Benchmark release** — the version of the benchmark a score is a score *of*. It is not a footnote: τ²
v0.2.0 and v1.0.1 share all 114 retail task ids and differ in 114 of 114 task bodies, v1.0.1 is the only
release that ships the 74/40 halves the published held-out figures use, and retail's `reward_basis` moves
between them from the implicit `[DB, COMMUNICATE]` to a declared `DB+NL_ASSERTION` on 112 of 114 tasks —
so 112 tasks are graded on their prose rubric in one release and none are in the other. Airline does not
move: all 50 tasks declare `COMMUNICATE+DB`, which is what the default already applied. The consequence
for this project's own record is that a `pass^4` from before R92 is *historical* rather than comparable,
and the artefact carries `benchmark {version, commit}` — the tag from the pin and the commit from the
checkout, because a tag can be moved — with `taskSplit` naming which halves were run and the corpus's label
census printed beside the number.

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

**Registration switch** — a setting that belongs to one experiment rather than to the repository:
the backbone, the reasoning regime, the distiller's form, its unit, the population it teaches from, and
the trace ceiling. Six of them. Each lives in a pre-registration's header, is recorded in the artefact
from the same value the run used, and is *refused* — not silently overridden — when the repository
variable and the header disagree. The reason is one sentence: a repository variable is one experiment's
setting applied to every queued dispatch, and a run published under a registration it did not execute is
a number with the wrong label.

**Distilling unit** — the object the distiller is shown. `correction` is one failed task rendered as one
sentence, which is the unit every published τ² arm measured; `trace` is the attempt put beside the
reference trajectory, so the difference between them can be the lesson. The unit decides the form: a
trace arm cannot be asked for a `lesson`, because the guidance for a `lesson` asks the model to name
columns, and a trace has none.

**Trace ceiling** — the most claims one trace may teach, one to eight. It is passed to the interpreter
where it becomes both the sentence the model reads and the count the parser keeps, so a ceiling the
prompt states and the parser cannot apply does not exist. It is not a promise of yield: a trace with one
failed assertion may support one claim whatever the ceiling is, and a run at six that yields 2.2 is the
finding that the episode, not the cap, is the constraint.

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

**Budget basis** — what a host's character budget is charged for. `note-included` (the default) charges
the block's wrapper, note and all; `note-excluded` charges the block's data and counts the wrapper as if
it carried no note. The distinction is not cosmetic: the hardened note is ~110 characters longer than
the standard one, so under `note-included` a longer sentence buys its room by dropping the last rule. If
you are comparing note levels, the difference between the arms must not include the pack.

**Coverage (dose)** — the share of questions on which a dose arm injected at least one item. A cell at
0.29 items per question is 71% control, and its interval cannot bound a per-item effect better than
about ±5pp; the number to read before any delta from a reduced budget.

**Note level** — one of `standard`, `hardened` or `none` (`NoteMode`): the sentence a knowledge block
opens with. A property of the *rendering* rather than of the store, which is why it can be set per
request (`recall({ note })`) and why three levels can be compared over one store in one run. The
hardened level exists because the 2026 memory-failure literature puts the damage after retrieval: a
correct rule can anchor the model to a frame that no longer fits.

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

**Side (polarity)** — which half of a run a lesson came from: `repair` (something did not stand — a
correction, a rejection, a question that had to be asked, an answer that was not given) or `pass` (an
artefact that worked). Read from the **signal**, not the kind, because one kind carries both sides: a
`rating` with `value: 'up'` and one with `value: 'down'` are one kind and two sides, and so are a successful
and a failed `outcome`. Recorded on the item by the distiller and adopted once, like a condition — a success
that repeats a lesson learned from a failure is support for the lesson, not evidence that it was learned
from a success. Absent means *not classified*, which is what every record written before the field existed
is, and a reader that fills that silence in has invented its answer: a store of pure repairs was read as a
store of pure successes for exactly as long as the side was guessed from the kind.

**Promotion gate** — the rule that a `user-text` item cannot activate on one task's word. It stays a
candidate with `needs-corroboration` until a second distinct task, or evidence of a stronger tier, endorses
the same claim.

**Distiller pre-flight** — one fixture correction, asked of the interpreter **before** a learning phase is
bought. It answers the question a provider probe cannot: not "does the endpoint reply" but "does this prompt
form, on this population, produce a claim from a correction that states one". A refusal writes a
no-measurement record and stops the dispatch, so a distiller that has stopped learning costs one call instead
of a whole episode run. Off by default, because an added call is an added call in a sequence a published arm's
number was produced under; the artefact records whether it ran, so an arm with a pre-flight is distinguishable
from one without.

**Reply census** — how many replies the distiller's model returned, how many of them were **empty**, and the
first empty one verbatim. It exists because the funnel's four counts cannot see an empty reply: one event
asked, zero candidates, zero drops. A model choosing silence and an interpreter that was never called produce
the same numbers without it.

**Population** — the set of trajectories a store is distilled from: `edited` (the failures) or `all` (every
trajectory, successes included). It decides how many routines the store holds and how many are corroborated,
so it is part of a registration rather than a variable a dispatch inherits: a fold whose supply is a
repository variable is a treatment nobody declared.

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

**Instrument funnel** — The five counts a store-building run passes through, in order: the corrections
the learning half produced, the candidates the interpreter proposed, the ones the store admitted, the
items it holds, and the items the recall scope can reach. It exists as a first-class object because
every gate in the protocol grades a *reading* and none of them asks whether the machine that produced
it carried anything: a run can pass all of them with a store whose every item was quarantined, and
three published rounds were read as "the mechanism does not work" when the failing stage was upstream
of every gate the report carried. The funnel is published as `V0-instrument-ready`, which fails when
a stage is zero — and names the stage — or when two counts were taken over different populations.
It is *absent*, not green, on any artefact that predates it.

**No measurement** — The third outcome beside "passed" and "failed": a run that produced no reading
at all, because the pipeline that would have produced one stopped. It is recorded as
`status_no_measurement: 1` with the reason, and it is deliberately not a zero — a store that came
out empty and a store that was never built are different facts, and reporting the first as `0.00`
rules/questions is how an infrastructure failure becomes a scientific result. The reason carries the
funnel chain, so a stopped run still says which stage broke and how many candidates it saw.

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

**Power target** — The effect size the instrument is built to certify: **6pp at 80% power**, exported as
`POWER_TARGET_PP`. It is a target and not a pass condition, and it cannot be supplied by a caller — a bar
a caller can type is a bar that will be typed to pass. `V5-resolution` reports every run against it and
blocks only on a claim finer than the run's own resolution.

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

**Attempt watermark** — The `before` bound on a `recall`, which withholds every claim carrying an
observation from the named attempt or a later one (`RecallQuery.before`, `EvidenceRef.trial`,
`visibleBefore`). It exists for the case where the store is written *between* attempts: attempt *t* must
not read what attempt *t* taught, or the result measures leakage rather than learning. Three absences
mean three different things and are kept apart — no watermark is not `before: 0`, a claim with no
recorded attempt predates the episode and is served to all of them, and `0` is a real attempt. The
quantifier is *every*: a claim citing attempts 1 and 3 is one item, so the later observation withholds
the whole claim.

**Blank reply** — A distiller reply with no visible character: `""`, `"\n\n"`, spaces. It is **not**
the same as an *empty* reply (`[]` or `{"candidates":[]}`, where the model chose silence) and not the
same as an *unparsed* one (prose the parser cannot read). The three have different fixes and a
census that merges them reports `0 empty` while most of its calls returned nothing — which is what
happened to this project's lane on a full dispatch before the states were separated.

**Writer census** — Which side of the resilient pair produced the claims in a store, and how much of
the population it covered. Decided by *claims*, never by calls: a rule fallback that is invoked and
returns nothing has produced nothing, and reading the invocation count as authorship calls a store
the fallback's when every claim in it is the model's. `microglia` records `distillWriter` and
`distillFaults` on every arm, so "what wrote this store" is a field and not an inference.

**Null contrast** — The paired difference between two arms that received the **same** treatment, and
therefore an estimate of the lane's run-to-run noise rather than a contribution. It is reported
separately from a treatment contrast and never merged with one: a delta inside it cannot be
attributed to anything, so any claimed effect smaller than the null contrast is not a measurement.

**Writer grid** — One correction asked of every candidate `(model, form)` pair, one call each, read for
a claim that carries a `when`. A *grid* rather than a probe because a writer is two axes and neither
alone describes one: a form is a prompt and a model is a capacity, and a lane that has only ever run
one pair cannot say which of the two failed. The verdicts are `viable`, `no-writer` and `unanswered`,
and the last two are never merged — `no-writer` is a result that was paid for, `unanswered` is an
outage that was not measured. Run it with `pnpm eval:writer-probe`; it costs cents and refuses rather
than certifies, because a fixture that states a rule is not a population that does.

**Entity survival** — The share of the concrete values in a correction (order ids, item ids, emails,
amounts) that reach a stored claim. `faithfulness.kept` and `whole` count it, and it is expected to be
low: a claim that carries an order id cannot transfer to an unseen order. It is recorded anyway because
the opposite failure has no symptom — a store of pure abstractions looks healthy at every count and
cannot answer *this* order, and the only way to see the trade is to print both sides. R104's store read
`0` of `667` entities across 71 corrections.

**Abstraction tax** — What a tool-name ban removes in exchange for making a claim transferable. The
ban is right in principle: a claim naming `cancel_pending_order` cannot generalise past the scenario
that taught it. But the candidates it refuses are the ones that say *which operation applies*, and what
survives is the residue a schema validator already knows — the JSON shape of an action, the order two
calls go in. The tax is measurable on any artefact that carries both `distillForm.refused` and the
store's own text, and no arm had priced it until R117.

**Three rulers** — A paired delta, an absolute score and a cross-sample difference are three different
quantities, and at forty tasks they are 44.30pp, 15.42pp and 17.65pp wide respectively. The first
measures two arms of one dispatch over the same questions and conditions on how many pairs changed
hands; the second measures a score on its own; the third compares two papers' separate samples, which
is what a leaderboard row is. This record spent several iterations reading one and concluding with
another, so every claim now names its ruler: "memory helped by X" needs the first, "our score beats
the bar" needs the second, "we are behind ALTK" needs the third. They differ by nearly a factor of
three and none of them substitutes for another.

**Score interval** — `1.96·sqrt(p(1−p)/n)` over the tasks a score was computed on, printed beside every
`pass^4` the readback emits. It exists because a point estimate beside a published bar reads as a
result: at forty tasks the half-width is 15.42pp, so a score must reach **0.75** before its lower
bound clears a 0.575 bar, and 0.70 (lower bound 0.558) does not clear it however confident the sentence
sounds. A zero width is printed as `(no tasks scored)` rather than `±0.00pp`, because an arm that
scored nothing has an unknown score and not a perfect one.

**Effect claim** — The header field `effectClaimPp`, present only when a registration claims a
difference. Its presence commits the header to two things a census arm does not need: at least two
arms, so a delta of its own exists, and a sample whose floor — `detectableDelta(tasks, 1)`, complete
discordance, the bound no run can exceed — is smaller than the claim. Absent, it says nothing, which
is correct for an arm that buys a census or a store's text. The distinction is what stops a dispatch
from publishing a number no design could have supported.

**Fold key** — The string a pack folds on, and the reason a mechanism can be installed, registered on
every arm, and never fire. `foldByShape` groups a pack's items by the *routine* each one states and
replaces a group with its medoid when at least two distinct tasks taught it. Two keys were tried
before one worked: the normalized statement (which two failures of one routine never share) and the
`A:` line of the record's text (which a distilled record does not have — it is a sentence). The key
that works is the **tool sequence of the correction that wrote the item**, joined through the item's
evidence, and it is the same function the merge census prices with. What the missing key cost: three
rounds in which `folded: 0` was read as "the store has no recurrence" instead of "the key had no
input", and a 7.50pp null contrast that was a valid noise reading only because the treatment had
failed to apply.

**Claim ruler** — Which of the three rulers a score is graded by, stated in the registration as
`claimRuler: point | interval`. `point` compares a score to `published + bar`; `interval` requires the
score minus its own 95% half-width to clear the published number, which is what "the lower bound must
clear 0.575" means and what a registration in this record actually asked for. The two are the same test
only at infinite `n`, and the difference is not academic: at forty tasks a score of **0.63** passes the
point ruler and fails the interval one, so a gate that applies the point to a registration that wrote
the interval can publish a claim its own file refuses. Absent means `point`, which is what every
artefact before the header existed was graded by, so no past verdict changes when it is added.

**Suppressed group** — A group of pack items that met the fold's floor (two members, two distinct
tasks) and that the arm's *unit* did not fold. `foldByShape` folds only in `collapse` mode, so on the
`per-failure` arm the count of folded groups is zero by construction — and a census that printed only
that zero was read, by a registration that asked for it, as a fact about the store. The three counts now
partition one population: `groups` folded, `suppressed` met the floor and were withheld by the unit,
`refused` fell short of the floor. A fourth, `unnamed`, counts the items that never entered a group at
all. **A number whose value is a function of the harness is not a measurement of the world**, and the
distinction costs a dollar to discover and nothing to print.

**Pack ledger** — The ids each request was served, in the order the requests arrived, carried on the
artefact as `tau2.pack.ledger`. Its purpose is attribution: two dispatches of one lane measured
**0.600** and **0.750**, and neither artefact could say which packs differed, because the census kept
counts and dropped the ids. `ledgerDiff` compares two ledgers by position — the same key `queries` uses,
since nothing upstream names the episode — and reports positions repacked, records that entered and
records that left. A fold, a merge, a recall floor and a budget all change *which* knowledge a request
sees; without the ledger that change is a score difference with no evidence behind it.

**Trial rate** — Episodes passed divided by episodes run, against `pass^4`, which is the fraction of
*tasks* whose four trials all passed. The two denominators differ by the number of trials, so the same
run reports **0.8812 ±5.01pp** over 160 episodes and **0.7500 ±15.18pp** over 40 tasks. `pass^4`
estimates `p⁴`, a nonlinear function: two runs at the same rate, one whose misses landed twice in one
task and one whose misses landed once in each of two, differ by **15pp** in the headline and **0.6pp**
in the rate. Report both. The rate is what an arm can be graded on at forty tasks; `pass^4` is the
interface to a published table and must be quoted with its `n`. A headline above `rate⁴` is a finding —
the misses clustered — rather than a result.

**Served concentration** — How the renders of a run's packs are spread over the records that took them:
`topOne`, `topFive`, `once`, and `effective` (`exp(entropy)`, the number of records actually doing the work),
carried on `tau2.served.concentration` and printed by every run. The mean it sits beside is a *size* — four
items a request — and a size cannot see a monopoly. R120's store served 4.01 items a request, and its own
census shows **one of 63 served records took 88 of 162 requests (54%)**, the five most-served took 31% of 650
renders, eight were rendered once and ten were never rendered at all. The record that dominated was a negative
instruction about a rare situation. **When a census reports a mean over renders, ask what the distribution
over records looks like before believing anything about the store.**

**Pair population** — The number of unordered pairs of items a consolidation pass could test, `C(n,2)`, and
the four filters that remove them before any refusal is counted: `skippedKind`, `skippedScope`,
`skippedKey`, `skippedOverlap`. R121 reported `groups 0, merged 0` with every refusal counter at zero, which
is consistent with "nothing to merge" and with "the key removed everything". It was the second: the linkage
key includes the distiller's free-text `intent`, 64 items fell into **60** buckets, and **4 of 2,016** pairs
were ever tested. A census that counts refusals but not the population they were drawn from cannot tell
those two apart.

**Hidden candidate** — A pair the linkage key removed *after* every test that decides whether two items state
one claim had admitted it. It is `skippedKey`, and it is the only number that separates the two ways a store
can report zero groups: *the store holds distinct claims* (no admissible pair exists) from *the key is
deleting the answer* (admissible pairs exist and were never compared). On the store R137 wrote, 64 statements
held **43** distinct claims, the pass merged **one**, and **34 of the 35** joins were filed under different
keys — so `sup2 2 of 66` was arithmetic of a filter, not a property of the corpus. `linkage: "all"` stops the
key removing pairs and leaves every claim test in force.

**Support floor** — The number of distinct tasks that must stand behind an item before the recall path may
serve it. It is a *serve-time* rule rather than a write-side one: the recurrence pass labels an item with the
tasks that taught it, and the floor decides whether that label is enough to hand the item to a model.
`retireBelowSupport` implements it as a status (`statusReason: "support-floor"`), so a retired item is kept,
counted under `store.reasons`, and reversible — and it is applied after the pass and before the gate that
reads the store, because a floor applied later would be measured as a store that carried something and served
nothing. **Support is a safety statistic, not a quality one:** an item two tasks agreed on can be wrong, and
an item one task taught can be the only useful rule in the store, so a floor is graded on the harm share and
on the per-item `broke` column rather than on the mean.

**Two denominators** — `pass^4` is the fraction of *tasks* whose k trials all passed; `episode_rate` is the
fraction of *episodes* that passed. The first is `p^k` averaged over tasks and is a nonlinear function of the
second, so at forty tasks it is roughly three times as coarse. Every `poc-l4` line now carries `episode_rate`,
`episode_half_width_pp`, `rate_to_the_k` and `episode_trials` beside the headline, because a headline without
its rate is the number a reader will rank and a coin is what it behaves like: two runs of one lane measured
**0.600** and **0.750** off **140** and **141** episodes of 160.

**Effect of memory, measured** — The record's own contrasts, which do not agree and are not resolved:
BIRD-dev `full − none` **−0.46pp** [−1.89, +0.91] (52 gained, 45 lost) and **−1.7pp per rule injected**;
τ²-retail R93 **−2.50pp** (memory 0.700 against a memory-free 0.725, separate dispatches, 1.1 items a
request); τ²-retail R121 **+5.00pp** of episode rate and **+15.00pp** of headline (141/160 against 133/160,
within one dispatch, 4.06 items a request, 9 tasks improved and 4 harmed, p = 0.2668). **Nothing here supports
a claim that memory helps or hurts; what it supports is that the contrast is not resolvable at forty tasks,
and that the store's size moves the sign.**

**Rivaled population** — The requests whose store returned at least two candidates, and therefore the only
ones a margin gate can withhold. It is not derivable from the served count: a pack served from one
candidate and a pack served from eight are the same `served` and different populations, and only the second
is what a rung acts on. On a 160-episode arm, `rivaled` below about 40 would mean most packs carried a
single line and the gate would be deciding on a minority of the traffic.

**Margin ladder** — For each rung of `0.01 0.02 0.05 0.10 0.15 0.20 0.30`, how many of the rivaled requests
that rung would withhold, counted exactly rather than fitted. `buildPack` withholds on `margin < rung`, so
the count is strict and a margin equal to the rung serves. The ladder's *shape* is the reading: a relevance
floor jumps from serving 162 to serving 75 between two adjacent rungs on the same pairs, which is an off
switch rather than a threshold; a gate whose ladder degrades smoothly is one whose rung can be chosen. It is
recorded by an arm that gates on nothing (`speakMargin: 0`, `speakCensus: true`), which is why the rung can
be priced before it is bought.

**Episode boundary** — The request index at which an episode opened, recorded by the agent as
`memory.episodeStarts`. It exists because a recall fires once per episode and the counts are therefore nearly
equal (164 requests over 160 episodes), which makes a positional join between `pack.ledger` and `per_trial`
correct for most rows and silently wrong after the first episode that recalled twice. The agent records the
boundary because it is never told which task or trial it is in: the episode is the only unit visible on that
side of the socket.

**Item transfer** — Per rule: the trials it was served into, how many of those only the memory arm passed
(`kept`), how many only the control passed (`broke`), and the difference. A negative `net` means the rule was
present whenever the memory failed, which is a screening reading and not a cause — the cause needs the
ablation that withholds the rule. A rule whose `episodes` is a large share of the arm describes the store
rather than the rule, and withholding it is a store change disguised as a probe.

**Harm share** — The share of *changed* trials that changed for the worse: `broke / (kept + broke)` over the
trials where the two arms disagreed. It is the one memory quantity comparable across backbones and sample
sizes, because it conditions on the trials where something moved and is a property of the treatment's
direction rather than its size. The published figure for memory-augmented agents is 52%; this lane measured
57.1% on one dispatch (12 of 21) and 32.3% on another (10 of 31), which are the same measurement as each other
and as the literature's.

**Turn census** — The per-episode counts a phase can read from the trajectories it already recorded: assistant
turns, tool results that came back in error, calls that repeat an earlier call with identical arguments, and
the user turns that follow either. It exists because the task-level test cannot resolve this lane's effects:
forty held-out tasks give 7.76pp of standard error and a 26.21pp minimum detectable difference, while one
phase writes about 1,800 turns. It costs no model calls.

**Flagged result** — A tool result that carried the `error` field. The census reports `toolErrors: null` rather
than `0` when no result carried it, because a release that stopped serialising the flag is a different fact
from a run in which no tool failed. `toolResultsWithFlag` is the denominator of the sentence.

**Poisson interval** — The interval a count of rare events carries, as distinct from the interval a proportion
carries. Zero observed events are consistent with up to 3.69 expected (`−ln 0.025`), so an arm reporting no
tool errors has bounded a rate rather than established safety. Two arms' counts are **separated** when their
Poisson intervals do not overlap, which is the test the turn census is registered against.

**Serve split** — One arm's own trials, split by whether the gate let a pack through: the served bucket's pass
rate and the withheld bucket's. It is the only *within-arm* comparison this record has, so the store and the
model are held fixed and a difference cannot be attributed to anything but the gate. An episode whose pack was
refused is not control data — it is a trial the memory was absent from, by decision.

**Rung** — A value of `speakMargin`: the margin below which a pack is withheld. A rung is not a constant of the
lane, it is a property of a store — which is why R123a measured the store's margin distribution before R123
named one, and why a rung chosen on one store and dispatched against another is a substitution rather than a
treatment. The rung is chosen by a rule fixed before the data: the smallest rung withholding at least 15% of
the contested requests, provided that share is at most 40%.

**Episode boundary** — The request index at which one episode's requests begin. It is a *partition*, not a
count: consecutive entries bracket the requests that belong to one trial, and the last entry brackets the
remainder. A list that grows by one per request is a position, and a join on it places every request in an
episode of its own — which is what R123 recorded (162 entries over 160 episodes) before the writer was repaired.
The identity `len(episodeStarts) + recallRepeats == recalls` is how a reader checks it.

**Projection** — The step that turns what the driver observed into the block an artefact carries. Every field
of the driver's record needs a decision (`carried` or `reduced`), and the table is typed so a *plain* field
cannot be forgotten. A field added through a spread is exempt from that check, which is how two blocks reached
the record and never reached the artefact. A record that carries a key the table has no decision for reports it
as `unprojected`, the run says so on stderr, and the pair refuses the arm.

**Absent reading** — A field or line that says *why* it could not be computed, as distinct from a field that is
missing and a reading of zero. `serveSplitAbsent` names one of `no-ledger`, `no-boundary` or
`boundary-disagrees` with the numbers that disagreed. A run whose registered mechanism check could not be
computed is a finding, and a silent caller is how R123's check disappeared between a green gate and an artefact
with no field.

**Rehearsal** — Replaying the tasks a store was *built from* with the store on. The learn half runs every
training task with no memory and distils one claim from each failure, so the store already knows which cases it
was written for; a rehearsal asks whether each of those cases now passes. It is the only reading in this lane
that separates the two explanations for a held-out harm share: a store that repairs most of its own cases is
**right but misapplied** (a conditioning problem), and one that repairs few is **inert or wrong** (a distillation
problem). `repairRate` divides by the population that failed without memory, and `harmShare` by the outcomes the
store changed; the two are never quoted beside a held-out score, because these are not held-out tasks.

The block also carries the replay's own `tasks`, `requests` and `served`, because the four cells cannot see the
third explanation for "repaired nothing": an empty pack. A replay that served 0 of 74 requests and one that
served 74 and changed nothing produce the same four cells, and only `served` separates a retrieval finding from
a distillation one. Inside the block, `reading` is the field that may be absent — the phase ran and nothing
paired — which is a different sentence from the block itself being absent, meaning the registration never
bought the phase.

**Control replay** — The same tasks, the same one trial, the same reduction, and **no store**: the agent the
learn half ran, with no facade. It is the denominator a rehearsal does not otherwise have, because a rehearsal's
four cells are counted against the draw that *selected* the cases — the learn half failed a task and the store was
written from that failure — and a task that fails two thirds of the time lands in `inert` whether or not the
store did anything. Against the control, `repaired` and `broke` are discordant pairs between two phases that
differ only in the store, so their difference (`net`) is the store's own-case effect with the draw held fixed.
The control carries no `requests` and no `served`: it has no facade, and `0 of 0 served` would read as a store
that found nothing.

**Dispatch pool** — One arm's readings from several dispatches, pooled into an estimate with an interval. Every
number in this lane is a draw: R131 read `pass^4` 0.625 on the arm that read 0.775 in R123a and 0.750 in R124, and
quoting the largest of the three as a score is what made the competitive board wrong. The pool splits the spread
into **between-dispatch** variance (`tau2`, DerSimonian–Laird, truncated at zero) and **within** variance, and
`iSquared` is the share that is between: above ~50% the pooled value is a summary of disagreeing runs rather than
an estimate of one quantity. The quantile follows the variance the estimate is made of — `t(dispatches−1)` when
the dispatches disagree, the normal quantile when they do not. Two differences from the domain pool: a dispatch
pool *requires* the same tasks to appear again, and two dispatches at different `k` are refused rather than
averaged.

**Pack limit** — `packLimit`: how many items a pack may serve, as distinct from `packBudget`, which is how many
characters it may carry. A character budget leaves the count to how long the distiller happened to write its
records — measured at 3.975 items and 2,239 of a 2,400-character budget on every request, with 161 further items
dropped for size over 40 — so a treatment of "one procedure instead of four" has to state a count. Absent means
the host's room, which is what every arm before R134 ran with; zero is refused rather than read as unlimited.

**Pack saturation** — A pack that is at or near its character budget on every request, with items left over. It
is a *reachability* finding of a different kind from an empty pack: `served` is 100% and the item the request
needed may still have been dropped, because assembly stops when the budget runs out and what did not fit is not
ordered by need. The census prints it as `meanChars` against `budget` beside `droppedForSize`.

**Per-episode bill** — The cost of one episode, which is the only unit two phases of an arm have in common. A
store-on replay and a store-off control on the same 74 tasks differ by **2.43×** per episode ($0.00655 against
$0.00270) and the mechanism shows in the cache: 2.5M uncached prompt tokens against 0.59M, a hit rate of 0.7069
against 0.9020. A multi-item pack is different text on every call, so the provider's prefix cache is replaced
rather than reused, and the bill is the count's, not the items' length.

**Prompt split** — `system_tokens_per_call` and `conversation_tokens_per_call`: the two halves of the
messages a call carries. The system half holds the pack and any adapter preamble, so a premium there is
the memory's own text; the conversation half is what the agent grew, so a premium there is behaviour. The
split exists because every artefact before R135 reported one `prefix_tokens` that was both, under one
name, and a 2.25× per-episode premium was then attributed to the wrong half.

**Residual** — `residual_tokens_per_call`: prompt tokens a call beyond the messages and the tool schemas,
i.e. the **chat template's framing**. Measured at 84.2 tokens a call against a reference arm's 83.7, so it
is not where a premium lives. The field was first defined as `uncached` minus the two newest messages, which
absorbed the whole premium by construction (1,409.7 against 179.5 on R135's arms, 99.7% of it) — a residual
of a residual attributes nothing, and artefacts before R136 carry the old meaning.

**Prefix undercounted** — The state of a cache census whose credited tokens exceed the tokens it counted
as seen (`prefix_coverage > 1.02`). It is not a cache that held extra: `seen` stops two messages short of
the end by construction, so the ratio above 1 measures the denominator. Such an arm reports
`repair: unmeasured`, because nothing downstream can be attributed from it — and R134's arms, at 1.4752 and
2.2639, were read as "prefix honoured" before the state existed.

**Per-request margin** — `pack.margins.perRequest`: the ranking margin of every request, in arrival order,
`null` where the pack carried no decision. Aligned by position with `pack.ledger` and `per_task`, so a
rung's withheld set can be joined to the outcomes of exactly those requests. The `ladder` counts requests
under each rung and cannot say *which* ones, which is why a conditioning arm could not be designed from it.

**Boundary task** — `memory.boundaryTasks`: the task each episode boundary opened for, as a task id, with
`null` where the runner could not resolve one. The agent records the query text at the boundary — it is
never told which task it is in — and the runner matches that against the first user message of every
simulation it ran, so the id is derived from identity rather than from order. R135 opened 41 boundaries for
40 scored episodes and every positional join in this lane refused; the refusal was correct and the repair
was the name. The two lists are positional against each other (`boundaryTexts` and `episodeStarts`), which
is why an unresolved entry is kept in place rather than filtered out.

**Carriage** — `carriage_chars_per_packed_call`: what the system column carries beyond the message the
agent injected, per call that carried a pack. Until R136 it had no name: the census counted every system
message together, so a 559-token growth against a 725-character pack was reported as one number and read as
if it were the memory's text. Measured against `system_chars_per_packed_call` rather than against the mean
over all calls, because the callback sees the user simulator's calls and those carry neither the pack nor
the agent's policy. A reading exists only when the injection, the column and the call count all travelled:
half a pair is not a carriage.

> The subtraction names a remainder, not its contents. R136 called the remainder "the adapter's preamble"
> and the arm it dispatched reported **10,400 characters a call against a 705-character message** — the block
> re-sent five times, not a preamble. Read **Copy** before reading a carriage.

**Copy** — One instance of the recalled block in a prompt, when the block was injected more than once.
`pack_copies_per_packed_call` is `system_messages − 1` per packed call, because the policy is one system
message and the block is the only thing the agent puts beside it; `packed_calls_with_copies` counts the calls
that carried two or more, which a mean cannot fake. `memory.packCopiesDropped` is the agent's own count of
copies it removed from the state it was handed, and on a sound phase it reads `calls − boundaries`. The
defect they were built for: an agent that appends its block to the state the benchmark threads back puts one
more copy in the prompt every turn, so a ten-turn episode carries ten — the cost grows with the square of the
episode, the model is told ten times which data to act on, and the cached prefix ends at the insertion point
because the block sits at the front of the prompt. Every memory arm from R92 to R136 carried it.

**Packed call** — A model call whose messages carry **two or more system messages**, i.e. one that the pack
rode on. Structural rather than nominal: it is visible from the roles alone, so a release that renames the
pack's element cannot move the split. `system_chars_per_unpacked_call` is the same column on the calls the
pack did not ride, which is the mixture R135's mean hid — the user simulator's prompt is neither the
agent's policy nor the pack, and its weight in the mean moves with how many turns each side took.

**Render** — One served record on one turn, as `ServeRender`: which record, which trial, and whether the
trial got better. Not a trial and not a task: one trial can carry several renders and one record renders on
many trials, so a per-render average weights a record served nine times the same as one served once. R141
rendered 40 times over 14 records.

**Opportunity** — A render on a trial the **control failed**. It is the only kind of render on which a repair
is possible; on a trial the control passed, the same record can only break it. The census therefore reports
`opportunity`, `repairs`, `breaks` and `inert` separately, because the share of renders that are opportunities
is a property of the **corpus** — how often a failure coincides with a retrieval hit — and only the ratio
inside that share is a property of the **store**. On R141: 7 of 40 renders were opportunities (17.5%), 5 of
those repaired (71.4%), 1 of the other 33 broke (3.03%), and 34 renders (85%) changed nothing.

**Inert render** — A render where the arm and the control agree, one way or the other. It is the residual of
the yield census rather than an omission, because an inert render is tokens paid with no mechanism attached
and on R141 that was 85% of the traffic. A `repairs / renders` rate divides by them, which is why it read
12.5% while the store was repairing 71.4% of what it was given.

**Opportunities for evidence** — `ceil(log α / log(1 − p))`, where `p` is the store's own repair rate: how many
opportunities a record needs before observing **zero** repairs is unlikely at level α. At R141's `p = 5/7` it
is 3, and the most-served record was rendered nine times with one opportunity, so "this record never repaired
anything" was not a finding. The number is a statement about how much data a verdict would need, never a
verdict.

**Unmatched requests** — Ledger requests that no episode boundary's span covered, e.g. when a boundary resolved
to no trial because the run abandoned that attempt. Counted by coverage of the spans rather than tested from
the join's input (`ordered.length`), which is how the field read `0` on the very arm that had dropped requests.
An arm that resolves **some** boundaries publishes the table and reports the hole; one that resolves none is
refused, because there is nothing to publish.

**Off-peak window** — The hours the rate card prices at the lower band: everything outside **01:00–04:00 and
06:00–10:00 UTC on weekdays** for `deepseek-flash`. A dispatch that crosses a boundary is billed at both rates,
and the runner's `--require-off-peak` is evaluated **per phase**, so the expensive half is refused after the
cheap half has been paid for. Two commands exist for that: `eval:wait-band` sleeps to the hour a dispatch named
(`not_before: HH:MM`, capped at 240 minutes), and `eval:window-fit` refuses the run if its own estimate — caps ×
trials × arms × 26 s + 10 min — would not finish before the window closes.

**`start_at`** — The instant the wait step woke, published as an ISO moment beside `wait_min`. It exists because
the window guard needs a **moment** and used to re-parse `not_before` on its own clock minutes after the wait
ended, where a passed hour reads as tomorrow's: a dispatch that slept to 04:00 was refused at 04:00:27 with
"1440 minutes away". One parse, one clock: `not_before` is read only by the step that sleeps on it.

**`fits`** — The window guard's answer, published for the arms to read. A step that fails makes the job red; a
step that publishes an output makes a **decision** other steps can obey. Both arms consult
`steps.window.outputs.fits != 'false'`, because relying on the failure alone gated only one of them: GitHub adds
an implicit `success()` to an `if:` that names no status function, so the arm whose condition was a plain input
comparison was skipped and the arm whose condition named `!cancelled()` bought its half of a refused run.

**Task yield** — The same renders `serve yield` counts, grouped by the task they were served into:
`renders`, distinct `items`, `opportunity`, `repairs`, `breaks`, `inert`, `net`. It answers a question the record
census cannot: one break over forty renders is a number without an address, and reach (a store used on a task
family it has nothing to say about) and interference (a store used on the episode it was taught) are fixed by
different mechanisms. Nothing divides by a task — the id is attribution, and a case asserts the record census is
identical with and without it.

**Contested task** — A task where the store both repaired one trial and broke another, whatever its net. It
cross-cuts `harmed` / `helped` / `neutral` on purpose: a task at net zero after one of each is evidence that a
record is *wrong for that task*, while a neutral task that is not contested is a task the store reached and
changed nothing about. Only the first is evidence about applicability.

**Unattributed render** — A render that named no task, which is every artefact written before the field existed.
Counted and printed rather than dropped, because a census that reports a population it did not read is the
defect this lane keeps deleting; `0 task(s) reached` is the wrong sentence for that state, and the line says so
in words.

**Serve anchor** — Whether a scope-matched rule must share a word with the request before it may be served.
`'scope'` (the published default) lets structure alone justify a rule; `'lexical'` requires a lexical anchor. Named
in a registration as `serveAnchor:` and sent as `anchoring=…` on the recall request. It is the guard against the
class the 2026 literature puts at 80% of memory-degradation events: a valid rule applied outside the situation it
was learned in.

**Knobs** — The recall parameters a dispatch fixed, joined into one string (`anchoring=lexical&minCoverage=0`).
Recorded verbatim as `tau2.pack.knobs` and compared as part of a fold's **treatment identity**, because two folds
served through two filters are two experiments. The string is compared and never parsed: an anchor re-derived from
it would be a second reader of a vocabulary that lives in one module.

| Term | In this project | Why the distinction matters |
| --- | --- | --- |
| "Cross-validation" | *cross-fit* | A cross-fit is two folds of one corpus read as one paired sample, not k models averaged: each task is answered once, and the reading is a paired difference |
| "Split" | *fold* | A fold is (what a store learned from, what it answered). The split is the boundary; the fold is one direction of it |
| "Fold identity" | *`foldSplit`* | The two id sets an arm ran, recorded in the pair artefact, because the leak check is the cross-fit's whole claim |
| "Model config" | *treatment identity* (`unit`, `form`, `scope`, `model`, `traceCeiling`) | Two folds of two treatments are two experiments; the pool refuses to average them |
| "Missing data" | *truncated sample* | A capped sample is a prefix of the store, so an id it does not carry is not evidence of a singleton |
| "Improvement rate" | *repair rate* (`repairs / opportunities`) | Dividing by renders measures how often the corpus offers a failure to fix; dividing by opportunities measures the store |
| "Turn" | *render* | A render is one record on one turn, not one trial: the counts differ per record and per arm |
| "Dropped data" | *unmatched requests* | A hole that is counted is published beside the reading; a condition that returns `undefined` costs the whole table |
| "Sleep until" | *`not_before` + `start_at`* | The request is an hour; the run has an instant. Two readers of one hour disagree at the boundary |
| "Guard failed" | *`fits=false`* | A red step is a report; an output is a gate. Only the second is obeyed by a step whose `if:` names a status function |
| "Harm rate" | *net per task* | With one render per task a rate is ±100%: the census prints `-1 over 1 render(s)`, not `-100%` |
| "Task id is a dimension" | *attribution key* | A dimension invites a division; this id may only group, and the invariant case enforces it |
| "Anchor setting" | *serve anchor* | A mode names where a pack comes from; an anchor filters what may appear inside it |
| "Config" | *knobs* | The knob string is an identity, not a description: two different strings are two treatments |

### Sweep, rung, and the first clean one

A **sweep** prices every candidate threshold of a serving knob against outcomes already measured, instead of
spending a dispatch per candidate. A **rung** is one candidate value on that grid. The **first clean rung**
(`firstClean`) is the smallest rung at which no trial the control passed is broken by the memory *and* at least
one repaired trial survives — reported instead of the best net, because a maximum over rungs is a parameter
fitted to the sample it is read from.

A render's **margin** is the gate's own ranking margin for the request that served it, and the value carried on a
render is the **highest** margin among the requests of its trial: a gate acts per request, an outcome is measured
per trial. A trial with no measurable margin is **unpriced** — served at every rung, because a gate with no
measurement cannot have withheld anything — and the sweep reports how many trials that was, so a store whose
packs never competed is visible rather than inferred.

The sweep's number is an **estimate**: a withheld trial is priced at its control outcome, and a model shown a
procedure and then not shown it is not the model that never saw it. Rungs are *priced* at readback and
*measured* by a dispatch.

| Term | In this project | Why the distinction matters |
| --- | --- | --- |
| "Threshold tuning" | *sweep* | A sweep costs nothing and answers "which requests would this withhold"; a dispatch answers "what happens if it does" |
| "Best threshold" | *first clean rung* | A maximum is fitted; the first clean rung is a claim the next run can refute |
| "Score" | *margin* | A margin is the ranking's own gap, not a confidence and not a probability |
| "Zero margin" | *unpriced* | Nothing was contested, so no rung can act: a different fact from a measured zero |
| "Population" | *provenance* (`edited` / `passed`) | A store of repairs and a store of descriptions of successes are different objects, whatever their size |

A **ranking** is the margin read as an ordering of repaired trials against broken ones: AUC is the probability
that a repaired trial carried a higher margin than a broken one, and its **exact p** is the share of labellings
of the same margins, under a shuffled outcome label, that order at least as well. The p is enumerated when the
labellings are few enough to walk and reported as *not walked* with their count when they are not — an
asymptotic approximation on four against six would be a number about a distribution nobody has evidence for.

| Term | In this project | Why the distinction matters |
| --- | --- | --- |
| "AUC" | *AUC with an exact p* | A perfect ordering on two against two is 1/6 by chance: the area alone is not evidence |
| "Significance" | *permutation p* | The null here is which label went with which margin, not a normal distribution |
| "Correlation" | *ranking* | The rung acts on an order, so the order is what has to carry information |

**Tiling (cross-fit)** — the property two folds must have to be pooled: every task in the corpus was learned from
by exactly one fold and answered by exactly the other. It is printed as a count (`tiles 114 of 114 task(s)`), not
enforced as a refusal, because a pool over a smaller population is still a valid reading — it is just a reading
about a smaller population, and the two counts beside the sentence say which tasks fell outside.

**Sign disagreement** — the case where the two folds of a cross-fit point in opposite directions. The pooled delta
is then an average of two findings rather than one, so the flag (`folds disagree in sign`) matters more than the
point estimate. On this project's τ² folds it fired: +2.50pp on the half whose store kept 11 servable items,
−10.81pp on the half that kept 3.

**Renders per servable item** — how many times an average servable record was served into a request. The quantity
that explained both cross-fit folds: 3.6 renders per item with an 8.33% harm share against 25.0 with 23.81%, on
one treatment. It is a property of the *recall path's density*, not of the store's size: a store that keeps fewer
items applies each of them everywhere, so the harm follows the renders rather than the count.

**Travel budget** — a cap on how many times one knowledge item may be put in front of an episode during a phase.
It is a *serving* policy, not a write-time filter and not a quality gate: it never asks whether a record is right,
only how often it has already spoken. The reading it answers is **renders per servable item**, which is the
quantity that separated this project's two cross-fit folds.

| Term | In this project | Why the distinction matters |
| --- | --- | --- |
| "Budget" | *travel budget* | The pack budget (`packBudget`, in characters) bounds one pack; this bounds one item across a phase |
| "Fair share" | *`ceil(requests / servable)`* | A share of the phase, computed from the store the run built — not a constant in a header |
| "Rotation" | *allocation at constant dose* | Same number of served requests, different distribution of them |
| "Excluded" | *withheld for this request only* | The item is still active and still ranked; it simply may not fill this pack |

**Exclusion set** — the ids one recall request may not be served, carried as `RecallQuery.exclude` and honoured by
the store *before* ranking, so the pack serves the next candidate instead of one item fewer. The distinction is the
whole mechanism: a filter over the finished pack changes the dose, an exclusion inside the search changes the
allocation, and only the second is the experiment.

**Starved request** — a request issued while every servable item had already taken its share, so the only pack the
store could return is empty. It is kept apart from a store with nothing to say, because the two have different
fixes: one is a cap set too tight against the store, the other is a store that does not cover the question. The
artefact counts them (`serveRotation.starved`) rather than leaving a silent phase to be explained later.

**Inert arm** — a dispatch that declared a treatment the data never let it apply: a cap the ranking never reached
(`maxRenders < cap`), a floor that retired nothing, a rung that withheld nothing. This record's rule is that an arm
whose own reading cannot say whether it acted has produced no finding, and the reading is designed to say so in one
number rather than in a paragraph of caveats.

**Treatment key** — the string that decides which folds may be averaged: `unit`, `form`, `scope`, `model`,
`traceClaims`, `knobs`, `rotation`, in that order, joined by `/`. A field the artefact does not carry is left out,
because the key is *what the file declares* rather than what ran — inferring a value from the registration would
make the key depend on a file the artefacts do not reference. Two folds with different keys are two experiments,
and averaging them is the mistake the published −4.64 pp made.

**Declared `none`** — the literal a fold writes when it ran with no serving policy, distinct from the silence of a
fold written before the field existed. Silence pools with nothing; `none` pools with `none`. The distinction is only
usable if the producer writes it — a reader that filled the blank in would make the two states identical again,
which is why the field is total at the writer (`treatmentOf`) and unchanged at the reader (`treatmentKeyOf`).

**Reuse** — the share of a nearby case's answer that applies to the case at hand, measured as the Jaccard overlap of
the two gold queries' column sets, divided by the union so a fragment is not counted as a whole answer. It is a
property of the **corpus**, not of the store: a lesson can only transfer where the two answers already share a
column, so reuse is a ceiling on every content axis at once. `pnpm eval:reuse` reports it per band, for two corpora,
with a cluster bootstrap.

**Contradicted** — a verdict about a reading rather than about a corpus. `null` says the top band failed to clear
zero and can still be blamed on the sample; **`contradicted`** says the top band's sign flipped between two corpora,
which no increase in sample size repairs. The distinction matters because a null invites buying more questions and a
flip forbids it.

**Contract pre-flight** — The gate an environment lane passes before a model is called: a reset states a task
and publishes admissible commands, an admissible command changes the observation, an inadmissible one is refused
in the environment's own words, and a walk of many steps keeps the episode alive. It is a statement about the
driver, not about a score, and the run prints its own model-call count beside the verdict so a green build cannot
be read as a result about memory. ALFWorld's pre-flight (R161) exists because its `walkthrough` field is written
in first-release symbolic coordinates: the text environment answers `Nothing happens.` to every step, so the
obvious gate — replay the gold plan — is unavailable for a reason that retrying does not fix.

**In-force pin** — A version constraint that is resolved in the same `pip install` command as the package it
constrains. A pin installed afterwards has never been in force for the build that ran, and it leaves a file that
looks correct beside a traceback that contradicts it: `textworld 1.6.1` reads `ParserConfig` from `tatsu.infos`,
the resolver prefers 5.15.1, and the pin to 5.8.3 was a separate command that executed after the import that
failed.

**Floor pass** — A sweep of a whole split by a walker that chooses uniformly among the commands the environment
itself publishes, with no model called. Its score is a property of the corpus rather than of any method, which
is what makes it worth reporting: it bounds how much of the task family is reachable by accident, and the
transcript lengths it records are the only measured input a per-episode price has.

**Soft cap** — A memory size that is declared but not enforced. ExpeL sets `max_num_rules: 20` and truncates
nowhere: the arithmetic charges three for a removal once the list passes `cap + 5`, and a prompt suffix tells the
model the list is full and asks it to evict. Bank size therefore drifts with how literally the model follows that
request, which is why `mergeOperations` reports `peak` beside `culled` rather than only the final size.

**One-directional substring identity** — Testing two rule texts for sameness by asking whether the *existing*
one is contained in the *incoming* one. A rule that grows (`check the lamp.` → `Always check the lamp.`) is
recognised as the same rule; a rule that shrinks is not. This is ExpeL's reading, kept in `rule-bank.ts` as the
default so that the port is a control rather than an improvement on the thing it is controlling for.


**Pack shape** — What a knowledge block looks like once `renderPack()` has arranged it: how many sections, in what
order, with which instance values replaced by placeholders. A shape is a delivery decision, not a storage one. A
two-section block (a plan above, a procedure below), a block ordered by a state graph, and a block whose rows are
collapsed by action shape are all shapes over the same items, and none of them requires a new structure in the store.
The distinction matters because the alternative — putting the shape in `memory/` — makes this library a second
memory substrate, owing the decay schedule and bitemporal facts that `@agentix-e/cortex` already publishes.

**Substrate query** — A question asked of a memory store *independently of any task*: "what did this user say about
their move, three months ago". It is the benchmark family `cortex` reports on (LongMemEval, LoCoMo), and it is not
what `microglia` measures — a pack can make a task succeed more often, and no change to a pack can move a
long-conversation F1. The test for where a mechanism belongs is **the score its authors report**: a task success
rate under a fixed model and prompt skeleton belongs here, a substrate query score does not. Two systems called
Synapse sit on opposite sides of that line — the ICLR 2024 one reports MiniWoB++ and Mind2Web task scores, the ACL
2026 one reports LoCoMo F1 — which is why the test is the score rather than the name.

## Selection terms

The words below are new because the failure they describe was new: an arm whose filter admitted nothing, scored a
control's rate, and reported a treatment's counters.

**Carried** — What an arm actually put in front of the model, per game, read from the artefact's own `pack_entries`.
The distribution is the first thing a reading prints, because it is the admission test for everything after it:
`{1: 134}` means every game carried one entry, `{0: 134}` means the arm is the control with a longer prompt, and a
spread means the filter fires where it should. **The pack is the treatment**, so an empty pack is not a weak
treatment; it is the absence of one.

**Empty pack** — A pack arm that carried zero entries in every game it drove. Refused by the join rather than
reported: its score is the control's score, and its label does not describe the prompt. The arm that produced this
term scored 81/134 against a control of 90 with 88% engagement and six by-kind rows, so every counter the lane had
was healthy except the one nobody aggregated.

**Engagement** — The share of games whose action digest differs between two arms. It measures that the prompt
changed, not that the memory was read: an empty prompt diverges too. It is a necessary counter and never a
sufficient one, which is why the register's voiding conditions now include a manipulation check before engagement.

**Kind gate** (`--gate-kind`) — Selection by the **task the game names**, read from the gamefile's directory before
the first call. It replaces an overlap floor that cannot fire on this corpus: a room description carries furniture
nouns and a rule carries operations, so the largest lexical overlap available is one word. An entry tagged
`"kinds": ["put", "puttwo"]` is carried for those tasks and no others; an untagged entry is carried everywhere, which
is what keeps every earlier arm comparable.

**Overlap floor** (`--gate-share`) — The read-time repair `arXiv:2610.07311` names, ported as a floor on the share of
the observation's own content words a rule must account for. Correct as a description of *when* partial evidence
distorts inference, and inapplicable on a corpus whose observations do not name the failing step: at 0.2 it admitted
nothing in 134 of 134 games. The term is kept because the mechanism is real and the corpus is the reason it did not
fire — the next corpus may be the one it was written for.

**Manipulation check** — A condition on what the experiment *did* rather than on what it produced: was the treatment
in the prompt, was the block the length it was registered at, did the bank hold the rules it claims. The lane had
three voiding conditions and all three were outcome-shaped (engagement, harm share, control level); the manipulation
check is the one that caught the arm in 208.2, and it costs one counter.

**Inert knob** — A flag that a given arm cannot act on, which the arm records as null rather than refusing. The
control carries no bank, so `--gate-kind` selects nothing from nothing; refusing it made a flag whose legality
depends on the arm into an error on the arm the workflow's matrix sends it to, and four control shards died on their
first line. The rule is one sentence: **a knob that selects from an empty set has not been moved** — so the header
says `gate_kind: null`, the label stays `none`, and the control keeps the name every reading is compared against.

**Noise floor (this lane)** — The run-to-run movement of an arm against itself, measured rather than inferred: the
same 24 prompts, byte-identical across two dispatches (`prefix_chars` and pack equal in all 24 `put` games), scored
10/24 and 9/24. **One game in twenty-four, 4.2 pp.** It is the smallest difference this lane can see, it is the number
every delta has to clear, and it is why a three-win difference is reported as a tie while a 24-discordant-game
difference is reported as an effect.

**Redundant sentence** — A bank entry that restates something the observation already carries: the microwave is in
the room, the sinkbasin is the cleaning station, a container is closed. Measured, not assumed: five hand-written
sentences of this kind cost 8.96 pp against the one repair they were added to, and the arm that carried one of them
per game scored below a prompt that carried nothing. The complement is the **repair sentence**, which names an
alternative phrasing the world never names — the only kind of entry this lane has ever measured a gain from.

**Sentence tax** — The price a pack pays for its length, separable from what it says: −3.4 to −3.7 pp per sentence on
the padded-block ladder, −1.79 pp per sentence for five task-relevant additions at n = 6. It is second-order against
content: a redundant sentence is worth less than nothing, and no correct sentence is worth less than its length.

**Verbatim trace** — A memory entry that is a trajectory fragment with nothing edited: the failed action, the thought
after it, the action that worked, the observation that confirmed it. R176 carried one at **505 rendered characters**
against the **489-character** sentence distilled from it, which is what makes form and content separable here.
Measured: the same value as the sentence (+2.99 pp, p = 0.445 at a 16-character distance) and the opposite failure —
best arm on four of six kinds, **1/24 on the one kind it came from**, with the fewest invalid actions of any arm in
the lane. It transfers the shape of a solution and carries its nouns with it.

**Referent (of a memory entry)** — The thing an entry is *about*: a step, a room, an object, a task type. R175 and
R176 together make this the variable that decides whether an entry pays. A sentence about a failing step transfers
into five kinds it was not written for because the step recurs; a sentence about a kind's objects does not; a trace
about one room's objects actively costs the games in that room. **Selection signals operate on referents, not on
texts**, which is why a task-kind gate and an observation-overlap floor both failed here.

**Resolution floor (this lane)** — What this split can see: **12–13 pp** on 134 paired games, from the register's own
minimum-detectable-effect arithmetic, and **4.2 pp** on identical prompts from the noise measurement (AUDIT 34.247).
Every hypothesis this lane still holds is 3–6 pp, so the next purchase is games rather than arms — a second corpus
section (140 games) moves the floor to ≈ 9 pp and a 274-game join is the first design that can resolve what is left.

**Corpus section** — One of the three sets of ALFWorld rooms the environment publishes: `eval_out_of_distribution`
(134 games, `valid_unseen`), `eval_in_distribution` (140, `valid_seen`) and `train` (3,553). The lane's published
numbers all come from the first. A section is not an implementation detail: it is the unit of a leak (a bank
distilled from one and scored on it), of a denominator (each publishes its own size) and of a comparison (an
effect present in held-out rooms and absent in seen ones is a property of the split, not of memory).

**Declared mixture** — A join that spans two corpus sections and says so with `--expect-splits`. Refused while
undeclared, because a pooled rate over two populations is an average wearing one population's name; once declared
it is *graded* — every episode carries its section and the reading prints each section's delta beside the pooled
one. The distinction is between pooling silently and pooling with its parts shown, and it exists because a second
section is the only place this lane can buy resolution.

**Distilled-on ≠ scored-on** — The rule that a bank may not be evaluated on the section it was distilled from. It
is enforced by data rather than by intent: `distill.py` writes `source.train_split`, read from the artefacts
themselves, and `alf_dispatch.py` refuses a `--split` equal to it. A *hand-written* bank — one sentence, one
verbatim trajectory — is a function of no section and is therefore allowed anywhere; a distilled bank with no
recorded provenance is refused rather than trusted, because "cannot prove" is not "did not".

**Provenance clause (of a memory entry)** — A suffix that names where the entry's evidence comes from: R178 used
`[source: one won pick_and_place_simple game, run 44841962248]`. It is not the same object as the entry's own
provenance in the artefact (`bank.source`), which records who wrote the bank and after which reading. The clause is
*text the model reads*; the field is *text the lane reads*, and R178's finding is that the first costs 3.65 pp while
paying nothing, which is why the two are now kept in different places in the file.

**Length control (of a clause experiment)** — An arm that adds the same number of characters as the treatment and
no evidence: `[note: a reference for this task, not an instruction for it.]`, 62 characters, no digit in it. It is
not a padding block: padding adds *entries* and pays the per-entry price (R174.2), while a clause lives inside one
entry. R178 measured the difference — +62 characters inside an entry cost −0.36 pp [−4.74, +4.01] and a padded
sentence cost 3.4–3.7 pp — so the cost of a pack is per entry, not per character, and a length control must be a
clause.

**Ghost citation** — A citation of a run that does not exist (`run 44800000000`), used as R179's arm. It is not a
typo and the file says so in `source.false_by_construction`: a real run that never carried the entry is the same
arm at the model's level, because a frozen model reading a prefix cannot check either. The arm is what separates
"citations are read and evaluated" (a false one costs) from "citations are inert text" (it does not).

**Matched-arm resolution** — Buying a smaller mde with a second *treatment* instead of more games. Two treatments
share a model, a harness and a game list, so their discordance is the disagreement between two packs rather than
the swing of a control that has read 80 to 91 wins on the same 134 games. R178 halved the discordant count
(90 → 42) and took the mde from 9.70 pp to 6.63 pp on the same 274 games, for one arm's price (≈ ¥2.4) — the row
that would have bought ≈ 6 pp with a training-section subset was quoted at ¥10–50.

**Refused command (as opposed to an invalid action)** — A command the lane's parser dropped because the reply that
carried it opened with `> think:`. The parser is the competitor's and anchors at the first line, so the drop is the
rule rather than a defect; what was a defect is that the driver answered the turn with `OK.` and the model believed
the command had executed. Two ways a turn can fail to reach the world, and only one of them was ever counted: an
**invalid action** is emitted and refused by the environment (counted in `invalid_actions`), a **refused command**
never arrives (counted in `refused_actions`, which did not exist until R181).

**No-op acknowledgement** — `Nothing happens.`, the string the environment returns for a command that changed
nothing, used as the driver's answer to a turn whose command was refused. It is the corpus's own wording rather than
a new token, because the prompt's comparability rests on being the competitor's: `OK.` stays the answer to a thought
that was only a thought, which is what the few-shot examples show, and `Nothing happens.` is the answer to a turn
where something was written into the void.

**Parser channel** — Which reader a pass drives, of two. `reference` is the competitor's parser transliterated:
`re.match` anchored at the first line, so a reply that opens with a thought loses any command under it. `any-line`
keeps that rule and executes the command it refuses. A channel is not an arm: it changes the harness under every arm
at once, so it is recorded in every episode (`parser`), named in every label (`always-in@anyline`) and refused as a
pooled span by the join until the join is told it is comparing two readers (`--expect-parsers`). R180 and R182 tried to
reach the same behaviour from the prompt and moved it by **−0.73 pp** with a neutral sentence and **+3.65 pp** with a
format instruction at identical length.

**Recovered command** — The same reply a **refused command** is, on the other side of the parser: a command written
under a thought that the lane executed instead of dropping. Counted in `recovered_actions` beside `refused_actions`
because the two are one event with two possible ends, and the pair is what shows that two channels drove the same model
behaviour — the reference channel dropped 11.64 and 10.53 per `put` game, so the second channel recovering far fewer
would mean it met a different model rather than the same one under a different reader.

**Step cap** (`--max-steps`) — The turn budget the environment hands a pass, default 50, and simultaneously a number
the model reads: the human turn is `"{instruction}You may take maximum of {max_steps} steps.\nHere are two examples:"`.
It is the one lever in this lane that is **not orthogonal to the arm**, because arms win at different speeds — the bank
arm's `put` wins in 13.1 steps and the control's in 21.8 — so the same cap takes 15 games from one arm and 40 from the
other. Both sentences are the treatment: shortening the cap shortens the budget *and* changes the number in the prompt,
and a fourth cell (short cap, long sentence) is the only way to separate them. The join treats it as a second
harness — `max_steps` per slice, one label may not span two caps, and a cross-cap join is refused until `--expect-caps`
names the span — because the cap's price is asymmetric between arms and the delta would be partly arithmetic.

**Pure-budget counterfactual** — The score an arm would read at a shorter step cap **if the model did exactly what it
did at the longer one**, computed from artefacts already paid for as `|{e : e.won and e.steps <= cap}|`. It is a floor
no behaviour can fall below and a ceiling only behaviour can raise, because a shorter cap is a strict subset of the
feasible set — and unlike every other counterfactual in this lane it is **exact rather than sampled**, since it is
recomputed from the same records instead of estimated from a null. `257 → 242` and `197 → 157` are the R183 numbers at
a cap of thirty.

**Budget inflation** — The part of a cross-arm delta at a shortened cap that is arithmetic rather than memory: at a cap
of thirty the same model behaviour reads **+31.02 pp where the fifty-step pass read +21.90 pp**, and **+33.94 where
+29.20**, because the cap costs the slow arm more. It is why a reading at a new cap quotes absolute scores and prints
the counterfactual beside them, and why a cross-arm delta at a new cap is a derived quantity whose null value is the
inflation rather than zero.

**Bank digest** (`bank_digest`) — A 16-hex content hash of the entries an arm actually rendered, recorded in the header
and in every episode. It is content rather than a path, so the same sentence loaded from two files is one bank and two
banks edited to the same rendered length are two. `""` means no pack was rendered (the `none` arm) or the artefact
predates the field (before R185). The join refuses a label that spans two digests — one arm is one pack — and prints the
digest of each side above a delta, because R185's design makes two banks agree on every other field the join reads.

**Tail swap** — The R185 design: hold the first 157 characters of a 354-character entry and replace the last 197, so the
rendered pack stays at 551 characters and the label, reader, cap and entry count are unchanged. It is the cleanest
one-variable experiment this lane can run on a bank, and it is only available because every arm since R180 is
length-matched — which is also why it needs `bank_digest` to be auditable at all.

**Kind scope** — The set of task kinds an entry claims through its `kinds` tag, and the unit in which a memory is paid for.
An untagged entry is carried everywhere by `applicable`; a tagged one only where its kinds list names the game's kind, and
`--gate-kind` turns the filter on. When the tags **partition** the corpus's kinds every game carries exactly one entry, so
the price is fixed and a per-kind substitution is a content test rather than a length test — the shape R186 registers,
after R185 measured +10.2 pp on the kind one entry named and −22.4 pp on a kind it did not.

**Pack digest** (`pack_digest`) — A content hash of the entries one *game* actually read, recorded per episode. Under a
kind gate it changes with the kind, while the run's own `bank_digest` does not: one bank, several packs. The join groups
on the bank and reports the pack, because a rule that grouped on the pack would refuse every gated round.

**Scope error** — The failure a memory bank commits when an entry written about one task kind is read by every kind: the
sentence is true, and it is a treatment on tasks it was not written for. R185 is the measurement (+10.2 pp on `put`,
−22.4 pp on `clean`, net −12 games from one 197-character tail read by six kinds) and R186 is the repair (the same
characters delivered only to `put`: the gain replicates, the five other kinds move one game). It is the sharpest form of
the question this project exists to answer, because the negative effect is not the entry being wrong — it is the entry
being **wider than its subject**.

**Kind-local meter** — A counter whose events come overwhelmingly from one task kind, so that its pooled value is a fact
about that kind and a rumour about the rest. `recovered` is the case: 246 of R183's 269 events are `put`, and 133 of
R186's 168. Since R186 the join prints each kind's own count and divides by that kind's own calls, and prints nothing for
an arm file that predates the field. The general rule is to ask what share of a pooled number comes from one stratum
before quoting it — the question three of this lane's failed readings had in common.

**Instrument class** — The three readings this lane has had to retire, which are one error in three costumes: a
denominator fixed by the outcome. R183 took a mean over **lost** games (nine became three, so the mean rose); R184 read a
counterfactual over a **sampled** policy as a floor; R186 registered a band over a **pool** that is nine-tenths one kind.
Each was arithmetic documented to the digit and each was a true number about a population nobody had named.

**Rumination** — A model turn that carries no command. It is charged to the pass budget exactly like an action and it
moves nothing in the world, so an episode can be lost without the environment being touched more than a handful of
times. R186's ten losses are five games of 24 to 46 thoughts against 4 to 26 environment steps, and five games of 0 or 1
thought against 49 or 50 environment steps; no won game in 264 has twenty. The join prints the mean and the count of
**heavy** games (≥ 20) because the two families are disjoint rather than distributed.

**Turn economy** — How much of the fixed turn budget reaches the world. A pack raises it here: 9.23 thoughts a game in
the control against 4.2 with the scoped bank, because a sentence that names the next action leaves less to deliberate
about. R189 raised it again without touching the pack: thoughts a game **4.96 → 3.01** under the guard, and steps a game
17.28 → 15.87, so the arm is not doing more, it is narrating less.

**Turn guard** — The driver's answer to a reply that carried no command (`--guard-commandless`). Off, it is `OK.`, the
competitor's own no-op, which is truthful and also a per-turn reward for narrating. On, it is `OK. Reply with one command
only.` — one line, no extra call, and conditional on the state the episode is in, so it cannot fire in a game that never
enters a loop. It is a **harness** knob rather than an arm: it travels in the label (`@guard`), the header and every
episode, and a join refuses to pool two guard states until it is told it is comparing them.

**State ledger** — The driver's answer to a turn whose command moved nothing (`--state-ledger`), and the guard's
sibling on the other side of a failed turn: the world said `Nothing happens.`, or the action was not admissible, so the
observation is followed by one line naming the last three commands already tried with repeats collapsed. It is a
**renderer over the episode's own history**, not a memory: nothing is written back, nothing survives the episode, and a
game whose actions all land carries no extra character. Conditional by construction, recorded per episode
(`ledger_fires`, `ledger_chars`), labelled (`@ledger`), and refused in a join that does not name both states. Its two
triggers are **nested in this corpus**: the admissible set is the set of commands that do something, so a refused command
is also a no-op, and over 822 armed games `ledger_fires` equals `invalid_actions` exactly — the renderer is an
admissibility repair in practice (AUDIT 34.284). R191 read
**413 fires / 42,845 characters** and won all four games it was registered for; its failure mode is that a line which
repeats is a constant, and one game received forty of them and still lost at the cap (AUDIT 34.279).

**Counted ledger** — The state ledger's second renderer (`--state-ledger-counts`): `take apple 1 (4 times)` instead of a
copy of the copy, plus a gate that silences a line whose three-command window is the one the previous line named
(`ledger_suppressed`). Labelled `@ledger-counts` and a separate treatment in every join. **Measured negative** (R193):
263/274 against the plain list's 267, 479 lines against 413, a 42-line worst game against 40, and **2 silences in 479
chances** — a count changes the line's text without changing the window the gate compares, so the gate sees no repeat
(AUDIT 34.281). The family's version is the plain list.

**Admissible hint** — The state ledger's third renderer (`--state-admissible`, R194): on the turn that moved nothing, one
line naming **how many commands the world admits** at that state and one of them, chosen deterministically (shortest
command sharing the refused verb, else the first in the world's order). Labelled `@ledger-admissible`; recorded with the
shared fire counters and three instrument fields (`admissible_mean`, `admissible_max`, `admissible_sample`). It exists
because AUDIT 34.284 found that every line the other two renderers ever sent answered a **refused** command — the family
is an admissibility repair, and this names the set that would work rather than the set that did not.

**Release distribution** — The spread of one arm's pool number across repeated draws on the same games, bought in R192 so
that the published figure is an interval rather than a point. Five draws of the ledger arm: 267, 268, 265, 268, 270 of
274 — **1.82 pp** range, s.d. 1.82 games — pooled **97.66% [96.72, 98.34]** over 1,370 games. The unseen section moves by
one game across all five and the seen section by four, so the stable half of a two-section claim is also the saturated
half. Two independent draws of 274 games can resolve **3.74 pp** at 80% power, which is larger than every paired effect
this lane has reported; only a within-dispatch paired join can see a 0.73 pp difference.

**Utility score** — The admission family's offline estimate of what an entry is worth, computed with no rollout:
specificity x abstractness (`arXiv:2608.20274`). Specificity is the share of the text that is command notation (quoted
spans, `<placeholders>`); abstractness is the share of the words that are frame words (`if`, `before`, `every`,
`instead`). Both are rates, so neither can be bought with length, and both are order-free, because R188 measured a
sentence against its word-shuffled placebo and found no difference. **On this corpus the score is not a gate**: its whole
range is 1.62x against a 9.7 pp minimum detectable effect, and the rank correlation over the three comparable banks is
+0.500 with one inversion (R190, AUDIT 34.277).

**Reach** — Which task types a treatment actually touches, as distinct from which ones its words mention. Measured two
ways in this record: by tag set (R186 versus R187 hold identical sentences and differ by 3.65 pp across two draws) and by
mechanism (R177's entry names neither `heat` nor `clean` and gains 28.2 and 22.4 pp on them, because what it carries is a
precondition). A lexical test — does the entry name this kind's operation — reproduces the sign on three of six kinds,
which is why reach is printed beside a score and never folded into one.

**Quantity (of a delta)** — What a measured delta is an instance of: *bank against no bank in one dispatch*, *bank against
its own word-permuted placebo*, and so on. Two deltas are only points on one axis if they are the same quantity, and a
rank correlation is computed inside one. R190's first registration mixed them and included a row from a run that drove no
games; `measured-effects.json` now carries `quantity` per row and the scorer refuses a row without it (AUDIT 34.276).

**Engagement ledger** — The three counters that make a conditional intervention checkable: `guard_fires` (the line sent),
`guard_checked` (fires a later reply answered), `guard_relapsed` (checked fires answered by another commandless reply).
R189 read **826 / 825 / 0**: the model answered every fire with a command, which is the mechanism clause; the effect is a
separate number, and an arm that fired zero times is the control with a treatment's name. A count of fires is **not** a
rate over the rare event a guard targets — fires happen once per thought, 20% of turns, while the loop is 1.34% of
games — which is the fifth wrong-denominator defect this record has had to retire (AUDIT 34.275).

**Skill utility score** — The execution-free diagnostic from *Break It Down, Pass It On* (arXiv 2608.20274): the product
of a skill's **specificity** (the probability that it is closer to its nearest task than two random tasks are to each
other) and its **abstractness** (the normalized perplexity of its similarity distribution over the task set). It needs
only the skill and the task descriptions, no rollout, and the paper reports that neither property predicts success alone
while their product does. It is the first published candidate for the question this project has been answering by
measurement — *which entries will hurt* — and the scope tags of R186 to R188 are the hand-built approximation of it.

**Transient class** — A set of losses that looks like a mechanism and is a property of one draw. R186's five thought-heavy
games were read as a coverage gap; R188 re-ran them under two packs and four of five won under the instruction and five
of five under a permutation of it, at 1 to 10 thoughts. The pool stayed at 264 to 266 across three packs while only
three of the twenty game-slots stayed lost. What is plannable is a **rate** — 11 thought-heavy losses per 822
game-draws, 1.34% — and what is not is the identity of the games.

**Length control** — An arm whose pack carries the same characters as the treatment's with the words permuted inside
themselves. R188's placebo (`266/274`) scored at least as well as its treatment (`264/274`), which is what an inert entry
looks like when the round can tell inert from harmful. Without it, the round would have reported a 0.66-thought "effect"
that is inside the same-prompt band of 1.12.

**Command record** — The two per-episode fields `commands` and `fire_turns`: the ordered commands the state renderers
read (including the ones the world refused and the ones the parser dropped), and the index of the command each rendered
line answered. The record exists because every artefact before it kept a *consequence* of the history — a fire count, a
character total — and no question about the history could be asked of it; the invariant `len(commands) == actions +
refused_actions` ties it to the counters that already existed, and `len(fire_turns) == ledger_fires` ties it to the
renderer.

**Fire turn** — An entry of `fire_turns`: the position, in `commands`, of the command whose answer carried a line. The
window the line was rendered from is `commands[:index + 1]`, so a cycle-aware renderer can be replayed offline against a
recorded arm — the question R193's gate asked and could not answer from its own artefacts.

**Task-verb example** — The rule the admissible renderer's example now follows: it must carry one of `take`, `put`,
`clean`, `heat`, `cool`, `examine`, so that naming a command cannot degenerate into naming `help`. The first version of
the renderer chose the shortest command in the set, which in ALFWorld was `help` in 88.7% of the games it fired on; the rule is structural
rather than a blacklist, and when the set has no task command the line carries the count alone. Counted per episode as
`admissible_task_fires` / `admissible_meta_fires` / `admissible_exampleless_fires`, which sum to `ledger_fires`.

**Accepted repeat** — A turn whose command had been issued before *and* which the world did not refuse. It is the only
kind of repetition a refusal-triggered line cannot see: the world said yes, nothing moved, and the state renderers stay
silent because their trigger is the world's verdict. Read by `cycles.py` from `commands` and `fire_turns`; over R195's 274
games there are 195 of them, in 146 games, and they split into **loops** (177: the command had already been accepted) and
**retries** (18: every earlier attempt was refused, and the world admits it now that the agent has moved — progress
rather than a cycle, which is why only a loop is headroom).

**Chain** — A stretch of consecutive turns that each repeat the command `k` turns earlier (`go to countertop 1`, `look`,
`go to countertop 1`, `look`), reported as **confirmations** rather than as the window's length: a period-2 chain of 2
confirmations is three commands long. A stall (`a a a`) is not a chain — that is `most repeated`.

**Headroom** — The share of a pass's **losses** that carry an accepted repeat, which is the ceiling of any cycle-aware
treatment: a loss with no repetition is a loss the mechanism cannot reach. R195's eight losses contain three, so the
ceiling is 3 games = 1.09 pp against a paired mde of 2.29 pp — a treatment that cannot produce a falsifiable reading, and
therefore one that is not dispatched.

**Ceiling instrument** — A reader that prices a treatment's *reach* before it is bought, from artefacts already paid for:
`score_bank.py` for a bank, `admissible_mean` for a state line, and `cycles.py` for a cycle. Its output is a comparison
between the reach and the split's minimum detectable effect; a ceiling below the mde is a null by construction.

**Serve profile** — The five knobs a deployment actually ships (`budget`, `note`, `budgetBasis`, `speakMargin`,
`credit`), held as data in `packages/core/src/kernel/serve-profile.ts` and read by the product (`createServer`)
and by an eval control arm through `serveOptions()`. A field's value `null` means "the library's own default" and
is deliberately distinct from the default's value: `speakMargin: 0` attaches `pack.decision` where an absent
margin does not.

**Shipping contract** — The pairing of the serve profile with `eval/results/serve-profile.json`, which carries a
justification per field, checked by `pnpm eval:serve-profile`. It refuses a value the record and the product
disagree about, a field with no justification, a placeholder reason, and a reading that does not resolve. A lane's
treatment arm is bound by the same record through **arm serve** below, so "the arm" and "the product" are one
program plus a named delta rather than two argument lists that happen to agree.

**Decorative reading** — A resolving paired interval about a knob the product ships at its default. The evidence
is real and the deployment ignores it, which is the shape a measurement takes when it is collected for a report
rather than for a release; the audit refuses it instead of counting it.

**Measured field** — A serve-profile field that carries a resolving reading *and* whose value the product ships.
Both halves are required, which is why the count is the honest one: this version is five fields, zero measured,
each with a stated reason.

**Arm serve** — An eval arm's host options, derived by `armServeOf()` as `serveOptions()` plus the fields the
dispatch named. Each moved field carries a `reason` (a variable or a registration), a field named twice is refused,
and a field named at the value the profile already ships is kept as *named and unmoved* — "asked for the default"
and "never mentioned it" are different dispatches. The run prints the result as `[tau2] serve: arm = profile + …`
before its first model call.

**Arm bill** — What a run was charged, read by `armBillOf()` into three states that are never spelled the same way:
`census` (calls and tokens measured), `count` (calls measured, tokens absent), and `absent` (nothing measured, so
`calls: 0` means "nobody counted"). The artefact writes the state as the flag pair `usage_absent` / `usage_counted`
— `0/0`, `0/1`, `1/0` respectively — because one flag cannot carry three states.

**Bill silence** — The `absent` state of an arm bill. It is not a measured zero and not a failure: it says that no
census and no recorded count reached the file, which is what a re-scored upstream document and every pre-R198
artefact look like. A recorded `calls: 0` is deliberately read as silence, because no artefact in this lane has ever
measured a zero it could prove.

**Pack ledger** — A fold's `serveYield` and `degradation` blocks read as one account: `served`, `inert`, `repaired`,
`broke`, closed by `inert = served − repaired − broke`. Printed by `pnpm eval:pack-ledgers` and committed as
`eval/results/pack-ledgers.json`.

**Inert share** — `inert / served`: the share of served packs whose episode verdict did not change. Measured rather
than estimated, because inertness is defined as "the verdict did not change". The only quantity on this lane that
replicates across folds (70–88% on five folds, three treatments).

**Break premium** — `broke − repaired`, in episodes. Positive means the pack costs the lane episodes; the corpus
value is 33 − 22 = 11, which is what `breaksToFlip` is derived from.

**Repairs per break** — `repaired / broke`, or `null` when nothing broke. Below 1.00 the pack is losing episodes;
a rate with no denominator is not zero, so it is absent rather than `0`.

**Breaks to flip** — The number of breakages a gate must prevent for a pool's delta to stop being negative:
`broke − repaired + 1` when that is positive, `0` when the pool is already positive. The corpus needs 12 of 33
(36%), which is the target a mechanism claim is measured against.

**Inert price** — The prompt tokens an episode's inert share bought: `(memory − control) / measured`, times the
inert share. `priced: false` — with both arms' bill states named — when either arm lacks a census, when a census
carries no token column, or when the subtraction is negative.

**Peak window** — The hours a provider bills at double the off-peak rate: 01:00–04:00 and 06:00–10:00 UTC on
weekdays for the card in `cost.ts`. Weekends have no peak, which is why a Sunday dispatch fits any hour.

**Window fit** — Whether a run can finish inside the current off-peak stretch, computed from an estimate of
`26 s` an episode plus ten minutes of setup. A refusal names two hours: `peakOpensAt` (what the run would cross)
and `windowOpensAt` (the next stretch long enough to hold it, which is what goes in `not_before`).

**Rung** — one threshold of the serving policy: a pack is withheld when its top two candidates are closer than the
rung. The set of rungs a run prices is its *ladder*, and every fold this lane has committed carries one
(`serveSweep`), which is why a dose–response can be read from a fold that was bought for another question.

**Dose–response (of a gate)** — what each rung does to the corpus: how many packs it silences, how many repairs
survive, how many breaks it removes. It is read from a ladder rather than bought with a dispatch, because a ladder
prices every rung against the same episodes — the one design decision that makes R201 cost nothing.

**Selectivity** — `prevention − repairLoss`, with both as shares of their own corpus totals: how much more of the
corpus's breaks a rung withholds than of its repairs. Zero is a dose knob (both removed in proportion), positive is a
gate that selects on harm, negative is a rung that silences the packs that were *helping*. `null` on a corpus that
repaired nothing, because a gate cannot lose repairs it never had.

**Injected tokens per episode** — the memory arm's prompt tokens minus its own control's, divided by the episodes
measured. It is a *difference between two runs of one dispatch*, so it is refusable when either arm lacks a census,
and it is not the pack's size: the pack rides every later turn of the episode, so the premium is its size × the
turns it rides, plus the scaffold's own delta. On the one fold that carries a bill, 3,299.6 tokens an episode
against a 197-token pack over 11.2 turns.

**Tokens per repair** — injected tokens × episodes ÷ repairs: the price of the effect rather than of the delivery.
It makes the cost axis comparable across mechanisms, because a system that serves the same tokens and repairs twice
as often is measurably better, and it is the number a memory has to be judged on when its inert share is high. On
the one priced fold, **32,996**: 131,984 tokens over four repairs.

**Serve body** — what the pack is made of at serve time. `rendered` is the block the store served, injected on the
first turn and reused for the rest of the episode; `guidance` is one sentence written for the request by one model
call and discarded once the episode ends. It is a field of the treatment (`serveBody`) rather than a detail of the
renderer, because two folds that served two bodies are two experiments and the pool has to keep them apart.

**Transient arm** — the arm whose pack is a `guidance` sentence and which writes nothing durable: the store's item
count is the same at the end of the phase as at the start (`storeGrowth.grew` is false). Its published precedent is
*More Memory, Worse Agents* (2026), where per-task guidance built from logs and thrown away scored 59.9% against
53.5% for the raw logs it was built from and 49.0% for stored lessons.

**Guidance sentence** — the one line the transient arm injects, produced by one model call that is shown the served
records and the request and is told that `NONE` is an acceptable answer. Three outcomes are counted apart: a sentence
(served), a refusal (`NONE`, the arm's own gate) and a failure (the provider, which injects nothing rather than
falling back to the block).

**Refusal (guidance arm)** — the summariser answering `NONE`: it was shown the served records and the request, and
judged that they do not bear on it. A refusal injects nothing, exactly as a provider failure does, so the two are
counted apart but treated alike by every gate that asks whether a fold's served population is its injected one. The
first fold of the transient arm refused **34 of 40** episodes, which is the same verdict R200 reached from outcomes
(78.7% inert) and this fold's own census reached from renders (80.0%) — three instruments, one answer.

**Injected population** — the episodes whose prompt actually carried a body. On every arm before R204 it coincided
with `serveYield.renders`, so the inert identity had one denominator; on the transient arm `renders` counts the packs
the *facade* served while the agent may have read nothing. Since R205 the population is a **field**: the agent raises
`injectedEpisodes` where the injected message is built, the join drops the episodes that carried nothing, and
`serveYield.withheld` is the number it dropped. A transient fold with no `withheld` predates the instrument and its
share is still about the facade, which is why `pack-ledgers` refuses it.

**Withheld episode** — an episode excluded from a render census because its prompt carried no body: the summariser
answered `NONE`, the provider failed, or the recall came back empty. Excluded rather than booked as inert, because an
episode that read nothing cannot be evidence that reading changed nothing. On R204's fold 34 of 40 episodes were
withheld, which is the same fact as the 85% refusal rate counted on the other side of the join.

**Store growth** — the store counted before and after an evaluation phase, recorded on every arm as
`storeGrowth: { before, after, grew }`. It exists because a mechanism whose claim is "the artefact is the defect"
must be checkable against a file, and because an arm that writes during evaluation is a lesson arm with a step in
front of it.

**Note** — R206's material: one imperative sentence distilled from a *failed attempt at one task*, written by the
runner between two rounds, read by the agent at the start of the next attempt at that same task, and dropped with
the task. Not a stored lesson: nothing is written to a store, nothing is retrieved across tasks, and the sentence
does not survive the phase. It exists because the largest published effect in this literature is a statement about
the material rather than about retrieval.

**Note sidecar** — the file the note lives in, `{ key → { note, attempt, reward, task, chars } }`, written by the
runner at a round boundary and read by the agent when an episode opens. The key is the episode's opening request
(`notes.note_key`), computed identically on both sides, so the identity cannot drift between a writer and a reader.

**Round** — one `run_tasks` call: one attempt per task, at one seed. R206 schedules its four attempts as four
rounds rather than as τ²'s `trials: 4`, because a round boundary is the only point at which a runner holds a
reward and the next attempt has not started — which is exactly where a note has to be written.

**Coverage (notes)** — `written / failed` over the rounds after the first: of the failed attempts, how many produced
a sentence. The complement splits into three states that are not the same fact: `refused` (the summariser answered
`NONE`), `providerFailures` (the call failed), and `unreadable` (the reader could not see the messages).

**Specificity (notes)** — the share of notes naming at least one token that appears in their own task's failure and
in no other task's. The check that separates a note about the failure from a restatement of the request.

**Serve body** — what the injected material is made of, as opposed to where it came from: `rendered` (the block the
store served), `guidance` (one sentence a summariser wrote from that block, R204), or a note (R206). It is the field
the corpus headline is scoped by, because `renders` counts served packs on two of those and the summariser's
*inputs* on the third.

**Pilot (R206a)** — six tasks × four rounds × two arms, 48 simulations, ≈ ¥1.5. Not a fold and not a claim: it
observes that the note handoff happens, measures the summariser's coverage and specificity on real retail failures,
and prices the two arms, so that the 320-simulation fold is bought on evidence rather than on a hope. Its artefact
carries `claim: "none"` and its interval (±30 pp at six tasks) is the reason.

**Contract job** — the free half of `note-pilot.yml`. On every push that touches the note material it runs the same
four commands the paid job runs, over a generated fixture pair, and requires the reading to come back `GRADED`. It
exists because a mechanism whose dispatch path is first exercised by a dispatch is a mechanism whose typos cost
money.

**Census closure (notes)** — `written + refused + providerFailures + unreadable == failed`, over the rounds after the
first. One failed attempt ends in exactly one of those four states; a census that misses a term makes every share
derived from it a share of a denominator nobody can reconstruct, which is why a document that fails this identity is
`NO_MEASUREMENT` rather than a reading.

**Opening stability** — whether a task's first user message can serve as that task's identity. Measured over a
run's own episodes by `eval/verifiers/opening_stability.py`: exact key reuse, within- vs cross-task similarity, and
the error counts of the best threshold a fuzzy matcher could use. It is a property of the corpus and the user
simulator, not of the material, and it is the first thing to measure before binding anything to an episode.

**Exact reuse** — the share of same-task pairs whose opening keys are identical after whitespace collapsing. τ²
retail measures **0.006**: the user simulator re-samples the opening every attempt, so a mechanism that keys on the
text binds almost never.

**Not separable** — the state a corpus is in when its most dissimilar pair of attempts at one task is *less* alike
than its most similar pair of attempts at two different tasks. No threshold can then tell a task from its
neighbour; on τ² retail two tasks can share a scenario (a water bottle and a desk lamp, for different users), which
is what makes paraphrases of one closer to the other's opening.

**Scope (sidecar)** — the field that says which task a sidecar describes: `{kind: task, task: "5"}` on every R207
invocation, `{kind: many, tasks: [...]}` on a merge of several, `{kind: none}` on a file that names no task. It is
the identity R207 moves out of the opening text and into the file, and `broken` is a state apart from `none` because
a scope that claims to name a task and does not is a writer defect rather than a store-free arm.

**Single-task fallback** — what the agent does on a key miss when the sidecar declares one task: it serves the entry
from the latest attempt, because every entry in that file is about the task this episode is in. It does **not** fire
for `many` or `none`, which are exactly the states in which the identity is unknown again. A file that declares one
task and holds an entry for another poisons itself: the fallback serves nothing rather than a neighbour's sentence.

**Key hit / task hit** — the two identities, counted apart. A key hit is the opening text matching the one the
runner wrote the note under (R206's mechanism, which `opening_stability.py` measured at 0.006 reuse); a task hit is
the file naming the task (R207's). `hits` is their sum, so a reader of the older field reads the same quantity.

**Trajectories sidecar** — `<notes>.trajectories.json`, the failed attempt each note was distilled from, written
beside the sidecar for one reason: specificity is a property of the corpus and one invocation holds one task, so the
cross-task share can only be computed after the tasks are merged. Never read by the agent — a sentence is 40 words
and an attempt is 2,000 characters.

**Merged phase** — an arm's log after `note_pilot.merge_summaries` has summed its per-task phases: the bill adds,
the agent's counters add, the band survives only if every phase ran in the same one (`mixed` otherwise), and two
models or two agents inside one arm are refused. The merge of the *grid* (`notes.merge_documents`) is the other
half: the union of the tasks with every `(task, trial)` exactly once.

**N5** — R207's gate: every sidecar declares exactly one task and there is one per task in the grid. A mis-scoped
file is `DISCARDED` (another arm), a grid with fewer scopes than tasks is `NO_MEASUREMENT` (this arm, with a hole),
and an artefact carrying no scope census is `DISCARDED` because it predates the field.

**Verdict (`verdict_text`)** — the evaluator's account of a failed episode: the reward, the database check, and
every environment assertion, action check, communicate check and natural-language assertion with its outcome, as
lines (`DB CHECK not met`, `COMMUNICATE not met: …`). Rendered into the summariser's prompt only when
`--note-verdict` is passed, because it changes the material the note is written from. Never rendered for a pass: a
pass is not distilled.

**Material (of a note lane)** — what a note was written from: the **attempt** alone (R207) or the attempt plus the
**verdict** (R208). It is a property of the arm and not of the task, so the fold refuses a corpus whose phases
disagree (`tau2-note-pilot-mixed-verdict`).

**Verdict census (`verdicts`, `verdictChars`)** — per round, how many failures the evaluator explained and how many
characters the verdict block added to the prompt. `verdicts: 0` on a round that passed `--note-verdict` says the
evaluator said nothing, which is a different fact from a summariser that did no better.

**Saturated grid** — a task set on which an arm has nothing to learn: no failure arrives in a round a note is
written from, so every downstream gate is untestable. Reported as `NO_MEASUREMENT` with the reason
`no-distilled-failure`, never as `ABANDONED`: the material has not been refuted, it has not been tried.

**Population gate (`N0b`)** — the gate that runs before `N1`–`N3` and asks whether the grid failed anything a note
could be written from. Its absence is what let R207's pilot report "the treatment never read its sidecar" about a
file that had never held a sentence.

**Serviceable sidecar** — a sidecar that holds at least one note (`written > 0`). Only a serviceable sidecar can be
"found": with `written == 0` a zero hit count is the writer's silence, not the reader's.

**Bank (failure bank)** — one control-armed run over a whole split at several trials, with no sidecar, kept as the
population every later round of the note lane is drawn from. Its two readings are `pass^k` over the held-out tasks
and the failed attempts together with their verdicts.

**`pass^k` population** — the set of tasks a `pass^k` is computed over. A reading is only comparable with another
reading over the same population, which is why the bank runs the split's own 114 retail tasks rather than a chosen
six.

**Material ablation** — showing the same failures to the summariser twice, once from the attempt alone and once from
the attempt plus the verdict, and measuring the difference on the pair. Paired by construction: same failures, same
model, same ceiling, so the only thing that moves is the material.

**Rescued / lost** — in a paired binary outcome, the pairs that changed. `rescued` is refused-then-written, `lost` is
written-then-refused, and only these carry information about the change; McNemar's exact test is computed over them.

**Price band (`band_of`)** — `peak` or `off_peak`, from the rate card's windows applied on weekdays only. A job that
runs no simulator has no window guard over it, so it prices itself in the band it is billed in rather than assuming
one.

**Chance rate (of a note)** — the rate at which the same note would appear to name a check if it were written about
some other failure. It is the baseline `P3` is reported against, because a share of 30% means nothing without it: a
note made of the words every failure shares reaches chance and no further.

**Truncated** — a summariser call cut off at its token ceiling, which is *not* a refusal. `deepseek-flash` bills its
reasoning against `max_tokens`, so a call that leaves thinking on returns an empty message for a failure it never
finished reading; `notes.call_note_model` disables thinking and returns `finish_reason` so the two can be told
apart. Counted apart everywhere the census closes, and graded as `P0` by the ablation.

**Kept notes (`--keep-notes`)** — a reading that carries the sentences, their paired sentence and the evaluator's
verdict, so a change of measure can be recomputed with `--from-reading` instead of re-billed.

**Opportunity (in a rescue rate)** — an attempt that followed a failed attempt, and therefore the only place a note
can act. A task that passed its first attempt is not an opportunity, and a rate computed over all attempts is a rate
over attempts that were never offered the material.

**Rescue rate** — `P(pass at attempt j+1 | fail at attempt j)`, per arm. The lane's real endpoint: `pass^k` cannot
move under a note, because reading one requires the failure that already forfeits it. Baseline on the fifty failing
tasks: 15 of 23, 65.2%.

**Blind endpoint** — a measure that cannot register the intervention by construction. `pass^4` for a note is the
worked example: the treatment's `pass^4` equals the control's for a perfect summariser and a useless one alike, so
the null it returns is about the endpoint rather than about the material.

**Drift check** — the treatment arm's first attempts compared with the bank's on the same tasks (27 of 50). No note
exists before attempt 0, so that count samples the same process the bank sampled; a gap of more than four tasks
means the committed baseline does not describe this run, and the comparison is refused (`DRIFT`) rather than
widened.

**Baseline document** — `eval/manifests/note-bank-baseline.json`: R208's bank reduced to `task_id`, `trial`, `seed`
and `reward`, with the commit, the grid and the bill beside them. A counterfactual that lives in a paid run is
committed in the shape its reader reads.

**Seed world** — one attempt's seed, shared by every task in that attempt (`base + i`, one `i` per round). Because
the tasks are not independent draws of the process, the unit of replication is the world and not the task: two arms
run at different seeds are two worlds, and their per-attempt rates differ by far more than a binomial standard
error. R211 measured 38 of 50 against the bank's 27 of 50 on the same tasks.

**Paired rescue (`--baseline-dir`)** — both arms from one dispatch, at the same seeds. The only comparison that
holds the world fixed, and the reason one run can be its own counterfactual.

**Pooled transition (`--pooled`)** — every consecutive pair of attempts summed rather than the first pair only. On a
four-round arm that is three transitions per task, all of them the event a note acts on; the reading prints
`pooled` so the claim stays legible.

**Power ceiling (of a rescue rate)** — the price at which an effect of a given size becomes detectable, and the
number that ends a lane. R212's observed +7.5 pp at a 38% baseline needs ~674 opportunities per arm at 80% power;
an episode yields 0.37 opportunities, so the read costs ~1,800 episodes (≈ ¥58). A lane whose remaining question is
below its power ceiling has no behavioural work left that it would fund.

**Population (of a reading)** — the tasks a share is taken over, printed in every reading because it moves the
number: R212's two arms give +1.8 pp on the nineteen tasks the control failed and +7.5 pp on all twenty-four. The
default is the tasks the baseline failed — the ones with a counterfactual — and any other choice must be named.

**Repair (of a requirement)** — an unmet requirement that the next attempt meets. The benefit side of a material
read at requirement resolution; the unit `memory_debit` counts instead of the episode.

**Break (of a requirement)** — a requirement that was **met** and that the next attempt misses. The harm side, and
the one a pass/fail endpoint cannot see: a single break turns the episode into a failure and the number that
appears is the one a rescue would have moved. R212's paraphrase broke 43 requirements against the control's 37.

**Admission bar** — `breaks / (repairs + breaks)`: the precision a gate must reach before admitting a case is
worth more than admitting everything. When it sits above the base repair rate the population is net-negative and a
filter has to beat the population by that margin. R212's paraphrase: 51.8% against a base of 48.2%.

**Naming association** — of the requirements an attempt missed, the share its own note mentions (50.0% for the
paraphrase), and the repair rate among the named ones against the silent ones (53.7% against 41.5%). A blunt
lexical test on purpose: an embedding would make the reading depend on a model that changes, and a note that never
writes the words is not about them.

**Verdict material** — the evaluator's verdict served as the note itself (`--note-source verdict`). It names every
unmet requirement by construction, costs no model call, and is the ceiling a material could reach with a perfect
checker rather than a deployable configuration.

**Noise floor (of a grid)** — the movement a run produces with nothing changed. Measured directly at attempt 0,
where no arm has a note and every arm sends the same prompt at the same seed: R213's verdict arm passed 9 of the 20
tasks the control failed, against the control's 13 — **four tasks, 20 points on 24**. An effect below the floor is
not measurable on that grid, whatever its p-value.

**Blind comparison** — a reading whose two sides differ by more than the intervention: two arms at different seeds,
or two runs at different times. The drift check exists to catch it and the noise floor is how large it is.

**Verdict material** — the evaluator's verdict served as the note itself (`--note-source verdict`), naming 100% of
the unmet requirements for zero tokens. R213 measured it at +4.0 pp repair over the control against the
paraphrase's +12.3: naming is not the lever, which is why the material was not the defect.

**Goal board** — the state channel's material: the asks a request states, each ticked only when a tool receipt of
the same family names the product the ask names. Recomputed on every turn from the episode's own messages, so it
describes what has been proved rather than what was intended. Distinct from a *note*, which is a sentence written
after a failure and read at the next attempt.

**Ask** — one thing the user wants changed, as the board reads it: a **family** (exchange, return, cancel,
modify, address, payment, transfer) plus the content words that name the object. "return the cleaner, headphone,
and smart watch" is three asks and one call, which is why the board counts objects rather than calls.

**Receipt** — a state-changing tool call that succeeded, together with the product names of the items it touched.
A call with no result, or a result carrying an error, is not a receipt: the environment did not change.

**Attribution** — the rule that decides whether a receipt settles an ask: the receipt must name the product the
ask names, by containment in either direction ("the keyboard" settles a Mechanical Keyboard). A receipt that
names no product is reported as **unattributed**, never credited to the nearest open ask. Attribution is what
separates state from a hint.

**Unattributed** — a successful change of a family the request did ask for whose object this board could not name:
the episode never read the product, or the call carried no item id (an address change). It has its own line and its
own count, apart from **unrequested**, because a reader who could not tell a limit from a mistake would read one as
the other. R214 reported both under one line; R215 splits them.

**Unrequested** — a successful change of a family the request never asked for. This is work nobody asked for — the
failure τ² charges for — and it is the one thing a transcript cannot make visible without a contract to compare
against. A *failed* call is neither: it changed no state.

**Working memory** — memory that is a function of the episode in progress rather than of a failure that ended it.
The board is the instance here; the term is the literature's (Recuris prices it at +23.9 on τ²-retail, against
+2.0 for a library of lessons).

**State channel** — the half of memory that carries what is done and what is pending, as opposed to the **lesson
channel**, which carries advice distilled from a failure. This repository measured the lesson channel for four
rounds and found no effect larger than the grid's variance; the state channel is what R214 builds.

**Census** — the offline measurement that licenses the goal-board parser: required objects found, required
families mentioned, asks no required object accounts for, tasks fully covered. It reads the text the user
simulator was given, so it is an upper bound on what the run will see; the run's own counters are what a reading
quotes.

**Seed world** — the single seed an attempt draws for every task in it. Two arms in one world are comparable; two
arms at different seeds are two draws of a process whose per-attempt rate moves further than a binomial standard
error. The drift check exists because of it (ARCHITECTURE 8.84).

**Emission cadence** — how often a served block is rewritten. The cost knob that no length measurement sees: a
block rewritten every turn invalidates the provider's prefix cache and re-bills the whole conversation at the miss
rate, while the same block written once an episode costs its own tokens once. R214 measured 23 tokens a turn at
+67% bill.

**Prefix cache hit rate** — `usage.cache.cache_hit_rate`, the share of the prompt the provider billed at the hit
rate. 90.4% against 75.1% on the same prompt is a 67% difference in the bill, which is why this lane now prices a
material by its cadence rather than by its size.

**Cache-stable emission** — writing a block only when its content changes, so the prefix in front of it survives.
The design constraint that follows from the state channel's measurement, and the reason R215 writes the board from
the write path rather than re-rendering it per turn.

**Checker** — the component that decides whether a state change happened, from a tool receipt rather than from a
transcript. The literature's word for the half of a memory system that made state worth +23.9; the half this lane
built as a renderer first, and measured at −5.3 points.

**Contract** — the asks a request states, read from the first user turn and fixed before the first call. It is what
turns a board from a renderer into a checker: the text a receipt is checked against cannot change while the
episode runs, so the block can only move when a receipt moves it. A clarification refines a clause; it does not add
one, because a parser that cannot tell which clause a "yes" refines would add a line for every sentence the
simulator says (R214: 10.6 asks an episode against the 1.58 a request states).

**Scope** — where the parser reads asks from: `request` (the first user turn, the product's reading) or
`conversation` (every user turn, R214's reading). Kept as an argument rather than a rewrite, so the difference
between the two is a subtraction over one transcript rather than an argument about one.

**Replay** — re-parsing a result document an arm already produced, to price a parser change before paying for a
dispatch. `goal_board.py --replay`. It predicts a mechanism and not a result: the live arm shows the model what the
replay only computes, and a model that sees ticks may behave differently.

**Settlement grade** — how strongly a receipt proves an ask was performed. `name` is containment (one word set
inside the other) and is the only grade R214/R215 used; `overlap` is at least one shared content word and at least
half of the shorter side, which is what 28 of R215's refusals were one word short of. Overlap settlements are counted
as `loose` so a reading can say which rule produced its ticks.

**Set ask** — one ask over several products, recognised by a quantifier ("everything", "all", "both", "each"). It
settles by family and **absorbs** the later calls of that family, because those are the same ask performed several
times rather than work nobody asked for. Only a quantified ask absorbs: a second "cancel the order" is a duplicate
and is reported as unattributed. Measured at two settlements in R215's 107 writing episodes, which is why the round
that registered it also had to find the three defects that mattered more.

**Sealed contract** — a contract fixed at the **first user turn that yields an ask** rather than at the first user
turn. A request that opens with a greeting states its asks in the next sentence, and a contract sealed on the
greeting is empty — which makes every change the episode makes *unrequested*. Sealing stops at the first productive
turn, so the growth defect R214 measured is not re-opened: one message, not twenty-five.

**Tail placement** — the block written into the conversation behind the turn it belongs to, instead of into the
system message in front of it, and left untouched when a receipt does not move it. A change then costs the messages
after the old position rather than the whole prompt, and an unchanged turn costs nothing. `--note-source board` is
tail; `board-front` is R215's placement, kept so a reading can be reproduced.

## Board and submission terms

**pass^k** — the share of tasks where **all k attempts** succeeded. Not the mean of k attempts, and not a
confidence interval: at `k = 4` a task that passed three times and failed once counts as a failure. This is why a
`pass^1` of 86% and a `pass^4` of 51% are the same system, and why the two may never share a column without their k.

**avg@4** — the mean reward over four attempts. It estimates the per-attempt success rate more precisely than a
single attempt does, so it is comparable to `pass^1` in expectation and not to `pass^4`. A row that says `avg@4` and
a row that says `pass^4` are measuring accuracy and reliability respectively.

**Three-domain mean** — the mean of an entry's `pass^1` over retail, airline and telecom. It is the number a
model-capability claim uses and it is **not a retail number**: Qwen3.5-397B's three-domain mean is 87.91 while its
retail cell is 84.43. `banking_knowledge` is excluded — different task shape, its own tab, its own retrieval
configuration — and including it turns a 84.4 entry into a 68.4 one.

**Submission type** — `standard` is a general-purpose model through the benchmark's own agent scaffold; `custom`
modifies anything on the benchmark side (prompts, tools, orchestration, user simulator, task selection, grading). A
memory harness that injects a system message is `custom` by that definition, whether or not it calls itself one, and
a custom entry must explain itself in `methodology.notes`, link its implementation in `references`, and declare
`modified_prompts`.

**Unranked** — the state of a row that cannot be placed on a metric in a domain because the artefact does not state
it. Distinct from last place and from zero: a `pass^1` at one attempt is unranked on `pass^4`, and drawing it as a
zero would report "reliably never" where the truth is "not measured". `--position` exits `1` in this state so a
script cannot mistake it for a placement.
