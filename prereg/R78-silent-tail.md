---
id: R78-silent-tail
step: R78
opened: 2026-11-11
arms: loo
sample: 1875
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
| questions needed to deliver 346 draws | **1,875** |
| calls at three arms per question | **5,625** |
| wall clock at the measured 15.6 calls/minute | **six hours**, past the job limit |

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

- `n` will be 1,875 and **`loo_targets.given` will be at least 90** of the 105 — the balancer spends each
  draw on the least-drawn target in the pack, so the tail cannot be starved by the hash.
- The plan will be **346 draws short** and the run will deliver about that many, because 18.4% of 1,875 is
  345 and a hit rate that moved would be a statement about the retriever rather than about the plan.
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
