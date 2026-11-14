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
screen, the exact-key merge, generalisation, write admission, contradiction resolution, evidence
admission — happens in the distiller, once, for every interpreter. That is what makes an LLM-backed
interpreter safe to enable: the model's output is untrusted input to a pipeline that already exists.

The order of those four store decisions is load-bearing rather than incidental:

| Step | Asks | Runs when |
|---|---|---|
| exact-key merge | is this the same claim in the same scope? | always |
| generalisation | is this the same claim seen from another domain? | `generalize` on |
| write admission | does this resemble a stored rule closely enough to merge, and would merging change it? | `admission` passed |
| contradiction resolution | does this claim deny an active rule? | `resolveContradictions` on |

Admission runs after the other two on purpose: placed earlier it would absorb the cross-domain
recurrence generalisation exists to widen, and an ablation that switched it off would then be
measuring two mechanisms. It asks only about claims that would otherwise be *created*, so its
contribution is the set of items that do not exist.

**One decision runs after the store, not against it.** `consolidateKnowledge` takes a store that has
already been written and asks a question none of the four above can: *which of these items are one
claim?* The four are asked per write, when the store holds one episode of a claim and the second has
just arrived; consolidation is asked once, over the finished store, and folds each group of
paraphrases into one survivor carrying the union of its evidence. That union is what the recurrence
count reads (`supportTasks` counts distinct tasks in `evidence`), which is why it is the only
mechanism that can raise an item's support after the fact.

It is a function over items rather than an option on `distill` for the same reason: a store can be
consolidated twice without changing (`distill` would reprocess events), and a host that never asks for
it gets the bytes it always got.

| It merges | It refuses, and counts |
|---|---|
| same kind, same scope, statements whose terms are contained past a floor, compatible conditions | different payloads (one item cannot carry both), identical evidence (no support bought), conditions that share less than three content terms (the first would win by arrival order) |

The survivor is the best-attested live member — not quarantined first, then the most distinct tasks,
then the most evidence rows, then the smallest id — so the result is a function of the store rather
than of the order its items happened to be written in.

**The floor is measured on the store, and the first one was wrong.** It began as Jaccard overlap at
0.70, and a store written by the trace unit says why that could not merge anything: its two closest
items are one claim — both open *"when a request bundles several changes, carry out every requested
change in the order the requester stated them"* and differ only in how the sentence closes — and
Jaccard scores that pair **0.483**, which is the *maximum* of all 105 pairs in that store. The
next-highest pair, which is not a repeat, is 0.250. A floor above a population's ceiling cannot be a
decision.

Containment — shared content terms over the *smaller* claim — charges a trailing clause once instead
of twice and puts the same pair at **0.700** against **0.533** for the closest non-repeat, so the
floor sits at **0.60**. The condition is tested by a count rather than a ratio, because the ratio is
uninformative at this scale: a paraphrased trigger and an unrelated one both read 0.400, while a
paraphrase shares four content terms and a conflict shares two. Both floors travel in the census
(`threshold`, `conditionMinShared`), so a store consolidated under one setting is never read as a
store consolidated under another.

### 2.4 `apply` owns the injection boundary

The renderer is the only place that decides what a model sees. It is therefore the only place that
must be paranoid: it escapes `<`, enforces the budget exactly, reports truncation, and guarantees that
`items` and `ids` describe the rendered block rather than the *intended* one.

Two properties of that boundary are worth stating because they constrain the layers above it. The
first is that **the note is a rendering option, not store state**: the sentence a block opens with is
chosen per request (`RecallQuery.note`, defaulting to the host's), so an experiment can vary one
sentence across three recalls over one store — which is the only arrangement in which the three arms
share their items. The second is that **the budget's coverage is declared rather than assumed**
(`budgetBasis`): by default the wrapper is charged to the budget, note and all, which is the
accounting every published number used; a host that varies the note declares `note-excluded` so the
longer sentence cannot buy its characters by dropping a rule. Both are properties of the boundary, so
both belong here rather than in a caller.

The third is the newest and the one with the largest scope: **the unit a pack is written in is a
delivery decision** (`RecallQuery.shape`, defaulting to `per-failure`). A store that records one item per
failure cannot express that three tasks taught the same routine, because the dedupe key is the
normalized statement and two failures of one routine differ in every literal token. Folding those items
at the render boundary — keeping the group's medoid, reporting the support the group carries — makes the
store's recurrence visible to the model without changing what the store holds, which is what lets one
dispatch compare the two units over one store. Two halves are deliberately in different places: the
**request** says which unit it wants, and the **host** declares how to recognise a routine
(`shapeOf`), because the shape of a record is the lane's vocabulary rather than the library's. Folding
never rewrites a survivor's statement and never writes the group's evidence back onto it: an item whose
provenance described a corroboration no task contributed would be an item a ledger could not join back
to the store.

Because the unit is a request option and the store is untouched, one process can serve both units from
one store, and that is the only arrangement in which the two are comparable: a dispatch's corrections
are written by a model at run time, so two dispatches distil two stores and no pairing statistic can
repair it. The comparison is guarded by a **containment** control rather than an identity one — on every
request the budget did not cut, the folded pack must be the per-failure pack minus exactly the items the
fold reports removing — because an identity control asserts the packs are equal and a fold whose packs
are equal did nothing. The arm that runs the pair is `packages/eval/src/shape-pair.ts`, and it is turned
on by a pre-registration's `facadeShapes: two-unit` rather than by a menu item, so a run cannot choose
its units after its readout.

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

**Provenance is a filter as well as a weight.** `EvidenceRef` carries the attempt an observation came
from (`trial`), and a recall may name the attempt it is for (`before`): only claims whose observations
are *all* from earlier attempts are served. That is what makes a store written between attempts a
measurement rather than a leak — attempt *t* cannot read what attempt *t* taught. Three absences stay
three different things: no `before` is "no watermark" and not `before: 0`; a claim with no `trial`
predates the episode and is served to every attempt; `0` is a real attempt. The filter runs on both of
`search`'s candidate paths, because a rule that generalised out of a domain carries none of the
question's words and is reachable only through its scope.

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

**What a rule is matched by.** Stages 1, 2 and 3 read the item's *recall text* — its `when` condition
followed by its statement — and not the statement alone. One function, `recallText`, because the three
stages had each decided for themselves and all three had settled on the statement, which is half a
rule: the half that records what was true, with the half that says when it is true left out of every
index, floor and diversity measure. A store whose rules carry no condition is then a store no question
can find. Measured on τ² retail: ten rules, 38% of 1,528 requests served an empty pack, 0.76 rules per
request.

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

### 6.1 Two kinds of knowledge, and the rule that must not cross between them

The formula above is written for a **claim**: something several independent observations can support,
whose application can be scored. Every kind is a claim except one. An `exemplar` is a **record of an
episode** — a question and the actions that answered it — and the two questions the formula asks do not
apply to it:

| what the formula asks | what a record has |
| --- | --- |
| is it supported by several independent observations? | one observation, by definition |
| when applied, did it help? | it is not applied as advice; `applied` stays zero |

That has one consequence in this codebase, and it is `isEventKind`:

> Two items of one kind in one scope with different content **contradict each other** — unless the kind
> is an event.

For claims the rule is right. Two rules of one kind in one scope answer one question, so different
content is a disagreement, and a store that kept both active would be serving a contradiction. For
records it is wrong: two orders cancelled on two afternoons both happened, and a store that halved the
first one's support when the second arrived would be treating chronology as disagreement.

This is not a tolerance and not a special case in the ranking — it is a statement about what the object
is. A store built from episodes has to say so, because the alternative is a store that refutes its own
contents: twelve records written, eleven refuted by each other, one admitted.

**Why it matters to a caller.** If you write `exemplar` items, they are admitted on their **source
trust** and their own confidence, not on repetition — so do not expect a second similar record to
strengthen the first. If you write claims, the corroboration rule is unchanged and is what protects you
from a single articulate user. Choosing the kind is choosing which of those two regimes you are in.

### 6.2 The budget is a cost, and it decides what a whole item can say

A pack is a character budget with a fixed cost: an element, a note, and a line per item carrying its id,
kind, confidence, scope and statement. On the record arm measured here the fixed cost of **one** line is
390 characters, so a 1,200-character pack carries a record whose statement is at most **810**. Anything
longer is retrieved, ranked, and then dropped at render — and a pack that dropped its only candidate
returns no ids, which every caller reports the same way it reports "nothing was relevant".

`maxStatementChars(options, shape)` measures that boundary instead of deriving it: it renders a
single-item pack through `renderPack` at the options the caller will actually use and binary-searches the
longest statement that survives. It takes a **shape** because the capacity is a property of the line, not
of the library — a record with a provenance payload costs 149 characters more than a bare claim, and a
capacity quoted for the wrong item is a check that passes on a pack that cannot carry it.

| budget | capacity | what one recall carries |
| --- | --- | --- |
| 1,200 | 810 | one 700-character record, 110 characters of headroom |
| 1,600 | 1,210 | one record of up to 1,210 |
| 2,400 | 2,010 | one record of up to 2,010 — a measured 1,717-character record fills 2,107 |

**Capacity is per record, and a pack holds fewer records than the division suggests.** At 2,400 a
single 1,717-character record charges 2,107 of the budget and leaves 293; a second record of the same
length is **refused, not truncated**, so the pack serves one item and the renderer counts the rest as
`droppedForSize`. That is the measured behaviour of a real store, and it is why `droppedForSize` is in
the census: dividing the budget by the mean record length predicts two records, and the run reads one.
If you want two records per recall, size the budget for two *plus* the wrapper, or shorten the records —
and check which one you did, because they are different treatments.

**If you write long items, raise the budget with them.** A writer and a pack that disagree do not error;
the pack just serves less than the store holds, and the loss is invisible from both sides. If your
records can run to 2,000 characters, your pack needs 2,400 — and `recall` on a store you have written
will tell you: `truncated` counts the items the renderer refused, so a non-zero value with a non-zero
`ids` is a pack that served something and dropped the candidate that ranked first.

**The two numbers can be registered together.** A knowledge pack is a cost per request, and a ceiling is
a fidelity choice; neither bounds the other by itself. Where a run states both, this codebase checks that
the ceiling fits what the pack can render, because the alternative is a store built to be dropped.

**A budget below the wrapper renders nothing at all** — an empty string rather than a block with
`items="0"`. That is deliberate and it is what makes the amount a guarantee rather than an estimate: a
header that says zero items is 200 characters of a block that claims knowledge and carries none, which
measured on the public lane cost 1.14pp against an empty pack.

## 7. Security model

| Threat | Control | Where |
|---|---|---|
| Prompt injection in a correction | Screen at distill time; a matching claim is quarantined, not dropped | `core/guard.ts` |
| Statement escaping the prompt block | `<` escaped in every rendered field | `apply/render.ts` |
| Secret exfiltration | Email, phone, `sk-…` patterns redacted before persistence; a bare digit run under a reference key is a row key, not a number | `core/guard.ts` |
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

### 7.2 What memory will not persist, and what it will

Redaction runs before persistence, not at export: a dataset redacted on the way out has already written
the secret to disk once. The rules are email addresses, telephone numbers, `sk-…`/`gh…_`/JWT/AWS key
shapes, and they apply to tool arguments, notes and statements alike.

**A reference is not a secret.** A ten-digit run has no property that distinguishes a row key from a
telephone number, so the guard reads the field the value arrived under. `product_id="7363354090"` is a
row key and is kept; `phone="7363354090"` is a number and is redacted; `user_id="+1 415-555-2671"` is
redacted because a reference carries no separators. The key must declare itself — `id`, `*_id`,
`*_ids` — and a bracketed list under such a key is exempt as a whole or not at all, so you never see
`item_ids=["1615379700", "[phone]"]` where half an identity survives.

| value | under `product_id` | under `phone` | in prose |
| --- | --- | --- | --- |
| `7363354090` | kept | `[phone]` | `[phone]` |
| `+1 415-555-2671` | `[phone]` | `[phone]` | `[phone]` |
| `a.b@example.com` | `[email]` | `[email]` | `[email]` |
| `sk-…` | `[api-key]` | `[api-key]` | `[api-key]` |

**An address is redacted in every position**, including an identifier slot. Real systems do use an
address as a user id, and that value is a person's contact detail whichever field carried it; the
cost is that a record written from such a call names the shape of the answer and not the identity, and
this library accepts that cost rather than trading privacy for a benchmark number.

**The residual, since a security document should state it.** A ten-digit telephone number written
without separators, passed in a reference slot, is indistinguishable from a row key and will be kept.
A formatted number is always redacted, `phone`/`mobile`/`contact` are never reference keys, and a value
the guard objects to on its own merits — a key, a token, an address — is redacted wherever it sits.

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
- `tau2-pin.ts` — the store as a file: the failures an earlier measurement learned from, priced against
  the pinned corpus instead of re-derived from a fresh rollout. `parseStorePin` reads the list,
  `pinRewards` refuses an id the corpus does not hold, and `pinnedLearn` returns the same three things the
  run branch returns, so nothing downstream can tell a rebuilt store from a replayed one. It exists
  because a store is otherwise a *draw*: which learning tasks fail is one sampled trial each, and two runs
  of one configuration wrote 12 and 15 corrections with 8 ids in common — so a comparison across them is
  not single-variable whatever its registration says. A pinned run also skips the episodes it replaces.
- `tau2-queries.ts` — the *question* as a file, which is the input a store pin cannot reach. A pack is a
  function of (store, query, pack options); pinning the store leaves the query free, and the query is the
  user simulator's sampled first turn, so two runs holding identical records serve different text (1,812.1
  against 1,825.3 mean characters) and measure different coverage (0.2857 against 0.2800). `queryCensusOf`
  records every request (`digest`, `askedDigest`, `replaced`, and the texts), `parseQueryPin` reads a list
  of questions, and `assertQueryPinCovers` refuses a pin shorter than the phase *before* the first episode
  is paid for — a miss at recall time is a 500 the agent survives by serving no pack. Entries are keyed by
  the episode's position, because the agent sends one memory scope on every request and nothing upstream
  names the episode; the digest is order-insensitive, so a pin replayed into a differently-ordered phase
  is visible rather than silent.
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

**What the resolution decides, and what it does not.** The 6pp bar is a *target* the instrument is
built for (`POWER_TARGET_PP`), and every gate sentence that quotes it says so. What `V5-resolution`
actually blocks is narrower and answerable on any scenario: **a run that publishes a direction finer
than its own sample could resolve.** The gate reads three states from `claimPp` — a number means the
run concluded at that size, `null` means it measured and concluded nothing, and *absence* means the
lane does not report claims at all and is graded by the 6pp bar exactly as before. The distinction
matters because absence is not a claim of silence: a lane that never mentions the question must not
pass by omitting it. A scenario whose entire population resolves 9.05pp therefore reports that
number in the gate's sentence, claims nothing, and is not red for it — a permanently red line about
a sample nobody can enlarge is a line its readers learn to ignore.

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

### 8.12 The grain of a write: a definition has a key, and this corpus does not reuse one

Six routes closed with the corpus held fixed — which rules are stored, how many reach the prompt, which
survive a filter, which questions they are shown to, whether an item carries a value that travels, and
what a correction is rendered as. Every one of them changed *which* sentences arrived, or how many, or
what they were called. None changed what an item **is**, and that is what this section measures.

**The record already contains the comparison, and it is not close.** BIRD attaches a curated sentence to
most questions — 142 characters, mean, of what one term means in this database — and removing it costs
**17.01pp** on the dev split, paired, clustered by database (`R24`, n = 1,534). The distilled rule pack
on the same split costs **−0.59pp**. Two objects in one prompt slot, and the difference is neither the
author nor the wording:

```
  what was measured                       what it showed     what it licenses
  ─────────────────────────────           ────────────────   ─────────────────────────────
  the corpus's own definition, removed    −17.01pp           a definition is worth a lot here
  the distilled rule pack, added           −0.59pp           advice is worth nothing here
  the two together (the interaction)        none              they are not substitutes (R24)
```

**Why a definition and a rule are different objects.** A rule states something about a class of
questions and has no referent in the one in front of the reader, so it is applied wherever it is read —
which is what §8.10 measures when it finds the pack naming entities the question never mentioned. A
definition has a **key**: the term. It can be retrieved by the word it is about, and it can speak only
on a question that contains that word. Both properties are mechanical predicates over text, and
`packages/eval/src/lexicon.ts` enforces them rather than asking a model to respect them:

```
  write time   admit only when payload.term occurs in the question that taught the entry
  read time    render only when the held-out question still contains the term
  V64          re-reads every rendered line and fails the run if a term is not in its question
```

**What the arm read, and why the round is inconclusive rather than negative.** `full-lexicon` is a
second store distilled from the same corrections under a different instruction, rendered under a heading
that says what the block is, at the same 1,200-character budget and in the same position. It rendered on
**132 of 1,534 questions — 8.6%**, below the 25% the registration fixed before the run, so the first
refutation clause fires: **inconclusive by feasibility**. The reason is arithmetic:

| step | count |
|---|---|
| corrections the lexicon store distilled | 547 (≈110 per fold) |
| entries written | 179 (**0.33 per correction**) |
| distinct terms among the 179 | **13** |
| held-out questions containing one of them | **132 (8.6%)** |
| reached by the two most common terms (`cards`, `drivers`) | 107 of 132 (**81%**) |

A definition is reusable only where the corpus reuses a phrase, and this corpus does not. The entries
themselves are the right knowledge — `"2010 season" denotes the season labeled 2009/2010, not the
calendar year 2010` — and 127 of the 132 questions they reached already carried a curated definition from
the corpus. So the object is right and the reach is the problem, which is the same structural fact R6
reached from the transfer side ("the units are demonstrations"), now measured without a probe.

**What it does to the product statement.** On this corpus the grain is **not refused and not reachable**:
nothing a host can do moves the phrase-reuse rate of questions written independently, and the only lever
that remains on the write side is the distiller's yield, which is a property of the model rather than of
the memory. A deployment whose questions *do* share vocabulary — a product with a stable schema and
recurring phrasing — is the setting in which this representation would be testable at all, and that is
the product face (S1), not this benchmark.

```
  what was tested                 what it showed                      what it licenses
  ──────────────────────────      ──────────────────────────────      ────────────────────────────
  definition grain, coverage      132/1,534 questions, 8.6%          nothing: below the 25% bar
  entries per correction          0.33                                 a definition is rare
  terms reused by held-out        13 of 179                           the corpus has no reuse
  on the questions it reached     5 repaired, 4 broken                nothing: n = 132
```

**Gates.** `V64-lexicon-is-licensed` is emitted by the lane that measured the arm rather than by the
shared protocol, because no other lane has this representation: it fails a run whose store learned
nothing, whose block rendered nothing, or whose renderer showed a term the question never used — three
ways to publish a clean null without measuring anything. The module is at 100% on all four coverage
dimensions and the workflow asserts fourteen fields of the reading on every push.

### 8.13 Why 8.6% was a ceiling: the vocabulary a corpus defines is the vocabulary it says once

§8.12 closes with a reach of 132 of 1,534 questions and an attribution — "a definition is reusable only
where a corpus reuses a phrase, and this one does not." The attribution is testable without a model call,
because the corpus ships a store of definitions of its own. BIRD attaches an `evidence` block to **90.35%
of dev questions**, and the block is a mapping rather than prose:

```
  Eligible free rate for K-12 = `Free Meal Count (K-12)` / `Enrollment (K-12)`
  driver reference name refers to driverRef
```

Read as `{key, value}` pairs, those annotations are the key universe a definitional memory could have had.
`packages/eval/src/frontier.ts` reads them with three narrow shapes (91.3% of annotated questions yield a
mapping), ranks the 1,559 distinct keys by the questions they reach, and returns reach as a function of
store size.

**The first frontier was a frontier of English.** Ranked raw, **two keys reach a quarter of the split**:
`list` and `name`, each annotated exactly once and each occurring in hundreds of questions. They are not
terms the corpus defines; they are words it happened to write a line about. The separator is the corpus's
own judgement — **density**, annotations over occurrences — and it is decisive:

| keys by the questions that mention them | mean density |
|---|---|
| three questions or fewer | **0.967** |
| fifty questions or more | **0.077** |

A phrase the corpus mentions once is annotated almost every time. A phrase it mentions fifty times is
annotated one time in thirteen. That is the inversion this round found, and it is why a definitional store
runs out of reach: **the words that need defining are the words a corpus says once**, and a memory applied
across questions can only act on words that come back.

| store size | raw keys | density ≥ 0.5 | density ≥ 0.8 | density = 1 |
|---|---|---|---|---|
| 13 keys (the arm's own count) | 1,026¹ | **241** | 148 | 78 |
| keys to reach 25% | 2 | 53 | 233 | 318 |
| ceiling, every key held | 95.2% | **65.9%** | 55.2% | 52.3% |

¹ the raw figure at 13 keys is dominated by the same generic words and is not a vocabulary frontier.

**So the arm was near the frontier and the frontier is low.** At its own 13 terms the vocabulary frontier is
241 questions against the arm's licensed 132 — a factor of 1.83, inside the band the three thresholds
produce. The arm therefore was not badly constructed, and §8.12's conclusion survives; what does not survive
is its reason. The corpus does repeat phrases (346 keys recur). It simply does not repeat the ones it
defines.

**Two scopes decide the arm's own number, and a reading that misses one measures a store nobody built.** The
lane keeps its lexicon per fold *and* per database (`lexiconByDomain.get(row.db_id)`). Scoped by fold only,
the arm appears to license 141 questions and serve 132, which reads as nine silently dropped. Scoped by
nothing, it appears to license 201, which reads as a third of its reach lost to a character budget. Neither
is true: **132 licensed, 132 served**, and the difference was the reading's denominator rather than the
lane's behaviour.

**Gates.** `V66-frontier-is-a-curve` refuses a reading whose curve is not monotone, whose whole key set
reaches nothing, or whose last point is not the union of every key — a reach curve that is not a curve is a
matcher that disagrees with the corpus. `V68-the-annotations-were-parsed` refuses a key universe that came
from the parser rather than from the corpus. `V67-the-store-was-redundant` is advisory and reports that 179
entries bought 13 distinct terms. The module is at 100% on all four coverage dimensions and the workflow
asserts sixteen fields of the reading on every push.

### 8.14 Why the memory disagreement was a sample size: ninety-eight rows and eighteen decisions

`power.ts` audits artefacts: one row per committed run, its memory contrast, and the difference that run
could have detected. Twenty artefacts is twenty answers, and the record's claims are not twenty — they are
the **ninety-eight arm rows** inside those artefacts. `values` at +1.17pp, `linked` at −9.26pp, `full-one`
at −0.20pp, `full-lexicon` at −0.59pp: every one is an arm, none is an artefact, and none had ever been put
beside its own resolution. `AUDIT` §25.7 carried the gap on a schema question — *is an arm an artefact?*

**The answer is no, and an arm does not need to be one.** An artefact is the unit the validity gates
certify: one dataset, one fold partition, one call budget, one set of vetted outcomes. An arm is a column of
that same run. It inherits the gates and contributes one number the gates never read — how many questions
changed hands between it and its control — so it needs `(helped, harmed, n)` read as a row rather than a
validity schema of its own.

**The ledger.** Three arithmetic columns over the committed artefacts:

| column | what it is |
|---|---|
| delta | `(helped − harmed) / n`, recomputed, and compared with the delta the artefact printed |
| half-width | `1.96 · √(helped + harmed) / n`, the 95% interval |
| floor | `√(z²·d/n)` at `z = 2.802` — the smallest delta 80% power would have found |

A row is **decided** when its delta clears the floor, which is `V5-resolution`'s bar and is strictly
stricter than the 95% interval. The two bars are printed for every row because they disagree on real rows:
the 7,000-question train run reads −0.71pp with a 0.82pp floor — inside the interval, outside the power bar —
and a table with one column would have hidden exactly the run that matters most.

**The price.** For every undecided row, `n = z²·d / δ²` with the run's own discordance: the questions it
would take to decide an effect of the size it found. A zero effect has no price and is `null` rather than an
enormous integer, because "infinitely many questions to decide whether nothing changed" is the true
statement.

**The replication.** Each contrast name across the runs that measured it, decided ones counted separately.
Runs are **not** pooled — minidev, dev and train are different samples with different fold partitions and
different stores — so what is reported is the count of runs, the count that could decide, and whether the
decided ones agree. With one decided row the answer is `null` rather than `true`: a set of one has no
agreement to report.

**The shrinkage.** For each contrast measured at more than one size, the median `|delta|` at each size. A
genuine effect does not shrink because more questions were asked. The confound is disclosed rather than
corrected: rows at different `n` are different rounds with different stores, so a fall across sizes is a
fall across experiment families and the row counts are published beside it.

**What the ledger found.** Eighteen of ninety-eight rows are decided, and **every decided row is larger than
4.5pp**. The three design sizes impose median floors of **4.38pp at 350 questions, 2.07pp at 1,534 and
0.82pp at 7,000**, so the pilots that produced most of this record's beliefs could not have seen a 1pp effect
had one been there. `full − none` has been measured **20 times: 18 negative, 2 positive, 1 decided, 6 inside
a 95% interval**, and its median magnitude falls from **2.86pp on 350 questions to 0.33pp on 1,534** — which
is what an exaggerated small-sample effect looks like. The counter-example is kept because it is why the
instrument can be trusted: `linked`'s schema pruning reads **7.71pp at 350 and 9.26pp at 1,534**, the only
contrast in the record whose effect grows with the sample, and it is decided at both sizes.

**Gates.** `V69-every-arm-is-a-row` (blocking) compares the rows found while scanning with the rows emitted,
because silent omission is the failure this record has made in four layers and a short table looks exactly
like a complete one. `V70-the-ledger-reconciles` (blocking) refuses any row whose printed delta is not the
one its own counts imply — one failure means that delta describes a population nobody ran.
`V71-the-price-is-not-below-its-own-sample` (advisory) checks the biconditional between `decided` and
`requiredN`, because those are two spellings of one inequality and a disagreement means the formulas drifted.
The module is at 100% on all four coverage dimensions and the workflow asserts fifteen fields of the
reading on every push.
### 8.15 The layer split: a package for the adapter, and a gate for the claim it licenses

Stage 3 of the protocol/adapter refactor is the move that makes the library's central sentence
checkable: *the measurement apparatus is scenario-agnostic and the scenario is a bounded set of
modules*. Stage 1 moved the gates and the paired statistics into `protocol`; stage 2 made the τ² lane
supply them and narrowed the claim to the apparatus. What was left was the SQL itself, sitting in
`eval` beside the protocol with no line saying which module was which.

**The cut is one question about a signature: does the function mention a database?** Six modules answer
yes — `sql-exec` opens a SQLite connection and returns rows, `sql-guard` bounds a statement, `sql-diff`
reads two statements and says how they differ, `schema-link` matches question words to schema names,
`m-schema` renders a schema, `value-samples` reads column values — plus `canonical`, the one function
that had been living inside `sota.ts` and defining what "the same rows" means. All seven are
`packages/sql`, `@agentix-e/microglia-sql`, and the graph they complete is:

```
core ← protocol ← sql ← eval
                ↖ browser ← node
```

**Three modules answer yes and stayed, and each has a reason rather than a shrug.** `bird-data` opens
SQLite to read a *corpus* rather than to answer a question, and it depends on the artefact schema, which
is the protocol's. `link-bind` needs the rule-template engine, which is a knowledge representation and
not a SQL one. `exec-signature` is a measurement signal over execution shapes, read by the pool and the
signal gate. The distinction is not "mentions SQL" — it is *which layer the module actually depends on*.

**The move changed no number, and that is checkable.** All 31 committed artefacts revalidate through
`pnpm eval:protocol`, and every reading in the `pnpm check` chain rewrites its artefact byte for byte.
A mechanical stage is worth doing only if it can be verified mechanically, so this one is.

**Then the table became a reading.** `PROGRESS` §136 published a coupling table — 11,764 lines of
text-to-SQL, 37.2% of the repository, zero in `core` — measured once by hand. `packages/eval/src/coupling.ts`
recomputes it on every push:

| column | what it measures | why it is not a guess |
|---|---|---|
| lines | per production module, excluding `index.ts`, `bin/`, `__tests__/` | a re-export surface has no decision in it, and counting it makes the denominator depend on how many subpaths a package chose to expose |
| scenario words | the strict list `sql`, `sqlite`, `nl2sql`, `text-to-sql`, `bird`, `m-schema` | `query`, `schema`, `table` and `column` are excluded because they are also a memory store's vocabulary, and a gate with false positives gets suppressed |
| code vs comments | counted separately, comments stripped by a lexer | a module that explains in prose why it is *not* SQL-specific must not be counted as SQL-specific |
| verdict | `adapter`, `deferred` (with a reason in the source), or `general` | the classification is data, so a thirteenth coupled module cannot arrive silently |
| edges | package imports parsed from specifiers, with `upward` computed from a rank table | the direction is checked rather than drawn |

**The lexer is load-bearing and it was wrong first.** The initial stripper tracked quotes and comments
but not regular expressions, so `/^- "([^"]+)":/` in `lexicon.ts` put it inside a string it never left:
the module's remaining comments were swallowed and the scan reported the module as SQL-coupled. The
repair is the standard disambiguation — a `/` after a value divides, a `/` after an operator opens a
regex — with `[...]` honoured inside a literal and flags consumed after it. Three tests exist because
three shapes broke it, and one of them is that exact line.

**Gates.** `V72-every-coupled-module-has-a-verdict` (blocking) fails when a module outside `packages/sql`
carries a scenario word with no written reason, and also when the walker emitted fewer rows than it
scanned — a short table looks exactly like a complete one. `V73-no-package-imports-upward` (blocking)
fails on any edge to an equal or higher layer, because an unenforced direction is one urgent patch away
from being wrong. `V74-core-is-scenario-free` (blocking) certifies the README's sentence: 37 core
modules, **zero** scenario words in code, every hit in its tests.

**The first bug the round found was not in the move.** Under full-suite load the queued-statement test
in `sql-guard` failed intermittently, and the cause was a real design defect rather than a slow machine:
the deadline timer started when a statement was posted to a child, and a freshly spawned child spends
40–80 ms loading `node:sqlite` before it can answer anything. On a loaded box that overhead consumed a
250 ms deadline, so the statement was reported as a deadline rather than as the answer it would have
given. The child now announces readiness and `#ask` starts its clock after that — instrument overhead is
not statement time, and a lane's accuracy must not depend on how busy the machine was.

### 8.16 A task id is a name inside a scenario, and a foreign pack is a measurement

Every lane in this repository measures a memory against the corpus it learned from, and every claim
that rests on those lanes is a claim about *that* corpus. The one thing they could not say until this
section existed is whether the machinery underneath travels: the protocol's gates were written for
text-to-SQL and a second scenario could only be measured by them if the lane could produce a foreign
pack. The τ² lane now can, and the two defects that had to be fixed first are the reason this section
is long.

**A task id is only unique inside its scenario.** τ² numbers each domain's tasks from zero, so
`retail`'s task `3` and `airline`'s task `3` are different tasks with the same name. A run that learns
from one and answers the other therefore hands the protocol a training set and an evaluation set that
intersect completely, and `V2-fold-partition` reports every evaluated task as leaked — a defect in the
plan, published as a defect in the run. Ids are qualified (`airline/3`) at the boundary where the
driver reads the result document, so the split, the pair and the ledger all speak names that cannot
collide. The plan module re-checks disjointness where it is about to be paid for, because a leak is
the one defect in this lane that produces a number rather than an error.

**The transfer gates measure the pack, not a rule.** On the text-to-SQL lane a transfer trial is one
rule shown to one foreign question, with a counterfactual call beside it. τ² has neither per-rule
calls nor a retry inside an episode, so the unit is the episode: `(reference verdict, memory verdict)`
for one `(task, trial)`, where the verdict is τ²'s own `reward == 1`. The gates read the same four
numbers they always have — informative, repaired, broke, measured — and the same
`transferSummary` computes them, because two implementations of one statistic diverge the first time
one is fixed. The treatment is weaker than BIRD's and the artefact says so: `repaired > 0` means the
pack fixed an episode and says nothing about which item in it did.

| reading | meaning | what it costs a reader if it is wrong |
|---|---|---|
| informative | the control arm failed, so the pack had something to repair | the conditional repair rate can only go up, because its denominator excludes every episode where the pack could do damage |
| broke | the control arm passed and the treatment failed | the loss side, which a rate without it hides |
| unmeasured | either verdict is `null` (an infrastructure failure) | counting it as a failure credits or blames the memory for a call that never returned |
| ledger | one row per episode, holes included | a rate whose pairs did not survive the run cannot be recomputed from the file |

**The second defect was a bar from the wrong scenario.** The lane shipped with one published
reference — a competitor's `pass^4` on τ²-retail — and graded every arm against it. On a second
scenario that is not a strict bar but a category error: the delta measures the difference between two
scenarios and reports it as the difference the memory made. The bar now belongs to the scenario it was
published for (`l4-scenario.ts`), the artefact carries `published_bar_applies: 0` and a sentence
saying why, and the comparison a foreign run supports is the paired one.

**The recall scope is part of the treatment.** Items carry the scenario they were learned in, and
recall filters by scope, so a `retail` store answers an `airline` question with nothing unless the
facade asks in the store's own terms. Asking in the store's terms is what a transfer arm is; leaving
the filter at the question's scenario would measure an empty pack and report a null. Both names are
recorded, so a reader can tell a foreign pack from a pack the scenario filter emptied.

### 8.17 A score is a score of a release, and the release is not a version of the software

The τ² lane has quoted `pass^4` against a published figure since its first arm, and until this section
existed it had never checked which release that figure was produced on. It was not the one the lane ran.
The difference is not a changelog item: the benchmark publishes its own train/test halves from v1.0.0, so
the release the lane had pinned cannot even name the sample the published number was measured on.

**Three things move together, and only one of them is about tasks.** Measured out of the corpus at both
refs rather than read from release notes:

| | tau2-bench v0.2.0 | tau2-bench v1.0.1 |
|---|---|---|
| `data/tau2/domains/<domain>/split_tasks.json` | absent | retail `train` 74 / `test` 40 / `base` 114 |
| retail task bodies | 114 ids | the same 114 ids, **0 identical** by content hash |
| retail `reward_basis` | declared by 0 of 114, so the default `[DB, COMMUNICATE]` applies | declared by 114: 112 × `DB+NL_ASSERTION`, 2 × `DB` |
| retail tasks graded on their prose rubric | 0 | 112 |
| airline `reward_basis` | 0 of 50, same default | 50 of 50, all `COMMUNICATE+DB` — the grade is unchanged |

So the sample, the bodies and the reward move together on retail, and only the sample and the bodies move
on airline. A library that reports a number without the release it came from therefore cannot say what its
own number measured, and the fix is a record rather than a caution: the artefact carries
`benchmark {version, commit}` — the tag the workflow pinned and the commit the checkout is at, because a
tag can be moved — beside `taskSplit`, which names whether the halves are the benchmark's or the lane's own
cut.

**The runner boundary is discovered, not assumed.** The two releases do not share a runner surface: v1
moved the batch runner to `tau2.runner.*`, made it take a pydantic `TextRunConfig`, and replaced
`register_agent` with a factory. The adapter asks what the installed package *exports* rather than what its
version string says, because a release that back-ported half of the move would pass a string comparison and
raise inside the first paid episode. A `selftest` phase checks the signatures, the config fields and the
registry's capability before anything is listed, so a mismatch costs two seconds instead of an environment,
a built store and an aborted run.

**What this does not license.** A cross-release comparison is not a defect report about the benchmark and
it is not evidence about memory: it is a statement that two numbers are not the same measurement. The
library's own claim — that a distilled store raises the share of tasks solved in all trials — is a paired
claim, and the paired claim survives a release boundary exactly as well as it survives a split boundary:
by being made twice inside one of them.
