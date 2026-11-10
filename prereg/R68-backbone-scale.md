---
id: R68-backbone-scale
step: R68
opened: 2026-11-10
arms: sample-5-first,sample-5-exec,sample-5-oracle
sample: 350
gates: V1,V2,V3,V4,V5,V6,V7,V8,V12,V32,V44,V48,V51
---

# R68 — the gap to the published pipelines might be the baseline, not the scaffold

**Registered** 2026-11-10, undispatched, and it depends on R67 having been dispatched first. **Two
dispatches from the start** (Rule 13).

## Why this file exists

The comparison this project keeps being asked about is a 7B model: DPC's re-runs put
**Qwen2.5-Coder-7B at 48.6% with DAIL-SQL+SC and 66.2% with CHESS+SC on BIRD**, while this lane
reads **58.02%** on the same benchmark with a single deterministic prompt. Read as three numbers on
one axis, that says a small model with somebody else's scaffold is 8.2 points ahead of us. Read as
three numbers on one axis it also says something the record has never tested: the 17.6 points
between DAIL-SQL+SC and CHESS+SC were bought at a **48.6% baseline**, and R64 already proved in this
repository that a per-failure mechanism's absolute yield is set by how many failures there are —
"an arm that repairs a fifth of its population moves a 30%-accurate model by six points and a
57%-accurate model by one" is the same arithmetic, read from the other end.

So there are three live explanations for the 8.2 points and they are not distinguishable from the
published rows, because those rows vary the scaffold **and** the backbone **and** the judge at once:

- **scale** — our backbone is stronger and our scaffold is weaker, which nets to +9.4pp over their
  prompting baseline and −8.2pp under their pipeline;
- **scaffold** — CHESS's 17.6 points are a property of candidate generation plus unit-test
  selection, and any backbone carrying that scaffold clears 66;
- **baseline** — most of those 17.6 points are what a 48.6% baseline buys, our 58.02% baseline has
  less to buy, and the "deficit" is an artefact of comparing absolute points across baselines.

The comparable quantity is not points. It is the **share of the pool ceiling that selection
recovers**, `(sample-5-exec − first) / (sample-5-oracle − first)`, which R67 measures on this lane's
default backbone and which this registration measures on a second one. If that share travels, the
mechanism is real and its absolute yield is a function of the baseline. If it does not travel, the
published gap is a baseline effect and chasing it with a better selector would be chasing the wrong
variable.

**What this cannot be.** It is not a replication of the DPC row. There is no credential and no
hosting here for Qwen2.5-Coder-7B, and the artefact must not be read as one. What it is: a **scale
ladder on one host**, three arms, the same 350 questions, the same five folds, the same judge — one
variable moved, which is more than the published rows can say.

## The design, exactly

- The three arms are R67's, unchanged: `sample-5-first` (one draw kept as the honest baseline),
  `sample-5-exec` (execution-consistency selection), `sample-5-oracle` (the pool's ceiling).
- **The only thing that changes is `SOTA_MODEL` plus `SOTA_API_KEY`** — the credential variable that
  did not exist until this iteration, which is why the confound survived this long. The prompt, the
  temperature, the schema text, the folds and the judge are byte-identical to R67's dispatch.
- The second backbone is the smallest one the host serves, chosen for cost rather than for
  prestige: this registration is measuring an invariance, and an invariance test that costs as much
  as the effect it licenses is not worth running.
- `model_credential` and `model_endpoint` in the artefact are what make the two dispatches
  separable six weeks from now. A backbone-swapped run whose credential label reads `deepseek` is a
  run that pointed at another provider's host with this host's key, and `planCredential` refuses to
  start it.
- Cost, stated before the run: 350 questions × (1 + 5 + 5) draws ≈ 3,850 calls per dispatch, two
  dispatches, no new harness code. R67's three arms are the reference row and are not re-bought.

### The instrument gap this registration found before it could be dispatched

`SOTA_MODEL` is read from a **repository variable**, not from a dispatch input, and the distillation
cache key two steps above the run reads the same variable. So a backbone swap is currently a
repository-wide mutation that every later dispatch inherits, and the cache key moves with it — which
means two backbones cannot be run side by side, and a forgotten variable would silently key a cache
on one model while the lane calls another. That is the same defect shape as the credential: the
value existed, the *per-run* choice of it did not. A `model` input on the workflow, with the secret
that pairs with it, is the work that has to land between this registration and its dispatch, and it
is listed here rather than discovered after a wasted run.

## Prediction

- **The second backbone is much weaker on `first`**: 25–45% against this lane's 56.71%, which is the
  point — the ladder needs a baseline far enough below ours for the arithmetic to differ.
- **Its pool ceiling is much larger**: `sample-5-oracle − first` at **+30…+50pp**, against R67's
  prediction of +10…+25pp on the stronger backbone. More failures means more of them are one draw
  away from being found.
- **Its absolute selection gain is larger and its ceiling share is similar**: `sample-5-exec −
  first` at **+5…+15pp**, and a ceiling share inside a factor of two of R67's. This is the
  prediction that makes the experiment worth its cost — if it holds, absolute points across
  baselines are not comparable and never were.
- **The instrument, predicted too**: parse rate ≥ 95% on the weaker backbone, or the arm's failure
  is a formatting failure wearing a capability costume and the run is void rather than negative.

## Refutation

The branches **partition** the space (Rule 12): they are ordered, they cover every value, and the
first one that applies names the outcome.

- **Void** — the weaker backbone's `sample-5-first` arm fails `V3-parse-rate` or scores under 25%,
  so there is no ladder to compare. Then the model was too small to answer in this lane's output
  format, the registration produced no estimate, and the next attempt needs a backbone in between
  rather than a reinterpretation of this one.
- **Baseline-bound** — pooled ceiling share at the second backbone is **at least twice** R67's
  pooled share. Then the published +17.6pp is mostly what a low baseline buys, the 8.2-point gap is
  not a scaffold deficit, and the next registration targets the **ceiling** (pool width,
  temperature, decomposition) rather than the selector.
- **Selector-bound** — both shares are **under 20%** of their own ceilings. Then selection is weak
  everywhere, width is not the binding constraint on either backbone, and the next registration is
  a selector — outcome-reward or execution-signature ranking — on a pool that already contains the
  answer a third of the time.
- **Transferred** — otherwise. The shares agree within a factor of two and at least one clears 20%,
  so execution-guided selection is a mechanism whose efficiency travels even though its absolute
  points do not; it becomes the product's default generation mode, and every future comparison
  against a published pipeline is quoted as a share of ceiling rather than as points.

The branches are applied in the order written: the first one whose conditions hold names the
outcome, and any estimate that fits none of the four is impossible by construction.
