---
id: R65-exemplars
step: R65
opened: 2026-11-09
arms: examples
sample: 350
gates: V1,V2,V3,V4,V5,V6,V7,V8,V12,V32,V44,V48,V51,V75
---

# R65 — the lawful approximation of the largest positive this record has

**Registered** 2026-11-09. **Amended** 2026-11-09 after implementation, before dispatch: `V75` is
added to the header because the two void conditions below are now a blocking gate rather than a
sentence a reader has to remember. The predictions are unchanged.

The file was written while the arm was unimplemented, and that order was the point: a registration
that exists before the code has a target it cannot re-describe afterwards.

## Why this file exists

`oracle` is **+33.14pp** at n=350 (artefact `poc-sota-bird.json`, p = 2.4e-35, 115 gained against 1
lost). It is the only two-digit effect in the record, and it is not a mechanism: it injects the memory
items whose evidence is *this question*, which a deployment cannot have. What it prices is the value of
showing the model something that was written for this question by someone who knew the answer.

`retry-blank` (+0.57pp) and `full` (null on three splits) price the memory this project actually
builds. R63 closed schema ordering for accuracy at **+0.86pp** against a free ceiling of **+13.75pp**
of ordering quality, which is the same lesson from the other direction: a prompt whose *content* is
rearranged does not move the answer, so the next arm has to change the content.

The cheapest content that is lawful, cross-fitted, and known to work in the published record is the
**nearest training questions' gold SQL shown as worked examples**. DAIL-SQL and CHESS both report
large gains from exemplar selection on BIRD and Spider; neither reports it against a memory arm on the
same split, which is the cell this registration buys.

## The mechanism, exactly

- **`examples`**, an arm evaluated beside `none` and `full`, prompt-identical to `none` except for one
  appended block.
- **The block**: for each evaluated question, the **k = 3** nearest questions from the *same database*
  among the fold's **learn rows** — the rows the memory distils from, which are the rows it is allowed
  to see — each rendered as its question text and its gold SQL, in the order retrieved.
- **Similarity**: the same lexical overlap `recalledFor` uses for table recall, so the retrieval is a
  function already in the tree rather than a second one. `SOTA_EXEMPLAR_K` is the knob and 3 is the
  registered value: k = 1 is a coin flip on which of two similar questions was drawn, and 10 is a
  prompt of a few thousand characters that the literature reports as noisy.
- **Budget**: the block is capped at **1,200 characters**, the same cap `full`'s pack carries, so the
  comparison is between two prompts of the same length that contain different things. A block that
  overflows drops its last exemplars rather than truncating one mid-statement.
- **Cross-fitting**: the exemplars come from the learn rows of the fold that is being scored, and a
  question is never shown its own row. `V2-fold-partition` is the gate, unchanged.
- **No store**: the arm reads the corpus, not the memory, so the pack is empty and `mean_pack_ids` is
  `full`'s. This is deliberate: an arm that mixed retrieval from the store with retrieval from the
  corpus would confound two mechanisms in one cell.

## Prediction

- **The arm fires on at least 90% of the questions.** A database whose learn rows are empty cannot
  supply an exemplar; on minidev every database has neighbours, so a lower share is a wiring defect
  rather than a property of the split.
- **The exemplars cost tokens and the artefact says how many.** `usage.prompt_tokens` rises against
  the same run's `none` arm, `cache_hit_rate` falls or holds, and the bill is computable and off-peak.
- **Accuracy moves by more than an ordering can**: the paired delta against `none` lands between
  **+2pp and +10pp**. The published record on BIRD reports exemplar gains of this size for models of
  this class; an ordering moved 0.86pp and this is the arm whose case does not rest on the ordering.
- **The comparison that decides the line is against `full`**, not against `none`: if exemplars beat
  `none` and do not beat `full`, the store is being paid for something the corpus gives away, and the
  product's claim narrows to "we remember what the corpus does not contain".
- **The resolution is about 4.8pp and is stated before the run.** At n=350 and the discordance R63
  observed, this design resolves 4.8pp. It cannot confirm a 2pp effect and must not be read as having
  refuted one.

## Refutation

- **The exemplar line is promoted** if the delta against `none` is **+6pp or more** with an interval
  excluding zero **and** the delta against `full` is positive. The next stage is then dose (`k = 1, 3,
  6`) and selection (lexical overlap against embedding similarity), both registered separately.
- **The line is narrowed** if exemplars beat `none` by +6pp or more but do not beat `full`. Then the
  store and the corpus are substitutes, and the interesting question stops being "does memory help"
  and becomes "what does memory add that a retrieved example cannot" — which is a registration about
  the store's *content*, not about its existence.
- **The line is closed** if the delta against `none` is inside ±4pp. Then `oracle`'s +33.14pp is a fact
  about the answer key rather than about the prompt, and the honest conclusion is that this record's
  largest positive cannot be approached by any retrieval that does not already know the answer.
- **The run is void** if the arm fires on fewer than 80% of questions, or if the rendered block exceeds
  its 1,200-character cap on more than 5% of questions, because in both cases the dispatch is not
  running the mechanism described above.

The alternatives are named so the outcome selects one, and so that a null cannot afterwards be
re-described as a narrow win.

## Outcome — 2026-11-10, run `42725249396` (void by its own gate)

The arm ran: `minidev`, n=350, 1,438 calls, $0.1352 off-peak, cache 73.11%, `full` at 54.00%
(+2.00pp, 18 gained / 11 lost) and `examples` at **53.71% (+1.71pp [−2.29, +5.71], p = 0.48, 28 gained
/ 22 lost)**. Per-fold deltas: +1.43, 0, +1.43, +2.86, +4.29.

**The run is void**, and the gate that voided it is the one this file wrote in advance:

```
V75-exemplars-delivered  false
asked=350 fired=350 (100.00%) capped=34 (9.71%) mean-chars=946.3 k=3 budget=1200
```

The arm fired on every question (prediction: ≥90%, ✓) and wrote blocks averaging 946 characters
against `full`'s 1,090 (budget 1,200). But on **34 questions (9.71%)** the budget could not hold the
third exemplar, so a tenth of the dispatch showed the model two examples where the registration says
three. The void clause allows 5%. The lane refused the run and published no claim, which is the
behaviour the clause exists to produce.

**The point estimate is recorded and is not evidence.** +1.71pp against `none` and −0.29pp [−4.29,
+3.71] against `full` (24 gained / 25 lost, p = 1.00) are the numbers a void run produced. They are
written here because hiding them would be worse than disclosing them, and they are not read as
selecting the closing branch — a void run selects nothing.

## Amendment 1 — the instrument delivered two examples where the registration says three (2026-11-10)

The void condition is about **delivery**, and delivery is part of the instrument rather than part of the
hypothesis. So this amendment changes one number — the block's character budget, 1,200 → **1,600** —
and explicitly changes nothing else: the dose stays k = 3, the similarity function stays the tree's
lexical overlap, the cross-fitting stays, the prediction stays **+2…+10pp against `none`**, the closing
branch stays **±4pp**, and the deciding comparison stays against `full`.

Why 1,600 is the right repair rather than a relaxation:

- At 1,200 the block averaged 946 characters and *still* could not fit its third exemplar on 9.71% of
  questions, because BIRD's question texts plus a gold query run to about 315 characters per exemplar
  and the tail is long.
- Raising the budget does not buy the arm an advantage over `full`: it moves the mean block from 946 to
  about 975 characters, against a pack whose measured mean is 1,090. The comparison stays
  length-matched within 10% — the property the equal-constant version was reaching for, stated as a
  measured mean instead of as an equality.
- The alternative repairs are worse. Dropping to k = 2 changes the registered dose. Keeping 1,200 and
  widening the void threshold changes the bar after seeing the number that crossed it. Truncating an
  exemplar breaks the one rule the renderer was built around.

**What this amendment does not do is protect the hypothesis.** The hypothesis was written before the
code existed and is not being edited: if the re-dispatch lands inside ±4pp, the line closes, and the
+1.71pp already observed means the re-run cannot be presented as a fresh test of an untested idea —
only as a properly delivered version of the same one. That is the trade the void clause forces, and it
is cheaper than publishing a number the arm's own gate refused.
