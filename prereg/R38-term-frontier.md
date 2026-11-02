---
id: R38-term-frontier
step: R38
opened: 2026-11-02
arms: none
sample: 1534
gates: V66,V67,V68
---

# R38 — was 8.6% the corpus's ceiling, or the store's construction?

## Why this file exists

R37 built a definitional store, licensed it, and rendered on **132 of 1,534 questions**. The registration
it executed had fixed a floor of 25% in advance and named the outcome of missing it *inconclusive by
feasibility*, so the round closed without a verdict on the grain. §153 then supplied a cause: "a definition
is reusable only where a corpus reuses a phrase, and this one does not" — 179 entries met 13 distinct terms.

That sentence is a claim about the corpus, and it is testable without a model call, because the corpus
ships a store of definitions of its own. BIRD attaches an `evidence` block to **1,386 of 1,534 dev
questions (90.35%)**, and the block is not prose. It is a mapping from a phrase a question uses to the
database vocabulary that phrase denotes:

```
  Eligible free rate for K-12 = `Free Meal Count (K-12)` / `Enrollment (K-12)`
  driver reference name refers to driverRef
  the label means the class of the molecule
```

Read as a store, those mappings are the key universe a definitional memory could have had. So the question
that decides whether the grain route is closed becomes arithmetic: **rank the corpus's own keys by the
questions they reach, and how many are needed to render on a quarter of the split?**

This round makes no model call and buys no dispatch. It answers one round's open question from data both
rounds already committed, and it registers the answer's shape before it is read so that the reading cannot
choose the threshold that flatters it.

## What is tested

1. **The frontier.** `bridgesOf` reads the three shapes the annotations use; `keyStats` counts, for every
   key, how many questions contain it and how many annotations carry it; `reachCurve` gives reach as a
   function of distinct keys; `keysForShare` gives the crossing.
2. **The vocabulary filter.** A key's **density** is annotations over occurrences — the corpus's own
   judgement about whether a phrase needs defining wherever it is used. Three thresholds (0.5, 0.8, 1.0)
   are published, and the verdicts use the most generous one.
3. **The arm's position.** The store's 13 terms, scoped as the lane scopes them — per fold *and* per
   database — the reach they licensed, the reach the renderer served, and entries per distinct term.
4. **The concentration.** Which of the 11 databases the arm's terms reach.

## Prediction

Fixed before the reading was frozen and before any CI assertion was written. Each bullet states the
reading and the observation that would refute it.

- **P1 — the raw key set crosses a quarter of the split within five keys, and every key that crosses it is
  generic (density below 0.1).** Refuted if it takes more than five keys, or if a key that crosses carries
  a density of 0.1 or more, which would mean the corpus's reachable vocabulary is also its defined
  vocabulary and the density filter is doing nothing.
- **P2 — at the arm's own key count the vocabulary frontier reaches less than twice what the arm's store
  licensed.** Refuted if the ratio is 2 or more, which would make the arm badly behind the frontier rather
  than near it, and would reopen the grain route with a construction target instead of closing it.
- **P3 — even holding every vocabulary key at density 0.5, at least a quarter of the split is never
  reached.** Refuted if the ceiling exceeds 75%, which would mean the corpus is reachable and the arm's
  8.6% was entirely a store defect.
- **P4 — the arm spent its entries redundantly: at least two entries per distinct term.** Refuted if the
  ratio is below two, which would mean the store was already one-entry-per-reason and the redundancy
  reading has no subject.
- **P5 — the corpus annotates what it mentions rarely more thoroughly than what it mentions often: mean
  density at three questions or fewer exceeds mean density at fifty or more.** Refuted if the inequality
  fails or reverses, in which case the round's explanation of *why* the ceiling sits where it does has no
  support even if the ceiling itself is real.
- **P6 — the licence and the renderer agree: every question the store licenses is served.** Refuted if the
  two counts differ, which would mean the character budget silently ate a licensed question and the arm's
  reach was smaller than its store's.

P2 is the round's load-bearing prediction and it is deliberately written **against** the reopening: the
exploratory passes had suggested the corpus could reach far more than the arm did, and a frontier at 13
keys of 241 against an arm of 132 leaves "the store was badly constructed" unavailable as an explanation.
P3 is the closure, and it is a statement about a ceiling rather than about a store.

## Refutation

Read in order; the first that fires is the round's outcome.

- **The frontier is not a frontier.** If `V66-frontier-is-a-curve` fails — the curve is not monotone, the
   last point is not the union of every key, or the whole key set reaches nothing — the reading is
   withdrawn rather than published with a caveat. A reach curve that is not a curve is a matcher that
   disagrees with the corpus.
- **The keys are not the corpus's.** If the three annotation shapes cover under half of the annotated
   questions, the key universe is an artefact of the parser and no frontier computed from it is about the
   corpus. This clause is why `bridgesOf` is narrow and why the coverage share is published.
- **The band collapses.** If the ceiling at density 1.0 and the ceiling at density 0.5 differ by less than
   5pp, the density threshold is not doing the work claimed for it and P1/P3 are statements about a filter
   rather than about the corpus.
- **P2 fires.** If the vocabulary frontier at the arm's key count is at least twice the arm's licensed
   reach, then §153's cause was wrong in the other direction: the store, not the corpus, was the ceiling,
   and the grain route reopens with a concrete target rather than a closure.
- **P5 fails.** If density does not fall with reach, the corpus does not prefer to define rare terms, and
   the round's explanation of *why* the ceiling is where it is has no support.

## Disclosure

**A zero-call reading cannot be blind to its own data, and this one was not.** The predictions above were
fixed after the frontier module existed and after three exploratory passes had printed the numbers, so the
honesty of the round rests on the refutation clauses rather than on blindness. Two intermediate readings
are recorded because each was wrong in a way that would have been published as a finding:

- **Version one** ranked every annotated key and reported that **two keys reach 25%**. They were `list` and
  `name`, each annotated once and each occurring in hundreds of questions. A frontier of English frequency.
  Fixed by density, which is the corpus's own judgement rather than a stopword list.
- **Version two** scoped the store by fold only, and reported **141 licensed against 132 served** — nine
  questions "licensed and silent". The lane scopes its store by fold *and* database
  (`lexiconByDomain.get(row.db_id)`), so the nine were questions whose term was learned in another
  database. A third scope error was caught the same way: against the union of all folds the arm licensed
  201, which reads as a store that lost a third of its reach to a character budget. Both are `AUDIT`
  §34.9's defect — a correct computation about the wrong population — and both were found by two columns
  of the same reading disagreeing, which is why the artefact publishes `armLicensed` beside
  `renderedQuestions`.

**What this round cannot say.** It cannot say a distiller could have chosen these keys: they are the
benchmark's annotations, and a learner never sees them. The frontier is an **upper bound** on a store of
that size, which is exactly the instrument needed to decide whether a ceiling was geometric, and not an
estimate of what a learner achieves. It also cannot say what a higher reach would do to accuracy — the
arm's own covered cells read 5 repairs against 4 breaks, and that is the sample that a re-run with more
reach would have to improve on.

## Cost

Zero model calls and zero dispatches: one command over a committed artefact (`pnpm eval:frontier`), 31 unit
tests over the module, and one blocking gate. CI diffs the artefact and asserts 16 of its fields, so a
change in the arithmetic arrives as a diff rather than as a paragraph.

## Outcome

| # | Prediction | Reading | Result |
|---|---|---|---|
| P1 | the raw set crosses 25% within five keys, all generic | **2 keys**: `list`, `name`, densities 0.004 and 0.004 | holds |
| P2 | the vocabulary frontier at 13 keys is < 2× the arm | **241 against 132** — ratio 1.83 | holds |
| P3 | the ceiling at density 0.5 is ≤ 75% | **65.9%** of 1,534 with all 1,070 keys held | holds |
| P4 | at least 2 entries per distinct term | **179 entries on 13 terms — 13.77 per term** | holds |
| P5 | rare keys are annotated more thoroughly than common ones | mean density **0.967 at ≤3 questions** against **0.077 at ≥50** | holds |
| P6 | the licence and the renderer agree | **132 licensed, 132 served** | holds |

**The cause §153 gave was wrong, and the conclusion it reached was right.** The corpus does not fail to
repeat phrases — it repeats 346 of them, and 2 of its keys reach a quarter of the split on their own. What
it does not repeat is the vocabulary it *defines*: a key mentioned in three questions or fewer carries an
annotation in **96.7%** of the questions that mention it, and a key mentioned in fifty or more carries one
in **7.7%**. The corpus defines what it mentions once and mentions without defining what it mentions often,
which is the opposite of the shape a definitional memory needs.

So the ceiling is real and it is now a number: holding every key the corpus treats as vocabulary, **34.1%
of the split is never reached** at density 0.5, and **47.7%** at density 1.0. And the arm was not far
behind that frontier — at its own 13 terms the frontier is 241 and the store licensed 132, a factor of
1.83, which is inside the band the three thresholds produce (241 / 148 / 78). The grain route is closed by
the corpus **after all**, but for a sharper reason than the record had: not "definitions do not pay" and
not even "phrases do not repeat", but **the words that need defining are the words a corpus says once**.
