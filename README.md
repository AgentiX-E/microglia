# microglia

**A feedback data flywheel for agentic workflows, as a library.**

`microglia` turns the corrections a user makes — a re-picked chart, an edited SQL statement, a
thumbs-down with a reason — into scoped, evidenced knowledge that the same application recalls on
the next request. It ships no UI, opens no socket, and requires no service. It runs on a CPU or in a
browser.

```ts
import { openMicroglia } from '@agentix-e/microglia-core';
import { EmbeddedMemory, JsonlJournal } from '@agentix-e/microglia-core/memory';

const store = await EmbeddedMemory.open(new JsonlJournal({ dir: './.microglia' }));
const mg = await openMicroglia({ app: 'nl2charts', namespace: 'acme', store });

// 1. Before generating: recall what this workspace has already been taught.
const pack = await mg.recall({ task: 'chart.recommend', text: question, scope: { domain } });

// 2. Generate, with `pack.rendered` in the prompt. Cite `pack.ids`.
const run = mg.begin({ task: 'chart.recommend', input: { question, domain }, pack });
await run.complete(spec);

// 3. When the user changes the answer, capture the change.
await run.edit(correctedSpec);

// 4. Fold accumulated feedback into knowledge. Run it off the request path.
await mg.distill();

// 5. Next request: the pack already carries the lesson.
```

That is the whole product. Everything else is refinement.

## Why it exists

Every team that ships a generative feature ends up with the same two piles: a log of corrections
nobody reads, and a prompt that keeps making the same mistake. The feedback exists; the loop does
not. Observability platforms stop at storing the correction as a label on a trace, and memory
systems store facts without understanding that a *correction* is evidence about a *rule*.

`microglia` is the missing middle: it treats a correction as evidence, decides whether that evidence
is strong enough to steer a prompt, and forgets it when it stops being true.

| What it does | What it refuses to do |
|---|---|
| Captures ratings, edits, preferences, outcomes, clarifications | Render UI, own your HITL surface |
| Weights evidence by source trust and counts contradictions | Call a model you did not configure |
| Distills claims into scoped, deduplicated, evidenced rules | Run a server, a database, or a queue |
| Recalls a bounded, diversified prompt block | Require GPU, CUDA, or a fine-tuning loop |
| Reports why each rule is active, demoted, or retired | Send your data anywhere |

## What this is, and what has been measured for it

Three claims travel with the phrase *data flywheel*, and they have different amounts of evidence behind
them. Keeping them apart is the difference between reading this repository correctly and reading it as
a text-to-SQL system:

| Claim | Status | Evidence |
|---|---|---|
| **The architecture is scenario-agnostic** | **holds** | `core` is 7.1k lines with no scenario type in any public signature; `task` is a free-form string; subpath exports let a host take retrieval without the distiller; two hosts already embed it |
| **The mechanism transfers across scenarios** | **hypothesis** | one scenario has 26 registered iterations; the other has 68 tasks. Details below |
| **It pays commercially in any scenario** | **untested** | no scenario has produced an effect this project would ship on |

**The scenarios in this repository, and what each is for.** `nl2charts` (chart re-picking) is the one in
the quick start and the one the mechanism was designed against: a correction is a preference, rules are
about a vocabulary, and transfer is measurable across domains. **text-to-SQL on BIRD is the hostile
case, not the product** — a per-question evidence hint the benchmark supplies competes with anything the
memory has to say, and twenty-six iterations of measurement there are reported in full under
[Does it actually work?](#does-it-actually-work). τ²-bench (tool calling) is the second harness, and its
reading is a null at a resolution that cannot see one point.

**So: this library is what a host embeds, and text-to-SQL is one host.** That matters for how
comparisons should be read. Systems on the BIRD leaderboard — XiYan-SQL, CHASE-SQL and the rest — are
not alternatives to this project; they are **hosts whose pipeline could embed it**, and the competitive
question about them is whether a pack improves their generation, not whether our execution accuracy
beats their execution accuracy. RSL-SQL and CHESS appear in this repository's documentation for a
different reason again: they each published **one ablation on the same benchmark**, which is the only
unit in which our number and theirs are the same quantity.

```ts
// The same loop, a third scenario: nothing in the API knows about charts or SQL.
const pack = await mg.recall({ task: 'ticket.classify', text: subject, scope: { team } });
```

## What is in the box

| Package | Role | Runtime dependencies |
|---|---|---|
| `@agentix-e/microglia-core` | The library: domain model, store, distillation, pack construction, facade, provider contracts | none |
| `@agentix-e/microglia-node` | HTTP ingestion and recall on Hono, an MCP tool surface (`POST /v1/mcp`), DeepSeek and Zhipu providers | core, `hono` |
| `@agentix-e/microglia-browser` | Client with an offline outbox; talks to the node server | core |
| `@agentix-e/microglia-protocol` | The measurement apparatus: 39 validity gates, their publication order, and the `LaneAdapter` contract a scenario implements to be scored by it | none |

`core` is the whole mechanism in one install and has **no runtime dependency**, so it bundles for the
browser unchanged. `protocol` is the exception to "the library is the product": it is the instrument that
decides whether a claim about the library may be published, it has no runtime dependency either, and it is
separate so that a second application scenario can be measured by the same apparatus instead of writing a
weaker one beside it. **What the second scenario found is worth stating plainly, because it corrects an
earlier version of this file**: the apparatus is scenario-agnostic — τ²-bench is scored by the same gate
function, the same publication order and the same artefact schema with no edit to a gate — and the gate
*set* is not. A gate fires when the lane ran the arm whose bookkeeping it reads, so τ² instantiates nine of
the 39 and names the experiment each of the other thirty would need. That is a catalogue, not a universal
instrument, and the audit that says so is committed beside the lane. Its modules are also reachable as
subpaths, which is how a host that only needs retrieval keeps the distiller out of its bundle:

```ts
import { buildPack } from '@agentix-e/microglia-core/apply';   // retrieval only
import { EmbeddedMemory } from '@agentix-e/microglia-core/memory';
import { registerProvider } from '@agentix-e/microglia-core/providers';
```

| Subpath | Contents |
|---|---|
| `core` | `openMicroglia`, the run handle, feedback types, knowledge lifecycle |
| `core/kernel` | contracts and pure algorithms (statistics, diff, guard, similarity) |
| `core/memory` | `EmbeddedMemory`, `JsonlJournal`, lexical index, `MemoryPort` |
| `core/distill` | rule interpreter, model interpreter, generalisation |
| `core/apply` | pack construction, MMR, budget, rendering |
| `core/capture` | the facade, run handle, feedback normalisation, export, doctor |
| `core/providers` | `LlmProvider`, `EmbeddingProvider`, the registry |
| `core/delivery` | webhook events, HMAC signing, the retrying dispatcher |

## Install

```bash
pnpm add @agentix-e/microglia-core            # a host that is one process
pnpm add @agentix-e/microglia-node           # a host that wants an HTTP boundary
pnpm add @agentix-e/microglia-browser        # a front-end that talks to it
```

Node 20 or newer. ESM only. No native modules.

## Three ways to run it

**In one process.** `core` only: the facade reads a journal from disk, your code calls it.

**Behind HTTP.** `@agentix-e/microglia-node` serves five endpoints — `POST /v1/feedback`,
`GET /v1/recall`, `POST /v1/distill`, `GET /v1/knowledge`, `GET /v1/health` — so a browser never holds
your model key or your store.

```ts
import { createServer } from '@agentix-e/microglia-node';
import { deepseekProvider } from '@agentix-e/microglia-node';

const server = await createServer({
  dir: './.microglia',
  namespace: 'acme',
  token: process.env.MICROGLIA_TOKEN,
  llm: deepseekProvider({ apiKey: process.env.DEEPSEEK_API_KEY! }),
});
```

**In the tab.** `@agentix-e/microglia-browser` queues a correction before sending it, so a tab that
closes mid-edit does not lose the only signal worth collecting:

```ts
import { createClient, persistedOutbox } from '@agentix-e/microglia-browser';

const mg = createClient({
  endpoint: 'https://api.example.com',
  token,
  outbox: persistedOutbox(localStorage),
});

const pack = await mg.recall({ task: 'chart.recommend', text: question });
await mg.feedback({ run: { task, input, output, packIds: pack.ids }, feedback: { type: 'edit', after } });
```

**Providers are configuration or code.** Both are first class: pass an instance, or register a factory
and name it in config.

```ts
registerProvider('llm', 'my-gateway', (config) => new MyGateway(config));
createServer({ dir, namespace, llm: { id: 'my-gateway', endpoint: 'https://llm.internal' } });
```

## Does it actually work?

The repository ships the instrument, not just the claim. `pnpm bench` runs nine arms over a fixed
corpus plus three micro-ablations, and refuses to pass if any of fifteen gates fails:

| Arm | What differs | Final accuracy | Reading |
|---|---|---|---|
| `baseline` | no memory | 31.79% | the counterfactual |
| `full` | capture → distill → recall → apply | **100.00%** | the loop works on systematic error |
| `no-generalization` | scope widening disabled | 83.21% | transfer needs widening (32.86% on an unseen domain) |
| `unguarded` | trust ceiling removed, same poison | 82.14% | the guard is load-bearing (−17.86pp) |
| `poison` | untrusted claims injected | 100.00% | quarantine holds |
| `narrow-budget` | pack fits one rule | 31.79% | the pack is the delivery mechanism |
| `no-credit`, `no-contradiction` | module off | 100.00% | no effect on a clean corpus — see the micro-ablations |
| **fact store** (competitor shape) | extract, dedupe, retrieve the closest sentence | **56.07%** | memory helps, but recall without governance stops at +24pp |
| fact store, same poison | untrusted claims ingested | **19.64%** | worse than no memory at all |

The micro-ablations measure the modules a clean corpus cannot exercise: credit assignment withdraws a
rule that failed every time, contradiction resolution keeps one active rule where tolerance keeps
two, and diversification more than doubles the distinct claims a pack carries.

The fact-store row is the competitor comparison: an ADD/UPDATE/DELETE memory, implemented generously
and run on the same corrections. It gains 24pp over no memory and loses everything under the poison
that quarantine stops — which is the argument for the governance layer, measured rather than asserted.

### On a public benchmark, the prefix form is worth less than nothing

Those arms run on a synthetic corpus built to have systematic, repeating defects — the case the
mechanism was designed for. The same mechanism on BIRD Mini-Dev, a public one-shot text-to-SQL
benchmark, measures the other case, and it is the one you should read first:

| Arm | Position | Δ vs no memory | n |
|---|---|---|---|
| lexical schema linking (pruned DDL) | input | −8.00pp | 350 |
| rule pack injected before the question (`full`), pooled over two dispatches | input | **−2.29pp** (p = 0.052) | 700 |
| `full-verified` — only rules that reproduce their own correction | input | +0.71pp (p = 0.42) | 700 |
| value samples in the DDL | input | +0.29pp | 350 |
| model selection over five draws | output | −2.43pp | 350 |
| **oracle over five draws** | **ceiling** | **+3.52pp** | 350 |

The mechanism behind the negative rows is now measured rather than guessed, and it is specific enough to
act on. Every committed case carries the query the model wrote **with** the pack and the one it wrote
**without** it, so what the pack did to the query can be read directly, at zero cost and with no model
call. On the 1,534-question dev split, 692 queries are byte-identical between the two arms and 155 contain a
schema name that appears in neither the baseline query nor the question — a name the rule supplied and the
question never asked for. Those 155 lose **9.68pp**; the rest of the corpus gains **1.45pp**. The harm is not
"too much text", it is not relevance, and it is not the channel a rule arrived on (all three were measured and
all three are flat). It is **an imported name**.

| Group | Questions | Δ vs no memory | Already-correct queries destroyed |
|---|---|---|---|
| memory query names something the question does not | 155 | **−9.68pp** | **35.71%** |
| memory query names only what the question does | 1,379 | +1.45pp | 4.56% |

The repair rate is the same in both groups (11.76% against 10.04%); only the damage differs, by a factor of
7.8. `pnpm eval:query-diff` reproduces the table from `eval/results/poc-sota-bird-dev-R26-channels.json` and
the workflow compares it byte for byte.

**Where the name comes from decides what you can do about it, and the answer is not the one this section
gave in its previous revision.** The pack's text is stored for every question, so the two candidates are
separable: a rule said the column, or the model read the `CREATE TABLE` statements and picked a real column
nobody had asked for.

| Where the imported name came from | Questions | Δ vs no memory | Already-correct queries destroyed |
|---|---|---|---|
| the pack's own text names it | 60 (38.7%) | −8.33pp | 36.36% |
| the pack does not, and the query executed | 94 (60.6%) | −9.57pp | 34.04% |
| the pack does not, and the query never ran | 1 (0.6%) | — | — |

The two buckets are damaged by the same amount — 1.24pp apart, against a 14.74pp interval — so **the harm is
not a rule naming a column. It is the pack changing what the model writes, and the imported name is the
symptom.** Scoping a rule's vocabulary to words the request already uses therefore does not reach it: in 61%
of the damaged questions the rule named nothing at all, and the query still went looking for a column the
question never mentioned. `pnpm eval:mediation` reproduces the table, and the workflow asserts the number
that withdrew the previous claim.

What survives is the check on the query rather than on the rule — and it has now been tested on a corpus
this project never touched. BIRD **train** shares no database with dev: **7,000 questions over 58 databases**,
five cross-fitted folds, 14,479 model calls.

| | dev (1,534 questions) | train (7,000 questions) |
|---|---|---|
| accuracy without memory | 57.43% | 58.21% |
| accuracy with memory | 57.76% | **57.50%** |
| **delta, clustered interval** | +0.33pp [−0.63, +1.36] | **−0.71pp [−1.27, −0.18]** |
| the read-time filter recovers | +0.98pp | **+0.51pp** |
| gated result | +1.30pp | **−0.20pp** |

**Out of sample, the memory makes the product worse, and the filter recovers 72% of the cost without making
it better than not using memory at all.** Five of five folds are negative. The interval excludes zero and the
McNemar p is 0.0172; the magnitude, though, is 0.71pp against the 0.82pp this sample was sized to resolve,
so the run is filed as *within 95% but under 80% power* — the same category as four of the seventeen earlier
runs. The direction is settled. The size is at the edge of the instrument. The filter itself is real — it
discards 7.8% of the questions and those questions are the damaged ones (−6.57pp against −0.22pp, gap
[−10.99, −1.92] at p = 0.0158), the improvement survives leave-one-database-out (0.45–0.62pp across 58
databases), and it sits outside a permutation null of random discards of the same size (p = 0.0002). The
gated arm's −0.20pp is simply not distinguishable from zero.

**The pack is a reshuffle, not a drag.** Split the same 7,000 questions by what memory did rather than by what
it was worth: it repairs **6.39%** of the 2,925 questions the bare attempt got wrong and breaks **5.82%** of the
4,075 it got right. Per question, help is the likelier outcome. Per corpus, harm wins, because there are 40%
more right answers to break than wrong ones to repair — **0.79 repairs per break**. That is a base effect and
not a severity effect, and it is why the arm can flip sign out of sample while both directions keep happening at
rates of the same order on dev too (10.26% repaired, 7.04% broken).

Which makes the filter's precision, not its existence, the thing that decides the product. A filter that could
see every break would remove 237 questions and be worth **3.39pp**. This one removes 548, catches 32.1% of the
breaks and throws away 21.4% of the repairs: **15.2 questions spent per net error prevented**, **15.2% of the
ceiling** realised. In sample it was no better — 10.3 questions per net error, 24.2% of the ceiling — so the
limit is the signal, not the corpus it was measured on.

That makes the recommendation narrower than it was, and it is the useful form of a negative result:

> **Verify the generated statement against the request before you execute it.** That costs one comparison,
> it is in your control, and out of sample it is worth +0.51pp of execution accuracy. Do not expect the rules
> themselves to pay for the attention they cost — on a corpus that is not yours, they cost accuracy.

**Why the filter works is not why we thought.** The damaged questions are those whose generated query names
something neither the question nor the bare attempt mentions. On dev, 38.7% of those names were traceable to
the rule's own text; on train, **19.5%** are, and only 19.4% of the filter's recovery comes from questions a
rule named anything in. The rules do not have to name the column to push the model into over-specifying — so
the filter is a property of the query, not of the rule, and it works without knowing what the rules said.

You can reproduce all of it without a model call: `pnpm eval:out-of-sample` recomputes both columns from the
two committed artefacts, `pnpm eval:query-diff` and `pnpm eval:gate-stability` produce the pieces, and the
workflow asserts 36 numbers from them on every push — including the two rates, the exchange rate between
them, and what fraction of its own ceiling the filter realises.

**And the filter is a differential instrument, not a validity check.** Point it at one query — anchor the
same grounding rule on the question alone, with no baseline to subtract — and it degenerates. It flags
**94.8%** of the 6,990 bare attempts that have a query, because a correct query necessarily names tables
and columns the question does not spell out. Within that hit set it still separates (−12.58pp, clustered
interval [−22.15, −2.92]), but that is a *question-phrasing* effect: the 5.2% it leaves alone are the
questions that name their own tables, and those are easier questions. Youden's index says what the raw gap
cannot: **0.0257**, against **0.1068** for the diff-anchored filter. Loosening the rule to accept inflected
identifiers cuts the flag rate to 75.8% and lifts J only to 0.0700 — still under the bar. What the filter
measures is the *difference* between two statements, so a deployment that wants it has to generate twice:
once with the rules, once without, and compare. That is a real cost and it is the reason the product claim
stops here rather than at "a cheaper filter".

`pnpm eval:validity` recomputes the whole reading from the same two artefacts, and the workflow asserts
eighteen numbers from it, including the flag rate under both rules and the Youden index against the bar
the registration fixed before the number existed (`prereg/R33.md`).

The other half of the reason is not a tuning problem, and it is worth stating before you integrate:

> A rule distilled from one correction repairs **22.6%** of the questions a bare retry cannot fix —
> **on the question it came from**. Pointed at a foreign question it repairs 29 and breaks 29 out of
> 892 trials: **+0.00pp net**. A rule and its case are one object.

So the library is worth integrating where corrections *repeat* — a workspace with a house convention,
a schema whose grain is not guessable, a chart style a team insists on — and it is worth nothing where
every request is new. The recall path costs attention on every call, and attention spent on a rule
that does not apply is a real loss. The mechanisms that do not depend on repetition (M4, the evaluation
set every correction forms) are free and are the reason to capture corrections even when distillation
buys nothing.

The full accounting is in `WHITEPAPER.md` §3.5–3.6.1 of the [AgentiX-E/microglia-docs](https://github.com/AgentiX-E/microglia-docs)
repository; the pre-registered criteria and their refutations are in its `ROADMAP.md`.

Every number is reproduced by `pnpm bench` and written to `bench/results/study.json`; seventeen gates
must pass, or the build fails.

`pnpm eval:l0` runs the same instrument at 1,300 cases with gold derived by policy rather than by a
human adjudicator: 1,040 paired held-out questions, **+67.88pp** (95% CI 65.10–70.67, exact McNemar
p = 5.9e-213, 706 gained and none lost), and the domain that received no feedback at all at 100%. The
lane also prints the smallest effect its own sample could detect — 7.16pp — because an effect smaller
than that would be indistinguishable from noise here.

`pnpm eval:pairs` runs the pair-contrast lane (L2b): the same corpus taught twice, once with the
correction alone and once with the failed attempt recorded before the correction. Teaching runs in two
rounds, and the second re-asks two questions whose convention has since been revised — so the correction
retrieves a rule that is now wrong, and both arms actually correct a cited rule (2 of 2 revisions, 2 of 7
corrections overall). Both arms land at **87.50%** against a 12.50% baseline over eight held-out
questions, 75% of them reachable: delta **0.00pp**, below the 5pp bar, and the two stores end with
**identical rule states**. The null is measured, not vacuous: a correction at a scope where an active rule
disagrees already records a contradiction, which demotes the old rule — the recorded failure adds nothing
to a decision that has been made. Its only unique contribution, a negative lesson, is one the deterministic
reader has no channel for.

The τ²-bench lane (L4) ships its metric layer only: the unbiased `pass^k`, the task mean, and a
comparison that meets a published number through a stated bar. It runs in the `sota` workflow behind a
repository variable, and until the tool-calling environment exists it writes a `not-run` artefact rather
than a zero it did not measure.

`pnpm eval:integrity` runs the second instrument: 1,000 events replayed in five shuffled orders, plus a
control that bypasses the sort the store relies on. Order invariance and replay determinism are 1.00,
the control disagrees (which is what makes the 1.00 mean something), and a mid-stream schema rename
injects nothing stale. Erasure is measured in the same lane: nothing erased is retrievable afterwards.

`pnpm eval:memform` runs the third: 500 attacks across MemForm's five formation routes at three channel
trust ceilings. An attacker that controls content, citations, scope claims, paraphrases and arrival order
lands **0%** at trust ≤ 0.6 and 40% at 0.9 — where it is a trusted editor, which is the product working
as designed and is printed as a limit rather than folded into an average. Both lanes cost no model calls
and run in CI on every push.

`pnpm eval:delivery` measures the push surface against a real HTTP receiver: signed bodies verified with
`node:crypto`'s HMAC, an acknowledgement lost on purpose so the retry path runs, one response delayed
250 ms so the stopwatch can be shown to work, and 50 corrections. Every event arrives, in order per task
type, **0 missed**, one intentional duplicate de-duplicated by id, loopback p95 in single-digit
milliseconds. Building it found a defect in `distill`: a second pass over the same log used to rewrite
every rule's `updatedAt`, so "nothing changed" and "this rule was rewritten" produced the same
observation — the lane's first run reported **275** events for 50 changes. Fixed by making a merge with
no new evidence a no-op; the lane now reports 50.

`pnpm eval:judge` scores criteria against labels that were already paid for. ROSE-VEC publishes 322
expert-adjudicated predictions on BIRD questions, and publishes the five annotators' own verdict files
beside them, so the committee can be held to its own standard first: mean pairwise κ **0.7085**
(0.5115–0.8522). Execution accuracy, measured on the same items, agrees with that committee at κ
**0.4717** under ROSE's set semantics and **0.2995** under this repository's multiset semantics — 129
of 216 correct predictions are called wrong by the second. Two degenerate criteria are scored alongside
them: always-correct reaches κ 0 while scoring **0.6708** accuracy, higher than the multiset criterion's
0.5950, which is the reason the lane emits accuracy, κ and MCC together and refuses to emit one alone.
It costs no model calls, needs the pinned 800 MB Mini-Dev archive for the databases, and runs as its own
workflow rather than on every push. `JUDGE_MODE=llm` (or `both`) adds a model judge on the same items:
it is shown the question, the benchmark's external knowledge, the columns the query returned and five
rows — never the gold query, because a judge that compares is execution accuracy with a markup. `UNKNOWN`
is a first-class answer and unstated verdicts are counted beside the kappa rather than folded into it.

Measured, the Prover reaches κ **0.4762** [0.3636, 0.5793] on 308 stated verdicts — level with the `set`
criterion's 0.4717, not above it. It fixes what row comparison cannot (87 false negatives fall to 11) and
pays in the opposite currency (3 false positives rise to 50), because it approves 82% of items where the
committee approved 67%. `JUDGE_CASCADE=cascade` adds ROSE's adversarial Refuter, run only on what the
Prover approved, which is shown the reference query and told in those words that it is evidence rather
than a standard answer — so the reference is allowed to lose, and the refuter can name `GOLD_ERROR`,
`AMBIGUOUS` or `COINCIDENTAL` when it does. An unclear refutation leaves the approval standing: if a parse
failure could flip a verdict, the prompt's wording would become a scoring parameter.

The cascade reaches κ **0.5974** [0.5078, 0.6830] against the Prover's 0.4746 and EX's 0.4717. Two
ablations say where the gain comes from, and both are computed from the same replies: `cascadeStrict`
refuses every overturn that blames the reference and lands at **0.4542**, below the Prover, while
`cascadeEvidenced` refuses only the ones where the two queries returned **the same rows** and lands at
**0.6676** [0.5803, 0.7515] — an interval that does not overlap the Prover's 0.5761 upper bound, and
within 4.1pp of the committee's own 0.7085.

That ordering is the argument. Execution accuracy is a necessary condition for logical equivalence and
not a sufficient one: of 132 items whose query returned exactly the gold's rows the committee still
rejected 3, so equal rows cannot license an approval — but unequal rows always prove the queries differ,
so they can always veto one. The division of labour is therefore the model supplies the judgement and the
database supplies the veto, and it replicates at κ 0.6676 / 0.6634 / 0.6736 over three dispatches (1.0pp
spread on a 19.3pp effect). What it does not establish is that the 70 evidenced overturns are *correct*
rather than merely *evidenced*; 39 of them disagree with the committee, and that remainder is stated on
the road map rather than folded into the number.

The S2 lane takes the same question one level down: `SOTA_SEMANTICS=multiset` (default, the reading every
published number was scored under) or `set` (the reading under which execution accuracy agrees with the
committee most closely). Both are computed on every run, from one execution, so the shadow column answers
"would this delta have survived the other criterion" without a second dispatch.

`SOTA_ARMS=full-validated` runs the deletion half of the memory literature's remedy: after a fold learns,
it answers its own learn rows, credits each rule that reached a prompt whose answer was wrong, and retires
the rules whose failure share is at least `SOTA_VALIDATION_FAILURE_RATE` (default 0.5) over at least
`SOTA_VALIDATION_TRIALS` (default 2) injections — on learn rows only, because deleting on the questions
being scored is leakage with a tidier name. It retires **268 of 805 rules**, changes the pack on **192 of
350** scored questions, and moves the result by **−0.57pp [−2.86, +1.71], p = 0.81** against `full` on the
same questions. The artefact says why: the credit carries no per-rule information, and the failure counts
fit a single binomial at the lane's own error rate (pooled χ² 10.71 on 9 degrees of freedom, p = 0.296), so
"the worst third" is a random third. A `validation_histogram` and the policy that produced it travel with
every run, because a deletion that retired nothing and a rule that was never injected twice otherwise look
the same.

`SOTA_ARMS=full-anchored` answers the question *first* and revises against the pack in a second call, so
a retrieved rule is an objection to a draft rather than a template for an answer. Five dispatches:

| Arm | 1 | 2 | 3 | 4 | 5 | Paired against `full`, pooled |
|---|---|---|---|---|---|---|
| no memory | 54.00% | 53.71% | 52.57% | 53.14% | 53.71% | — |
| `full` | 50.29% | 49.71% | 53.43% | 53.14% | 52.00% | −3.71 / −4.00 / +0.86 / 0.00 / −1.71pp |
| `full-anchored` | +1.43 | +4.29 | −1.14 | 0.00 | −0.57 | **+0.80pp, McNemar p = 0.285** (67 lost / 81 gained) |
| `full-anchored-conditional` | — | — | −1.71 | −1.43 | −2.00 | **−1.71pp, p = 0.066** (52 lost / 34 gained) |

The fifth column is the honest one. Two dispatches made anchoring look decisive (+4.29pp, p = 0.0167);
three more put the effect at +0.80pp with p = 0.285. **The earlier claim that anchoring removes the pack's
cost does not replicate, and the reason is measurable**: every dispatch distils its own rules from its own
replies, so the treatment — the store — was resampled each run, and `full` itself moved from −4.00pp to
+0.86pp across runs of unchanged code. Comparisons inside a run are valid, because the arms share a store;
comparisons across runs were not, and the first two runs were the favourable tail of that distribution.

The conditional variant, which tells the model to act on an item whose `when` condition holds, is worse
than `full` in all three runs that measured it. Loosening the conservative instruction re-imports exactly
the harm it was avoiding, which is a negative result in the useful direction: it says the benefit comes
from making "unchanged" the default, not from finding a better reason to change.

`SOTA_ARMS=full-grounded` keeps only the rules whose statement names a table, or a column whose name
cannot be read as prose, and `full-sampled` keeps the same number chosen at random. The pair exists because
"the memory is wrong" has two readings — the content, or the quantity — and only a size-matched control
separates them:

| Arm | Rules per pack | ACC | Δ vs no memory | Δ vs `full` |
|---|---|---|---|---|
| no memory | 0 | 53.71% | — | — |
| `full` | 1.76 | 50.86% | −2.86pp | — |
| `full-grounded` | 1.16 | 51.43% | −2.29pp | +0.57pp (p = 0.774) |
| `full-sampled` | 1.16 | 51.71% | −2.00pp | +0.86pp (p = 0.607) |

The two pruned arms are **indistinguishable from each other** (p = 1.0) and both beat `full` by carrying
0.6 fewer rules, so what the memory says is not what costs: how much of it is in front of the question is.
Across the four sizes accuracy falls about **1.7pp per rule injected**. The audit behind the arm is worth
quoting too — of 1,288 distilled rules, 77% carry a condition that begins "The question asks…", 11% name
anything with an underscore in it, and 29% quote a literal value: the store is mostly English prose about
meaning, which is checkable against the data but not against the catalogue.

An earlier version of that filter accepted any column name and passed 79.7% of the pack, because BIRD has
columns called `date`, `name` and `rank`. Grounding on those is grounding on English; the strict test is
the one reported, and the loose number stays in `eval/results/history/` as the measurement that would have
been published had the arm not been rehearsed against a stand-in first.

`SOTA_DISTILL_CACHE` points the distillation at a file, and the workflow restores that file across
dispatches, so the next run learns the same store instead of a new one. Over a rehearsal against the
stand-in, the second run made 160 calls where the first made 201 and hit the cache 40 times out of 40 —
same store, fewer calls, and an arm comparison that finally varies in one thing.

`DEEPSEEK_ENDPOINT` points the lane at a stand-in instead of the provider, and
`eval/drivers/stand-in.mjs` is one: a rule per distillation, `SELECT 1` for every query. It exists because a
sequencing defect in the deletion arm — it wrote to the store inside the scoring window — reached CI and
spent fourteen minutes failing a guard that was correct, and every other mechanism here had been rehearsed
locally first. The artefact records the endpoint host, so a rehearsal cannot be mistaken for a run.

`pnpm bundle:size` bundles both published entry points for the browser and holds them to a ceiling:
**3,009 B raw / 1,410 B gzipped** for the client and **43,330 B / 14,684 B gzipped** for the core. The
build would fail if either stopped bundling without Node builtins, which is the "no runtime dependency"
promise measured rather than asserted. `pnpm bundle:size -- --probe` halves a ceiling and must be
rejected — a budget that cannot be exceeded is not a gate.

### Which BIRD split you measure, and why none of them is a leaderboard entry

Three splits, three different questions, and the lane refuses a fourth name rather than defaulting to
one — a typo that silently measured Mini-Dev while the dispatch said `dev` would produce a real
number under the wrong claim.

| split | questions scored | databases | what it is for | comparable to a leaderboard row? |
|---|---|---|---|---|
| `minidev` | 350 | 11 | the transfer experiments: it drops the easiest third, because a question answered right without help carries no signal | no |
| `dev` | 1,534 | 11 | reproduction: a published cell measured on 1,534 can only be reproduced on 1,534 | yes |
| `train` | 7,829 | 58 | out-of-sample: questions and databases the other two do not touch | **no, deliberately** |

**Run the precheck before you run the lane.** It loads a split exactly as the lane will — same
manifest, same parser, same pool rule, same population check — and stops before the first model call:

```bash
BIRD_DIR=/path/to/extracted/train SOTA_SPLIT=train pnpm eval:split-precheck
# [precheck] train: 9428 questions, 7829 selected over 58 databases — ready
```

It answers one question the lane can only answer by spending a dispatch: *can this split be measured
at all*. On train it was worth five defects, four of which fail after an 8.9 GB download.

**Two things about `train` that surprise people, both measured.** The archive is 8.9 GB and unpacks
its databases to **32.4 GB**, which is more than a standard CI runner has — but the questions sit on
the small databases, so the manifest selects 58 of 69 and scores 7,829 questions from 2.4 GB of
data. And `train.json` has no `difficulty` field on any of its 9,428 rows, so any code that reads a
tier unconditionally will throw on it.

**`train` is not a leaderboard entry and the name says so.** BIRD publishes no test cell for it, and
every system's train accuracy is measured on questions it may have trained on. The artefact calls the
split `BIRD train (out-of-sample)`, which matches no catalogue entry, so the comparison code cannot
file it as a reproduction of a published cell. Use it to ask whether an effect you measured on `dev`
survives questions you did not choose — not to claim a position.

Read the [user guide](docs/USER-GUIDE.md) for the integration contract, the
[architecture](docs/ARCHITECTURE.md) for how the pieces fit, and the
[glossary](docs/GLOSSARY.md) for the vocabulary.

## Repository layout

```
packages/core     the library, five modules behind subpath exports
packages/node     Hono routes, vendor providers, server bootstrap
packages/browser  fetch client and offline outbox
packages/eval     the benchmark instrument (private, not published); lanes in src/bin/
bench/        the ablation study and its gate report
scripts/      the quality audit that CI runs
docs/         user guide, architecture, glossary
```

## Development

```bash
pnpm install
pnpm check      # typecheck → lanes → tests → audit → integrity → memform → L0 → L2b → delivery → study → bundle size
pnpm bench      # study only, writes bench/results/study.json
```

Coverage is enforced at 95% on lines, statements, functions **and** branches. It currently reports
**99.97 / 99.62 / 100 / 99.97** over **1,081 tests**; the branch arms that remain uncovered are
listed with file, line, and reason in the internal technical design, and none is excluded with an ignore
comment.

## Licence

MIT.
