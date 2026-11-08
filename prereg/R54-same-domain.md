---
id: R54-same-domain
step: R54
opened: 2026-11-08
arms: memory,reference
sample: 200
gates: V1,V2,V3,V5,V6,V7,V8,V32,V44
recallFloor: 0
facadePair: off
trainDomain: retail
testDomain: retail
recallDomain: retail
---

# R54 — R51's three predictions, run in the configuration they were written for

**Registered** 2026-11-08, dispatchable. R51 is closed as ABANDONED by its own readback;
this is the same mechanism measured where its predictions are answerable.

## What R51 actually measured

The dispatch inherited `TAU_TEST_DOMAIN=airline` from a repository variable set for the
transfer arm, so a store distilled from **retail** answered **airline** questions while
recalling under **retail**. Two of R51's three mechanism predictions held anyway and one
could not:

| Prediction | Registered | Measured (retail → airline) |
| --- | --- | --- |
| `store.conditioned` | at least 4 of the servable items | **16 of 16** (R49: 0 of 10) |
| `empty / requests` | at most 0.25 | **0 of 1,527 = 0.000** (R49: 0.379) |
| coverage p50 | at least 12% | **4.88%** (R49: 4.7%) |
| mean pack | 1.4–2.4 rules | 1.222 |
| `l4-paired` | no revert branch | UNRESOLVED at −2.00pp, MDE 18.59pp |

The third prediction fired its refutation ("the pack fills on scope alone, with no topical
gain") and R51 is abandoned as registered. But the coverage of retail rules against airline
questions is a measurement of *transfer*, not of relevance, and a 12% prediction about the
latter cannot be refuted by the former.

**And one correction this readback forces on the record.** R49's "38% of requests were served
an empty pack" is not a write-path or recall defect: R49 ran `minCoverage 0.01`, and its own
retention curve says that floor emptied 571 packs of 1,516 while the as-is facade served
1,435 of 1,527. R51, at floor zero, served every request. The emptiness was the floor under
test, and the account in AUDIT 34.48 that attributed it to missing conditions is wrong in
that respect. The conditions were missing — 0 of 10 — but they were not what emptied the
packs.

## The one variable

The scenario pair, pinned in this header and read by the workflow into
`TAU_TRAIN_DOMAIN`/`TAU_TEST_DOMAIN`/`TAU_RECALL_DOMAIN`. Everything else is R51's
configuration: floor 0, 4 trials, one store, one reference arm, the same 200-episode budget.

## Prediction

- `store.conditioned` at least 4 of the servable items, and the artefact's `storeItems`
  sample carries the conditions in words so the register can be read rather than counted.
- `empty / requests` at most 0.25, against 0.000 in the transfer configuration.
- **Coverage p50 at least 12%.** This is the prediction R51 could not test. If it fails here
  as well, the distiller is writing triggers in the procedure's register rather than the
  user's, and the next registration is about the prompt rather than about retrieval.
- Mean pack 1.4–2.4 rules per request.
- No revert branch fires. At an MDE of 9–18pp no finer accuracy claim is made, in advance.

## Refutation

- **If the artefact's `scenario` block does not read retail/retail/retail**, the dispatch
  measured a different experiment; it is discarded, not reinterpreted. The configuration is
  now in the registration precisely so this cannot happen twice.
- **If coverage p50 is below 12% with the pair at 0.000 empty**, the conditions exist and do
  not name the situation: the write path produces prose that no question matches, and the
  line of work moves from retrieval to the distiller's prompt.
- **If p50 reaches 12% and the empty share rises above 0.25**, recall and the register
  disagree — the conditions name situations, and the query is not what I think it is.
- **If `storeItems` is absent from the artefact**, the run cannot say what was written and
  certifies nothing about this stage.
- **If `l4-paired` reports HARM**, the R45 revert rule fires on the reading and the
  condition-carrying write path is reverted, as R51 said it would be.

## Implementation Amendment (2026-11-08, during the run, before any readback)

Two things the registration left to prose, recorded here while the dispatch is in flight and
before any artefact exists. Neither changes a threshold; both remove a choice a reader could
otherwise make after seeing the data.

**1. "Coverage p50" is the median over the non-zero pairs.** The graded field is
`tau2.coverage.nonzeroQuantiles.p50`, which is what `eval/verifiers/r51_readback.py` read for
R49 (4.7%) and R51 (4.88%) and what `eval/verifiers/r54_readback.py` now grades this run
against. Naming it matters because the artefact also supports a second median that is roughly
half as large: R47's committed histogram carried 750 zeros in 2,188 injected pairs, so the
median over **every** delivered pair is that population's 24th non-zero percentile, about
0.027. The two are not interchangeable, and a reader holding both could pick the subject of the
claim at read time.

**2. The delivered-pair median is not committed by this run, and is not graded.** The zeros
were delivered — the model saw those rules — so the median over all pairs is the number that
describes the delivery, while the non-zero median describes the survivors a floor would act on.
From the commit that follows this one, `coverage.medians` carries both. This dispatch predates
it, so its verifier prints the delivered-pair median as *not recoverable* rather than as zero,
and grades nothing on it. The 12% bar stays on the quantity R49 and R51 were read against, so
the three readings remain comparable; a future registration that wants the delivered-pair
median must register it, and must register a bar for it.

One consequence worth stating in advance, because it is the reason the second median is now
committed at all: a delivery that is eight-tenths unrelated **can** clear a non-zero median bar,
since the survivors are by construction the related ones. If this run's p50 clears 12% while its
delivered-pair median sits near zero, prediction 3 is met and the mechanism is only half
described — the conditions name situations, and most of what was served did not. That reading is
not a refutation of this registration; it is the registration that the next one should be
written against.
