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

**Correction** — a structured statement of what the output should have been. Distinct from a rating
(an opinion about it) and from an outcome (a measurement of it).

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

**Power** — the sample size needed to detect an effect at a stated confidence. Stated per benchmark so
a null result is not confused with an underpowered one.

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
