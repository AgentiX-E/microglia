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

**Two fields are stamped from the event, and the candidate's own value is discarded.** The *tier*
comes from the event's kind, and the *side* — `repair` or `pass`, which half of the run the lesson came
from — comes from its signal. An interpreter is host code reading someone else's observation, so a
claim that says "this was a success" over a failed outcome is a statement about evidence it did not
collect; the event is the authority, exactly as it is for the attempt number. The side is not
decoration: retrospection consolidates corrections into guidelines and may only let a success
contradict one, so a store that cannot say which records came from a correction cannot feed it. It is
adopted once and then held, like a condition — a success repeating a lesson learned from a failure is
support for the lesson, not evidence about where it came from.

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
| same kind, statements whose terms are contained past a floor, compatible conditions | different payloads (one item cannot carry both), identical evidence (no support bought), conditions that share less than three content terms (the first would win by arrival order) |

**The key narrows the search; it does not decide the claim.** The pass is quadratic, so it groups items
by a key before comparing them — the scope by default, or a routine a host supplies — and for a long
time a pair whose keys differed was removed rather than compared. That is a filter doing a measurement's
job: on a real store of 64 statements it hid **34 of the 35** duplicate pairs, so the pass merged one
item out of a store that repeated a third of itself. `linkage: 'all'` keeps every claim test and stops
the key removing pairs, and the census reports `skippedKey` — the pairs the key removed after every
other test admitted them — so the two readings can never again be confused. See §13 of the user guide.

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

**A merge is a label until something acts on it.** With `linkage: 'all'` the pass reached
`supportAfter {1: 44, 2: 8, 3: 2, 4: 1}` on a store where every item had one task before it, and the
lane went on serving those 55 items as though the census did not exist. The act is deliberately not in
the pass: retiring an item is the *store's* vocabulary (`statusReason`), and a rule inside the recall
path would be a second implementation of it in another process. `retireBelowSupport` runs once, after
the pass and before the gate that reads the store, so the population the eval phase prices is the
population the floor left — and the floor's own record (`total`, `retired`, `retained`, `floor`)
travels in the learning block, because a store that serves 11 of 55 items and a store that had 11 items
are the same sentence in every census that came before it.

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
- `distill-preflight.ts` — one fixture correction, asked of the interpreter **before** a learning phase
  is bought, and `distill-replies.ts` — how many replies came back, how many were empty, and the first
  empty one verbatim. The pair exists because a funnel cannot see silence: one event asked, zero
  candidates and zero dropped claims is the same reading whether the model wrote `[]` or the
  interpreter never ran, and a learning phase is the most expensive thing in the lane to spend on that
  ambiguity. The pre-flight is off unless a dispatch enables it, and the artefact records whether it
  ran, so an arm that was checked is distinguishable from one that was not.
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

### 8.18 A fold states what it learned, and the pool refuses what it cannot check

The lane has measured one direction of the benchmark's boundary since R92, and the reason is not the split: it
is that a paired reading needs a *pair*, and one arm has one. Two arms — the published direction and the reverse
— give 114 pairs where one gives 40, and the arithmetic is the same function the rest of the record uses.

The design has one claim, and it is not "the memory helps": it is that **no task is scored by a store that saw
it**. Everything else in the cross-fit follows from how that claim is made checkable.

| decision | the alternative, and why not |
| --- | --- |
| the pair artefact records the two id sets (`foldSplit`) | deriving them at read time from the dispatch's environment: the environment is gone by the time anyone reads the file, and a boundary nobody recorded cannot be checked |
| the pool **refuses** a fold that does not state its learning half | defaulting to "it learned from the other half", which is the assumption that makes the check disappear precisely on the artefacts that need it |
| a duplicate task is a refusal, not a de-duplication | de-duplication silently changes the sample; a duplicate means one of the two files is not the split it claims to be |
| the pooled interval comes from `comparePaired` | a second implementation of one statistic: two formulas for one quantity is two answers to a question the record already answers, and the disagreement surfaces as a gate that passes what the power audit rejects |

**Why the identity travels with the pair.** `poolArms` has refused to pool two experiments since R85, and it
compares the unit, form, scope and model that a *dispatch* declared. A cross-fit pools two *files*, so the same
four fields have to be in the file. `treatmentOf` reads them from the two arms and refuses when one states a
field the other omits — absence is not agreement, and a pool that treated it as agreement would average a store
that distilled corrections with one that distilled something else.

**What the reading carries that a delta cannot.** Two things, and both exist because a pooled mean is a lossy
summary of two folds:

- **per-fold deltas**, because +25pp and −5pp average to +10pp, and only the columns say whether the mechanism
  is uniform or the corpus is doing the work;
- **the tiling census** (`neverLearned`, `neverScored`), because on a corpus where one fold dropped two tasks the
  pooled `n` is not the corpus's `n`, and the difference is the kind of thing a footnote hides.

Neither is a refusal. A refusal would make the instrument unusable for exactly the diagnosis it exists to
support — a fold that dropped tasks is a fact to report, not a run to discard.

### 8.19 A render is judged where a repair was possible, and a dropped boundary is a count

Two defects, both found by the same run, both of a kind that reports a number instead of an error.

**The denominator.** `itemTransfer` counted `repairs` and `breaks` over renders since R138, and every reading
taken from it divided by the wrong thing. A record served on a trial the control already passed cannot repair
anything; it can only break. On R141 the split is:

| over 40 renders | count | share |
| --- | --- | --- |
| repairable (control failed) | 7 | 17.5% |
| of those, repaired | 5 | 71.4% of 7 |
| only-breakable (control passed) | 33 | 82.5% |
| of those, broken | 1 | 3.03% of 33 |
| arm and control agree | 34 | 85.0% |

So `repairs / renders` = 12.5% described the **corpus** — how often a failure coincides with a retrieval hit —
while `repairs / opportunities` = 71.4% describes the **store**. The two differ by a factor of six on the same
run, and only the second is a property of the thing under test. `serveYieldCensus` therefore carries
`opportunity` as a first-class count, and `inert` as the residual rather than an omission: an inert render is
paid tokens with no mechanism attached, and on this arm it is 85% of the traffic.

**The per-record test.** With opportunities as the denominator, "this record never repaired anything" becomes a
question with an answer: at the store's own rate `p`, `ceil(log α / log(1 − p))` opportunities are needed before
zero repairs is evidence at `α`. On R141 (`p = 5/7`) that is 3, and the most-served record was rendered nine
times with **one** opportunity. Any retention rule keyed on renders would have retired it on a coin flip.

**The dropped boundary.** `pairedEpisodes` joins episode boundaries to trials by task id and falls back to
position. A boundary that resolves to no trial — an abandoned attempt — leaves a range of ledger requests that
no episode owns. The join already reported that as `unresolved`, and the caller treated it as
`return undefined`: forty of forty-one boundaries is a table, and R141's attribution was absent from the
artefact because of one attempt the run gave up on.

The record's own rule, stated in 8.9 and again in 8.18, is that a **partial reading is a reading with an
announced hole**. So the join proceeds over the groups it could name, and `unmatchedRequests` stops being an
assumption (`ordered.length === 0 ? ledger.length : 0`) and becomes a measurement: the requests no span covered.
The refusal is kept for the one case where there is nothing to publish — no episode resolved at all.

| decision | the alternative, and why not |
| --- | --- |
| opportunity is a count on the census | a caller computing `renders − breaks` at the call site: two definitions of one quantity, and the one that is wrong is the one that reads plausibly |
| the coefficient is the store's own rate, not a prior | a fixed 0.5: the number of opportunities a record needs depends on how good the store is, and a prior would make a good store look under-sampled |
| a dropped boundary is counted, not fatal | refusing the arm: it costs the reading and reports nothing, and the arm that needed the diagnosis most is exactly the one that dropped a boundary |
| `unmatchedRequests` is coverage-derived | testing `ordered.length`: a property of the join's input instead of its output, which is how the count read 0 on the arm that had dropped requests |

### 8.20 One parse, one clock, and a guard that is a value

`not_before` is a request for a later moment, and three steps need to agree about that moment: the waiter (how
long to sleep), the deadline check (how much of the job limit the sleep has consumed) and the window guard
(whether the run that starts then will finish before the expensive hour). The first version had the waiter parse
the request and the guard parse it again, minutes later:

| reader | when it read | answer |
| --- | --- | --- |
| `eval:wait-band` | 01:54 | sleep 126 minutes, wake at 04:00 |
| `eval:window-fit` | 04:00:27 | `04:00` is 1440 minutes away |

`planBandWait` reads a passed hour as the next day's, which is right for a dispatch sent at 05:00 naming 04:00
and wrong for a guard grading the wait it just performed. The dispatch slept two hours and was refused.

**The repair is a single derivation, published.** The waiter writes both quantities downstream needs —
`wait_min`, a duration, and `start_at`, an instant — and the guard takes its `now` from `start_at` rather than
from a second parse. `TAU_START_AT` being unreadable is a refusal that names the variable; the fallback to the
wall clock is precisely the defect, because the clock at the check is not the instant of the start and at a
boundary the two sit on opposite sides.

| decision | the alternative, and why not |
| --- | --- |
| the waiter publishes an **instant**, not the hour it was given | re-parsing `HH:MM` downstream: any reader that arrives after the hour must decide whether it passed, and the two readers decided differently |
| the guard's answer travels as an output (`fits`) | its exit code: GitHub adds an implicit `success()` only to `if:` expressions that name no status function, so one arm inherited the gate and the other — the one whose condition names `!cancelled()` — did not |
| an unreadable `TAU_START_AT` refuses | a fallback to now: at a boundary the fallback lands on the other side of the window, which is the same 1440-minute error with a shorter explanation |
| the arms' conditions spell the gate out | relying on ordering: a step order is a fact about the file, and a gate is a fact about the run |

**What a guard is, stated as a rule.** A step that fails makes a job red; a step that **publishes its answer**
makes a decision. Only the second can be obeyed by a step whose own condition has a status function in it, and
the number of such steps is not visible from the guard.

### 8.21 A field may be attribution without being a grain, and the invariant is a test

`ServeRender` was written without a task id, on the argument that a second identity invites a second
de-duplication (`itemTransfer` de-duplicates at the episode, where the identity is known). The argument is
right; the conclusion was a silent restriction. On R141 the census could say *one break over forty renders* and
not *which task*, and the remaining question in the lane — reach versus interference — is exactly the question
the missing id would have answered.

| reader | groups by | divides by |
| --- | --- | --- |
| `serveYieldCensus` | record | opportunities |
| `serveTaskCensus` | task | nothing |
| `itemTransfer` | record × episode | nothing |

Three grains in one structure, and only one of them divides. The guarantee is a case rather than a comment:
`serveYieldCensus` must be deep-equal on the same renders with and without `task`, so the round that adds a
division by task fails at the point it is written rather than at the point its number is quoted.

**The id travels from where it is known.** `EpisodeOutcome.task` is set by both join paths in `pairedEpisodes`
from the trial row's own `id` — the identity join and the positional fallback — and `itemTransfer` copies it
onto each render. Absent stays absent: `exactOptionalPropertyTypes` distinguishes no key from `undefined`, and a
render whose episode named no task is counted as `unattributed` rather than attached to a task that did not
serve it.

**Net zero is two readings, so the census does not fold them.** `harmed` / `helped` / `neutral` classify the
net; `contested` is an independent flag for the tasks where both a repair and a break occurred. A task at net
zero that is not contested was reached and changed nothing, which is the same fact as the yield census's inert
share from the population end.

| decision | the alternative, and why not |
| --- | --- |
| the id is attribution only, asserted by an invariant case | withholding it: a missing field is silent, and nothing can fail for a question the structure cannot ask |
| `unattributed` is a counted field | dropping unlabelled renders: the census would then report a population it did not read |
| `contested` cross-cuts the net buckets | a fourth bucket: a task at net zero after one of each is not the same reading as a task with no movement, and a bucket would force a choice between two true statements |
| three line forms, one per state | one form with zeros: `0 task(s) reached` is the collapse of absent into zero that cost this lane two dispatches |

### 8.22 A treatment has three axes, and the pool compares all of them

`packMode` (where a pack is served from), `packShape` (the unit it is written in) and `serveAnchor` (what may
appear inside it) are resolved by three modules and joined by one pure function:

```
knobFragment({mode, shape, anchor}) -> "anchoring=lexical&shape=collapse&..."   (or "")
```

Empty is a fact the lane preserves byte for byte: the retrieved arm's request must stay identical to the one every
committed artefact was written with, or the history stops being comparable to the future.

**The join is a function, not a bin.** It was code inside `eval:pack-knobs` for one hour, which meant the rule it
enforces — a prefix arm cannot carry a lexical anchor, because `anchoring=scope` and `anchoring=lexical` would
collide in one query string and the last key would win in silence — could only be checked by spawning a process.
A rule checked by four process launches is a rule checked intermittently.

| decision | the alternative, and why not |
| --- | --- |
| the anchor is its own axis | a third `PackMode`: that type's contract says its names are places, and a filter on what appears inside a place is a different question |
| `declared` distinguishes "the default" from "unsaid" | inferring it from an empty knob string: two different facts about a run, one representation |
| the knob string is an identity field | re-deriving `anchor` from `anchoring=…`: a second reader of a vocabulary that lives in one module |
| absent and `''` both normalise to `none` | treating them as different: every artefact before the field would be refused by every pool |

**And the record.** `tau2.pack.knobs` carries the string verbatim. It is the only trace of the filter once the
request is made, and it is what makes "which serving did this artefact measure" answerable without reading a log.

### 8.23 A threshold is priced from the ledger, not from a second dispatch

`pack.margins.ladder` counts how many requests a given margin would withhold. It cannot say *which* ones, and
the only question a threshold is chosen by is whether the withheld requests are the ones that did damage. The
three arrays that answer it are already in the artefact — the ids served per request, the gate's margin per
request, the trial each request belonged to — so the answer is a join, and the join is `serve-sweep.ts`:

```
renders (one per record per trial, each carrying its margin)  ->  marginSweep(renders, rungs)
                                                              ->  { trials, unpriced, firstClean, rows }
```

**The margin travels on the render, not beside it.** `itemTransfer` is the only place that knows which request
served which record, so it is where the field is filled: the **highest** margin among the requests of an episode
that served that record. The aggregation is a maximum because a gate acts per request while an outcome is
measured per trial — a record that cleared the rung at one request of a trial and not at another was still served
into the trial.

| state | meaning | the sweep |
| --- | --- | --- |
| the key is absent | the arm carried no census | nothing is published at all |
| the value is `null` | the census ran, the request served one candidate | served at every rung, counted in `unpriced` |
| a number | a contested request | served iff `margin >= rung` (strict, matching `buildPack`) |

**One statistic, deliberately not a maximum.** `firstClean` is the first ascending rung with `broke === 0` and
`kept > 0`. The argmax of the net would be a parameter fitted to the sample it is read from, and the record has
refused that shape everywhere else. The `kept > 0` clause lives in the predicate rather than in a reader's eye,
because a rung that withholds every request is trivially clean and worthless.

**The ranking underneath the rungs.** `marginRanking` walks every labelling of the pooled margins and reports
AUC with the exact one-sided permutation probability, because "the cleanest rung is 0.30" invites a question the
rung cannot answer: whether the margin orders a repair above a break at all. The walk is enumerated, not
resampled — the margins and the outcomes are fixed and only the labels are in doubt — and above twenty thousand
labellings it reports `enumerable: false` with the count it would have needed, rather than a normal
approximation nobody believes.

**The premise is printed with the number.** A withheld trial is estimated at its control outcome, which is what
the reference arm measured on the same task — and a model shown a procedure and then not shown it is not the
model that never saw it. The line therefore opens `serve sweep (estimated, …)`, and a rung is *measured* only by
the dispatch that runs it. What the estimate removes is the first dispatch of a two-dispatch loop.

### 8.24 Two draws, not one: what a test–retest does and does not license

`l4-pair`'s interval is McNemar's, computed on the discordant pairs of one dispatch. It is the variance of the
**paired difference**: both arms' noise is inside it, and what it excludes is exactly the part the pairing
cancels — the task-level difficulty the two arms share. A second dispatch of the same reference arm therefore
measures something else: how stable one task's outcome is from one run to the next. On this lane, 17.5% of 57
tasks flipped.

| quantity | where it comes from | what it licenses |
| --- | --- | --- |
| `degradation.breakRate` | one dispatch | a description of the arm that ran |
| `resolution.standardErrorPp` | within-run discordance | the resolution of the paired delta — 15.55pp at 57, 10.98pp at 114 |
| the flip share of one arm across two dispatches | two artefacts joined by task id | a check on whether the binomial model is adequate |

The check comes out in favour of the model. Two *independent* draws at the rates the two control arms actually
ran (0.8246, 0.8947) would disagree on `p₁(1−p₂) + (1−p₁)p₂ = 24.4%` of tasks; they disagreed on **17.5%**. The
task outcomes are more stable across dispatches than independence predicts, which is the positive within-task
correlation pairing exists to exploit (`1 − (5.36/6.47)² = 0.31` from the two standard errors, `1 −
0.1754/0.2438 = 0.28` from the flip share).

**The rule.** A variance is estimated from the design that produced the number it is quoted beside. Quoting the
unpaired SD of two independent arm means (6.47pp) against the paired SE of one dispatch (5.36pp) compares two
designs and reads the difference as a defect; this record made that comparison once and retracted it
(`AUDIT 34.192`, and the user guide's §31.3 carries the arithmetic). What the second dispatch is worth is the
check, and the check is cheap: $0.13 of off-peak inference against an interval every later reading is priced
with.

The two are not interchangeable levers: `n` shrinks both terms by `√n`, while `k` shrinks the per-arm term by
`√k` only to the extent trials are independent — which is the question `pass^k` exists to raise, not to answer.

### 8.25 A pool is run on fold records, and the composition is where the assumption lives

`crossFitPool` asks each fold for three things: its per-task outcomes, the half its store learned from, and the
treatment identity. Two of the three cannot exist on a reference arm — it learns nothing (`train: []`) and it
serves nothing (no unit, form, scope or knobs) — so a guard that demanded them twice refused every pair artefact
this lane had written (`AUDIT 34.191`). The pool is still right to refuse a fold that cannot state its learning
half; what changed is that the statement now comes from a **composition step** rather than from a guard's
assumption.

| step | reads | writes | refuses when |
| --- | --- | --- | --- |
| `pnpm eval:fold-records` | two pair artefacts | two fold records under `eval/results/folds/` | the folds do not tile, a fold evaluates a task it learned from, the two folds state different treatments, a ledger counts two rows for one task |
| `pnpm eval:cross-fit` | two fold records | `poc-cross-fit.json` | a fold states no learning half, two folds are two experiments, an id is evaluated twice |

The composition's central move is that **one fold's learning half is the other's evaluation half** — true only
because the two folds are one corpus read in opposite directions — so the tiling is verified before a record is
written: each fold learned exactly what the other answered, and no fold answered a task it learned from. The
half that was derived rather than read is named in the record's `derivation`, together with every treatment
field carried from the sibling, because a value that reaches a pool without its source is a value nobody can
audit.

The two-step shape is not ceremony. A pool that read pair artefacts directly would have to decide, per field,
whether silence meant "this arm has nothing to state" or "this artefact predates the field" — and both answers
produce a number. A separate composition step puts that decision in one file, prints what it decided, and lets
the pool keep refusing anything that arrives without it.

### 8.26 Allocation is a serving decision, and it belongs where the candidates are

A pack is a function of a store, a query and the options a dispatch fixed. §8.22 states that a treatment has three
axes — where a pack is served from, what unit it is written in, what may appear inside it — and every one of them
decides *whether* and *what*, never *how often*. R143's two folds added the missing quantity: renders per servable
item, 3.6 on a store that kept eleven items and 25.0 on a store that kept three, with the harm share following it
from 8.33% to 23.81%. A store that holds fewer items does not become conservative; the same one line per request
is simply the same record every time.

The mechanism that acts on it is a cap on renders per item, and its implementation is a statement about where the
decision belongs:

```
RecallQuery.exclude  →  EmbeddedMemory.search  →  skip before scoring  →  rank  →  pack
```

**Not** a filter over the returned pack. The difference is measurable in one request: with `limit: 2` and the
leader withheld, a post-filter returns one item and the search returns two, and only the second is the experiment
the cap is for — identical dose, different allocation. A post-filter is a dose change, and dose is an axis this
record has already priced (§8.11: the item count is not a knob, and a pack is not additive). The store also owns the normalisation: BM25 scores are divided by the pack's own
maximum, so a maximum left over an excluded item would deflate every remaining score and hand a margin gate a
contest the exclusion invented.

Three properties are asserted rather than assumed, because each is a way the mechanism could quietly become
something else:

| property | why it can go wrong |
| --- | --- |
| the pack keeps its size | a substitution that loses a slot is a dose change |
| the rendered block carries the substitute rule | a caller that re-rendered elsewhere would show a hole |
| an unknown id in the list is ignored, not fatal | the caller's list is state, and an item can retire between building it and sending it |

**The policy is part of the treatment, and its absence is the control.** The artefact carries the declared mode
beside the reading, the pair states it for both arms, and the pool compares it like `knobs`: two folds of one store,
one of which bounded how far each item travelled, are two experiments. The composition goes one step further than
the carry rule allows for other fields — it *refuses* a fold that states a policy beside one that is silent, because
everywhere else silence means "this artefact predates the field", and here silence means "this arm did not bound
anything". Carrying it would convert an unbounded fold into a bounded one on the strength of a header it never
carried, which is the mistake `AUDIT 34.191` records one layer up.

The cap itself is deliberately **not** part of the contract. `serveRotation: fair-share` names a policy and the
driver resolves `ceil(requests / servable)` from the store the run actually built, because a constant in a header
is a guess about a store that does not exist yet — and a guess that does not bind produces an arm that ran as its
own control. That failure is made visible rather than prevented: `maxRenders` beside `cap` in the artefact says
whether the bound was ever reached, and `starved` separates a rotation that spent the store from a store that had
nothing to say. A policy whose own reading cannot say whether it acted is the defect this record has repaired four
times at other layers.

**Two guards, and the one this round got past.** A field reaches an arm record through a spread, which TypeScript
exempts from the excess-property check: `Tau2Raw` is the type `PROJECTION` is exhaustive over, so a field the type
does not declare is a field no table has to decide about, and the compile-time guard never fires. The runtime guard
(`armRecordFromDriver` names every key without a decision, and the pair refuses such an arm) is the backstop that
caught it — one paid dispatch late. The rule that follows is not "be careful": it is that **a field emitted through
a spread has to be declared on `Tau2Raw` in the same edit**, because that declaration is what makes the table's
exhaustiveness mean anything.

The reading has its own version of the same trap, and it is the more dangerous one. The report is built from
`rotation.reading()`, a snapshot; taken beside the ledger it is taken before the loop, and the counter reads zero.
The block then describes a phase that served forty packs as one that served none, next to a log line that says
otherwise — and the artefact is the file that survives, so the disagreement resolves against the truth. The rule is
that a reading is read once, after the phase, and the same object feeds both the log line and the artefact. Two
reads of one ledger are two chances to disagree; one read cannot.

**And a third guard, inside the artefact.** The two above are about *writing* the field; neither can tell whether
what was written is true. So the pair now reconciles the declared reading against the pack ledger, which is the
same list the counter charged and is filed beside the block:

```
readRotationLedger(pack.ledger) → { requests, renders, distinct, maxRenders, emptyRequests }
reconcileServeRotation(block, pack.ledger) → { checked, unchecked, problems }
```

`l4-rotation-reconciles` blocks on any problem, and it names the fields it *cannot* reach instead of counting them
as agreement: `mode` is a policy no ledger holds, `cap` and `servable` come from the store, and `starved` shares
its evidence with "the store had nothing to say", so the ledger can only bound it from above. That asymmetry is the
point. A ledger can prove a count wrong; it can never prove a policy right — which is why a fold whose block went
missing cannot be repaired from its own files at any price, and why the reconciliation is a gate rather than a
repair tool.

**Instrument and policy are two decisions, and this round separated them.** The serving cap is a correct instrument
— it moves allocation, its ledger reconciles with its own report, and `maxRenders` equals the cap in every bounded
draw. It is not an established policy: at renders-per-item of 2.9 and 3.2 the harm share reads 5.88% and 20.59%, so
the quantity the cap controls does not determine the outcome, and one draw falls below R45's revert bar. The code
stays and its recommendation is withdrawn — a distinction worth stating in a section about allocation, because the
alternative (removing a working instrument because its policy failed) would delete the only quantity in this lane an
experimenter can set.

### 8.27 A gate is derived, so a wrong gate is repaired by re-grading rather than by re-measuring

Everything in §8.26 is about a field that has to be *written* correctly. A gate is a different kind of object: it
is a pure function of fields that are already in the artefact, so when its predicate is wrong the artefact is not
wrong — the row that grades it is. R152c's pair made that concrete in the worst direction, a false green:

```
V5-resolution          False (blocking)  minimum detectable 23.23pp …; claims -7.50pp …
l4-effect-resolved     True  (advisory)  the memory costs accuracy: -7.50pp
```

`l4-effect-resolved`'s criterion asked for `|delta| >= minimum detectable difference`; its predicate asked only
whether the verdict was not `UNRESOLVED`, and `HARM` is the **R45 cost bar** rather than a resolution test. `HARM`
fires on "significantly negative, or below −5pp with a served pack", which is satisfied by effects far smaller than
the sample can resolve. So the gate passed the one case its own sentence forbids, and it did so silently, because
an advisory row that is green is the row nobody reads.

The repair is one conjunction — the predicate became the criterion — plus the sentence for the case the old
predicate hid, and the second half is the structural one:

**The correction is applied to the evidence, not re-measured.** Re-running the pair would cost two dispatches and
answer a different question: a new draw of 40 tasks is not the same 40 tasks, so the numbers would move for reasons
that have nothing to do with the fix. `pair-regrade.ts` reads `verdict`, `comparison` and `protocol` out of the
committed file and recomputes only the `l4-*` rows, and it is written to refuse three things a rewriting tool must
never do — reformat the file it edits, default an input it could not read, and append a row the file's driver
could not have written. A re-grade that changes four lines of a 43 kB artefact is a diff a reader can check; one
that reindents it is a diff that hides the change inside itself.

**And the re-grade is a gate, not a chore.** `pnpm check` runs it over both committed pair artefacts, so the next
edit to `pair-gates.ts` that moves a row fails the build until the evidence is re-graded. That is
`l4-projection-complete` one level up: that gate says an arm's fields reached its artefact, and this one says the
artefact's rows are graded by the rule that ships. Two ways for a committed file to be true about itself, and the
cheaper of the two to check is the one nobody had.

### 8.28 A fold is a design, and its headroom is checkable before it is dispatched

The four sections above are about readings: what a field should carry, how a policy is reconciled against its own
ledger, how a claim is graded. This one is about the object all of them are taken on. A paired fold has two
numbers that bound what it can ever say, and only one of them was in the record:

- **resolution** — the smallest delta the fold can distinguish, `z·sqrt(d/n)` from the discordance `d` and the
  paired count `n`. Every artefact has carried this since R42.
- **headroom** — the largest delta the fold could produce at all, which is `1 − controlPass⁴` because a memory can
  only repair a trial the control already failed.

Headroom and resolution answer different questions and neither implies the other. A fold whose headroom is below
its resolution cannot certify an effect **at any store quality**: an oracle memory would produce a delta the design
is forbidden from reading, and `V5-resolution` would block it for claiming a resolution the sample cannot reach. On
the two committed folds that is exactly the situation — ceilings of 10.00pp and 14.86pp against resolutions of
18.53pp and 17.76pp — and on the two dispatches after them, 15.00pp against 15.66pp and 23.23pp.

**Why it was invisible.** The control's pass rate was recorded on every artefact as the treatment's comparison,
never as the design's ceiling. Reading it as a ceiling is a one-line subtraction, and the subtraction is the reason
four rounds of `UNRESOLVED` were attributed to the mechanism, the floor, the margin and the allocation before
anyone asked whether the fold could have shown an effect if it had one. The instrument is in `headroom.ts`, printed
by every pair, carried as `headroom` in the artefact, and re-runnable over any archived pair with
`pnpm eval:headroom`.

**What it selects.** With retail's observed discordance (0.275) and a control at 0.85, the fold size that clears
the 15pp ceiling is 164 pairs — which is retail's 114 plus airline's 50, and is why the next reading is pooled
across domains rather than a fifth draw of the same forty tasks. The arithmetic is available before the dispatch
for the price of the control's pass rate from any earlier fold of the same split, and that is the check a design
owes before it is bought.

**The trap it closes.** Significance and resolution part company at exactly this boundary. Six discordant pairs all
in one direction give `p = 0.0156`, so an oracle store would be significant, and its 95% interval on forty tasks
would be roughly [3, 27] — a sentence that establishes something happened on six tasks and nothing about its size.
A record that reported only the `p` value would have called that a success four times.

### 8.29 A delta over a corpus is a weighted average of two rates, and the weights are the corpus's

§8.28 established that a fold has a ceiling. This section is about the quantity taken on that fold — and the
argument is that the delta, as this record has been publishing it, is a **mixture** whose mixing weights nobody
wrote down.

A repair can only come from a trial the control failed; a break can only come from one it passed. So for a
failure share `f`, a repair rate `r` and a break rate `b`:

```
delta = f·r − (1−f)·b
```

That identity is exact, and it is the whole design problem. On τ² retail `f ≈ 0.14`, so the delta is 14% a large
positive number and 86% a smaller negative one. **The store repairs two thirds of the failures and breaks one in
six of the passes, and the delta is negative because passes outnumber failures five to one.** Four rounds of
reading that delta as a fact about a mechanism were reading a ratio of corpus composition.

| draw | trials | failed | repaired | passed | broken | repair rate | break rate | break-even | net |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `official` | 40 | 4 | 4 | 36 | 3 | 100.0% | 8.3% | 11.1% | +2.50pp |
| `swapped` | 74 | 11 | 7 | 63 | 15 | 63.6% | 23.8% | 11.1% | −10.81pp |
| R152 | 40 | 6 | 3 | 34 | 2 | 50.0% | 5.9% | 8.8% | +2.50pp |
| R152c | 40 | 6 | 4 | 34 | 7 | 66.7% | 20.6% | 11.8% | −7.50pp |
| pooled | 194 | 27 | 18 | 167 | 27 | **66.7%** | **16.2%** | **10.8%** | −4.64pp |

**The break-even is the number the harm side never had.** Setting the identity to zero gives `b* = r·f/(1−f)`, so
at this corpus's failure share the store has to keep its break rate under **10.8%** to pay for itself, and it is
at 16.2%. That is a target a content axis can be graded against, and unlike "the delta must be positive" it
separates the store's precision from the corpus's difficulty: the same store on a corpus with a 30% failure share
breaks even at 28%.

**Two populations, two denominators, and that is why the intervals differ.** The repair rate is estimated from 27
failures and the break rate from 167 passes, so their intervals are 34 and 11 points wide respectively — a rate
is only as precise as the population it is about, and averaging them into one delta destroys exactly the
information a reader needs to decide what to fix. Wilson intervals throughout (`reproduction.ts`'s, not a second
copy): at 4 of 6 the textbook interval reaches 104%, and a rate above 100% is a wrong number rather than a wide
one.

**The gate reconciles; it does not grade.** `serveYield`'s four counts must reconstruct the published delta to
0.005pp, because two blocks that disagree about one comparison mean one of them is lying and neither says which.
The gate deliberately does *not* fail on a store that is over its break-even: that is a measurement, and a build
that goes red on a negative measurement teaches its readers to skip the line — the same reason the resolution row
is advisory (§8.27) while the cost row blocks.

**And the inverse formula, which is what a bar owes before it fires.** `tasksForDelta` solves
`detectableDelta` for the sample instead of the effect: `n = z²·d/effect²`. At this lane's own discordance
(0.232) the `−5pp` revert rule needs **729 paired trials** to be resolvable, and the largest fold in the record
is 74. A bar priced in points and never in pairs is a rule that fires on readings the design cannot certify — and
the direction of that error is the expensive one, because it reverts on noise.

### 8.30 `pass^k` is a parameter of the comparison, so the artefact has to carry it

**The failure mode, precisely.** Two arms scored at `k = 1` and `k = 4` produce two deltas that are numbers of
the same name and different statistics. For a per-trial rate `p`, `pass^1 = p` and `pass^4 = p⁴`; nothing in a
pair's `deltaPp`, its interval or its task count distinguishes them. A record that compares a `k = 1` reading to
a `pass^4` bar is reporting a metric difference as a capability difference, and it is unfalsifiable from the
artefact — which is the definition of the defect class this architecture keeps naming.

**Why the field was missing.** The arm wrote `metrics.k`; the pair did not copy it; the pairing step handed the
protocol `trialCount: first.metrics?.k ?? 4`, and `trialCount` is read by no gate. Three files, one fact, and no
edge between them. The default of four is the worst part: it is a claim about a run nobody asked, and it made
the projection look complete while the level went unrecorded.

**The design that replaces it.**

| layer | what it states | what it refuses |
| --- | --- | --- |
| arm (`metrics.k`) | the level this arm was scored at | invents nothing: `trialsOf` reads `TAU_TRIALS`, the same variable the driver reads |
| arm bar block (`bar_k_matches`) | whether the bar and the arm share a statistic | does not withdraw the bar: `0` says *why* it was withheld, which `published_bar_applies: 0` could not |
| pair projection (`first.k`, `second.k`) | each arm's own statement | `null` for an artefact written before the field, never a default |
| pair protocol (`k`, `kAbsent`, `barK`, `barKMismatch`) | the level the pair shares and whether it is the bar's | `kAbsent` names the silent arm instead of leaving a hole |
| gate `l4-same-k` | both arms were scored by one statistic | is **absent** when an arm stated none — an omitted row, not a green one |
| `restatedAtBarK` | each headline at the bar's level | carries its independence assumption in the same block |

**The re-grader learned the same lesson one layer up.** `pair-regrade.ts` recomputes rows from the artefact it
is given, and two of the rows it used to recompute have evidence that is *not in that file*: the driver's field
census (`l4-projection-complete`) and the arm's serving policy against its pack ledger
(`l4-rotation-reconciles`). The first run over the two recovered draws turned R152's recorded
`l4-projection-complete: false` into `true`, because a pair artefact carries only the fields that arrived and a
recomputation can only confirm them. The repair is an **allow-list** of three rows whose every input is a field
of the file, a `preserved` list that names what was not re-graded and why, and a fourth rule: a row graded under a
`TAU_BAND` is preserved too, because the band came through the environment and survives only in the row's own
sentence (AUDIT 34.128). A block-list would have been wrong in the other direction — every row added later would
be recomputed by default.

**What the correction buys, in one line.** On the published fold the memory arm's `pass^1` of 0.925 is a
`pass^4` of 0.7321 under independence, against a bar of 0.575: +15.7pp rather than +35pp, and still positive. The
control's 0.85 restates to 0.522, which is *below* the bar — so the bare agent does not clear it and the memory
does. That is the first version of this comparison the record can defend, and it is a weaker claim than the one
it made for four rounds.

### 8.31 A rate has two prices, and the cheaper one is not the one a target needs

`b* = 10.78%` arrived as a level, and a level is certified by an interval rather than by a delta. That makes it a
different quantity from the `−5pp` bar the revert rule uses, and the difference is a factor of five in pairs:

| question | statistic | price on this corpus |
| --- | --- | --- |
| did the break rate **move** 16.17% → 10.78%? | McNemar on the delta, `tasksForDelta` | 170 pairs if the new breaks are nested in the old; 847 at the corpus's own discordance |
| is the break rate **below** 10.78%? | Wilson upper end on the control's passes | 592 passes ≈ 592 tasks at a true 8.08%; 149 at 5.39% |

**The property that makes the second price the binding one.** The upper end of a Wilson interval always sits
above the estimate, so a rate equal to its own bar is never certified below it, at any sample size. `certify.ts`
returns `null` there rather than a large number, and that `null` is the finding: **the target cannot be reached by
measuring the store again; it has to move.** `passesToCertify` is a bisection on `n` over the repository's one
Wilson interval rather than a closed form, because a second derivation of the same interval is a second answer to
one question — and it asserts nothing at runtime about monotonicity, since a branch no input reaches is dead code;
the suite checks the property over a 50 × 600 grid instead.

**Why the fold on the roadmap fails both tests.** The 164-pair composition (retail 114 + airline 50) is below the
*nested* price of 170, so the best case cannot buy the claim and the honest case is 847. The same arithmetic that
priced the `−5pp` bar at 729 pairs was available before that fold was budgeted; what was missing was applying it
to the target rather than to the bar.

### 8.32 Why the pay test lives one level above the ratio, and what a clustered interval costs

`exchange.ts` exists because `admission.ts`'s `clearance` answered a question nobody asked with a number
everybody quoted. This section is the design that replaces it, and the arithmetic that makes the replacement
forced rather than tasteful.

**The identity.** Net accuracy change is `repaired − broken`, so:

```
pays  ⇔  repaired ≥ broken  ⇔  helpPerHarm ≥ 1
      ⇔  repairRate·repairable ≥ breakRate·breakable
      ⇔  repairRate ≥ breakRate · (breakable / repairable)
      ⇔  repairRate ≥ breakRate · hurdle.
```

The last line is `requiredRepairRatePp`, which `admission.ts` has always computed correctly. So the hurdle is
already the bar in the rate form; `clearance = helpPerHarm / hurdle` divides by it a second time and lands on a
quantity that is neither the count ratio nor the rate ratio. There is no ambiguity about which of the two fields
is wrong: `requiredRepairRatePp` is derived from `breakRatePp` and `hurdle`, and `pays` is derived from the
counts, and on BIRD dev's lexicon arm they agree with each other and disagree with `clearance`.

**Why the verdict is computed from the delta and not from the ratio.** `l4-effect-resolved` gates on `|delta|`
against the fold's resolution, `V5-resolution` gates on the delta's interval, and the break-even target `b*` is
written in the delta's language. A second null test on `netOdds` would be a second rule for one question, and
the two would eventually disagree on a boundary. The ratio is still published, with its own interval, because
`b*` is quoted in exchange language and a reader checking `b < b*` needs the ratio to hand.

**The clustering is the finding, not a refinement.** These corpora are not collections of independent questions:

| corpus | questions | clusters | what the cluster is |
| --- | --- | --- | --- |
| BIRD train | 7,000 | 58 | one database: same schema, same values, same rules |
| BIRD dev | 1,534 | 11 | one database |
| BIRD mini-dev | 350 | 11 | one database |
| τ² retail, pooled | 194 | 114 | one task, re-run across the four draws |

An interval that resamples questions shrinks by roughly the square root of the cluster size — on BIRD dev that
is a factor of three — and turns `+0.72pp [−0.78, +2.39]` into a reading that looks like a win. The census
therefore resamples clusters, and the effective sample it reports (`clusters`) is the number a reader has to
believe, not `n`.

**One resampling loop.** `clusterBootstrapStatistic` takes rows, a cluster function and a statistic, and
`clusterBootstrapCI` is now that function with `mean` as its statistic — same draw order, same RNG, same
percentiles, so every interval already in this repository is unchanged to the last digit. The alternative was a
second loop for ratios, which would have been a second definition of the 2.5 / 97.5 convention in a repository
whose whole argument is that two copies of one quantity eventually disagree.

A ratio can be undefined on a resample — a draw with no breaks has no exchange rate — and those draws are
**dropped and counted** (`dropped`) rather than treated as zero. Dropping biases the interval toward the
draws with a denominator; the count is what makes that bias visible instead of silent.

**The gate.** `eval/results/poc-exchange-census.json` is committed, and `pnpm eval:exchange --check` fails when
the recomputation differs from it by a byte. The census is a pure function of five committed artefacts, so a
drift is a change in the evidence and is not allowed to pass as a change in the arithmetic.

### 8.33 Why the content axis is two functions and not one classifier

`pack-copy.ts` answers "is the pack about this case" with two mechanical readers, because the honest version of
that question splits into two that can each be computed from a committed artefact.

**Denial.** The unit is a construct, not a sentence. Prose mentions constructs in many roles — `a join between
two tables`, `the joined result`, `nothing was joined` — and only a negation *bound to* the construct states a
polarity. So `DENIAL_RULES` is a table of eleven patterns, each of which admits only connectives (`using`, `be`,
`wrapped in`, an article) between the cue and the construct. The construct is then looked for in
`constructsOf(goldSql)`, which reads `sqlShapeOf` and the shared tokeniser rather than the query's text, so a
construct named inside a string literal is not counted.

Two properties of that design are load-bearing:

- **The asymmetry is deliberate.** "The pack prescribes X and the gold does not do X" is not measurable this
  way, because a bare mention is not a prescription. The module computes the one direction English states
  unambiguously and says so, instead of inventing a second classifier for the other direction and reporting its
  error rate as a finding.
- **Warnings are a separate count, not a filter.** A sentence carrying a failure predicate ("does not measure",
  "inflates", "drops rows") tells the executor what *not to try*, and read as a prescription it inverts: the
  gold does the very thing the sentence warns against. `warn` therefore has its own column. On `bird-train` it is
  902 of 3,963 denials — 23% — which is a property of the store worth knowing on its own.

**Circulation.** `spreadOf` counts, for every delivered statement, how many *databases* received it, and a case's
boilerplate share is the fraction of its statements whose spread is at least two. The database is the unit
because cases in one database share a schema: a statement delivered twice inside `california_schools` is about a
schema those cases have, while the same statement in `hockey` and `student_loan` is about neither. The share is
`null` for a pack of no statements, and `circulationStratumOf` puts that `null` in `none` rather than in a fourth
stratum, because an empty pack has no composition to report and must not be scored as clean by default.

**The statistics reuse one loop.** Both readings stratify the same paired rows, so `carve` reports a stratum's
delta with `clusterBootstrapStatistic` over databases, and `carveGap` bootstraps the *corpus* — clusters drawn,
both strata recomputed in the draw, a draw losing either stratum dropped and counted. Resampling inside a
stratum would answer a different question, because the draws would be conditioned on a label derived from the
same rows.

**What it costs, and what it buys.** A lexical denial reader is roughly five-in-eight precise on a hand-audited
sample of eight: enough to reject a large effect, not enough to establish a small one. The census publishes the
denial count beside the hit count for that reason, and the round's conclusion is a rejection — the pack's
contradictions are 1.8% of cases and do not predict harm — rather than a positive finding.

### 8.34 Why attribution needs a fixed effect and a screen, not a correlation

`pack-attribution.ts` (R159) asks where a corpus-level loss lives. The naive answer — regress the outcome on
whether a statement was delivered — is wrong three times over, and each wrongness has a specific fix.

**Wrong once: the comparison crosses schemas.** The store delivers a statement where it looks relevant, and
relevance is mostly schema resemblance, so "received" and "did not receive" are two different populations of
database. The fix is a **fixed effect at the database**: `contrastOf` compares exposed against rest *inside* each
database and weights databases by exposed cases, so the estimate is the average effect on the treated and every
database is its own control. A database that cannot form both sides contributes nothing and is counted, because
"no comparison here" is not "no effect here".

**Wrong twice: accuracy carries difficulty.** The outcome is the **paired gain** — `correct` minus
`withoutMemoryCorrect` — so a statement delivered to hard questions is not blamed for them. This is what makes the
reading different from a stratum of accuracy, and it is why the artefact can compare a stratum at 41% accuracy
with one at 39% and say which is worse.

**Wrong three times: 210 hypotheses are 210 chances.** The screen is a table, and a table of 210 intervals at 95%
has about ten that exclude zero by construction. So `ledgerOf` publishes `resolved`, `expected` at
`screened × 0.05`, and `massAtRiskPp` — the sum over the resolved-negative statements of `|point| × cases /
corpus`, which is a **bound** on what dropping them could recover and not a prediction, because a case can carry
several at once.

**The estimator is one ratio of sums, so it gets one bootstrap.** For a database *d* with exposed count *n*,
exposed gain total *S*, and rest totals *N*, *T*, the weighted difference is `S − (n/(N−n))·T` over `n`, and the
arm's estimate is the sum of numerators over the sum of denominators. That is exactly the shape
`clusterBootstrapRatio` resamples: per-cluster totals, multiplicities drawn per cluster, the ratio recomputed from
the reweighted sums. The draws consume the same `mulberry32` stream in the same order as
`clusterBootstrapStatistic`, so the two produce the same bounds — asserted in a test that runs both — and the
screen of 210 statements costs 210 × 58 multiply-adds per resample instead of 210 × 7,000 row copies.

**The dose is a second estimator of the same thing, and it is deliberately reparameterised.** Fitting paired gain
on `(statements, unsupported, gold-constructs)` inside the same fixed effects gives the cost of one more statement
of any kind and the *extra* cost of one that names an unused construct. The alternative — `(unsupported,
supported)` — carries the same information in a basis where the contrast between the two coefficients is not a
coefficient, and a reader would have to difference two intervals to see the finding. `gold-constructs` is the
confound control: a simple gold is more likely to be contradicted, and without the control the reading would be
"the pack hurts easy questions" wearing the costume of "the pack prescribes machinery".

**The normal equations are accumulated per cluster.** Demeaning a cluster that a resample draws twice is the same
as demeaning it once, and both cross-products scale by the multiplicity, so a draw's coefficient is a two- or
three-dimensional solve over cluster totals rather than a pass over 7,000 rows. The equality with a naive refit is
asserted against a hand-written solver in the tests, not assumed.

**What the module refuses to compute.** A predictor that is constant inside every cluster has no slope and returns
`null`, not zero. A statement compared in fewer than five databases gets its point estimate — arithmetic is not an
inference — and no interval. `resamples: 0` returns the point and `null` intervals rather than a zero-width claim.

**The correction it publishes.** R158's all-boilerplate stratum (−0.94pp [−1.50, −0.40]) was a between-database
comparison wearing the vocabulary of a content effect. `circulationContrasts` re-estimates the same three strata
inside a database and gets −1.34pp [−3.58, +0.71]: the sign holds and the resolution does not. That is the second
time this record has had to withdraw one of its own intervals, and the module carries the withdrawal beside the
first estimate rather than instead of it.
