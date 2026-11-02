# Architecture

This document explains how the three packages fit together, why the module boundaries inside `core`
are where they are, and what each layer is allowed to know. It is the high-level view; the internal technical design (in
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
                              │  kernel   │  domain model, policy, statistics, guards
                              └─────┬─────┘
                                    ▲
                    ┌───────────────┴───────────────┐
                    │                               │
              ┌─────┴──────┐                 ┌──────┴─────┐
              │    node    │                 │  browser   │
              │ Hono, LLM  │◀── HTTP ────────│ client +   │
              │ providers  │                 │ outbox     │
              └────────────┘                 └────────────┘
```

Everything inside the dashed boundary is one package (`@agentix-e/microglia-core`) with five modules;
the two boxes below it are the only places a deployment differs.

Dependencies point **downward only**. `kernel` imports nothing. `memory` imports `kernel`. `distill`
imports `kernel` and the memory port. `apply` imports `kernel` and the port. `capture` composes all of
them. `node` and `browser` sit outside the library's dependency graph: neither is imported by `core`,
and `browser` never imports `node`.

The modules are also subpath exports (`core/memory`, `core/distill`, …), so "one package" does not
mean "one bundle": a host that only retrieves imports `core/apply` and `core/memory`, and the
distiller never enters its graph.

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
               statement, when?, payload, evidence[], trust, support, confidence,
               contradictions, applied, succeeded, status, statusReason,
               createdAt, updatedAt, validUntil, systemUntil
```

Two properties are load-bearing:

- **`namespace` is on every record and every query**, and retrieval filters on it before ranking.
- **`validUntil` / `systemUntil` are bitemporal**: the first is when the claim stopped being true in
  the world, the second is when the system stopped believing it. They are different questions, and a
  memory that cannot tell them apart cannot express "that rule changed last quarter".

**Two scope fields the host supplies rather than the model.** Both exist because a distiller reading one
event is the wrong party to fill them in. `reasonCodeOf` names *what went wrong*, which is a taxonomy the
host owns, and the model's own answer wins when it gives one. `domainOf` names *where the event happened*,
which the host already wrote into the run's input; the prompt forbids the model from guessing a domain, so
here the host's value wins and the claim is re-keyed on the finished scope. Leaving the second unset is
legal and is what every published measurement did — it also means no claim can ever widen, since widening
needs two domains to agree.

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
4. **Optionally gate.** `minCoverage` drops every candidate that mentions less than a stated share of
   the question's content words, and an empty result renders as an empty string. This exists because a
   scope match is not a topical match: on a public benchmark the pack neither helped nor hurt, and the
   rules that were injected without any lexical overlap were the ones paying rent in tokens for
   nothing.

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
| Silent schema drift | Journal refuses an unknown `schema` on open; a new digest excludes old items from injection | `memory/store.ts`, `kernel/knowledge.ts` |
| Inflated applicability | Widened scope is the meet of the endorsers'; three distinct tasks required | `distill/generalize.ts` |
| Order-dependent learning | Sorted reads, id tie-breaks, canonical evidence order | `memory/store.ts`, `capture/curate.ts` |
| Data retained past its consent | `forget()` erases by id, task or actor hash, re-derives the claims that cited them, and rewrites the journal; reachable over HTTP as `POST /v1/forget`, never queued by the browser client | `memory/store.ts`, `memory/journal.ts`, `node/app.ts` |
| Borrowed evidence | a candidate must cite the event that produced it; a mismatch is rejected and counted | `distill/distiller.ts` |
| Payload smuggling through a merge | curation groups by payload, so a paraphrase with a different rule is a contradiction, not a duplicate | `capture/curate.ts` |
| Applicability inflation | widening only counts **admitted** endorsers | `distill/generalize.ts` |

The reference threat model assumes the host authenticates users. The library does not attempt to
identify people; it tries to ensure that no single untrusted channel can move a rule into a prompt.

### 7.1 Integrity is an invariant, not a filter

Screening at the prompt boundary assumes the store is trustworthy. Five of MemForm's formation routes
never write a false record: they write *real* records at an inflated scope, with borrowed evidence, or
in an order that favours one subset. Only two of them are visible from a single write, so the remaining
three are invariants on the store:

- **evidence** — one event is one observation, whatever number of items cite it;
- **scope** — `widenedScopeOf` computes the meet, and only `domain` may be dropped, so a claim can never
  be applied more widely than every endorser asserted it;
- **selection** and **path** — curation sorts before it decides, and the merged evidence array is
  ordered by `(at, feedbackId)`, so the same log yields the same store in any arrival order.

`packages/eval/src/integrity.ts` measures the last two by replay, and ships a mutation control
(`reverseOrderView`) that bypasses the sort. The control must *disagree*: an order-invariance number
produced by a harness that cannot detect order is not evidence. This is the cheapest form of
self-falsification in the repository, and the reason the integrity lane costs nothing to run.

## 8. Evaluation architecture

The study is a package, not a script:

- `scenario.ts` — the fixed corpus and the deterministic reader with six documented defects.
- `study.ts` — arms, batches, snapshots, gates, comparisons.
- `ablations.ts` — the three modules a clean corpus cannot exercise.
- `integrity.ts` — replay, canonical state, and the mutation control.
- `memform.ts` — the five formation routes as executable attacks, scored by route and trust ceiling.
- `study.ts` — also carries `L0_CONFIG`, the frozen 1,300-case preregistration.
- erasure is measured by the same lane (POC-28b): nothing erased may be retrievable.
- `conventions.ts` — the per-domain convention corpus: a teaching and a holdout question per scope, a
  revision round for the conventions that moved, and one domain whose convention is never taught.
- `pairs.ts` — the pair-contrast arithmetic: reachable share, reachable recovery, and the verdict.
- `lanes/pairs.ts` — the L2b protocol: two arms over two teaching rounds, the citation count that decides
  whether the comparison means anything, and a cross-arm diff of the rules each store ends with.
- `mcp.ts` (in `packages/node`) — the two-tool MCP surface: JSON-RPC over HTTP, request errors as
  protocol codes, tool failures as readable results.
- `lanes/delivery.ts` — POC-19: a real HTTP receiver that verifies HMAC and de-duplicates, an
  acknowledgement lost on purpose, and a delayed response that proves the latency measurement is live.
- `l4.ts` — the τ²-bench result reader: both storage forms, and four named refusals taken from
  upstream's own rules (unscored trials leave the denominator, a short grid is refused, duplicate
  trials are an error, and a trial succeeds only on `reward == 1.0`).
- `density.ts` — the one-rule-at-a-time family: what a rule does when it is given twenty chances, the
  policies that decide whether to carry it, and the foreign arm that prices it away from home.
- `template.ts` — a rule read as a structure: slots are its identifiers the home schema has, binding
  substitutes the target schema's names, and a template whose slots do not bind is withheld rather
  than shown unbound. Pure functions over schema name sets, so the reading is recomputable from an
  artefact and costs no call.
- `link-bind.ts` — the same construction with a different referent: a table slot binds to a table the
  *question* links (`schema-link.ts`), a column slot binds only inside the table its template reached
  and only to a column of the same kind, and every refusal carries a reason (`no-table`, `table-tie`,
  `no-column`, `column-kind`) so the census reports which wall it hit rather than one number.
- `sql-exec.ts` also carries `schemaSql` and `tableShapes` — a database's own answer to "what SQL
  created these tables" and "what did you declare each column as", both cached per path, so a fold
  reads eleven schemas once instead of once per question.
- `rule-probe.ts` — the own-case probe: the four verdicts of "retry alone" against "retry with the
  rules own case produced" (`supplied`, `redundant`, `broke`, `useless`), the admission rule that
  keeps only rules that reproduced a case and broke none, and the transfer ledger that points an
  admitted rule at foreign questions. Pure functions over trials, so the verdict arithmetic is
  testable without a model, and the lane that wires it reads learning rows only. `transferLedgerOf`
  is the projection from folds to pairs, and it is a function rather than a `flatMap` in the report
  because the first version of it wrote the pairs into a record the artefact does not serialise —
  `V33-transfer-ledger` now fails a run whose file carries the summary without them.
- `probe-pair.ts` — two stores over the same corrections, asked the same question. `compareSubstrates`
  pairs the two probes on the source questions both stores covered and runs McNemar's exact test over
  the discordant pairs; `reproducedBy` is the one place a verdict becomes a boolean, and it is a
  `Record` over the verdict union so a new verdict cannot be silently absent from the count. The
  exclusive questions and the holes are counted rather than absorbed, because an intersection chosen
  by the stores reports a rate over a subset nobody designed. `poolSubstrates` adds the folds up and
  recomputes the rates from the summed cells instead of averaging per-fold rates. `SUBSTRATE_FLOOR`
  keeps a small paired set a direction.
- `sota.ts`'s `transferGates` — the four checks every transfer measurement is held to, written once
  and applied twice. The repair substrate exists only to be compared with the rule one, so a second
  substrate measured by a lighter rule would produce a number that cannot be set beside the first; the
  ids (V15/V16/V17/V33 and V39/V40/V41/V42) are arguments, which is what keeps the published ones from
  being renamed by a refactor of the shared body. The gate inputs are a translation of the artefact's
  own typed projection (`transferGateInput` over `TransferProjection`), not a second set of
  reductions — the first version of that block recomputed every total inline, and when the two were
  finally unified the gate was found to be comparing a two-decimal publication against an exact
  recomputation to 1e-9, which no run whose ratio fails to terminate could pass.
- `sota.ts`'s `ARM_STANDING` and the two gates that read it — `V43-framing-delivered` counts, per arm
  and per fold, how many of that arm's prompts carried the framing it declares, and fails when a
  declared arm misses one prompt *and* when an undeclared arm carries one; `V44-domain-accounted` fails
  a run whose store holds more domain-free items than the two instrumented sources of one. Both exist
  for the same reason: an arm that changes the prompt by one paragraph sits one paragraph away from
  being its own control, and "the sentence cost nothing" and "the sentence was never sent" are the same
  number until something counts. The standing is a table over the arm union in `sota.ts` rather than a
  parameter at the call site, so an arm's rendering can be tested without a database — the dispatch
  costs three thousand calls and the rendering costs nothing.
- `sota.ts`'s `ANCHOR_INSTRUCTION` — the three sentences an anchored arm can close with, as a table over
  the `AnchorMode` union rather than a branch at the call site. Two of them refer to items in the block
  and are therefore suppressed when the pack is empty; `hold` is addressed to the draft and renders
  anyway, which is what makes "the permission with nothing to permit" a cell rather than an absence. The
  suppression rule is the one thing here with a real failure mode behind it: an instruction that says
  "apply that item" over a prompt containing no items is not a weaker version of the arm, it is a
  different question, and the control would silently stop being a control.
- `sota.ts`'s `clearanceFromDecisive` / `doseMatchedDrop` / `V45-clearance-dose-matched` — the pair that
  makes "fewer and better" separable from "fewer". The clearance removes rules whose counterfactual
  record shows more harms than helps and keeps every rule it has no record of; the control removes the
  same count from the same pack over a seeded Fisher–Yates stream. The gate fails a run when any
  question's two arms carried a different number of items *after the character budget* — `makePack`
  admits whole items, so equal survivor counts can still render unequal packs — and again when no
  question's pack changed at all. The rule lives in `validation.ts` beside its sibling rather than in the
  lane, and the two are tested against each other on the only input where they disagree.
- `sota.ts`'s `renderRawPack` / `rawEventVerbatim` / `V46-raw-is-verbatim` — the raw substrate. One
  correction renders as three labelled lines whose payloads are the event's own strings, whole events
  only (the budget skips rather than truncates, because half an event is a question with no correction),
  and the gate fails the run if a single rendered block is not byte-identical to the event it came from,
  or if the arm rendered no payload at all. The verbatim check is a function over the rendered text rather
  than a promise in a comment: a formatter that tidied a query would make the arm an interpreter under a
  new name, and the arm's entire claim is that nothing was interpreted.
  - **The unit is the block, and that cost a dispatch to learn.** The first version split the payload on
    newlines and matched each line against a field, which cannot represent a value that is itself
    multi-line — and the `Attempt:` field is SQL, so a verbatim multi-line query read as a rewritten one:
    R22's first run reported 1103/1632, which is exactly the 1088 question and correction lines plus the
    15 single-line attempts. `rawEventVerbatim` now walks the payload and requires each position to start
    with a whole block it was given, counting a rejected span once however many lines it holds, and
    returning its first line as a sample the gate prints and never interprets.
- `sota.ts`'s `EVIDENCE_LABEL` / `evidenceBlockOf` / `V47-evidence-ablated` — the ablation of the
  benchmark's own knowledge, which is the one thing in the prompt this project did not write. `none` has
  always carried BIRD's per-question `evidence` sentence; `none-noevidence` and `full-noevidence` render
  `evidenceBlockOf('')` instead and change nothing else. The label lives in one constant because the gate
  searches the *sent prompt* for it: `V47` counts, per arm and over the questions that had a sentence,
  how many prompts contained `EVIDENCE_LABEL + "\n" + the row's evidence`, and fails the run if a shipped
  arm missed one, if an ablated arm carried one anyway (an ablation that removed nothing is `none` under
  a second name), or if the ablated arm reached fewer questions than the arm it ablates.
- `stats.ts` — paired McNemar with a bootstrap interval.
- `report.ts` — the artefact, rendered from the result object so prose cannot contain a number the
  artefact does not.

Every gate is a predicate over that object. A failing gate fails the build; there is no advisory mode
for safety gates.

### 8.1 The protocol layer

The evaluation package used to be readable only from inside: a generator, its prompt and its scoring
lived in one binary, so the only way to measure another system was to port it. Four modules separate
the measurement from the thing measured:

| Module | Holds | Why it is separate |
|---|---|---|
| `plugin.ts` | the candidate contract: one request type, one reply, a loader that refuses a module inside this package | a generator somebody else wrote has to run without editing our code, and provenance is checkable rather than asserted |
| `artifact-schema.ts` | the run artefact's types, a hand-written validator that checks the arithmetic, and the report renderer | a schema no code reads is documentation; a report written beside the JSON is a second source of truth |
| `prereg.ts` | the pre-registration format, its gate, and the agreement between the gate list it names and the one its run emitted | a prediction has to exist before the run and has to be refutable, or the number is a description |
| `reproduction.ts` | published cells, the Wilson interval, and the admissibility rule | a comparison across splits is sampling error, and arithmetic is cheaper than trust |
| `@agentix-e/microglia-protocol` — the 39 gates | partition, injection proof, resolution, call reliability, dose, admission, channel application, statement survival, transfer reconciliation | these read a run's shape, never its subject; a gate that reads a scenario type is not a gate, it is a check inside that scenario |

**The gate layer is where the protocol claim is load-bearing, and it was the last to be separated.** Thirty-one
gates certify every number this project publishes, and for twenty-six iterations they had exactly one caller. The
second scenario in this repository — τ²-bench — wrote three of its own instead, one of which failed at a 15pp
half-width against a 5pp bar and was recorded as a note rather than as a verdict. **A protocol with one customer is
a habit**, and the repair is a package boundary rather than more prose.

The boundary was cut on one rule — *does the gate's signature mention a scenario type?* — and the rule answered
the wrong question. Of the 39 gates, **37 take no scenario type at all** and the 2 that do (`gold-executable`,
`convention-executable`) read an *optional* field and are absent rather than green when a lane cannot supply it.
But a signature being scenario-free does not make a gate **evaluable**: `V45-clearance-dose-matched` names no
scenario type and cannot fire for a lane that ran no clearance arm. **A gate is as portable as the arm behind
it.** When the second scenario was finally measured by the gates, nine of the 39 could fire, two of the nine
passed with an empty arm behind them, and thirty needed an experiment τ² had never run. Portability is indexical,
and the index is now a table in `packages/eval/src/tau2-gates.ts` rather than a paragraph in a design note.

What the same run *did* establish is the claim the boundary existed for: the **apparatus** is scenario-agnostic.
τ² is scored by the same `buildProtocolGates`, the same publication order and the same artefact schema with no
edit to a gate. The one type change the second scenario forced was the opposite of an adaptation — eight fields
that had been mandatory became optional, because two of them (`meanPackIds`, the call tally) are knowable only to
a lane whose model runs in this process. A lane that could not state them could not call the function at all, so
a scenario able to prove four gates proved none — the loss was a **type-level requirement, not a missing
measurement**, and the two have different fixes.

**Stage 1 of R29 is the fix for the first half.** The driver now exports `instrument()`, which returns the arm
record the protocol reads: the mean items the recall facade served, the call tally, the learning bookkeeping and
the domain ledger, all counted at the points where they actually happen. Four decisions in
`packages/eval/src/tau2-instrument.ts` are worth knowing when you read a τ² artefact, because each of them is a
way an instrument gate can lie:

| the temptation | why it is refused |
|---|---|
| an empty pack set is "not applicable" | it is V1's failure case; `undefined` would turn "injected nothing" into "not asked" |
| no calls is a 0% failure rate | `0/0` reported as `0` is the strongest reliability claim on no evidence, so the field is omitted |
| an unobservable distillation count is `0` | `0` is a perfect V32 on a quantity nobody measured; the record is omitted instead |
| de-duplicate the held-out list before the gate sees it | V2 asks whether every question was asked once; a record that tidies its own input answers its own question |

The lane does not grade the protocol's gates itself: `l4` writes the record into the artefact and `l4-pair`
grades the pair through `tau2GateAudit`, because most of those gates read two arms and one arm cannot answer
them. That keeps the direction of the comparison honest — a single artefact can supply a reading, but only a
pair can supply a verdict.

```ts
export interface LaneAdapter<Task, Candidate> {
  load(): Promise<readonly Task[]>;                              // the task order the folds assume
  prompt(task: Task, pack: Pack): string;                        // rendering belongs to the adapter
  parse(raw: string): Candidate | undefined;                     // unreadable is a value, not a throw
  score(task: Task, candidate: Candidate): Promise<boolean>;     // only the lane can execute or judge
  strata(task: Task): readonly string[];                         // outcome-blind by signature
}
```

**The `strata` signature is the one that encodes a rule rather than describing it.** Conditioning a stratum on an
arm's outcome and then contrasting inside that stratum measures regression to the mean; the function receives a
task and nothing else, so there is no outcome to condition on. A rule enforced by a signature survives an urgent
patch; a rule written in a comment does not.


The runner (`bin/plugin-run.ts`) owns the I/O — it builds SQLite databases from a self-contained case
file, executes gold and answers, and writes the artefact — so nothing above needs a filesystem or a
model. `bin/protocol.ts` is the CI gate: it re-validates every committed artefact, re-renders its
report and compares byte for byte, re-derives every cell comparison, and refuses a pre-registration
that is not one. It runs offline in about a second.

The gate has a fourth claim since R16: **a pre-registration's gate list is the gate list its run
emitted.** `preregGateAgreement` compares the header's `gates` against the artefact's `gates[].id`
in both directions, and `bin/protocol.ts` applies it to every committed artefact that names a file in
`config.prereg`. Neither side can check the other: a dispatch holds the artefact and not the header,
`eval:prereg` holds the header and not the artefact, and R16 shipped a header copied from R15 that
named seven transfer gates a dose arm set could never emit. Both halves are files in this repository,
so the pairing is checked offline for every run rather than argued about afterwards.

### 8.2 The call client is part of the measurement

Every number in `eval/` is produced through `model-client.ts`, so its retry policy is not plumbing —
it decides whether a run measures the mechanism or the network. Three rules, each learned from a
dispatch:

| Rule | What it replaced | What it prevents |
|---|---|---|
| the attempt timeout is a function of `max_tokens` | a constant 60s | killing a 2,000-token distillation reply that was about to arrive, four times over, and recording it as a prompt the model could not answer |
| a timeout is retried once, a 429 or 5xx four times | four attempts for everything | spending the wall clock re-asking a question whose answer is "this is slow", while still giving a throttled provider the patience it asked for |
| a deadline, checked before every attempt | the runner's step timeout | a killed process taking three finished folds with it |

The failures stay named: `MG_E_CONFIG` for a refused payment, `MG_E_BUDGET_EXCEEDED` for a spent
call budget, `MG_E_DEADLINE` for an elapsed clock, `MG_E_PROVIDER_FAILED` for an endpoint that has
stopped answering, `MG_E_STORE_IO` for one prompt that failed after its retries. A caller that keeps
going through the first four measures an outage; only the last is data.

`timeouts` sits beside `retries` in the artefact because the two diagnose opposite faults: many
retries and no timeouts is a provider throttling you, many timeouts and no retries is a client asking
for more than it is willing to wait for.

### 8.3 Every published delta carries its resolution

A delta without the smallest effect its sample could have seen is a sentence with the second half
missing. The two widths are easy to confuse and they differ by a constant 43%: the **half-width**
`1.96 · sqrt(b+c)/n` is a 95% interval, and the **resolution** `2.802 · sqrt(b + c)/n` is the smallest
true effect the design detects four times in five. `pnpm eval:power` prints both for every committed
artefact and puts them on one page:

```text
[power] poc-sota-bird-dev.json          n= 1534  47+/68-  delta=  -1.37pp ± 1.37  mde=  1.96pp  underpowered
[power] poc-sota-bird-transfer.json     n=  350   8+/24-  delta=  -4.57pp ± 3.17  mde=  4.53pp  RESOLVABLE
[power] 1 of 17 published deltas exceed their own minimum detectable difference (5.9%); 5 exceed
        their own 95% half-width
```

Read the third line as the point of the table: **a record in which one comparison out of seventeen
clears its own bar is a record that was measuring noise, not a record that found nothing.** The
comparison with a published cell is a different shape and is not in this table, because two
independent samples cannot be paired: our no-memory cell at 57.63% against a published 53.52% on the
same split is 2.30 unpaired standard errors, which clears its 95% bar (3.51pp) and not its 80% bar
(5.02pp). The arm that carries a memory pack is 56.26% on that same run, so the pack costs 1.37pp of
execution accuracy against a resolution of 1.96pp — **the gap to the published baseline is the
harness, and the feature is inside its own noise.** Both sentences are needed: the first is what this
project can defend, the second is what it must not claim.

`packages/eval/src/power.ts` is the only place either width is computed. A second formula would be a
second answer to a question this project has already answered once, which is exactly how the 95%
half-width and the 80%-power resolution came to be quoted interchangeably in the first place.

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
| Project into a cognitive memory | `CortexProjection` in `@agentix-e/microglia-node` | your own |
| **Measure your own scenario** | `LaneAdapter` (load / prompt / parse / score / strata) | your own, beside the lane |

**The last row is the only extension point that is about the *evidence* rather than the product**, and it exists
because a claim of generality is only checkable from outside. A host that implements `LaneAdapter` gets the
protocol's gates that its own arms can support — named in the report, with the rest listed beside them and the
arm each would need — plus the paired statistics, the artefact validator and the pre-registration check, without
writing any of them. The dependency direction is enforced: `core ← protocol ← adapter`, and `protocol` may not
import an adapter.


Nothing else is extensible, on purpose. Every additional seam is a place where the guarantee about
what reaches a prompt could be weakened.

## 11. What is in this repository, and what is not

This repository is **the product and the evidence that gates it**:

| Here | Why |
|---|---|
| `packages/` | the library (`core`, `node`, `browser`) and the instrument that gates it (`eval`, `protocol`) |
| `packages/eval/src/bin/` | executable lanes that measure the library — replay invariants, the attack harness, L0/L2b/L4, the live model probes |
| `bench/` | the ablation study and its gate report |
| `scripts/` | the quality audit, the bundle-size gate and the conformance check |
| `.github/workflows/` | the gates: `ci`, `sota`, `poc-live`, `cortex` |
| `docs/` | the user guide, this architecture, the glossary |

The rule that decides a borderline file is **what it tests, not what it says**: if running it
tells you something about *this library*, it belongs here, even when the thing it measures is an
external build or a third-party package. `scripts/cortex-conformance.mjs` is the clearest case — it
projects a knowledge item through the adapter and compares the result against what cortex's own factory
produces — and it stays because that comparison is the only evidence that the structural copy of
`MemoryValue` is still accurate.

What is deliberately absent: the whitepaper, the technical design, the roadmap, the audit and the
progress log. Those describe the *project* rather than the library, they are written for an audience
that is not a host developer, and they live in `microglia-docs`. `pnpm audit:repo` fails the build if
one of them drifts back.

### 8.4 What a rule did to the query, and why the corpus already holds it

Every committed benchmark case carries two statements the same model wrote for the same question — one with
the memory pack in the prompt and one without. The difference between those two strings is the pack's entire
footprint, and until R30 nothing read it. `packages/eval/src/sql-diff.ts` tokenises both, extracts their shape
(tables, columns, literals, select-list width, clause words, aggregates, nesting) and reports the diff; the
same module decides whether a name in the memory query is **grounded** — present in the question or the
evidence — or imported from a rule the question never asked about.

```text
[query-diff] 1534 cases: 692 unchanged, 73 reworded, 769 edited
[query-diff] imported-name n= 155  10+/ 25-  delta=  -9.68pp ± 7.48
[query-diff] F1 n= 155 delta=  -9.68pp vs    1.45pp gap= -11.13pp ± 7.61 p=0.0015 RESOLVES
```

Two properties make it a measurement rather than a story, and both are structural rather than promised: the
classifier's input type has four string fields — the two queries, the question and the evidence — so it cannot
reach the outcome it is later joined to, and it makes no model call, opens no database and records no clock, so
the workflow recomputes the artefact byte for byte. `query-diff.ts` joins the deltas to the scored outcomes and
reports each split with its own half-width, its database-clustered interval, an exact test and a Bonferroni
threshold; `gateReadingOf` prices the read-time filter that the split would license, without installing it.

The mechanism it isolates is narrow and worth stating plainly, because it is the reason the pack costs points:
**a query that imports a schema name the question never mentioned destroys an already-correct answer about seven
times as often as it helps one.** 35.71% of already-correct queries in that group were broken, against 4.56% in
the rest of the corpus, and the repair rate was flat. The whole accounting, and the two reasons the filter is
measured rather than shipped, are in `README.md` §"On a public benchmark, the prefix form is worth less than
nothing" and in the docs repository's `PROGRESS.md` §140.

### 8.5 Where the imported name came from, and why the answer moved the claim

An imported name came from somewhere, and the corpus already knows which: the lane stores the rendered text of
every rule that reached the prompt, so a name is either in that text or it is not. `packages/eval/src/corpus.ts`
is the one join from a committed artefact to the readings — it resolves the pack's text (`injected` first, the
store second, and it says which), and `pack-mediation.ts` sorts each importing question into one of three
buckets.

```text
[mediation] 1534 cases, 155 importing an ungrounded name
[mediation] pack         n=  60 (38.7%)   3+/  8- delta=  -8.33pp destroyed= 36.36% base=36.7%
[mediation] schema       n=  94 (60.6%)   7+/ 16- delta=  -9.57pp destroyed= 34.04% base=50.0%
[mediation] unverifiable n=   1 (0.6%)   0+/  1- delta=-100.00pp destroyed=100.00% base=100.0%
```

The third bucket is not *invented*: a statement that failed to execute may have named a real column and failed
on something else, and collapsing it into "the model made a name up" would attribute a cause the record does
not carry. The bucket that matters is the second one, and it is 60% of the damage: the pack said nothing like
the name, the query ran, and the model took a real column out of the DDL. **The pack's damage is a trajectory
change, not a dictation of names**, which is why a filter on rules cannot reach most of it — and why the filter
that can is the read-time check on the query.

`gate-stability.ts` then asks how much of the filter's estimate is an artefact of the corpus: one database
removed at a time, a permutation null of random discards of the same size, and a balanced split by database.
All three pass (leave-one-out +0.77 to +1.25pp, p = 0.0002, halves +0.76 and +1.22pp), which is a statement
about stability across sub-samples and not about a new sample — both halves were in the corpus the hypothesis
came from, and the artefact says so rather than leaving a reader to assume it.

### 8.6 A split is a manifest, and the third one rewrote five assumptions

The lane can measure three BIRD question sets. Adding the third looked like a constant and turned out to be
five assumptions, each of them invisible because the first two splits happened to satisfy it.

```text
         eval/manifests/bird-<split>.json
                    │
     ┌──────────────┼───────────────┬────────────────┐
     │              │               │                │
  url + digest   questions      nested archive   databases
     │              │               │                │
  download       parse          extract          selection
  (streamed)     (3 shapes)     (pair or none)   (what is scored)
     │              │               │                │
     └──────────────┴───────────────┴────────────────┘
                    │
              poolOf(rows, split)      ← the split's own scoring rule
                    │
              withinDatabases(...)      ← what the manifest selects
                    │
              requirePopulated(...)     ← refuse a schema-only database
                    │
                   stop  ← everything above runs in `pnpm eval:split-precheck`
```

**The five assumptions, and where each one now lives.**

| assumption | how it was hidden | where it lives now |
|---|---|---|
| the archive has a nested database zip called `dev_databases.zip` | true of `dev`, absent from `minidev`, and the extractor's `existsSync` guard made the absence look like a design | `manifest.nested` + `nestedRoot`, read as a pair or not at all |
| a question has a `difficulty` | true of `dev` and `minidev`; `train.json` has no such field on any of 9,428 rows | `isSimple(difficulty: unknown)`, whose answer for a non-string is **no** |
| the archive is small enough to buffer | 346 MB is a large allocation and a survivable one | a stream to a `.part` file, then a rename |
| databases live under one of three roots | all three roots were `dev`/`minidev` layouts | `resolveDatabase(dir, id, roots)`, with the root read from the manifest |
| an artefact name is a two-way choice | there were two splits | `ARTEFACT_IDS: Record<Split, string>`, so a fourth split cannot compile without a name |

**The precheck is the part worth reusing.** It runs everything above and stops before the first model call,
which makes "can this split be measured" a question with an answer that costs nothing. Its output on the real
archive:

```text
[precheck] train: 9428 questions, 7829 selected over 58 databases — ready
[precheck] dev: 1534 questions, 1534 selected over 11 databases — ready
[precheck] minidev: 500 questions, 350 selected over 11 databases — ready
```

The 350 is the check on the checker: it is the number every transfer experiment in this repository calls that
slice, and it was reproduced from the file by the pool rule rather than supplied.

**Why the unit tests could not have found any of it.** Every test loads a fixture, and every fixture was
written against the split the code was written against. A field that exists in `dev.json` and not in
`train.json` is invisible to a suite whose corpus has the field — 2,353 tests and four coverage dimensions
above 99.6% do not help, because the thing that is wrong is the data. The only way to find this class of defect
is to run the loader against a second dataset and stop before the expensive part.

### 8.7 The out-of-sample verdict is an artefact, and it recomputes without a model call

R30 stage 2 cost 14,479 calls once. Everything that can be said about it afterwards is arithmetic over
`per_case`, so the verdict is a committed artefact recomputed on every push rather than a paragraph
somebody remembers writing.

```text
  poc-sota-bird-dev-R26-channels.json ──┐
  poc-sota-bird-train.json ─────────────┤
                                        ▼
                            diffCasesOf(run)        ← one join point, both corpora
                                        │
        ┌───────────────┬───────────────┼───────────────┬───────────────┬─────────────────┐
        ▼               ▼               ▼               ▼               ▼                 ▼
  clusteredDeltaOf  foldSignTestOf  gateReadingOf  featureOf(F1)  memoryDiscordance  adjudicate
   (databases)      (5 folds,       (the filter)   (imported      Of (repairs        OutOfSample
                     exact binomial)               name)          against breaks)    (P1–P5)
        └───────────────┴───────────────┼───────────────┴───────────────┴─────────────────┘
                                        ▼
                              poc-out-of-sample.json   ← 36 assertions in CI
```

**Four design decisions in that pipeline are load-bearing.**

*The registration is data.* `OUT_OF_SAMPLE_PREDICTIONS` holds P1–P5 as predicates over a reading, with
the sentence each one was registered as. A prediction cannot be re-read once its number is in: the
predicate decides, and the sentence that goes into the documentation is the one that was registered.

*A corpus describes itself.* `splitOfName` reads the artefact's own `dataset` field, and
`stabilityFramingOf` builds every corpus-dependent clause from the numbers it was given. Before this,
the stability reading's title quoted dev's `+1.30pp` while the file was pointed at train, and its
`unmeasured` block asserted that no split of this corpus could be out of sample — about the one corpus
for which that is false. Prose in an artefact is not covered by tests, so it has to be generated.

*The unit of resampling matches the unit of the claim.* Questions inside a database are not
independent; a rule reaches all of them. `clusteredDeltaOf` resamples databases and returns `null`
rather than a point estimate when the corpus has fewer than two, because one cluster resampled is the
same cluster and every effect would "resolve".

*The delta is not the whole reading.* One number invites "memory is bad", and the corpus can be split by
what memory did instead of by what it was worth. `memoryDiscordanceOf` does that split and then asks the
filter what it can see of each half. Out of sample the pack repairs 187 of 2,925 wrong answers and breaks
237 of 4,075 right ones — 0.79 repairs per break — while the two *rates* (6.39% and 5.82%) point the other
way, because the bases are not the same size: more questions are right without memory than wrong, so a
break rate buys more breaks than the same repair rate buys repairs. That is a base effect, and it is why
the arm can flip sign while both mechanisms stay put. A filter that could see every break would be worth
3.39pp; this one discards 548 questions, catches a third of the breaks, gives up a fifth of the repairs and
realises 15.2% of that ceiling. `realisedPp` is `gate.improvementPp` computed from the confusion matrix
instead of by re-reading the corpus, and the test that holds them equal is the test that the two accounts
of the filter are one account.

**What the pipeline cannot do** is as much a part of it. It compares no accuracy across splits — dev
and train share no database, so only the paired differences are the same quantity — and it does not
re-adjudicate a refuted prediction. P2 predicted the arm would be non-positive *and* not significantly
different from the control. Out of sample it is −0.71pp with an interval that excludes zero, so P2 is
reported as refuted, in the artefact, on every push, in the same table as the four that held.

### 8.8 The filter is differential, and stage 0 is the corpus read a third way

The read-time filter's public definition is one sentence — *discard a statement that imports a name the
request never implied* — and every reading of it through §8.7 compared two statements: the served query
and the bare one. That leaves a question the definition cannot answer on its own and a deployment has to
answer: does the *query* carry the signal, or only the *difference*?

R33 stage 0 answers it from the same two artefacts, because `per_case` stores both queries. The rule is
not re-implemented — `diffQueries('', sql, …)` is the same tokeniser and the same two grounding modes
with an empty baseline — so the only thing that differs from §8.7's covariate is the anchor.

```text
  per_case.baselineSql ─┐
  per_case.predictedSql ┤→ diffQueries('', sql, question, evidence) → ungrounded{,-Loose}
  per_case.question     ┤        │                                        │
  per_case.evidence     ┘        │                                        ▼
                                 │                     flagged / clean, and the outcome of each
                                 │                                        │
                                 ▼                                        ▼
                        the same rule, both arms      validityReadingOf: accuracy per group, clustered
                        of both splits               gap over databases, Fisher, sensitivity,
                                                     specificity, Youden's J
```

**Four decisions, and each one is a way the reading could have lied.**

*An empty baseline is the experiment.* Reporting the flag rate of the served query with the anchor still
in place would have reproduced §8.7 and measured nothing new. What the empty anchor buys is the one number
that decides the product: the rule fires on **94.8%** of bare attempts, because a correct query names
tables and columns no question spells out. A check that flags almost everything is not a check.

*The gap and Youden are different claims, and only one of them survives.* The flagged group is 12.58pp
less accurate on a clustered interval that excludes zero — that part of the signal is real. But 94.8% of
the corpus is in that group, and the 5.2% left out are the questions whose tables appear in their own text.
That is a difficulty proxy, not a validity proxy, and Youden's index — `sensitivity + specificity − 1` —
is the statistic that ignores the base rate. It reads **0.0257** here against **0.1068** for the anchored
filter. A reading that reported the gap alone would have called the question-only check a success.

*Both rules, before either number.* The registration named the strict rule as primary and required the
morphological one beside it, because a rule chosen after seeing both is not a rule. Loosening it to accept
inflected identifiers cuts the flag rate to 75.8% and lifts J to 0.0700 — still under the bar. That
column is what forecloses the obvious next move ("fix the tokeniser") without spending a round on it.

*A saturated flag rate hides what a conditional one shows.* P6 asked whether the pack imports a name
more often than the bare query, and on this corpus that question has no room to answer: 94.8% of bare
attempts are already flagged. Asked on the questions the bare rule *passes*, it does answer — of 1,693
clean questions the pack's query imports a name on 99 (**5.8%**), against 24 of 395 on dev (**6.1%**).
That is §8.7's imported-name finding reproduced under a second rule, and it is the one positive result
this stage produced: the phenomenon is real, and the standalone check is not.

*A case with no query is excluded, and counted.* Ten of the 7,000 train rows carry no `baselineSql` at
all. The predicate is undefined on the empty string, and treating those rows as unflagged would put ten
known failures into the clean group and pull the gap toward zero. `excluded` travels with every reading;
`prereg/R33.md` Amendment 1 records both treatments and what the choice costs, including that it is the
difference between P3 holding and P3 failing.

**What the stage concluded.** Shape 1 of R33 — ship the check alone — is refuted as specified, and the
reason is structural rather than a tuning shortfall: the filter measures a *difference*, so any deployment
that wants it has to generate twice and compare. Combined with §8.7's ceiling of 3.39pp and its realised
15.2%, that closes the product question. The lane stays in CI because the negative is now a number: a
tokeniser change that moved the flag rate or J would have to argue with a workflow that asserts eighteen
of them.

### 8.9 Admission, not dose: the bar is the bare odds, and the population is the variable

§8.7 measured the exchange rate — repairs over breaks — as a property of what the pack *says*, and §8.8
closed the last product shape that assumed a better item was the way back. Both compared that rate to
parity. It is not measured against parity, and the correction is arithmetic rather than empirical.

**A repair can only happen on a question the bare model got wrong, and a break only on one it got right.**
Out of sample the corpus has 2,925 of the first kind and 4,075 of the second, so a memory that repairs as
often as it breaks still loses: equal *rates* on unequal *bases* is a net cost. The rate at which memory
breaks even is the bare odds of being right:

| quantity | value | derivation |
|---|---|---|
| repairs | 187 = 6.39% of 2,925 | §8.7 |
| breaks | 237 = 5.82% of 4,075 | §8.7 |
| exchange rate | 0.789 | 187 / 237 |
| **break-even exchange rate** | **1.393** | 4,075 / 2,925 |
| repairs needed at fixed breaks | 8.10% (+1.71pp) | 5.816% × 1.393 |
| breaks needed at fixed repairs | 4.59% (−1.23pp) | 6.393% / 1.393 |

Memory is not 21% short of useful. It is **43% short**, and every sentence the project wrote about "close
to a wash" was measuring against the wrong zero.

**The asymmetry is in the population, and that makes admission a separate mechanism from dose.** A
question the bare model already answered cannot be repaired and a question it got wrong cannot be broken,
so a gate that admits memory only to the second kind has a break rate of zero *by construction* and
receives the whole repair rate as net gain — **+2.67pp**, the largest number this programme has had in
front of it. That is a different intervention from the read-time filter, which removes breaks after
generation and is capped at 3.39pp; the two ceilings are the two halves of a 6.06pp oracle.

```text
  question ──► gate (question + this database's history) ──► admits? ──► memory ──► answer
                  │                                              │
                  │ no                                           │ yes
                  ▼                                              ▼
              bare answer                            breaks impossible by construction
```

**Four decisions, and each one is a way the reading could have lied.**

*Precision, not accuracy, is the quantity a gate is scored on.* The admissible bar is
`q > b / (r + b)` — 47.64% against a 41.79% base rate. A gate does not have to be accurate, calibrated or
even good; it has to be six points better than random. That is a much lower bar than the filter's Youden,
and it is why the reading was worth running at all.

*Split by database, not by question.* A gate that admits one question in a schema and not its neighbour
is not a deployment anyone can run, and §8.6's clustering argument means a question-level split would put
the same correlation on both sides of the wall. 58 databases deal 29/29, and no database appears twice.

*The gate score is a property of the whole corpus.* The neighbour set in the self-knowledge score stays
whole; only the questions being judged are split. A leave-one-out estimate recomputed inside each half
would answer a different question on each side and the confirmation number would confirm a rule that was
never selected.

*The control is a recorded arm, not an assumption.* Random admission at six shares has to scale with
coverage, or the estimator is at fault and every other number in the artefact is void.

**What the reading found, and the part that was not predicted.** The self-knowledge gate — SKR's kNN
signal in lexical form, the share of a question's ten nearest neighbours in the same database that the
bare model got wrong — reaches **62.4% precision** where the bar was 47.64%, and returns **−0.05pp**.
The arithmetic was not wrong. It was about the wrong population: **the precision bar is a property of the
admitted set, not of the corpus**, and selection moves it.

| gate threshold | coverage | precision | bar inside the set | repair rate inside | break rate inside |
|---|---|---|---|---|---|
| 0.10 | 94.5% | 41.8% | 46.5% | 6.32% | 5.50% |
| 0.30 | 64.5% | 50.8% | 52.3% | 6.23% | 6.84% |
| 0.50 | 35.6% | 62.4% | 63.3% | 5.61% | **9.68%** |

Precision climbs 20.6pp across the sweep and the bar climbs 16.8pp with it, because the break rate inside
the admitted set nearly doubles while the repair rate does not move. A question whose neighbours failed
is not a question the pack can repair; it is a question the model is **unstable** on, and an unstable
answer is one the pack breaks as easily as it fixes. The gate is selecting variance, and variance is
symmetric — the same property that makes memory a wash without a gate.

**What it closes.** Thirty registered points across five gates reach **+0.11pp** of the 2.67pp ceiling out
of sample — 4.0%, on an interval that covers zero. §8.7's filter realised 15.2% of its own ceiling and
still did not pay, so the removal route was four times as efficient and also failed. The public product
consequence is unchanged — nothing ships — but the reason is now three-layered rather than one: the item's
content does not matter (§8.5), its quantity does not matter (§8.6), and the population cannot be selected
by anything measurable before generation.

### 8.10 The ledger: a rule has a record, and the record is not a property of the rule

§8.9 closed the population. What was left was the store itself, and it has one operational form: **prune**
the rules that break and keep the ones that repair. Pruning presupposes that a rule's net effect travels
from the questions it was measured on to the questions it will be shown on, and that presupposition had
never been tested. It is false, and the way it is false is worth the section.

**The unit had to be fixed before the question could be asked.** Attribution is not exclusive: a pack
holds two rules, and a flip is credited to both. 7,000 questions therefore produce **13,578 injections**,
349 of them on a repaired question and 462 on a broken one — counts that do not add to the 424 flips
because each flip is named twice. Every number below is per injection.

**Heterogeneity is real, and the null is the whole design.** A binomial null would compare each rule's
rate to the corpus rate and find differences every time, because two rules in the same pack move together.
The null used here permutes *outcomes across questions* — every rule keeps exactly the questions it was
shown on and only what happened on them moves — so what survives is association that the pack structure
cannot explain. It survives: χ² **293.3** against a null mean of **209.6** and a 99th percentile of
**280.4**, p = **0.0047**.

**And it does not replicate.** Databases are dealt 29/29 by a stable hash and each rule's net rate is
measured twice, on questions the other measurement never saw:

| | value |
|---|---|
| rules compared (≥ 5 showings in each half) | 135 |
| correlation of the two measurements | **−0.134** [−0.296, +0.036] |
| sign agreement, over the 53 rules that moved twice | **49.1%** |
| Spearman–Brown, full length | **−0.309** |

A negative reliability is not "no signal"; it is a signal whose second measurement would be better
inverted. So the store's heterogeneity is an **interaction between a rule and a database** — 203 rules
against 58 schemas, 11,774 cells over 424 flips — and not a per-item quantity anyone can rank.

**The actionable form fails flatly.** A coarse flag is the version of the ledger a deployment could
actually use: negative net over at least ten showings. It flags 58 rules covering 2,545 of the 3,770
confirmation questions, and those returned **−0.55pp** against **−0.49pp** for the questions carrying no
flagged rule — a difference of −0.06pp on [−1.97, +1.56]. The flag is not a noisier version of the ledger;
it is no signal.

**One structural variable does move, and it is not the content.** Pack size is assigned by retrieval —
a question gets one rule when only one clears the threshold — and the two populations are not the same
questions:

| pack | questions | repair | break | net |
|---|---|---|---|---|
| one rule | 423 | 12.50% (25/200) | 5.38% (12/223) | **+3.07pp** |
| two rules | 6,576 | 5.94% (162/2,725) | 5.84% (225/3,851) | −0.96pp |

**+4.03pp [+0.76, +6.62]** on a database-clustered interval. On four other artefacts of at least 1,534
questions the same contrast runs +4.14, +3.13, +0.62 and +0.36; on all twelve 350-question pilots it is
negative, three of them with intervals excluding zero. The sign tracks the corpus, which is what a
sample-size explanation predicts and what a mechanism explanation would have to argue against — and §8.11
is the arm that assigns pack size instead of observing it. The answer is that the contrast does not
survive assignment.

```text
  what was tested            what it showed                    what it licenses
  ─────────────────────      ────────────────────────────      ────────────────────────
  dispersion vs null         rules differ (p = 0.0047)         nothing
  split-half replication     r = −0.13, sign 49.1%             nothing: a prune is a coin
  coarse prune flag          −0.06pp [−1.97, +1.56]            nothing
  pack size (observed)       +4.03pp [+0.76, +6.62]            one arm (R36)
```

**What it changes about the product statement.** The four earlier negatives were about *the same pack used
differently*. This one is about the items themselves, and it is the strongest form the negative has taken:
**a rule has no per-item value that transfers, so a store cannot be improved by editing its items one at a
time.** Only two levers are left, and both are designs rather than edits — the grain at which memory is
written, and the number of items a prompt carries.

### 8.11 The pack is not additive, so the item count is not a knob

R35's one positive number was a property of the questions, and the arm that says so had already been paid
for. R25 carried `full-one` as a *dose* control: the same retrieval, the same order, the first item and no
second one, built from the pack `full` carries so that the two prompts differ in one field. Re-read as an
assignment test on the same 1,534 questions it reads **−0.33pp [−1.65, +1.25]** clustered by database, 42
gained against 47 lost, p = 0.67.

**Why the observation reversed.** The +3.13pp came from questions retrieval happened to serve a single
rule, and those questions are not the same questions:

| | questions | repaired (of repairable) | broken (of breakable) |
|---|---|---|---|
| packs of one | 401 | 18 of 189 (9.5%) | **9 of 212 (4.2%)** |
| packs of two | 1,133 | 42 of 468 (9.0%) | **52 of 665 (7.8%)** |

The repair rates are the same to half a point; the break rate is nearly halved. Singleton questions are
questions where the store had one relevant thing to say, and a store that says one thing breaks less.
Giving every question a single rule hands back that break rate — and hands back the repairs with it.

**The number nobody had: what the second item is worth.** The two arms differ by one rule, so the contrast
decomposes into four cells, and the four do not look like a subtraction.

```text
  the question was …            pair right   pair wrong
    bare model wrong (repairable)      23           15     ← the second item repairs 23, prevents 15
    bare model right (breakable)       24           27     ← it prevents 24 breaks, causes 27
```

The second rule carries **23 repairs** and causes **27 breaks** — 0.85 per break, so on its own record it
is a net harm, which is why a naive reading of R35 predicted truncation would help. It also *prevents 15
repairs and 24 breaks*: the same first rule behaves differently when it is alone in the block. The four
cells sum to the measured −5 questions, and the identity is a test (`assignment.test.ts`).

**Why that matters more than the sign.** A pack's effect is not a sum over its items. Anything that tunes
the number of items — a budget, a top-k, a density panel — is tuning an interaction it cannot observe, and
the exchange rate says the same thing from the other side: the pair clears **0.737** of the bare model's
1.335 hurdle and the single rule clears **0.672**, so truncation moves the arm *away* from paying.

**Read per fold, and then on a second store, the interaction is never decidable.** The store is distilled
once per fold, so §8.11's four cells are five readings rather than one, and `foldsOf` returns them with an
interval each. The split is seeded, so fold *k* holds the same questions in both store draws the project has,
which makes the two tables **paired** — `foldPairsOf` reports, per fold, whether the sign survived and whether
each draw's interval spans zero:

| fold | questions | first draw | second draw | both span zero |
|---|---|---|---|---|
| 0 | 307 | 0 | −2 | yes |
| 1 | 307 | −4 | −1 | yes |
| 2 | 307 | +4 | +5 | yes |
| 3 | 307 | −5 [−2.55, −0.66] | −1 [−2.93, +2.06] | first **no**, second yes |
| 4 | 306 | 0 | −2 | yes |

The rows sum to each draw's pooled net (−5 and −1) by construction, and that identity is asserted at both
levels. Three folds keep their sign; the two that do not are exactly zero on the first draw and have none to
keep. **The one fold that looked decided — fold 3, the only interval in either draw that excludes zero —
covers zero on the second store**, and the fold that is positive twice spans zero both times. So the
per-fold table's verdict is neither "the pack disagrees with itself" nor "the effect lives in one fold": it
is that no fold in either draw clears noise, and the count lever therefore has nothing to be calibrated
against. The architecture consequence is the same as the pooled one and better supported: no rule-count
setting, and no prune, because both would be a decision on a quantity with no decidable fold.

**Gates.** `V62-assignment-instrument` (the arm is a truncation: one item at most, every question asked,
the block changed on at least seven tenths of them) and `V63-assignment-reproduces-the-lane` (this reading
agrees with the lane's own `arm_pairs` entry to a hundredth of a point on the delta and exactly on both
discordant counts). Both are emitted by this module rather than by a dispatch, which has one consequence
worth knowing when you read a registration: `prereg/R36-pack-assignment.md` names the lane's thirteen gates
in its header, not these two, because that field states what the round's dispatch emits — see `AUDIT`
§34.7 for the push that caught the difference. `pnpm eval:pack-assign` recomputes the artefact from the committed run and the workflow
asserts thirty-two of its fields on every push; the module is at 100% on all four coverage dimensions.

**What it changes about the product statement.** Both remaining levers were designs. One of them — how many
items a prompt carries — is now measured, and it does not pay. What is left is the unit of memory itself:
the grain at which a correction is written.

```text
  what was tested            what it showed                    what it licenses
  ─────────────────────      ────────────────────────────      ────────────────────────
  pack size (observed)       +3.13pp [+0.87, +5.23]            nothing: selection
  pack size (assigned)       −0.33pp [−1.65, +1.25]            nothing: sign reversed
  the second item            23 repairs / 27 breaks, 0.85       nothing: not additive
```
