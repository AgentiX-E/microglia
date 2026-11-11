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

## Outcome 0 — void before the first model call (2026-11-10)

Dispatch `42794459960` died one second into the BIRD job at `Resolve the sampling temperature`, the
step R69's iteration added: an apostrophe inside a parameter expansion opened a shell string that
never closed. No model was called, no fold was written. The defect, the reproduction and the checker
that now refuses the whole class are recorded in `R69-pool-width.md` § Outcome 0 — one place, because
it is one bug and this file would be a second copy of it.

The registration is unchanged and the dispatch is repeated.

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

### The instrument gap this registration found, and what closed it

`SOTA_MODEL` was read from a **repository variable**, not from a dispatch input, and the distillation
cache key two steps above the run read the same variable. So a backbone swap was a repository-wide
mutation that every later dispatch inherited, and the cache key moved with it — two backbones could
not be run side by side, and a forgotten variable would silently key a cache on one model while the
lane called another. The same defect shape as the credential: the value existed, the *per-run*
choice of it did not.

It is closed, and the shape it closed in is worth recording because the first design was wrong. Three
inputs — `model`, `endpoint`, `credential` — would have let a caller move the host while leaving the
key behind, which is the defect rather than the fix, and the repository's own workflow linter refused
the file for declaring 28 `workflow_dispatch` inputs against GitHub's cap of 25. The answer is **one**
input, `backbone`, whose vocabulary is closed: empty leaves every published run exactly where it was,
and `zhipu:MODEL` moves the model, the host and the key together. A knob that cannot be set
half-way cannot be set half-way by mistake. `density_panel` moved to a repository variable to pay for
the slot, at the same default it had, so no dispatch that did not set it changes behaviour.

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

## Outcome 1 — the runner killed it a hundred minutes before the lane would have, and wrote nothing

Dispatch `42904695578`, 2026-11-10 21:24 UTC. It spent **2,961 calls over four complete folds and the
fifth fold's evaluation**, and then:

```
2026-11-11T00:45:06Z ##[error]The action 'Run the benchmark' has timed out after 200 minutes.
No files were found with the provided path: eval/results/poc-sota-bird*.partial.json
```

**Two numbers that were the same claim about the same run, and nothing compared them.** The dispatch was
sent with `deadline_min: 300`; the step that runs the benchmark had a literal `timeout-minutes: 200`.
The lane's whole design is that it stops itself *before* the runner does, so that the folds it paid for
are published as a partial artefact — the comment above that step says so, and the number in it (200)
was chosen against the *default* deadline of 130. A dispatch that raises the deadline without raising
the timeout converts the lane's graceful stop into a kill, and the kill discards everything.

**This is a configuration defect, not a measurement**, and it is now structural rather than remembered:

- the step's timeout is `fromJSON(github.event.inputs.deadline_min || '130') + 25`, so the backstop is
  derived from the clock instead of written beside it;
- a new step, `Require a deadline the job can honour`, refuses a dispatch whose deadline cannot fit the
  job's 340 minutes **before the first model call**;
- `scripts/check-workflows.py` gained a fifth rule: a step that reads `SOTA_DEADLINE_MIN` may not carry
  a literal `timeout-minutes`, with a self-test case that reproduces this one. The rule's first version
  looked for the variable in env *values*, found nothing in the file that pays for it, and passed the
  case that was written to fail — the same shape of silent check this repository keeps finding.

**What it cost**: 2,961 calls, no artefact, and the experiment's third attempt gone.

## Amendment 1 — the population stays; the clock moves

**The run was about twenty minutes from finishing when the step timeout took it.** Its own log is the
measurement: fold 3 completed at call 2,263 in 149 minutes, fold 4 at 2,820 in 187 minutes, and fold 5
had finished its evaluation at 2,961 when the runner fired. A fold costs about 530 calls (70 evaluation,
350 draws through the five-sample arms, 70 scoring, ~40 choices), so the fifth fold needed roughly 460
more — **about 3,420 calls and 220 minutes**, against a step timeout of 200 and a job limit of 340.

**So the first instinct — halve the population — is the wrong correction, and it was almost recorded as
the right one.** A registration that resized itself to fit a defect would have halved the population for
a thirty-minute overrun and left the next dispatch to discover that 175 questions buy a share with 1.4×
the interval. The defect is the timeout, it is now derived from the deadline, and the population is
what it was.

**Re-dispatched unchanged except for the clock and the cap**: 350 questions, five folds, three
`sample-5` arms, `deadline_min` 300 (step 325, job 340), `max_calls` **3,700**, `ceiling_calls` **4,800**.

**The cap is 45% lower than the 6,300 the third attempt authorised**, because that number was a forecast
from a plan rather than from a measurement, and the measurement now exists: 2,961 calls bought four
folds and a fifth evaluation. A cap that over-authorises is not free — it is the number the in-run
forecast is compared against, and a bound nobody can approach tells the run nothing about whether it is
on track.

## Outcome 2 — the share travels, and it travels because the baseline fell (2026-11-11)

Dispatch `42935463233`, 00:58 UTC, **3,404 calls, $1.0773** ($0.8691 of it peak, $0.6427 if all
off-peak), 350 questions, 11 databases, five folds, 300-minute deadline, no gate failed.

| arm | accuracy |
| --- | --- |
| `none` — no memory, no draws | 28.86% |
| `full` — one deterministic draw + memory | 28.57% |
| `sample-5-first` | 28.00% |
| `sample-5-exec` — the execution-shape selector | **35.43%** |
| `sample-5-oracle` — best of the five, reads the key | **42.57%** |

Paired against `full`, same questions:

| contrast | R67 (deepseek, 50.86% first) | R68 (glm, 28.00% first) |
| --- | --- | --- |
| `exec − full` | +0.57pp [−2.57, 3.71], p = 0.86 | **+6.86pp [2.86, 11.14], p = 0.0022**, 41 gained / 17 lost |
| `first − full` | −0.57pp [−4.00, 2.86] | −0.57pp [−4.57, 3.43] |
| `oracle − full` | +8.29pp [5.14, 11.71] | **+14.00pp [9.71, 18.29]** |

**The share, intersecting the two artefacts' question ids first** (350 of 350 and 350, `pnpm
eval:width-share --with`, as Amendment 1 requires):

| | R67 | R68 |
| --- | --- | --- |
| first / selected / oracle | 50.86 / 52.00 / 59.71 | 28.00 / 35.43 / 42.57 |
| ceiling `oracle − first` | **8.86pp** | **14.57pp** |
| captured `exec − first` | 1.14pp | 7.43pp |
| share, 95% | 0.13 [−0.27, 0.40] — INCONCLUSIVE | **0.51 [0.33, 0.67] — CAPTURED** |

**The branch is `Baseline-bound`.** Read in the order the refutation block writes them: `first` is
28.00% and the parse rate is 100%, so it is not `Void`; and 0.51 is 3.9× R67's 0.13, which is "at least
twice", so `Baseline-bound` applies before `Selector-bound` and `Transferred` are reached. The published
+17.6pp between DAIL-SQL+SC and CHESS+SC was measured at a 48.6% baseline, and this is the arithmetic
that says so: **a selector that recovers half of a 14.57pp ceiling on a 28% model recovers an eighth of
an 8.86pp ceiling on a 51% one.**

**One leg of that test is weaker than the sentence it produces, and it is recorded here rather than
rounded away.** The "at least twice" comparison is a ratio of point estimates. R67's share has a 95%
interval of [−0.27, 0.40] — it is indistinguishable from zero — so against R67's *upper* bound the
doubling fails (0.51 / 0.40 = 1.28). Against R67's point estimate it holds at 3.9×, and R68's own lower
bound 0.33 clears twice R67's point estimate 0.26. What would settle it is a stronger-backbone share
measured with an interval that excludes zero, which needs a wider ceiling on that backbone — the same
thing R69 already tried to buy and did not get.

### The prediction that failed is the more useful number

| prediction | band | measured | |
| --- | --- | --- | --- |
| second backbone's `first`, against 56.71% | 25–45% | 28.00% | **holds** |
| ceiling `oracle − first` | +30…+50pp | **+14.57pp** | **fails, by half** |
| absolute gain `exec − first` | +5…+15pp | +7.43pp | holds |
| ceiling share within 2× of R67's | 0.03–0.26 | 0.51 | fails (3.9×) |
| parse rate on the weaker backbone | ≥ 95% | 100% | holds |

**Breadth does not get cheaper as the model gets worse; it gets more valuable at a constant rate.** The
registered reasoning was "more failures means more of them are one draw away from being found", and the
band it produced (+30…+50pp) assumed the ceiling grows faster than the failures do. It does not:

| | R67 | R68 |
| --- | --- | --- |
| failures under `first` | 49.14pp | 72.00pp |
| ceiling at five draws | 8.86pp | 14.57pp |
| **ceiling as a share of failures** | **18.0%** | **20.2%** |

Five draws rescue about **a fifth of the failures** on both backbones. The ceiling grew 1.64× while the
failure population grew 1.47× — proportional, not super-linear. So the widening is not where the
difference lives; the difference is entirely in how much of the widened ceiling a selector can *find*,
and that is 13% at a 51% baseline against 51% at a 28% one. A weaker model's wrong answers are wrong in
more distinguishable ways, not merely more numerous.

### What this changes

`Selector-bound` would have sent the next registration to a better selector. `Baseline-bound` sends it to
the **ceiling**, and the two ceiling levers already have readings: width saturates (R69: k = 10 bought
+2.00pp of ceiling over k = 5 for twice the calls, and `sample-10-exec` came in *below* the first draw),
and **temperature has never been measured at all** — `R70-temperature` is registered and unspent. So the
next dispatch is R70, not another selector.

**One instrument caveat, recorded because it is a property of this run and not of the design.** The glm
lane timed out **118 calls** and retried 135, against **0** on the deepseek lane; 6 calls failed outright
and are scored wrong for every arm. That cannot favour one arm over another, but it can compress the
difference between them, so the +6.86pp is if anything an underestimate.
