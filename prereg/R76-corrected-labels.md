---
id: R76-corrected-labels
step: R76
opened: 2026-11-10
arms: full
sample: 283
gates: V1,V2,V3,V4,V5,V6,V7,V8,V12,V32,V44,V48,V51
---

# R76 — the corrected labels, on a real dispatch rather than a re-scoring

**Registered** 2026-11-10. `minidev`, 283 scoreable questions, `gold: corrected`. **≈916 calls
projected, ceiling 2,490** (`pnpm eval:budget --bird poc-sota-bird-R74-rule-causal.json --arms
none,full --questions 283 --learn 0`), **≈$0.20**.

## Why this file exists

R75 re-scored fourteen artefacts against the corrected labels, and its amendment split that population
in two: **283 questions the correction relabels and 67 whose text it rewrote**, because BIRD shipped
Mini-Dev revisions after the `v1-2024-06-20` this repository pins and the correction was built on a
later one. On the 283 the baseline is **62.69%** under the pinned labels and **59.64%** under the
corrected ones; the mixture reported **54.02% → 51.26%**, because the 67 mis-paired rows score 14.93%
and 16.31% and drag both arms down by seven points.

That reading came from re-executing statements inside artefacts that were produced by a different
instrument. It is the strongest evidence available and it is still second-hand: **no dispatch has ever
asked the loader for the corrected labels.** The machinery that does — a pinned revision beside the
pinned corpus, `reviseGold` dropping what it cannot score, a `dataset_gold` block in the artefact — is
covered by unit tests and by one offline replay against the archive in this sandbox. Nothing has run it
end to end, and an instrument that is only tested in pieces is the shape of every silent failure this
lane has recorded.

So this dispatch is a **validation**, and it is registered as one because its refutations are all
instrument failures rather than findings.

## Prediction

- **`n` will be 283**, and the artefact's `dataset_gold` will report **67 dropped**, `applied` equal to
  the number of gold-only corrections inside that slice, and **0 unmatched** — every entry in the
  revision names a row this corpus has, which is what makes it a revision of this corpus rather than of
  a neighbouring one.
- **The `none` arm will land between 57% and 63%.** The re-scored reading put the baseline at 59.64% on
  this population, and 283 questions carry about ±2.5pp of paired noise around a level, so anything
  inside that band is the same measurement made twice.
- **The memory arm will be within 4pp of the baseline**, because the whole point of the fourteen
  artefacts is that it is, and a validation run that produced a large delta would be reporting the
  instrument rather than the memory.

## Refutation

- **If `n` is 350**, the revision was applied after the pool was drawn, and the slice was scored on a
  population the fold assignment did not see. That is a defect in the wiring, not a result.
- **If `dropped` is not 67**, the manifest and the corpus disagree about which questions those are — and
  the whole offline replay would have to be re-run, because the two readings would be measuring
  different pairs.
- **If `dataset_gold` is null**, the dispatch's `gold: corrected` did not reach the loader, and the
  number is another vendor-label measurement wearing a correction's name.
- **If the baseline is within 1pp of 51.26%**, the revision was not applied and the 67 mis-paired rows
  are still in the denominator.

## What this file does not do

It does not measure whether memory helps. One minidev population, one arm contrast, and a split that
R75 established cannot carry an effect of the size this lane can produce: **1.4–3.1pp against a paired
detection floor near 2.5pp**. Its subject is the instrument, and its answer is "the correction reaches
the scorer, and here is the number it produces".
