# microglia

**A feedback data flywheel for agentic workflows, as a library.**

`microglia` turns the corrections a user makes — a re-picked chart, an edited SQL statement, a
thumbs-down with a reason — into scoped, evidenced knowledge that the same application recalls on
the next request. It ships no UI, opens no socket, and requires no service. It runs on a CPU or in a
browser.

```ts
import { openMicroglia } from '@agentix-e/microglia-capture';
import { EmbeddedMemory, JsonlJournal } from '@agentix-e/microglia-memory';

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

## What is in the box

| Package | Role | Runtime dependencies |
|---|---|---|
| `@agentix-e/microglia-core` | Domain model, admission policy, statistics, guards | none |
| `@agentix-e/microglia-memory` | Embedded JSONL store, lexical index, port | none |
| `@agentix-e/microglia-capture` | The host-facing SDK: `begin`, `feedback`, `distill`, `export` | core, memory, distill, apply |
| `@agentix-e/microglia-distill` | Rule interpreter, LLM interpreter, generalisation | core |
| `@agentix-e/microglia-apply` | Prompt pack construction, MMR, budget, rendering | core, memory |
| `@agentix-e/microglia-nl2charts` | Reference domain pack: chart-type corrections | core |
| `@agentix-e/microglia-cortex-adapter` | Projection into `@agentix-e/cortex-*` memory values | core |
| `@agentix-e/microglia-eval` | Ablation study, gates, statistical harness | all of the above |

Import only what you need: `core` has zero dependencies and is browser-safe, so a front-end can
build a pack without pulling the store or the distiller.

## Install

```bash
pnpm add @agentix-e/microglia-capture @agentix-e/microglia-memory
```

Node 20 or newer. ESM only. No native modules, so it bundles for the browser unchanged.

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

Every number is reproduced by `pnpm bench` and written to `bench/results/study.json`; seventeen gates
must pass, or the build fails.

Read the [user guide](docs/USER-GUIDE.md) for the integration contract, the
[architecture](docs/ARCHITECTURE.md) for how the pieces fit, and the
[glossary](docs/GLOSSARY.md) for the vocabulary.

## Repository layout

```
packages/     eight packages, layered core → memory → distill → apply → capture
poc/          live-API experiments (DeepSeek, Zhipu) with recorded artefacts
bench/        the ablation study and its gate report
scripts/      the quality audit that CI runs
docs/         user guide, architecture, glossary
```

## Development

```bash
pnpm install
pnpm check      # typecheck → tests with coverage gates → quality audit → study
pnpm bench      # study only, writes bench/results/study.json
```

Coverage is enforced at 95% on lines, statements, functions **and** branches. It currently reports
100 / 99.42 / 100 / 100 over 376 tests; the seven branch arms that remain uncovered are listed with
file, line, and reason in the internal technical design, and none is excluded with an ignore comment.

## Licence

MIT.
