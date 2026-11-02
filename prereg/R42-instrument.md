---
id: R42-instrument
step: R42
opened: 2026-11-02
arms: memory,reference
sample: 200
gates: V1,V2,V3,V5,V6,V7,V8,V15,V16,V17,V32,V33,V44
---

# R42 — the store the memory arm never built

**Registered** 2026-11-02, before the dispatch that measures it. **Stage**: the re-run R41 needs
before any transfer number can be read (`AUDIT` §34.14, `PROGRESS` §157).

## What R41 found, and why it is a round rather than a footnote

R41 graded four transfer gates on a scenario they were not written for, and three of them passed. It
also reported `V1-pack-not-empty` at **0.00 rules/question**: the memory arm's store held no
knowledge when evaluation began, so every recall returned nothing and the arm called `memory` was the
reference arm with an HTTP façade in front of it.

The dispatch could not say *why* the store was empty, and that is the defect this round is about. The
driver held three readings that would have said why — the distiller's own report, the model client's
call tally, and the store's admission counts — and wrote none of them into the artefact. Two gates
that read exactly those readings (`V32`, `V8`) were therefore **absent** on the one dispatch where
they would have fired, and the gate that reconciles the store's ledger (`V44`) passed on `0 <= 0`.

The evidence, from the committed R41 artefacts and the job log:

| reading | value | where it came from |
|---|---|---|
| `tau2.meanPackIds` | **0** | the facade's served packs, 200 requests |
| `tau2.domainOrigin.storedWithDomain` | **0** | the store, after distillation |
| `tau2.learning` | **absent** | the driver discarded `DistillReport` |
| `tau2.calls` | **absent** | the driver discarded `LlmClient.stats` |
| `V44-domain-accounted` | **pass** | `0 <= 0 + 0` |
| learn phase | 32 tasks, 1 trial, ~7 min | job log |
| eval phase | 50 tasks, 4 trials, ~39 min | job log |

## The cause, as far as the code can be read

Three defects, one of which empties the store and two of which hide it.

1. **The distiller's model is a router name.** τ²'s Python half is a litellm caller, so the lane names
   its model `deepseek/deepseek-chat` (`TAU_MODEL`). The TypeScript client that distils the
   corrections posts the same string to `api.deepseek.com/chat/completions`, whose `model` field is
   `deepseek-chat`; the prefixed form is refused with a 400 on every call. Thirty-two corrections,
   thirty-two refusals, nothing stored.
2. **A refused request was not a failed prompt.** `LlmClient` counted a failure only when four
   attempts had been spent. A 400 is not retried, so the tally read `prompts: 32, failures: 0` — the
   strongest reliability claim available, made about thirty-two refusals.
3. **The composition was called a fallback and was not one.** `combineInterpreters` runs every
   interpreter and stops at the first that throws, so the rule interpreter that would have produced a
   negative lesson for each correction never ran. Its docstring called the second argument a
   "generic fallback", which is what the lane read.

## The claim under test

> A memory arm whose store is empty is a measurement of the instrument, not of the memory; once the
> instrument is repaired the same arm reports a non-empty store, and the transfer reading it
> produces is either a number about the mechanism or a stated absence — never a number about nothing.

## Prediction

- **`V1` passes**, at a pack the artefact records. The prediction is not "the pack helps"; it is that
  a store built from thirty-two corrections and recalled under its own scenario serves something.
- **`V32` fires for the first time in this lane, and passes.** At most a tenth of the corrections may
  fail to distil; the round's own arithmetic says zero should fail once the model answers.
- **`V8` fires on the distillation tally, and the artefact says whose tally it is.** `calls.scope` is
  `distillation` because the episodes' calls belong to another process, and a rate over a subset is
  reported as one.
- **`V44` fires on a non-empty store and passes**, which is the same reading as `V1` from the other
  end: items exist, and every item that has no domain arrived without one or lost it to a widening.
- **The audit's index does not move**: supplyable 13, arm-indexed 26, and the fired set gains exactly
  `V8` and `V32` — 11 → 13 evaluable, 28 → 26 absent.
- **`V16` still fails.** A hundred informative episodes was beyond R41's sample and nothing in this
  round changes the sample. A pass here would mean the floor is being cleared by episodes that are
  not informative.
- **The transfer net stays at or below +5pp, and the sign is not predicted.** With a non-empty pack
  the reading becomes interpretable for the first time: R41's −5.00pp was a foreign pack that
  carried nothing, which is the control condition wearing the treatment's name.
- **`l4-paired` still fails at this sample size**, and `V5` still fails: 50 tasks resolve 16.81pp,
  and the pair's interval cannot separate a 10pp effect from zero. That is a property of the sample,
  registered in R41, and unchanged here.

## Refutation

- **If `V1` still fails**, the model name was not the cause. The artefact now carries the three
  readings that separate the candidates, and the next audit reads them rather than guessing:
  `learning.events` counts the feedback the distiller saw, `learning.candidates` counts what the
  interpreters produced, and `learning.distilled` counts what the store kept. Zero candidates is an
  interpreter; candidates without items is the store's admission.
- **If `V8` still reports zero failures on a store that is empty**, the client's accounting is still
  wrong, and the round reverts the reliability claim rather than publishing a rate over nothing.
- **If the run stops instead of finishing**, that is the intended behaviour and a better outcome than
  R41's: `host.distill` is now called with a `fatal` predicate, so a provider that has stopped
  answering, a spent budget, an expired deadline or a refused key ends the run at distillation rather
  than after an hour of evaluation on an empty store. The pair artefact is then absent, and the job
  log carries the code.
- **If the fired set gains a gate outside `V8` and `V32`**, the projection is reading a field nobody
  wrote and the round reverts the projection, not the report.
- **If four-dimension coverage falls below 95%, or `tau2-distill.ts` / `model-client.ts` is not at
  100**, the round does not ship: the arithmetic it turns on is the arithmetic those modules perform.

## What would make this round worthless

Reading the new pack's effect as a transfer measurement. The pack is non-empty only if the
distillation worked, and the distillation is a model call: a comparison between "a pack of distilled
procedures" and "no pack" at 50 tasks still cannot resolve an effect below 16.81pp, which is the
number `V5` prints. The round's deliverable is the instrument — an arm whose store can be inspected,
whose failures are counted, and whose empty state is a failure of a named gate rather than a footnote
on a null.

The second risk is the fallback. A model that fails per event now falls back to the rule interpreter,
which produces a negative lesson rather than a procedure. That is a *different treatment*, so the
count is recorded (`learning.llmFailed`) and `V32` reads the failures that produced nothing at all; a
run whose every correction was answered by the fallback is a run whose pack is generic, and the
artefact says so before a reader has to infer it from an effect size.

## Cost

One τ² dispatch through `sota.yml`, the same scenario pair, the same split floor, the same
thirty-two-task learn half and whole airline evaluation set at four trials. No new dataset, no new
model family, no change to the merge gate.
