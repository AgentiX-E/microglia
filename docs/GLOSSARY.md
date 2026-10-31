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

**Mechanism study** — a controlled experiment that isolates whether feedback becomes transferable
knowledge, holding the generator fixed. Not a benchmark result, and never quoted as one.

**Micro-ablation** — a targeted experiment that constructs the smallest workload in which a module
binds, because a whole-corpus arm would report zero for a module that simply never fires.

**Ceiling** — the best accuracy any selector could reach on the candidates a run actually produced,
computed from the answer key. A selector's delta is only meaningful beside the ceiling it was aiming
at: retrieving one point of a seven-point ceiling and retrieving one point of a twenty-point ceiling
are different results, and this project reports them as such.

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
a null result is not confused with an underpowered one.

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
