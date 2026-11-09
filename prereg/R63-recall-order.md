---
id: R63-recall-order
step: R63
opened: 2026-11-09
arms: linked-additive,recall-order
sample: 350
gates: V1,V2,V3,V4,V5,V6,V7,V8,V12,V32
---

# R63 — the ordering signal, dispatched against the one it replaces

**Registered** 2026-11-09, before dispatch. `arms` names the two optional arms the dispatch asks for;
`none` and `full` are always added by `parseArms`, so the run scores four.

## Why this file exists

The free measurement (`pnpm eval:table-recall`, zero model calls) says ordering the schema by the
gold table sets of the five nearest training questions puts every gold table ahead of every
non-gold one on **56.65%** of the 1,534 dev questions, against **42.89%** for the lexical anchors
that `linked-additive` ships — +13.75pp [+10.30, +16.88], p < 1e-4. It also says **43.35% of
questions cannot be ordered cleanly by any table-set signal**, because their gold tables are not
determined by the question text.

So the mechanism has a measured ceiling and a measured predecessor, and the only thing left unknown
is whether a reordered prompt changes an answer at all. That is what this dispatch buys. It is not
powered to detect a small effect and it is not pretended to be: see the resolution note.

## Prediction

- **The arm fires.** `recall-order` changes the prompt on at least **95%** of the 350 questions.
  The free measurement says 100% of 1,534 (`prompts_changed_share = 1.0`, mean 4.88 tables moved
  per question), so a lower rate on minidev is a wiring difference rather than a property of the
  split, and V7-channel's floor of 1% is a floor against silence, not against this number.
- **The instrument reproduces the ceiling.** The artefact's `ordering.cleanShare` for the arm lands
  within **±5pp of 56.65%**, and its `ordering.retrieved_share` is above 90%. The arm summarises
  with the same function the free measurement used; a number outside that band means the dispatch
  is not running the mechanism that was measured, and nothing else in the run can be read.
- **Accuracy does not move, and that is the predicted outcome.** The paired `recall-order` against
  `linked-additive` delta lands within **±4pp of zero**. The reason is in the free numbers rather
  than in an intuition: ordering cannot add a table the model could not otherwise see, the two arms
  differ only on the questions where the orderings differ, and 43.35% of questions have no clean
  ordering for either arm to produce. Predicted point estimate: 0pp, direction named but not claimed.
- **The memory arm is still null.** `full` against `none` lands within ±4pp of zero, as it did on
  dev (+0.72pp, [−0.85, +2.28], p=0.41) and on the 2026-11-09 minidev run (−1.43pp). A third
  population agreeing is worth recording even though it is not a test.
- **The bill is computable, which is half of what the run is for.** The artefact carries a non-zero
  `usage.usd`, a `cache_hit_rate` above 0, and `bands` naming exactly one band, because the dispatch
  is inside an off-peak window. A run that again cannot state its cost is a run whose next dispatch
  is unbudgetable.
- **The lane is reliable.** `V8-call-reliability` passes, the answer rate is at least 98%, and
  `V4-gold-executable` is at least 97%.
- **The resolution is about 6pp, stated before the run.** At n=350 and an observed paired
  discordance near 18%, the smallest effect this design resolves at 80% power is about 6pp. The run
  cannot confirm a 2pp effect and must not be read as having refuted one: its job is to place the
  mechanism's accuracy effect above or below a 6pp bar, and to prove the instrument reproduces the
  ceiling it was chosen on.

## Refutation

- **The ordering line is promoted** if `recall-order` beats `linked-additive` by **+6pp or more**
  with an interval excluding zero. The next stage is then dose, not a new mechanism: `SOTA_RECALL_K`
  at 1 and 10, and column-level ordering inside the moved tables.
- **The ordering line is closed for accuracy** if the interval excludes +6pp and contains zero —
  the predicted outcome. The free ceiling and the artefact block stay, because they price schema
  linking for every later arm; the mechanism stops being a candidate. The next P0 becomes the
  retrieved-exemplar arm: the nearest training question's **gold SQL** shown as a worked example,
  which is the lawful approximation of `oracle` (+33.14pp, p=2.4e-35) rather than a reordering of it.
- **The ordering line is closed entirely** if `recall-order` is **6pp or more worse** than
  `linked-additive`. A reordering that hurts on a prompt where no table was removed would mean the
  reader is attending to position in a way that beats the declaration order, and no variant of this
  mechanism is then worth a call.
- **The run is void** if `ordering.cleanShare` falls outside ±5pp of 56.65% or
  `retrieved_share` below 90%. The wiring is then wrong, and the correct response is to fix the
  wiring and re-run, not to read the accuracy columns — the earlier `schemaBlocks` defect is the
  precedent: an arm that cannot fire publishes its own absence as a null.
- The alternatives are named above so that the outcome selects one. A refutation that leaves the
  cause ambiguous turns the next stage into a search rather than a test.
