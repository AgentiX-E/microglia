---
id: R59-containment
step: R59
opened: 2026-11-08
arms: memory,reference
sample: 228
gates: V1,V2,V3,V5,V6,V7,V8,V32,V44
recallFloor: 0
facadePair: off
trainDomain: retail
testDomain: retail
recallDomain: retail
---

# R59 — the measure is containment at a floor the store set, and the learning half is the whole half

**Registered** 2026-11-08, dispatchable. R58 is read: two refutations fired, `ABANDONED` on its own
terms, and the write side produced the first positive result this lane has — 7 corrections became
**15 claims**, every condition in the requester's words, no tool names, the ban refusing 0 of 15
where R55.0 refused 9 of 16. What failed was recurrence, and this registration is two measured
defects repaired rather than a new idea.

## Defect 1 — the measure, which the store calibrated

R58's population was right and the pass was still inert: `groups = 0` over 15 items, `supportAfter`
identical to `supportBefore`. The store says why, exactly.

Its two closest items are **one claim**. Both open *"when a request bundles several changes, carry
out every requested change in the order the requester stated them"*; one ends *"and do not stop
after the first one succeeds"*, the other *"and stop once all are applied rather than adding extra
lookups or calculations"*. Jaccard puts that pair at **0.483** against a 0.70 floor, and 0.483 is the
**maximum** of all 105 pairs in the store — the next-highest pair, which is not a repeat, is 0.250.
The distribution has no tail: the floor was above the population's ceiling, so no setting of it
could have merged anything.

Jaccard charges the trailing clause twice, once for the terms it adds and once for the terms it does
not share. **Containment** — shared terms over the smaller claim's terms — charges it once and puts
the same pair at **0.700** against **0.533** for the closest non-repeat. A floor of **0.60** sits
between the pair that is one claim and the pair that is not.

The condition is tested by a **count**, not a ratio, and that too is measured. The same pair's two
conditions share four content terms of eight; the closest non-repeat pair's conditions share four as
well; two conditions that disagree about their subject share two. As a ratio the condition reads
0.400 whether the pair is one claim or two — no resolution at all — so holding it to a floor in that
neighbourhood would veto the single merge the register offers. Vetoing below **three shared terms**
separates a paraphrased trigger from a conflicting one, and every refusal is still counted.

## Defect 2 — the population, which the registration got wrong

R58's registration says 32 corrections and multiplies by 32: candidate calls, store size, the claim
that three traces could agree. The run had **7** — `learning.rows = 32`, `learning.edited = 7`,
because the learning half solves 25 of its 32 tasks at one trial. Every scale number in that document
was 4.6× too large, and the recurrence prediction was written against a population that did not
exist.

So the learning half is raised from 32 tasks to **57, the whole of it**. The split is unchanged
(`114` tasks, share 0.5, `round(114 × 0.5) = 57`), so **the held-out set is the same 57 tasks at the
same four trials as R58's**: the reference arm is comparable and the pair is not a cross-run
comparison. What changes is that the 25 learning tasks R58 left unused are now learned from. At the
measured edit rate (7 of 32, 21.9%) that is ~12 corrections and ~26 claims, against 7 and 15.

## The two changes, and how each is attributed

**The measure is controlled inside the run.** The pass reports `supportBefore` and `supportAfter`
over one store it read once, and the census carries both floors. The readback then re-scores **the
same store** under Jaccard at 0.70 and reports how many groups that measure would have merged. The
difference between the two readings over one store is the measure's contribution, measured, not
inferred from two dispatches.

**The population is a sample change and is reported as one.** It is not a treatment the run can
control: a bigger learning half produces a different store. That is why no prediction below is
stated as a delta against R58's pass rate, and why the readback grades the store's own numbers
rather than a difference between two runs.

Everything else is held: same unit (`trace`), same form, same model, same seed, same note level, same
recall, `minCoverage` 0, the tool-name ban on.

## Prediction

- **The pass is no longer inert.** At least one group merges (`groups >= 1`). Measured on R58's
  store, containment at 0.60 puts exactly one of 105 pairs over the floor and that pair is the true
  repeat.
- **Something recurs.** At least one item reaches `supportTasks >= 2`. This is the prediction R58
  failed at 0 of 15, and the one the population change exists to make reachable.
- **Support 3 is *not* predicted, and its absence is not a refutation.** One mergeable pair in 105
  is a rate of about 1%; at ~26 items the expectation is four or five pairs, and a triple needs
  three of them to fall inside one group. Registering support 3 as a prediction here would be the
  arithmetic error this iteration exists to correct.
- **The measure is the reason, not the population.** On the R59 store, Jaccard at 0.70 merges
  strictly fewer groups than containment at 0.60. If the two agree, the measure change did nothing
  and the merges came from the bigger population alone.
- **The pass keeps the store.** At least 50% of the items it read survive it.
- **The unit ran.** At least 80% of the corrections carry a trace, and the ban refuses none of them.
- **`pass^4` is reported and not claimed.** 57 pairs resolve 19.66pp; `UNRESOLVED` is expected and
  stated in advance, and the memory-free control moved 8.77pp between two dispatches of one
  configuration, so no delta is quoted as a treatment effect.

## Refutation

- **No group merges again.** Then two floors calibrated on the register's own store still merge
  nothing, lexical consolidation is inert on this corpus, and the support axis closes for a register
  written in sentences rather than for a threshold. The next registration would be about the corpus,
  not the mechanism.
- **A merged group is not one claim.** If any group's members disagree in their operative clause and
  not only in a caveat, the floor is below the register's resolution: it buys support with
  distinctions the store was built to keep, which is worse than an inert pass.
- **The store halves.** Support bought with reach is R56's failure arriving by a third route, and R45
  reverts the arm.
- **Traces on fewer than 80% of corrections.** The treatment did not run on the population the
  reading is over; the run is `NO_MEASUREMENT` and the layer that failed is named.
- **Jaccard and containment merge the same groups on the same store.** Then the calibration above is
  wrong about which reading made R58 inert, and the finding belongs to the population alone — which
  is a weaker finding, and is reported as one.

## What would make this round worthless

- Changing the note level, the admission rule or the recall floor in the same dispatch. R53, R55.1
  and R57 are registered and all three are downstream of what the store contains.
- Reading the merge count from the census without reading the merged text. A count of groups is not
  evidence that the groups are claims; the readback prints the members of every group it merged.
- Quoting the paired delta as a result. It is `UNRESOLVED` by construction and will be again.
- Grading recurrence on an artefact whose `distillUnit` is absent. The gate `l4-support-recurrence`
  blocks rather than warns, and it now prints the floors beside the distributions.

## Cost

One dispatch: 57 learning tasks × 1 trial where 32 were run (25 more agent episodes, at most ~12 more
distillation calls at up to 3 claims each), plus the same 57 × 4 × 2 evaluation episodes as R58. The
consolidation pass costs no model call: it is a lexical grouping over items already stored.

## Sequencing

R58 answered the *object* question and left the *population* question open; both of this round's
changes are arithmetic repairs to it. If a group merges and support 2 appears, R55.1's threshold
becomes readable and R57's distractors become the next question worth paying for. If neither
appears with 26 claims and a floor the store set, the finding is that a register of one-sentence
claims cannot corroborate itself at the granularity this benchmark produces, and the store's own
recurrence is not the axis to buy accuracy on.
