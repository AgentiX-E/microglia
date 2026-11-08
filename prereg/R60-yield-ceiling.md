---
id: R60-yield-ceiling
step: R60
opened: 2026-11-09
arms: memory,reference
sample: 228
gates: V1,V2,V3,V5,V6,V7,V8,V32,V44
recallFloor: 0
facadePair: off
trainDomain: retail
testDomain: retail
recallDomain: retail
---

# R60 — the ceiling was within one claim of the mean, so the ceiling is what gets moved

**Registered** 2026-11-09, dispatchable. R59 is read and it did what it was built to do: **one group
merged, an item reached `supportTasks: 2`, and the store kept 30 of its 31 items.** The pair that
merged is the paraphrase the calibration was set on — *"perform the requested changes in the order
the user stated them, completing each before starting the next"* absorbed by *"before acting on a
multi-part request, resolve every referenced order and item to concrete identifiers, then perform the
requested changes in the order the user stated them"* — at **containment 0.667 against Jaccard
0.348**, with conditions sharing exactly **three** content terms against a floor of three.

That is the first corroboration in this project and it settles three things: the measure is the
right shape, the condition test is a count, and the floor is inside the interval the store allows.
It also produces the number this registration is about, and that number is small.

## The measurement, and the arithmetic it implies

**31 claims from 14 corrections** — 2.21 per correction, from 24.6% of the 57 learning tasks — and a
ceiling of **three**. Three facts follow, in order of how much they constrain.

| reading | R59 | published arm |
| --- | --- | --- |
| claims per correction | **2.21** | — |
| claims per learning task | **0.54** | ~5 |
| items at `supportTasks >= 2` | **1 of 30** (3.3%) | — |
| items at `supportTasks >= 3` | **0 of 30** | **31 of 292 (10.6%)** |
| store size | 31 | 292 |

**The ceiling is within one claim of the mean.** A cap of three producing a mean of 2.21 is a cap
that is binding on the corrections that reach it and invisible only because most do not. Whether
raising it moves the mean is one number away, and no committed artefact carries that number: R59's
`yieldCensus` did not exist when it was dispatched.

**The recurrence rate is a third of the published one on the lower bar and zero on the bar that
matters.** At the published 10.6%, 31 claims would hold 3.3 items at three distinct tasks; the store
holds none, and one at two. Either this register's claims are more task-specific than a trajectory's
guidelines, or the store is too small for its own recurrence — and those are separable, because
yield moves the second without touching the first.

**Pairs scale with the square of the store and triples with the cube.** One corroborated class among
30 items is the observation; going from 31 to ~45 claims multiplies the number of pairs by 2.1 and
the number of triples by 3.0. If the class that already has two members receives a third, support 3
appears; if nothing does, the class structure is the constraint rather than the population.

## The treatment: one number, and both places it is written

`TAU_TRACE_CLAIMS` moves the trace form's ceiling from 3 to **6**. The number is passed to the
interpreter, where it becomes *both* the sentence the model reads and the count the parser keeps
(`traceCeilingLine` in `packages/core/src/distill`), because a prompt that asks for six while the
parser keeps two is the defect the parameter exists to remove: before this iteration the instruction
said "at most three" in prose and the trim was whatever the caller passed.

Six and not five or eight: the published unit writes about five guidelines per *task*, and one
learning task here yields 0.25 corrections, so a correction worth five claims is already a
correction worth more than the published arm's whole task. Eight is the pack limit — a store serves
at most eight items — so a single trace claiming more than a pack could ever use would add claims
that no request can reach.

Everything else is held: same unit (`trace`), same form, same model, same seed (`TAU_SEED`), same
note level, same recall floor, same 57 learning tasks and the same 57 held-out tasks at four trials.

## The instrument, which R59 ran without

Two things ride along and neither changes behaviour:

- **`yieldCensus`** — one row per correction: its failed rubric assertions, and the items citing the
  run it was captured under. It reads the store **as the distiller wrote it**, before the recurrence
  pass, because a merge leaves the survivor citing both runs beside the retired item and counting
  that store reports one claim twice. `maxClaims` and `medianClaims` travel with the mean, because
  three claims from one correction and none from nine has the same mean as one from each of three.
- **`storeItems.statusReason`** — the pointer from a retired item to the survivor that absorbed it.
  R59's artefact had both items and no join, so the readback could report *that* a group merged and
  had to infer *which* pair. Every group in this run can be named exactly.

## Prediction

- **The yield rises, and the ceiling is why.** Claims per correction **≥ 3.0** against R59's 2.21,
  and median claims per correction **≥ 3** — the median is the reading that separates "the cap was
  binding" from "the cap was irrelevant and a few corrections carry everything".
- **Raising the ceiling does not cost the store its precision.** The pass keeps **≥ 50%** of the
  items it reads, and the refusals it counts (`condition`, `payload`, `duplicate evidence`) do not
  more than double against R59's 0/0/0.
- **Corroboration grows with the population.** **≥ 2** items at `supportTasks >= 2`, from 1 at 31
  claims: the store grows by roughly half and pairs by about twice.
- **Support 3 appears.** **≥ 1** item reaches `supportTasks >= 3`. This is the bar R55.1 admits on
  and the number the published `sup3` arm is defined by; it has never been reached here, and the
  store is now large enough that the class already holding two members can receive a third.
  Registered as a prediction and not as an aspiration: if it does not appear, it is a refutation and
  not a disappointment.
- **`pass^4` is reported and not claimed.** 57 pairs resolve ~17pp; `UNRESOLVED` is expected. On the
  rate endpoint the same sample resolves ~6.7pp. Neither direction is claimed from this run.
- **The ceiling is recorded.** The artefact carries `traceClaims: {ceiling: 6, declared: true}`, and
  the gate refuses to grade a run whose ceiling it cannot read.

## Refutation

- **The yield does not move.** Claims per correction < 3 at a ceiling of six, and the finding is
  that the cap was never the constraint — a trace carries what it carries. Then the next lever is
  the *episode* (one distillation per failed rubric assertion) rather than the ceiling, and it is
  registered as R61 rather than improvised here.
- **The yield moves and nothing corroborates.** Claims ≥ 45 with `groups <= 1` and support 2 still
  at one item. Then more claims of this shape do not produce recurrence, the corpus is the
  constraint rather than the population, and the published 10.6% is a property of trajectories that
  this register does not reproduce.
- **The store dilutes.** Retained share below 50%, or a refusal count that more than doubles: a
  ceiling bought with claims that are not claims is R56's failure arriving through the yield instead
  of through the floor, and R45 reverts the arm.
- **Support 3 does not appear with ~45 claims.** At that size 3.0 triples were expected if the class
  structure were stable. Zero means the doubleton at R59 was two claims that happened to coincide
  rather than a class, and the recurrence axis is closed for this register at this scale.
- **The ceiling is not in the artefact.** A run whose `traceClaims` is absent or whose `distillUnit`
  is not `trace` measured something else; it is `NO_MEASUREMENT` and the layer that failed is named.

## What would make this round worthless

- Changing the unit, the form or the learning population in the same dispatch. Three treatments in
  one run is three findings that cannot be told apart, and the one-lane rule exists for it.
- Reading the yield from the census without reading the store. `yieldCensus.claims` is counted from
  the store, and the population it is counted over is the store *before* the pass; a readback that
  recomputes it after the pass reports a number no run produced.
- Quoting the paired delta. It is `UNRESOLVED` by construction, and the memory-free control has now
  moved **3.51pp** between two dispatches of one configuration (63.16% then 66.67% on the same 57
  tasks and the same four trials), which is twice the effect this lane has ever measured.
- Treating support 3 as a success if it arrives in a group whose members are not one claim. The
  `l4-support-recurrence` gate now requires a census that reports a group to ship an item two tasks
  stand behind, and the readback prints the statements of every merged pair.

## Cost

One dispatch of R59's shape. The learning phase is unchanged (57 tasks, one trial); the only
additional cost is distillation output — up to six claims per correction instead of three, on 14 or
so corrections, which is a few thousand tokens. The evaluation half is identical: 57 tasks × 4
trials × 2 arms.

## Sequencing

R58 answered the object, R59 answered the measure, and this round asks whether the store can be made
large enough to corroborate itself — the only remaining variable that does not require a new
benchmark. If support 3 appears, R55.1's threshold becomes a decision rather than an arithmetic
impossibility, R57's controlled distractor becomes worth paying for, and the memory question can be
asked on a store with a corroborated core. If it does not, the next registration is R61 (the episode
rather than the ceiling), and the honest finding is that a register of one-sentence claims from one
trace per task does not recur at this benchmark's density.
