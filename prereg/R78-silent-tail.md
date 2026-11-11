---
id: R78-silent-tail
step: R78
opened: 2026-11-11
arms: loo
sample: 1900
offset: 2000
temperature: 0
looTargets: eval/manifests/loo/R77-silent-tail.json
gates: V1,V2,V3,V4,V5,V6,V7,V8,V12,V32,V44,V48,V51
---

# R78 — the silent tail gets its draws, and the arithmetic says not with this arm

**Registered** 2026-11-11, **undispatched**, and this file exists to record why the obvious dispatch is
the wrong one.

## What it would test

R77 measured **55.73% inert pairs at T = 0** and, inside that, **113 of 472 rules that never changed an
answer on any draw they got**. `silenceReading` then priced the silence against the rate the rules that
*fired* demonstrated — 49.9% per draw — and found that **38.2 of the 113 are what chance produces**, so
the dead weight that survives is **74.8 rules, 15.9% of the pack**, not 23.9%. It also found that **105
of the 113 hold fewer than five draws**, the count at which silence at that rate happens less than once
in twenty.

The experiment is therefore a top-up, not a pruning: give those rules the draws they are short of and ask
which of them fire.

## The arithmetic that stops it

The plan is generated and committed: **105 rules, 346 draws** (`eval/manifests/loo/R77-silent-tail.json`).
The lane can only deliver a planned draw when the question's pack happens to contain one of the plan's
rules, and R77's own artefacts measure how often that is:

| reading | value |
| --- | --- |
| questions with a non-empty pack | 2,000 |
| mean rules per pack | **1.83** |
| packs containing any plan rule | **369 — 18.4%** |
| questions needed to deliver 346 draws | **1,875 — one short, see Amendment 1** |
| calls at three arms per question | **5,625** |
| wall clock at the measured 15.6 calls/minute | **six hours**, past the job limit |

> **The wall clock is wrong, and it took the dispatch with it.** 15.6 calls/minute is R68's
> `zhipu:glm-4.7-flashx` rate. This lane's own backbone has measured **248** calls/minute on the same
> split, which puts this dispatch at **37 minutes**, not six hours. See Amendment 1: the arithmetic
> below still stands, the sentence it was used to support does not, and the experiment is dispatched.

So the plan is deliverable and the population it needs is **five times R77's own**, because the retriever
offers 1.83 rules per question and the rules that are short of draws are short *precisely because they
are rarely recalled*. That last sentence is the finding, and it reframes the question: **a rule that is
never recalled cannot be measured by withholding it from a pack it is not in.**

## What would fit: force-recall, and why it is not this dispatch

The measurement the tail needs is not "what happens when r is removed from a pack that contains it" but
"does r change the answer to a question it is relevant to". Those differ only for rules the retriever
never offers, which is the whole tail. Constructing that pack — normal recall, then r added — costs
**two calls per pair** and needs no larger population:

| design | pairs | calls | needs |
| --- | --- | --- | --- |
| targeted `loo` over a larger population | 346 | **5,625** | nothing new |
| force-recall `plant-r` against the pack it was added to | 346 | **692** | a new arm and its gates |

**So this registration is a decision not to spend 5,625 calls on the wrong instrument**, recorded with the
numbers that make it a decision rather than a preference. The plan file, the parser that refuses a
malformed one, and the `targetedLooIndex` balancer are all in place and tested; they are what a future
arm will use, and the `loo` arm's own hash remains the right choice for every question that is not a
top-up.

## Prediction

- `n` will be 1,900 and **`loo_targets.given` will be at least 90** of the 105 — the balancer spends each
  draw on the least-drawn target in the pack, so the tail cannot be starved by the hash.
- The plan will be **346 draws short** and the run will deliver about that many, because 18.4% of 1,900 is
  350 and a hit rate that moved would be a statement about the retriever rather than about the plan.
- The reading over the union of R77's draws and this dispatch's will put the wholly-inert count **between
  38 and 75**: below 38 the working-rule rate is wrong, and above 75 the excess was real.

## Refutation

- **If `loo_targets.given` is 0**, the registration's `looTargets` did not reach the lane, and the run is
  R77's design at a larger population wearing a plan's name.
- **If the artefact's `config.loo_targets` is null**, the plan was read from somewhere other than the
  header and the artefact cannot say what it bought.
- **If the inert count lands below 30** on the union, the 74.8 excess was chance and the pack has no dead
  weight to prune — which would be the strongest result this axis has produced, and the opposite of the
  one the file was written to test.

## What this file does not do

It does not prune. Nothing is deleted from the store on the strength of 55.73% or of 113 silences: 105 of
those rules have not been drawn five times, and a pruning on that evidence would be a pruning on the
absence of a measurement.

R77's Amendment 4 then narrowed what this dispatch can be *for*. The excess is 74.8 rules with a 95%
interval of **72.5 – 77.1**, so the count is no longer the question: dead weight exists, it is 15.4% to
16.4% of the pack, and a dispatch that returned a number outside that band would be a statement about the
working rate rather than about the pack. What the interval cannot say is **which** rules, and a pruning
needs identities. That is the whole remaining job here, and it is why 9,200 calls are being spent to move
105 rules from "silent on one to four draws" to "silent or live on five".

## Amendment 1 — the wall clock was the other backbone's, and the population was a prefix

**Written 2026-11-11, before dispatch.** The section above concludes that this experiment costs six
hours and cannot be run. Every number in its table is right except the last row, and the last row is
the one the conclusion rests on.

### The rate belonged to a different model

`15.6 calls/minute` is measured on `zhipu:glm-4.7-flashx`, the backbone R68 dispatches. This lane
runs `deepseek-flash`, whose rate is in R77's own job: 6,946 calls between 23:27 and 23:55, which is
**248 calls/minute**. The two differ by 16×, and the error has a shape worth naming: a throughput
figure was carried from one experiment to another because both were "this repository's BIRD lane",
which is exactly the kind of borrowing that a cache key, a provider or a concurrency setting makes
false without anybody editing a number.

| reading | value |
| --- | --- |
| R77's model calls | 6,946 |
| R77's model window (23:27:00 → 23:55:45) | 28.7 min |
| measured rate on `deepseek-flash` | **248 calls/min** |
| this dispatch's calls (5,700 evaluation + ~3,500 learning on new questions) | **9,200** |
| wall clock at the measured rate | **37 min** |

37 minutes against a 340-minute job with a 300-minute self-stop. **The dispatch is not stopped by its
clock, and the file's stated reason for not running it was a number from another experiment.**

### The population was a prefix, which is why the offsets exist

`SOTA_LIMIT` could only take the first N questions of the corpus. R77 took questions 0–1,999, so a
"larger population" written as `n = 1875` would have scored **1,875 of the same 2,000 questions** and
re-bought every (rule, question) pair it already held: at temperature zero the same pack and the same
withheld rule are the same call, so a re-draw is a call that cannot return new information. The
top-up needs questions R77 never saw, and the lane had no way to name them.

`offset` now exists, in the header and in the lane and compared between them:

- the corpus this split can score is **7,829** questions (`[sota] selection: 7829 of 9428` in R77's
  log, 58 databases);
- R77 scored `offset = 0`, `n = 2,000`;
- this dispatch declares `offset: 2000`, `n: 1900`, so questions 2,000–3,899 — **zero overlap with
  R77** and 3,954 questions still unused behind it.

The hit rate carries over unchanged, because it is a property of the retriever and the rules rather
than of which questions those are: 18.45% of 1,900 is **350 draws**, which is exactly the plan.
The predictions above stand.

### The plan's own sizing was one draw short

The original table says 346 draws need **1,875** questions. They do not: 1,875 × 18.45% = **345.9**, which
floors to **345** against a plan that needs 346, and the difference between 345 and 346 is the difference
between a plan that is fully bought and one that is not. A test now asserts the inequality directly —
`floor(sample × 369 / 2000) ≥ 346` read from this file's own header — rather than trusting the sentence
that quotes it, because this is the second time in two days that a number in a registration was right
about its method and wrong about its arithmetic by one unit.

`n = 1,900` buys 350 draws: four spare against a hit rate that may move by a few tenths, and 5,700
evaluation calls rather than 5,625.

### What the correction does not change

The force-recall design `plant-r` is still cheaper per draw (692 calls against 5,625) and still the
right instrument for a rule the retriever never offers. It is **not** this dispatch, for a reason the
amendment makes sharper rather than weaker: `plant-r` would have to decide *which* question a tail
rule is relevant to, and the only evidence for relevance is that the retriever offered it — which is
the question being asked. The `loo` arm asks it without that circularity, on questions where the
retriever did offer the rule, and the price of asking it cleanly is 5,625 calls and 37 minutes.

### Cost

R77 spent **$0.531** on 6,946 calls, 70.5% of them cache hits. At the same per-call price and the same
learning-cache behaviour, 9,200 calls is **≈ $0.71**. The budget is set to 10,000 with a ceiling of
11,000, so a cache that misses more than R77's fails on the ceiling rather than on the runner.
