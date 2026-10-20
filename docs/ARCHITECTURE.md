# Architecture

This document explains how the eight packages fit together, why the boundaries are where they are,
and what each layer is allowed to know. It is the high-level view; the internal technical design (in
the `microglia-docs` repository) carries the normative algorithms and the evidence.

## 1. The shape in one picture

```
                    host application (owns the UI, the model, the prompt)
                                     │
        ┌────────────────────────────┼────────────────────────────┐
        │                            │                            │
   recall(text, scope)         begin(input, pack)          feedback(kind)
        │                            │                            │
        ▼                            ▼                            ▼
  ┌───────────┐               ┌────────────┐              ┌──────────────┐
  │  apply    │               │  capture   │─────────────▶│   memory     │
  │ pack+MMR  │◀──────────────│ facade +   │              │ JSONL+index  │
  │ render    │               │ run handle │              │              │
  └───────────┘               └─────┬──────┘              └──────┬───────┘
        │                           │                            │
        │                     distill()                          │
        │                           ▼                            │
        │                     ┌───────────┐                      │
        └─────────────────────│  distill  │──────────────────────┘
                              │interpreter│
                              │generalise │
                              └─────┬─────┘
                                    │ uses
                              ┌─────▼─────┐
                              │   core    │  domain model, policy, statistics, guards
                              └───────────┘
                                    ▲
                              ┌─────┴──────────┐
                              │  nl2charts     │  reference domain pack (optional)
                              │  cortex-adapter│  projection backend (optional)
                              └────────────────┘
```

Dependencies point **downward only**. `core` imports nothing. `memory` imports `core`. `distill`
imports `core`. `apply` imports `core` and the memory port. `capture` composes all of them.
`nl2charts` and `cortex-adapter` are leaves that a host opts into.

## 2. Why these boundaries

### 2.1 `core` is dependency-free

The domain model has to be usable in a browser, in a worker, and in a test with no I/O. That rules out
a schema library, a date library, and a logging library. It also means the *policy* — the numbers that
decide what reaches a prompt — is readable in one file with no indirection.

### 2.2 `memory` is behind a port

`MemoryPort` is seven methods. The embedded implementation is a JSONL journal plus an in-process
lexical index, which is the right default because a host can inspect it with `tail` and back it up
with `cp`. A host with a database implements the port and keeps everything else.

The index is rebuilt on open rather than persisted. That is a deliberate trade: replaying 10k records
costs 45 ms, and a derived index that cannot drift from its journal is worth more than 45 ms of
startup.

### 2.3 `distill` produces candidates, never mutations

An interpreter takes one feedback event and a run, and returns zero or more `DistillCandidate`
values. It cannot write to the store. Everything a candidate must survive — redaction, the injection
screen, deduplication, contradiction resolution, admission — happens in the distiller, once, for every
interpreter. That is what makes an LLM-backed interpreter safe to enable: the model's output is
untrusted input to a pipeline that already exists.

### 2.4 `apply` owns the injection boundary

The renderer is the only place that decides what a model sees. It is therefore the only place that
must be paranoid: it escapes `<`, enforces the budget exactly, reports truncation, and guarantees that
`items` and `ids` describe the rendered block rather than the *intended* one.

### 2.5 `capture` is the only stateful facade

`Microglia` holds configuration, a clock, and a random source. A `RunHandle` holds one run. Nothing
else is stateful, which is why the study can run nine arms in parallel in one process.

### 2.6 `nl2charts` is a pack, not a special case

It could have been part of `core`. Keeping it separate proves the extension point: everything
domain-specific about chart corrections — canonicalisation, the edit taxonomy, the semantic distance,
the payload shape — lives in one package that a host may ignore entirely.

## 3. The data model

Three record types, all versioned, all plain JSON:

```
FeedbackEvent  id, at, namespace, sessionId, runId, task, kind, actor, trust,
               signal{rating|edit|preference|clarification|outcome|abstain},
               provenance{knowledgeIds}, redactions

RunRecord      id, at, namespace, sessionId, task, input, output,
               provenance{model, promptVersion, appVersion, domainPack,
                          schemaDigest, knowledgeIds, retrievalHash, metadata},
               feedbackIds

KnowledgeItem  id, namespace, kind, scope{task, domain, intent, field, …},
               statement, payload, evidence[], trust, support, confidence,
               contradictions, applied, succeeded, status, statusReason,
               createdAt, updatedAt, validUntil, systemUntil
```

Two properties are load-bearing:

- **`namespace` is on every record and every query**, and retrieval filters on it before ranking.
- **`validUntil` / `systemUntil` are bitemporal**: the first is when the claim stopped being true in
  the world, the second is when the system stopped believing it. They are different questions, and a
  memory that cannot tell them apart cannot express "that rule changed last quarter".

## 4. The request path, with timings

Measured at 10k rules, 2 vCPU:

| Step | Cost | Notes |
|---|---|---|
| `recall` | 1–3 ms p95 | scope scan + BM25 + MMR + render |
| `begin` | <0.1 ms | allocates a record |
| `complete` | ~1 ms | append + fsync |
| feedback | ~1 ms | append + credit update |
| `distill` (rule interpreter) | ~1 ms per event | pure functions |
| `distill` (LLM interpreter) | ~1 s per event | one model call |

`distill` is the only expensive step, which is why it is not on the request path.

## 5. Retrieval: three stages, each with a job

1. **Candidates.** Union of the lexical postings for the query tokens and — when a scope is supplied —
   every active item the scope admits. The second half is what lets a widened rule reach a domain that
   never fed back.
2. **Score.** `0.65 × BM25 + 0.35 × confidence + 0.02 × specificity`. Confidence is the admission
   score, not a separate notion of relevance, so a rule that is barely active cannot outrank a settled
   one on lexical accident alone.
3. **Select and bound.** MMR (`λ = 0.75`) drops paraphrases in favour of distinct claims, then the
   renderer fills the character budget and reports what it dropped.

Measured contribution: at equal relevance, MMR raises the distinct claims in a four-slot pack from
**1 to 4**.

## 6. Admission: one function, visible numbers

```
confidence = sigmoid(logit(0.5) + Σ wᵢ·logit(trust) − contradictions·penalty)
           × (0.55 + 0.45·smoothedRate(succeeded, applied))
           × validityDecay(now)
```

Decision order, first match wins:

1. quarantined → stay quarantined, keep the reason
2. contradictions > budget → `conflicted`
3. applied ≥ 3 and failure rate < 0.4 → `retired` (observed-failure-rate)
4. active and confidence < 0.45 → `retired` (confidence-below-retirement)
5. confidence ≥ 0.60 and support ≥ 0.80 → `active`
6. retired → stay retired (insufficient-new-evidence)
7. otherwise → `candidate`

The order matters: a rule is never retired for low confidence while it has a good empirical record,
and never activated on confidence alone without support.

## 7. Security model

| Threat | Control | Where |
|---|---|---|
| Prompt injection in a correction | Screen at distill time; a matching claim is quarantined, not dropped | `core/guard.ts` |
| Statement escaping the prompt block | `<` escaped in every rendered field | `apply/render.ts` |
| Secret exfiltration | Email, phone, `sk-…` patterns redacted before persistence | `core/guard.ts` |
| Cross-tenant retrieval | Namespace on every record and every query | `memory/store.ts` |
| Poisoning through a weak channel | `trustCeiling` per call; below the floor → quarantine | `capture` |
| Model over-trust | Model output is a *candidate*; admission is unchanged | `distill/llm.ts` |
| Silent schema drift | Journal refuses an unknown `schema` on open | `memory/store.ts` |

The reference threat model assumes the host authenticates users. The library does not attempt to
identify people; it tries to ensure that no single untrusted channel can move a rule into a prompt.

## 8. Evaluation architecture

The study is a package, not a script:

- `scenario.ts` — the fixed corpus and the deterministic reader with six documented defects.
- `study.ts` — arms, batches, snapshots, gates, comparisons.
- `ablations.ts` — the three modules a clean corpus cannot exercise.
- `stats.ts` — paired McNemar with a bootstrap interval.
- `report.ts` — the artefact, rendered from the result object so prose cannot contain a number the
  artefact does not.

Every gate is a predicate over that object. A failing gate fails the build; there is no advisory mode
for safety gates.

## 9. What the architecture deliberately excludes

| Excluded | Reason |
|---|---|
| A server, a queue, a database | The host already has them; a library that needs them is a platform |
| A UI kit | The host owns the HITL surface; that is the whole premise |
| Model calls | The host owns the model and its keys |
| Fine-tuning, GPUs | The product's constraint: CPU or WebGPU, nothing else |
| A vector database | Scope filtering is the hard part; ANN is not the bottleneck below 100k |
| Cross-tenant aggregation | Without multi-tenancy there is nothing to aggregate, and pooling tenants is a privacy decision we do not want to make for a host |

## 10. Extension points

| You want to | Implement | Package |
|---|---|---|
| Store knowledge elsewhere | `MemoryPort` (seven methods) | your own |
| Teach a new domain | `Interpreter`, `editSemantics`, a payload type | your own, mirroring `nl2charts` |
| Use a model for free text | `LlmPort` (`complete(prompt)`) | your own client |
| Change admission behaviour | `Policy` overrides per host | `capture` |
| Project into a cognitive memory | a mapper, as `cortex-adapter` does | your own |

Nothing else is extensible, on purpose. Every additional seam is a place where the guarantee about
what reaches a prompt could be weakened.
