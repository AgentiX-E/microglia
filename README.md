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
| Projects knowledge into `@agentix-e/cortex` | Own the memory substrate — decay, bitemporal facts and conformance are `cortex`'s product (**8.39**) |

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

**The pack is a reshuffle, and a reshuffle on unequal bases is a cost.** Split the same 7,000 questions by what
memory did rather than by what it was worth: it repairs **6.39%** of the 2,925 questions the bare attempt got
wrong and breaks **5.82%** of the 4,075 it got right — **0.79 repairs per break**. That ratio looks like a near
miss against parity. Parity was never the bar. A repair can only happen on a question the bare model got wrong
and a break only on one it got right, so memory breaks even when the exchange rate equals **the odds of the bare
model being right**: 4,075 / 2,925 = **1.393**. Against that, 0.79 is a **43% shortfall**, and the two ways out
are arithmetic rather than rhetorical — repairs of **8.10%** at fixed breaks, or breaks of **4.59%** at fixed
repairs. Both directions keep happening at rates of the same order on dev too (10.26% repaired, 7.04% broken);
the base effect is what decides the sign.

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
identifiers cuts the flag rate to 75.8% and lifts J only to 0.0700 — still under the bar. What the flag
rate cannot show is visible on the questions it passes: of the **1,693** the bare rule leaves clean, the
pack's query imports a name on **99 (5.8%)**, and on dev 24 of 395 (**6.1%**). That is the imported-name
finding reproduced under a second, independent rule — the phenomenon is real; the standalone check is not.
What the filter measures is the *difference* between two statements, so a deployment that wants it has to
generate twice: once with the rules, once without, and compare. That is a real cost and it is the reason
the product claim stops here rather than at "a cheaper filter".

`pnpm eval:validity` recomputes the whole reading from the same two artefacts, and the workflow asserts
twenty-two numbers from it, including the flag rate under both rules and the Youden index against the bar
the registration fixed before the number existed (`prereg/R33.md`).

**And the population cannot rescue it either.** If memory cannot be made better, it might be shown less often:
a repair is only possible on a question the bare model got wrong, so a gate that admits memory only to those
would make the break rate zero by construction and collect the whole repair rate — **+2.67pp**, the largest
number in this record. The gate does not have to be good, only better than random: it needs **47.6%** of its
admitted questions to be ones the bare model would have failed, against a 41.8% base rate.

A gate built from published selective-retrieval work (SKR's kNN signal, in lexical form: the share of a
question's ten nearest neighbours in the same database that the bare model got wrong) reaches **62.4%
precision** — 20.6pp over the base rate, three and a half times the lift the registration asked for — and
returns **−0.05pp** on an interval that covers zero. The arithmetic was not wrong; it was about the wrong
population. **The precision bar belongs to the admitted set, not to the corpus**, and selection moves it: as
the gate tightens, the break rate *inside* the set climbs from 5.50% to **9.68%** while the repair rate stays
flat, so the bar climbs 16.8pp alongside the gate's 20.6pp and the two never cross. A question whose
neighbours failed is not one the pack can repair; it is one the model is *unstable* on, and an unstable
answer breaks as easily as it is fixed.

Across five gates and thirty registered points the best out-of-sample result is **+0.11pp** of that 2.67pp
ceiling — **4.0%**, on an interval that covers zero. The read-time filter, by comparison, realised 15.2% of
its own ceiling and still did not pay.

> Nothing ships. The rules do not pay for what they cost, a smaller dose does not fix them, and no gate that
> can run before generation selects the questions where they would help.

`pnpm eval:admission` recomputes every number in that paragraph from the same artefact, and the workflow
asserts twenty-five of them on every push (`prereg/R34-admission.md`).

**And the store cannot be pruned either, for a reason that is now specific.** The obvious store-side
intervention is to drop the rules that break and keep the ones that repair, which presupposes that a rule has
a value that travels. It does not. Across 203 rules and 13,578 injections the per-rule records are more
dispersed than the pack structure alone explains (χ² **293.3** against a permutation null of **209.6**,
p = **0.0047**) — the first real structure this project has found in the store — and that structure
**does not survive being measured somewhere else**: the same rules measured on two disjoint sets of
databases correlate **−0.13**, agree in sign on **49.1%** of the 53 rules that moved in both halves, and a
Spearman–Brown extrapolation gives a full-length reliability of **−0.31**. A prune built on that would
remove rules at random. The actionable version fails too: flagging the 58 rules that looked harmful over at
least ten showings covers 2,545 questions which returned **−0.55pp** against **−0.49pp** for the rest — a
0.06pp difference on an interval of [−1.97, +1.56].

**And the one variable that did move turns out to be the questions, not the count.** 423 questions whose
pack held a single rule returned **+3.07pp** against **−0.96pp** for the 6,576 that held two —
**+4.03pp [+0.76, +6.62]** clustered by database — and the arm that settles it had already been paid for:
R25 carried a `full-one` arm that gives the first rule to *every* question. On the same 1,534 it reads
**−0.33pp [−1.65, +1.25]**. The sign reverses, and the reason is visible in the cells: singleton questions
repair at the same rate as pairs (9.5% against 9.0%) but break at nearly half of it (4.2% against 7.8%).
A store that has one relevant thing to say about a question says it without disturbing much.

**The pack is not additive, which is the part that matters.** The two arms differ by one rule, so the
contrast decomposes, and the second rule does not simply add its own effect:

| the question was… | pair right | pair wrong | |
|---|---|---|---|
| one the bare model missed | 23 | 15 | it repairs 23, and prevents 15 that the single rule would have repaired |
| one the bare model answered | 24 | 27 | it prevents 24 breaks, and causes 27 |

The second rule carries **23 repairs and 27 breaks** — 0.85 per break, a net harm on its own record — but
it also **prevents 15 repairs and 24 breaks**, because the first rule answers differently when it is alone
in the block. The four cells sum to the measured −5 questions. An exchange rate says the same thing from
the other side: the pair clears **0.737** of the bare model's 1.335 hurdle, the single rule clears
**0.672**, so truncating the pack moves the arm away from paying.

**Two independent store draws, and the same folds in both.** The store is distilled separately for each
fold, and the split is seeded, so fold *k* is the same questions in every draw. That makes the per-fold table
a paired measurement rather than a curiosity — the project has two draws of it:

| fold | questions | first draw | second draw | both intervals span zero |
|---|---|---|---|---|
| 0 | 307 | 0 | −2 | yes |
| 1 | 307 | −4 | −1 | yes |
| 2 | 307 | +4 | +5 | yes |
| 3 | 307 | **−5** [−2.55, −0.66] | −1 [−2.93, +2.06] | **no** on the first, yes on the second |
| 4 | 306 | 0 | −2 | yes |
| **pooled** | **1,534** | **−0.33pp [−1.65, +1.25]** | **−0.07pp [−1.34, +1.20]** | **yes** on both |

Three folds keep their sign; the two that do not are exactly zero on the first draw and have none to keep.
The pooled null reproduces, and so do the two statements that matter for a product: the second item is a net
harm in both draws (**23/27** and **20/23**, 0.85 and 0.87 repairs per break), and one rule clears less of
the hurdle than the pair in both (**0.672 against 0.737**, then **0.708 against 0.721**).

**What the second draw takes away is the one fold that looked decided.** Fold 3 is the only row in either
draw whose interval excludes zero — **−5 questions, [−2.55, −0.66]** — and on the second store it covers zero
at [−2.93, +2.06]. The fold that is positive twice (+4, +5) spans zero both times. So no fold in either draw
yields an effect distinguishable from noise, which is why this README does not offer a rule-count setting
with a caveat: there is nothing to set it against.

> The item count is not a knob. Anything that tunes how many rules a prompt carries is tuning an
> interaction it cannot observe.

`pnpm eval:ledger` recomputes every number in the ledger paragraphs from `poc-sota-bird-train.json` and
`pnpm eval:pack-assign` recomputes the assignment from the dev run, `pnpm eval:lexicon` recomputes the
definitional grain's reach, licence, two deltas and exchange rate from its own artefact, `pnpm eval:frontier`
recomputes the reach ceiling from the corpus's own annotations, `pnpm eval:resolution` recomputes all 98
arm rows and their prices from the twenty committed artefacts, and `pnpm eval:coupling` recomputes the
layer table from the source tree; the workflow asserts fifty-six fields of the first two on every push,
thirty-one across the R37 round, sixteen of the frontier, fifteen of the ledger and eleven of the layer
table (`prereg/R35-ledger.md`, `prereg/R36-pack-assignment.md`, `prereg/R37-lexicon-grain.md`,
`prereg/R38-term-frontier.md`, `prereg/R39-arm-resolution.md`, `prereg/R40-layer-split.md`).

The other half of the reason is not a tuning problem, and it is worth stating before you integrate:

> A rule distilled from one correction repairs **22.6%** of the questions a bare retry cannot fix —
> **on the question it came from**. Pointed at a foreign question it repairs 29 and breaks 29 out of
> 892 trials: **+0.00pp net**. A rule and its case are one object.

### The grain of a memory write: a term, and the answer belongs to the corpus

Six rounds changed *which* sentences a prompt carried, how many, and what they were called. R37 changed what
a memory item **is**: instead of a sentence of advice, a store of `{term, statement}` pairs where the term is a
phrase copied from the question that taught it. A definition has a referent and can be checked against the
question in front of the reader; advice has none, so it is applied wherever it is read. Two predicates enforce
that: a candidate whose term is not in its own question is refused at write time, and an entry is rendered at
read time only on a question that contains its term.

The arm is licensed, and it is almost never renderable. 179 entries were distilled from 547 corrections — 0.33
per correction — and those 179 carried **13 distinct terms** a held-out question repeats, so the block rendered
on **132 of 1,534 questions (8.6%)**, with two of them (`cards`, `drivers`) accounting for 107 of the 132. Every
rendered line's term was re-found in its own question: **132 of 132**, zero unlicensed.

| contrast, dev split, 1,534 questions | reading |
|---|---|
| definitional grain − rule grain | **−0.59pp** [−2.09, +0.91], 65 gained / 74 lost |
| definitional grain − no memory | **+0.13pp** [−0.59, +0.85], 17 / 15 |
| its exchange rate across the split | 0.854 against the 1.335 hurdle |
| the same rate on the 132 questions it reached | 5 repairs / 4 breaks, clearance 1.18 |

The registration said in advance that a reach under a quarter of the split makes the round **inconclusive by
feasibility** rather than a refutation of the grain, and that clause fired. So the close is not "definitions do
not pay". It is the arithmetic: a definition is reusable only where a corpus reuses a phrase, and this one does
not. 127 of the 132 covered questions already carried a curated definition from the benchmark itself, so the
learned entry was a second copy of a hint the model already had.

> A memory item can be a term with a referent. Whether that is a lever depends on how often the words come
> back, and on this corpus they do not.

### Why that was a ceiling and not a badly built store

The obvious reply to the paragraph above is that the store was built badly, so the next round tested that
reply against the corpus instead of against the store. BIRD's `evidence` block is itself a store of
definitions — one per 90% of dev questions, keyed by phrases the questions use — so its keys are the key
universe a definitional memory could have had. Ranked by the questions they reach:

| store size | the corpus's own keys | the arm |
|---|---|---|
| 13 keys, the arm's own count | **241 questions** (density ≥ 0.5) | 132 |
| keys needed to reach 25% of the split | 53 | never reached 25% |
| ceiling with every vocabulary key held | **65.9%** | — |

So the arm was within a factor of 1.8 of what its store size could do, and the limit is in the corpus:
**the phrases a corpus defines are the phrases it mentions once.** A key used in three questions or fewer
carries an annotation in **96.7%** of them; a key used in fifty or more carries one in **7.7%**. The corpus
defines what it says once and says what it does not define. A memory retrieved by the question's own words
can only act on words that come back, and holding every vocabulary key still leaves **34.1%** of the split
unreachable.

Ranked without that filter the frontier looks enormous — two keys, `list` and `name`, reach a quarter of the
split — and it is the frequency of English rather than the reach of a definition, which is why the reading
publishes a band of three thresholds and takes the most generous one for its verdicts.


### Why the memory numbers disagreed: eighty of them were never measurements

Every claim in the paragraphs above is an arm inside a run, and until this round no arm had ever been put
beside the difference its own sample could resolve. `pnpm eval:resolution` does that for all **98 published
arm rows over 20 artefacts**, recomputing each delta from its discordant counts and printing the smallest
delta 80% power would have found:

| reading | what it says |
|---|---|
| rows decided by their own sample | **18 of 98** — and every one is larger than **4.5pp** |
| median floor at 350 questions | **4.38pp** over 75 rows |
| median floor at 1,534 questions | **2.07pp** over 22 rows |
| the one 7,000-question design | **0.82pp** |
| `full − none` | **20 runs, 18 negative, 2 positive, 1 decided, 6 inside a 95% interval** |
| its median magnitude | **2.86pp** at 350 questions, **0.33pp** at 1,534 |

So the range from +8pp to −9pp that this record has quoted since its first iteration is not a mechanism that
moves. It is a design that could not see anything below 4.4pp, asked sixteen times whether a 1pp effect was
there. The one contrast whose effect got **larger** when the sample grew is `linked`, the schema-pruning
channel: **7.71pp at 350 questions and 9.26pp at 1,534**, decided both times. That is what a real effect
looks like in this instrument, and nothing about memory looks like it.

The round also prices what it cannot decide. An effect of 0.07pp on the dev split would need
**1,457,294 questions**; the cheapest undecided question in the record costs 352. A question that costs a
million questions is not a question this project can ask, and saying so is arithmetic rather than a shrug.

Two defects were found while building the ledger, both by columns disagreeing with each other. The
`values` channel is **two contrasts and not one** — +1.17pp against the no-memory baseline and +0.85pp
against the `full` arm — and a paragraph that quoted one number for "the channel" was quoting a treatment
effect while describing a control comparison, which is why every row now carries its `control`. And the
first version of the replication table called a single decided run a replication, because with one decided
row "the decided runs agree" is vacuously true; `decidedAgree` is now `null` below two.

### Why every content axis was null: this corpus carries no reusable answer

Twelve content axes have come back null on BIRD — coverage, imported identifiers, denial, procedural vs
declarative form, grounding, size-matched controls, anchoring, conditional execution, deletion, recall
order, and the two this round added. Each was explained afterwards by saying that axis does not carry the
effect, and twelve explanations of that shape are a hypothesis about the corpus rather than twelve facts
about twelve axes. `pnpm eval:reuse` tests the hypothesis. A lesson can transfer only to a question whose
answer shares a column with the case the lesson came from, so the ceiling on any memory is the **reuse the
corpus admits**, and that is a property of the questions rather than of the sentences distilled from them.

The measurement pairs every case with its nearest neighbour **inside its own database**, found from the
question text alone, and scores reuse as the Jaccard overlap of the two gold queries' column sets. Columns
come from the SQL tokenizer, not from backticks: the extractor written first saw a column in **8%** of this
corpus's gold queries, because BIRD writes `SELECT player_api_id` without quoting, and reported a median
overlap of exactly **0.000**. That was a fact about the extractor. With the tokenizer the median is
**0.500**, and half the corpus shares at least half its columns with its nearest neighbour.

| corpus | cases | databases | top band (reuse ≥ 0.75) | 95% | bands above / below zero |
|---|---|---|---|---|---|
| dev | 1,534 | 11 | **+2.69pp** | [0.00, +5.66] | 2 / 2 |
| train | 7,000 | 58 | **−1.04pp** | [−2.20, +0.18] | 0 / 4 |

The verdict is **contradicted**, and it is not a question of power: the band that reads best on dev reads
worst on train, and train resolves 0.92pp at this sample while the band moves −1.04pp. On the corpus that
can see, **every band is negative or within noise of it**. There is no subset of BIRD in which the pack
pays for itself, and the reason is structural rather than a defect in distillation: a lesson about `County`
cannot help a query that needs `Free Meal Count`.

That closes the search this record has run for twelve rounds. The next axis cannot be a thirteenth content
feature, because this corpus is not the object a content feature operates on. What the mechanism needs is a
task family in which the same defect recurs — which is what the synthetic corpus is and what a one-shot
benchmark is not — and the honest statement of that is a scope claim, not another arm.

### The one lane that can enter that direction: ALFWorld, and a pre-flight that costs nothing

ALFWorld is the procedure the experience-reuse literature uses for recurrence, so it is the only public corpus
where "does a lesson survive a second attempt" can be asked against somebody else's data. `alfworld.yml` builds
that lane up to the point where a model would be called, and stops.

| fact | reading | why it matters |
|---|---|---|
| the corpus | **36.5 MB**, 4,027 files, MIT, **134 held-out games** | fetchable in two minutes through a mirror; 134 is the number ExpeL reports, not a subset we chose |
| the other sections | **140** seen (`valid_seen`), **3,553** `train` | counted, not quoted: a second section is the only place the lane can buy resolution, and `scripts/check_split_sizes.py` holds the table to the corpus |
| the environment | `textworld` builds an **Inform7 compiler** it fetches from `emshort.com` at build time | 3 KB/s and then abort from this sandbox; seconds from a runner, so the lane lives in CI |
| the release | PyPI stops at **0.3.5** (z-machine); the PDDL data needs the **0.4.2** tag | 0.3.5 also demands `torch`, `ai2thor` and `opencv` for a simulator the text path never constructs |
| the plan in the file | `walkthrough` is written in **first-release symbolic coordinates** | the text environment answers `Nothing happens.` to every step, so "verify against the gold plan" is wrong here |

The gate asserts the contract instead, and prints its own bill: a reset states a task and publishes admissible
commands, an admissible command changes the observation, an inadmissible one is refused in the environment's
words, and a twelve-step walk keeps the episode alive. A green run ends with `model calls made by this job = 0`,
because a build that is silent about its cost reads as a result about memory.

#### The floor, measured: 134 games, zero by accident, and a price that is now arithmetic

A driver that can open one game says nothing about the split. `eval/drivers/alfworld/floor.py` drives all 134
held-out games with a walker that chooses uniformly among the environment's own `admissible_commands` — no
model, no prompt, no cost — twice, with the same seed.

| reading | value |
| --- | --- |
| games covered | **134 of 134**, no duplicate, matched against what the split publishes |
| episodes terminated | **134 of 134** at the environment's own 50-step cap |
| floor | **0 wins**, Wilson 95% **[0.0%, 2.8%]** |
| replay | **134 of 134 identical**: 0 mismatches on game identity, win, steps, action digest, observation fingerprint |
| commands at reset | **25.05** on average — a closed, small action space |
| transcript | mean **5,367** chars, median 5,217, p90 6,846, max 8,405 |
| environment time | **852 s** for the first pass, **884 s** for the second, 6.4 s per game |

Zero is the most useful row. A walker that scored five percent would mean part of the task family is reachable
without understanding it, and the headroom any memory arm is measured against would be smaller than it looks.
The replay row is the second most useful: every minimum detectable effect on this record is the paired formula,
and the pairing only exists if an arm is a function of its seed.

**The transcript length turns the price into arithmetic.** A turn-based agent resends the conversation on every
turn, so the bill is a function of how long that conversation gets — and every factor in it was measured, not
assumed: 5,367 characters of transcript from the floor pass, and a fixed prefix of **3,965** characters, which is
the mean of the two ReAct examples per task type, now committed as
`eval/drivers/alfworld/prompts/alfworld-examples.json` from `prompts/alfworld.py@LeapLabTHU/ExpeL` at blob
`2b2093ef` (3,199 to 4,403 across the six types). **Four of those six counts were wrong before this file was
committed** — the mean was quoted 11% low — which is the second number on this page that a pushed artefact
corrected and a paragraph had kept rendering.

Those were estimates. A twenty-game calibration (`44673057091`, job `136078308716`) replaced them with the
provider's own counters:

| reading | value | what it settles |
| --- | --- | --- |
| wins | **11 of 20 = 55.0%**, Wilson **[34.2%, 74.2%]** | the control is **55pp above the floor**: 13.3pp of headroom exists |
| turns | 728 calls, **36.4 per game** | 35.3% of them thoughts — a third of the bill is deliberation |
| refused actions | **149 = 20.5%** of calls | the model names objects that are not in the room |
| tokens | 1,800,595 in / 15,553 out | **90.43%** of the input was a cache hit |
| bill | **$0.040063 = ¥0.28** | against **¥1.98** uncached for the same tokens: **7.0×** |
| clock | 42 s per game | 134 games is 94 minutes on one runner, about 24 across four slices |

So three arms over the full split is **¥5.71 measured**, where the estimate said ¥2.99: the prefix is 4,062
characters rather than 3,574, the hit rate is 90% rather than the assumed 96%, and the extrapolation runs from 728
real calls instead of a token model. The 55.0% matters more than the price, and in a direction no estimate could
have shown: **ExpeL reports its own control at 40.0 on a different model**, so the literature's 19pp was earned from
a lower baseline than this one. The registered prediction stays as written — it is a prediction — but the round that
reads the first arm should expect a smaller delta than the paper's, and that expectation is on the record before
the money is spent.

The seven-fold gap is a property of the arm, not of the provider. A transcript that is *appended to* keeps a
stable prefix and hits; a pack re-injected on every turn moves the prefix and misses. On τ² the memory arm was
billed **3.7× the control's uncached tokens on the same sixteen calls** for exactly this reason, and it is the
first thing to check about any memory design that looks cheap on paper.

#### Three arms, registered before they ran, and the one of them 134 games cannot see

`eval/drivers/alfworld/REGISTRATION.md` registers the first arm on this corpus: `none`, `always-in` (up to 20
rules rendered whole on every turn — ExpeL's mechanism, via the ported arithmetic in `rule-bank.ts`) and
`retrieved` (a lexical anchor per turn — this record's mechanism, on somebody else's corpus).

| prediction | resolved by 134 games? |
| --- | --- |
| `always-in` beats `none` | **yes**, if the effect is the 19 points the literature reports — 134 games resolve 13.3pp |
| `always-in` beats `retrieved` | **no.** A 5-point form difference needs **942 episodes**; a 3-point one needs **2,617** |
| `retrieved` is not worse than `none` by more than the dev band | yes, if the harm is as large as R159 measured |

The loop behind those arms is `eval/drivers/alfworld/agent.py`, and it is asserted before it is paid for. Its
skeleton is the competitor's own, transliterated: the system line, the two-examples template, the transcripts
split into alternating turns, and the parser's four branches — so an arm changes what sits *above* the transcript
and nothing else. Three zero-cost readings hold it in place: `--policy seed` reproduces `floor.py` game for game
(same wins, steps, action digests, observation fingerprints) and the `agreement` job fails on a single field;
**798 unit tests at 99.1% line-and-branch coverage, every module at or above 95%** (`agent.py` 99.9% of lines and
98.5% of branches, `aggregate.py` 99.5% / 98.1%, `cycles.py` 99.1% / 97.7%, the offline scorer at 100%), cover the
parser, the split, the shard arithmetic, the bill, the cycle reader and the loop itself; and a test asserts that `none` and `always-in` differ at
exactly one message index. A second **channel** — `--parser any-line`, which executes the command the first-line rule
refuses — is a field in every episode, a token in every label and a span `aggregate.py` refuses to pool until it is
named, because a harness is not an arm. The same is true of the **turn guard** (`--guard-commandless`), which answers a
reply that carried no command with one line naming the requirement instead of `OK.`: it carries `@guard` in the label and
a three-counter ledger (`fires` / `checked` / `relapsed`) in every episode, so an arm that was armed and never fired can
be told from one that was never armed — a guarded arm costs **$0.1946 against its control's $0.2152** and wins **8 of
the 10 games** the control loses to narration.

The **state ledger** (`--state-ledger`) is the second answer-side knob and the guard's sibling: on a turn whose command
moved nothing — the world answered `Nothing happens.`, or the action was not admitted — the observation is followed by
one line naming the last three commands already tried, repeats collapsed. **The two triggers are nested in this corpus and
only one has ever fired**: across 822 armed games `ledger_fires` equals `invalid_actions` exactly (413/413, 479/479), so
every line the treatment rendered answered a command the world had already refused, and the state family is an
**admissibility repair** rather than a search repair (AUDIT 34.284). It fires on a different turn than the guard
does (a command that failed rather than a reply that carried none), so it carries its own token (`always-in@anyline+guard+ledger`)
and its own two counters (`ledger_fires`, `ledger_chars`), and `aggregate.py` refuses to pool the two states until a join
names them with `--expect-ledger`. The line is conditional by construction: a game whose actions all land carries no
extra character, which is what keeps a search repair inside the price of a pass. R191 bought it: **267/274 against the
guard's 265/274**, +0.73 pp (p = 0.597, mde 2.89 pp), all **four** games the guard alone lost won, **413 fires** and
42,845 characters — 2.28% of the arm's prompt — for **¥2.69**, with 76 fewer calls than the control it beat. `--state-ledger-counts` is the
counted renderer R193 measured: `take apple 1 (4 times)` instead of a copy of the copy, and no line at all when the
window is the one the previous line named. It **lost**: 263/274, the maximum lines a game received rose from 40 to
**42**, the characters added rose from 42,845 to **48,179**, and the change gate silenced **2 of 479** fires because a
counted line gives the same-window condition nothing to compare against. The flag stays in the driver as a measured
negative; the state family's version is the plain list.

The third renderer is **`--state-admissible`**: on the same turn, the line names **what the world admits** — how many
commands, and one of them — because AUDIT 34.284 read the 822 armed games of R191 and R193 together and found
`ledger_fires` equal to `invalid_actions` in every one of them. The list was never a search repair; it was an
admissibility repair. It has been dispatched twice. R194 (**265/274**, −0.73 pp against the list, half the characters)
showed the example was `help` in **88.7%** of the games it fired on, so the rule became structural: the example must carry
a task verb, or the line is the count alone, behind the token `@ledger-admissible-task`, counted by
`admissible_task_fires` / `admissible_meta_fires` / `admissible_exampleless_fires`. R195 read **266/274, unseen
134/134** — every registered reading held, 94.3% of its 383 lines carrying a task-verb example with **zero** meta
commands, **20,346 characters against the list's 42,845** — and still moved the pool by **+0.36 pp** [−1.09, +1.82]
against the `help` renderer. What the content did move is the corpus's refusal count: **465 → 383**, outside the
391–441 band the control produced on five identical-code draws. A memory line's *content* is worth a 17.6% refusal
rate and 0.0 pp of success on this corpus, which is the negative-effect finding reproduced as a paired contrast.

Every episode also carries **`commands`** and **`fire_turns`** — the ordered history the renderers read and the index of
the command each line answered — so that a cycle-aware renderer can be replayed against an arm already paid for instead of
being dispatched to answer a question that costs nothing to ask offline. `eval/drivers/alfworld/cycles.py` is that
reader, and its first run closed the family: over R195's 274 games there are **177 loops** — turns that re-issued a
command the world had already **accepted** — in 136 games, plus 18 retries where a command refused at a distance was
accepted after walking over. Only **3 of the 8 losses** contain a loop, and five contain none: 49 to 50 commands that
never repeated. Three games is **+1.09 pp** on a split that resolves **2.29 pp**, so the
dispatch that was going to be bought for it was cancelled by arithmetic rather than by opinion, at ¥0.00.

The published number for the arm is a **band**, not a point: five draws of one arm on one 274-game pool landed on 267,
268, 265, 268 and 270 — a **1.82 pp** range with no treatment applied — so the record quotes **1,338/1,370 = 97.66%
[96.72, 98.34]** and never differences two draws as if the difference were an effect (R192). The unseen section moves by
one game across all five draws (99.70% pooled); the seen section moves by four (95.71%).

The one component that is scored **before** anything is bought is `scripts/score_bank.py`, which reads a bank and
returns the literature's admission score for the pack each task type would render — specificity x abstractness, with no
model call. It reproduces every rendered length this record has published, and R190 is what it says about its own
usefulness: over the three banks measured against a control in one dispatch the rank correlation is **+0.500** against a
registered 0.6, because the score's whole range on this corpus (1.62x) sits below the lane's 9.7 pp resolution. Use it to
see whether two candidates are distinguishable; do not admit on it. A model reply that
never produces an action fails the run rather than scoring zero — a zero would be a number about the prompt's
syntax wearing the costume of a number about memory.

Registering a prediction the design cannot resolve is the point of writing it down: 134 games is the split, the
split has 134 games, and no amount of careful analysis makes a 5-point difference visible through 13.3 points of
noise. The two honest ways to buy power — repeat passes with a cluster bootstrap over games, or pool a split
ExpeL trains on — are written into the registration with what each costs in validity.

**What the lane has since bought.** One hand-written sentence of 292 characters — the `put`→`move` repair — reads
**223/274 (81.39%)** against a 163/274 control on two corpus sections, **+21.90 pp [+15.69, +28.10]**, and the two
sections cannot be told apart (+7.80 pp, [−4.63, +20.27], p = 0.226). Its provenance half was bought next and read
**−3.65 pp [−8.39, +1.09]**: an entry that names a run in which it won is worth *less* than the same entry with a
neutral clause of the same length, while the length itself is free (−0.36 pp, [−4.74, +4.01]). Then the reader was
changed rather than the sentence: on `--parser any-line`, which executes the command the first-line rule refuses, the
same bank reads **257/274 (93.80%)** against a re-bought control at **197/274 (71.90%)** — **+9.85 pp** for the bank arm
and **+17.15 pp** for the control, and a memory effect of **+21.90 pp** where the reference channel says **+29.20 pp**.
Both levels are read on a harness this lane built, and the published rows were measured on the competitor's reader, so
the held-out figure (**129/134 = 96.27%** at that bank; **133/134 = 99.25%** at the scoped bank below) is quoted on the
board only with that caveat attached and beside the family it
belongs to; the reference channel reads **115/134 = 85.82%**. Both readings, the
per-kind decomposition and the two sections are in `eval/drivers/alfworld/REGISTRATION.md`; the argument for
reading them is in `WHITEPAPER.md` §3.5 of the [docs repository](https://github.com/AgentiX-E/microglia-docs).

**Then the turn budget was cut from fifty to thirty on both arms, and it was pure budget.** 257 → **240** and
197 → **156**, against frozen-behaviour predictions of 242 and 157 computed from the arms' own records: both within two
games, so the cap changed the budget and nothing else, and the memory effect at the short cap (**+30.66 pp**) is
**+31.02 pp** of arithmetic with nothing left over. The one thing that did move is thoughts per turn on the nine games
that still lose — **0.3533 → 0.2667** with `put` unmoved at 50 of 59 — which says the cap suppressed narration and
narration was not the cost. Those nine split into **five** that issue commands the world rejects (3 to 11 invalid
actions, ending on `Nothing happens.`) and **four** that run out of turns mid-progress, so the floor that survived both
repairs is a **precondition** the model does not hold.

**Then one 197-character entry was written for one kind and read by six.** Replacing the pack's format instruction with a
precondition (open a closed container before taking from it) moved `put` **50 → 56 of 59** and `clean` **58 → 45 of 58**:
net **−12 games** over 274. The kind that lost does not act less — it thinks **4.4 → 10.8** thoughts a game with three
times the invalid actions — so a memory entry is a treatment on every task that reads it, and the repair is scope rather
than wording: two entries tagged to disjoint kinds, one per game, still 551 characters (`banks/bank-putscope-2.json`).

**Then the same 197 characters were delivered only to the kind they were written about, and the cost went away while the
gain stayed.** The scoped bank reads **264/274 (96.35%)** — **133/134 (99.25%)** on the unseen section — against R183's
257 and 197. `put` holds at **56/59** (+10.2 pp over R183, and the gain replicated at exactly the same 8-gained,
2-lost transitions in both rounds: pooled 16 against 4, p = 0.0118), `clean` returns to **58/58** from 45, and the five
kinds whose packs are byte-identical to R183's move **one game** (207 → 208). The negative effect of R185 was therefore
scope and not content, and it is repairable without giving up the gain. The counter that had been read as the pack's
format clause — `recovered`, 269 → 137 — turns out to be **91% `put`** in R183 and 79% in R186: the pool fell by 113
inside the one kind whose clause was removed while the other five rose 23 → 35, so `aggregate.py` now prints it on each
kind's own line, with that kind's own calls as the denominator.

**Then the same bank was re-drawn three times, and the pool is what is stable.** 264, 264 and **266** of 274 across three
packs — the published one, an added 259-character entry about the turn budget, and that entry with its words permuted —
with the unseen section at 131 to 133 of 134. The instruction, its permutation and the bank without either are one arm:
paired −0.73 pp, p = 0.66. What moves between draws is not the score but **which games are lost**: ten losses became
eight and ten, and only three of twenty game-slots stayed lost, because a rumination loop is a state the model enters on
a draw rather than a property of a task. So the quotable numbers are the pool and its band, and the losses are read as
rates: **11 thought-heavy losses per 822 game-draws (1.34%)**, the same order as the search losses, against a pool that
reads 264 to 266 whatever the pack adds.

**Then the lane spent five arms finding nothing, and found a bug instead.** Five renderings of that one sentence —
itself, plus a neutral clause, a true citation, a false citation, and the sentence with its second operation
ablated — were bought at 274 games each for **¥9.43**. They span **212 to 223 wins**, eleven games and 4.0 pp, and
every interval covers zero: at a fixed 551 characters and a fixed position, *what the entry says beyond its first
operation does not move the score*. The ablations were not measuring the sentence; they were measuring a reshuffle.

The reason is a defect in the driver, and the training transcripts had it all along. `parse_reply` is the
competitor's parser transliterated, and it anchors at the first line, so a reply that opens with `> think:` is a
thought and any command under it is dropped — and the competitor's own few-shot examples write think-then-act in one
turn. What this driver then answered was `OK.`, the examples' token for a thought that was *only* a thought. The
model read its own `> put …` followed by `OK.`, believed the put had executed, and repeated "The task is complete"
until the turn budget ran out. On the 245 train games already in the workspace: **1,070 commands dropped, in 72 of
72 `put` games** (14.9 per game) and 30 of the other 173 games, with a mean trailing run of 9.7 victory claims —
`put` is the only kind destroyed because it is the only kind where the model hedges before acting and the only kind
that runs near the 50-turn cap.

Three things changed, none of them the parser: a non-action turn that carried a command is answered with the
corpus's own `Nothing happens.` instead of `OK.`; `refused_actions` and up to three `refused_samples` enter the
episode record, so the drop is visible in an arm file for the first time; and `aggregate.py` prints
`dropped <arm> n (x per call)` beside `refusals`, or `not counted` for a file written before the field existed.

**R181 read the repair, and the repair's own mechanism was refuted.** `refused_actions` measures **11.64 per `put`
game** against 0.00–0.07 on the other five kinds — the counter reproduces the training transcripts — and `put` still
read **20/59 against 21/59**, while the same bank across the repair read **+1.82 pp [−2.55, +6.20]**. So the model did
not stop writing a thought and a command in one reply; the answer it received was never the binding constraint, the
format is. What the round did produce is the best level this lane has read — **227/274 (82.85%)** against 150/274,
**+28.10 pp [+22.26, +33.58]**, and **114/134 = 85.07%** held out — with the caveat that the control drew 81 of a band
that runs 80 to 93, so the effect is quoted as +14 to +28 pp. R182 puts the format operation into the 197-character
slot R180 measured dead, at the same 551 characters, and predicts `refused_actions` below 5 per `put` game.

### Where the scenario actually is: 1,956 lines, 7 modules, and a gate for the rest

The library claims it is scenario-agnostic. That claim has been made in a paragraph since its first
iteration, measured once by hand, and never recomputed — which is the shape of every number that quietly
stops being true. `pnpm eval:coupling` recomputes it from the source tree on every push, and
`readme-layers.test.ts` fails the build when this table and that command disagree:

| layer | production modules | lines | modules that name a scenario |
|---|---|---|---|
| `core` | 61 | 14,073 | **0** |
| `protocol` | 3 | 1,922 | **0** |
| `sql` (the adapter) | 7 | **1,956** | 5 |
| `eval` | 199 | 60,133 | 25, each with a written reason |
| `browser` | 2 | 280 | 0 |
| `node` | 6 | 1,308 | 0 |

**The scenario is 2.5% of the production tree and none of it is in the library.** `core` names no
database in code — every occurrence of `sql` in it is inside a test, where a scope string is free text —
and the text-to-SQL surface is **1,956 lines in 7 modules** that execute, guard, differ, link and
render SQL. The 25 modules that keep a scenario word outside the adapter each carry a reason in the
source, from *the dataset loader* to *the lane that has not been split yet*, and the gate fails if
a 26th arrives without one.

Three things make this a measurement rather than a claim:

- **Comments are not coupling.** A module that explains in prose why it is *not* SQL-specific must not be
  counted as SQL-specific, so the scan strips comments — with a lexer that survives a `//` inside a URL,
  a quote inside a template literal, and a quote inside a regular expression, which is how the first
  version of the scan silently ate a module's body and reported it as coupled.
- **The import graph is checked, not drawn.** Five package edges, every one downward; any edge that points
  at an equal or higher layer fails the build.
- **The classification is data, not a verdict.** A new module in `eval` with `sqlite` in it fails until
  somebody moves it into the adapter or writes down the dependency that keeps it out.

The move itself changed no number: all 31 committed artefacts revalidate, and every reading in the `pnpm
check` chain diffs clean. That is what a mechanical stage is for — it can be checked mechanically.


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

`SOTA_API_KEY` funds a run whose host is not this one, and it exists because the model and the host were
already variables while the credential was not — which made the one comparison nobody here has run, the same
scaffold on a different model, impossible to run correctly. A key is spent where it was named: `SOTA_API_KEY`
wherever the lane points, and `DEEPSEEK_API_KEY` only at `api.deepseek.com` and at a stand-in on this machine.
A DeepSeek key aimed at another provider's host stops the run before the first call instead of arriving as a
`4xx`, because a refusal per prompt ends as a tripped breaker and an artefact that says the endpoint stopped
answering. The artefact's `model_credential` field says which of the two paid, so two runs of the same arm on
different backbones stay tellable apart.

`SOTA_ENDPOINT` is the host that goes with `SOTA_API_KEY`; `DEEPSEEK_ENDPOINT`, which every rehearsal in this
repository already uses, still works as the older name. The `sota` workflow exposes one dispatch input that
moves all three — `backbone=zhipu:MODEL` — because a menu that can move the host without the key is a
menu that can spend the wrong account's money on a refusal.

`pnpm bundle:size` bundles both published entry points for the browser and holds them to a ceiling:
**3,009 B raw / 1,411 B gzipped** for the client and **53,788 B / 18,389 B gzipped** for the core. The
build would fail if either stopped bundling without Node builtins, which is the "no runtime dependency"
promise measured rather than asserted. `pnpm bundle:size -- --probe` halves a ceiling and must be
rejected — a budget that cannot be exceeded is not a gate.

### What a deployment actually ships: five knobs, and the reading behind each

A library and its benchmark are two programs that drift by default. The arm sets `speakMargin: 0.2` in its own
`openMicroglia` call and publishes the win; `createServer` still serves the library default, because nothing in
the repository compared the two and no line that looks like a configuration changed. The gap is invisible in
both halves and total in the product.

So the shipped configuration is **a record with five fields** —
[`packages/core/src/kernel/serve-profile.ts`](packages/core/src/kernel/serve-profile.ts) — and both sides read
it: `createServer` spreads `serveOptions()`, an eval control arm spreads the same call, and
`eval/results/serve-profile.json` carries, per field, either the reading that chose the shipped value or a
written reason there is none.

```bash
pnpm eval:serve-profile            # the table, then no drift / REFUSED with every problem listed
pnpm eval:serve-profile --print    # just the shipped profile, for a deployment note
```

It refuses four things, and the fourth is the reason it exists:

| refusal | what it catches |
|---|---|
| `the record states 800, the product ships null` | the two halves disagree |
| `the reading [-2, 4] does not resolve` | a justification that is a sentence wearing an interval |
| `claims the reading R197 while the product ships the default` | a **decorative reading**: real evidence about a knob the product ignores |
| `an unmeasured field needs a reason` | a placeholder where the debt used to be invisible |

**Today the table reads five fields, zero measured.** That is not a defect to hide; it is the state, printed on
every push. `speakMargin` has a dispatched reading that does not resolve (R123: −2.50 pp [−22.50, +17.50] at
n = 160, while the rung withheld a third of the packs). `note` has an arm that was built, pre-registered and
never dispatched. `credit` has a mechanism check, not a rate. `budget` and `budgetBasis` have never been varied
alone. The product ships the library defaults, and the record says so in the same words a reviewer would.

What the gate does **not** bind is a lane's treatment arm — and that gap was the next defect rather than a
footnote. `tau2-driver.ts` wrote its own `budget`, `note`, `budgetBasis` and `speakMargin` into the host call, so
the arm and the product agreed by convention: a treatment could move two knobs, be reported as one, and nothing in
the artefact could see the second. That is closed below.

### A treatment arm is the profile plus the fields the dispatch named

`armServeOf()` — [`packages/eval/src/arm-serve.ts`](packages/eval/src/arm-serve.ts) — builds an arm's host
options by starting from `serveOptions()` and overlaying only the fields the dispatch named. The driver spreads
the result instead of writing its own keys, so **no knob can be set outside the mechanism**, and every field that
moved is named with the variable or reading that moved it:

```text
[tau2] serve: arm = the product's profile                       # the baseline dispatch: it IS the product
[tau2] serve: arm = profile + budget 1500 (TAU_PACK_BUDGET) + speakMargin 0.05 (TAU_SPEAK_MARGIN (R123))
```

Three properties come from the type rather than from discipline:

- a field named twice is refused — one arm has one value, and two reasons for one value is an arm that cannot say
  what it is;
- a moved field with no reason is refused — a knob that moved and cannot say what moved it is the drift this
  exists to catch;
- a field named at the value the profile already ships is kept as **named and unmoved**, because "asked for the
  default" and "never mentioned it" are different dispatches, and the second is indistinguishable from a driver
  too old to know the knob exists.

`pnpm test` covers both ends: the module's own refusals, and the driver imported twice — once with nothing set
(it moves zero fields) and once with `TAU_PACK_BUDGET=1500 TAU_SPEAK_MARGIN=0.05 TAU_INJECTION_NOTE=hardened` (it
moves exactly those three, in profile order).

### What an arm cost, and the three ways a file can say it

The τ² lane could report accuracy for three rounds and no price, because `bin/l4.ts` wrote `calls: 0` as a
literal while the driver had been counting provider calls since R103 and the pairing step read a different field.
One run therefore had two answers in two files.

An arm's bill is now read once, by
[`packages/eval/src/arm-bill.ts`](packages/eval/src/arm-bill.ts), into **three states that are never spelled the
same way**:

| state | what was measured | written as |
|---|---|---|
| `census` | provider calls **and** tokens | `usage_absent: 0, usage_counted: 0` + `prompt_tokens` / `completion_tokens` / `uncached_tokens` |
| `count` | provider calls only (a pre-R198 artefact) | `usage_absent: 0, usage_counted: 1` |
| `absent` | nothing | `usage_absent: 1, usage_counted: 0` — `calls: 0` means "nobody counted", not "no calls" |

The census is read from the document at the root or under `tau2.usage`, refused when a number is not a number
(`bad-usage`), and carried into the artefact so the arm and the pair report the **same** call count for the same
run — which is the acceptance test, not an intention. `l4-pair` publishes `first.calls` / `second.calls` beside
`pass4` in one file, so the accuracy-versus-cost board no longer needs two artefacts and a hand-joined log line.

### What the pack does when it is served: 78% of it is inert, and that is the number that replicates

Every τ² fold carries two blocks that describe the same episodes: `serveYield` says how many packs were rendered
and how many repaired or broke, and `degradation` says the same counts from the comparison's side. Read together
they close an identity no document states:

```text
inert = served - repaired - broke
```

A pack is inert exactly when the episode's verdict did not change, so that is not an estimate of inertness — it
is the definition. `pnpm eval:pack-ledgers` recomputes it from every committed pair artefact, refuses a file whose
blocks do not close, and prints one line per fold:

```text
eval/results/poc-l4-pair-r152c.json: 40 served, 29 inert (72.5%), 4 repaired against 7 broke (0.57 repairs per
  break), -7.50 pp
all: 6 fold(s), 291 served, inert 78.7% [73.6, 83.0], -3.44 pp, 11 of 36 breaks must go (31%) — pooled over 3
  treatment(s)
```

| fold | served | inert | repaired | broke | repairs per break | delta |
|---|---|---|---|---|---|---|
| `r152` | 40 | 35 | 3 | 2 | 1.50 | +2.50 pp |
| `poc-l4-pair-official` | 40 | 33 | 4 | 3 | 1.33 | +2.50 pp |
| `poc-l4-pair-r198` (the priced fold) | 40 | 33 | 4 | 3 | 1.33 | +2.50 pp |
| `poc-l4-pair` (pre-R152) | 57 | 47 | 4 | 6 | 0.67 | −3.51 pp |
| `poc-l4-pair-r152c` (bounded arm) | 40 | 29 | 4 | 7 | 0.57 | −7.50 pp |
| `poc-l4-pair-swapped` | 74 | 52 | 7 | 15 | 0.47 | −10.81 pp |
| **all six** | **291** | **229** | **26** | **36** | **0.72** | **−3.44 pp** |

**The delta does not replicate and the inert share does.** Six folds, six splits, three treatments, and the
delta ranges from +2.50 to −10.81 pp inside intervals ±9 to ±11 points wide. The inert share lands between 70.3%
and 87.5% every time, and its corpus interval — [73.6, 83.0] — is narrow because it is a count of episodes rather
than a contrast between two arms. The stable statement about this memory is therefore not "it costs accuracy"; it
is **"most of what it serves cannot change anything, and the part that can breaks slightly more often than it
repairs."**

**The pooled number was also a mixture.** R197's cancellation quoted **−4.64 pp over 194 pairs**, which is the four
folds paid for after R152 — and that pool silently averaged R152c's *bounded* arm (a rotation over the travel
budget) with three that declare none. The gate now pools by treatment and reports each key separately: −3.90 pp
over 154 episodes for the key without a rotation field, −2.50 pp over 80 for the bounded one (two independent
draws after R198), −3.51 pp for the artefact written before the treatment block existed. Every key is negative, so the conclusion survives the correction while
the number does not — and the test recomputes −4.64 from the four artefacts to show the published figure was
arithmetic, not invention.

**And the key was not total, so the field is now written rather than inferred.** `rotation` used to be recorded only
when an arm declared one, so a fold written before the projection could not be assigned: `poc-l4-pair-r152` declares
no rotation in its artefact while its pre-registration pins `serveRotation: fair-share`, and the "no rotation" pool
therefore contained a bounded fold. R202 fixes this at the producer: `treatmentOf` writes `rotation` unconditionally,
as the declared policy or the literal `none`, so every fold bought after that round states one. The reader is
deliberately unchanged — a committed key may not move because the fold was re-read — so the four pre-field artefacts
keep exactly the strings they had, and `pnpm eval:pack-ledgers --check` proves the record and the artefacts agree.
Keys are still quoted as *what the artefact declares*, never as *what ran*.

**What a gate would have to buy, in episodes.** The corpus needs **11 of its 36 breaks prevented (31%)** before the
delta stops being negative. That is the target the next registered gate is priced against, and it is a different
target from "serve less": withholding an inert pack is free by construction — the verdict it did not change stays
unchanged — and saves the injection, not a repair.

**The price column is filled, and it is the number that re-prices everything above.** Five folds are `unpriced`
with the reason printed — they predate R198's reader. The sixth is a bill on both arms, and it reads:

```text
eval/results/poc-l4-pair-r198.json inert price: 3299.6 injected prompt tokens an episode, of which 2722.1 bought nothing
```

3,299.6 tokens an episode, for a pack that is 788 characters (≈200 tokens) and inert 82.5% of the time. The premium
is not the pack's size, it is its size **× the turns it rides**: the agent appends the pack as a second system
message and reuses it on every later turn, so ~11.2 turns an episode × ~295 tokens is the 3,299.6. The fold's four
repairs therefore cost **32,996 injected tokens each** (131,984 tokens over four repairs), and in money the run cost
**$0.384 ≈ ¥2.75** (learn $0.1969, memory eval $0.0944, control eval $0.0931).

**The gate that follows, priced from the same artefacts rather than bought.** R200's 78% answers a natural
question — withhold a pack that cannot change anything, and only the bill moves — and `speakMargin` is exactly that
gate: a pack is served only when its top two candidates are further apart than a threshold. R201 was registered as
three dispatches at ¥4–5 to trace the dose–response. It did not need them: every committed fold already carries
`serveSweep`, a ladder pricing **every** rung against the same episodes, so the curve is a column of numbers that
already exist. `pnpm eval:rung-dose` reads it, and the corpus says this:

| rung | served | withheld | repairs kept | breaks left | breaks prevented | inert among served | selectivity | net |
|---|---|---|---|---|---|---|---|---|
| 0 | 291 | 0 | 26 | 36 | 0 | 78.7% | +0.0pp | −3.44pp |
| 0.01 | 257 | 34 | 22 | 30 | 6 | 79.8% | +1.3pp | −2.75pp |
| 0.05 | 216 | 75 | 17 | 26 | 10 | 80.1% | −6.8pp | −3.09pp |
| 0.10 | 172 | 119 | 14 | 20 | 16 | 80.2% | −1.7pp | −2.06pp |
| 0.20 | 114 | 177 | 12 | 14 | 22 | 77.2% | +7.3pp | −0.69pp |
| 0.25 | 94 | 197 | 11 | 12 | 24 | 75.5% | +9.0pp | −0.34pp |
| 0.30 | 76 | 215 | 10 | 10 | 26 | 73.7% | +10.7pp | +0.00pp |

Three readings, and the middle one is why the module exists:

- **It passes its own acceptance, literally.** The registered bar was "≥4 repairs kept and ≥4 breaks prevented";
  rung 0.01 keeps 22 of 26 and prevents 6 of 36. A gate that meets the count is shippable on that count alone.
- **And it is not selecting on inertness.** Among the packs the rung still serves, the inert share *rises* (78.7% →
  79.8% → 80.1% → 80.2%), then falls only where more than half the packs are withheld. `selectivity` is the number
  that says why: at 0.01 it is **+1.3pp** — 4 of 26 repairs lost against 6 of 36 breaks prevented — and through the
  middle band it is **negative** (−6.8pp at 0.05), because the margin withholds *repairing* packs faster than
  breaking ones. A dose knob has selectivity 0; a gate over inert packs needs it positive by a wide margin.
- **The net delta only turns positive by turning the memory off.** −0.34pp at 0.25 with 68% of packs withheld, and
  +0.00pp at 0.30 with 74%.

So the honest statement is not "the gate works" and not "the gate fails": it is a **cost knob with a measurable
price** — 11.7% of the injection bill for 15% of the repairs at rung 0.01 — and the bill it trades against is now a
number rather than a promise.

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

### The state channel: what is done, what is pending, and what a receipt proves

Every memory arm in this repository until now served a **sentence about a failure**. Four rounds of that
measured no effect larger than the grid's own variance, and the published ablation of the system holding the
SOTA on τ²-retail prices the same channel at **+2.0 points with an interval that includes zero** — against
**+23.9** for verified working state.

`eval/tools/goal_board.py` is that second channel, and it costs nothing to build: it reads the asks out of the
**request** (a family — exchange, return, cancel, modify, address, payment, transfer — and the words that name the
object) and the receipts out of the agent's own tool calls (state-changing calls that succeeded, with the product
names their results proved), then recomputes the board on every turn. A line is ticked only when a receipt of the
same family **names the product the ask names**; a receipt that settles nothing is reported as *unrequested* (work
nobody asked for) or *unattributed* (the board's own blind spot) rather than credited to the nearest open ask.

Measured against the evaluator's own list of required changes, over all 114 retail requests, the parser finds
**176 of 226 required objects (77.9%)**, mentions **150 of 180 required families (83.3%)**, and reports 235
asks that no required object accounts for — 3.6 lines a task, at 42.8% precision. What it cannot do is stated
rather than hidden: it reads what the request *says*, so a phrase that names no product ("return everything from my
two most recent orders") is settled by its family instead of by a name, and a name the episode never read cannot be
matched at all.

**The instrument to reach for first is the replay**, because it costs nothing and it is what turned R216's
registration around. A result document carries every message of every episode, so any parser can be run over an arm
that already ran:

```bash
python3 eval/tools/goal_board.py --replay eval/results/working-memory/board.json
```

Over R215's own episodes that reported 37.4% of writing episodes ending with a ticked ask — and, read against the
four causes it classifies, said that the round's registered diagnosis (a set phrase that no containment can settle)
was worth **two settlements in a hundred and seven**. The bulk was three other defects: an ask one word short of the
product it names (28 episodes), a contract sealed on a greeting that carried no ask (14), and the account families —
address, payment, transfer — whose receipts carry no item id at all. With those repaired the same replay reports
**69.2%**, and `loose` says how many of the ticks came from the weaker of the two name grades.

The grid is one attempt over 114 tasks with both arms in one seed world, which is the cheapest powered
behavioural design in this lane: a floor near 9 points, against 20 for the 24-task grid every earlier reading
was taken through.

**Result (R216, three arms, 342 episodes, $1.2739).** Control **90/114 (78.9%)**, `front` — the repaired parser at
R215's placement — **99/114 (86.8%)**: **+7.9 pp** [−2.0, +17.6], McNemar p = 0.0784, **15 tasks moved against 6**,
the largest movement this lane has recorded. Attribution in the live arm went from 32.7% to **75.5%** of writing
episodes ending with a ticked ask, against a 60% bar, with `unattributed` falling 62 → 14. The third arm — the same
parser with the block behind the conversation — never reached the model: the provider refuses a system message
inserted between an assistant message's `tool_calls` and the tool messages that answer them, which is what appending
at the end of the conversation does on every turn a call is made. That is fixed, pinned by a test that fails on the
old code, and gated; the placement's own price is still unmeasured. The control itself moved 86.0% → 83.3% → 78.9%
across three dispatches on the same tasks and seed, so **only a within-dispatch contrast is quoted**.

**Result (R215, 228 episodes, $1.1996).** Control **95/114 (83.3%)**, contract **100/114 (87.7%)**: **+4.4 pp**
[−4.9, +13.6], McNemar p = 0.40, fourteen tasks turned over against nine that broke. Two rules changed between
the rounds and both are visible in the counters: the asks come from the request, so the list fell from 10.6 a turn
to **1.96**; and the block can only move when a receipt moves it, so it changed on **23.9%** of turns instead of
essentially all of them, and the bill premium fell from +77% to **+37%**. The registered ten-point bar was not met,
a three-point cache bar was registered and missed by 6.5 (no per-turn block can clear it: 114 of the round's 247
changes are first turns), and only **32.7%** of writing episodes ended with a ticked ask — because a set-phrased
ask cannot be settled by containment. The harm is gone; the lift is not there; the next change is the set rule.

**Result (R214, 228 episodes, $1.4261).** Control **98/114 (86.0%)**, board **92/114 (80.7%)**: −5.3 pp
[−15.0, +4.5], McNemar p = 0.26, thirteen tasks broken against seven moved. The board was served on every turn
and attributed 84 of the 106 changing episodes correctly — and it still lost, for two measured reasons. It is 23
tokens a turn and it raised the bill **77%**, because a system block that is rewritten every turn invalidates the
provider's prefix cache (hit rate 90.4% → 75.1%). And the list grew to 10.6 asks while closing 1.58 of them,
because asks were collected from every user message rather than from the request. The channel's next form is
therefore a **checker** — state written by the write path and emitted only when it changes — which is both the
cheap design and the one the literature's +23.9 describes.

## Repository layout

```
packages/core     the library, behind five subpath exports
packages/protocol the validity gates, paired statistics, artefact schema and lane contract
packages/sql      the text-to-SQL adapter: execution, guards, schema linking, diffs — 1,956 lines
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
pnpm check      # typecheck → lanes → tests → audit → integrity → memform → L0 → L2b → delivery → every reading → study → bundle size
pnpm bench      # study only, writes bench/results/study.json
```

Coverage is enforced at 95% on lines, statements, functions **and** branches. It currently reports
**100 / 99.91 / 100 / 100** over **6,211 tests**; the branch arms that remain uncovered are
listed with file, line, and reason in the internal technical design, and none is excluded with an ignore
comment.

## Licence

MIT.
