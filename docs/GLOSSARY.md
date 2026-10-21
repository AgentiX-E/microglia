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
