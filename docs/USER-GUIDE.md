# microglia — user guide

This guide takes you from an empty project to a loop that measurably improves, and then explains
every decision the library makes on your behalf. It is ordered by what you need first.

- [1. The five-minute integration](#1-the-five-minute-integration)
- [2. What the host owns, and what the library owns](#2-what-the-host-owns-and-what-the-library-owns)
- [3. The four calls, in the order a request makes them](#3-the-four-calls-in-the-order-a-request-makes-them)
- [4. Every feedback kind](#4-every-feedback-kind)
- [5. Trust: why your edit counts less than an execution result](#5-trust-why-your-edit-counts-less-than-an-execution-result)
- [6. The knowledge lifecycle](#6-the-knowledge-lifecycle)
- [7. Reading a pack](#7-reading-a-pack)
- [8. Distillation](#8-distillation)
- [9. Exporting a dataset](#9-exporting-a-dataset)
- [10. Operating it](#10-operating-it)
- [11. Failure modes and what they mean](#11-failure-modes-and-what-they-mean)
- [12. When the loop does not help](#12-when-the-loop-does-not-help)
- [13. Performance and limits](#13-performance-and-limits)
- [14. Recipes](#14-recipes)

---

## 1. The five-minute integration

```ts
import { openMicroglia } from '@agentix-e/microglia-core';
import { EmbeddedMemory, JsonlJournal } from '@agentix-e/microglia-core/memory';

const store = await EmbeddedMemory.open(new JsonlJournal({ dir: './.microglia' }));
const mg = await openMicroglia({
  app: 'my-app',
  namespace: 'tenant-42',      // the tenancy boundary; retrieval never crosses it
  store,
});
```

Four integration points, each a single call:

| Where you are in your request | Call | What it buys |
|---|---|---|
| Before you build the prompt | `mg.recall({ task, text, scope })` | the rules this workspace has already been taught |
| Before you call the model | `mg.begin({ task, input, pack })` | a run record that cites what it saw |
| When the answer is shown | `await run.complete(output)` | the output, persisted and diffable |
| When the user reacts | `run.edit(...)`, `run.rate(...)`, … | evidence, weighted by how it was produced |

Then, off the request path (a cron, a queue, or the end of a session):

```ts
await mg.distill();   // evidence → knowledge
```

If you do nothing else, this works. The rest of this guide is about doing it well.

## 2. What the host owns, and what the library owns

The split is deliberate and it is the reason the library stays small.

| The host owns | The library owns |
|---|---|
| The HITL surface: buttons, editors, diff views | Nothing visual at all |
| When a user is asked, and how often | Nothing about prompt timing |
| The model, the prompt skeleton, the retries | The knowledge block, and only the block |
| Persistence of its own domain data | Persistence of feedback, runs, and knowledge |
| Auth, tenancy assignment, PII policy | Redaction of known secret shapes, and the namespace boundary |

Two consequences worth internalising:

1. **The library never calls a model.** If you want free-text corrections turned into rules, you pass
   an interpreter that has your model client. There is a ready-made prompt builder and parser in
   `@agentix-e/microglia-core/distill`.
2. **The library never decides what a correction means in your domain.** That is a *domain pack* you
   own: an interpreter plus, optionally, a semantic edit distance. §15 shows how to write one in about
   eighty lines. The chart pack used by this repository's benchmark lives in
   `packages/eval/src/workload` — a benchmark has to own the workload it scores.

## 3. The four calls, in the order a request makes them

### 3.1 `recall` — before generation

```ts
const pack = await mg.recall({
  task: 'chart.recommend',
  text: question,                              // used for lexical ranking
  scope: { domain: 'sales', intent: 'trend' }, // used for filtering, and as an index
});
```

`scope` is not just a filter. A structured caller knows the intent and the domain even when the
question does not contain those words, so supplying it lets the pack include a rule that was widened
out of another domain — the rule no longer carries the token `sales`, but it still applies.

The result is a `KnowledgePack`:

| Field | Meaning |
|---|---|
| `items` | exactly the rules in the block, in order |
| `ids` | their ids; pass these back when you report an outcome |
| `rendered` | the text you put in the prompt |
| `tokens` | a character-based estimate (length / 4) |
| `hash` | digest of `rendered`, recorded in the run's provenance |
| `truncated` | how many candidates were dropped for the budget |
| `suppressed` | `'uncorroborated-store'` when a configured `corroborationFloor` silenced the pack; absent otherwise |

#### Where you put the pack matters more than what is in it

This library was measured on a public text-to-SQL benchmark across fifteen dispatches. The result is
uncomfortable and consistent: a pack placed **before** the first answer costs accuracy, whichever
form it takes, and the same pack placed **after a failure** costs nothing and gains nothing.

| What was injected | Where | Δ accuracy | runs |
|---|---|---|---|
| rules naming the case | before the answer | **−3.7pp** | 5, four significant |
| the same, cut to one item | before the answer | −3.1pp | 1 |
| an account of the failure ("what failed, why, what fixed it") | before the answer | **−5.2pp** | 2, both significant |
| the same knowledge as a procedure with no case in it | before the answer | −1.0pp | 3, not significant |
| any of the above | after a failed answer | **0.0pp** | 6, never a loss |

Two details decide the interpretation:

* **A pack that is not about the question does nothing at all.** Packs whose text named nothing the
  answer used left accuracy unchanged (74.6% with, 74.6% without). Only packs that named something
  the answer used moved it — downwards. The model does not weigh a retrieved record; it follows it.
* **The cost arrives with the first readable claim.** Below one item the pack is empty and the cost
  is zero; at one item it is about three points, and it grows with how much of a case the text
  describes.

So the integration that this evidence supports is:

```ts
// 1. No pack before the first attempt.
const first = await mg.recall({ task, text: question, scope });
if (await fails(first)) {
  // 2. Spend the pack only where an answer already failed, and key it by the failure.
  const retry = await mg.recall({ task, text: question, scope: { ...scope, reasonCode: code } });
  // 3. Show it, and let the failure — not the pack — set the agenda.
}
```

`reasonCode` is the one scope dimension a host should fill from its own classifier: it is what lets a
note about a failure be found by a failure. A host that leaves it empty is retrieving notes about
topics when what it has is a symptom.

#### Inject only what the question is about

A scope match is not a topical match. A rule filed under the same domain is returned even when the
question shares none of its words, and measured on a public benchmark, injecting those rules neither
helped nor hurt — they were simply paid for in tokens. Set a coverage floor when you want the pack to
earn its place:

```ts
const pack = await mg.recall({
  task: 'chart.recommend',
  text: question,
  scope: { domain: 'sales' },
  minCoverage: 0.01,           // the rule must mention at least one of the question's content words
});

if (pack.ids.length === 0) {
  // Nothing cleared the floor. Inject nothing: an empty pack renders as an empty string,
  // so your prompt does not claim that a convention exists when it does not.
}
```

#### What an empty scope means

**An absent scope dimension matches every request on that dimension.** A rule that declares `domain`
and no `intent` is returned for every intent; a rule that declares only its task is returned for every
question in that task. This is deliberate — a store written from a handful of corrections would
otherwise serve almost nothing — but it means two silences that look alike are not:

| what is missing | what it means | what to do |
| --- | --- | --- |
| a dimension on the **item** | the rule applies everywhere on it (wildcard) | write the dimension when your host knows it; `reasonCode` is the one a host should always fill |
| a dimension on the **query** | you did not say, so nothing is filtered on it | pass the scope you actually know; an empty query scope returns the widest pack |
| an item's `polarity` | **unclassified**, never `pass` | nothing — a reader counts it rather than guessing |

The middle row is where packs get expensive: `recall` cannot tell "this rule applies to every intent"
from "the host did not say which intent this request has", and both produce the same pack. If you want a
pack that earns its tokens, set `minCoverage` (above) or fill the scope you have.

A rule with **neither** a declared dimension nor a `when` condition is a *universal rule* — it applies
everywhere and to everything. `universalityCensus` counts them from a store artefact at no cost, and if
your store is mostly universal rules, the gate you want is `minEvidence`, not more memory.

#### Inject only what has been seen more than once

The third gate is corroboration, and it is the one that decides whether a pack is worth having at all on
a workload where every correction is unique. A rule with one observation is a hypothesis; `minEvidence`
lets you refuse to inject hypotheses:

```ts
const pack = await mg.recall({
  task: 'chart.recommend',
  text: question,
  scope: { domain: 'sales' },
  minEvidence: 2,              // at least two independent corrections behind the rule
});
```

Measured on the two workloads this repository runs:

| Workload | Floor 1 (default) | Floor 2 |
|---|---|---|
| chart study, six recurring defect families | 100.00% (+68.21pp) | **96.43% (+64.64pp)** |
| BIRD Mini-Dev, 350 questions, every correction unique | 50-52% (**−2 to −4pp**) | **0 rules injected, −0.29pp** |

So the floor costs 3.57pp of a 68.21pp lift where mistakes recur, and removes a 2-4pp loss where they do
not. If you do not know which world you are in, compare `evidence.length` on your own store: a corpus
where every rule has exactly one observation is a corpus where the pack cannot be corroborated, and the
honest configuration there is `minEvidence: 2` — which will inject nothing.

#### And switch the pack off when the workspace never repeats itself

`minEvidence: 2` is a decision you make per call. `corroborationFloor` makes it automatic for a store that
cannot possibly satisfy it — the case the measurements keep landing on:

```ts
const mg = await openMicroglia({
  app: 'reports',
  namespace: 'acme',
  store,
  corroborationFloor: 0.05,    // silence the pack if under 5% of active rules were seen twice
});

const pack = await mg.recall({ task: 'chart.recommend', text: question });
if (pack.suppressed === 'uncorroborated-store') {
  // Not "nothing matched": this workspace has no corroborated rule, so the pack was
  // silenced deliberately. Log it as a workspace property, not as a retrieval failure.
}
```

The share is computed once per knowledge version (distillation, curation, feedback and erasure invalidate
it) and costs one pass over the store, no model call. Default: off — an empty pack because of a policy is
worse than a full one when the policy is wrong about your workload.

`minCoverage` is absolute rather than relative — BM25 scores are only comparable inside one query, so
a threshold on them cannot answer "is this rule about this question". Coverage can: it is the share of
the question's content words (stopwords removed) that the rule mentions.

Start at `0.01`, which means "at least one shared content word", and measure before raising it. On BIRD
Mini-Dev the median pack covered 7.1% of its question and 47% of packs covered none of it, so a floor
of `0.34` injected nothing at all on 352 questions. A floor of `0.15` keeps roughly the strongest
quarter of packs.

#### Or serve every admitted rule, when you are reproducing a published protocol

Every knob above narrows the pack. They can also be opened, and there is one honest reason to open
all of them: you are comparing against a published baseline whose memory protocol is *inject
everything it ever admitted, every turn*, and you want the same request the authors ran rather than
a better one. Four knobs do it:

```ts
const pack = await mg.recall({
  task: 'chart.recommend',
  text: question,
  scope: { domain: 'sales' },
  anchoring: 'scope',   // a scope-matched rule needs no word in common with the question
  minCoverage: 0,       // no lexical gate at all
  limit: 999,           // no item cap that a store of tens can reach
  budget: 200_000,      // no character cap it can reach; `budget` is characters, not tokens
});
```

| knob | what it decides | what it costs to open |
| --- | --- | --- |
| `anchoring: 'scope'` | whether a rule filed under your scope is a candidate when the question shares none of its words | rules that generalised out of the domain stay reachable — and so does everything else in it |
| `minCoverage: 0` | the share of the question's content words the rule must mention | packs whose text is unrelated to the request, paid for in tokens |
| `limit` | how many rules may survive ranking | a plan-shaped prompt, and a prefix the provider may cache |
| `budget` | how many characters the rendered block may spend | the same, priced per turn |

Two properties of this configuration are worth knowing before you adopt it. **It is not a
recommendation**: every lift this repository has measured came from the narrowing knobs above, and
an open pack spends tokens on rules the request does not mention — measured on a public benchmark,
those rules neither helped nor hurt, which is a cost with no benefit rather than a harm, and it is
the reason `minCoverage` exists at all. **It is not free per turn**: the block is rendered on every
call, but an unchanged block is a prompt-cache hit, so the cost of a large prefix is dominated by
the first call of a session rather than by the hundredth.

If what you want is reproducibility rather than a comparison, keep the defaults. Open these four
only when the number you are reproducing was produced under a protocol that injects everything,
and say so beside the number — a pack of 1.4 rules and a prefix of 292 answer two different
questions about the same mechanism.

#### Serve one line per routine instead of one per failure

Everything above tunes *which* items a pack carries. This one tunes what an item **is**, and it is the
only knob in this guide that changes the unit rather than the selection.

A store built from failures records one item per failure. If three different tasks failed the same way —
same tools, same order, different order ids — that store holds three items whose statements share no
literal token, because the dedupe key is the normalized statement and the entity is the only thing that
differs. The recurrence is real and the store cannot say so.

```ts
const mg = await openMicroglia({
  app: 'support',
  namespace: 'acme',
  store,
  // How to recognise a routine in *your* records. Return undefined for a record that states none:
  // it is then its own unit, which is the honest reading of a record that names no routine.
  shapeOf: (item) => {
    const line = item.statement.split('\n').find((entry) => entry.startsWith('A: '));
    return line === undefined ? undefined : line.slice(3).split('; ').map((c) => c.split('(')[0]).join(' > ');
  },
});

const pack = await mg.recall({
  task: 'support.act',
  text: request,
  shape: 'collapse',        // one line per routine; absent means 'per-failure'
});

pack.fold;
// { folded: 6, groups: [{ shape: 'get_order > exchange_item', kept: 'k_…', members: ['k_…','k_…'], support: 3 }],
//   refused: 0, support: { max: 3, atLeastTwo: 5, atLeastThree: 1 } }
```

Three rules make the fold predictable, and each one is a refusal rather than a heuristic:

- **A group folds only when two distinct tasks taught it.** Folding two records of one task produces no
  support; it produces a task that looks like it was taught twice. Groups that fell short are counted
  (`refused`) rather than silently kept apart.
- **The survivor is the group's medoid and its sentence is copied.** Containment over content terms
  decides which member the others restate; ties go to the earliest-ranked one. Nothing is rewritten — a
  merge that paraphrases is the operation measured to lose 9.6 points elsewhere.
- **Nothing else about the item changes.** The union of the group's evidence is *reported*, not written
  back onto the survivor, so every id in the pack still joins to a record your ledger holds.

Measured offline on the 32-task retail corpus in this repository's fixtures (`pnpm eval:pack-shape`):
32 records collapse to 26 units (18.75% folded), the whole store costs **82.9%** of its per-failure
characters, and five units carry support ≥2 with one at 3. At a 2,400-character budget both units serve
**five** items — so the fold does not buy more rules, it makes the same slots carry corroboration. That
is the honest expectation to hold: if your store's items are already one-per-routine, or every routine
was taught once, `shape: 'collapse'` changes nothing and `pack.fold.folded` will say so.

#### Compare the two units in one run

`shape` is a per-request option, which is what makes a controlled comparison possible at all: two
dispatches of the same configuration distil two stores — a correction is written by the model at run
time, so the second run's store is not the first's — and two stores cannot be paired by any statistic.
One process can, however, build two packs from one store. The driver does exactly that when a
pre-registration declares `facadeShapes: two-unit`: two recall facades, one store, one floor, one
budget, one seed stream, and only the unit differing.

If you are wiring this yourself, the shape of it is:

```ts
const [asFailures, asRoutines] = await Promise.all([
  mg.recall({ task, text, shape: 'per-failure' }),
  mg.recall({ task, text, shape: 'collapse' }),
]);
```

Two things to check before you believe any difference between them:

- **Containment.** On any request the budget did not cut, the `collapse` pack's ids must be a subset of
  the `per-failure` pack's, and the two sizes must differ by exactly `asRoutines.fold.folded`. If they
  do not, the two packs came from different selections — a different store, a different query, a
  different floor — and the comparison is between two experiments rather than two units.
- **That the fold fired.** `asRoutines.fold.folded > 0` on some request. A run where it stayed at zero
  compared one unit with itself, and the honest reading is "this store has no recurrence to collapse",
  not "the unit does not matter".

The characters each pack cost are the second half of the reading, and they are worth printing next to
the score: `rendered.length` per request. On the 32-task corpus in this repository the folded store is
**82.9%** of the per-failure store's characters, and at a 2,400-character budget both serve the same
number of lines — so the fold's claim is corroboration per slot, not more slots.

### 3.2 Tasks and attempts — when one answer is not the whole job

A run is one generation. A task is what the user was trying to finish, and it
often takes several generations: the first answer was wrong, the second was
edited, the third was accepted. Opening a task is optional, and it is the
difference between learning from adjacent edits and learning from "the third
rewrite of attempt two was accepted".

```ts
const task = mg.openTask({
  taskId: 'job-4711',          // yours, stable across attempts
  taskType: 'chart.recommend', // the workflow step, in your vocabulary
  sessionId: 'conv-88',        // optional
});

const first = task.begin({ attempt: 1, input: { question } });
await first.complete(badSpec);

const second = task.begin({
  attempt: 2,
  parentRunId: first.id,       // the attempt this one revises
  input: { question },
});
await second.complete(betterSpec);

const record = await task.complete({ status: 'accepted', finalRunId: second.id });
// { taskId, taskType, attempts: 2, status: 'accepted', finalRunId, closedAt }
```

Three rules, enforced rather than documented:

| Rule | Error |
|---|---|
| An attempt number is used once, in order (1, 2, 3 — no reuse, no skip) | `MG_E_TASK_CONFLICT` |
| A terminal decision happens once | `MG_E_TASK_CLOSED` |
| The decision judges an attempt that produced an output | `MG_E_NO_OUTPUT` |

**Why this matters more than bookkeeping.** Evidence is counted per task, not per event. Six attempts
of one task by one user are one observation; six tasks are six. Without that rule a single persistent
user can clear the activation threshold alone — which is exactly what the previous release allowed.
Opening tasks is how the library can tell the difference; if you never open one, each run is treated as
its own task and the behaviour is unchanged.

`task.complete` writes the decision as an `outcome` event on the final attempt, so `distill()` sees it
like any other signal. Acceptance is positive evidence for whatever that attempt cited; `abandoned` and
`escalated` are not, and `reasonCode` is preserved when you supply one.

#### A recall can name the attempt it is for

If you distil between attempts — the store learns from attempt 1 before attempt 2 starts — then attempt 2
must not read what attempt 2 just taught. That is not a ranking question, so no knob on the pack can
answer it; the filter has to be on the claim's provenance:

```ts
// attempt 1 fails, you distil, then attempt 2 recalls:
const pack = await mg.recall({
  task: 'retail.exchange',
  text: question,
  before: 2,                   // only claims from attempts strictly earlier than 2
});
```

The rule is `before`, and it reads the attempt recorded on each claim's evidence. Three things it
deliberately does not do:

| you ask | what is served | why |
|---|---|---|
| nothing (`before` absent) | every claim, as before | the store was frozen before the run; there is nothing to leak, and an upgrade must not change what a published number measured |
| `before: 1` and a claim was distilled offline | that claim | an offline claim predates the episode — it learned from no attempt, so every attempt may read it |
| `before: 2` and a claim cites attempts 1 and 3 | nothing | the unit a pack serves is the claim, so one later observation withholds it |

`/v1/recall?before=<n>` is the same filter over HTTP, and a negative value is refused rather than read as
"no watermark": it would match everything and present itself as a store that taught nothing. Nothing
writes `trial` for you yet — an offline `distill()` records no attempt, which is why the offline arms are
unaffected — so a host that writes mid-run is the one that sets it.

### 3.3 `begin` — the run record

```ts
const run = mg.begin({
  task: 'chart.recommend',
  input: { question, domain, intent, field },
  pack,
  model: 'deepseek-chat',
  promptVersion: 'p7',
  appVersion: '1.4.0',
  domainPack: 'nl2charts',
  schemaDigest: 'sha256:…',
  metadata: { traceId },
});
```

Everything you pass here lands in `RunRecord.provenance`, so a later "why did it do that?" is a
lookup, not an investigation. `pack.ids` become `provenance.knowledgeIds`; that list is what credit
assignment will later update.

### 3.4 `complete` — the output

```ts
await run.complete(spec);          // spec must be plain JSON
```

`complete` rejects anything that cannot survive `JSON.stringify`/`parse`, because a run record that
cannot be diffed cannot be corrected. It is idempotent by rejection: a second call throws
`MG_E_RUN_COMMITTED` rather than silently overwriting.

### 3.5 Feedback — see the next section

## 4. Every feedback kind

```ts
await run.rate('down', ['wrong_chart_type']);                  // rating
await run.edit(correctedSpec, { note: 'we use lines for trends' }); // edit
await run.feedback({ type: 'preference', chosenRunId: a, rejectedRunId: b, criterion: 'accuracy' });
await run.clarify('what counts as active?', 'logged in within 30 days');
await run.outcome(false, 'SQLITE_ERROR');                      // execution result
await run.abstain('user closed the panel');                    // no signal
```

| Kind | The user did | Base trust | Why that number |
|---|---|---|---|
| `outcome` | ran it; it failed (or worked) | **0.95** | measured, not judged |
| `clarification` | answered a disambiguating question | **0.85** | an explicit statement of intent |
| `preference` | chose one of two answers | **0.70** | comparative, but unverified |
| `rating` with reasons | clicked down and said why | **0.60** | a claim about a category |
| `edit` | rewrote the output | **0.50–0.90** | scales with how much changed |
| `rating` bare | clicked down | **0.45** | often a mood, not a diagnosis |
| `abstain` | dismissed without judging | **0.40** | recorded, never credited |

The edit range is the interesting one. Trust is `0.5 + 0.4 × distance`, where `distance` is the share
of the document that changed, so a formatting fix does not carry the authority of a rewrite. A domain
pack can supply a semantic distance instead — for charts, changing `bar` to `line` is one field of
four but a different chart, and `chartEditDistance` reports `1.0` for it.

> **If your corrections are structured, supply `editSemantics`.** Without it, a one-field change
> scores 0.125, lands at trust 0.55, and will never clear the admission gate alone. Your store will
> fill with candidates and teach nothing. This is the single most common integration mistake.

### 4.1 Correcting a trust assumption

Some feedback arrives through a channel you trust less — a CSV import, a third-party annotation tool,
an LLM judge. Cap it:

```ts
await run.edit(after, { trustCeiling: 0.2, actor: { type: 'external', idHash } });
```

A ceiling of 0.2 sends the resulting knowledge to quarantine: it is stored, visible in `doctor()`,
and never injected. Nothing is lost, and nothing is trusted.

### 4.2 `curate` — merge duplicates, retire what is useless

```ts
const report = await mg.curate({ dryRun: true });
// { scanned: 214, merged: 31, pruned: 0, overCap: 0, cappedTasks: 0, dryRun: true }
```

Curation does two things and refuses to guess about a third:

| Action | Default | Why |
|---|---|---|
| Merge near-duplicates (same kind and scope, statement similarity ≥ 0.85) | on | One rule accumulates several phrasings; keeping all of them spends tokens on the same sentence |
| Retire the lowest-utility items above a per-task cap | **off** | A rule with no observed outcome is unmeasured, not useless. Pass `prune: true` and a `maxItemsPerTask` to enable it |
| Rewrite everything in one pass | never | Summarising the store is how a playbook collapses; a merge keeps one survivor and closes the others with a pointer |

A merged or pruned item is not deleted: it becomes `retired` with `statusReason` `merged:<id>` or
`pruned:low-utility`, and its `validUntil` is set, so a question about the past can still find it.

**What "utility" means.** Every outcome that lands on a run citing an item increments that item's
`utility.injected`, and `flippedUp` / `flippedDown` record which way it went. `curate` ranks by density
`(flippedUp + 1) / (injected + 2)` — Laplace-smoothed so that an unmeasured rule sits at 0.5 rather than
at zero, and only a population of measured rules can push one out.

### 4.3 Wiring it together

```
recall → begin → complete → feedback → distill → curate
```

`curate` is cheap and deterministic: same store, same options, same decision. Run it after `distill`, or
on a schedule your host controls — the library starts no timers.

## 5. Trust: why your edit counts less than an execution result

Trust is derived from the *signal*, never from the person. A host cannot make every click
authoritative by passing a different actor id, and a tenant cannot promote its own claims.

Trust flows into confidence:

```
logOdds  = logit(0.5) + Σ(evidence.weight × logit(trust)) − contradictions × penalty
confidence = sigmoid(logOdds) × (0.55 + 0.45 × smoothedSuccessRate) × validityDecay
```

Three things follow, and each is a product decision:

1. **One strong observation is enough; several weak ones are equivalent.** A single 0.95 execution
   result clears admission; two bare thumbs-down do not.
2. **Success rate matters as much as support.** A rule cited ten times and wrong four times loses to
   a rule cited three times and never wrong.
3. **Time matters.** A rule whose `validUntil` has passed decays with a 30-day half-life, floored at
   0.2 so fresh evidence can revive it rather than being locked out forever.

Thresholds (`Policy`, all overridable):

| Knob | Default | Effect |
|---|---|---|
| `activationThreshold` | 0.60 | confidence needed to inject |
| `retirementThreshold` | 0.45 | confidence below which an active rule retires |
| `minSupport` | 0.80 | summed evidence weight needed |
| `quarantineBelowTrust` | 0.35 | trust below which evidence is held for review |
| `maxContradictions` | 1 | contradictions tolerated before `conflicted` |
| `minApplicationsForRetirement` | 3 | cited-and-failed count before forced retirement |
| `defaultBudget` | 1200 | characters of knowledge per pack |

### 5.1 Provenance tiers: why prose cannot promote itself

Every signal carries a shape, and the shape decides how far its lesson may travel:

| Tier | Comes from | May activate a rule alone? |
|---|---|---|
| `user-text` | a rating, a clarification, a preference, an abstention | **no** — stored, counted as evidence, not injected |
| `structured-edit` | an edited output | yes |
| `outcome` | an observed result (accepted, executed, failed) | yes |
| `host-asserted` | reserved for a host that declares its own authority | yes |

A `user-text` item stays a `candidate` with `statusReason: needs-corroboration` until a **second distinct
task** says the same thing, or evidence of a stronger tier arrives on the same claim. The gate is what
separates hearing someone from believing them: text is the one tier an articulate user can write, and a
store that cannot tell prose from a measurement is a store where the loudest voice wins. `tier` is set from
the event kind, so a host does not configure it; an item written before this field existed has no tier and
keeps the old behaviour.

```ts
// One clarification: stored, visible in doctor(), never injected.
await run.clarify('what does revenue mean here', 'net revenue, excluding tax');
await mg.distill();     // item.tier === 'user-text', status === 'candidate'

// A second task says the same: promoted.
```

### 5.2 `abstain` — the one lesson that stops a model inventing an answer

```ts
await run.abstain('the source has no revenue column');
```

An abstention is knowledge of a different shape: it says *there is nothing here*. It is stored as
`kind: 'abstention'` with the reason in its payload, and it is rendered in **its own block with its own
instruction** — a negation inside a block of positive rules is read as a positive rule.

Two rules govern when it speaks, and both exist because the failure is asymmetric:

| Rule | Why |
|---|---|
| It only speaks when **no positive rule clears the activation threshold** | A pack carrying both "here is the convention" and "there is no answer" is a contradiction the model resolves by answering |
| It needs a **second distinct task** before it activates | A false abstention makes the product refuse to answer, so it is promoted like any other `user-text` lesson |

The trust of an abstention is 0.8, not the 0.4 it used to be: at 0.4 the lesson could never clear admission,
so the workspace could not learn to say "I don't know" — which is the one thing a memory that suppresses
hallucination must be able to learn.

### 5.3 What a poisoned correction can do

A memory that learns from corrections can be taught a wrong one. MemForm (2026) names five ways to
corrupt a memory **without planting a false record**, and all five are executable against this store:

| Route | What the attacker does | What stops it |
|---|---|---|
| content | states the wrong rule, once or repeatedly | trust-weighted fusion: three tasks at trust 0.6 reach 0.48 confidence, below the 0.6 line; below the quarantine floor the claim is not even stored as knowledge |
| evidence | cites *someone else's* correction as its own support | a candidate must cite the event that produced it; a mismatched citation is rejected and counted (`rejectedBorrowed`) |
| scope | submits the same claim in two other domains so it is widened and then applies everywhere | widening needs three **admitted** endorsers and only drops a dimension every endorser leaves open |
| selection | paraphrases an existing rule with a different payload, hoping a merge hands it the original's evidence | a merge requires the same payload: same words with a different rule is a contradiction, not a duplicate |
| path | lets a contradiction arrive last, so the store resolves it in their favour | only a claim at trust ≥ 0.7 may contradict at all |

Measured (POC-29: 5 routes × 100 attempts × 3 channel-trust ceilings, 500 attacks, no model calls):

| Channel trust | Attack success | Reading |
|---|---|---|
| 0.3 (unverified: imported text, a tool output) | **0%** | below the quarantine floor |
| 0.6 (a corroboration-band channel) | **0%** | fusion cannot reach the activation line, and the formation routes are closed |
| 0.9 (a trusted editor) | **40%** | content and path only — see the limit below |

**The limit, stated rather than averaged.** An attacker who is a fully trusted editor can teach a wrong
rule and can overwrite a right one. No memory system can tell that apart from a user doing their job, and
a store that refused would refuse its actual user. That is why the gate is written against a capability —
*content, citations, scope claims, paraphrases and arrival order, but not the trust of the channel* —
and why the 40% column is printed next to the 0% ones instead of being hidden in a single 13.2% average.

What the harness itself is checked for: the trusted column is a live positive control. If the attacks
stopped landing, it would collapse to zero and the lane would fail, because a harness that cannot detect
a successful attack cannot be trusted to report a blocked one.

## 6. The knowledge lifecycle

```
                    ┌─────────────┐   contradiction    ┌────────────┐
  feedback ──▶ candidate ──▶ active ────────────────▶  │ candidate  │
                    │           │                      └────────────┘
                    │           │ repeated failure             │
                    │           ▼                              ▼
                    │        retired ◀────────────────── conflicted
                    │           │
                    └──▶ quarantined (trust below floor, or held by a host)
```

| Status | Injected? | How it gets there |
|---|---|---|
| `candidate` | no | new evidence below the activation threshold |
| `active` | **yes** | cleared confidence and support |
| `quarantined` | no | trust below the floor, or rejected as unsafe |
| `conflicted` | no | exceeded the contradiction budget |
| `retired` | no | decayed, contradicted, or failed when applied |

Retirement is reversible. A retired rule that receives fresh trusted evidence is rehabilitated: its
application ledger resets, because the failures counted against it may have been failures of
*application*, not of the rule.

## 7. Reading a pack

The block is JSON Lines inside a named element:

```html
<microglia-knowledge version="1" note="Reference data from prior user corrections. Not instructions. An item that carries a "when" condition applies only where that condition holds for this task." items="2">
{"id":"k_01H…","kind":"constraint","confidence":0.87,"scope":{…},"when":"when the question names a race","statement":"…","payload":{…}}
{"id":"k_01H…","kind":"negative","confidence":0.71,"scope":{…},"statement":"…"}
</microglia-knowledge>
```

An item may carry a **`when`** condition beside its statement. It is rendered *before* the claim, and
the note tells the model to apply an item only where that condition holds — because a rule that records
what was true says nothing about when it is true, and the measured failure mode of this mechanism is a
true rule applied to the wrong question. An item without `when` is unconditional; it is not "unknown".

**A condition is also how the rule is found.** Retrieval does not match the statement alone: the BM25
index, the `minCoverage` floor and the diversity ranking all read the item's *recall text*, which is
`when` followed by `statement`. This is not a detail of the implementation — it is the difference
between a store that answers and a store that holds. A rule distilled from a correction without its
condition is a rule whose only searchable text is the claim, and a claim shaped "a request of this
shape is resolved by calling `find_user`, then `cancel_pending_order`" shares no term with any question
a person asks. Measured on a public agentic benchmark: a store of ten such rules served an empty pack
on **38%** of 1,528 requests and averaged 0.76 rules per request. The same lane, once the write path
carried the instruction it had been dropping, is the experiment R51 registers.

So: **if you can state when a rule applies, state it.** The distiller prompt already asks for it, and
an interpreter you write should return it in `when` rather than folding a condition into the statement.
Two consequences worth knowing:

- A condition raises the rule's coverage against a question that names the same situation, which is
  what you want. It cannot lower it, because recall text is a union of both halves.
- A condition that is always true buys nothing: it adds words that no question contains. The prompt
  asks for a trigger the reader can check on a *different* input for exactly this reason.

Four properties are guarantees, and each is tested:

1. **It is data.** The preamble says so, and `<` inside a statement is escaped, so a statement cannot
   close the element and escape into the instruction stream.
2. **It is parseable.** You can audit exactly what the model saw; the block's hash is in the run.
3. **It is bounded.** `rendered.length ≤ budget` always, under the default `budgetBasis:
   'note-included'`. If the budget cannot fit even the wrapper, the block is empty rather than
   over-budget. See "Choosing the note" below for the one setting that changes what "bounded" covers.
4. **`items` matches `ids` matches the block.** A pack never lists a rule it did not render.

Prompt placement: put the block **after** the task instructions and **before** the user's question,
and never inside a system prompt you also use for tool definitions. The model should read it as
reference data about the workspace, not as a rule set it must obey.

### Choosing the note

The sentence the block opens with is an option, and it has three levels:

| Level | What it says | When to use it |
|---|---|---|
| `standard` (default) | reference data, apply an item only where its condition holds | always, unless you are measuring the others |
| `hardened` | the above, plus: a recalled rule may describe a situation this request is not; where the rule and the observation disagree, the observation is the evidence | a store you suspect is over-applied — a correct rule anchoring the model to a frame that no longer fits |
| `none` | no sentence at all | the control arm of an experiment, never a deployment |

You can set it per host (`openMicroglia({ note })`) or per request, which is what makes it testable
against your own traffic without redeploying anything:

```ts
// The host's level, unless this request says otherwise.
const pack = await mg.recall({ task, text, note: 'hardened' });
```

An abstention block keeps its own sentence at every level, because that sentence says the opposite
thing — there is nothing to apply, so do not invent one — and removing it would invert the block
rather than vary the experiment.

**`budgetBasis` decides whether the note is paid for out of the rules' allowance.** Under the default
`'note-included'` the wrapper is charged to `budget`, note and all. Under `'note-excluded'` the budget
covers the block's data — the rules and the wrapper — counting the note as if it were empty, so the
sentence cannot displace a rule:

```ts
const mg = await openMicroglia({ app, namespace, store, budget: 1200, budgetBasis: 'note-excluded' });
```

Use `'note-excluded'` if you are comparing levels of the note: at a fixed budget the hardened sentence
is about 110 characters longer than the standard one, and under the default accounting it buys that
room by dropping your last rule. The rendered block may then exceed `budget` by the note's length —
`tokens` reports the whole block, so your cost accounting stays honest. The default is unchanged
because the two accountings produce different packs, and a library upgrade must not silently change
what a stored measurement meant.

## 8. Distillation

```ts
const report = await mg.distill({ since, limit, generalize: true, resolveContradictions: true });
```

| Field | Meaning |
|---|---|
| `events` | feedback events read this run |
| `candidates` | claims the interpreter proposed |
| `created` / `merged` / `generalized` | new rules / evidence added to an existing rule / widened |
| `superseded` | rules retired because a wider rule replaced them |
| `contradicted` | active rules demoted by a conflicting claim |
| `quarantined` | stored but not injected |
| `rejectedUnsafe` | dropped by the injection screen |
| `failed` | events whose interpreter threw (a model returning prose, a parser rejection) |
| `conditionConflicts` | claims that named a `when` condition the stored rule already had, and a different one — the stored one is kept, so this count is where a second description of the same scope is visible |
| `suppressed` | writes refused because the rule was already stored under other words (only non-zero with `admission` on) |
| `rephrased` | claims merged into a rule another task had already stated — a subset of `merged` |

An interpreter that throws is counted and skipped rather than aborting the batch: one unparseable
model response should not discard the other two hundred lessons. Pass `strict: true` if you want the
opposite — a batch that stops on the first bad response.

Two interpreters ship:

```ts
import { ruleInterpreter, combineInterpreters, createLlmInterpreter } from '@agentix-e/microglia-core/distill';

// Deterministic: ratings and clarifications become lessons with no model call.
combineInterpreters(myDomainInterpreter, ruleInterpreter)

// Free text: your model turns a comment into a typed claim.
createLlmInterpreter({
  llm: { complete: (prompt) => myModel(prompt) },
  taxonomy: ['trend', 'comparison', 'composition'],
  payloadHint: '{"when":{"intent":"trend"},"then":{"mark":"line"}}',
})
```

A claim distilled by a model **inherits the trust of the event it came from**, not a model-wide floor:
a lesson learned from an execution-verified correction (0.95) outranks one learned from a bare
thumbs-down (0.45), because the evidence behind them differs. Without that inheritance an LLM-derived
claim starts below the admission gate and can only ever be activated by corroboration.

`payloadHint` is not cosmetic. Without a literal example of your payload shape, a model writes a
plausible sentence and an empty payload; measured accuracy was **0% correct payloads with 100%
correct statements** until the hint was added, and 96% after.

### 8.1 Generalisation

A claim learned in `sales` that recurs in `hr` with the same payload is widened to a domain-free rule
and its siblings are retired. This is what makes an unseen domain improve: in the study, the domain
that received no feedback at all reached **100%** with generalisation and **32.86%** without it.

Widening is the one operation that *destroys* precision, so it is bounded twice.

**By construction.** The widened scope is the meet of the endorsing scopes: a dimension survives only
when every endorser constrains it identically. `domain` is the only dimension that may disappear.

| Endorsers agree on | Result |
|---|---|
| `intent: trend` in both | `intent: trend` survives — the rule is still about trends |
| `intent: trend` vs `intent: comparison` | no widening: these are two rules |
| `schemaDigest` in one, absent in the other | no widening: the second never claimed that schema |
| nothing but `task` | `{ task }` — a rule that genuinely holds everywhere in the task |

**By support.** Three **distinct tasks** must endorse the claim before the narrow copies are retired
(`WIDENING_TASKS`). A pair is exactly the evidence one persistent user can manufacture, and retiring a
working domain-scoped rule on a pair trades a measured gain for an unmeasured risk. Two domains produce
two rules; the third folds them into one.

Widening only targets an **active** rule. Widening onto a candidate would promote a claim that has
not earned admission.

```ts
// Two domains: two rules, both kept.
//   {chart.recommend, sales, trend}   {chart.recommend, hr, trend}
// Third task corrects the same claim in `ops`:
//   {chart.recommend, trend} with three tasks of evidence,
//   statusReason `generalized:<id>` on the two it replaced.
```

### 8.2 The store is a function of the log

A correction is evidence, and evidence has a history. If replaying that history in a different order
built a different store, then the store would be a record of *arrival*, not of what was learned — and
the order is exactly what an attacker, a flaky outbox, or a second writer controls.

Four invariants hold, each one closing a formation route that plants no false record:

| Invariant | Question it answers | Where |
|---|---|---|
| Evidence identity | do two observations of one correction count once? | `mergeEvidence`, `curate.mergeInto` |
| Widening bound | can a rule claim more than its endorsers did? | `distill/generalize.ts` |
| Selection | is curation a function of the log, not of arrival order? | `capture/curate.ts` (sorted groups, id tie-breaks) |
| Path | does the same evidence merged in another order leave the same store? | canonical evidence order in `curate` |

You can re-measure them on your own store shape:

```bash
pnpm eval:integrity   # 1,000 events, five shuffled replays, one mutation control
```

The lane reports `order_invariance`, `replay_determinism`, `stale_schema_injected`, and — the number
that makes the other three worth reading — `control_invariance`. The control replays the log through a
view that returns events newest-first, bypassing the sort; it **must** disagree. A harness whose control
also passes is measuring nothing, and the lane fails rather than report a vacuous 1.00.

### 8.3 Admission: deciding what *not* to write

```ts
const report = await mg.distill({
  admission: { topS: 10, threshold: 0.85 },   // omit the key to keep the pre-8.3 behaviour
});
```

By default the store writes every claim it cannot match to an existing item **exactly** — same
namespace, kind, scope and normalised sentence. That key contains the scope, so the same lesson
learned on a second task arrives as a second item. Two items carrying one rule spend two slots of a
pack whose limit is eight, and neither corroborates the other: the pair stands on one observation
each, and a promotion gate that asks for two independent tasks sees one task twice.

`admission` compares the claim against its `topS` nearest live items in the same namespace and kind
and decides one of three things:

| Decision | When | What is written |
|---|---|---|
| `add` | nothing comparable is stored | a new item |
| `update` | a comparable item exists and this observation changes it (new evidence, a new `when`, a stronger tier) | the existing item, merged |
| `noop` | a comparable item exists and this observation changes nothing | **nothing** |

Two properties worth knowing before you turn it on:

- **A payload disagreement is an `add`.** Same sentence, different payload is two rules, and merging
  would let the survivor's payload inherit the other's evidence.
- **`noop` does not touch the item.** A write that changed nothing would advance `updatedAt`, and
  every delivery log downstream reads a moving timestamp as a rewrite.

The counts land in the report: `suppressed` is how much paraphrase pressure the store absorbed
without growing, and `rephrased` is how much of it crossed a task boundary. Read them before the
accuracy delta — an arm that turned admission on and suppressed nothing has measured nothing, and
that is a different finding from a mechanism that did not help.

There is deliberately no `delete` decision. A similarity score says two sentences look alike; it is
not evidence about which of them is true, and retiring a rule on resemblance would let a paraphrase
replace the rule it paraphrases. Retirement goes through `curate`, `recordContradiction` and
`decideStatus`, all of which keep the closed item and the reason it was closed.

### 8.4 Consolidation: the same claim, said twice by two tasks

Admission is asked once per write, against a store that holds one episode of a claim. That is the
right moment for deduplication and the wrong moment for a question about **corroboration**, which is
a property of the finished store: *which of these items are one claim, and how many different tasks
stand behind each?*

```ts
import { consolidateKnowledge } from '@agentix-e/microglia-core/distill';

const { items, report } = consolidateKnowledge(await store.listKnowledge({}), {
  now: Date.now(),
  policy: defaultPolicy,      // needed to re-score the survivor
  threshold: 0.6,             // containment at which two claims are one claim
  conditionMinShared: 3,      // shared content terms below which two conditions disagree
});
for (const item of items) await store.putKnowledge(item);
```

Each group of paraphrases becomes one item carrying the union of its evidence, so an item that three
tasks derived reports `supportTasks: 3` — which no threshold could have produced from a store where
every item was written by one task. The pass is deterministic (token overlap, not a model), idempotent
(a second run over its own output changes nothing), and it never merges two claims whose conditions
disagree, whose payloads differ, or whose evidence is identical.

`threshold` is **containment**, not Jaccard: the share of the *smaller* claim's content terms that the
larger one also holds. That is what lets a claim and its own restatement with a different closing
clause merge — the shape a distiller actually writes — where Jaccard charged the extra clause twice
and merged nothing. The defaults (0.60 and 3) were calibrated on a real store rather than guessed:
its one pair of repeats reads 0.700 and the closest pair that is not a repeat reads 0.533.

`report` is what you read before trusting the store's shape:

| Field | What it tells you |
|---|---|
| `considered` → `retained` | how much of the store the pass kept |
| `groups`, `merged` | how much of it was the same claim said twice |
| `supportBefore` / `supportAfter` | the distribution of `supportTasks` on both sides, which is the reading a corroboration gate asks for |
| `threshold`, `conditionMinShared` | the two floors this pass used, so two stores consolidated under different settings are not compared by accident |
| `refusedCondition` / `refusedPayload` / `refusedDuplicateEvidence` | why pairs that overlapped were not merged |
| `skippedKey` | duplicates the linkage key removed after every other test had admitted them — the pairs a keyed pass can never merge |

### The linkage key, and why it defaults to filtering

The pass is quadratic, so it groups items by a *key* before comparing them: `scopeKey(item.scope)` by
default, or whatever a host supplies through `keyOf` (a hook that knows the routine behind an item, say).
The key was introduced to make the test affordable and it is easy to read as a finding — *two items filed
differently are two claims* — which the pass cannot know before it reads them. On a real store of 64
statements that cost everything: the store held **43** distinct claims, the pass merged **one**, and
**34 of the 35** joins sat under different keys, so the pass was comparing the one pair its key admitted
while 34 duplicates went unexamined.

```ts
consolidateKnowledge(items, { now, policy, linkage: 'all' });   // the key still names, it no longer removes
```

`linkage: 'all'` stops the key removing pairs and leaves **every** claim test in force: kind, containment
at `threshold`, the condition floor, payload equality, duplicate-evidence refusal, and complete linkage.
It is *look everywhere*, not *merge everything*. `skippedKey` is the field to read on either setting: on
`'key'` it counts the candidates the key deleted, and on `'all'` it must be `0` — if it is not, the option
did not reach the pass and the run is not the arm it claims to be.

Two things it does not do. It does not delete: a retired member is kept with `statusReason:
consolidated:<id>`, so an erasure request and an audit both still see it. And it does not decide what
a claim *means* — a merge of two claims that should have stayed apart will be visible in the census as
a group, which is why the threshold travels with the report rather than living in a constant.

### What the pass buys, and what still has to be done with it

A keyless pass is what makes `supportTasks` move: on a store where `supportBefore` was `{1: 70}` a pass with
`linkage: 'all'` reached `supportAfter {1: 44, 2: 8, 3: 2, 4: 1}` — **11 items that two or more tasks taught
independently**, max 4. The pass only *labels* that consensus; it does not act on it. An item with one task
behind it is still served, and on a store that is larger than the request population most requests are
answered with one. The mechanism that acts on it is a serve-time floor — `retireBelowSupport` in the
library, `serveSupport` in a registration — documented in §13.28.

## 9. Exporting a dataset

```ts
const rows = await mg.exportDataset('dpo');            // sft | dpo | kto | eval
const jsonl = await mg.exportJsonl('sft');
```

| Format | Rows built from | Shape |
|---|---|---|
| `sft` | edits | `{prompt, completion}` |
| `dpo` | edits | `{prompt, chosen, rejected}` |
| `kto` | ratings | `{prompt, completion, label}` |
| `eval` | edits and ratings | `{input, expected}` |

These are for *your* training pipeline. The library does not train anything, and the CPU/WebGPU
constraint is deliberate: training belongs wherever your GPUs are.

## 10. Operating it

```ts
const stats = await mg.stats();      // {events, runs, knowledge, active}
const health = await mg.doctor();    // issues, each with a code and a count
```

`doctor()` is the first thing to run when the loop seems inert. It reports stale candidates, active
rules with no evidence, namespace mismatches, quarantined backlogs, and rules whose confidence has
decayed below the retirement line.

### 10.1 Storage

`JsonlJournal` writes three append-only files (`events`, `runs`, `knowledge`) and `fsync`s each
record. Feed it a directory; back it up by copying it. One writer per directory — if you run more
than one process, give each its own namespace *and* its own directory, or implement `MemoryPort`
against your database.

### 10.2 Scheduling

Run `distill()` on a timer (60s is plenty), at session end, or after N feedback events. It is cheap
and idempotent: re-running it over the same events creates nothing new, because evidence is deduped
by feedback id — and, since iteration 46, nothing is *rewritten* either: a rule whose evidence the
store already holds keeps its timestamp, so "nothing happened" is distinguishable from "this rule
changed". A delivery log depends on that distinction.

### 10.3 Erasure

A store of other people's corrections without a delete is not shippable, so `forget()` is part of the
contract rather than an extension point:

```ts
await mg.forget({ ids: ['k_01j9z3k4m2_7f3a9c'] });   // this claim, whatever its evidence
await mg.forget({ taskId: 't_7' });                   // everything one task produced
await mg.forget({ actorHash: 'sha256:…' });           // everything one person contributed
```

Three rules, each with a reason:

1. **At least one selector is required.** An empty request is a wipe, and a wipe should have to be asked
   for.
2. **The namespace is never yours to pass.** `mg.forget` scopes the request to its own namespace, because
   an `actorHash` alone would otherwise erase that person in every tenant the store holds.
3. **Erasing evidence re-derives the claim.** An item that cited an erased event loses that reference and
   is re-scored: support is recomputed from what survives, the provenance tier is the strongest tier that
   survived, and admission runs again. An item whose last evidence was erased is removed. This is the part
   that matters — a rule promoted by an execution result that has been erased must fall back behind the
   promotion gate, or the erasure left the promotion behind.

What is written instead of the data is a **tombstone** in `erasures.jsonl`: the selector, the time, and
the record ids. Never a statement, never a payload — a record of what was erased would defeat the erasure
it documents. The three journals are then rewritten without the erased rows, so a reopen sees the erasure
rather than replaying it away.

Measured (POC-28b, 1,000 events): 10 items erased by id, 10 task instances erased by task, 170 events
and 4 claims removed by the cascade, 86 claims re-scored, and **0** erased records retrievable or cited
afterwards.

### 10.4 Telling another process what changed

Polling `GET /v1/knowledge` is the honest default, and enough for a single process. A host that wants
to react the moment a rule lands — a sidebar, a cache, a second agent — subscribes instead:

```ts
import { WebhookDispatcher, knowledgeEvents, snapshotOf } from '@agentix-e/microglia-core/delivery';

let snapshot = snapshotOf(await mg.store.listKnowledge({ namespace: 'acme', status: 'all' }));
const dispatcher = new WebhookDispatcher({
  target: { url: 'https://host.example/microglia/events', secret: process.env.WEBHOOK_SECRET! },
  fetch, clock: () => performance.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
});

await mg.distill();
const items = await mg.store.listKnowledge({ namespace: 'acme', status: 'all' });
const drafts = knowledgeEvents({ namespace: 'acme', taskType: 'chart.recommend', previous: snapshot, current: items });
snapshot = snapshotOf(items);
const { failed } = await dispatcher.publish(drafts);
// `failed` is the resync list: those ids never reached the receiver.
```

Three event types come from the store — `knowledge.admitted`, `knowledge.superseded`,
`knowledge.retired` — and `taskCompleted(record)` builds the fourth from the task record you already
hold when you close a task. Rules that were *erased* produce no event: an event naming deleted data
would outlive the deletion.

The body is posted once, and that exact string is signed:

```
X-Microglia-Signature: sha256=<hmac-sha256(secret, raw body)>
```

Verify it against the **raw** body before parsing, or a re-serialised body will fail its own
signature:

```ts
import { hmacSha256Hex } from '@agentix-e/microglia-core/delivery';
if (req.headers['x-microglia-signature'] !== hmacSha256Hex(process.env.WEBHOOK_SECRET!, raw)) return res.sendStatus(401);
```

Delivery is **at least once** and ordered per `(taskType, seq)`. Retries reuse the same `id`, so
de-duplicate on it: a receiver that stores by `id` gets one row per change even when an
acknowledgement was lost. A 4xx is not retried — the receiver refused that body — while a 5xx, a 429
and a transport failure are. After the retries are exhausted the id lands in `failed`; nothing is
silently dropped, and the resync is `GET /v1/knowledge?since=`.

`pnpm eval:delivery` runs the whole path against a real HTTP receiver: signatures verified, an
acknowledgement lost on purpose, one delayed response, 50 corrections. It reports 0 missed, 0 ordering
violations, and a loopback p95 in single-digit milliseconds — a floor, not proof that a remote host is
reached within the contract's 60 s.

### 10.5 Handing the memory to an agent over MCP

An agent that runs its own tool loop can ask for conventions instead of receiving a prompt block. The
server exposes two tools over JSON-RPC at `POST /v1/mcp` — no new process, no second store, the same
facade the HTTP routes use:

```bash
curl -s localhost:8787/v1/mcp -H 'content-type: application/json' -d '{
  "jsonrpc": "2.0", "id": 1, "method": "tools/call",
  "params": { "name": "microglia_recall",
              "arguments": { "taskType": "chart.recommend", "question": "compare revenue by region" } } }'
```

| Tool | Arguments | Returns |
|---|---|---|
| `microglia_recall` | `taskType`, `question`, optional `domain`, `budget` | the rendered pack as text, with `_meta.ids`, `tokens`, `truncated` |
| `microglia_feedback` | `runId`, `kind` (`edit` / `rating` / `abstain`), plus `after`, `value` or `reason` | a one-line acknowledgement, or `isError: true` with the reason |

Two things are deliberate. **`microglia_feedback` takes a `runId`**, not a task id: feedback in this
library attaches to one immutable generation, and a task can have several attempts — a task id alone
cannot say which attempt the user was judging. And **the surface is two tools**: a tool-calling agent
that recalls on every turn has replaced a prompt block with a latency tax, which is what the POC-20 gate
measures (≤2 calls per task).

Failures split the way the protocol wants them to: a malformed *request* is a JSON-RPC error
(`-32602`), while a *tool* failure — an unknown run, a namespace refusal — comes back as
`isError: true` with a message the model can read and act on. A notification gets `202` and no body.

## 11. Failure modes and what they mean

| Error code | Cause | Fix |
|---|---|---|
| `MG_E_NO_OUTPUT` | feedback before `complete()` | call `complete` first; a correction must cite an output |
| `MG_E_RUN_COMMITTED` | `complete()` twice | one run, one output |
| `MG_E_INVALID_SIGNAL` | empty/oversized field, empty edit, non-JSON output | validate at the UI edge |
| `MG_E_NAMESPACE_MISMATCH` | knowledge without a namespace | always pass one |
| `MG_E_SCHEMA_VERSION` | journal written by an older/newer build | migrate, do not skip |
| `MG_E_SCHEMA_INVALID` | domain registry missing a role | one temporal, two categories, two measures |
| `MG_E_NOT_OPEN` | write after `close()` | reads stay valid; writes do not |
| `MG_E_STORE_IO` | journal path unreadable | check permissions; a directory where a file belongs |
| `MG_E_PROVIDER_MISSING` | no provider is registered under that name | register a factory, or pass an instance |
| `MG_E_PROVIDER_FAILED` | the provider stopped answering: retries were exhausted for several requests in a row | retry when it recovers — a loop that runs through an outage records the outage |

An empty edit is an error, not a no-op: it means the user's action did not change the output, and
recording it would teach that "nothing" is a correction.

## 12. When the loop does not help

Be honest about the preconditions; the product is only useful inside them.

1. **The errors must be systematic.** A distinct mistake every time has nothing to learn. The study's
   baseline repeats six defect families; a random-error baseline would show no lift.
2. **The host must pass structured scope.** Without `scope`, retrieval degrades to text matching and
   a rule learned for trends will not reach a trend question phrased differently.
3. **Corrections must recur.** One correction activates a rule; the *second* is what makes it survive
   contradiction and noise.
4. **Generic knowledge will not help a strong model.** Measured: a pack of textbook chart rules left
   a strong model at 90.48% (or moved it to 88.10%). The value is *your* conventions, where the same
   model goes from 0% to 75–89%.
5. **Structured outputs need `editSemantics`.** See §4.
6. **A rule learned once is a hypothesis.** Measured three times: on the chart study a corroboration
   floor of two keeps 96.43% of 100.00%; on BIRD Mini-Dev it injects **nothing**, because every one of
   1,296 distilled rules came from a single correction — and that is the workload where the pack costs
   2-4pp; on τ²-retail (46 training tasks, each corrected once) the memory costs 7.35pp. **The
   mechanism's benefit is conditional on corrections recurring**, so measure that before you turn the
   pack on — the number is free:

   ```ts
   const stats = await mg.corroboration();
   // { active: 1296, corroborated: 0, share: 0 } - this workload does not repeat
   // itself, so a pack built from it is noise. minEvidence: 2 is then the honest
   // configuration: it will inject nothing, deliberately.
   ```

   See `minEvidence` in §3.
7. **A `when` condition is read as text, not enforced as a filter.** An item's condition changes what the
   model writes — on BIRD, 48% of 350 answers differed when the condition was rendered — and it does not
   change whether the answer is right: paired against the same items without it, **0.00pp, CI
   [−2.57, +2.57], p = 1.00**, 10 questions gained and 10 lost. Write conditions anyway (they make a pack
   auditable and they help a human reviewer), but if applicability has to be *guaranteed*, filter before
   the prompt — a note is a hint, not a gate.
8. **A convention with a *form* is not transmitted by description.** Measured on BIRD Mini-Dev (145
   questions, 5 folds, 1,301 model calls): writing a workspace convention into the prompt moved execution
   accuracy from 0.69% to 4.14–5.52%; handing over the exact answer in the exact form reached 48.97–56.55%,
   short of the 90% needed to attribute the result to knowledge rather than to output format. The pack
   steers *what* the model produces; it does not certify *form*. If a unit, a rounding, a precision or an
   ordering is a requirement, enforce it after generation or encode it in the schema — a sentence in the
   prompt is a hint, not a contract. (On discrete choices the same mechanism does move a strong model:
   0% to 75–89% on chart-type conventions, which is where item 4's number comes from.)
9. **A rule is about one schema, and it does not travel.** Measured twice, without a model call, by
   binding every rule's identifiers against every database (`pnpm eval:template`, §13.2): by name,
   66.8% of a store cannot be bound outside its own database at all; by the tables the target question
   names, 48.6% cannot, and of what is still refused, 60.0% is a column the target database does not
   have. The referent of a rule is a *column*, and questions name tables, not columns. So the pack is
   an **in-database prompt**: give a namespace one workspace, and expect it to steer that workspace's
   questions. Do not expect a domain pack distilled on one product's schema to help a question written
   against another, and do not build a product claim on it.
10. **A rule may not be able to reproduce the correction it came from.** This is the measurement the
    loop rarely makes, and the one that decides whether the pack is a mechanism or a noise generator.
    Ask each *corrected* case twice — once with a blank retry, once with the rules that correction
    produced — and the four outcomes separate what the pack did from what a second attempt would have
    done anyway:

    | | retry alone right | retry alone wrong |
    |---|---|---|
    | **with the rules right** | `redundant` — the rules added nothing | `supplied` — the rules did the work |
    | **with the rules wrong** | `broke` — the rules destroyed a case that needed no help | `useless` — neither attempt reached the correction |

    Measured on BIRD Mini-Dev (156 corrected cases, 296 rules, 312 calls): **supplied 19 — 12.2%**,
    redundant 31 — 19.9%, **broke 3 — 1.9%**, and **useless 103 — 66.0%**. Two corrections in three
    cannot be reached even when the model is shown its own failure *and* the rules distilled from it.
    A gate that keeps only rules that reproduced their own case and broke none keeps 38 of 296
    (12.8%), and that store answers 350 held-out questions at **54.00% against 54.00% without it** —
    `0.00pp`, pack of 0.39 rules per question. The admitted rules neither help nor hurt; the 85% that
    cannot demonstrate anything are what a normal pack is made of.

    So run this before you trust a store: `SOTA_ARMS=full-verified` (§13.4). If `supplied` is small and
    `useless` dominates, the extraction is the bottleneck and no amount of retrieval work, injection
    timing or budget tuning will reach it.

11. **A validity check needs a control query, because the rule is differential.** The one filter that
    survived out of sample — discard a statement that imports a name the request never implied — is
    defined on the *difference* between two statements. Pointed at a single query, the same rule flags
    **94.8%** of 6,990 attempts: every table and column a correct query needs and the question does not
    spell out. The gap it shows between flagged and clean attempts (−12.58pp) is a question-phrasing
    effect, and Youden's index — which corrects for the base rate — falls from the filter's **0.1068** to
    **0.0257**; loosening the rule to accept inflected identifiers lifts it only to 0.0700. Measured on
    the 7,000 out-of-sample questions with no model call, by `pnpm eval:validity`; the registration is
    `prereg/R33.md`. **So budget for a second generation without the pack if you want the check** — it is
    a paired comparison, not a validator, and the comparison is the thing that costs.

12. **Showing the pack to fewer questions does not rescue it, and the bar for doing so is arithmetic.**
    A repair is only possible on a question the bare model got wrong and a break only on one it got
    right, so memory pays for itself when `repairs / breaks` exceeds **the odds of the bare model being
    right** — on this corpus **1.393**, not 1.0. The measured 0.789 is a 43% shortfall. Gating the pack
    by question is the obvious response, and it has a clean ceiling: admit only the questions the bare
    model would fail and the break rate is zero by construction, worth **+2.67pp**. The gate needs only
    `b / (r + b)` = **47.6%** of its admitted questions to be future failures, against a 41.8% base rate.

    Measured on the 7,000 out-of-sample questions, no model call, five registered gates: the best one
    reaches **62.4%** precision — well past the bar — and returns **−0.05pp** on an interval covering
    zero, because **the bar belongs to the admitted set and selection moves it**. Inside the gate's own
    population the break rate climbs from 5.50% to **9.68%** while the repair rate stays flat, so the bar
    rises 16.8pp alongside the gate's 20.6pp and never gets crossed. Thirty registered points reach
    **+0.11pp** of the 2.67pp ceiling out of sample. **A question whose neighbours failed is one the model
    is unstable on, not one the pack can fix** — so before you build a router, check whether the signal
    you would route on predicts *ignorance* or *variance*. `pnpm eval:admission`, `prereg/R34-admission.md`.

13. **Do not plan to prune the store by evidence, and do not assume two rules are better than one.**
    Dropping the rules that break is the obvious maintenance job, and it needs something this store does
    not have: a per-rule value that travels. Across 203 rules and 13,578 injections the records are more
    dispersed than the pack structure explains (χ² **293.3** against a permutation null of 209.6,
    p = **0.0047**), so rules genuinely differ — but measured again on a disjoint set of databases the same
    rules correlate **−0.13**, agree in sign on **49.1%** of the 53 that moved twice, and extrapolate to a
    reliability of **−0.31**. A pruned store is a randomly pruned store. The coarse flag a deployment could
    actually run is no better: 58 rules covering 2,545 questions returned −0.55pp against −0.49pp for the
    rest.

    What *does* track the outcome is **how many rules the prompt carries**. Questions served one rule
    returned **+3.07pp**; questions served two returned **−0.96pp** — a **+4.03pp** difference on a
    database-clustered interval of [+0.76, +6.62]. Treat it as a lead rather than a setting, because
    retrieval chose which questions got the single rule (they are harder: 47.3% unanswerable by the bare
    model against 41.4%) and because the contrast is negative on every small pilot in this repository. If
    you are wiring this into a product, **set the pack to one rule and measure**, which halves prompt
    tokens; if you are maintaining a store, **fix the grain** rather than the items.
    `pnpm eval:ledger`, `prereg/R35-ledger.md`.

    **What "fix the grain" turned out to mean, and where it stops.** The grain was measured
    (`R37`, `prereg/R37-lexicon-grain.md`): a memory written as a **term and what it denotes**,
    retrieved by the term and shown only on a question that contains it, with both predicates
    enforced over text rather than requested from a model. It behaves as designed — every one of the
    132 lines it rendered named a term its own question used — and it reached **8.6% of the split**,
    because a corpus of independently written questions reuses almost no phrasing: 179 entries written
    from 547 corrections collapsed to **13 terms** that any held-out question repeats, and two of them
    accounted for four fifths of the coverage. That is below the 25% the registration fixed in
    advance, so the round is **inconclusive by feasibility** rather than a refutation: on a corpus with
    no reuse the representation cannot be tested, and on a product whose users ask about the same
    entities in the same words it is the version worth testing. `pnpm eval:lexicon`,
    `eval/results/poc-sota-bird-dev-R37-lexicon-grain.json`.

    **And measure the resolution of anything you intend to claim.** A delta is only a measurement if it is
    larger than the smallest difference your sample could have detected at 80% power, `√(z²·d/n)` with `d`
    the share of pairs that changed hands — and that floor is routinely four points on a few hundred
    questions. In this repository **18 of 103 published arm rows are decided**, every one of them larger than
    4.5pp, and the median floor is **4.38pp at 350 questions** and **2.07pp at 1,534**. The same arithmetic
    prices what you cannot decide: an effect of 0.07pp on 1,534 questions would need **1,457,294** to settle,
    so the honest response is to stop asking rather than to run it again. Two traps are worth knowing before
    you read anyone's table, including this one's: **a channel can be two contrasts** (a filter measured
    against no memory and against the full pack gives two different numbers, both true), and **a single
    decided run is not a replication**. `pnpm eval:resolution`, `prereg/R39-arm-resolution.md`.

    **And count a control arm's population before you pay for the arm.** A conditional treatment —
    retry-on-failure, escalate-on-low-confidence — acts on the questions your pipeline *rejected*, not on
    the questions that were wrong, and the two populations differ by an order of magnitude. A retry loop
    here fires on **6.4%** of BIRD dev (98 of 1,534), because it triggers only on a reply with no
    statement, a statement that failed, or a result with no rows; a base accuracy of 53% suggests 47% and
    is the wrong number. `pnpm eval:retry-population` counts the real one from any artefact already in the
    tree, with no model call, and breaks it down: of the 89 empty results on dev, **54 read exactly the
    gold query's tables** and **32 miss a value the gold uses** — so the repair a retry would have to make
    is about values, not about schema. Count the population first; an arm whose denominator is a guess
    reports its effect against the wrong base.

    **And if you are going to claim your library is scenario-agnostic, meter it.** `pnpm eval:coupling`
    recomputes the layer table from the source tree: production lines per package, the modules that name a
    database in **code** (comments are stripped, because a module that explains why it is *not* SQL-specific
    is not coupled to SQL), the package import graph, and a verdict for every coupled module — `adapter`,
    `deferred` with a written reason, or `general`. Three gates decide whether the answer is publishable:
    every coupled module has a verdict, no package imports upward, and the base library names no scenario at
    all. In this repository that reads **1,956 lines in seven modules**, sixteen deferred with a reason, and
    **zero** in `core` out of forty modules — and it is a number rather than a paragraph, so it is checked
    on every push. (The line count is stable because the six modules are; the deferral count moves whenever
    a new module names the scenario in code, which is what the deferral table is for.)

## 13. Measuring your own generator

The harness that produced every number in this repository is usable by someone else. Two files and
one command:

```bash
pnpm eval:plugin --cases eval/cases/fixture.json \
  --plugin eval/plugins/your-generator.mjs \
  --prereg R8.1-offline-fixture \
  --out eval/results/poc-plugin-fixture.json \
  --report eval/results/poc-plugin-fixture.md
```

**The generator.** Any ECMAScript module outside `packages/eval` that default-exports:

```js
export default {
  contract: 'candidate-generator/1',
  name: 'your-generator',
  version: '1.0.0',
  generate(request) {          // request: { id, dbId, question, evidence, ddl }
    return { sql: 'SELECT ...' };   // or a string
  },
};
```

Nothing else is imported from us. That is deliberate: the contract is the whole interface, and a
generator that needs our types to compile is not a third-party generator. A module inside
`packages/eval` is refused before it loads — the claim being tested is provenance, not behaviour.

**The case file.** One JSON document with the databases (DDL plus rows), the questions, and the gold
SQL for each. The runner builds the databases in a temporary directory, executes the gold to get the
expected rows (a gold query that throws stops the run rather than silently dropping the case), asks
the generator once per case, executes the answer, and compares the two as a multiset.

**The artefact.** `eval/results/poc-plugin-fixture.json` — every case, the metrics those cases imply,
and the gates. It validates against `packages/eval/schema/run-artifact.schema.json`, and the report
beside it is rendered *from* that JSON, so the prose cannot drift from the numbers. `pnpm eval:protocol`
fails if the committed report differs from the one the committed artefact renders.

Three gates travel with the run:

| Gate | Refuses a run whose |
|---|---|
| **V27** | generator resolved inside `packages/eval` |
| **V29** | answer rate is below the registered floor — a broken generator, not an unlucky one |
| **V30** | pre-registration is missing or malformed |

**Write the prediction first.** `prereg/<id>.md` has a fixed header (id, step, opened, arms, sample,
gates) and two mandatory prose sections, Prediction and Refutation. `pnpm eval:prereg` refuses a file
with a missing section, a placeholder, or an id that disagrees with its filename, and the benchmark
workflow refuses a dispatch that names none: a run whose prediction was not written down before it
started can only ever be read as a description of what happened.

**Every key a header may carry.** Six are required and the rest are optional: a registration
opened before a key existed stays valid, and a key that is absent means "the dispatch's own setting
stands" — except for the six switches below, where a *stated disagreement* between the header and the
repository variable is refused before the first model call rather than resolved by either side.

| Key | Meaning | Who decides when absent |
|---|---|---|
| `id` | bare id, must match the filename | required |
| `step` | the roadmap step this executes | required |
| `opened` | the date the prediction was written | required |
| `arms` | the arms it measures, `memory,reference` for a τ² cell | required |
| `sample` | the number of cases the run scores | required |
| `gates` | the gates the run is judged by | required |
| `recallFloor` | the similarity floor a pack is served at | `TAU_MIN_COVERAGE` |
| `facadePair` | whether the run measures the paired-facade contrast | `TAU_FACADE_PAIR` |
| `facadeNotes` | the note level: `standard`, `hardened`, `cautious`, or `three-level` | `TAU_INJECTION_NOTE` |
| `trainDomain` / `testDomain` / `recallDomain` | the τ² scenario pair and the scope recall asks in | `TAU_TRAIN_DOMAIN` and its two siblings |
| `split` | `minidev`, `dev` or `train` on the BIRD lane | `SOTA_SPLIT` |
| `lane` | `product`, `transfer` or `hostile` — which claim this cell may support | the split already fixes BIRD's role |
| `backbone` | the model this cell runs | the repository model on this provider |
| `thinking` | `on` or `off`: the reasoning regime | `SOTA_THINKING` |
| `distillForm` | the shape of claim the distiller is asked for: `lesson`, `procedure`, `repair`, `lexicon` | `TAU_DISTILL_FORM` |
| `distillUnit` | `correction` (one failed task, one sentence) or `trace` (the attempt beside the reference) | `TAU_DISTILL_UNIT` |
| `distillScope` | `edited` (the failures) or `all` (every trajectory, including the ones that passed) | `TAU_DISTILL_SCOPE` |
| `traceClaims` | how many claims one trace may teach, 1–8; both the sentence the model reads and the count the parser keeps | `TAU_TRACE_CLAIMS` |

The six switches are the ones a dispatch can be *wrong* about. Everything else has a default that is
harmless when inherited; a switch does not, because two runs that differ in one are two experiments and
a store cannot say which one built it. `pnpm eval:prereg-form prereg/<id>.md <form> <unit> <scope>
<claims>` prints the six values the workflow should use, and exits non-zero naming the disagreement when
the variable and the header say different things:

```
$ pnpm eval:prereg-form prereg/R58-trace-unit.md '' '' '' 6
[prereg-form] this registration fixes the trace ceiling at 3 claim(s) and this dispatch would run '6',
              so the ceiling is not the only variable that moved
```

**What a comparison is allowed to say.** `compareCell` in `packages/eval/src/reproduction.ts` refuses
to call anything `reproduced` unless it was measured on the same split. A number from a 350-question
subset and a published number on 1,534 questions differ by sampling error alone; the honest verdict is
`indicative`, and the difference is reported with both intervals beside it. Our own no-memory baseline
(53.71% on BIRD Mini-Dev) sits 0.19pp from XiYan's published 53.52% on BIRD dev — that is `indicative`,
and the published cell's own standard error (±1.27pp) is seven times the gap. A gate re-derives every
recorded comparison from the artefact and fails if the record disagrees with the arithmetic, so
`indicative` cannot be edited into `reproduced`.

### 13.1 Reproducing a published number, and why it needs its own split

A published accuracy is a claim about a sample. BIRD's dev split has **1,534 questions**; the
Mini-Dev slice this project measures its transfer experiments on has **500**, of which the lane
scores 350 after dropping the easiest third. Reproducing a 1,534-question number on 350 questions is
not a reproduction, so the lane measures both splits and writes two artefacts.

| Split | Questions scored | What it is for | Artefact |
|---|---|---|---|
| `minidev` | 350 (925-of-500 `simple` questions dropped) | transfer experiments: a question answered without memory carries no signal | `eval/results/poc-sota-bird.json` |
| `dev` | all 1,534 | reproduction: the sample size *is* the claim | `eval/results/poc-sota-bird-dev.json` |

The filter is split-dependent, and that is deliberate. On `minidev` dropping `simple` questions is
a measurement decision; on `dev` the same filter leaves 609 questions and stops being the cell it
claims to reproduce. `poolOf(rows, split)` owns that difference and `bird-data.test.ts` asserts both
halves of it.

```bash
# the archive comes from the vendor's CDN, not from a dataset host
curl -sI https://bird-bench.oss-cn-beijing.aliyuncs.com/dev.zip     # 346,207,293 bytes, 200 OK
pnpm eval:sota                       # SOTA_SPLIT defaults to minidev
SOTA_SPLIT=dev pnpm eval:sota        # 1,534 questions, writes poc-sota-bird-dev.json
SOTA_SPLIT=dev BIRD_DIR=/data/dev_20240627 pnpm eval:sota   # if you already extracted it
SOTA_SPLIT=dev SOTA_PREREG=R24-dev-split pnpm eval:sota     # …and poc-sota-bird-dev-R24-dev-split.json
```

**A second design on the same split gets its own file.** `SOTA_PREREG` is not only a label: the run
appends it to the artefact's name, so a new experiment over the 1,534 questions cannot overwrite the
run a published reproduction cell is recomputed from. A re-dispatch of the same pre-registration writes
the same file again; a run with no pre-registration keeps the split's plain name, as before.

Both archives are pinned by size and SHA-256 in `eval/manifests/`: `bird-minidev.json` and
`bird-dev.json`. Two manifests rather than one with a switch, because a manifest is the record of
one verification. The eleven SQLite databases are the same in both archives — dev differs only in
the question set — so a dev run reuses the databases it already has once either archive is unpacked.

**What the dev run measured** (`eval/results/poc-sota-bird-dev.json`, 1,534 questions, no memory):

| Reading | Value |
|---|---|
| execution accuracy | **57.63%** (884/1,534), Wilson [55.14, 60.08] |
| published cell `xiyan-deepseek-ddl` | 53.52% [51.02, 56.02] on the same split |
| difference | **+4.11pp**, inside the same-split tolerance of 4.97pp |
| verdict | **`reproduced`** — the first row of the comparison table that is not a footnote |
| calls / timeouts / failures | 3,190 / **0** / 0 across 3,174 prompts, 5 folds, 77 minutes |

**Two rows, not one.** `eval/results/poc-cell-comparison.json` carries a row per artefact, because
a table that replaced the Mini-Dev row with the dev row would delete the evidence for the reading
that motivated it. Each row names its source file, and `pnpm eval:protocol` recomputes both from
the JSON: `indicative` at +0.19pp from the 350-question artefact, `reproduced` at +4.11pp from the
1,534-question one. The gate refuses a record whose verdict disagrees with the arithmetic, which is
how the dev row replaced the Mini-Dev row's verdict the moment the artefact existed.

A run on the right 1,534 questions filed under a different split name stays `indicative` forever,
which is why `splitNameOf('dev')` is asserted against the catalogue in `artefacts.test.ts` rather
than written in a comment.

### 13.2 Showing a rule where its words do not exist

A rule is stored as a sentence: *"`price` is stored as text, cast it before comparing."* On the
question that produced it, every word has a referent. On a question from another database, the
sentence is still a sentence — and `price` may be `unit_price`, or `prize`, or nothing at all. The
lane measures both forms:

| `SOTA_TEMPLATE` | What the model is shown | When to use it |
|---|---|---|
| `prose` (default) | the statement as distilled | the incumbent form; every measurement before R10 used it |
| `bound` | the statement read as a template, its schema identifiers replaced by the **target** database's names | testing whether a rule travels as structure rather than as wording |

Two binders exist, because there are two ways to say what a slot's referent is: the **name** binder
compares spellings against the whole target schema, and the **question** binder (`pnpm eval:template`
runs both) takes a table slot from the tables the question names and searches for a column slot only
inside the table it reached. Neither carries a rule across a schema boundary often enough to measure
a transfer effect — the table half improves fivefold (3.9% → 22.0% of rules bind) and the column half
is the wall, because three in five refusals are a column the target database does not have at all.
The product statement that follows is in §12: the pack is an in-database prompt, and no claim in this
repository says otherwise.

Under `bound`, the rule's identifiers that its *own* database has become slots, the rest of the
sentence stays, and each slot is filled from the schema the rule is about to meet:

```
stored     Cast price to real when price is text
template   Cast {price} to real when {price} is text
shown      Cast unit_price to real when unit_price is text
```

A substitution is accepted on the Jaccard overlap of the two names' `snake_case` parts — identity
scores 1, `price` → `unit_price` scores 0.5 — and nothing below 0.5 is bound, so `price` is never
turned into `prize`. The binding is all or nothing per rule: one slot with no referent withholds the
rule instead of showing it with `{price}` still in it. Withheld attempts make no call, are counted,
and `V28` checks that the count reconciles with the ledger.

```bash
SOTA_TEMPLATE=bound SOTA_DENSITY_PANEL=20 SOTA_TRANSFER_PANEL=10 pnpm eval:sota
pnpm eval:density    # prints the binding record before the rates
```

**Price the binder before you buy the arm.** Whether a rule can be bound at all is a question about
schemas, so it is answered without a model:

```bash
BIRD_DB_DIR=/data/dev_20240627 pnpm eval:template
# [template] 289 rule(s) against 11 database(s): 30 homeless, 0 unplaced, 259 attempted ...
# [template] rules: 10/259=3.9% bound, 76/259=29.3% slotless, 173/259=66.8% withheld
# [template] blocker: table 'posts' stopped 103 attempt(s)
```

The command reads the store an artefact carries, opens each database it covers, and runs the binder
over every rule-database pair. It exits zero whatever it finds, because a construction its own
pre-registration rejects is a result; the number it prints is what decides whether arm B is worth a
dispatch at all. It also writes `eval/results/poc-template-census.json`, which is the form in which
the number can be recomputed by somebody who does not trust the terminal: the rules, the databases,
the attempts, the blockers, and the verdict the kill condition produces.

**What the census decided, and why it is the whole result.** Both binders are refused by the kill
condition their pre-registrations fixed before the code existed — 66.8% of rules withheld by name,
48.6% by question, 62.3% of all attempts at the question level against a 60% bar. No arm was
dispatched, and the two artefacts (`poc-template-census.json`, `poc-template-linked-census.json`)
carry the counts, the blockers and the reason each withheld attempt failed. The reading this licenses
is deliberately narrow: a rule's referent is a column, and a schema boundary removes it — so a pack
steers the workspace it was taught in and does not travel. `prereg/R10-template-transfer.md` and
`prereg/R11-link-binding.md` carry the predictions and the refutations that were written first.

### 13.3 When a run takes longer than the model does

A cross-fitted run has two halves that cost very different things: an evaluation, where every call
is short and the width of the pool is what matters, and a learning pass, where every call is long and
the number of corrections is what matters. Ours spent 43 minutes on the second half of one fold and
two minutes on its first, and the two numbers are the whole story of a dispatch that was killed at
its step timeout with nothing to show.

**The attempt timeout is derived from what the reply is allowed to contain.** Asking for 2,000 tokens
and waiting a fixed minute is a client that kills its own successful requests: at the provider's
throughput, 2,000 tokens is more than a minute of generation. The budget is `25s + 140ms/token`,
capped at 300s — 53 seconds at 200 tokens, five minutes at 2,000 — and a timed-out attempt is
retried once rather than three times, because the same request gets the same slowness.

**The lane holds its own deadline.** `SOTA_DEADLINE_MIN` (default 130) is checked between attempts,
and it is set under the step timeout on purpose: a run that reaches its own deadline writes
`<artefact>.partial.json` with the folds it finished, the calls it spent, and which limit stopped it,
instead of being killed by the runner with nothing.

| Knob | Default | What it decides |
|---|---|---|
| `SOTA_DEADLINE_MIN` | 130 | wall clock the lane allows itself; `0` disables it |
| `SOTA_SQL_DEADLINE_MS` | 20000 | wall clock one executed statement may take before its process is killed |
| `SOTA_SQL_ROW_CAP` | 10000 | rows a statement may return before the result is called truncated |
| `SOTA_DISTILL_CONCURRENCY` | 8 | distillation replies in flight at once |
| `SOTA_VALIDATION_CREDIT` | `absolute` | how a learning row's note is scored before a filter reads it: `absolute` asks whether the answer was wrong, `counterfactual` asks whether the note changed it |
| `SOTA_ADMISSION_KEPT` | 0.5 | share of learning questions a per-question admission floor must keep, in (0, 1] |
| `SOTA_ADMISSION_DECISIVE` | 8 | decisive learning rows a fold needs before it may fit a floor at all |
| `POC_MAX_CALLS` | 8000 | HTTP attempts the run may spend |

**Every statement runs in a process that can be killed.** The model writes the SQL, and the driver is
synchronous: a statement that is slow to answer — a cross join is the easy way to write one — blocks the
whole lane inside a native call, where no timer and no deadline can reach it. That is not hypothetical:
the first dev dispatch of R24 spent its last 118 minutes there and published nothing. Statements therefore
run in child processes with a deadline and a row cap, and a killed statement is reported as a *deadline*
rather than as a wrong answer, because a query that cannot answer in twenty seconds says nothing about the
model's knowledge. The artefact carries `statements: { statements, deadlines, truncations, deadline_ms,
row_cap }`, and `V48-statements-answered` refuses a run in which more than 1% of statements hit the
deadline — a score decided by the instrument is not a score about the model.

**Distillation is paid concurrently and applied in order.** The prompts depend on their own events, so
they can be asked in parallel; a claim's effect on the store depends on what is already in it, so the
claims are still applied in corpus order. `distill()` asks the interpreter to *warm* the batch before
the first claim is applied, and an interpreter that does not know how to warm anything ignores the
request — which is why the default width of one leaves every existing caller untouched.

**Two kinds of retry, counted separately.** A 429 or a 502 is the provider asking for patience and is
retried four times, honouring `Retry-After` when it is sent. A timeout is the client having asked for
more than it was willing to wait for, and is retried once. The artefact carries both counts:

```jsonc
// fold 3 of the run that was killed at its step timeout
{ "calls": 1964, "retries": 15, "timeouts": 0, "call_failures": 0 }
```

`timeouts` near zero with `retries` high is a provider throttling you. `timeouts` high with `retries`
near zero is a client asking for too much — the failure is in your timeout, not in the endpoint.

**A short store is a different treatment, not a footnote.** `V32-fold-learning-intact` fails a run in
which more than 10% of the learning questions went unanswered or more than 10% of the corrections
failed to distil. A store built from 57 of 64 questions is not the store the arm was defined as, and
the artefact has to fail rather than report a number nobody can compare.

### 13.4 Asking the store to prove itself

Every arm this repository measures compares a pack against no pack on questions the store has never
seen. That answers "does the pack change the score" and cannot answer "is the pack any good": a store
of nonsense gets the same treatment as a store of facts. The own-case probe asks the other question,
and it costs two calls per *corrected* case, on the learning half only, so it cannot see the questions
it filters.

```bash
# the arm name is the whole switch: it probes, then answers with what survived
SOTA_ARMS=full-verified pnpm eval:sota
```

Read the `rule_probe` block, which the run writes into its artefact and prints as gates
`V13-probe-reconciles` (blocking: every rule lands in exactly one bucket) and `V14-probe-applied`
(advisory: how many held-out packs the gate changed):

```jsonc
// poc-sota-bird-probe.json, 350 questions, 5 folds, 1,445 calls
{ "source_questions": 156, "measured": 156, "supplied": 19, "redundant": 31,
  "broke": 3, "useless": 103, "blank_fix_rate": 0.218,
  "rules": 296, "kept": 38, "unsupported": 252, "broke_its_source": 6, "unprobed": 0 }
```

`blank_fix_rate` is the number that stops `supplied` being over-read: it is how often the retry alone
repaired the case, so it is the ceiling a second attempt gives you for free. If `broke` is non-trivial,
the rules are not merely unhelpful — they are destroying cases that needed no help, and that is the
one verdict that should make you turn the pack off before measuring anything else.

**What the gate is not.** A rule that survives keeps one demonstration and no counter-demonstration;
it is not a rule that works. On BIRD the 38 survivors changed 342 of 350 packs and moved accuracy by
`0.00pp`, so the honest reading of a passing gate is "this store is not demonstrably harmful", not
"this store helps".

### 13.5 Does an admitted rule travel?

§13.4 keeps the rules that reproduced their own correction. That is evidence of *a* fact, not of a
useful one: a rule that reproduces only the case it was written from is a lookup table with one row.
The transfer measurement asks the other half — point each admitted rule at a **different** corrected
question from the same database and see whether the rule repairs it.

```bash
# transfer runs whenever an arm asks for the rules that survived the own-case gate
SOTA_ARMS=full-verified,full-transferred \
SOTA_TRANSFER_TARGETS=8 SOTA_LEARN_SAMPLE=128 pnpm eval:sota
```

The control is a property of the target, not of the rule: whether a bare retry already repairs the
target is measured once per target and reused by every rule pointed at it, which is what makes eight
targets per rule affordable. Read the `rule_transfer` block:

```jsonc
// poc-sota-bird-transfer.json, 350 questions, 5 folds, 2,679 calls, 523 trials
{ "rules": 98, "trials": 523, "informative": 467, "repaired": 34, "broke": 28,
  "blank_right": 56, "rate": 0.0728, "break_rate": 0.5, "net_pp": 1.15,
  "rules_with_repair": 30, "verdict": "transfers", "pack_kept": 10 }
```

- `rate` is `repaired / informative`: among targets a bare retry could **not** repair, 7.3% were
  repaired by a rule. This ratio can only go up, because its denominator excludes every trial where a
  rule can do damage, so it is never an answer on its own.
- `break_rate` is the other half: of the 56 targets that needed nothing, **half came back wrong** once
  a rule was in the prompt. That is the harm an earlier iteration measured at the rule level, here at
  the level of one rule and one question.
- `net_pp` is the only figure that answers "does a rule help": `(34 − 28) / 523 = +1.15pp`. Six trials
  out of 523 is not a resolvable effect, and the artefact publishes the counts beside the ratio so a
  reader cannot take it as one.

**What the intersection is worth.** `full-transferred` keeps only the rules that did both — reproduced
their own case and repaired a foreign one. That is 30 of 576 rules and **10 injected items across 350
questions** (0.03 per question): the arm answered 53.71%, exactly the no-memory baseline (`0.00pp`,
p = 1.00). A gate that leaves nothing is not a filter.

**Three ways to misread it.**

1. `verdict: "transfers"` means the net effect is positive, not that it is resolvable. Read `net_pp`,
   `informative` and `repaired` together or not at all.
2. A hole is not a negative. A blank call that never returned leaves its trial with no denominator, is
   counted in `unmeasured` (and named in V15's `unmeasured_blank`), and can never be credited to a
   rule.
3. `V33-transfer-ledger` requires one row per trial in the artefact. The first run that measured
   transfer wrote its pairs into a record the artefact does not serialise, and published a rate with
   no pairs behind it; the gate exists so that this cannot happen silently again.

### 13.6 Which substrate: a sentence, or the pair it was read from?

Everything above measures one substrate: the **rule**, one declarative sentence about the workspace.
The other substrate is the **repair** — three sentences that compare the failed attempt with the
correction: what it did, why that returns a different answer, what replaced it. Both are built from
the same corrections by the same pipeline and differ in one instruction, which is what makes them
comparable.

```bash
# both stores are probed, with one shared control per question
SOTA_ARMS=full,full-verified,full-repair-verified \
SOTA_LEARN_SAMPLE=128 SOTA_TRANSFER_TARGETS=0 pnpm eval:sota
```

Read `rule_probe_pair`. It is the same question asked of both stores, paired by source question:

```jsonc
// poc-sota-bird-substrate.json, 350 questions, 5 folds, 2,490 calls, 303 paired
{ "left": "rule", "right": "repair", "shared": 303, "holes": 0,
  "both": 83, "only_left": 10, "only_right": 80, "neither": 130,
  "left_rate": 0.3069, "right_rate": 0.538, "delta_pp": 23.10, "p": 1.05e-14,
  "verdict": "right", "left_exclusive": 0, "right_exclusive": 0 }
```

- **`left_rate` / `right_rate`** are the shares of the source cases each store reproduced with itself
  in the prompt. The pair wins by **+23.1pp**: 80 cases the sentence could not reproduce and the
  account could, against 10 the other way.
- **Why paired.** Two independent rates of 31% and 54% would each carry an interval; on the same
  questions the test uses only where the two disagree, which is what makes `p = 1e-14` a reading
  rather than an arithmetic exercise.
- **`holes` and the two exclusive counts** are the questions no test could pair. Here all three are
  zero because both stores held a rule for all 303 corrected cases — when they are not, V36 makes the
  size of the exclusion a reading, because the paired set is chosen by the stores.
- **One control, shared.** The blank retry prompt does not depend on the store, so it is measured once
  per question and reused. Re-asking would re-sample the endpoint, and 16.4% of questions come back
  with a different query under the same prompt.

**The two numbers have to be read together, because they point opposite ways.** The account
reproduces twice as much of what it was learned from, and `full-repair-verified` — the repair store
under the same admission rule — answered **52.86% against 53.14%** (−0.29pp, one question) while
carrying 0.31 items per question. So the substrate fixes the *extraction* and not the *product*: what
a store can reproduce is not what it can teach, and the next question is transfer, not distillation.

**Three ways to misread it.**

1. `verdict: "right"` is about reproduction, not accuracy. Both arms are within ±3pp of no memory, and
   the paired comparison was never designed to answer the accuracy question.
2. The 1,200-character pack budget is the controlled quantity, not the item count. An account is
   longer than a sentence, so a pack holds fewer of them; that is the substrate's cost, and it is
   counted in `pack_kept` (109 items against 127).
3. `broke` did not fall (11 against 10 of 303). A better extraction is not a safer one, and the gate
   is what keeps the difference out of the product.

### 13.7 Does the pair travel?

§13.6 asks which substrate reproduces its own corrections better and finds the pair wins by 18.24pp.
§13.5 asks whether a rule repairs a question it was not written from and finds 6.28% at 60% damage.
The question neither answers is the one the product turns on: does the substrate that reproduces more
than half also *travel* further than the one that reproduces under a third?

```bash
# both substrates' transfer in one run, with one shared control per source question
SOTA_ARMS=full,full-transferred,full-repair-transferred \
SOTA_LEARN_SAMPLE=128 SOTA_TRANSFER_TARGETS=8 pnpm eval:sota
```

Read `rule_transfer_repair` beside `rule_transfer`. They are the same measurement over the two
stores, and V39–V42 hold the second to the same four checks as V15/V16/V17/V33 rather than to a
lighter one — a repair measured by a lighter rule could not be set beside a rule.

```jsonc
// poc-sota-bird-transfer-repair.json, 350 questions, 5 folds, 3,298 calls
{ "rules": 78, "trials": 416, "informative": 354, "repaired": 22, "broke": 32,
  "blank_right": 62, "rate": 0.0621, "break_rate": 0.5161, "net_pp": -2.4,
  "verdict": "no-transfer", "pack_kept": 19, "skipped": { "no-domain": 24 } }
```

- **`rate` ties across substrates.** 6.21% for the pair against 6.28% for the sentence, measured in
  the same run on 354 and 366 informative trials. A difference of 0.07pp on 720 trials is smaller
  than the standard error of either rate: whatever the account keeps that the sentence loses, it does
  not keep it *across* questions.
- **`break_rate` is lower for the pair in both dispatches** — 0.516 against 0.600 here, 0.304 against
  0.509 before — so the account damages less per opportunity even while repairing no more often.
- **`pack_kept` is the product answer, and it is 19 items across 350 questions.** Two gates — the
  account reproduced its own case *and* repaired a foreign one — leave 0.054 items per question, which
  is why the arm built from the intersection answers exactly what no memory answers.

**Reproduction and transfer are different properties, and only the second is the product.** The pair
reproduces 47.97% of its own corrections against 29.73% (+18.24pp, p = 1.8e-11, 296 paired) and
transfers at the same rate. A form that recovers more of what it was shown does not recover more of
what it was not shown; three content forms and two renderings have now been measured as arms, and none
moves a held-out cell.

**Three ways to misread it.**

1. A tie in `rate` is not a tie in harm, and neither is a reason to deploy. `net_pp` is the only
   figure that prices both: −2.40pp for the account and −1.68pp for the sentence over 416 trials each,
   verdict `no-transfer` on both.
2. `skipped.no-domain` is a ceiling, not a footnote. 24 accounts and 22 sentence rules could not be
   pointed at any foreign question because they carry no `scope.domain`; the store's most general
   claims are exactly the ones this instrument cannot ask about.
3. `full-transferred` and `full-repair-transferred` look identical to `none` for a structural reason:
   they carry 0.03 and 0.05 items per question. An arm that injects almost nothing is not a filtered
   memory, it is a memory with the filter's verdict and no content left.

### 13.8 How much of it arrives?

§13.4 filtered the pack, §13.6 changed what it is made of, §13.7 changed whether its items could be
pointed at a foreign question. All three left the pack's *size* at the default. This one varies nothing
but the character budget the pack layer is given, so the five cells are the same store, the same
ranking and the same question, one number apart.

```bash
# the dose curve: 0, 1, 2, 3 and 4 items per question, plus a replica of the no-memory cell
SOTA_ARMS=none,full,none-replica,chars-600,chars-1800,chars-2400 SOTA_LEARN_SAMPLE=128 pnpm eval:sota
```

```jsonc
// poc-sota-bird-dose.json, 350 questions, 5 folds, 2,263 calls, `none` at 54.00%
[
  { "arm": "chars-600",  "mean_pack_ids": 0.29, "mean_pack_chars": 168,  "accuracy": 0.5400, "delta_pp":  0.00, "p_value": 1.0 },
  { "arm": "full",       "mean_pack_ids": 1.83, "mean_pack_chars": 1080, "accuracy": 0.5143, "delta_pp": -2.57, "p_value": 0.1078 },
  { "arm": "chars-1800", "mean_pack_ids": 2.97, "mean_pack_chars": 1649, "accuracy": 0.5000, "delta_pp": -4.00, "p_value": 0.0094 },
  { "arm": "chars-2400", "mean_pack_ids": 4.16, "mean_pack_chars": 2212, "accuracy": 0.5114, "delta_pp": -2.86, "p_value": 0.1102 },
  { "arm": "none-replica", "mean_pack_ids": 0.00, "mean_pack_chars": 0,  "accuracy": 0.5257, "delta_pp": -1.43, "p_value": 0.1250 }
]
```

- **Read `mean_pack_ids` before any delta.** The pack layer adds whole items in rank order and returns
  an empty pack when none fits, so a budget is not a dial: `chars-600` admits one item on 100 of 350
  questions and nothing on the other 250. Its flat cell is 71% `none` by construction, and at that
  dilution a per-item cost of −5.0pp or a per-item gain of +6.0pp both sit inside its interval.
- **The curve is a step, not a slope.** Zero to 1.83 items costs 2.57pp; 1.83 to 4.16 items costs
  0.29pp more. A dispatch that measured an actual one-item cell (`chars-900` at exactly 1.00 item, in
  the iteration-86 run whose `full` cell is within 0.6pp of this one) cost −3.14pp, so the loss is
  complete at the first item and no budget above it changes anything.
- **No point is above `none`.** The best arm is the one that injects nothing, at +0.00pp, and the whole
  spread of the curve — 4.00pp — equals this sample's minimum detectable effect at 80% power. One cell
  clears its own bar; four do not.

**A budget cannot be the fix, because the smallest budget that injects anything already costs what the
default costs.** That is the product consequence, and it moves the work from quantity to the item: a
pack that *chooses* an item that fits rather than taking rank order and stopping, and a note that says
something about its own fallibility.

**Three ways to misread it.**

1. A flat cell at a small budget is usually an empty pack. `poc-sota-bird-dose.json` records
   `mean_pack_ids` and `mean_pack_chars` per arm; an arm at 0.27–0.29 items per question is a diluted
   control, not a one-item treatment.
2. Compare the curve's spread with `V5-resolution`, not with the bigger numbers from other sections.
   Here the spread and the floor are both 4.00pp, which is why only the worst cell clears.
3. `none-replica` is the floor and it moves. It was 3 discordant questions in iteration 86 and 7 here,
   negative for the first time (−1.43pp, 1 gained and 6 lost) — so `none` was the luckier of two
   identical prompts and every delta in the table is, if anything, generous.

### 13.9 What if the prompt says the notes may be ignored?

§13.8 closed the question of how much arrives; this one asks whether the block reads differently when
the prompt grants the model standing to disregard it. Three cells, one store, one budget, one
difference each: the same sentence appended to the pack (`full-advisory`), the same sentence with no
pack at all (`none-advisory`, the control), and the same items under a heading that classifies them as
records of failures rather than as workspace facts (`full-prohibitive`).

```bash
# framing: permission to ignore the note, the sentence alone, and the error register
SOTA_ARMS=none-advisory,full-advisory,full-prohibitive SOTA_LEARN_SAMPLE=128 \
  SOTA_PREREG=R17-framing pnpm eval:sota
```

```jsonc
// poc-sota-bird-framing.json, 350 questions, 5 folds, 2,110 calls, `none` at 54.86%
[
  { "arm": "none-advisory",   "mean_pack_ids": 0.00, "accuracy": 0.5286, "delta_pp": -2.00, "p_value": 0.0923 },
  { "arm": "full",            "mean_pack_ids": 1.81, "accuracy": 0.5086, "delta_pp": -4.00, "p_value": 0.0201 },
  { "arm": "full-advisory",   "mean_pack_ids": 1.81, "accuracy": 0.5029, "delta_pp": -4.57, "p_value": 0.0052 },
  { "arm": "full-prohibitive","mean_pack_ids": 1.81, "accuracy": 0.4971, "delta_pp": -5.14, "p_value": 0.0021 }
]
```

- **Permission is not the missing ingredient.** Paired against `full`, `full-advisory` is −0.57pp
  (10 gained, 12 lost, CI [−3.14, +2.00]): the sentence does not recover the block's cost, and the
  interval excludes a recovery big enough to have been worth writing it.
- **The sentence has a price.** `none-advisory` is 2.00pp below no memory on its own — a paragraph of
  instruction costs about what the 1,078-character block costs. Any mitigation that works by adding
  words has to clear a bar as high as the harm it repairs.
- **The register moves almost nothing.** Calling the same items records of failures instead of
  workspace facts lands 0.57pp below the advisory cell and 1.14pp below `full`, inside the interval.
  What the block says about itself is not what makes it expensive.
- **`V43-framing-delivered` is worth reading first.** It reports `0/350` for the two reference arms and
  `350/350` for each of the three that declare a framing: a cell that measured its own control under a
  second name would show as a delivery failure rather than as a flat delta.

### 13.10 Is the second pass worth anything on its own?

§13.9 measured what a sentence does to a block. This one measures what the two-call delivery
(`full-anchored`: draft with no pack, then revise with the pack) is worth against a second call that
injects nothing (`anchor-blank`). It had never been run, so the anchored cell's positive reading against
`full` could have been the second pass rather than the note.

```bash
# anchor control: the mechanism, the blind revision, and both reference arms
SOTA_ARMS=anchor-blank,full-anchored SOTA_LEARN_SAMPLE=128 \
  SOTA_PREREG=R18-anchored-control pnpm eval:sota
```

```jsonc
// poc-sota-bird-anchor.json, 350 questions, 5 folds, 1,762 calls, `none` at 54.00%
[
  { "arm": "anchor-blank",   "mean_pack_ids": 0.00, "accuracy": 0.5000, "delta_pp": -4.00, "p_value": 0.0336 },
  { "arm": "full-anchored",  "mean_pack_ids": 1.85, "accuracy": 0.5400, "delta_pp":  0.00, "p_value": 1.0000 },
  { "arm": "full",           "mean_pack_ids": 1.85, "accuracy": 0.5343, "delta_pp": -0.57, "p_value": 0.8318 }
]
```

- **The blind revision is not free.** Being shown your own draft and asked to revise it, with nothing
  added, costs 4.00pp (12 gained, 26 lost, p = 0.0336) — one sign in all five folds.
- **The note buys back exactly that.** `full-anchored` − `anchor-blank` is +4.00pp (27 gained, 13 lost,
  p = 0.0385) and `full-anchored` sits at *exactly* no memory. The anchored cell is a repair, not a gain.
- **The record's positive sign is smaller than the pooled figure.** Against `full` in the same run it is
  +0.57pp, not the +2.86pp pooled over two earlier dispatches; in those, `full` was costing −4.00pp. The
  gap is mostly the harm injection does, not a benefit anchoring confers.
- **`V44-domain-accounted` answered a question it was built to ask.** `184 item(s) with no domain, 184
  arrived unscoped, 0 widened`: nothing in this store became domain-free by generalisation, so the fix
  belongs in the interpreter's prompt and not in the widening policy.

### 13.11 Which half of the anchored prompt does the work?

§13.10 left two candidates for the anchored cell's +4.00pp: the note, and the clause that grants the
draft permission to stand. They differ along two dimensions, so the next iteration runs all four cells —
one store, one budget, one dispatch.

```bash
# the square: (block, no block) x (conservative clause, permissive clause)
SOTA_ARMS=anchor-blank,anchor-hold,full-anchored,full-anchored-hold SOTA_LEARN_SAMPLE=128 \
  SOTA_PREREG=R20-anchored-hold pnpm eval:sota
```

```jsonc
// poc-sota-bird-square.json, 350 questions, 5 folds, 2,460 calls, `none` at 54.57%
[
  { "arm": "anchor-blank",       "mean_pack_ids": 0.00, "accuracy": 0.5057, "delta_pp": -4.00, "p_value": 0.0336 },
  { "arm": "anchor-hold",        "mean_pack_ids": 0.00, "accuracy": 0.5257, "delta_pp": -2.00, "p_value": 0.1892 },
  { "arm": "full-anchored",      "mean_pack_ids": 1.83, "accuracy": 0.5343, "delta_pp": -1.14, "p_value": 0.3877 },
  { "arm": "full-anchored-hold", "mean_pack_ids": 1.83, "accuracy": 0.5286, "delta_pp": -1.71, "p_value": 0.3075 }
]
```

- **The clause and the note are substitutes, not partners.** The permissive sentence is worth +2.00pp
  where there is no block and −0.57pp where there is one: an interaction of −2.57pp. `full-anchored`'s
  own instruction already says "if none applies, return the first attempt unchanged", so the explicit
  licence adds nothing; with no block, it is the only licence there is.
- **The extra sentence is dropped.** `full-anchored-hold` − `full-anchored` is −0.57pp, inside the ±2pp
  band registered before the run. A prompt that already contains a licence does not need a second one.
- **The blind revision reproduced exactly.** −4.00pp, 12 gained, 26 lost, 38 discordant, p = 0.0336 —
  identical to §13.10 on an independently distilled store (640 corrections against 648).
- **Nothing in the square reaches no memory.** The best cell is `full-anchored` at −1.14pp, which is the
  delivery order already shipped; the note's content is worth at most about a point and is not
  distinguishable from zero at this n.

### 13.12 Can a filter make the note safe, and what does a raw correction do that a lesson cannot?

Two questions, one dispatch each. The first asks whether the store can be *cleared* of the rules that
measurably hurt; the second asks whether the prose the distiller writes is itself the thing that costs.

```bash
# a clearance against a control that removes the same number of rules at random
SOTA_ARMS=full-cleared,full-cleared-sampled SOTA_PREREG=R21-clearance pnpm eval:sota
# the same corrections, injected as the raw events rather than as distilled lessons
SOTA_ARMS=full-raw,full-raw-shuffled SOTA_PREREG=R22-raw pnpm eval:sota
```

```jsonc
// poc-sota-bird-clearance.json, 350 questions, 5 folds, 4,378 calls, `none` at 54.00%
[
  { "arm": "full",                  "mean_pack_ids": 1.83, "accuracy": 0.5200, "delta_pp": -2.00, "p_value": 0.2810 },
  { "arm": "full-cleared",          "mean_pack_ids": 1.51, "accuracy": 0.5171, "delta_pp": -2.29, "p_value": 0.2005 },
  { "arm": "full-cleared-sampled",  "mean_pack_ids": 1.51, "accuracy": 0.5171, "delta_pp": -2.29, "p_value": 0.1849 }
]
```

- **Clearing the measured-harmful rules changed nothing, and the artefact says why.** The pair is
  `+0.00pp` (6 gained, 6 lost, p = 1.0000) and `V45-clearance-dose-matched` reports **311 of 350
  questions identical**: on 89% of questions a single-item pack lost its only item in *both* arms, so the
  treatment was absent rather than null.
- **77% of the store has no counterfactual record at all.** 104 of 1,400 learn questions were decisive
  (the outcome changed with and without the pack), and they credited 143 of 628 rules. A perfect
  clearance could have filtered at most 23% of this store.
- **What to do instead if you are deploying this.** Do not build a per-rule utility filter on a store of
  single-observation items: the signal it needs is not in the data yet. Either measure per rule over more
  questions, or change what is stored — which is §13.13.


### 13.13 Does the raw event do what the distilled lesson cannot?

The last content axis, and the only one that changes the *object* rather than a filter over it. Every
earlier arm injected an interpretation — a rule, a repair note, a procedure — written by a distiller that
read one correction. This one injects the correction itself: the question that was asked, the query that
came back wrong, the query that fixed it, whole and unedited.

```bash
SOTA_ARMS=full-raw,full-raw-shuffled SOTA_PREREG=R22-raw pnpm eval:sota
# V46-raw-is-verbatim fails the run if a single rendered block differs from the event it came from
```

```jsonc
// poc-sota-bird-raw.json, 350 questions, 5 folds, 1,755 calls, `none` at 54.00%
[
  { "arm": "full",               "mean_pack_ids": 1.82, "mean_pack_chars": 1083, "accuracy": 0.5143, "delta_pp": -2.57, "p_value": 0.1078 },
  { "arm": "full-raw",           "mean_pack_ids": 1.59, "mean_pack_chars":  864, "accuracy": 0.5057, "delta_pp": -3.43, "p_value": 0.1038 },
  { "arm": "full-raw-shuffled",  "mean_pack_ids": 1.39, "mean_pack_chars":  763, "accuracy": 0.5200, "delta_pp": -2.00, "p_value": 0.3240 }
]
```

- **Raw evidence is not better than a distilled note here.** `full-raw` − `full` = **−0.86pp** (20 gained,
  23 lost, p = 0.7608, 95% CI [−4.57, +2.86]). The interval contains the +1pp the design was aiming at,
  so the honest reading is not "the substrate is not the loss" but "350 questions cannot resolve 1pp":
  the paired interval is ±3.7pp wide.
- **The subject of the correction does not matter.** `full-raw` sits **1.43pp below** its own shuffled
  control — the same form filled with other questions' SQL from the same database. Whatever the arm
  measures, it is not knowledge about the question in front of it.
- **All three text forms are indistinguishable and all three are below no memory.** Largest pairwise
  difference 1.43pp, every p > 0.54; each 2.0–3.4pp under `none`. Pooled across the three arms and 1,050
  arm-question cells, showing any text costs **−2.67pp** (40 gained, 68 lost, exact p = 0.0091) — an
  exploratory number, since the registration spent its resolution on a 1pp claim instead.
- **What to do if you are deploying this.** On a task where the question already carries its schema, its
  evidence and its database, the retrieval layer does not pay for the attention it takes. Ship the store
  and use it for audit, for diffing, for regression explanation — and gate injection behind evidence you
  do not have yet, because the answer this lane gives for every text form it can render is: show nothing.
- **If you build your own verbatim arm**, note what this one cost to get right: the gate's first version
  split the payload into lines and matched each against a field, which read every multi-line SQL query as
  a rewritten one. The unit has to be the block. `V46` now reports the block it rejected, and
  `rawEventVerbatim` is exported so the check travels with the renderer.


### 13.14 What the benchmark's own hint is worth, and what it means for your deployment

Every question in BIRD ships with a curated `evidence` sentence — a line of human-written domain knowledge
attached to that question. This project's prompt has always carried it, on **350 of 350** questions at a mean
of 142 characters, and every number in this guide was measured on top of it. R23 removed it, in a 2×2 that
also turns a pack on and off, because three published ablations already price the removal at 8 to 21 points
and no memory experiment here had ever been run against a manipulation anyone else had measured.

```bash
SOTA_ARMS=none-noevidence,full-noevidence SOTA_PREREG=R23-evidence pnpm eval:sota
# V47-evidence-ablated fails the run if an ablated arm still carried the sentence, or a shipped arm lost it
```

```jsonc
// poc-sota-bird-evidence.json, 350 questions, 5 folds, 1,758 calls, twelve gates
{ "none":              { "accuracy": 0.5457 },                       // 191/350
  "full":              { "accuracy": 0.4971, "delta_pp": -4.86 },    // 174/350, p = 0.0076
  "full-noevidence":   { "accuracy": 0.3086 },                       // 108/350
  "none-noevidence":   { "accuracy": 0.2971 } }                      // 104/350

// evidence, no pack      +24.86pp  [19.71, 30.00]   96 gained /  9 lost  p < 0.0001
// evidence, with pack    +18.86pp  [14.00, 24.00]   80 gained / 14 lost  p < 0.0001
// pack, with evidence     -4.86pp  [ -8.29,  -1.43]  27 gained / 10 lost  p = 0.0076
// pack, no evidence       +1.14pp  [ -4.29,  +2.00]  13 gained / 17 lost  p = 0.5847
// interaction             -6.00pp  [-10.57,  -1.71]  19 up / 37 down / 294 flat
```

- **The hint is worth 24.86 points, and the panel can see it.** Ninety-six questions are right with the
  sentence and wrong without it, nine the other way. Whatever else this project reports, its instrument is
  calibrated: an effect three times the size of anything it has published came back at p < 0.0001.
- **The pack costs 4.86 points *because the hint is there*.** With the sentence present, showing a pack is
  −4.86pp and significant. With the sentence removed, the same pack is **+1.14pp** and indistinguishable
  from zero — the first cell in this record that is not negative. The interaction is −6.00pp with an
  interval that excludes zero: a retrieved note absorbs **24.1%** of what the hint supplies and loses the
  competition for the rest.
- **So the deployment rule is a switch, not a policy.** If the incoming question already carries curated,
  per-question knowledge, do not inject — that is R22's abstention, now with a mechanism. If it does not,
  inject: the note stops costing points and starts paying about one.
- **4.6% is what a memory of past questions is worth against one curated sentence.** It is the first
  measurable ceiling this project has had, and it is low. Most of the 24.86 points is knowledge about *this*
  question — which columns, which values, which arithmetic — and a note written for another question cannot
  supply it.
- **If you are building the same measurement**, note what the anchors did: `none` moved 54.00% → 54.57% and
  `full` 51.43% → 49.71% between two dispatches on identical questions, because the store is rebuilt from a
  live distillation pass each time (632 corrections here, 640 there). **Cross-dispatch comparisons on this
  lane carry one to two points of store variance.** Compare inside a run, or re-measure the anchor.


### 13.15 The same 2×2 on the full split, and what the smaller panel was measuring

13.14 reports 24.86 points on 350 questions. The obvious objection is that every competitor the number is
compared with was measured on BIRD's full dev split, 1,534 questions — so R24 ran the identical four cells on
1,534, holding the store size fixed at `learn_sample=280` so the split is the only difference.

```bash
SOTA_SPLIT=dev SOTA_LEARN_SAMPLE=280 SOTA_PREREG=R24-dev-split pnpm eval:sota
# V48-statements-answered fails the run if >1% of executed statements hit the deadline
```

```jsonc
// poc-sota-bird-dev-R24-dev-split.json — 1,534 questions, 5 folds, 6,571 calls, thirteen gates
{ "none":            { "accuracy": 0.5743 },   // 881/1534
  "none-noevidence": { "accuracy": 0.3983 },   // 611/1534
  "full":            { "accuracy": 0.5684 },   // 872/1534
  "full-noevidence": { "accuracy": 0.4055 } }  // 622/1534

// evidence, no pack     +17.60pp  [15.38, 19.82]   315 gained / 45 lost   p < 1e-4
// evidence, with pack   +16.30pp  [14.14, 18.58]   300 gained / 50 lost   p < 1e-4
// pack, with evidence    +0.59pp  [ -0.91, +2.09]   73 gained / 64 lost   p = 0.4944
// pack, no evidence      -0.72pp  [ -2.15, +0.72]   60 gained / 71 lost   p = 0.3824
// interaction            -1.30pp  [ -3.06, +0.46]   86 up / 105 down / 1343 flat
```

- **The hint is worth 17.60 points on the full split, and 22.99 on the mixture the 350-question panel
  keeps.** Stratified inside the same run: `simple` (n=925) **+14.05pp**, `moderate` (n=464) **+22.63pp**,
  `challenging` (n=145) **+24.14pp**. The whole-split figure is a weighted average of those, exactly:
  `925/1534 × 14.05 + 609/1534 × 22.99 = 17.60`. **24.86 was never inflated — the panel had no `simple`
  questions in it.** Quote 17.60 against a system evaluated on the whole split, 22.99 against one evaluated on
  moderate-and-challenging questions, and never mix the two.
- **The pack is null, twice.** +0.59pp with the hint, −0.72pp without it, neither interval excluding zero, both
  below the ±2.14pp this split resolves. The +1.14pp from 13.14 does not replicate at 4.4× the sample: the
  defensible statement is *injecting a pack neither helps nor hurts*, and the abstention rule from 13.14 is
  now justified by inertia rather than by a penalty.
- **The interaction that explained the pack's cost did not replicate.** −1.30pp [−3.06, +0.46] against
  −6.00pp on 350 questions. The registered clause fires: substitution is a single-run observation, not a
  mechanism. If you are deciding whether to build a memory at all on this task, the evidence now says the
  benchmark's own hint is the thing that matters and a pack of past corrections is inert either way.
- **If you build the same measurement, budget for the judging phase.** A statement the model wrote can be a
  three-way cross join, and a synchronous driver freezes the whole process inside it — the first attempt at
  this run published nothing after 3.4 hours. Every statement here runs in a child process with a 20-second
  deadline (`SOTA_SQL_DEADLINE_MS`) and a 10,000-row cap (`SOTA_SQL_ROW_CAP`); this dispatch hit the deadline
  on **16 of 10,160 statements (0.16%)**. A deadline is not a wrong answer, and `V48` is what keeps the
  difference visible.


### 13.16 One item or four, and who decides — measuring a dose control and an admission rule

13.15 ends with a null and no way to tell *which* null. R25 added the two arms that separate them, and both are
useful to anyone running a retrieval-augmented generator: a **dose control** (`full-one` — the same ranked pack,
truncated to its first item) and a **per-question admission rule** (`full-accepted` — one item, only where the
question admits it).

```bash
SOTA_SPLIT=dev SOTA_LEARN_SAMPLE=280 SOTA_PREREG=R25-dose-and-admission \
SOTA_ARMS=none,full,full-one,full-accepted pnpm eval:sota
# the admission floor is fitted per fold on that fold's learning rows:
#   SOTA_ADMISSION_KEPT=0.5      minimum share of decisions kept
#   SOTA_ADMISSION_DECISIVE=8    minimum decisive rows for a threshold to be considered
```

```jsonc
// poc-sota-bird-dev-R25-dose-and-admission.json — 1,534 questions, 5 folds, 9,096 calls, fourteen gates
{ "none":          { "accuracy": 0.5717 },   // 877/1534, 0.00 rules/question
  "full":          { "accuracy": 0.5711 },   // 876/1534, 1.74 rules/question
  "full-one":      { "accuracy": 0.5678 },   // 871/1534, 1.00 rules/question
  "full-accepted": { "accuracy": 0.5763 } }  // 884/1534, 0.67 rules/question, 1027/1534 admitted

// full-one       - full            -0.33pp  [-1.56, +0.85]   42 gained / 47 lost   p = 0.6718
// full-one       - none            -0.39pp  [-1.76, +0.91]   52 gained / 58 lost   p = 0.6338
// full           - none            -0.07pp  [-1.50, +1.30]   60 gained / 61 lost   p = 1.0000
// full-accepted  - full-one        +0.85pp  [-0.13, +1.83]   35 gained / 22 lost   p = 0.1112
```

- **A dose reading is not a dose effect until you truncate.** Questions that received two items scored 4.13pp
  above questions that received one — and when the same order is truncated to one item for *every* question,
  the difference is **−0.33pp**. The store was giving its second item to the questions it had more to say
  about, and those were the questions where a note of either length was worth more. **If your retrieval
  budget varies per question, that variation is an allocation decision and needs its own control.**
- **`V49-dose-truncated` is the check that makes the control a control.** It fails the run unless the truncated
  arm differs from the full arm on a substantial share of prompts (`≥20%`) *and* exceeds one item on **zero**
  of them. Here: 1,133 of 1,534 (73.9%) differ, 0 over budget.
- **An admission rule needs a verifiable record that it decided.** `V50-admission-engaged` requires, per fold,
  that the floor was **fitted** (not defaulted), that something was admitted and something was refused. Here:
  5/5 folds `fitted`, floors 0.111–0.200, admitted 66.9%. Without that gate a rule that admits everything and a
  rule that works produce the same artefact.
- **The best pack result in this repository is +0.85pp and it is still not a result.** The interval's lower
  bound excludes harm above 0.13pp; it does not exclude zero. What makes it interpretable is a second number
  the run produced for free: of 507 questions refused the note, all 507 got a **byte-identical** prompt and
  moved **4 gained / 3 lost — 1.4%**. That is the endpoint's own noise floor, and 0.85pp is 3.4pp of gross
  movement on top of it.
- **Compute your own ceiling before designing the next arm.** With the answer key in hand, dropping every
  net-harmful item is worth **+2.35pp** and keeping the pack exactly where it helped is worth **+4.17pp**, on a
  split that resolves **2.01pp**. An oracle that prices the whole mechanism below your instrument is telling you
  to stop measuring that mechanism here, not to run a bigger n on the same questions.
- **Pairwise contrasts are re-derivable from the artefact**, so you never quote a lane's own arithmetic
  unchecked: `SOTA_ARTEFACT=eval/results/<run>.json pnpm eval:arm-contrast --left full-accepted --right full-one`
  reprints the contrast, the interval and the discordant pairs from the committed file.

### 13.17 Two channels that change the schema, and the gate that proves they fired

Everything up to here changed *what the model was told about past mistakes*. R26 changed *what the model knows
about the database*: `values` annotates every column with the values it holds, `linked` prunes the schema to
the tables the question names. Both are one-flag arms, and one of them is the largest single effect in this
guide's measurements — in the wrong direction.

```bash
SOTA_SPLIT=dev SOTA_LEARN_SAMPLE=280 SOTA_PREREG=R26-channels \
SOTA_ARMS=none,full,values,linked pnpm eval:sota
# V51-channel-applied fails the run unless each channel arm actually rewrote the prompt
```

```jsonc
// poc-sota-bird-dev-R26-channels.json — 1,534 questions, 5 folds, 6,504 calls, thirteen gates
{ "none":   { "accuracy": 0.5743 },   // 881/1534
  "full":   { "accuracy": 0.5776 },   // 886/1534 — the pack, as the anchor
  "values": { "accuracy": 0.5860 },   // 899/1534 — every column annotated with its values
  "linked": { "accuracy": 0.4817 } }  // 739/1534 — schema pruned to the named tables

// values - none   +1.17pp  [-0.13, +2.48]   64 gained / 46 lost   p = 0.1046
// linked - none   -9.26pp  [-10.95, -7.63]  24 gained / 166 lost  p < 1e-4
```

- **Do not prune the schema to the tables the question names.** −9.26pp is 4.5 times this split's detection
  floor, with 166 questions broken against 24 repaired, and the damage is worst on the easiest questions
  (`simple` −10.2pp, `moderate` −8.4pp, `challenging` −5.5pp). The evidence sentence routinely names a table the
  question does not, and a pruner deletes exactly that table. **The whole DDL is the better prompt**, and the
  published schema-linking ablations (RSL-SQL 12.71pp) price the removal of a component those systems already
  have, not the addition of one you do not.
- **Column-value annotation is worth about a point and cannot be confirmed here.** +1.17pp, 64 gained against
  46 lost, p = 0.10 — the largest positive prompt-side effect this project has measured — with an interval
  [−0.13, +2.48] on a split that resolves 2.07pp. If your budget is one experiment, this is a candidate; if
  your budget is one *claim*, it is not yet one.
- **A channel arm that rewrote nothing is your control under another name.** `V51` is why the numbers above
  mean something: `values` fired on **1534/1534** prompts and `linked` on **558/1534 (36.4%)**. Without that
  reading, an annotator whose value sampler returned no rows would report `full`'s +0.33pp as "annotation is
  inert". The gate holds the two kinds to different floors (95% and 1%) because annotation is unconditional and
  pruning is not, and it prints the share rather than thresholding it.
- **Measure the channel on the split that can see it.** The same two arms at n=350 read +1.43pp [−1.43, +4.29]
  and −7.71pp [−11.14, −4.57] against a 4.87pp floor: the numbers are consistent, the *conclusions* are not,
  and the 350-question panel cannot tell a one-point annotation from zero.



### 13.18 How many rules to put in a prompt, and why the answer is not a number

13.16 showed that truncating the pack to one item for every question is **−0.33pp** on 1,534 questions, and
that the +4pp contrast the question belongs to is a property of *which questions* retrieval served one rule.
R36 turns that into a rule you can use, and the rule is not "pick k".

- **The pack is not additive.** Take the two arms apart on the questions where they disagree. The second rule
  repairs 23 questions the single rule misses and breaks 27 the single rule gets right — a 0.85 ratio, i.e. a
  net harm on its own record — and it *also* prevents **15 repairs** and **24 breaks** the single rule would
  otherwise have made. Removing it is not a subtraction, because the first rule answers differently when it is
  alone in the block.

```text
  the question was …              pair right   pair wrong
    one the bare model missed           23           15
    one the bare model answered         24           27
  ─────────────────────────────────────────────────────
  net effect of the second rule: +23 +24 −15 −27 = +5 questions (0.33pp on 1,534)
```

- **So do not tune the count; tune the retrieval.** A budget, a top-k or a density threshold moves the *set*
  of rules a prompt carries, and the marginal rule's effect depends on which rules are already there. If you
  want the knob to behave, ask what a rule says about *this* question (13.9's coverage, 13.12's ledger) rather
  than how many of them fit.
- **The exchange rate is the cheaper check.** The bare model answered 877 of 1,534 questions, so break-even is
  not parity but 1.335 repairs per break. A two-item pack clears **0.737** of that; a one-item pack clears
  **0.672**. Before designing an arm, compute your own hurdle — `repairable` and `breakable` are both in the
  artefact — because an arm can be a wash in percentage points and still move away from paying.
- **Reproduce it yourself.** `POC_PACK_ARTEFACT=eval/results/poc-sota-bird-dev-R25-dose-and-admission.json
  pnpm eval:pack-assign` recomputes the contrast, both exchange rates and the four-cell decomposition from the
  committed run and writes `poc-pack-assign.json`; thirty-two of its fields are asserted in CI. The module is
  `packages/eval/src/assignment.ts`, 100% covered on all four dimensions.
- **Before you trust any single number in your own store, split it by fold — and if you can afford it, run the
  split twice.** `reading.folds` is the same four cells recomputed on the questions each fold held out, with an
  interval each; `replication.foldPairs` pairs those folds against a second store draw of the same seeded
  split. Here the two draws read 0/−2, −4/−1, +4/+5, −5/−1, 0/−2: three folds keep their sign, and the only
  fold that ever looked decided (−5, interval [−2.55, −0.66]) covers zero on the second draw. The lesson for
  your own system is the one this project paid a dispatch to learn: **a fold with a decided-looking interval is
  a hypothesis, not a result, until a second store reproduces it.** The per-fold table costs nothing — it is
  the same artefact grouped differently — and the paired column costs one re-run of the distillation.
- **If a dev dispatch fails at the first question**, check the manifest's `nested`/`nestedRoot` pair before
  anything else: `dev.zip` ships its databases as `dev_databases.zip`, and a manifest that does not say so
  extracts a directory holding only a zip. The lane now checks all eleven databases once, right after
  extraction, and names the missing field.

**Why a definition pays less than it looks like it should.** If you have read that this project built a
definitional memory and that it reached 8.6% of a benchmark, the natural next question is whether the store
was built badly. It was not. The counterfactual is in the corpus: rank the keys the benchmark's own
annotations use by how many questions they reach, and a store of the same size reaches 241 of 1,534 rather
than 132 — near enough that no construction change closes the gap. The reason is a property of how questions
are written: the phrases a corpus defines are the phrases it mentions once (96.7% of them are annotated in
every question that uses them), and the phrases it mentions often are the ones it leaves undefined (7.7%).
A memory that must be retrieved by the question's own words can only act on words that come back. Before
building a definitional layer over your own corpus, measure that recurrence; the number is available without
a model call.

### 13.19 When the distiller answers nothing — three silences, three fixes

A distillation call can come back with nothing in it in three different ways, and they are not the
same problem. The census in `distillReplies` separates them, and so should your reading of a store
that came out smaller than you expected.

| state | what came back | what it means | what to change |
| --- | --- | --- | --- |
| `empty` | `[]` or `{"candidates":[]}` | the model read the correction and chose silence | the example or the instruction: there was nothing to generalise |
| `blank` | `""`, `"\n\n"` — no visible character | the call returned nothing at all | the model, the form, or the completion budget — this is not a prompt-tuning problem |
| `unparsed` | prose or a truncated object | the model answered and the parser could not read it | the format instruction, or the token ceiling |

A real dispatch from this project's own benchmark read `73 call(s), 0 empty, 6824 character(s)
returned` and looked healthy; 63 of the 73 were **blank**, six claims reached the store, and the pack
limit then served five of those six to every request. Two lessons transfer:

- **Check the partition, not the total.** `answered + empty + blank + unparsed` must equal `calls`.
  Any line that reports one of them without the others can call a broken writer healthy.
- **Check what the store covers.** Six items against a five-item pack limit is not a retrieval any
  more: it is a constant prefix on every prompt, and a score measured under it says nothing about
  what retrieval would do with a store as wide as your corpus.

**And check which writer wrote it.** `distillWriter` reports `model`, `fallback`, `mixed` or `none`,
decided by which side produced *claims* and not by which side was called: a rule interpreter can be
invoked on every event and return nothing, and a store whose every claim came from the model is not
the fallback's because the fallback ran. `modelCoverage` sits beside it — the share of corrections
the model answered at all — which is the number that tells you whether a store represents its
population.

### 13.20 When the store is full and all of it is format

A store can pass every count and still be useless, and the failure has no symptom: items are stored,
`recall` serves them, the pack is full, and the score does not move. This project's own benchmark
produced exactly that store — six claims, five of six carrying a `when`, `pass^4` 0.550 against a bar
of 0.575 — and every one of the six was a fact about the wire format:

```
Action list entries are objects with a name field and an arguments object …
A pending-order item change records the id in item_ids and the replacement in new_item_ids …
The address update is ordered before the item modification on the same pending order …
```

Nothing there says *what a request of a given shape requires*. A schema validator already knows the
first, second and fourth; the third is the only one a store is needed for. Three numbers tell the two
kinds apart, and all three are cheap to read:

| number | where it comes from | what a low value means |
| --- | --- | --- |
| **entity survival** — concrete values that reach a claim | `faithfulness.kept` / `.entities` | `0 of 667` means no claim is about any particular order, which is fine for transfer and fatal for answering |
| **median coverage of an injected pair** | `coverage.medians.medianAllPairs` | `4.76%` means the median injected item matches one word in twenty of a request |
| **refused share at the ban** | `distillForm.refused` / `distillUnit.claims` | `10 of 16` means the filter removed most of what was written, and the survivors are the abstracted half |

If all three are low, the problem is upstream of retrieval and no amount of recall tuning reaches it.

**The ban is usually the cause, and it is one boolean.** A tool-name ban refuses any claim that names
one of the actions the scenario defines, so a claim cannot say `cancel_pending_order`. It exists so a
claim can transfer to an unseen scenario, and it works: the six survivors name no tool. What it also
does is delete the candidates that say *which operation applies* — the operational half — leaving the
residue that generalises because it says almost nothing. Measure both sides before choosing: run the
same population with and without `accept: toolGuard.accept` and read the store's own text, not only
the score.

**Before you change the ban, check the writer.** `pnpm eval:writer-probe` asks one correction through
every `(model, form)` pair you name, one call each, and reports which pairs write a claim carrying a
`when`:

```bash
pnpm eval:writer-probe \
  --models deepseek-flash,deepseek-chat \
  --forms lesson,repair,procedure,lexicon \
  --out eval/results/writer-probe.json --summary eval/results/writer-probe.md
```

Three verdicts, and the difference between the last two matters: `viable` means at least one pair
wrote a conditioned claim, `no-writer` means every call returned and none did (a result — change the
form or the ban), `unanswered` means the calls threw (an outage — change nothing, rerun). It asks about
a fixture, so `viable` permits a dispatch and does not promise one: the fixture states a rule and your
corrections may not.

### 13.21 Reading a score without inventing a result

Every score this project prints now carries its interval, because a point estimate beside a
published bar is the reading that turns "0.550 against 0.575" into a result when the two numbers are
2.50pp apart on a measurement whose half-width is 15.42pp:

```
per-failure pass4 55.00% ±15.42pp served 164/164 items/req 5.000 chars/req 2102 folded 0
```

**Which ruler, before which sentence.** Three quantities are in play and they are not
interchangeable:

| your sentence | the ruler | at 40 tasks | at 68 tasks |
| --- | --- | --- | --- |
| "memory helped by X compared with no memory" | `detectableDelta(tasks, 0.397)` | 27.91pp | 21.41pp |
| "our score is above 0.575" | `±1.96·sqrt(p(1−p)/n)` | **15.42pp** | 11.86pp |
| "we are behind ALTK-Evolve" | difference of two scores | 17.65pp | 14.65pp |

A **paired delta** compares two arms of one dispatch over the same tasks, so the pairs that did not
change hands cancel and the width depends on how many did — that is why it is both the most sensitive
ruler when few pairs change and the most brutal when many do. An **absolute score** carries only its
own sample's variance. A **cross-sample** comparison carries both, and none of the pairing.

**Three rules that follow, and each one is arithmetic rather than caution.**

1. **To claim a score is above a bar, the interval's lower bound must clear it.** At 40 tasks that
   needs **p ≥ 0.75**; 0.70 gives a lower bound of 0.558 and 0.65 gives 0.502.
2. **A paired delta below its floor is not a finding, whatever its sign.** At 40 tasks the floor is
   44.30pp at complete discordance; R104's 17.5pp null contrast is inside it, which is what a null
   contrast means.
3. **A cross-sample gap must be compared with the *difference's* width, not with either run's.** The
   τ² lane's 0.5500 against ALTK-Evolve's 0.6754 is 12.54pp with a 17.65pp half-width on the
   difference: indistinguishable, and the same is true of every adjacent pair on that board.

**Where each number comes from, and what to run.**

```bash
pnpm eval:power          # every published paired delta beside its own floor, plus coarsest/sharpest
pnpm eval:prereg <file>  # refuses a header that claims an effect its sample could not resolve
```

`eval:power` prints `coarsest design … at N pp — no delta smaller than that is a finding on this
record`. That line is the honest ceiling on every claim written against this run.

### 13.22 Which bar a score is graded by, and how to tell from the output

Two different bars appear in this project and they differ by more than a rounding:

| bar | rule | at 40 tasks, published 0.575 |
|---|---|---|
| `point` | `score >= published + 0.05` | **0.625** clears it |
| `interval` | `score − 1.96·sqrt(p(1−p)/n) > published` | **0.750** clears it, 0.63 does not |

A registration names which one it is graded by, in its header:

```
claimRuler: interval
```

Absent means `point`, which is what every dispatch before the header existed ran, so adding the key
does not change what an old artefact's verdict was. The gate prints the rule it applied, including the
half-width it subtracted:

```
PASS l4-pass4 0.78 (> published + the sample's half-width (12.84pp at n=40))
FAIL l4-pass4 0.63 (> published + the sample's half-width (14.43pp at n=40))
```

The second line is the case worth recognising: 0.63 beats the published 0.575 by 5.5 points and is
still not a claim, because a 40-task sample cannot separate a 5.5-point lead from zero. If you see a
green `l4-pass4` whose criterion says `>= published + 0.05`, you are looking at the point ruler — the
score cleared a fixed margin, not its own interval.

**Why the gate computes this itself.** It used to be handed a boolean computed somewhere else, and
printed a criterion beside it that could disagree with the number it was grading. A gate that receives
a verdict cannot state the rule, and a rule that lives only in a registration's prose cannot be applied
by anything. Both halves are now the same function, and a registration whose header does not parse
stops the run rather than falling back to the weaker bar.

## 14. Performance and limits

Measured on a 2-vCPU CI runner, Node 22, no GPU:

| Items in store | Loading them | `recall` p50 | `recall` p95 | Heap |
|---|---|---|---|---|
| 1,000 | 16 ms | 1.3 ms | 1.9–3.9 ms | 6 MB |
| 10,000 | 94 ms | 2.1 ms | 2.7–3.1 ms | 29 MB |
| 50,000 | 421 ms | 8.9 ms | 10.8–12.2 ms | 113–119 MB |
| 100,000 | 946 ms | 18.6 ms | 22.7–24.7 ms | 174–199 MB |

"Loading" is building the index from a fresh store, which is what a cold start pays. A warm reopen replays
the journal instead, and is cheaper because the scoring already happened: **26 ms against 57 ms for 10k
items**, measured the same way on the same machine.

Two things to read from that table, and one of them is not latency.

**Latency is not your problem until very late.** The scope scan is O(n) per query, and at 100k rules it is
still ~23 ms at p95 — one fifth of the 100 ms budget this repository gates on. A sidebar or an
autocomplete stays comfortable.

**Memory is the constraint.** About **1.7–2.0 KB per rule**: 100k rules is ~200 MB of heap in a single Node
process. That is what a small container or a browser tab runs out of, and it arrives around **130k rules**
against the 256 MB budget the library holds itself to. If you expect to keep more than that, plan for the
SQLite index (the store is already an interface) rather than for a bigger box.

Pack size is budgeted, not cumulative: 1k and 100k stores both inject ~258 tokens per question, because the
pack is chosen by relevance under a character budget. Distillation is O(events × rules); an LLM interpreter
costs one model call per feedback event.

## 15. Recipes

### 14.1 A domain pack in eighty lines

```ts
import type { DistillCandidate, FeedbackEvent, RunRecord } from '@agentix-e/microglia-core';

type SqlEdit = { readonly sql: string };

const isSql = (value: unknown): value is SqlEdit =>
  typeof value === 'object' && value !== null && typeof (value as SqlEdit).sql === 'string';

export function sqlInterpreter({ event, run }: { event: FeedbackEvent; run?: RunRecord }) {
  if (event.signal.type !== 'edit' || !run || !isSql(run.output) || !isSql(event.signal.after)) return [];
  const before = run.output.sql.trim();
  const after = event.signal.after.sql.trim();
  if (before === after) return [];

  // The lesson is the clause the user changed, scoped to the schema it changed in.
  const clause = after.includes('WHERE') && !before.includes('WHERE') ? 'filter' : 'projection';
  return [{
    namespace: event.namespace,
    kind: 'constraint',
    scope: { task: event.task, schemaDigest: String(run.input['schemaDigest'] ?? '') || undefined },
    statement: `For this schema, ${clause === 'filter' ? 'exclude cancelled rows explicitly' : 'select only the columns the question names'}.`,
    payload: { clause },
    evidence: { feedbackId: event.id, runId: event.runId, at: event.at, weight: event.trust },
    trust: event.trust,
    dedupeKey: `${event.namespace}|${clause}`,
  }];
}

// A semantic distance: rewriting the WHERE clause is a different query, not a typo.
export const sqlEditDistance = (before: unknown, after: unknown): number | undefined => {
  if (!isSql(before) || !isSql(after)) return undefined;
  return before.sql.replace(/\s+/g, ' ').length === after.sql.replace(/\s+/g, ' ').length ? 0.2 : 0.8;
};
```

### 14.2 Batch distillation in a worker

```ts
setInterval(() => {
  void mg.distill().then((report) => {
    if (report.created + report.generalized > 0) log.info(report);
  });
}, 60_000).unref();
```

### 14.3 Two tenants, one process

```ts
const stores = new Map<string, EmbeddedMemory>();
const forTenant = async (tenant: string) => {
  const existing = stores.get(tenant);
  if (existing) return existing;
  const store = await EmbeddedMemory.open(new JsonlJournal({ dir: `./.microglia/${tenant}` }));
  stores.set(tenant, store);
  return store;
};
```

Separate directories *and* separate namespaces. Retrieval never crosses a namespace, and a test in
this repository asserts it, but defence in depth is cheap here.

## 16. Server and browser

A single process needs `core` only. Once a browser has to capture feedback, the credentials and the
journal belong on a server, and the library ships both halves.

### 15.1 The server

```ts
import { createServer, listen, deepseekProvider } from '@agentix-e/microglia-node';

const server = await createServer({
  dir: './.microglia',            // one writer per directory
  namespace: 'acme',              // the tenancy boundary
  token: process.env.MICROGLIA_TOKEN,
  llm: deepseekProvider({ apiKey: process.env.DEEPSEEK_API_KEY! }),
});
listen(server, 8080);
```

Six endpoints, each one call into the same facade you would have used in-process:

| Route | Purpose |
|---|---|
| `POST /v1/feedback` | ingest one run and the reaction to it; returns `runId` and `eventId` |
| `GET /v1/recall` | the pack for a query; same options as `recall`, as query parameters |
| `POST /v1/distill` | fold accumulated evidence into knowledge |
| `GET /v1/knowledge` | list rules with status, trust, and scope; `?status=active\|all`, `?limit=<n>` |
| `POST /v1/forget` | erase by `ids`, `taskId` or `actorHash`; returns the tombstone and counts |
| `GET /v1/health` | the doctor's diagnosis and the store counts |

Four properties are deliberate. A request must carry `Authorization: Bearer <token>` when a token is
configured; a retry may carry `Idempotency-Key`, and the same key returns the same ids instead of
recording the correction twice; every route **rejects** an unknown field, a mistyped value and an
out-of-vocabulary query parameter instead of doing something adjacent and reporting success; and the key
map is per process and holds the last 1,000 keys — a durable one belongs to your deployment, and the
library says so rather than pretending otherwise.

The strictness is worth one paragraph because it is not decoration. `GET /v1/knowledge?status=bogus` used
to answer **200 with an empty list**, which is indistinguishable from "you have no knowledge": a typo read
as a fact. `?limit=abc` did the same through `NaN`, and `?limit=-1` silently dropped the last row.
`{"generalize": "false"}` — a string, not a boolean — was dropped in silence, so the *wider* distillation
the caller was trying to switch off ran instead. All four are now refusals:

| Mistake | Answer |
|---|---|
| `?status=` anything but `active` or `all` | `400 MG_E_SCHEMA_INVALID`, naming the allowed values |
| `?limit=0`, `-1`, `2.0`, `abc`, `1e3` | `400`, because a count of rows is written in digits |
| `{"generalize": "false"}` | `400`, not the default |
| `{"run": {"taskID": "t_7"}}` | `400 run.taskID is not a field` |
| unknown body field | `400 unknown field: <name>` |

A run may name its task instance, which is what makes evidence independent and deletion by task
possible:

```json
{ "run": { "task": "chart.recommend", "taskId": "t_7", "attempt": 2,
           "parentRunId": "run_01j9z3k4", "actorIdHash": "sha256:…", "input": {}, "output": {} },
  "feedback": { "type": "edit", "after": { "mark": "line" } } }
```

Without `taskId` every event is its own task: three attempts at one job would count as three
independent endorsements, and `{ "taskId": "t_7" }` on `/v1/forget` would match nothing.

`actorIdHash` is what makes `{ "actorHash": "sha256:…" }` on `/v1/forget` mean anything: the route
accepts that selector, so the ingest has to be able to record the identity it names. It is a salted hash
of the person, never a raw identifier, and it does **not** raise trust — trust comes from the channel's
ceiling and from corroboration across tasks, never from what a request says about itself.

### 15.2 The browser

```ts
import { createClient, persistedOutbox } from '@agentix-e/microglia-browser';

const mg = createClient({
  endpoint: 'https://api.example.com',
  token: await getToken(),
  outbox: persistedOutbox(localStorage),
});

const pack = await mg.recall({ task: 'chart.recommend', text: question });
await mg.feedback({
  run: {
    task: 'chart.recommend',
    input: { question },
    output: spec,
    packIds: pack.ids,
    taskId: 't_7',        // optional: groups the attempts at one job
    attempt: 1,
    actorIdHash: userId,  // optional: lets forget({ actorHash }) reach it
  },
  feedback: { type: 'edit', after: corrected },
});
```

`feedback` writes to the outbox **before** it sends, so a tab that closes mid-correction still delivers
it on the next visit: `pending()` says how many are waiting, `flush()` drains them. Recall is never
queued — stale knowledge is worse than none.

`forget` is never queued either, and it does not retry on a refusal: a deletion that lands after the
user changed their mind removes something they asked to keep, and one that waits silently is a promise
the client cannot keep. It either succeeds now or throws, and the thrown message carries the status:

```ts
await mg.forget({ taskId: 't_7' });   // → { events, runs, knowledge, rescored, tombstone }
```

### 15.3 Providers: configuration or code

Both forms resolve through the same registry, in this order: an instance you passed, then a factory
registered under the name in your config, then an error naming what is registered.

```ts
import { registerProvider } from '@agentix-e/microglia-core/providers';

// Programmatic: a gateway, a proxy, a local model.
registerProvider('llm', 'gateway', (config) => new Gateway(String(config['endpoint'])));

// Declarative: the same thing from a config file.
createServer({ dir, namespace, llm: { id: 'gateway', endpoint: 'https://llm.internal' } });
```

`LlmProvider` is one method and `EmbeddingProvider` is one method; neither knows about retries or
prompts, which is why a host can wrap its own transport (tracing, rate limits, caching) without forking
the library.


### 13.23 Why two runs of one lane can differ by fifteen points and mean nothing

A benchmark that reports `pass^4` is reporting the fraction of **tasks** whose four trials all passed.
That is a nonlinear function of the per-episode success rate, and at forty tasks it is a coarse
instrument:

| | run A | run B |
|---|---|---|
| episodes passed | 140 / 160 | 141 / 160 |
| rate | 87.50% ±5.12pp | 88.13% ±5.01pp |
| tasks at 4/4 | 24 | 30 |
| `pass^4` | **0.600** | **0.750** |

One episode apart over one hundred and sixty, fifteen points apart in the headline. Run A missed twice
in the same thirteen tasks; run B missed once in each of ten. Both are the same experiment.

**What to do about it, in three habits:**

1. **Read the rate first.** It has the episode count as its denominator, so at 160 episodes its
   half-width is about 5pp where the headline's is about 15pp.
2. **Compare `pass^4` only at equal `n`.** A 40-task figure and a 114-task figure are not the same
   measurement, and the difference between them (17.65pp of cross-sample half-width) is larger than
   most published deltas.
3. **Treat a headline above `rate⁴` as a finding, not a result.** It means the misses clustered into
   fewer tasks. `rate⁴` is what a change in the underlying rate can explain; the gap between the two is
   the clustering.

`pnpm eval:pack-repeat <control.json> <treatment.json>` prints all three — rate with its interval,
`rate⁴`, the measured headline — beside the per-task flip table and the pack ledger, so a pair of runs
is read the same way every time:

```
control:   140 of 160 episode(s) passed (87.50% ±5.12pp over 40 task(s) × 4)
treatment: 141 of 160 episode(s) passed (88.13% ±5.01pp over 40 task(s) × 4)
headline if the rate were the only thing that moved: 0.6031 against the measured 0.7500
tasks: 40 paired, 20 passed both, 6 failed both, 10 gained, 4 lost
```

### 13.24 Reading a fold census without being misled by it

A pack line that carries a fold prints four counts, and they answer four different questions:

```
fold 0 of 650 units (0 groups, 14 refused for want of a second task), support ≥2 0, max 1
fold 0 of 650 units (0 groups, 12 suppressed by the unit, 14 refused for want of a second task), …
fold 0 of 650 units (0 groups, 3 refused for want of a second task, 79 unnamed), support ≥2 0, max 1
```

| count | means | what to do |
|---|---|---|
| `groups` | groups that **folded** | non-zero: the mechanism fired, and `support ≥2` is real |
| `suppressed` | met the floor, the **unit** did not fold | you are reading the control arm; the store may still recur |
| `refused` | a group existed and its distinct tasks fell short | the store repeats one task, not two |
| `unnamed` | items the key could not name at all | the **key** is broken, not the store — this is a defect |

The suffixes print only when non-zero, so a run with nothing to say keeps the older line byte for byte.
A line that shows `0 groups` and nothing else is only evidence about the store if `suppressed` is zero
too; if `suppressed` is absent, the arm does not fold and the zero is about the arm.

### 13.25 Reading a memory run's distribution instead of its mean

Every run prints three lines about delivery, and they answer three different questions:

```
[tau2] pack: budget 2400 …; served 161 of 161 (mean 4.1 items, 2206 chars); dropped for size 635 …
[tau2] served: 161 of 161 request(s) recorded ids, 653 render(s) from 66 record(s); top1 52.1%,
       top5 30.2%, 8 rendered once, effective 38.5 — the mean items per request is a size,
       and these are the supply
[tau2] fold 0 of 653 units (0 groups, 58 suppressed by the unit, 11 refused for want of a second task,
       38 unnamed), support ≥2 0, ≥3 0, max 1
```

| line | question | what a bad reading looks like |
|---|---|---|
| `pack` | how many requests were served, and how big each pack | `served N of N` means **the gate was not applied** — with `minCoverage 0` every hit is kept |
| `served` | *which* records, and how unevenly | `top1` above ~20% means one rule is speaking for the store |
| `fold` | whether records were recognised as the same routine | `groups 0` with `unnamed 0` means the store genuinely did not recur; `unnamed` above 0 means the **key** failed |

Three habits that follow:

1. **Never read `served N of N` as coverage.** It is the floor's default. A registration that wants the pack
   withheld must name a `recallFloor`, and the run's own retention curve prices the rungs: on one 650-pair
   store, 0.05 still served 162 of 162 packs, 0.10 served 154, and **0.15 served 75**.
2. **Compare `top1` against the number of records, not against the pack size.** R120 served four items a
   request from 73 records and one record took 54% of the requests; the pack size was healthy and the
   supply was not.
3. **When `groups` is 0, read `pairs`, `skippedScope` and `skippedKey` before concluding anything about the
   store.** A merge keyed on the model's own scope spelling will report zero groups on a store full of
   paraphrases — the pass tested 4 of 2,016 pairs, which is a statement about the key. `skippedKey` is the
   sharper reading of the two: it counts the pairs that passed every other test and were removed by the key
   alone, so a store with `skippedKey > 0` has duplicates the pass was in a position to merge and did not.

### 13.26 Why a merge census and a merge are not the same number

A store can report two very different counts of "things taught twice", and both are honest:

| census | keyed on | R121's store |
|---|---|---|
| `merge.support.atLeastTwo` | the **routine** a correction used (`cancel > get_order > cancel`) | **12** of 44 shapes taught by ≥2 corrections, max 8 |
| `consolidation.merged` | the **claim** an item states, compared by wording + scope | **0** of 79 items, with 4 candidate pairs |

Twelve routines taught twice and zero claims written twice are both true of that store: 79 items, every one
with `supportTasks: 1`. **A merge raises `supportTasks`; a recurrence census does not.** R124 answered by
keying the pass on the routine the census keys on, and that answer was incomplete in a way this table can
now state: keying on the routine only lets the pass compare items *inside one routine*, and R137's store
filed **34 of its 35** joins across routines — so the pass still merged one item out of a store whose
wording repeats a third of itself. What moves the second number is not a better key but `linkage: 'all'`,
which leaves the key informational and the claim test decisive.

### 13.27 Choosing a margin rung without buying a wrong one

`speakMargin` withholds a pack when the store's best candidate is not far enough ahead of its runner-up.
The number is a **quantile of the store's own margin distribution**, so naming one from intuition buys one
of two outcomes — it withholds almost everything or almost nothing — and both are read as a result about
memory.

Three steps, and the first one is free:

The arm that prices every rung is the arm that gates on none: a registration whose header carries
`speakMargin: 0` and `speakCensus: true`. It costs no extra model call — the census rides the run you were
going to make — and it is one dispatch:

```yaml
# In the registration's header, which is where a τ² arm's switches belong:
speakMargin: 0
speakCensus: true
```

```text
# The shape of the line. A real run prints its own numbers; these are one store's.
[tau2] speak: margin 0 (the default: every non-empty pack is served); 162 request(s) reached the facade,
160 served, 2 withheld (nothing-matched 2), 0 failed; 118 rivaled request(s) (the population a rung acts
on), p50 0.0312, ladder 0.01 6 / 0.02 12 / 0.05 24 / 0.10 61 / 0.15 88 / 0.20 101 / 0.30 115
```

```bash
# 2. Read the ladder, not the rate.
#    0.05 costs 24 of 118 rivaled requests (20%); 0.15 costs 88 of them (75%).
#    0.10 is the largest rung under the 40% ceiling here, so it is the rung to buy.
```

```yaml
# 3. Buy that rung, with the census left on so the withheld count can be checked against the prediction.
speakMargin: 0.10
speakCensus: true
```

What to check on the treatment run:

| reading | what it means |
|---|---|
| withheld ≈ the ladder's number for that rung | the gate fired as priced; anything else is a different store |
| `no-leader` is the largest bucket | the gate withheld contested rankings, not empty ones |
| `nothing-matched` rising | the gate is not the cause; the store stopped matching |
| `rivaled 0` | the census never reached the driver — a wiring defect, not a store finding |

A rung that withholds more than two requests in five has replaced the store rather than filtered it. If the
**lowest** rung already does that, do not buy a rung at all: that store's top two candidates are always
within a point of each other, and the honest report is the ladder itself.

### 13.28 Serving only what a second task agreed with

A store written one item per correction holds mostly items with **one** task behind them. On a benchmark
where a pack serves one item per request, those items are what the model actually sees, and they are also
what it cannot check: the same store can hold a corroborated claim (two tasks taught it independently) and
fourteen singletons, and the pack will hand out whichever ranks highest for the question.

`serveSupport` retires, at serve time, every item fewer than *n* distinct tasks stand behind:

```yaml
# Needs the recurrence pass: the support it reads is the pass's own count.
consolidate: true
consolidateKey: routine
consolidateLinkage: all   # without this the pass only compares items filed under one key
serveSupport: 2           # absent or 1 = every item is servable, which is the control
```

```text
# The two lines a run prints, from the store R139 measured and the floor this header would apply to it.
[tau2] consolidation: 70 considered, 2,415 pair(s): 11 groups, 15 merged, 55 retained; cross-task 11,
       support ≥2 0→11, max 1→4; refused 0 condition / 1 payload / 0 evidence / 20 linkage
[tau2] support floor 2: 44 of 55 item(s) retired for want of corroboration, 11 servable
```

The first line is the pass: `support ≥2 0→11` says eleven items are now taught by two or more tasks and
none were before. The second is the floor: 44 of those 55 items are singletons, so they leave, and the pack
serves from the eleven that remain.

The pair report prints the join those two lines are about — what the pack served, bucketed by the support
behind it, and either the counterfactual or the grade:

```
# No floor in force: how many of the served items a floor of two would have retired.
serve support: 21 of 55 servable item(s) served; support 1: 19 item(s), 5 broke, 5 kept, net +0;
support ≥2: 2 item(s), 0 broke, 1 kept, net +1; floor absent, so a floor of 2 would have retired 19 of the 21

# A floor in force: how many served items sit below it, which must be zero. The bucket counts are the
# run's own; the shape is what to read, and `no singleton was served` is the sentence a working floor prints.
serve support: 11 of 11 servable item(s) served; no singleton was served; support ≥2: 11 item(s), ...;
floor 2 in force, and no served item carries support below it
```

Four things to know before you use it:

1. **It is a serve-time decision, not a write-side filter.** The retired items are still in the store with
   `statusReason: support-floor`, are counted under `store.reasons`, and can be re-activated. Nothing is
   deleted, so a readback can always price what the floor removed.
2. **It needs the pass.** Without `consolidate: true` every item is written from one correction, so its
   support is 1 by construction and a floor of 2 retires the entire store — the run then serves no memory at
   all and looks exactly like a floor that did not work. A registration that names `serveSupport` above 1
   without `consolidate: true` is refused before dispatch.
3. **It changes the denominator, not only the numerator.** If the store holds 55 items and the floor leaves
   11, then at most 11 distinct items can be served however many requests there are. `recall.served` falling
   is the floor working; `recall.served` at zero with `retained` above zero is a wiring defect.
4. **Support is not quality.** An item two tasks agreed on can still be wrong, and an item one task taught can
   be the only useful rule in the store. The floor is a safety instrument: grade it on the **harm share** (the
   share of trials the control passed and the memory arm broke) and on the per-item `broke` column, not on the
   point estimate at n = 40.

| reading | what it means |
|---|---|
| `supportFloor.retired` in band with the pass's `supportAfter[1]` | the floor acted on the population the census described |
| `store.reasons['support-floor']` equals `supportFloor.retired` | the write-back reached the store the recall path opens |
| a served item with support 1 | the floor did not reach the pack — a carriage defect, not a finding |
| `retained` at or above the store's own length | the floor was not applied at all |

## 17. When the memory makes things worse, which rule did it

A store can lower a benchmark score while every gate reports success. The pack was served, the ids were the
ones the ranking chose, the audit trail is complete — and the arm still lost trials it used to pass. Nothing
in the pipeline so far answers the only question a reader asks at that point: **which rule**.

This section is about the instrument that answers it, the assumption it rests on, and the mistake it invites.

### 17.1 What the instrument needs

Three things, all of which a paired run already writes:

| artefact field | what it is |
|---|---|
| `tau2.pack.ledger` | the ids served at each recall request, in request order |
| `per_trial` | one row per episode: `{ id, trial, reward }` |
| `tau2.memory.episodeStarts` | the request index at which each episode opened |

The third is the one that had to be added, and the reason is worth knowing before you trust a join. A recall
fires **once per episode**, so a run's request count is very close to its episode count — 164 requests over
160 episodes in the run that motivated this. *Close* is the trap: a join that assumes one request per episode
is correct for the first 160 rows and wrong after the first episode that recalled twice, and it is wrong
silently, attributing one episode's rules to another episode's outcome.

### 17.2 Reading the table

```bash
# The pair report prints a line whenever the join can be made.
pnpm eval:l4-pair
# attribution: 61 item(s) over 160 served episode(s);
#              9 with a negative net, 12 positive;
#              worst k_01hf7uaq7f_5pqmn -4 of 7, k_01hf7uaq89_9r5gs -3 of 12
```

| column | meaning |
|---|---|
| `episodes` | trials this rule was served into, counted once per trial however many turns it rendered on |
| `kept` | of those, trials only the memory arm passed |
| `broke` | of those, trials only the control passed |
| `net` | `kept − broke` |

The full table is in the pair artefact under `attribution.items`, ordered worst first with ties broken by id,
so two readbacks of the same artefacts can be diffed.

### 17.3 What `net` is not

`net < 0` means **the rule was present whenever the memory failed**. It does not mean the rule caused the
failure: a trial is a ten-turn trajectory and the store served four rules into it. Treat the table as a
screening list and not a verdict, for the same reason a 40-task score cannot rank two arms — the evidence is
real and it is not the evidence the question needs.

The verdict is a second run: withhold exactly the named rules and measure again. If the score recovers, the
rule was the cause; if it does not, the loss lives somewhere the pack cannot reach, and the next place to look
is the harness rather than the store.

The table is written by any paired run once the agent records episode boundaries — there is no screening
arm to buy, because the run you were going to make anyway carries it. Read it from the memory arm's artefact,
name at most three rules, and register the ablation **before** running it:

```bash
node -e "const a=require('./eval/results/arms/memory/poc-l4.json');
         console.log(a.attribution.items.slice(0,3))"
```

A run whose arm predates the boundary field writes no `attribution` at all. That is the same distinction the
rest of this guide makes between a measured zero and an absent measurement, and it is why the field is missing
rather than empty.

### 17.4 Three ways the table misleads

1. **A rule served into most trials.** If `episodes` is a large share of the arm, `net` describes the store
   rather than the rule, and withholding it is a store change disguised as a probe. Prefer rules with
   `episodes` under half the arm.
2. **A rule present in one losing trial.** That is noise. Two episodes is the smallest count worth naming,
   and three is the smallest count worth a dispatch.
3. **A table that is absent.** `attribution` is written only when all three fields exist. An artefact without
   it is not a store with no harmful rules — it is a run whose boundaries were not recorded, and the record
   distinguishes the two in the same way it distinguishes `rivaled: 0` from `rivaled: null`.

## 18. Counting turns, because counting tasks does not resolve anything

Every paired comparison in this guide so far is over **tasks**, and a benchmark's task count is fixed by
whoever published it. That is the constraint this section is about: on τ²-retail there are forty held-out
tasks, forty tasks give a standard error of 7.76pp on a paired difference, and no number of trials changes it
— six trials on forty tasks is still forty tasks. If your effect is five points, the task-level test will not
see it, and it will not tell you it could not.

What a run *does* record in quantity is turns. One 160-episode phase writes about 1,800 assistant turns, and a
memory that induces a wrong action shows up in them as a call that came back in error rather than as a lost
episode.

### 18.1 What is counted

```bash
# The pair report prints the census for the memory arm and then the paired reading.
pnpm eval:l4-pair
# turns: 160 of 160 episode(s), 1813 assistant turn(s), 2712 call(s) (14 repeated);
#        37 tool error(s) of 2698 flagged result(s); 402 user turn(s) after an action, 31 after an error
# turns paired: toolErrors 37 vs 41 over 160 pair(s), -0.025 per episode (not separated);
#               repeatCalls 14 vs 11 over 160 pair(s), +0.019 per episode (not separated)
```

| field | what it counts | why it is not a zero by default |
|---|---|---|
| `toolErrors` | tool results that came back marked in error | **`null`** when no result carried the flag — a release that stopped saying is not a run without failures |
| `toolResultsWithFlag` | results that carried the flag | the denominator of the line above |
| `repeatCalls` | a call whose name *and* arguments repeat an earlier call in the same episode | a call with no readable payload is excluded and counted separately, so the reader cannot invent a repetition |
| `callsWithoutArguments` | calls the reader could not read | the population `repeatCalls` cannot see |
| `userAfterAction` | user turns after the agent's first action | excludes the opening instruction, which no error can precede |
| `userAfterError` | user turns after a tool error | the cost of the error, in conversation |

### 18.2 How the two arms are compared

Two intervals, both printed with the counts:

- **per arm**, a Poisson interval — a count of rare events is not a proportion. **Zero observed errors is
  consistent with up to 3.69 expected**, and an arm that reports `0` has shown that its rate is below 3.7 per
  phase, not that it is safe.
- **on the difference**, a paired interval over the per-episode deltas. A trial present in one arm and not the
  other is dropped, and `episodes` on the line says how many pairs survived.

### 18.3 The rule that makes it a test

> The two arms' counts are **separated** when their Poisson intervals do not overlap.

That is the whole test, and its value is that it can come out either way. A task-level comparison at forty
tasks usually cannot, which is why this section exists.

### 18.4 Four ways it misleads

1. **A census with `measurable` below `episodes`.** The reader could not see every episode's messages, and the
   counts are a sample rather than the phase.
2. **`toolErrors: null` read as zero.** It means no result carried the flag. The line says so; do not read past
   it.
3. **`repeatCalls` on an arm with many `callsWithoutArguments`.** Those calls are outside the repetition
   population, and a large count means the reader saw less of the traffic than the total suggests.
4. **A turn-level difference treated as a score.** A memory can reduce tool errors and still lose episodes —
   errors are how an agent recovers, and an agent that avoids the call avoids the recovery. Read the two units
   together, never one as a proxy for the other.

### 18.5 What it costs

Nothing in model calls. The census is computed from the `simulations` document the runner has already written,
in the same process that ran the episodes; it adds one JSON block to the arm artefact (one row per episode) and
one line per phase to the log.

## 19. When a reading is missing, the run has to say why

Every artefact in this project is expected to let a reader recompute its numbers without the job log. That
expectation fails in two ways, and they look identical from outside: a field can be **absent**, and a field can
be **zero**. A third way is worse than either — a reading that could not be computed printing **nothing at
all**, so the log has no sentence and the artefact has no field.

R123 was the third. Its phase computed a serve split, found it could not be joined (the episode boundary it
needed had been written as one entry per request), returned nothing, and the caller skipped the print. The arm's
registered mechanism check vanished between a green gate and a complete-looking artefact.

### 19.1 What a run now tells you

```bash
# A reading that was computed:
serve split: served 109 of 109 = 100.00% [96.6, 100.0]; withheld none measured
# A reading that could not be, with the reason and the numbers that disagreed:
serve split: not measured (no-boundary) — 162 request(s) with no episode boundary, so no request belongs to a trial
```

The four reasons, and what each one means for your run:

| reason | what it means | what to look at |
|---|---|---|
| `no-ledger` | no request reached the facade, or the arm predates the census | the facade's own count, and whether memory was on at all |
| `no-boundary` | the boundary field is missing or empty | the sidecar's `episodeStarts`, and whether the agent was the microglia one |
| `boundary-disagrees` | the boundary exists but is not a partition — it repeats, decreases, starts past the ledger, or does not match the trial count | the numbers in the sentence; the first and last are usually enough |
| (absent field) | `serveSplitAbsent` in the pair artefact carries the same sentence in machine-readable form | the artefact, not the log |

### 19.2 The three checks that make it trustworthy

- **A field either arm emitted is in its artefact.** The projection table is typed so that a *declared* field
  cannot be forgotten; a field added through a spread is exempt, which is how three blocks were dropped and why
  the rule is that a field is declared on the record's type in the same edit that emits it. A record that
  carries an undecided key reports it, and the pair's `l4-projection-complete` gate fails the arm. If you see
  that gate red, the arms are fine and the projection needs a decision for the named keys.
- **A reading the artefact declares is a reading its own ledger accounts for.** `l4-rotation-reconciles` compares
  a serving policy's numbers with the ids the same file's `pack.ledger` carries, and blocks on a disagreement. It
  also prints the fields it cannot reach — `mode` is a policy and no ledger holds one — so a green row says what
  it checked, not that everything was checked. See §32.5.
- **The split reproduces the arm rate when nothing is withheld.** On an arm with no gate, every episode lands in
  the served bucket, so `serve split: served` must equal the arm's own episode rate. If it does not, the join has
  mis-assigned requests and every gated split in the record is unreadable.
- **A row certifies what its own criterion asks.** `l4-effect-resolved` answers one question: may this pair be
  quoted as a finding? That needs a published direction *and* a `|delta|` at least as large as the pair's minimum
  detectable difference, so `−7.50pp` against `23.23pp` reads as a cost the revert rule acts on **and** a
  direction the pair cannot claim. The row is advisory — `l4-paired` is what blocks a pair for costing accuracy —
  and it is re-graded, not re-measured: `pnpm eval:l4-regrade eval/results/poc-l4-pair-*.json` recomputes the
  `l4-*` rows of the committed artefacts from the numbers they already carry, and `pnpm check` runs it, so a
  change to the gate that moves a row fails the build until the evidence is re-graded. See §32.7.

### 19.3 What the control arm carries

The reference arm used to return before its bookkeeping was written, so no control artefact had a `tau2` block:
no usage, no bill, no turn census. Every pair reported `cache first (unstated): unmeasured` because of a missing
writer, not because of the provider. The control arm now records its turns, its usage, its bill (divided by the
phase's own episode count) and its turn census, which is what makes a *paired* turn reading possible at all.

## 20. The store on the cases it was built from

A held-out score answers "does the memory help on tasks it never saw", and that question mixes two failures that
call for opposite fixes: an item that is **wrong** (fix the write side) and an item that is **right but served on
a case it does not belong to** (fix the trigger, the floor or the margin). A harm share cannot separate them — a
store can be harmful on 57% of the trials it changes and still be right about everything it says.

A rehearsal separates them, because the learn half already knows which cases wrote the store. Every training task
ran with no memory, the ones that failed are what the corrections were distilled from, and replaying those same
tasks **with** the store asks whether an item repairs the case that produced it.

### 20.1 Buying one

The replay is a second paid phase over the same store, so it is a registration's switch and not a repository
variable:

```yaml
rehearsal: true
trials: 2          # 74 learned + 80 evaluated + 74 replayed = 228 episodes, inside one 240-minute job
```

`pnpm eval:prereg` refuses three shapes before the first model call: a `rehearsal: true` arm that would not fit
one job (it counts `trials x testTasks + 2 x trainTasks` episodes), a rehearsing `learnOnly` arm (it stops before
the evaluation whose rewards the replay pairs against), and a value that is not `true` or `false`. The driver
refuses one more: a rehearsal on a reference arm, which has no store to replay.

### 20.2 What it prints

```bash
[tau2] rehearsal: 74 of 74 task(s) replayed, 71 of 74 request(s) served, 12 repaired / 31 inert of the 43 that
failed without memory (27.91%); 4 broken and 27 kept of the rest; harm share 25.00%
# And when the phase ran but the two reward sets paired nothing:
[tau2] rehearsal: 74 task(s) replayed, 0 of 74 request(s) served — no task carried a reward on both sides, so the
store was replayed but nothing paired
```

Four cells, from two reward sets paired by task:

| cell | meaning |
|---|---|
| repaired | failed without memory, passed with it — the item worked on its own case |
| broke | passed without memory, failed with it — the store made a case worse that needed no help |
| inert | failed both times — absent, irrelevant, or wrong in a way that changed nothing |
| kept | passed both times |

### 20.3 The two rates, and why their denominators differ

- `repairRate = repaired / (repaired + inert)` divides by the **failures** the store was written from. A task the
  model already passed teaches nothing and asks the store nothing, so including it would dilute the number into
  something that reads like a held-out score.
- `harmShare = broke / (repaired + broke)` divides by the **outcomes the store changed**. It is the own-case
  analogue of the held-out harm share, so it is the number R123's 56.7% can be compared with.

Read together: a **high** repair rate with a **low** own-case harm share means the store is right and misapplied
elsewhere — a conditioning problem. A **low** repair rate means the items do not fix the failures that wrote them
— a distillation problem, and the next arm belongs on the write side.

### 20.4 The three absences

| what you see | what it means |
|---|---|
| no `rehearsal` block, no line | the registration did not buy the phase — every arm before R132 |
| the block, with `reading` absent | the phase ran and no task carried a reward on both sides |
| the block, with `served` far below `requests` | the store could not reach its own cases: a retrieval or scoping finding, not a distillation one |
| the block, with `refused: peak-window` | the window closed before the replay opened, so no request was made and the store was not asked |

The third row is why `served` travels with the four cells: an empty pack and an inert item produce the same
counts, and only one of them is about what the store says. The fourth row is why the refusal is a field rather
than a crash: the graded facade has already been paid for by the time the replay opens, and a second phase must
never take the primary measurement with it. `run_split.py` declines to open a phase in a peak-rate window; the
driver records that one refusal and throws every other failure.

## 21. The denominator a replay does not have

§20's four cells are computed against the draw that **selected** them. The learn half failed a task, the store
was written from that failure, and the replay asks whether the same task now passes. `inert` therefore means
"failed without memory, then failed again with it" — and a task that fails two thirds of the time produces that
cell whether or not the store did anything at all.

R132 measured 14 failures and read 5 repaired / 9 inert. Without a second draw there is no way to tell a store
that is inert on its own cases from fourteen tasks that are simply hard, and the two point at opposite fixes.

### 21.1 Buying the control

A control replay is the same task list, the same one trial, the same reduction, and **no store** — the agent the
learn half ran, with no facade and no recall. It is a second paid phase, so it is a header:

```yaml
rehearsal: true
rehearsalControl: true
trials: 1          # 74 learned + 40 evaluated + 74 replayed + 74 controlled = 262 episodes
```

`pnpm eval:prereg` refuses a control without a rehearsal (a comparison needs both sides), and counts the third
pass in its sizing arithmetic: the episodes an arm carries are `trials x testTasks + 3 x trainTasks`, and the
message names the sum.

### 21.2 What it prints

```bash
[tau2] rehearsal: 74 of 74 task(s) replayed, 74 of 74 request(s) served, 5 repaired / 9 inert of the 14 that
failed without memory (35.71%); 3 broken and 57 kept of the rest; harm share 37.50%; against a no-memory
replay: 4 repaired / 5 broken = -1 net of 74 task(s) (-1.35%), harm share 55.56%
```

The clause after the semicolon is the store's effect with the draw held fixed: `repaired` and `broke` there are
**discordant pairs** between two phases that differ only in whether the store was on, so `net = repaired −
broke` is not diluted by task difficulty and its sign is the reading.

| clause | what it says |
|---|---|
| `net ≥ +2` | the store changes its own cases for the better: it is right, and misapplied on held-out tasks |
| `−2 < net < +2` | the store changes nothing net on its own cases: inert, not wrong |
| `net ≤ −2` | the store costs its own cases: the items themselves are the problem |

`served` is **not** in the control's half of the clause, and its absence is deliberate: the control runs with no
facade, so there is no request to count. `0 of 0 served` would read as a store that found nothing — the
misreading §20.4's third row exists to prevent.

### 21.3 The control's own three absences

| what you see | what it means |
|---|---|
| no `control` key | the registration did not buy the comparison — every arm before R133 |
| `control.reading` absent | the control ran and paired nothing: every reward was `null` or no task id matched |
| `control.refused: peak-window` | the window closed before the control opened; no call was made |

Each prints its own sentence, because a `0 net` would collapse all three into "the store changed nothing" —
which is the one claim none of them supports.

## 22. One arm, several dispatches

Every number in this lane is a draw. R131 read `pass^4` **0.625** on the arm that read **0.775** in R123a and
**0.750** in R124 — same store shape, same split, same headers, same gate — and for two rounds the record quoted
the largest of the three as that arm's score. Three numbers of one arm are an *estimate with an interval*, and
this reader prints the interval.

```bash
L4_DISPATCHES="R123a=eval/results/history/a.json,R124=eval/results/history/b.json,R131=/tmp/c.json" \
  pnpm eval:dispatch-pool
```

```
[dispatch-pool]   R123a: pass^4 77.50% over 40 task(s)
[dispatch-pool]   R124: pass^4 75.00% over 40 task(s)
[dispatch-pool]   R131: pass^4 62.50% over 40 task(s)
[dispatch-pool] dispatch pool: 3 dispatch(es) at k=4 over 40 task(s): pass^4 72.30% [53.13, 91.47]
(±19.17pp at t(2)=4.303, random-effects) — 16.45% of the spread is between-dispatch, so this is a summary of
disagreeing runs; an interval this wide does not order two arms
```

The input documents are the per-arm `poc-l4.json` files the lane already writes.

### 22.1 The two variances, and why both are printed

A pool splits the spread between **dispatches** and **within** them:

| quantity | meaning |
|---|---|
| `tau2` | between-dispatch variance (DerSimonian–Laird, truncated at zero) |
| `iSquared` | the share of the total spread that is between dispatches |
| `label` | `random-effects` when `tau2 > 0`, else `fixed-effect` |

And the interval's quantile follows the variance the estimate is actually made of: `t(dispatches−1)` when the
dispatches disagree (4.303 at three, against 1.96 — a factor of 2.2), and the normal quantile when they do not,
because the uncertainty is then the episodes' own.

### 22.2 What the three pools say

| quantity | dispatches | pooled | 95% | I² | reading |
|---|---|---|---|---|---|
| `pass^4` | 0.775 / 0.750 / 0.625 | **72.30%** | [53.13, 91.47] | **16%** | the movement is mostly sampling: the arm's estimate is 0.72 with a ±19pp interval |
| harm share | 29.6% / 31.2% / 55.2% | **38.35%** | [3.85, 72.86] | **60%** | the movement is **not** sampling: these dispatches genuinely disagree |
| episode rate (one dispatch, two arms) | 83.75% / 85.62% | 84.73% | [80.77, 88.69] | **0%** | reproducible to ±4.0pp — the only quantity here that is |

That table is the reason the record's competitive board was rebuilt (§COMPETITIVE AU). `pass^4` at forty tasks
cannot rank; the harm share is not one number; the episode rate is, and it is what a claim should be made on.

### 22.3 The refusals

| input | what happens |
|---|---|
| one dispatch | `undefined` and a sentence — one draw is not a pool |
| two `k` values | `RangeError` naming both: a `pass^2` is not a `pass^4` |
| a rate outside [0, 1], or a task count under 1 | `RangeError` — nothing is dropped, because a pool over the readable subset of a record's runs is a selection |
| an artefact with no `metrics.k` | the reader exits 2 and names the field: `pass4` predates `k`, and R132 published `pass4: 0.825` at `k: 2` |

## 23. How many scripts a pack serves, and what that costs

A pack is bounded in two different things, and until R134 only one of them could be stated. `packBudget` is a
**character** ceiling; the number of items that fit is whatever the distiller's sentence lengths allow. Measured
on a real store, that left **3.975 items and 2,239 of a 2,400-character budget on every request**, with 161
further items dropped for size over 40 requests. An arm whose question is "should the agent be handed one
procedure or four" cannot ask it with a length.

```yaml
packBudget: 2400    # characters
packLimit: 1        # items — the count, stated rather than inferred
```

`packLimit` is a one-line header and prints on its own line of the dispatch log:

```bash
pnpm eval:prereg-caps prereg/R134-one-script.md
```
```
train=74
test=40
ceiling=
budget=2400
limit=1
...
```

Leave it out and the host's own room stands, which is what every arm published before R134 ran with. Zero is
refused rather than read as "no limit": a registration that asks for an empty pack is a registration that
measures nothing.

### 23.1 What the count is worth, in dollars

Running the same 74 tasks twice — once with the store and once without — prices the pack's count directly. The
store-on replay cost **$0.00655 an episode against the store-off control's $0.00270**, on the same backbone, the
same tasks and the same hour:

| | store on | store off |
| --- | --- | --- |
| prompt tokens | 8,558,308 | 6,068,231 |
| uncached | 2,508,270 | 594,961 |
| cache hit rate | 0.7069 | 0.9020 |
| cost, 74 episodes | $0.4847 | $0.1996 |
| **per episode** | **$0.00655** | **$0.00270** |

The mechanism is not the items' length — it is that a four-item pack is **different text on every call**, so the
provider's prefix cache is replaced instead of reused. Two consequences worth knowing before you set a budget:

- **A pack you cannot reuse is a pack you pay for twice.** The cheat sheet is in `uncached`, not in `prompt`: 2.5M
  against 0.59M is the same tasks read cold.
- **The count is the knob that moves it.** Not `packBudget` — a 2,400-character budget still served four items,
  because the distiller's records were 560 characters each. `packLimit` says the number you mean.

### 23.2 Reading the count back

`pack.summary.meanIds` is the number to check first, and it is exact rather than estimated: it is a count of
items against a declared integer. If you set `packLimit: 1` and read `meanIds: 3.975`, the header did not reach
the query — the driver, the workflow variable and the registration are three places for one number, and the
artefact is where you find out. `pack.empty` moving while `meanIds` is right is the opposite failure: one item
did not fit the budget, so you are measuring the renderer.

## 24. Reading a bill, and reading a gate

Two questions come up the moment a memory arm costs more than its control, and both of them are
answerable from the artefact without another dispatch: **what is the extra money made of**, and **which
requests would a gate withhold**.

### 24.1 The bill is three numbers, not one

`usage.cache` reports the provider's own count of what it held beside a census of what the request
contained. Read it in this order:

| field | what it is | what it means |
| --- | --- | --- |
| `uncached_tokens_per_call` | prompt minus the provider's cache credit | the part of the bill that is not discounted |
| `system_tokens_per_call` | the system messages, per call | the pack and the adapter's preamble: **the memory's own text** |
| `conversation_tokens_per_call` | everything else, per call | the conversation the agent grew: **its behaviour** |
| `tail2_tokens` | the second-newest message | the tool result the last turn appended |
| `tools_tokens_per_call` | the `tools` array, from the request | schemas the provider bills and no message carries |
| `prompt_tokens_per_call` | the provider's prompt | the sum of the four columns below, as a denominator |
| `residual_tokens_per_call` | prompt minus messages minus tools | the **chat template's framing**, and nothing else |

The four columns add to the prompt; the cache credit is a part of that prompt, not a column beside it. So a
premium is `Δprompt + Δmiss`, where `Δmiss = −Δcached`, and it takes **both** numbers to say where the money
went. Measured on R135's two arms: prompt **+675.7** a call (system **+559.3**, conversation **+26.7**, tools
**+5.5**, framing **+0.5**) and cached **−558.3** — two things of nearly equal size.

The distinction is not cosmetic. Measured on the same 40 tasks with the same backbone:

| | memory on | memory off |
| --- | --- | --- |
| episodes | 40 | 40 |
| cost | $0.2183 | $0.0969 |
| **per episode** | **$0.00546** | **$0.00242** |
| uncached tokens a call | 1,639 | 420 |

**2.25× the bill.** Shrinking the pack from four items (2,239 characters) to one (747) moved it by 16%,
not by the two thirds the text shrank — so the premium is not the pack's length. That is what the split
is for: it says whether the money is in the memory's text, in the agent's own turns, or in the framing.

**One caution, learned the hard way.** `residual_tokens_per_call` used to be defined as `uncached` minus the
two newest messages, and it therefore absorbed the entire premium whenever two arms cached differently — a
residual of a residual is not an attribution. It is measured against the prompt now. If you are reading an
artefact produced before R136, that field means something else and cannot be compared with a later one.

### 24.2 A share above 100% is a defect, not a cache

`prefix_coverage` is `credited / seen`, where `seen` deliberately stops two messages short of the end —
those are the messages a tool loop appends together, and only the ones before them were provably offered
in an earlier request. That makes `seen` a **lower bound**, so the ratio can exceed 1: it did, at 1.4752
and 2.2639, on two arms whose prefix was held perfectly well.

An arm reading above 1 is reported as `prefix-undercounted` with `repair: unmeasured`, and the sentence
says why. Do not read such a value as "cached very well": it means the denominator is too small to
attribute anything, and any sentence that attributes the rest to the agent is a guess.

### 24.3 Which requests a gate would withhold

`pack.margins.perRequest` is the margin of **every** request, in arrival order, with `null` where the
pack carried no decision. Aligned by position with `pack.ledger` and with the driver's `per_task`, so the
three join:

```python
for margin, ids, task in zip(pack["margins"]["perRequest"], pack["ledger"], per_task):
    print(margin, task["passed_all"], ids)
```

That is the whole conditioning question. A rung withholds exactly the requests whose margin is below it,
so joining the margin to the outcome says whether the requests a rung would silence are the ones that did
damage. The ladder in `margins.ladder` counts requests *under* each rung and cannot answer it — R134 had
four harmed and two repaired requests and no field said where in the ladder they sat.

One caution, learned twice: a per-request array is only as good as its alignment. If `perRequest`,
`ledger` and `per_task` disagree in length, the join reports a number rather than a defect, so check the
three lengths before reading anything else.

### 24.4 When the boundary counts more boundaries than there are trials

`memory.boundaryTasks` names the task each episode boundary opened for, and it is what makes the joins in
§24.3 safe on an arm that simulated a task twice. R135 opened **41** boundaries for **40** scored
episodes: one task was simulated twice, its second pack became a ledger row no `per_task` row named, and
every positional join in the toolkit refused — correctly, since a positional join would have attributed
one trial's claims to another's outcome.

The field is recorded where the boundary is, from the query the agent already sends to the facade, and the
runner resolves it to a task id by matching that query against the first user message of every simulation
it ran. Two properties follow:

- **a boundary's requests are still delimited by position** — `episodeStarts` is a partition of the request
  stream and no name changes that;
- **a boundary's trial comes from the task it names**, so a repeated task is one episode with two ranges
  rather than two episodes with one outcome each.

Read it with:

```
[tau2] boundary: 41 boundar(ies) for 40 task(s); repeated retail/5 2
```

Three sentences come out of that line. `none repeated` with equal counts is an ordinary arm. A `repeated`
entry is a retried task, named — which is what R135 could not do. An `unresolved` count is an instrument
fault: the boundary named a task the arm never scored, and the requests it opened belong to no trial, so
the split refuses (`tasks-unresolved`) rather than falling back to position.

> **A missing name is not a zero.** An artefact written before R136 carries `episodeStarts` and no
> `boundaryTasks`, and the join then behaves exactly as it did: positional, and refusing any pair whose
> counts disagree. That refusal is the reason the instrument exists, not a defect in it.

### 24.5 How much of the system column is the message

`memory.injectedChars` is the length of the message the agent actually injects — the pack plus the element
it wraps it in — and `memory.packChars` is the length of the pack the facade served. Together with the
census's system column they are the three layers a memory's cost is made of:

| layer | field | what it is |
| --- | --- | --- |
| the knowledge | `memory.packChars` | what the store served |
| the message | `memory.injectedChars` | what the agent put in the prompt |
| the column | `usage.cache.system_chars_per_call` | what the provider billed as system |

The census splits the column by structure rather than by name: a call that carries a pack carries it as a
**second system message**, so `packed_calls` counts the calls the pack rode on and
`system_chars_per_unpacked_call` is the column on the calls it did not. That split matters because the
provider's callback sees the user simulator's calls too, and a mean over both is a mixture whose
composition moves with how many turns each side took.

`carriage_chars_per_packed_call` is `system_chars_per_packed_call` minus the injected message: everything
in the system column the pack's own text does not account for. Measured on R135's arm, 559 tokens of system
growth against a 725-character pack meant about 409 tokens sat in a column that was reported as one number,
and this is the subtraction that says so.

> **The carriage is not automatically a preamble, and R136 assumed it was.** The subtraction names a
> remainder; it does not name its contents. On the arm R136 dispatched the remainder was **10,400
> characters a call against a 705-character message** — four times the block itself — and the cause was not
> a long preamble but the same block in the prompt more than once. §24.6 is the field that separates the
> two, and it is the field to read first.

```text
[tau2] the provider credited 96.0% of the 4120-token prefix it had seen … ; on the 16 call(s) that carried
a pack the injected message was 726 characters and the system column carried 1986 more (about 505 tokens)
```

### 24.6 How many times the model read the memory

A recalled block is injected as a system message. If the agent writes it into the state the benchmark hands
back, and the agent appends rather than replaces, then every turn adds another copy: a ten-turn episode puts
the block in the prompt ten times, the block's cost grows with the square of the episode, and the model is
told ten times that this is the reference data to act on.

Two fields count it, from opposite sides of the socket:

| field | side | sound reading |
| --- | --- | --- |
| `memory.packCopiesDropped` | the agent | `calls − boundaries`, because every turn after the first is handed a state that already carries the block |
| `usage.cache.pack_copies_per_packed_call` | the census | `1.00`, because the policy is one system message and the block is the only thing the agent puts beside it |
| `usage.cache.packed_calls_with_copies` | the census | `0`, because a mean of 2.0 can be half the calls at one copy and half at three, and a count cannot |

```text
; 369 of the 410 packed call(s) carried the block more than once, 5.40 copies a call — the same text
re-sent, which is a defect and not a longer preamble
```

The same duplication is what breaks the cache. The block sits at the front of the prompt, so inserting a
copy there shifts every message after it and the provider's cached prefix ends at the insertion point: an
arm that reads `prefix-broken` while serving a small pack usually has this defect rather than a cadence
problem, and `uncached_tokens_per_call` is where it shows.

> **If you inject a block into an agent you did not write, make the injection idempotent.** Replace any
> earlier copy — identify it by the element your renderer emits — instead of appending to the state you were
> handed. A wrapper that only appends is correct under a benchmark that passes a fresh state each turn and
> wrong under one that threads the state back, and the two are indistinguishable from inside the wrapper.

## 25. Two folds, one corpus: reading a cross-fit

Every paired number this project publishes on τ² retail sits on **40 tasks**, and at n = 40 a paired design
resolves about **17 percentage points**. A memory worth ten points therefore reads as `UNRESOLVED` forever —
not because it is small, but because the sample cannot see it. The corpus is 114 tasks and the lane has been
scoring 40 of them.

A **cross-fit** spends the whole corpus without leaking it. The benchmark states a boundary — 74 train, 40 test —
and two arms read it in opposite directions:

| fold | the store learns from | the store answers |
| --- | --- | --- |
| `official` | the benchmark's train half (74) | the benchmark's test half (40) |
| `official-swapped` | the benchmark's test half (40) | the benchmark's train half (74) |

Each task is answered **exactly once, by a memory that never saw it**, and the two folds pool to 114 pairs. At
114 the same design resolves about 10pp.

### 25.1 Run it

```bash
# 1. compose the two runs into the two fold records
pnpm eval:fold-records eval/results/pairs/official.json eval/results/pairs/swapped.json --out-dir eval/results/folds

# 2. pool them
pnpm eval:cross-fit eval/results/folds/official.json eval/results/folds/swapped.json
```

The pool needs three things from each fold: its per-task outcomes, the half its store **learned from** (so the
leak check has something to check) and the **treatment identity** (so two folds of two experiments cannot be
averaged). A pair artefact written by a run older than this release states the first and refuses the other two,
because the guards that read them demanded a symmetry the two arms do not have — the reference arm learns
nothing, so it states `train: []` and no store fields at all.

`eval:fold-records` is that composition, and it is where the convenience is made safe:

- a fold that states its own halves keeps them; a fold that does not takes its learning half from the
  **sibling's evaluation half**, which is only legitimate if the two folds are one corpus read twice;
- so the tiling is checked before anything is written — each fold learned exactly what the other answered, and
  no fold evaluates a task it learned from;
- every value a record did not read from its own file is **named inside the record**, in `derivation`, so a
  reader can see which field was carried from where without re-running the tool.

The records are small — a ledger of 40 or 74 rows — and they are committed, because a pair artefact is a
deterministic join of two arm files and can be rebuilt from a run's evidence.

The pool itself still refuses a fold that cannot state its learning half, and refuses two folds whose
treatments disagree: the composition removes the assumption, not the check.

### 25.2 What it prints

The reading from this project's own two folds of τ² retail, 2026-11-18:

```
[cross-fit] pooled n=114 memory=0.8070 control=0.8684 delta=-6.14pp [-14.91, 2.63] p=0.2649 lost=18 gained=11 mde80=13.24pp
[cross-fit] folds: poc-l4-pair-official +2.50pp (n=40), poc-l4-pair-swapped -10.81pp (n=74)
[cross-fit] tiles 114 of 114 task(s); folds disagree in sign
```

Read it in this order:

1. **`pooled n`** — must equal the corpus. If it is smaller, look at the third line.
2. **`delta` and its interval** — the pair's own reading, over every task once. Here the memory costs 6.14pp and
   the interval still contains zero.
3. **`mde80`** — the smallest difference this many pairs could detect at 80% power. An interval that contains
   zero and an `mde80` larger than the delta is an unresolved reading, whatever the point estimate says.
4. **`folds:`** — the per-fold deltas, and the reason a pooled number is never the whole story: +2.50pp on one
   half and −10.81pp on the other is not a six-point loss, it is two findings whose average happens to be
   negative.
5. **`tiles` / `agree in sign`** — see below.

**When the folds disagree in sign, the pooled number is an average and nothing else.** Do not report it as the
effect: report the two folds and what differs between them. In this record the difference was the store's
density — 11 servable items over 40 renders against 3 over 74 — which is the finding the pool was bought to
expose, not a nuisance beside it.

### 25.3 The four refusals, and the defect each one stops

| refusal | what it would have produced |
| --- | --- |
| one fold supplied | the fold itself, described as a corpus |
| the same task evaluated in both folds | a task counted twice: n inflated, interval narrowed in the direction that flatters the result |
| a fold that evaluated a task **its own store learned from** | a leak, and the number comes out **better** than the truth instead of failing |
| a fold that does not state what it learned from | the leak check cannot run, and a missing check is never reported as missing by an average |
| two folds whose `treatment` differs | a larger sample of two experiments, averaged |

The third is the one to watch. It is invisible in a run: an arm that trains on its own evaluation set prints a
score, not an error.

### 25.4 `tiles`, and why it is a count rather than a refusal

`tiles 114 of 114 task(s)` means the two folds learned from and evaluated exactly the same set — the corpus is
covered once. When it reads `does not tile`, two counts follow:

- **evaluated and learned by neither fold** — a task no memory had seen at all;
- **learned and evaluated by neither** — the corpus's leftover, which the pooled `n` does not cover.

Neither is a failure. Both change what the pooled number is a number *about*, so the line states them beside it
rather than in a footnote.

### 25.5 What it does not do

It does not make a small effect resolved. On τ² retail with the observed discordance, 114 pairs resolve about
7–10pp; a real 4pp effect would still read `UNRESOLVED`, and the `mde80` on the line is how you know before you
spend the money.

---

## 26. The opportunity a render needs

A stored record is served on a turn, and the turn either gets better or it does not. The obvious score is
`repairs / renders` — and it is wrong, because **most turns have nothing to repair**. A record can only fix a
trial its control got wrong; on a trial the control already passed, the same record can only break it.

So every render is one of three things:

| outcome | what happened | counted as |
| --- | --- | --- |
| repair | the control failed this trial, and the arm passed it | an opportunity, taken |
| break | the control passed this trial, and the arm failed it | an opportunity, absent — only harm was possible |
| inert | the arm and the control agree, one way or the other | nothing |

### 26.1 What R141's census reads

```
serve yield: 40 render(s) over 14 record(s); 7 landed where a repair was possible (17.50%);
5 repaired, 1 broke, 34 inert (85.00%); no record is below its own rate at 5%
```

1. **40 renders over 14 records** — the store was served, and it was served repeatedly. A per-render average
   weights the nine-render record the same as the one-render record.
2. **7 of 40 (17.5%) landed on a repairable trial.** That is a property of the **corpus**, not of the store: it
   is how often the control fails and the retriever still finds a relevant record.
3. **5 repaired / 7 opportunities = 71.4%.** This is the record set's quality, and it is the only rate on the
   line that is about the store.
4. **33 renders could only do harm, and 1 did (3.03%).** This is the number the floor argument turns on: 82.5%
   of the store's exposure was pure downside risk, and the store converted 1 of 33.
5. **34 of 40 (85%) changed nothing at all.** A memory that is served and ignored is a token cost, not a
   mechanism — and a `repairs / renders` rate would have divided its 5 repairs by all 40.

The two rates are not interchangeable. `repairs / renders` on this arm is 12.5%; `repairs / opportunities` is
71.4%. One describes a corpus that rarely has anything to fix; the other describes a store that usually fixes
what it is given.

### 26.2 Why "no record is below its own rate" is the interesting half

A single record with zero repairs is not evidence of a bad record — most records have few chances. The test is
binomial: at the store's own repair rate `p`, how many opportunities does a record need before observing zero
repairs is unlikely at 5%?

```
opportunities = ceil(log(0.05) / log(1 - p))
```

At `p = 5/7 = 0.714` that is **3**. So a record that was served nine times but had one opportunity has told you
nothing, and a retention rule that dropped it would be reacting to a render count. The line prints "a record
needs 3 opportunities before zero repairs is evidence" for exactly this reason: it is a statement about how much
data would be required, not a verdict about the records in hand.

When no record is below its own rate, the honest reading is **the store has not been caught being wrong yet**,
not that every record is good.

### 26.3 The support census beside it

```
serve support: 14 of 14 servable item(s) served; no singleton was served;
support ≥2: 14 item(s), 1 broke, 5 kept, net +4; floor 2 in force
```

A **support floor** retires an item whose evidence covers fewer than `supportTasks` tasks, at serve time, with no
model call. Its claim is "an item that one task taught is not knowledge". The census is what tests that claim,
and it reads three things:

- **servable / served** — items the floor left standing, and items actually rendered;
- **singletons** — anything served with support 1, which would be the floor failing to apply;
- **the `support ≥2` bucket** — its `broke` / `kept` / `net` is the floor's ledger. A floor that retires half the
  store and changes no outcomes has cost tokens and bought nothing.

A caution that cost this project a reading: if the artefact's item sample is **capped** (the store writes at most
64 rows and reports the rest as omitted), an id missing from the sample is not a singleton. `supportMapOf` reads
the omission count and the consolidation groups before it grades anything, and the census reports the ids it
could not resolve instead of guessing — before that fix, six of fourteen served items were graded at support 1
and the floor looked broken when it was not.

### 26.4 What it does not do

It does not tell you whether to keep a record. It tells you how many opportunities the arm gave the records, how
many it took, and how much data a per-record verdict would need. On a corpus where 85% of renders are inert,
the answer to "is this record good?" is usually "you have not asked it enough times".

---

## 27. Waiting for the cheap window, and who is allowed to spend

The lane has two prices, and one of them is roughly double. The rate card declares its peak windows in UTC —
**01:00–04:00 and 06:00–10:00 on weekdays** — and a run that straddles the boundary is billed at both.

### 27.1 Three levers, and the one that bites

| lever | what it does | where it can go wrong |
| --- | --- | --- |
| `not_before: HH:MM` | the job sleeps until that UTC hour before its first paid step | a wait longer than **240 minutes** is refused, and a dispatch must still leave room for the run: send it no earlier than `target − (315 − deadline_min)` |
| the window guard | estimates the run from the registration's own caps and refuses if it would cross into peak | an estimate is only as good as the caps: a registration that pins no `trainTasks`/`testTasks` is refused, because an estimate of zero fits every window |
| `--require-off-peak` | the runner refuses a **phase** that starts inside peak | it is checked per phase, so it fires after the first phase has been paid for — which is why the guard exists in front of it |

The estimate is `(learn tasks + evaluated tasks) × trials × arms × 26 s + 10 min`: 114 tasks, one trial, two
arms is 109 minutes. That number is printed on every dispatch, pass or fail, so the next one can be sized
deliberately.

### 27.2 What a refusal looks like, and what it means

```
off-peak window: 30 minute(s) left against an estimate of 109 — the run would cross into the window that
opens at 06:00, and `--require-off-peak` is checked per phase, so the half it paid for would be lost.
Dispatch with not_before: 06:00
```

Read the last sentence first: a refusal always names the hour that would work. If it names an hour less than
240 minutes away, re-dispatch with it. If it names one further out, the run does not fit this window at all and
either the caps come down or the dispatch waits.

### 27.3 A guard two arms must both obey

The guard publishes its answer (`fits`) and **both** arms consult it, because the alternative was measured:
one arm's `if:` expression inherited GitHub's implicit `success()` and the other's did not, so a refused
dispatch skipped one arm and bought the other. That is $0.10 of control arm against a run already refused —
and it is invisible in the job summary, which shows one skipped step and one green one.

The related defect is worth knowing because it is silent and slow: an hour that has already passed is read as
**tomorrow's**. A dispatch that slept to 04:00 and then asked the guard for permission was told its window was
1440 minutes away, after the wait was spent. The waiter therefore publishes the instant it woke and the guard
consumes that instant; `not_before` is parsed once, by the step that sleeps on it.

### 27.4 The checklist before a paid dispatch

1. The registration pins `trainTasks` and `testTasks` — otherwise there is no estimate.
2. `not_before` names an hour at least `estimate` minutes before the next peak window opens.
3. The dispatch is sent no earlier than 240 minutes before that hour, and leaves `deadline_min + 25` minutes
   inside the 340-minute job limit.
4. `pnpm eval:band` says off-peak **now**, if the run is not waiting.
5. The workflow file parses — an expression error is a 422 at dispatch, not a red step at the line, and it
   costs the round a dispatch window rather than a dollar.

---

## 28. Where the harm landed

§26 reads a record's outcome. This reads the same renders from the other end: **which task did the store reach,
and did it help there or hurt there**. The two questions have different fixes, which is why they are two
readings rather than two views of one.

A store that breaks one trial of a hundred and a store that breaks one *task* of a hundred produce the same
`breaks` count.

| the shape | what it usually is | what fixes it |
| --- | --- | --- |
| one task, many renders, net negative | **reach**: the retrieval found something plausible for a task family the store has nothing to say about | a retrieval gate, or a content axis that can tell the families apart |
| many tasks, one render each, net ±1 | **interference or luck**: the store changed one episode per task | a floor, or more trials — not a gate |

### 28.1 The line

```
serve tasks: 40 task(s) reached by 40 render(s); 1 harmed, 4 helped, 35 neutral, 0 contested; worst t21 -1 over 1 render(s)
```

1. **`task(s) reached by render(s)`** — the population. Two numbers, because they answer different questions: a
   store that reached 4 tasks 40 times is a store concentrated on a few families; one that reached 40 tasks 40
   times is a store spread across the corpus.
2. **`harmed / helped / neutral`** — the net per task. `neutral` being the largest bucket is the normal reading
   on this corpus, and it is the same fact as §26's 85% inert seen from the other side: the store was served and
   changed nothing.
3. **`contested`** — tasks where the store both repaired one trial and broke another. This is not a fourth
   bucket; it cross-cuts. A task at net zero can be contested, and that is a very different reading from a task
   the store reached and did nothing on: one says the record is wrong *for this task*, the other says it is
   irrelevant to it.
4. **`worst t21 -1 over 1 render(s)`** — the lowest net, with the renders it took. One render is not a verdict,
   and the line prints the count beside the net precisely so the reader does not turn `-1` into a rate.

### 28.2 Reading it against §26

| if | then |
| --- | --- |
| `breaks` are spread over many tasks at one render each | the floor is the right lever: the store is being served where it could not have been right, and `supportTasks` is the only signal available |
| `breaks` concentrate on a few tasks with many renders | the floor cannot help: those records *pass* the floor, and the problem is that the content says something true about the wrong family |
| `contested` is non-empty | at least one task is evidence about a record's applicability rather than about the corpus, and that task is the first place to read the claim text |

### 28.3 What the field is, and is not

The render names its task for **attribution**. Nothing divides by a task: there is no per-task rate, and the
suite asserts that the record census (`serve yield`) produces an identical table with and without the id. If you
are writing a statistic that divides by `tasks`, it belongs in a new census with its own denominator argument —
not here.

An artefact written before this field existed prints:

```
serve tasks: no render named a task, so the population axis is unread on this artefact (40 render(s))
```

That is an absence, not a clean population. `0 task(s) reached` would be the wrong sentence for it, and this
project has paid for that confusion twice.

### 28.4 What it still cannot answer

**Was the claim right for the tasks that taught it?** The store sample is capped (64 of 83 rows on R141) and
carries `supportTasks` as a *count*, not as a list of ids, so a record's provenance is not in the artefact. The
join grain `(record, task)` now exists; the provenance is the next instrument, and until it lands, a claim's
text can be read against the task it was served into but not against the tasks it came from.

---

## 29. The three axes of a serve, and the fourth thing a registration fixes

A memory pack is a function of three things: the store, the query, and the options the dispatch fixed. The options
are separate switches, and a registration may name any of them.

| axis | question | values | default |
| --- | --- | --- | --- |
| `packMode` | **where** is the pack served from | `retrieved` (by relevance, under a budget) / `prefix` (every admitted entry, into the system prompt) | retrieved |
| `packShape` | **what unit** is it written in | `per-failure` (one line per failure) / `collapse` (one per routine) | whatever the distiller wrote |
| `serveAnchor` | **what may appear inside it** | `lexical` (a rule must share a word with the request) / `scope` (structure alone may justify it) | scope |

### 29.1 Why the third axis exists

`scope` lets a rule appear because its scope matched, even when it shares no word with the request. `lexical`
requires one word in common. The difference is not stylistic: it is the guard against the failure mode the 2026
literature attributes most memory harm to — a *valid* rule applied outside the situation it was learned in.
WikiTrace (arXiv 2611.14320) traces 52% of degradation events to a followed memory entry, and of those, 80% to a
valid insight misapplied rather than an outright wrong one.

### 29.2 How to ask for it

```yaml
serveAnchor: lexical
```

One header line. It becomes `anchoring=lexical` on the recall request, the arm's artefact records the whole knob
string under `tau2.pack.knobs`, and the cross-fit pool treats it as part of the treatment's identity.

| you wrote | the request carries | the artefact records |
| --- | --- | --- |
| nothing | no `anchoring` parameter (byte-identical to every earlier run) | `knobs: ''` |
| `serveAnchor: scope` | no `anchoring` parameter | `knobs: ''`, and the registration says the default was chosen |
| `serveAnchor: lexical` | `anchoring=lexical` | `knobs: 'anchoring=lexical'` |

The middle row is the interesting one: naming the default changes nothing on the wire and everything in the
record. That is deliberate — a run that *relies* on a default should be able to say so.

### 29.3 The combination that is refused

```
a prefix arm renders every admitted entry, so a lexical anchor has nothing to filter:
TAU_PACK_MODE=prefix and TAU_SERVE_ANCHOR=lexical cannot both be honoured
```

Both knobs would land in one query string (`anchoring=scope` from the mode, `anchoring=lexical` from the anchor) and
the last key would win in silence. The refusal happens where the three plans are joined, before a model call.

### 29.4 What the pool does with it

A fold's treatment is its identity: unit, form, scope, model, trace ceiling — and now the knob string. Two folds
served through two filters are two experiments, and pooling them would report a mean about a serving neither fold
performed:

```
[cross-fit] REFUSED: the folds are two experiments, not one corpus: knobs is 'anchoring=lexical' on A and 'none' on B
```

An artefact written before the field existed reads as `none`, so it still pools with a newer fold that carried no
knobs — the two produced the same request, and only an *absent* filter and a *named* one are different facts.

## 30. What a threshold would have done, priced before you spend on it

Every serving knob in §29 has a threshold inside it — a margin below which a pack is withheld — and until now the
only way to choose one was to run the arm at each candidate value. A dispatch costs about a quarter of a dollar
and an hour of off-peak wall clock, so the loop "run, read, run again" was the expensive part of tuning, not the
model calls.

The readback step now prices every candidate threshold against the outcomes the run has already paid for.

### 30.1 Where the number comes from

Three arrays in a memory arm's artefact, one row per recall request, in the order the requests arrived:

| array | what it holds |
| --- | --- |
| `tau2.pack.ledger` | the ids of the records served at that request (`[]` when the gate withheld) |
| `tau2.pack.margins.perRequest` | the ranking margin the gate saw, or `null` when only one candidate competed |
| `per_trial` + `tau2.memory.episodeStarts` | which trial the request belonged to, and whether each arm passed it |

`pnpm eval:l4-pair` joins them and prints:

```
serve sweep (estimated, withholding is priced as the control outcome): the first rung that withholds every
break is 0.30, which keeps 2 repair(s) and serves 7 of 57 trial(s); net by rung 0.00 -3.51 / 0.05 -3.51 /
0.08 -1.75 / 0.10 -1.75 / 0.15 +0.00 / 0.20 -1.75 / 0.25 +0.00 / 0.30 +3.51
```

### 30.2 How to read the sentence

- **`the first rung that withholds every break`** is the cheapest threshold at which no trial that the control
  passed is broken by the memory, *while at least one repair survives*. Ascending order, so it is the smallest
  such value. If no rung qualifies the line says so, and a rung that withholds everything never qualifies —
  silence is not safety.
- **`keeps N repair(s)`** is what that threshold costs: repairs the gate also throws away.
- **`serves S of T trial(s)`** is the traffic left. A rung that keeps two repairs by serving seven of fifty-seven
  trials is a **fitted** value, not a lever — it wins because the breaks happened to sit low, and the next run is
  free to disagree.
- **`net by rung`** is `kept − broke` over every trial, in percentage points, so a rung's number is comparable
  with the paired delta on the line above it.
- **`the margin orders a repair above a break at AUC … exact p …`** is the question underneath the rungs:
  whether the ranking carries any information about the outcome at all. `AUC` is the chance that a repaired
  trial outranks a broken one, ties counted a half; `p` is the **exact** one-sided probability of a ranking at
  least that good when the two labels are shuffled across the same margins. `exact p 0.305 over 210
  labelling(s)` means the observed order is unremarkable — four against six cannot be told from a shuffle —
  and the clean rung below it is a fitted value.

### 30.3 What "estimated" means, and why it is in the sentence

A trial the gate withholds is priced at **its control outcome** — the bare agent that produced the reference half
of the pair. That is an estimator, not a measurement: a model that was shown a procedure and then not shown it is
not the same model as one that never saw it, and the join cannot see the difference. So a rung is *priced* here
and *measured* by a dispatch, and the line says which one it is doing.

### 30.4 The two absences it keeps apart

| state | meaning | what the sweep does |
| --- | --- | --- |
| the key is missing | the arm carried no margin census: nothing was asked | the whole sweep is not published |
| the value is `null` | the census ran and this request served one candidate: nothing was contested | served at every rung, and counted in `unpriced` |

Both are served at every rung, because a gate with no measurement cannot have withheld anything — but a store that
serves one candidate per request is a store no threshold can act on, and a reader should see that rather than
infer it.

## 31. What your numbers can resolve, and why re-running one arm is not optional

A paired read gives you a delta and an interval, and the interval is exact for the two runs in front of you. It
does not tell you whether **another dispatch of the same treatment** would land in the same place, and until you
know that, a small delta is not a finding.

### 31.1 The two questions, and which one the artefact answers

| question | answered by | what it assumes |
| --- | --- | --- |
| "given these two runs, how surprising is this split?" | the McNemar interval on discordant pairs | nothing — it is exact |
| "would the treatment move the outcome again?" | `minDetectablePp` — the paired SE, which already carries both arms' noise | that a new dispatch does not carry a variance the pairing cancels |

Every `minDetectablePp` in `eval/results` is the second kind: it is formed from the discordant pairs of one run,
which is the variance of the *paired difference* and therefore contains the control arm's own noise. What it
does not contain is the variance of drawing a whole new pair of arms, and that is a different question with a
different (larger) answer — `sqrt((p1*(1-p1)+p2*(1-p2))/n)` — which §31.3 keeps separate for that reason.

### 31.2 How far it moves, measured once

Two dispatches of the *same* reference arm, same 57 tasks, same model, forty minutes apart:

```
R142 reference  47 / 57        R151 reference  51 / 57
agree 47        (both pass 44, both fail 3)      disagree 10   (3 down, 7 up)
flip share 0.175              McNemar exact p 0.344
```

The arm did not change. It moved **7.02pp** and flipped **17.5%** of its tasks.

### 31.3 The arithmetic to redo whenever you quote an MDE

Two questions, two variances, and they are not interchangeable:

```
unpaired SD   = sqrt((p1*(1-p1) + p2*(1-p2)) / n)   two independent draws of one arm
paired SE     = sqrt(b + c) / n                     b, c = discordant pairs, one run
MDE80         = 2.802 * SE                          the constant the protocol uses
```

On the numbers above, the two control rates are `p1 = 0.8246` and `p2 = 0.8947`:

| quantity | value |
| --- | --- |
| disagreement two **independent** draws would produce | `p1*(1-p2) + (1-p1)*p2` = **0.2438** |
| disagreement observed | **0.1754** |
| unpaired SD of the difference | **6.47pp** |
| paired SE the artefact prints | **5.36pp** |
| MDE80 at 40 tasks / 57 tasks / 114 tasks | **18.53 / 15.55 / 10.98pp** |

The observed disagreement is **below** what independence predicts, which is the direction of a positive
task-level correlation: the two estimators differ by `1 - (5.36/6.47)^2 = 0.31`, and the flip share implies
`1 - 0.1754/0.2438 = 0.28`. Pairing buys that much and no more.

**The mistake to avoid, because this guide made it.** Do not build a per-arm SD out of the *flip share*
(`sqrt(f*(1-f)/n)`) and multiply it by `sqrt(2)`: `f` is a disagreement rate between two draws, not an outcome
proportion, so the result double-counts and then compares an unpaired SD against a paired SE. That arithmetic
produced a 19.9pp figure which has been retracted; the paired MDE the artefact prints is the one that belongs to
the design that produced the delta.

### 31.4 What to do about it

- **Quote the pair's interval as what it is**: exact given these two runs, and the resolution that belongs to a
  paired design — 15.55pp at 57 tasks, 10.98pp at 114. Do not quote a 4pp delta as a finding at those sizes.
- **Prefer tasks to trials.** `n` and `k` both shrink the noise, but trials within a task are correlated, so
  `k` shrinks less than `sqrt(k)` and the pass^k metric exists precisely because of that. 114 independent pairs
  resolve 10.98pp; 228 correlated trial pairs on 57 tasks claim 7.8pp and deliver less.
- **Re-run one arm before believing a mechanism.** One reference dispatch is $0.13–0.15 off-peak and it is the
  only way to know your own noise floor. A lane that has never run the same treatment twice has never measured
  the number its intervals depend on.
- **Read `eval:power` as a floor, not a verdict.** It recomputes every published delta against its own MDE; the
  coarsest design on the record is the one to quote when someone asks what the project can see.

## 32. Bounding how far one item travels

§29 lists the axes that decide **what a pack may contain**. This one decides **how the phase's renders are shared
out**, which is a different question: every pack §29 allows can still be served on every request while one record
does all the work.

### 32.1 The reading it answers

Two folds of one treatment, same day, same split size in total:

| reading | fold with 11 servable items | fold with 3 servable items |
| --- | --- | --- |
| renders | 40 over 10 items | 75 over 3 items |
| renders per servable item | 3.6 | 25.0 |
| harm share | 8.33% | 23.81% |
| delta | +2.50pp | −10.81pp |

The store that kept fewer items did not become careful. It served each of them **everywhere**, because the recall
path had nothing else to offer, and the item that took twelve renders on the rich fold was the one that repaired
nothing while the three items that did repair something were served five, six and one time.

### 32.2 How to ask for it

```yaml
serveRotation: fair-share
```

One header line, and the cap is not in it — it is arithmetic over the store the run builds:

```
cap = ceil(requests / servable)        # 40 requests over 11 servable items → 4
exclude = { ids whose renders ≥ cap }  # sent as RecallQuery.exclude
```

| you wrote | the request carries | the artefact records |
| --- | --- | --- |
| nothing | no `exclude` parameter (byte-identical to every earlier run) | no `serveRotation` block |
| `serveRotation: off` | no `exclude` parameter | `serveRotation.mode: 'off'` — the declared control |
| `serveRotation: fair-share` | `exclude=k_a,k_b` once items reach the cap | `mode`, `cap`, `maxRenders`, `renders`, `distinct`, `exhausted`, `starved` |

The middle row there is the analogue of §29.2's: declaring the identity sends nothing across the socket and still
makes the artefact say which policy it was, because the report carries its own `mode`. The pool compares that
string, so an arm that bounded travel and an arm that never mentioned the switch are refused as one experiment
rather than averaged — and the composition refuses to carry the field across a silent fold, since here the absence
*is* the control.

The cap is computed rather than written down because a constant in a header is a guess about a store that does not
exist yet. When the store is bigger than the phase the cap is 1, which is still a spread; when the phase is bigger
than the arithmetic can cover — three items against seventy-five requests — the policy is the identity, and the
artefact says so instead of claiming a treatment it did not apply.

### 32.3 Why the exclusion is not a filter on the finished pack

It is honoured inside the store's search, before ranking, so the pack serves the **next** rule:

```
same request, limit 2, excluding the leader
  without exclusion: [leader, runner]     ← 2 items
  filter after the pack: [runner]         ← 1 item: a dose change wearing an allocation change's name
  excluded in the search: [runner, tail]  ← 2 items: the allocation change this is
```

Three things follow, and all three are asserted in the suite rather than described here: the pack's size is
unchanged, the rendered block carries the substitute rule instead of a hole, and the relevance normalisation is
taken over the items the request may serve — a maximum left over an excluded item would deflate every remaining
score and make a margin gate read a contest the exclusion created.

### 32.4 What a phase can be starved of

A request is **starved** when every servable item has already taken its share, so the only pack the store can
return is empty. That is a different finding from a store with nothing to say, and the reading separates them:

```
serve rotation: cap 4 per item from 40 request(s) over 11 servable item(s); max 4, 40 render(s) over 10 item(s), 2 exhausted
serve rotation: absent (the store can serve nothing, so no share exists)
serve rotation: absent (no request was made; fair share over 11 item(s) is unmeasured)
```

`max` beside `cap` is the number that keeps an inert arm honest: `max 3` under `cap 4` says the ranking never
reached the bound, so the dispatch ran as its own control.

### 32.5 When the numbers are written

The block is filled **after** the phase, from one reading:

```ts
const rotationReading = rotation?.reading();          // after the loop, not beside the ledger
if (rotationReading !== undefined) write(rotationLine(rotationReading));
const report = { mode, ...(rotationReading ?? {}) };  // the same object the line printed
```

One read, used twice, because the two consumers are read by different people at different times and a disagreeing
pair is worse than either alone. The first version built the report beside the ledger — before the loop — which is
the natural place for `mode` and the wrong place for the reading: it shipped `requests: 0` and `maxRenders: 0`
beside a log line saying forty renders over fourteen items. The log is what a readback greps; the artefact is what
survives.

Two consequences worth knowing when you read an artefact:

- `serveRotation` is absent on an arm that declared no policy, and `{ mode: 'off' }` on an arm that declared the
  identity. An arm whose block is missing entirely is not "the default"; it is a run that never heard of the switch.
- If the block is present but `requests` is `0` while the phase served packs, the file is from a build older than
  this section. The pair refuses it (`l4-rotation-reconciles` compares the block with the ids the same file's
  `pack.ledger` carries, and blocks on a disagreement), and the fold is not poolable: read the cap from
  `pack.summary` and the renders from the run log, and do not re-derive the policy — no file holds one.

### 32.6 The policy is withdrawn; the instrument stays

The two folds in §32.1 moved **both** quantities at once — renders per servable item and how many items survived the
floor — so the line drawn through them was a line through two confounded points. Three draws at the same dose
separate them:

| draw | servable items | renders per item | harm share | delta |
| --- | --- | --- | --- | --- |
| R152, cap 3 | 14 | 2.86 | **5.88%** | +2.50pp |
| R152b, cap 4 | 13 | 3.08 | not measured | — |
| R152c, cap 4 | 13 | 3.15 | **20.59%** | **−7.50pp** |

At 2.9 and 3.2 renders per item the harm share differs by fifteen points, so **renders per servable item does not
determine the harm** at these store sizes, and the one drawn below the revert bar withdrew the policy: a
`serveRotation: fair-share` registration is no longer the recommended default, and nothing in the template sets it.

What remains true, and is why the switch is still in the kernel:

- the cap acts on exactly what its reading says — `maxRenders` equalled the cap in all three bounded draws, the
  leader's renders fell from 12 to 3–4, every servable item was served and no phase was starved;
- the ledger, the report and `l4-rotation-reconciles` make allocation an **observable** quantity, which nothing else
  in this lane had before;
- an instrument whose numbers are checkable against its own artefact is worth keeping even when the policy it was
  built for does not earn its default.

If you use it, use it as an experiment: state the mode, read `maxRenders` against `cap`, and do not expect the
score to move — on four draws of one treatment the arm's own `pass^4` ranged 0.775 to 0.925, which is wider than
anything a 40-task fold can resolve.

### 32.7 Re-grading a pair instead of re-running it

A gate is a function of numbers the artefact already contains, so when the gate is wrong the cure is not another
dispatch. `pnpm eval:l4-regrade eval/results/poc-l4-pair-official.json eval/results/poc-l4-pair-swapped.json`
recomputes the `l4-*` rows of a committed pair from its own `verdict`, `comparison` and `protocol` blocks, and
writes them back only with `--write`:

```console
$ pnpm eval:l4-regrade eval/results/poc-l4-pair-*.json
[l4-regrade] eval/results/poc-l4-pair-official.json: l4-effect-resolved pass stays fail
[l4-regrade]   UNRESOLVED: |2.50pp| against 18.53pp minimum detectable difference
[l4-regrade] eval/results/poc-l4-pair-swapped.json: l4-effect-resolved pass -> fail
[l4-regrade]   -10.81pp against 17.76pp minimum detectable difference — the memory costs accuracy: -10.81pp, which is a direction this pair cannot claim
[l4-regrade] 2 row(s) moved across 2 artefact(s) — dry run, pass --write to apply
```

Three properties make this safe to run against evidence rather than merely convenient:

- **It refuses a file it would reformat.** The parse is round-tripped through the writer's own
  `JSON.stringify(value, null, 2)` and compared byte for byte with the input. A re-grade of two rows that
  reindented a 43 kB file would hide the re-grade inside a rewrite, and no diff would show it.
- **It refuses a file it cannot read in full.** Every input is read through an accessor that throws instead of
  defaulting. A defaulted `protocol.detectablePp` would become `undefined`, which the predicate treats as "no
  resolution", which would silently turn every regraded row false — a reading that looks like a finding.
- **It refuses to add rows.** `poc-l4-pair-official.json` predates `l4-rotation-reconciles`; the row it cannot
  have written is printed (`predates … — not added`) rather than appended, because an artefact dated to a driver
  that did not have the gate is a fabricated record.

The diff is the reviewable thing. Two commits of `pair-gates.ts` later, these are the only lines the re-grade
moved in either file:

```diff
-      "criterion": "the pair resolves the effect it reports: |delta| >= minimum detectable difference, or no direction is claimed",
+      "criterion": "the pair may be quoted as a finding: it publishes a direction, and |delta| >= its own minimum detectable difference",
```

and, on the swapped fold only, the row that had certified `−10.81pp` as a resolved harm:

```diff
-      "actual": "the memory costs accuracy: -10.81pp",
-      "pass": true,
+      "actual": "-10.81pp against 17.76pp minimum detectable difference — the memory costs accuracy: -10.81pp, which is a direction this pair cannot claim",
+      "pass": false,
```

Because the check runs in `pnpm check`, the same command is a gate: if a future edit to `pair-gates.ts` moves a
row of either committed artefact, the build fails until the evidence is re-graded — which is the same rule as
`l4-projection-complete` one level up, applied to the table rather than to the fields.

### 32.8 Headroom: the most a fold could have shown

A memory can only repair a trial the bare agent failed, so a fold where the control passes 34 of 40 tasks
cannot produce a delta above **+15.00pp** — and that is a perfect store, one that repairs every failure and
breaks nothing. Compare that ceiling with the smallest effect the same fold can resolve and the four red rows
in this record explain themselves:

```console
$ pnpm eval:headroom eval/results/poc-l4-pair-official.json eval/results/poc-l4-pair-swapped.json
| fold | n | control pass^4 | ceiling | minimum detectable | verdict |
| --- | --- | --- | --- | --- | --- |
| `poc-l4-pair-official` | 40 | 0.9000 | **10.00pp** | 18.53pp | silent |
| `poc-l4-pair-swapped` | 74 | 0.8514 | **14.86pp** | 17.76pp | silent |
```

**Every fold in this record has a ceiling below its own resolution.** R152 and R152c read 15.00pp against 15.66pp
and 23.23pp; the two committed folds read 10.00 and 14.86 against 18.53 and 17.76. So no store, however good,
could have been certified on any of them, and the `UNRESOLVED` rows were statements about the design from the
first dispatch.

Two consequences you can use:

- **Read the headroom before paying for the fold.** `pnpm eval:headroom` runs on any pair artefact and prints
  the table above; the line also prints during every pair, and the block is carried in the artefact as
  `headroom`, so a reader never has to recompute it.
- **Significance and resolution are different questions, and this is where they part.** Six discordant pairs
  all in one direction give `p = 0.0156`, so a perfect store *would* be significant — and would still be
  reported as unresolved, because the resolution predicate is about the size of the point estimate. Both are
  true of the same reading, which is why the advisory gate asks about `|delta|` rather than about the verdict
  state (§32.7).

The smallest fold in this record whose ceiling clears its resolution is the pooled 114-pair one (14.0pp against
13.24pp, and only by 0.8pp). That is why the next reading is pooled or on a harder corpus rather than a fifth
40-task draw: on forty tasks with a 0.85 baseline, the design cannot see what the mechanism is asked to do.

### 32.9 Two rates instead of one delta, and the break-even between them

Every delta this record has published is a weighted average of two rates it never printed. A repair can only
come from a trial the control failed and a break only from one it passed, so on a corpus the bare agent already
solves 86% of, the delta spends 86% of its weight on the population where the memory can only lose:

```
delta = f·r − (1−f)·b        f = failure share, r = repair rate, b = break rate
```

`pnpm eval:conditional <pair-artefact.json ...>` divides the same counts by the populations they came from:

```console
$ pnpm eval:conditional eval/results/poc-l4-pair-official.json eval/results/poc-l4-pair-swapped.json \
      eval/results/poc-l4-pair-r152.json eval/results/poc-l4-pair-r152c.json
| fold | trials | failed | repaired | passed | broken | repair rate | break rate | break-even | net |
| poc-l4-pair-official | 40 | 4 | 4 | 36 | 3 | 100.00% [51.01, 100.00] | 8.33% [2.87, 21.83] | 11.11% | 2.50pp |
| poc-l4-pair-swapped  | 74 | 11 | 7 | 63 | 15 | 63.64% [35.38, 84.83] | 23.81% [14.99, 35.64] | 11.11% | -10.81pp |
| poc-l4-pair-r152     | 40 | 6 | 3 | 34 | 2 | 50.00% [18.76, 81.24] | 5.88% [1.63, 19.09] | 8.82% | 2.50pp |
| poc-l4-pair-r152c    | 40 | 6 | 4 | 34 | 7 | 66.67% [30.00, 90.32] | 20.59% [10.35, 36.80] | 11.76% | -7.50pp |
| **pooled (4 folds)** | 194 | 27 | 18 | 167 | 27 | 66.67% [47.82, 81.36] | 16.17% [11.36, 22.50] | 10.78% | -4.64pp |
```

Three things to read out of it:

- **The memory repairs two thirds of the trials the bare agent fails.** 18 of 27, interval `[47.8%, 81.4%]`. That
  is a large, consistent effect and it is invisible in the delta, because failures are 14% of the sample.
- **It breaks one in six of the trials the bare agent already passes.** 27 of 167, `[11.4%, 22.5%]`. This is the
  harm the last four rounds have been arguing about, and it is also the larger of the two counts.
- **The break-even is 10.78%.** Setting the identity to zero gives `b* = r·f/(1−f)`; at this corpus's failure
  share the store's break rate has to fall below **10.8%** to pay for itself, and it is at 16.2% — over its own
  bar by 5.4pp.

**This is the first numeric target the harm side has had.** "The memory costs points" is not actionable; "the
break rate must come down by a third on this corpus" is, and a content axis can be graded against it. Note that
the bar is a property of the corpus as much as of the store: at a 30% failure share the same store would break
even at 28% breaks.

**Why the interval is wide, and honestly so.** A rate over 27 failures is estimated from 27 trials, not from 194,
which is why the repair interval spans 34 points. Wilson rather than the normal approximation throughout: at 4 of
6 the textbook interval runs to 104%, and a rate above 100% is a wrong number rather than a wide one.

**What the same command says about the bars.** Beside the table it prices the effect sizes this lane argues about
at its own observed discordance (0.232 pooled):

| bar | paired trials needed | largest fold this record has run |
| --- | --- | --- |
| 3pp | 2,024 | 74 |
| 5pp | 729 | 74 |
| 10pp | 183 | 74 |
| 15pp | 81 | 74 |

The rule this lane reverts on is `−5pp with a served pack`, and at its own discordance that rule needs **729
paired trials to be resolvable**. A bar whose price is never computed is a rule that fires on readings the design
cannot certify, and the direction of that error is the expensive one: it reverts on noise.

**Reconciliation is a gate in `pnpm check`.** `serveYield`'s four counts must reconstruct the delta the pair
published, to 0.005pp; two blocks that disagree about one comparison mean one of them is wrong and neither says
which. The gate does not grade whether a store pays for itself — that is a measurement, and a build that fails on
a negative measurement teaches its readers to skip the line.

### 32.10 The metric is part of the comparison, and four rounds had the label wrong

`pass^k` at two different `k` are two statistics. For a per-trial rate `p`, `pass^1` is `p` and `pass^4` is
`p⁴`; at `p = 0.95` the first reads 95% and the second 81%. Nothing in a delta, an interval or a count of
tasks can tell you which one you are looking at, which is why it has to be a field.

**What was found, at zero cost.** Every one of the four registrations behind the pooled fold declares
`trials: 1`:

| draw | registration | header | what the artefact calls it |
| --- | --- | --- | --- |
| `poc-l4-pair-official` | `prereg/R143-fold-official.md` | `trials: 1` | `pass4` |
| `poc-l4-pair-swapped` | `prereg/R143-fold-swapped.md` | `trials: 1` | `pass4` |
| `poc-l4-pair-r152` | `prereg/R152-the-travel-budget.md` | `trials: 1` | `pass4` |
| `poc-l4-pair-r152c` | `prereg/R152c-the-paired-fold.md` | `trials: 1` | `pass4` |

Four rounds of headlines — 0.925, 0.851, 0.875, 0.775 — are **per-task pass rates over one trial**, and both
published bars (`0.575` and `0.6754`) are `pass^4`. The rank claim was made in one metric against a bar in
another, and until now no file said so: the pair artefact did not copy `k`, and the arm's `metrics.k` was read
by nothing.

**What the artefacts now carry.** Three fields and one gate:

```console
$ pnpm eval:l4-pair          # first line of the run, and protocol.* in the artefact
[l4-pair] metric: k = 1; the bar is k = 4, so a delta against it is cross-metric as well as cross-sample
```

| field | meaning |
| --- | --- |
| `first.k`, `second.k` | each arm's own `metrics.k`, or `null` when the artefact predates the field |
| `protocol.k` | the level both arms share, or `null` when they stated different ones |
| `protocol.kAbsent` | which arm stayed silent, when the pair cannot say |
| `protocol.barKMismatch` | whether the shared level is the bar's — the same statement `bar_backbone_matches` makes about the model |
| `protocol.restatedAtBarK` | each arm's headline raised to the bar's `k`, with its independence assumption printed beside it |
| `l4-same-k` | a blocking gate: two arms scored at different levels are not a pair |

On the published fold the restatement reads `0.925 → 0.7321` for the memory arm and `0.85 → 0.522` for its
control. The memory still clears `0.575`, by 15.7pp rather than by 35pp, and it clears the competitor's
submitted `0.6754` by 5.7pp — cross-sample and cross-backbone, as the artefact's own notes say. **The
restatement is an estimate**: it treats the four trials of a task as independent, which flatters a store whose
misses cluster, and the assumption travels in the field rather than in a footnote.

**And the same field closes a reproducibility gap.** Two of the four draws had never been committed, so
`b* = 10.78%` could not be recomputed from the repository. Both are now in `eval/results/`, recovered byte for
byte from the runs that wrote them (`44363599721`, `44395483632`), and `eval/results/poc-l4-draws.json` records
each draw's `k` with the evidence it came from. `pnpm eval:conditional ... --draws=eval/results/poc-l4-draws.json`
prints the pool split by metric and **refuses** when a census row disagrees with the artefact it describes.

```console
$ pnpm eval:conditional eval/results/poc-l4-pair-*.json --draws=eval/results/poc-l4-draws.json
| metric | draws | trials | failed | repaired | passed | broken | repair rate | break rate | break-even | net |
| pass^1 | official, swapped, r152, r152c | 194 | 27 | 18 | 167 | 27 | 66.67% [47.82, 81.36] | 16.17% [11.36, 22.50] | 10.78% | -4.64pp |
```

One stratum, and that is the answer to a question the split was built to ask: the pool is **homogeneous**, so
the break-even of 10.78% is not an artefact of mixing two metrics. What it is, is a target measured on a metric
the bar does not use.

**Re-grading is now narrower than it was.** The tool that repairs a gate by re-grading the evidence it already
has (`pnpm eval:l4-regrade`) used to recompute every `l4-*` row from the pair artefact. Two of those rows have
evidence that is not in that file — whether the driver's emitted fields reached the artefact, and whether the
arm's serving policy reconciles with its pack ledger. Recomputing them can only ever confirm the fields that
arrived, and the first run over the two recovered draws did exactly that: R152's artefact recorded
`l4-projection-complete: false` and the re-grade turned it **true**. The allow-list in `pair-regrade.ts` is the
fix, and the rows it will not touch are printed with their reason.

### 32.11 What the target costs, and why more of the same data cannot certify it

Two different questions sit under "get the break rate under 10.78%", and they have different prices.

**Detecting the change.** Moving `b` from 16.17% to 10.78% moves the headline delta by `(16.17 − 10.78) × 86.08%
= 4.64pp`, and the pairs that takes depend on something unknowable before the run: whether the new break set is
nested in the old one. At one end every remaining break was already a break, so the discordance *is* the effect
and the price collapses to `z²/effect`; at the other the break sets are as unrelated as the corpus's own draws.

```console
$ pnpm eval:conditional eval/results/poc-l4-pair-*.json
Moving the break rate from 16.17% to the 10.78% bar costs between 170 paired tasks (if every remaining break was
already one) and 847 (at this corpus's 23.20% discordance), against the 74-pair fold on the table.
```

**Certifying the level.** "The break rate is under 10.78%" is an absolute claim, and it needs an interval whose
upper end is under the bar — Wilson on the control's passes, not McNemar on the delta. This is the one that
decides whether a fold of a given size can make the claim *at all*:

```console
$ pnpm eval:conditional eval/results/poc-l4-pair-*.json
certify: at 167 pass(es) a 16.17% break rate is certified only below 22.50%, which does not reach the 10.78% bar;
no sample certifies a rate at or above its own bar, so 10.78% cannot be certified by measuring it again

| planned break rate | passes to certify it below the break-even | the same, if every pass were a task |
| 2.69% | 57 | 67 |
| 5.39% | 128 | 149 |
| 8.08% | 509 | 592 |
| 10.78% | never | never |
```

**The property that matters is the last row.** A rate sitting on its own bar can never be certified below it,
because the interval always has positive width. So the target is not something a bigger sample settles: it has to
be *reached*, and the distance below it that a fold can certify is the fold's own half-width.

Three consequences, each of which changes what the next dollar buys:

- **The 164-pair fold on the roadmap cannot grade the target.** Its cheapest price is 170 pairs and its central
  one is 847, so even the best case is 6 pairs short and the honest case is five times short.
- **A fold of 592 tasks certifies an 8% break rate under the 10.78% bar**; 149 tasks certify 5.39%. Those are
  the two sizes the next dispatch should choose between, and the choice is a claim about how far the content
  axis is expected to move the rate, not about how much money is available.
- **The current fold certifies almost nothing about the harm side.** 167 passes at a 16.17% rate certify only
  "below 22.50%", which is the same sentence the pooled interval printed before any of this arithmetic existed.

### 32.12 The statistic that said "loses" about memories that helped

`pnpm eval:exchange` prints one table. It is short, it needs no dispatch, and it changed three verdicts this
record had already published.

```console
$ pnpm eval:exchange
source                               n clus   rep   brk    netPp     low    high   netOdds   low  high verdict
bird-train                        7000   58   187   237    -0.71    -1.26   -0.18     0.789 0.657 0.942 loses
bird-dev-rule                     1534   11    67    62     0.33    -0.61    1.40     1.081 0.857 1.382 unresolved
bird-dev-lexicon                  1534   11    78    67     0.72    -0.78    2.39     1.164 0.841 1.650 unresolved
bird-mini-recall-order             350   11    19    17     0.57    -3.48    5.02     1.118 0.500 3.250 unresolved
tau2-retail-pooled                 194  114    18    27    -4.64   -11.45    1.60     0.667 0.345 1.167 unresolved
```

**What was wrong.** `admission.ts` published `clearance = helpPerHarm / hurdle` and documented it as "a clearance
below one is a memory that loses". The net change is `repaired − broken`, so the memory pays exactly when
`repaired ≥ broken` — the bar on `helpPerHarm` is **1**. The hurdle is `breakable / repairable`, which is the
break-even for the **rate** ratio, and the module already said so one field over: `requiredRepairRatePp =
breakRatePp × hurdle` is the same condition written in rate units. Dividing the count ratio by the hurdle as
well applies the corpus's odds twice.

The three rows above with a positive net are the proof, not an argument: the lexicon arm repairs 78 and breaks
67 for +11 questions, and the old statistic reads `0.877`, i.e. "loses". Its own `requiredRepairRatePp` says the
arm clears the bar by 1.7 points of repair rate. Two fields in one struct disagreeing about one row is a defect
that needs no external reference.

`clearance` also cannot compare corpora, because it moves with the corpus. On τ² retail it reads 0.108 against
BIRD train's 0.566; the decision statistic reads 0.667 against 0.789, the opposite ordering.

**What the table says now, and what it costs to say it.** Every reading here is clustered — BIRD by database,
τ² by task across the four draws — because a question in one database shares its schema, its values and its
rules with every other question in that database. That is not a formality: BIRD dev is 1,534 questions over 11
databases, so its effective sample is eleven.

| reading | what it establishes |
| --- | --- |
| BIRD train, 7,000 questions over 58 databases | **the memory loses 0.71pp [0.18, 1.26]**, and this is the only interval in the family that excludes break-even |
| BIRD dev, rule grain | +0.33pp [−0.61, +1.40]: pays by point estimate, **unresolved** |
| BIRD dev, lexicon grain | +0.72pp [−0.78, +2.39]: pays by point estimate, **unresolved** |
| BIRD mini-dev, recall order | +0.57pp [−3.48, +5.02]: **unresolved** |
| τ² retail, four draws pooled | −4.64pp [−11.45, +1.60]: **unresolved** |

So the honest sentence about τ² retail is not "memory costs 4.64pp". It is: *the largest fold this lane has is
too small to tell a 4.6pp cost from a 1.6pp gain*, and the only resolved reading in the whole record — the one on
7,000 paired questions — is a loss.

**How the gate works.** `--check` recomputes the census and compares it byte for byte against
`eval/results/poc-exchange-census.json`; any drift fails `pnpm check`. That is deliberate: the numbers are a
function of the committed artefacts, so a change in them is a change in the evidence and has to be read, not
absorbed.

```console
$ pnpm eval:exchange --write   # regenerate after reading why the evidence moved
$ pnpm eval:exchange --check   # what CI runs
```

### 32.13 Two ways a pack can be wrong, and the one that is measurable

Two axes came before this one and both were null: `AM.15` read how much of the question the pack's text covers,
and `R31` read whether the pack names the identifier the query imports. Neither asks whether the pack says
something the answer **denies**, which is where the 2026 literature puts the harm — a memory that scores badly
on relevance is noise, but a memory that makes a *competing* claim is a different failure, worth 55 points of
accuracy in FactConsolidation's controlled setting.

`pnpm eval:pack-copy` asks it two ways on artefacts this repository already commits, with no model call.

```console
$ pnpm eval:pack-copy
source                              n  clus  stmts   xdb  denial   warn   hit  strict
bird-train                       7000    58    210    39    3108    902   127      98
bird-dev                         1534    11    215    31     257     28    62      31
bird-dev-lexicon                 1534    11    212    31     215     32    47      18
bird-mini                         350    11    192    24      33      0    14       6

source                         stratum           n     delta       low      high
bird-train                     contradicted    127   +1.57pp   -2.76pp   +6.38pp
bird-train                     else           6873   -0.76pp   -1.33pp   -0.17pp
bird-train                     denial-gap        —   +2.33pp   -1.95pp   +7.20pp
bird-train                     strict-gap        —   +0.72pp   -3.27pp   +5.41pp
bird-train                     none            948   -0.11pp   -2.78pp   +2.66pp
bird-train                     mixed          1811   -0.50pp   -1.57pp   +0.52pp
bird-train                     all            4241   -0.94pp   -1.50pp   -0.40pp
bird-train                     circ-gap          —   -0.84pp   -3.64pp   +1.78pp
```

**Reading one: denial.** A rule binds a negation cue to a construct inside one phrase — `without DISTINCT`,
`rather than COUNT(*)`, `left unaliased` — and the construct is then looked for in the gold query's shape.
Eleven rules, one per construct, each narrow enough that a word changing the phrase stops the match. A
window-based reader was tried first and bound `a join problem`, `the joined result` and `nothing was joined` to
`join`; it called 1,092 of 1,534 dev cases contradicted, which is a description of English rather than of the
pack.

The corpus then says something the hypothesis does not predict: **3,963 denial sentences, and only 127 cases
carry a denial the gold contradicts** — 1.8%. Of the rest, 902 are *warnings*: "counting rows without joining
and grouping by case does not measure how many officers were involved" is not advice to avoid joining, it is
advice that a shortcut fails, and the gold joins. Read as a prescription it inverts. That is why the census
carries `warn` and excludes those sentences from `hit`: without it, a third of the store's negative advice
would have been scored as contradicting the very query it supports.

**Reading two: circulation.** The store distilled 210 statements for 7,000 questions. Thirty-nine of them reach
cases in two or more databases — *"a customer name filter must match the stored `customerName` value exactly,
including any suffix such as 'Distributors Ltd.'"* arrived in 53 databases — and those thirty-nine compose
**60.6% of packs entirely**. A case's *boilerplate share* is the fraction of its statements that crossed a
database boundary, and the three strata are the shares 0, in between, and 1.

**What the two readings establish.**

| reading | what it establishes |
| --- | --- |
| contradiction, train | 127 cases at **+1.57pp [−2.76, +6.38]** against −0.76pp elsewhere: denials do not carry the harm |
| contradiction, dev-lexicon | **+6.38pp [+0.00, +21.21]** on 47 cases: the same sign, and it is the opposite of the prediction |
| circulation, train, all-boilerplate | **−0.94pp [−1.50, −0.40]**, the only stratum interval in the table that excludes zero |
| circulation, train, none | −0.11pp [−2.78, +2.66] |
| circulation gap, train / dev / mini / lexicon | −0.84 [−3.64, +1.78], −2.20 [−5.95, +3.33], −1.98 [−6.74, +2.85], **+0.99 [−2.93, +7.87]** |

Note the second row of that table: the `else` stratum — every case whose pack carries no contradiction — is
**−0.76pp [−1.33, −0.17]**, and it is the only interval in the whole census that resolves. The loss is in what
the pack says when it is not contradicting anything.

So the literature's mechanism is **not visible in this store**, and the reason is structural rather than
statistical: the pack almost never makes a claim specific enough to compete. What it does is generalise — a
lesson distilled in `hockey` arrives in `student_loan` with no schema in common — and the harm, where it shows,
sits in the generalised end. That is the Memory Tax shape (11.4–22.6% of facts lost at construction) with a
different loss: not facts dropped, but facts abstracted until nothing case-specific remains.

**What the reader cannot do, published with the numbers.** Eight hits were hand-audited: five are genuine
contradictions (`COUNT(col)` against a gold `COUNT(*)`, `rather than ORDER BY` against a gold that orders), one
bound to a longer object (`rather than joining the Answer table to itself` against a gold that joins one
table), one conflated a select-list `DISTINCT` with a `COUNT(DISTINCT)`, one fired on a conditional. A lexical
reader is about five-in-eight precise, which is enough to falsify a large effect and not enough to establish a
small one. The census states both counts rather than reporting the favourable ratio.

**The gate.** `--check` recomputes all four arms and compares the file byte for byte with
`eval/results/poc-pack-copy.json`; CI runs it, so an artefact re-committed without re-reading the census fails
the build.

```console
$ pnpm eval:pack-copy --write   # regenerate after reading why the evidence moved
$ pnpm eval:pack-copy --check   # what CI runs
```

### 32.14 Which statement is the harm in

Section 32.13 asked whether the pack contradicts the answer and found that it almost never does. This section asks
the question that has to come next, because a corpus cannot lose 0.7pp to a store and lose it nowhere: **is the
loss in particular statements, in the sentence's polarity, or in the pack as a whole?**

`pnpm eval:pack-attribution` answers all three on the same four committed arms, with no model call.

```console
$ pnpm eval:pack-attribution
ledger — statements screened, resolved, and the share of the corpus loss they can explain
source                      n  clus  stmts    keep  resolv  expect neg/pos       mass
bird-train               7000    58    210      39       4     1.9     2/2    −0.36pp

the converse reading and the circulation strata, re-estimated inside a database
source                           stratum      n  clus      delta        low       high
bird-train               unsupported-any   4894    58    −1.83pp    −3.13pp    −0.51pp
bird-train               unsupported-all   1154    56    +0.87pp    −0.61pp    +2.23pp
bird-train              unsupported-none   2106    58    +2.04pp    +0.26pp    +3.72pp
bird-train                     circ-none    948    37    +1.38pp    −1.47pp    +4.32pp
bird-train                    circ-mixed   1811    44    −0.09pp    −1.96pp    +1.59pp
bird-train                      circ-all   2617    43    −1.34pp    −3.58pp    +0.71pp

dose — paired gain per additional delivered statement, with database fixed effects
source                        predictor   per stmt        low       high  sig
bird-train                   statements    −2.96pp    −5.85pp    +0.31pp
bird-train                  unsupported    −0.76pp    −1.55pp    +0.08pp
bird-train              gold-constructs    −0.31pp    −1.00pp    +0.41pp
```

**Why the contrast is inside a database.** A statement's harm cannot be read from "the cases that received it"
against "the cases that did not", because the store delivers a statement exactly where it looks relevant: the two
groups differ by construction, and almost all of that difference is the schema. So every number in this section
compares, *within one database*, the cases whose pack carried a statement against the cases whose pack did not,
and only databases that can form both sides contribute. A statement is screened only when at least five databases
can compare it; on `bird-train` that is **39 of 210**, and the other 171 are local notes, delivered inside one
database and compared there alone.

**Why the polarity is the reverse of 32.13.** 32.13 counted *denials* — "without `DISTINCT`", "rather than
`COUNT(*)`" — and found 1.8% of cases carrying one. But this store does not mostly deny. It **prescribes**:
*"aggregate expressions in the `SELECT` list are left unaliased unless the question asks for a name"*. Read as a
mention rather than as a denial, the question becomes: does the pack name machinery the answer does not use? And
that is the axis that moves.

| reading | what it counts | `bird-train` | `bird-dev` | `dev-lexicon` | `mini-dev` |
| --- | --- | --- | --- | --- | --- |
| unsupported, any | pack names a construct its gold does not use | 4,894 cases, **−1.83pp [−3.13, −0.51]** | 809, −2.80pp [−6.96, +1.57] | 705, −3.57pp [−7.82, +0.31] | 111, −0.21pp [−5.10, +4.07] |
| unsupported, none | pack names only what the gold uses | 2,106 cases, **+2.04pp [+0.26, +3.72]** | 725, +0.58pp | 829, +1.75pp | 239, −0.35pp |
| unsupported, all | every statement in the pack is unsupported | 1,154 cases, +0.87pp [−0.61, +2.23] | 319, +0.24pp | 266, −2.38pp | 36, +0.70pp |

The sign is the same in all four arms and the interval resolves in the one arm large enough to resolve it. That is
the first content axis in this record to do either — coverage (32.10), imported identifiers (32.11) and denial
(32.13) were null in every arm.

**The dose agrees with the stratum.** Fitting paired gain on how many statements a pack carried, how many of them
were unsupported, and how many constructs the gold itself uses — all inside database fixed effects — gives
**−2.96pp per additional statement [−5.85, +0.31]** and **−0.76pp extra for each unsupported one [−1.55, +0.08]**.
At 0.85 unsupported statements per case that is −0.65pp, and the categorical version says −1.83pp; the two
estimators do not have to agree exactly, because one asks "did any arrive" and the other "how many arrived", but
they have to agree in sign and order of magnitude, and they do.

`gold-constructs` is in the fit as a control, not as a finding: a pack is more likely to name an unused construct
when the gold is simple, and a reading that ignored that would be reporting "the pack hurts easy questions" as
"the pack hurts". The unsupported coefficient survives the control. On `bird-dev` the control is the one
coefficient that resolves (**+1.22pp per gold construct**): memory helps more where the answer is more complex,
which is what a memory system is for.

**No single statement is to blame.** The screen ranks all 39 statements with their own intervals:

| statement | cases | dbs | delta | 95% |
| --- | --- | --- | --- | --- |
| `Aliasing an aggregate expression with a column alias …` | 168 | 45 | **−4.88pp** | [−8.80, −1.50] |
| `Aggregate expressions in the SELECT list are left unaliased …` | 641 | 55 | **−2.69pp** | [−4.85, −0.78] |
| `Columns referenced in a query must exist in the tables …` | 52 | 25 | −3.19pp | [−11.19, +5.30] |
| `Counting rows for an entity identified by name uses COUNT on the key` | 27 | 15 | **+4.86pp** | [+0.59, +13.92] |
| `A comparison question asking which of two named entities …` | 20 | 9 | **+10.79pp** | [+0.33, +25.89] |

Four of 39 resolve, at 1.95 expected under a global null, and two of the four are *positive*. Both negatives are
widely delivered — 55 databases and 641 cases, and 45 databases and 168 cases, in a store where 171 of the 210
statements cannot be compared in five databases — and their combined mass is **0.36pp of the corpus's −0.71pp**: half the
loss, in two sentences out of 210. That is a bound on the mass at
risk and not a prediction: a case can carry several of them at once, and the residual is what the interaction
costs.

**R158's circulation finding does not survive the same control.** 32.13 reported the all-boilerplate stratum at
**−0.94pp [−1.50, −0.40]** and called it the only resolved interval in that census. That estimate compared cases
in different databases. Re-estimated inside a database it is **−1.34pp [−3.58, +0.71]** — the same sign, and no
longer resolved, because 15 of the 58 databases cannot form both sides and the comparison loses a third of the
corpus. The earlier interval was too narrow for the estimator it used, and this section is where the correction is
published rather than in a footnote.

**What a serve-time version would cost, and why it is not the next step.** The reading needs the case's gold,
which does not exist at serving time. The deployable analogue is a **database profile**: the constructs a
database's questions actually use, built offline and shipped with the store, with a statement dropped when every
construct it names is absent from the profile.

| arm | delivered before | after | kept | cases left empty |
| --- | --- | --- | --- | --- |
| `bird-train` | 13,578 | 10,968 | 80.8% | 65 |
| `bird-dev` | 2,688 | 2,566 | 95.5% | 1 |
| `dev-lexicon` | 2,691 | 2,608 | 96.9% | 1 |
| `mini-dev` | 625 | 609 | 97.4% | 1 |

On `bird-dev` the oracle reading would drop **37%** of delivered statements — 0.64 unsupported per case against
1.75 delivered — and the profile drops **4.5%**, because a profile is the union over hundreds of questions and one
gold is one question. So the oracle's −1.83pp is an **upper bound on a filter**, and the deployable filter is a
small fraction of it. That is the honest reason this round does not end
with a filter: filtering cannot pay for itself at this store's composition, and the next intervention has to
change what a statement is allowed to say.

```console
$ pnpm eval:pack-attribution --write   # regenerate after reading why the evidence moved
$ pnpm eval:pack-attribution --check   # what CI runs
```

### 32.15 Whether the corpus can carry a lesson at all

Sections 32.10 to 32.14 tried twelve content axes and each came back null. Twelve nulls are not twelve facts; they
are one claim about the corpus: **a lesson can only transfer to a question whose answer already shares something
with the case it came from**, and if that share is low no axis built on answers will move. `pnpm eval:reuse`
measures the share, on two committed artefacts, with no model call.

Reuse is the column overlap between a case and the nearest case **inside its own database**, found from question
text alone — the only input a deployed system has — and read from the two gold queries with the SQL tokenizer.

```console
$ pnpm eval:reuse
the top band, per corpus — the only row a replication compares
corpus     cases  db   paired top band   interval             up/down
dev        1534   11   1534   +2.69pp    [0.00, 5.66]         2/2
train      7000   58   7000   −1.04pp    [-2.20, 0.18]        0/4
verdict: contradicted — the top band is positive on one corpus and negative on another, so the
ordering is a property of the corpus

dev        0.00–0.25  309   −0.97pp
dev        0.25–0.50  446   +0.45pp
dev        0.50–0.75  444   −0.68pp
dev        0.75–1.00  335   +2.69pp
train      0.00–0.25  1351  −1.70pp
train      0.25–0.50  1849  −0.32pp
train      0.50–0.75  2170  −0.18pp
train      0.75–1.00  1630  −1.04pp
```

**How to read the verdict.** `replicates` needs the same sign and an interval clear of zero on both corpora.
`null` means the top band fails to clear zero anywhere, which can still be blamed on sample size. `contradicted`
means the sign flips, and a flip cannot be blamed on sample size: on the corpus that resolves 0.92pp, every band
is negative or indistinguishable from it. So the corpus admits reuse — median overlap 0.500 — but reuse does not
predict where the pack pays, and a thirteenth content axis would be measuring the same ceiling from another side.

```console
$ pnpm eval:reuse --write   # regenerate after reading why the evidence moved
$ pnpm eval:reuse --check   # what CI runs
```

### 32.16 Running the ALFWorld lane's pre-flight

The recurring-defect lane asks whether a stored lesson survives a second attempt, on ALFWorld — the procedure
the experience-reuse literature uses. Before any model is called, the lane has to prove it can drive the
environment, and that check is a workflow rather than a command you run locally.

**Why not locally.** `textworld` builds an Inform7 compiler at install time and fetches it from `emshort.com`.
That host delivers about 3 KB/s from a development sandbox and then aborts, so the package cannot be installed
outside CI. The data does not have this problem: it is 36.5 MB, MIT-licensed, and a mirror serves it in minutes.

```console
$ gh workflow run alfworld.yml              # or: Actions -> alfworld -> Run workflow
$ gh run watch                              # 2 minutes, no provider secrets needed
```

**What it asserts, and what it deliberately does not.** Four statements, each about the driver rather than about
a model:

1. a reset returns an observation that states a task and publishes a non-empty admissible list;
2. an admissible command changes what the agent sees;
3. a command outside that list is refused with `Nothing happens.`;
4. a twelve-step walk keeps the episode alive and still rendering.

A passing run prints the observation, the number of admissible commands, and one line per step, and ends with
`model calls made by this job = 0`. That line is the point: a green build here is a statement about the
environment, and reading it as a result about memory is the mistake the line exists to prevent.

**The plan in the file is not a plan you can replay.** Each `.tw-pddl` file carries a `walkthrough`, and it is
written in the first-release symbolic coordinates the embodied agent used (`toilet_bar__minus_00_dot_54...`).
The text environment answers `Nothing happens.` to every step. If you want a trajectory through a game, ask the
environment for `admissible_commands` and build one; the file's own plan is not executable here.

**Pinned versions, and why each is pinned.** `textworld==1.6.1` reads `ParserConfig` from `tatsu.infos`, so
`tatsu==5.8.3` goes in the same `pip install` command — pinning it afterwards leaves the build resolved against
a version that lacks the name. `alfworld` is installed from the `0.4.2` tag rather than PyPI, because PyPI stops
at `0.3.5`, which reads the z-machine release instead of the PDDL one this lane downloads.

### 32.17 Measuring the floor of the split, and reading it as a price

The pre-flight proves the environment can be driven. It does not tell you what a run of the whole split costs,
because it drives one game for twelve steps. `eval/drivers/alfworld/floor.py` drives all 134 held-out games to
termination with a walker that chooses uniformly among the commands the environment itself publishes — no model,
no prompt, no cost — and reports what it found.

```console
$ python eval/drivers/alfworld/floor.py --games 8 --shadow-games 8 --out /tmp/smoke.json   # ~90 s
$ python eval/drivers/alfworld/floor.py --out /tmp/floor.json                            # the whole split
```

The workflow runs both: eight games first, because a typo in the driver should cost ninety seconds rather than
the job's whole budget, and then the full pass with its JSON uploaded as `alfworld-floor`.

**Read three numbers, and the last one is the one a quote needs.**

| reading | what it is | what it is not |
| --- | --- | --- |
| `wins` / `rate` | how much of the split is reachable by accident | not a gate — a floor of zero is a good floor |
| `determinism.mismatches` | whether the same seed replays game for game | if this is not zero, the paired power arithmetic does not apply |
| `context_chars` | characters of transcript an episode produces | not tokens; no tokenizer runs in that job, and a token figure invented there would be a guess wearing a measurement's clothes |

**Why the transcript's length is the price.** A turn-based agent sends the conversation so far on every turn, so
the bill is a function of how long that conversation gets. `context_chars` is measured over the real games, at
the mean, the median, the ninetieth percentile and the maximum — the tail matters because a per-episode average
is precisely what a per-episode price is wrong about.

**Why a second pass, and not a repeat.** The second pass exists to be subtracted from the first, not averaged
with it. If the split replayed with any difference at all — a different game order, a different observation
length, a different action digest — the job fails, because the pairing every `mde` in this record assumes would
not exist.

### 32.18 Keeping a rule list the way the literature does, and why the port has leaks

If you want to run an always-present rule list — the mechanism ExpeL reports its numbers with — `rule-bank.ts`
gives you the arithmetic that maintains it, ported rather than re-invented.

```ts
import { mergeOperations, parseOperations, renderable } from '@agentix-e/microglia-eval';

const operations = parseOperations(reply);          // ADD / AGREE / EDIT / REMOVE, numbered or not
const report = mergeOperations(bank, operations, { cap: 20 });   // identity defaults to 'substring'
const rendered = renderable(report.bank, 20);       // what the prompt actually carries
```

`ADD` starts a rule at two votes, `AGREE` and `EDIT` add one, `REMOVE` subtracts one — or three once the list is
past `cap + 5` — and a rule that reaches zero is dropped. `report` also gives you `rejected`, `culled` and
`peak`, which is where the port's leaks become visible rather than arguable.

**Four leaks are intentional, because this is a control.** Identity is a one-directional substring test, so
`check the lamp.` inside `Always check the lamp.` is the same rule and the reverse is not. The banned-word filter
runs on substrings, so a rule containing `ADDITIONAL` disappears. The cap evicts nothing — a prompt suffix asks
the model to evict, so bank size drifts. And one reply is not deduplicated against itself: two identical `ADD`s
in the same reply both land.

**If you want the other behaviour, ask for it explicitly.**

```ts
mergeOperations(bank, operations, { identity: 'tokens' });   // case, punctuation, order, repetition ignored
```

`tokens` sees a shortening as the same rule and sees `check the lamp first.` and `First check the lamp.` as one
rule. Which of the two is better is a measurement, not a preference — run both banks through the same arm and
the difference is the answer.

**One thing the port refuses to copy.** ExpeL checks `rule_num > len(rules)` but not `rule_num < 1`, so `EDIT 0`
edits the last rule via Python's negative indexing. Here it is rejected and counted, because reproducing an
out-of-bounds access that happens to be legal in one language buys nothing.

### 32.19 Reading a sweep: one delta, four counters, and the pairing that does not need a control

A dispatch writes one `arm-*.json` per shard per arm. `eval/drivers/alfworld/aggregate.py` turns those slices back
into the single number a sweep is bought for — a **paired** difference between two arms, where the pair is the game —
and prints four counters beside it. Nothing is averaged: a game driven twice, an arm whose slices do not tile the
split, and two arms whose games do not coincide are all refused rather than repaired.

```console
$ python eval/drivers/alfworld/aggregate.py \
    --input run/arm-always-in-0.json --input run/arm-always-in-1.json \
    --input run/arm-none-0.json      --input run/arm-none-1.json \
    --compare always-in,none --expect 134 --out reading.json
```

```console
always-in 99/134 vs none 80/134
  paired delta    +0.1418 [+0.0448, +0.2388]  p=0.0044
  discordant      32 + 13 = 45 games
  mde at that     0.1403  (this is what the split could see)
  engagement      132/134 games changed course (98.5%), delta on those 0.1439
  harm share      13/132 = 0.0985  (helped 32/132 = 0.2424)
    hard   32/54 vs 0/54  delta 0.5926
    easy   67/80 vs 80/80  delta -0.1625
    clean     26/31 vs 19/31  delta +0.2258
    ...
```

**The delta is the answer and the counters are what makes it a finding.**

| counter | what it is | what it can falsify |
| --- | --- | --- |
| `engagement` | how many games the arm's action digest differs from the control's | a null result about *delivery*: a pack nobody read cannot have been a pack that did not help |
| `harm share` | of the games that changed course, how many got worse | "it helps" statements: an arm can be ahead on the mean and behind on the median game |
| `strata` | the delta split by what the control did unaided | a pooled number that is two effects and no effect |
| `kinds` | the delta split by task type | "the pack did nothing" versus "the pack helped the procedures and hurt the searches" |
| `mde` | `2.802 · sqrt(b + c) / n`, the smallest effect this discordance could see | any claim smaller than it. At the registered discordance on 134 games it is **13.3 pp**, so an interval that excludes zero is the claim, not the point estimate |

**A delta against a control inherits the control's own spread, and that spread is not small.** Four dispatches of
`none` over the same 134 games read 80, 81, 89 and 90 wins. Two dispatches of a block with nothing about the task in
it read 80 and 80. So a treatment is a more repeatable measurement than the thing it is usually measured against, and
the pairing that avoids the problem entirely is **treatment against treatment** — two blocks on the same games:

```console
$ python eval/drivers/alfworld/aggregate.py \
    --input runA/arm-always-in-*.json --input runB/arm-always-in-*.json \
    --compare full,complement --relabel "always-in@full=full" --relabel "always-in@complement=complement" \
    --expect 134
```

`--relabel old=new` renames a group so both dispatches can be joined; it prints the rename, because a cross-dispatch
reading whose provenance is silent reads exactly like a within-run one. It refuses a rename that lands on a group
already present — that is two arms' episodes under one name, a doubled denominator printing one rate.

**What a reading may be called is decided before it exists.** Each block in this lane is registered in
`eval/drivers/alfworld/REGISTRATION.md` with the readings it can produce and the dispatch each one licenses, plus the
conditions that void it: a rendered length that drifts more than 5% of the block it is compared to, an engagement
below 50%, or a control that lands above 85 of 134 games — in which case the easy stratum is a ceiling and only the
strata are quoted. A number produced without those conditions is not a smaller finding; it is an unattributed one.

**Price, so a sweep can be quoted before it runs.** A two-arm sweep over 134 games costs $0.45–0.60 (¥3.2–4.3):
two arms at roughly $0.19–0.24 each, and the arm that confuses the model is the more expensive one, because it
produces more turns. A per-episode price is not a model of a run; `prefix_chars_mean` and `context_chars` are the two
measurements that predict the bill, and the second one is in `floor.json` before anything is spent.

### 32.20 Reading a gated arm, and the counter that has to be read before the delta

A **gated** arm carries only some of its bank: the pack is filtered at read time, so the treatment is the pair
*(bank, filter)* rather than the bank alone. This lane has two filters and they are not interchangeable.

| flag | what it selects on | when it can fire |
| --- | --- | --- |
| `--gate-share S` | the share of the **observation's** own content words a rule must account for | only on corpora whose observations name the failing step |
| `--gate-kind` | the **task the game names**, read from the gamefile before the first call | whenever the bank tags its entries with `kinds` |

**The first one does nothing on ALFWorld, and the reading it produced is the worked example of why the second
exists.** A first observation carries 22 content words and every one is furniture — `cabinet 4, countertop 1,
garbagecan 1, sinkbasin 2, toilet 1 …` plus `Your task is to: put some spraybottle on toilet.` The four registered
rules are about operations (`inventory`, `put`, `move`, `receptacle`, `take`), so the largest overlap available is one
word, and one of the three matches is `task` from the prompt's own line. A floor of 0.2 needs **4.4 words**. The arm
that carried it scored 81/134 against a control of 90 while carrying **zero entries in 134 of 134 games** — and it
still reported 88% engagement, six by-kind rows and a bill, because an empty prompt also changes the trajectory.

**So read the counter first.** `aggregate.py` prints the pack distribution above every delta, and refuses two shapes:

```
  carried         always-in@kind mean 1.0 entries over 134 games, {1: 134}
  carried         none mean 0 entries over 134 games, {0: 134}
```

| what you see | what it means |
| --- | --- |
| a pack arm with `{0: 134}` | the filter admitted nothing: the arm is the control with a longer prompt, and its delta is noise |
| a pack arm with a spread, e.g. `{1: 120, 0: 14}` | the filter fires on the games it should and stays silent elsewhere — that is a gate doing its job |
| a `none` arm with anything but `{0: n}` | the control was not a control; the join refuses it |

The refusal is a `FAIL` and an exit code, not a warning, because a number produced from an empty pack is quotable
and indistinguishable from a measurement in every other counter the report prints.

**Carrying the kind gate.** A bank tags an entry with the kinds it was written for; an untagged entry is carried
everywhere, which is what keeps every earlier artefact comparable:

```json
{ "text": "To heat something, put it in the microwave and close it before saying heat <object>.",
  "votes": 0, "kinds": ["heat"] }
```

`--gate-kind` then carries only the entries whose `kinds` include the game's kind. Three refusals protect it: a bank
with no tags at all (the gate would carry nothing), a chained dispatch that would distil an untagged bank (so there
is nothing for a gate to select), and a `kinds` list whose length does not match the rules (a cap applied to `rules`
and not to `kinds` would carry the sentence the arm believes it dropped). `alf_dispatch.py` makes the first two
refusals free, before the dispatch is bought.

**`--gate-kind` on the control is not refused.** It is inert: the control carries no bank, so there is nothing to
select, and its artefact records `gate_kind: null` with the label still `none`. It was refused once, on the reasoning
that a flag selecting nothing from nothing is a mistake — and the workflow hands its inputs to **every** arm in the
matrix, so the refusal killed the control arm of a gated sweep, four shards of it, and left the treatment with
nothing in its own dispatch to pair against (AUDIT 34.246). A flag that is only meaningful for a treatment cannot be
an error on the arm the matrix sends it to. The counter-proof is the `none` row's `carried` line above: a control
that ran is a control whose pack is `{0: 134}`, whatever flags it was started with.

**What the kind gate is worth, now that it has been read.** −23.1 pp against the same six sentences ungated and
−16.4 pp against no pack at all. The gate ties on exactly one kind — `put`, whose tagged sentence is the winning arm
verbatim — and loses one to nine games on the other five. If you are choosing a selection signal, this is the
negative result that matters: **a filter on the task's own name is not a filter on the failing step**, and a gate
that fires is not a gate that helps.

**The label.** A gated pack arm is `always-in@kind`, not `always-in`, and the label is what `aggregate.py` groups on:
two dispatches of the same family under one name are refused as doubled games, after the money is spent.

### 32.21 Driving a second corpus section, and why a mixture has to be declared

The lane's published numbers all come from `eval_out_of_distribution` (134 games). A second section exists —
`eval_in_distribution` (`valid_seen`, 140 games) and `train` (3,553) — and it is the only place this lane can
buy *resolution*: at 134 paired games the minimum detectable effect is 12–13 pp, while every remaining
hypothesis is 3–6 pp. Driving another section is three flags, and two of them are refusals rather than defaults:

```bash
# 140 games of the seen section, both arms, one dispatch
python scripts/alf_dispatch.py --sweep true \
  --arms '["none","always-in"]' \
  --rules eval/drivers/alfworld/banks/bank-putmove-1.json \
  --split eval_in_distribution

# then the join, which spans both sections and says so
python eval/drivers/alfworld/aggregate.py \
  --input run-held/arm-*.json --input run-seen/arm-*.json \
  --expect 274 \
  --expect-splits eval_out_of_distribution,eval_in_distribution \
  --compare "always-in,none"
```

1. **`--split` without a size is refused.** `split_games` is an input, and the dispatcher fills it from the
   section's own published size. A sweep whose twelve jobs drive one section while its join checks another has no
   symptom until the denominator is wrong.
2. **`--games` beyond the section is refused, not shortened.** It used to be `min(games, num_games)`, so
   `--games 140` on the 134-game split drove 134 games and wrote `134/134` — a full-looking rate for a budget the
   caller never received.
3. **A mixture of sections is refused until `--expect-splits` names it.** A pooled rate over two populations is an
   average over two populations; once declared, the reading prints each section's paired delta beside the pooled
   one, which is the difference between an average and a claim about memory.
4. **A bank may not be scored on the section that distilled it.** `distill.py` writes `source.train_split`; the
   dispatcher refuses a `--split` equal to it. A *hand-written* bank — one sentence, one verbatim trajectory — is
   not a function of any section and is allowed anywhere, which is what lets R177 run.
5. **The table of sizes is checked against the corpus.** `scripts/check_split_sizes.py` counts
   `game.tw-pddl` files and fails on any section that disagrees; it runs on the built corpora in `ci.yml` and
   against the fetched corpus in the `floor` job. Run it yourself after a corpus update:

```bash
python scripts/check_split_sizes.py                       # $ALFWORLD_DATA/data/json_2.1.1
python scripts/check_split_sizes.py --data /path/to/split # a corpus you fetched elsewhere
```

### 32.22 Pairing two treatments, which is the cheapest resolution this lane has

The lane's first twelve rounds paired a treatment with the `none` arm bought in the same dispatch. That is the
right control for "does the pack help", and it is the wrong control for "which of two packs is better": the control
arm has read 80, 81, 88, 89, 90 and 91 wins on the same 134 games across six dispatches, while treatments repeat.
A delta against a control that moves eleven wins is a band, not a comparison (AUDIT 34.232).

Two treatments are different. Both drove every game with the same model and the same harness, so the difference
between them is the difference between two packs and not between two afternoons — and the payoff is resolution:
R178's pair halved the discordant game count (90 → 42) and took the mde from **9.70 pp to 6.63 pp** on the same 274
games, for one arm's price (≈ ¥2.4). A training-section subset was registered at ¥10–50 to reach the same 6 pp.

```bash
# one arm, no control, both sections — legal only when --against says which arm it is half of
python scripts/alf_dispatch.py --sweep true --arms '["always-in"]' \
  --rules eval/drivers/alfworld/banks/bank-putmove-source-1.json \
  --split eval_out_of_distribution --against always-in@source
python scripts/alf_dispatch.py --sweep true --arms '["always-in"]' \
  --rules eval/drivers/alfworld/banks/bank-putmove-source-1.json \
  --split eval_in_distribution --against always-in@source

# then join them: one --relabel per slice, keyed on the full path
args=()
for f in held-source/arm-always-in-*.json seen-source/arm-always-in-*.json \
         held-note/arm-always-in-*.json   seen-note/arm-always-in-*.json; do
  case "$f" in
    *-source/*) args+=(--input "$f" --relabel "$f=always-in@source") ;;
    *-note/*)   args+=(--input "$f" --relabel "$f=always-in@note") ;;
  esac
done
python eval/drivers/alfworld/aggregate.py "${args[@]}" \
  --compare "always-in@source,always-in@note" \
  --expect 274 --expect-splits eval_out_of_distribution,eval_in_distribution
```

1. **`--relabel` takes a path, and the path has to be the full one.** `arm-always-in-0.json` exists in every run
   directory the workspace holds; a basename is refused as ambiguous rather than applied to whichever file was read
   first. Every slice of one dispatch has to be renamed, or `tile` sees two groups under one label.
2. **`--against` is a guard, not an input.** It makes a sweep with a treatment and no control legal, and it is not
   part of the payload — the workflow never dispatches two arms because a flag said so.
3. **The two arms must be read against each other and nothing else.** Neither has a control in its own dispatch, so
   a comparison with a control from a third dispatch is a band. `--compare` is where that is enforced by naming.
4. **Check `carried` and `pack chars` per game before quoting the delta.** Both are printed above it. R178's void
   conditions were `carried` 1.0 in all 274 games and exactly 551 characters in every game of both arms; the second
   number is what makes a length claim checkable at all (AUDIT 34.249).
5. **A length control adds a clause, not an entry.** `bank-putmove-note-1.json` is 62 characters of true, neutral
   text and contains no digit; a padded block is not a length control because it pays the per-entry price, and R178
   measured the difference: +62 characters inside one entry cost **−0.36 pp [−4.74, +4.01]**, which is nothing.


### 32.23 Reading `dropped`, the counter that says a turn never reached the world

Every pass now prints a `dropped` line beside `refusals`, and the number is the only visible trace of a defect that
cost this lane seven rounds: a reply that opens with `> think:` is a thought under the competitor's first-line rule,
so a command written under it is **refused** — it never reaches the environment, it is not an invalid action, and
before this field existed nothing in the arm file said it had happened.

```
python eval/drivers/alfworld/aggregate.py \
  --input run-…/arm-none-0.json --relabel "run-…/arm-none-0.json=none" \
  --input run-….2/arm-always-in-0.json --relabel "run-….2/arm-always-in-0.json=always-in@note" \
  --compare always-in@note,none --expect 274 \
  --expect-splits eval_out_of_distribution,eval_in_distribution
```

```
  refusals        always-in@note 0.1305 vs none 0.1356 (per call)
  dropped         always-in@note 812 (0.0611 per call) vs none not counted
```

1. **`not counted` is not zero.** An arm file written before the field existed reports `not counted`, because a `0`
   there would say "the model never wrote a command under a thought" when what is true is "the driver never looked".
   Comparing the two columns is how a repair is shown to be a repair.
2. **A high `dropped` count is not by itself bad news.** It measures how often the model hedges before acting —
   `put` is the only kind where it does, which is why the count is concentrated there (14.9 per game against 0.17 in
   the other five kinds). What was bad was the answer the driver gave: `OK.`, which the model read as "your put
   worked".
3. **The answer is now `Nothing happens.`** — the corpus's own string for a command that changed nothing, and the
   string the model has already seen thousands of times. A pure thought is still answered `OK.`, because that is
   what the examples do.
4. **Do not read `dropped` as a property of the arm.** It is a property of the model's format on that corpus. It
   belongs beside `refusals` for the same reason `pack chars` belongs beside `prefix chars`: it decides whether a
   delta means anything, not whether the arm was good.

### 32.24 Reading `channel` and `recovered`, and why a pass can be on two of them

`--parser` picks the reader a pass drives. `reference` is the competitor's first-line rule and the default; `any-line`
executes the command that rule refuses. Because a reader applies to every arm at once, the pass records it and the
report prints it above the delta — and only when it is not the default, because a line that printed `reference` on
every reading this lane has ever published would teach a reader to skip the one line that matters.

```
python eval/drivers/alfworld/aggregate.py \
  --input run-…/arm-always-in-0.json --relabel "run-…/arm-always-in-0.json=always-in@anyline" \
  --input run-….2/arm-none-0.json --relabel "run-….2/arm-none-0.json=none@anyline" \
  --compare always-in@anyline,none@anyline --expect 274 \
  --expect-splits eval_out_of_distribution,eval_in_distribution \
  --expect-parsers any-line
```

```
  carried         always-in@anyline mean 1.0 entries over 274 games, {1: 274}
  pack chars      always-in@anyline 551 ch x274
  channel         always-in@anyline any-line vs none@anyline any-line
  paired delta    +0.2
  dropped         always-in@anyline 0 (0.0 per call) vs none@anyline 0 (0.0 per call)
  recovered       always-in@anyline 3180 (0.51 per call) vs none@anyline 3020 (0.48 per call)
```

1. **`--expect-parsers` is required to compare two channels.** Without it the join refuses, the same way a pooled rate
   over two corpus sections is refused without `--expect-splits`: legal, sometimes the point, never silent.
2. **One label cannot span two channels at all.** `always-in` driven once on each reader is two harnesses under one
   name; re-drive it or label it, because there is no reading of the average.
3. **`dropped` near zero with `recovered` high is the channel working, not the format cured.** The two counters are the
   same reply on opposite sides of the parser. `recovered` is what the model still writes; a channel that recovered far
   fewer replies than the reference channel dropped met a different model, and the comparison between channels is then
   descriptive.
4. **A channel-level number is not comparable to a published row.** No published ALFWorld row was measured on this
   reader. The honest comparison is this lane's own arms across the two channels, which is why the round that buys a
   channel buys the control again.
5. **The reference channel stays the default forever.** An arm file written before `parser` existed reads as
   `reference`, because that is the only reader that existed — not as unknown.

### 32.25 Shrinking the step cap, and why it is the one knob you must not compare arms across

`--max-steps` is the environment's turn budget and it is also a sentence the model reads: the human turn is
`"{instruction}You may take maximum of {max_steps} steps.\nHere are two examples:"`. Moving it is therefore two
treatments at once — fewer turns, and a different number in the prompt — and it has a property no other lever in this
lane has: **it is not neutral between arms, because different arms win at different speeds.**

You can see the whole problem before spending anything, from an artefact you already have. Every episode records the
step at which it won:

```
python - <<'PY'
import json, glob, sys
for path in sorted(glob.glob("run-…/arm-*.json")):
    episodes = json.load(open(path))["episodes"]
    won = sum(e["won"] for e in episodes)
    at_30 = sum(1 for e in episodes if e["won"] and e["steps"] <= 30)
    print(f"{path:44s} 50 steps {won:3d}/{len(episodes)}   30 steps (same behaviour) {at_30:3d}")
PY
```

```
run-…/arm-always-in-0.json   50 steps  31/34   30 steps (same behaviour)  31
run-…/arm-always-in-1.json   50 steps  33/34   30 steps (same behaviour)  31
run-…/arm-always-in-3.json   50 steps  32/32   30 steps (same behaviour)  31
run-…/arm-none-0.json        50 steps  26/34   30 steps (same behaviour)  19
run-…/arm-none-2.json        50 steps  22/34   30 steps (same behaviour)  19
run-…/arm-none-3.json        50 steps  23/32   30 steps (same behaviour)  19
```

Those six lines are the R183 held-out artefacts and they contain the round's whole arithmetic: the treatment loses five
games of 134 to a twenty-turn cut (129 → 124), the control loses nineteen of 134 (97 → 78). Same cap, two prices.

The recomputation is a **floor**, not an estimate: a shorter cap cannot win a game the longer one did not, so the number
is what the arm reads if the model does exactly what it did. Anything above it came from the model behaving differently,
which is the only interesting part of the experiment.

1. **`won` and `steps` are all you need.** `steps <= cap` is the counterfactual; no re-run, no null distribution, no band
   around it. It is exact because it is a subset of the same records.
2. **Do not read a cross-arm delta at the new cap as a memory effect.** In the lane's own numbers the cap costs the
   control 40 games and the treatment 15, so the delta reads **+31.02 pp instead of +21.90 pp with the model frozen**.
   The inflation is arithmetic, not memory.
3. **Read each arm against itself.** "257 → X at thirty steps" is a statement about the arm; "A − B at thirty steps" is
   a statement about the arm *and* about how the cap treats two different speed profiles.
4. **The prompt sentence and the budget cannot be separated in one pass.** A fourth cell that shortens the cap but tells
   the model fifty is the cell that separates them, and it is worth buying only after the cheaper pass shows an effect.
5. **The join refuses a cap span until you name it.** `aggregate.py` reads `max_steps` from every slice, treats a
   missing field as 50 (the only cap any earlier reading ran at), refuses one label at two caps outright, and refuses a
   join across caps until `--expect-caps 50,30` says that is what is being compared — then prints `budget
   always-in 30 vs none 50` above the delta. It is the same rule as the parser channel's, for the sharper reason above:
   an undeclared cap span is not an average of two populations, it is a difference that is partly arithmetic.
6. **The dispatcher refuses two caps before the money leaves.** A non-integer (`30.0`) and anything below the shortest
   win the corpus has recorded (three steps, over 6,096 episodes): the first would fail in eight jobs after the
   environment install, the second would succeed and return zeroes that look like a mechanism that does not work.

### 32.26 Swapping a bank without moving the price, and the field that makes the swap auditable

This lane's packs are length-matched on purpose: every arm since R180 pays **551 rendered characters**, because the price
of a pack is its characters and a longer sentence is a different treatment before it is a better one. R185 uses that
property to run a clean one-variable experiment — 157 characters kept byte for byte, 197 swapped — which creates a trap
worth understanding before you copy the pattern: **after the swap, the two artefacts are indistinguishable in every field
the join reads.**

```
$ python3 eval/drivers/alfworld/aggregate.py --input … --compare always-in,none
  bank            always-in 5fb4c464 vs none no pack
  channel         always-in any-line vs none any-line
  budget          always-in 50 vs none 50
```

The `bank` line is the digest of the pack each arm rendered. Three ways to read it:

1. **It is content, not a path.** Copying a bank file, reformatting its JSON, or loading the same sentence from two names
   gives one digest. Editing one character gives another — including a character that leaves the rendered length at 551.
2. **`no pack` is not a missing value.** An arm that renders nothing (`none`) records the empty string, and a join of a
   treatment against the control is never refused for spanning two "banks": the control has none.
3. **A label may not span two banks.** If you join two dispatches of `always-in` that rendered different banks, the join
   refuses — because averaging them prints one rate over two prompts. Relabel one of them:

```bash
python3 eval/drivers/alfworld/aggregate.py \
  --input run-A/arm-always-in-0.json --input run-A/arm-always-in-1.json \
  --input run-B/arm-always-in-0.json --input run-B/arm-always-in-1.json \
  --relabel 'run-A/arm-always-in-0.json=always-in#a' --relabel 'run-A/arm-always-in-1.json=always-in#a' \
  --relabel 'run-B/arm-always-in-0.json=always-in#b' --relabel 'run-B/arm-always-in-1.json=always-in#b' \
  --compare 'always-in#a,always-in#b'
```

4. **An artefact written before the field existed reports the empty value**, and mixing it with a post-R185 slice under
   one label is refused. That is deliberate: the older file cannot prove which pack it rendered, and "cannot prove" is
   not "did not".

To check a bank's identity before spending anything, the digest is a pure function of its entries:

```python
import json, sys
sys.path.insert(0, "eval/drivers/alfworld")
import agent
payload = json.load(open("eval/drivers/alfworld/banks/bank-putprecond-1.json"))
rules = [entry["text"] for entry in payload["entries"]]
print(len(agent.render_pack(rules)), agent.digest_of(rules))   # 551 5fb4c46456d4a497
```

A 551 and a digest: the price and the identity, which are the two things a bank swap has to hold fixed. Run the same
two lines over `banks/bank-putmove-line-1.json`, the bank R185 replaces, and the pair reads `551
90c0688f60c5d524`: same price, different pack — which is exactly the state the join could not see before `bank_digest`.

### 32.27 Scoping a pack to the task kind it is about, and why the pool can lie

A bank entry is inserted into **every** prompt, so an entry written for one kind of task is a treatment on all of them.
R185 is the measurement: one 197-character entry about `put` moved that kind **+10.2 pp** and `clean` **−22.4 pp**, for a
net of **−12 games**. The repair is to tag each entry with the kinds it is about and let the harness select:

```bash
python3 eval/drivers/alfworld/agent.py \
  --arm always-in --gate-kind --rules eval/drivers/alfworld/banks/bank-putscope-2.json \
  --parser any-line --policy model --games 134 --out /tmp/scoped.json
```

The bank shape is two entries with disjoint tags:

```json
{ "entries": [
  { "text": "…R183's sentence…", "votes": 10, "kinds": ["clean", "cool", "examine", "heat", "puttwo"] },
  { "text": "…the precondition…", "votes": 10, "kinds": ["put"] } ] }
```

Five rules make a scoped bank readable:

1. **A partition keeps the price fixed.** Tags that cover the six kinds exactly once mean every game carries one entry and
   renders the same 551 characters, so a per-kind difference is content and not length. `test_banks.py` asserts it.
2. **An untagged entry is carried everywhere.** That is what keeps every pre-R174 bank comparable, and it is how you ship a
   sentence you believe applies to the whole corpus.
3. **An overlap doubles the pack.** Two entries claiming `put` means `put` games pay for both, which is a length change
   disguised as a scope change.
4. **`pack_entries` is the check.** One entry per game in the artefact is what a partition looks like from the outside.
5. **`pack_digest` may differ between games of one pass; `bank_digest` may not.** The first says what each game read, the
   second says which bank the pass was handed, and the join refuses a label that spans two banks.

To see the scope of an existing bank before spending anything:

```python
import json, sys
sys.path.insert(0, "eval/drivers/alfworld")
import agent
payload = json.load(open("eval/drivers/alfworld/banks/bank-putscope-2.json"))
rules = [entry["text"] for entry in payload["entries"]]
kinds = [entry.get("kinds") or [] for entry in payload["entries"]]
for kind in ("clean", "cool", "examine", "heat", "put", "puttwo"):
    selected = agent.applicable(rules, kinds, kind)
    print(kind, len(selected), len(agent.render_pack(selected)), agent.digest_of(selected)[:8])
```

Six lines, one per kind, each `1 551 <digest>` — and the two distinct digests are the whole design in one screen.

### 32.28 Reading `recovered` per kind, and the shape of a counter that belongs to one stratum

Every reading since R183 has printed a `recovered` line. R186 added one number to each kind's row, and the reason is that
the pool line was misread twice:

```
    put       56/59 vs 50/59  delta +0.1017  recovered 133 vs 246 (0.1517 vs 0.2226 per call)
    clean     58/58 vs 58/58  delta +0.0000  recovered 4 vs 5 (0.0046 vs 0.0055 per call)
    cool      43/46 vs 43/46  delta +0.0000  recovered 28 vs 16 (0.0409 vs 0.0229 per call)
    puttwo    41/41 vs 40/41  delta +0.0244  recovered 0 vs 0 (0.0 vs 0.0 per call)
    heat      37/39 vs 38/39  delta -0.0256  recovered 3 vs 2 (0.0042 vs 0.0031 per call)
    examine   29/31 vs 28/31  delta +0.0323  recovered 0 vs 0 (0.0 vs 0.0 per call)
  recovered       always-in@kind+anyline 168 (0.0365 per call) vs none@anyline 626 (0.074 per call)
```

Read the six rows and the last line says something different from what it said before: **168 is 133 `put` plus 35
everywhere else**, so a pool that moved by a hundred moved inside one kind. Four rules for reading it:

1. **A counter that is one kind in six is that kind's counter.** If a stratum holds 90% of the events, the pool number is
   a fact about that stratum and a rumour about the others.
2. **Divide by the stratum's own calls.** The per-call figures above are `put`'s 133 over `put`'s calls and `clean`'s 4
   over `clean`'s; a shared denominator reports a rate neither kind has, because the kinds differ by 8× in calls.
3. **`0 vs 0` is a measurement; nothing printed is not.** `puttwo` and `examine` print `0 vs 0` because both files
   carried the field and the event did not happen. An arm file from before AUDIT 34.262 prints no column at all, which
   is the same distinction `dropped` already makes with `not counted`.
4. **A counter about the reader cannot be evidence about the pack.** `recovered` counts replies shaped *thought, then
   command*: the reference channel **drops** those (−9.85 pp, R183), the `any-line` channel executes them (+0.0 pp,
   R185 and R186), and a control with no pack produces the most of all (626) because a flailing agent takes 23.8 turns a
   game. It measures the reader, and only incidentally the memory.

The general form, which is the most reusable thing this lane has learned: **before quoting a pooled number, ask what
share of it comes from one stratum.** The three failures in this lane's record are all that question unasked — a mean
over lost games, a counterfactual over a sampled policy, and a band over a pool.

### 32.29 Reading `rumination`, and why a lost game is not one thing

Every reading prints one more line than it used to:

```
  rumination      always-in@kind+anyline 4.2 per game, 5 heavy vs none@anyline 9.23 per game, 19 heavy
```

It answers a question a win count cannot: **did the arm lose the game by walking, or by thinking?** The pass cap counts
model turns, so a reply with no command spends a turn and changes nothing in the world. Three rules for reading it:

1. **`heavy` is the class, the mean is the drift.** A game is heavy at `THOUGHT_HEAVY` (20) thoughts or more, which is
   the smallest count a lost game showed in the round that introduced the line. Five games at 24 to 46 and five at 0 or
   1 are two families; their mean is a number neither family has.
2. **Heavy and lost are not the same claim.** In R186 no *won* game was heavy, so a heavy game is a strong predictor of
   a loss — but the line reports the counter, and the win count is two lines above it on purpose.
3. **`not counted` is not zero.** An arm file written before the field existed prints `not counted`; a file that recorded
   the field and saw no thoughts prints `0 per game, 0 heavy`. The distinction is the same one `dropped` and
   `recovered` make, and it is worth more than the number: one of them is evidence.

What the counter has shown so far is the opposite of the intuitive story. A pack does not make the model chatty — it
**halves** the chatter (9.23 → 4.2 thoughts a game) because an instruction that names the next action leaves less to
deliberate about. What is left over is the part of the corpus the instruction did not cover.

### 32.30 Before planning against a class, redraw it

R186 lost ten games and half of them looked like a coverage gap: 24 to 46 thoughts, almost no environment steps. R188
wrote a sentence for exactly that and it did nothing — and the five games it was written for **won four and five of five
on a redraw**, at 1 to 10 thoughts. Four rules come out of that, and the first one is the whole of it:

1. **A class defined by one draw is a hypothesis.** Games do not carry their failure mode; a draw does. Before writing
   anything for "the ten losses", re-run them — R188 re-ran ten and three stayed lost.
2. **Use counts for rare events, means for dense ones.** On 148 games with byte-identical packs, thoughts a game read
   3.68 and then 4.80: a band of **1.12** on one prompt. A mean over a heavy-tailed event is not a sensitive instrument;
   a count of games above a threshold is, which is why `rumination` prints both.
3. **A length-matched placebo is mandatory for any entry.** R188's permuted sentence scored **266/274** against the
   instruction's 264. Without the placebo, the instruction would have been reported as a +0.0 pp entry with a −0.66
   thought effect, and the second number is noise.
4. **Rates are plannable, games are not.** The stable statement is 11 thought-heavy losses per 822 game-draws = 1.34%.
   Anything phrased as "the eight losses are search" is a sentence about one afternoon.

What the round leaves is a distinction the lane did not have before: a memory can be **inert** (R188: two arms, one
placebo, no difference), **harmful through reach** (R185, R187) or **helpful through reach** (R186), and the three are
separable only if the round carries its own length control.

### 32.31 Answering a commandless turn: `--guard-commandless` and the ledger that proves it fired

The driver answers a reply that carried no command with `OK.`. That is truthful and it is also a reward signal: a model
that has started narrating is told, once per turn, that narrating is fine. R189 changes **that one string**:

| the reply | without the flag | with it |
| --- | --- | --- |
| carries no command | `OK.` | `OK. Reply with one command only.` |
| carries a command under a thought, on the `any-line` channel | the command is executed | **unchanged** |
| carries a command on its first line | executed | **unchanged** |

```bash
python eval/drivers/alfworld/agent.py --arm always-in --policy model --games 274 \
  --rules eval/drivers/alfworld/banks/bank-putscope-2.json --gate-kind --parser any-line \
  --guard-commandless --out arm-guard.json
```

Three things to know before you run it.

**It is a harness knob, not an arm.** `--guard-commandless` goes into the label (`always-in@kind+anyline+guard`), into
the header (`guard_commandless`), and into every episode (`guard`, `guard_fires`, `guard_checked`, `guard_relapsed`).
That is deliberate: two dispatches of one arm that differ only by this flag are two treatments, and a join that could not
see the difference would average them. `aggregate.py --expect-guard on,off` is how you tell it that you know you are
comparing two.

**The ledger is engagement, not a score.** A guard arm with zero fires is an unguarded arm wearing a treatment's name.
Check `guard_fires` first, then `guard_relapsed / guard_checked` — the share of fires the model answered with another
commandless reply. Over 274 games the R189 arms read 826 fires, 825 checked, **0 relapsed**: the model does what the
line asks, every time it is asked. `aggregate.py` prints the three numbers beside `rumination`, and prints `not counted`
for a file written before the field existed — a zero there is not a measurement.

**A fire happens on every thought, not only in loops.** 826 fires is 3.01 a game, because that is how often the model
narrates; it is 20% of turns, not 90%. So do not register a count of fires as if it were a rate over the rare event the
guard is aimed at (AUDIT 34.275), and do read the effect where it shows: thoughts a game **4.96 → 3.01**, heavy games
**10 → 2**, and eight of the ten losses recovered at one to four thoughts.

Cost is not a concern: the arm's **total prompt is 1.03% smaller** than the unguarded arm's (533 fewer thought turns
outweigh 826 short lines), it makes 204 fewer calls, and it bills **$0.1946 against $0.2152**.

### 32.32 What the guard does not fix, and how to read a loss once the loop is gone

R189's guarded arm lost nine games of 274 and four of them were games its own control won. All four ended at the
environment's **50-step cap** with *fewer* thoughts than the control: they are search failures, and the guard made them
slightly worse by spending the turns it saved on a world that did not contain the object.

So when you read a loss after this round, ask three questions in order:

1. **Did it end at the cap with thoughts to spare?** Then it is search: the arm acted and did not find. Neither the pack
   nor the guard reaches this.
2. **Did it spend the turn budget on thoughts?** Then it is the loop, and `guard_fires` says whether the guard was armed
   and `guard_relapsed` says whether the model listened.
3. **Did it end at the cap with almost no thoughts?** Then it is neither — it is a game whose admissible set did not
   contain the answer the model was looking for, and the honest label is a corpus limit rather than a memory failure.

### 32.33 Scoring a bank before you buy it: `scripts/score_bank.py`

A pass costs money and a score does not, so the cheapest experiment in this repository is the one that reads a bank and
tells you what the literature's admission score thinks of it.

```bash
python3 scripts/score_bank.py eval/drivers/alfworld/banks/*.json
python3 scripts/score_bank.py --verbose eval/drivers/alfworld/banks/bank-putscope-2.json
python3 scripts/score_bank.py --effects eval/drivers/alfworld/measured-effects.json <banks...>
```

**What it prints, and the unit it prints it for.** One row per bank: the mean of the specificity, abstractness and utility
of the **packs** its six task types would render, the rendered lengths, and which task types read anything at all. A pack
is the unit because a pack is the treatment — the bank's entries selected by their `kinds`, rendered by the driver's own
function, so `--verbose` shows one line per entry beneath the row.

**How to read the two factors.**

- **specificity** — the share of the text inside quoted commands (`"put"`, `"move <object> to <receptacle>"`) and
  `<placeholders>`. It is a rate, so padding a sentence lowers it. A general instruction scores **zero**, which is the
  honest reading of a sentence that names no command.
- **abstractness** — the share of the words that are frame words. A bare imperative states an incident and scores zero; a
  conditional states a rule and does not.
- **utility** — their product. Either factor can zero it, for its own reason.

**What the score is not.** It is not a gate, and R190 is the round that says why. Over the three banks this record has
measured against a control in one dispatch, the rank correlation is **+0.500** against a registered 0.6, with one
inversion; and the score's entire range on this corpus is **1.62x** against a minimum detectable effect of **9.7 pp**, so
the hypothesis is being tested below the resolution of the ruler. Do not admit on this number. Use it to see whether two
candidates are even distinguishable.

**Reach is the column that matters, and it is not a score.** `covers` asks whether the entry names the operation a task
type ends on. On this corpus it agrees with the measured sign three times out of six: `heat` and `clean` gained 28.2 and
22.4 pp from an entry that names neither, because what it carries is a precondition rather than a vocabulary. If you are
choosing between two banks, read the per-kind deltas in `measured-effects.json` — not the `covers` column, which exists
to show you where a lexical test breaks.

**If you add a bank to the effects table**, every row needs `quantity` and `comparison`: what kind of delta it is, and the
sentence that says which two things were compared. The scorer refuses a row without them, because R190's first
registration correlated a bank-against-control delta with a bank-against-placebo delta and a row from a run that drove no
games, which is a correlation over nothing.

### 32.34 The three things a bank can be wrong about, and which one a score can see

After R190 you can classify a bank's failure before paying for it, in this order:

1. **It names no command.** `specificity` is zero. R188's turn-budget sentence is the example: 259 characters, read as
   inert by 274 games against its own word-shuffled placebo at p = 0.66. This is the one failure a score catches.
2. **It names a command its games do not need.** `covers` is false for the task types carrying the entry, and the
   mechanism does not reach them either. R177's `examine` cell is the example: −12.9 pp on 31 games, twice.
3. **Its tags reach too far.** The entry is right and the tag set is wrong, so every game in the tag set carries a
   treatment written for one kind. R187 is the example: the same two sentences as R186, a moved boundary, and 254 wins
   against 264. **No score that reads only the text can see this one** — and it is the failure that costs the most,
   because the entry looks excellent in every textual test.

The scorer sees (1) and half of (2). It cannot see (3), and (3) is why `--gate-kind` and the per-kind table are part of
the instrument rather than of the report.

### 32.35 Turning the state line on: `--state-ledger`, and how to read what it did

`--guard-commandless` answers the turn that carried **no command**. `--state-ledger` answers the turn whose command
**moved nothing** — the world said `Nothing happens.`, or the action was not in that turn's admissible set. Both are one
flag, both are recorded per episode, and they compose:

```bash
python eval/drivers/alfworld/agent.py \
  --arm always-in --policy model --split eval_in_distribution \
  --rules eval/drivers/alfworld/banks/bank-putscope-2.json --gate-kind true \
  --parser any-line --guard-commandless --state-ledger \
  --out arm-ledger.json
```

The arm's label becomes `always-in@kind+anyline+guard+ledger`, and each episode carries `ledger: true`, `ledger_fires`
and `ledger_chars`. **Read `ledger_fires` beside `invalid_actions`**: in this corpus the two are equal in every game ever
run (413 = 413 and 479 = 479 over 822 armed games), because the admissible set at a state is the set of commands that do
something — so the line is an admissibility hint in practice, whatever the two-trigger docstring says (AUDIT 34.284). A join that puts that label beside `always-in@kind+anyline+guard` needs one declaration:

```bash
python eval/drivers/alfworld/aggregate.py \
  --input logs/ledger-134/*.json --input logs/guard-134/*.json \
  --compare "always-in@kind+anyline+guard+ledger,always-in@kind+anyline+guard" \
  --expect-parsers any-line --expect-caps 50 --expect-guard on --expect-ledger on,off
```

and it prints the line the round is read from:

```
ledger          always-in@kind+anyline+guard+ledger 413 fires, 42845 chars added vs always-in@kind+anyline+guard 0 fires, 0 chars added
```

**Read the fires first, then the delta.** The delta over 274 games has a resolution of about 3 pp, so it can say "not
worse" and not much else; `ledger_fires` is what says whether the treatment ever reached the model. The first purchase read
413 fires and won four of the four games it was registered for. Two cautions, both measured rather than supposed:

- **A game with zero fires is not a control for its own arm.** Twenty-seven games in that round carried no line, and
  fourteen of them still took a different path, because the model re-samples a prompt it has already answered. A pool
  difference of two games over 274 is one draw against another draw.
- **A line that repeats is a constant.** The same round's worst games received 16 and 40 lines and lost at the cap: by the
  third repetition the model is being told the same thing every turn, which is the shape R188 measured as inert. If you
  see a high fire count on a losing game, the treatment has become narration.

### 32.36 `--state-ledger-counts` is a measured negative, and how to read a draw

`--state-ledger-counts` is the counted renderer: `Already tried this episode: take apple 1 (4 times).` instead of the
same command four times, and **no line at all** when the three commands a line would name are the ones the previous line
named. It implies `--state-ledger`, adds `-counts` to the label (`always-in@kind+anyline+guard+ledger-counts`), and puts
three fields in every episode — `ledger_counts`, and `ledger_suppressed` beside the two the plain flag already writes:

```bash
python eval/drivers/alfworld/agent.py ... --state-ledger-counts --out arm-ledger-counts.json
python eval/drivers/alfworld/aggregate.py \
  --input logs/counts/*.json --input logs/ledger/*.json \
  --compare "always-in@kind+anyline+guard+ledger-counts,always-in@kind+anyline+guard+ledger" \
  --expect-parsers any-line --expect-caps 50 --expect-guard on --expect-ledger on
```

**It lost, and the two numbers that say so are `ledger_fires` and `ledger_suppressed`.** The counted arm sent **479**
lines against the plain list's 413, added 48,179 characters against 42,845, raised the worst game from **40** lines to
**42**, and sent two of the four games the plain list had won back to the 50-step cap. The gate silenced **2 of 479**
fires: the condition is "the same three commands as the last line", and a count gives the line a new number without
changing the window the gate compares, so a fixed-point loop would meet the condition on every fire and the loops this
driver meets evidently do not. Use the flag to reproduce the negative; do not use it as the plain list's replacement.

**And read the number you get as a draw.** The same arm on the same 274 games, five times: 267, 268, 265, 268, 270. The
range is **1.82 pp** with no treatment applied, the unseen section moves by one game and the seen section by four, and two
independent draws of this size can only see a 3.74 pp effect at 80% power. So:

- quote the **pooled** figure — 1,338/1,370 = **97.66% [96.72, 98.34]** — or say "one draw of five";
- never subtract one draw from another and call the difference a treatment effect; a paired join inside one dispatch is
  the only design here that can see less than 2 pp;
- treat `ledger_fires` the same way: 391 to 441 across the five draws, so a 20-fire difference between two arms is noise.

### 32.37 `--state-admissible`: the third renderer, and the instrument that prices it

AUDIT 34.284 read R191 and R193 together and found that `ledger_fires` equals `invalid_actions` in **every** one of 822
armed games: each line the state family ever sent answered a command the world had refused, and the worst games are 42,
35 and 27 consecutive refused commands. The list of what has been tried is one remove from what would help, so R194's
renderer names the other set:

```bash
python eval/drivers/alfworld/agent.py --arm always-in --policy model --split eval_out_of_distribution \
  --rules eval/drivers/alfworld/banks/bank-putscope-2.json --gate-kind true \
  --parser any-line --guard-commandless --state-admissible --out arm-admissible.json
```

On a turn that moved nothing the model reads

```
Nothing happens.
Admissible here: 7 commands, e.g. `take apple 1 from countertop 1`.
```

The label becomes `always-in@kind+anyline+guard+ledger-admissible`; the episode carries `state_admissible`, the usual
`ledger_fires`/`ledger_chars`, and three instrument fields. **Read the instrument before the score:**

- `admissible_mean` is the mean size of the world's admissible set over the turns that fired — the number that decides
  whether the count-only form is the affordable one;
- `admissible_max` is the worst single state, and the one the price has to survive;
- `admissible_sample` is the example that was rendered, so a reader can check the selection rule against the game.

The flag replaces the other two renderers rather than stacking on them (`--state-admissible` beside `--state-ledger` is
refused at the argument), and `aggregate.py` prints the instrument beside the ledger line:

```
admissible      always-in@kind+anyline+guard+ledger-admissible 134 games refused, mean set 6, max 11 vs ... not counted
```

An armed episode without the instrument, a header that claims the renderer while its episodes say otherwise, and a header
whose flag is not a flag are all refused — the same three refusals the other two renderers carry.

### 32.38 What the arm asked for: `commands` and `fire_turns` on every episode

Every episode written from this version on carries two fields that no reading in this lane had before:

```
"commands":   ["look", "take apple 1 from countertop 1", "take apple 3 from countertop 1", ...],
"fire_turns": [0, 2, 3]
```

`commands` is the ordered history the state renderers read — every command the model produced that reached the driver,
including the ones the world refused and the ones the parser dropped on the reference channel. `fire_turns` indexes it:
entry `i` means the line sent on that turn answered `commands[i]`, so `len(fire_turns) == ledger_fires` and the window a
line was rendered from is `commands[:index + 1]`.

**Why they exist.** The next question this lane has to answer is whether a line that names the *cycle* — the repeated
pair of commands, not the last three — would fire on games the current renderers leave alone. That question needs the
commands, and the artefacts had none; answering it from a fresh dispatch would have cost a round for a question that is
¥0.00 to ask offline once the record exists (AUDIT 34.285).

**How to read them.** Nothing in the score depends on them, and an arm with no renderer still records both (`fire_turns`
is empty). Two checks are worth running on any slice:

- `len(commands) == actions + refused_actions` — the record agrees with the two counters that already existed;
- `len(fire_turns) == ledger_fires` — the record agrees with the renderer it is supposed to explain.

Both are asserted in `test_agent.py`, and a slice where either fails is a slice whose history and whose counters were
written by different code.

### 32.39 `@ledger-admissible-task`: the example has to be a command

The admissible renderer's first version named the shortest command in the set, and the shortest command in an ALFWorld
room is `help` — so 220 of 248 lines read `Admissible here: 29 commands, e.g. \`help\``. The rule is now **structural**:
the example must carry a task verb (`take`, `put`, `clean`, `heat`, `cool`, `examine`); if the set has none, the line is
the count alone.

```
Nothing happens.
Admissible here: 29 commands.                       # no task command in the set: count only
Admissible here: 29 commands, e.g. `take apple 1 from countertop 1`.
```

Three counters make the difference readable without opening an episode: `admissible_task_fires`,
`admissible_meta_fires` and `admissible_exampleless_fires`, which sum to `ledger_fires`. `aggregate.py` prints them as a
share and refuses a slice where they do not add up:

```
examples        always-in@…-admissible-task <task> of <fires> lines carried a task command (<share>%; <meta> meta, <count-only> count-only)
```

The three numbers are per arm and printed before any verdict, so a run whose lines were all count-only says so in the log
rather than in a paragraph somebody has to reconstruct later.

The label token is `@ledger-admissible-task`; R194's `@ledger-admissible` is a different content rule and the two are
never pooled.
