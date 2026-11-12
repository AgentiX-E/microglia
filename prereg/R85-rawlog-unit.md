---
id: R85-rawlog-unit
step: R85
opened: 2026-11-12
arms: memory
sample: 228
gates: V1,V2,V3,V5,V6,V7,V8,V32,V44
recallFloor: 0
facadePair: off
trainDomain: retail
testDomain: retail
recallDomain: retail
distillUnit: raw
distillScope: edited
---

# R85 — the store is the episode itself, because two preprints say the abstraction is the defect

**Registered** 2026-11-12, dispatchable. R58 is read and it is `NO_MEASUREMENT` on the recurrence axis
and informative on another: its trace store served a pack whose **median non-zero coverage was
10.53%, and eleven of its fifteen distillation calls faulted. R86 is
dispatched to say which code they threw. This registration is the arm that answers the question
neither of them asks, and it is the one the literature has already answered twice.

## Why this arm, and why now

`More Memory, Worse Agents` (Indiana University / Tencent HY, 19 Oct 2026) measured stored lessons at
**49.0%** against raw logs at **53.5%** across nine settings, and per-task guidance built from the
logs and discarded after use at **59.9%**. Stored lessons lost to plain logs in seven of nine
settings. `Memory Tax` (UIUC / Tsinghua / RUC) normalised eleven memory systems by retrieval scope and
found **two** beating single-round RAG while two-round RAG over raw history scored **90.0%** against
all eleven.

Both papers name the same mechanism as this lane's own weakest number. A distilled claim is a
statement *about* a class of requests, and the retriever that serves it is lexical: coverage measures
the share of the question's content words the pack contains. `Exchange a delivered order for a
different size` shares no word with `the shoes in W237 are too small`. The lane does not gate on that
overlap — every registration here fixes `recallFloor: 0`, so the pack carries what is servable and
coverage is measured — which makes the reading a statement about the text the model read rather than
about an item a filter removed. It is the same fact one step further from the effect, and it is the
fact a floor would act on.

This arm changes **one** variable: what the store is made of. Same corpus, same split, same admission,
same recall floor and budget, same model, same four trials. The write is a record — question, calls,
arguments — and it calls no model at all.

## Prediction

- **The store is made of records, and says so.** `distillUnit.unit = raw`, `rawlog.records ≥ 1`,
  `rawlog.toolBan = false`, `distillForm.form = record`, every sampled item `kind = exemplar` with a
  statement opening `Q: `, and `distillUnit.consolidation` **absent** — a claim-merging pass over a set
  of records produces a record neither episode wrote.
- **The write costs no model call.** `learning.events = learning.candidates` (the interpreter answers
  every correction), `learning.dropped` empty, and `learning.llmFailed = 0` — not "no fault was
  recorded" but "no call was made", which the end-to-end test asserts against a `fetch` that throws.
- **Faithfulness is at least 0.95.** Records keep their own argument values by construction, so the
  only loss is the ceiling, and `rawlog.clipped` counts it. A number below 0.95 refutes the arm's own
  claim to be a record rather than a summary of one.
- **Coverage clears the bar it failed at.** Median non-zero coverage **≥ 12%**, against R58's
  **10.53%** on the same corpus at the same setting (`recallFloor: 0`: measured, not enforced). This
  is the prediction the mechanism stands or falls on: if records do not share the question's words
  either, then lexical overlap was never the constraint and the two papers' finding does not transfer
  to this corpus.
- **`pass^4` does not fall below the published 0.575.** A lift is reported with its interval and not
  claimed at n = 57 (the registration prices the half-width at 19.66pp before the run, as R58 did);
  what is claimed is the direction and the two intermediate measurements above, which are the ones
  that can be read at this sample.
- **Retention is reported beside the delta**, from `per_trial`, and quoted against R58's 0.881 as a
  stability reading rather than against the in-episode 0.88 / 0.65 as an accumulation reading.

## Refutation

- **The arm did not run**: `rawlog.records = 0`, or the funnel's `servable = 0`. Then nothing below it
  is read, and the failure is named by layer rather than reinterpreted — the same rule R58's readback
  now enforces for the model.
- **Faithfulness < 0.95**: the ceiling is clipping records, and the next variable is the ceiling, not
  the unit. A clipped record is a summary written by `slice`, and this arm would then be measuring a
  different abstraction rather than the absence of one.
- **Coverage < 12% with records in the store**: lexical overlap was never the constraint. The two
  papers' finding would then be about *their* corpora — ALFWorld, WebShop, ScienceWorld, τ²
  question-answering — and not about a τ² agentic retail lane, and the next registration is about the
  retrieval function rather than the object.
- **`pass^4` below 0.575 by more than the interval**: records hurt, and the honest conclusion is that
  the abstraction was doing work the preprints' corpora did not need it to do. The revert is the unit,
  and the follow-up is the one variable left: whether the abstraction is better *narrowed* (R56's
  ban) or *wider* (this arm) — which a third arm cannot answer, so the line would move to the
  in-episode corpus instead.
