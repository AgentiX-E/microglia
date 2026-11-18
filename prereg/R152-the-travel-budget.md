---
id: R152-the-travel-budget
step: R152
opened: 2026-11-18
# R143's two folds priced the same treatment twice and disagreed in sign, and the fold that lost is the fold
# whose store kept three servable items for seventy-five requests. The mechanism that explains both is renders
# per servable item, so this round moves allocation at a constant dose: the pack is still served on every
# request, and no item may take more than its fair share of them.
arms: memory
sample: 114
gates: V0,V1,V2,V3,V5,V8
recallFloor: 0
facadePair: off
facadeNotes: off
facadeShapes: off
distillScope: all
distillUnit: correction
distillForm: lesson
consolidate: true
consolidateKey: routine
consolidateLinkage: all
serveSupport: 2
speakMargin: 0
serveRotation: fair-share
trials: 1
trainDomain: retail
testDomain: retail
recallDomain: retail
packBudget: 2400
packLimit: 1
taskSplit: official
trainTasks: 74
testTasks: 40
release: v1.0.1
claimRuler: interval
---

# R152 — the travel budget: same dose, different allocation

**Registered** 2026-11-18, after reading both R143 folds and before this arm runs.

## What the two folds said, in one table

| reading | `official` (74 learn / 40 held out) | `official-swapped` (40 learn / 74 held out) |
| --- | --- | --- |
| items created | 77 | 40 |
| servable after the floor of 2 | **11** | **3** |
| renders | 40 over 10 items | 75 over 3 items |
| renders per servable item | **3.6** | **25.0** |
| harm share | **8.33%** (3 of 36) | **23.81%** (15 of 63) |
| repaired / opportunity | 4 / 4 | 7 / 11 |
| delta | +2.50pp [−10.00, +15.00] | −10.81pp [−22.97, +1.35] |
| pooled (cross-fit, 114 pairs) | **−6.14pp** [−14.91, +2.63], p = 0.2649 | |

The pooled number is an average of a gain and a loss, and the round that produced it named the quantity that
separates them: **renders per servable item**. A store that keeps fewer, thinner items does not become
conservative — it applies each of them everywhere. The floor of two corroborating tasks retained three of forty
items on the thin half, and the recall path then had nothing else to offer, so one item per request became
three items circulating seventy-five times.

The `official` fold shows the same mechanism in a milder form, and the attribution makes it concrete:

| item | renders | kept | broke | net |
| --- | --- | --- | --- | --- |
| `k_01hf7uaq8e_axxtd` | **12** | 0 | 2 | **−2** |
| `k_01hf7uaq8g_fdwft` | 5 | 0 | 1 | −1 |
| `k_01hf7uaq78_cdhwy` | 5 | **2** | 0 | **+2** |
| `k_01hf7uaq71_csn29` | 6 | **1** | 0 | +1 |
| `k_01hf7uaq8o_fcxg8` | 1 | **1** | 0 | +1 |
| five others | 11 | 0 | 0 | 0 |

**The one item that took twelve renders is the one that repaired nothing.** The three items that repaired
something were served five, six and one time. The ranking did not spread its answers; it picked the most
generic-sounding record and applied it to a third of the phase, and the store's best records were left idle —
which is R139's own observation (34 of 55 servable items never served) arriving as harm rather than as waste.

## What is being measured, and what is held fixed

**One axis: allocation.** Every gate this lane has registered so far decides *whether* a pack is served —
the support floor, the margin rung, the coverage floor, the anchor. This one accepts every pack the control
would serve and decides *which item fills it*, by refusing an item that has already taken its share:

```
cap = ceil(requests / servable)          // 40 requests over 11 servable items → 4
exclude = { ids whose renders ≥ cap }    // passed on RecallQuery.exclude, honoured by the store
```

Everything else is R143's `official` fold, verbatim: the same 74/40 split of the benchmark's own boundary, the
same distillation population, the same recurrence pass and key, the same support floor of 2, the same
`packLimit: 1`, the same 2,400-character budget, the same model, one trial per task, off-peak.

Three design decisions are worth stating, because each is a way this could have measured something else:

- **The cap is arithmetic, not a constant.** A fixed "at most N renders" in the header would be a dose knob,
  and dose is an axis this lane has already priced. The fair share keeps the *number of served requests* equal
  to the control's, which is what makes the contrast an allocation contrast. It is computed from the store this
  run actually builds, because a number written before the distiller runs is a guess that may not bind.
- **The exclusion is applied where the candidates are.** `RecallQuery.exclude` is honoured inside the store's
  search, before ranking, so the pack serves the *next* rule rather than one rule fewer. A filter on the
  finished pack would return a pack of size zero on a request the control served — a dose change wearing the
  name of an allocation change, and the tests pin the difference.
- **The cap is derived from `servable`, not from `active`.** An item the floor retired cannot be served, so it
  must not inflate the denominator: eleven servable items, not seventy-seven stored ones.

## Why this fold and not the other

The swapped fold's fair share is `ceil(75 / 3) = 25`, which is exactly what the ranking already did — the
rotation would be the identity there, and buying it would buy a second sample of R143 to learn nothing. The
official fold is where the arithmetic binds: 40 requests over 11 servable items is a cap of four, eleven items
at four renders is 44 ≥ 40, so the phase can still be answered in full while no item travels more than four
times. **The fold that lost cannot be fixed by allocation**, and saying so before the dispatch is part of the
registration: its problem is that three items are all the recoverable supply a store of forty corrections
holds at a floor of two.

## Prediction

- **`serveRotation.cap` is 3–5, `starved` is 0, and `maxRenders ≤ cap`.** The band is the arithmetic over the
  store size this lane has measured twice at this cut (11 servable, 9–14 retained by the floor's own band).
  A cap of 1 means the store exceeded the phase and the arm could not bind.
- **The phase is served in full: ≥ 36 of 40 requests carry a pack.** Eleven items at four renders cover forty
  requests; anything below 36 means the bound bit harder than its own arithmetic says, which is a defect in
  the ledger rather than a finding.
- **`breaks` ≤ 3, and the leader's own breaks fall from 2 to ≤ 1.** This is the falsifiable claim about the
  mechanism: the item that broke twice took twelve renders, and the rotation gives it four.
- **`repairs` ≥ 3 of the four opportunities.** The items that repaired were served five, six and one time; the
  renders the leader loses are re-allocated to exactly that population, so the repair count should hold and may
  rise. A repair count that falls with the harm is the signature of a ranking that was right about its
  favourite.
- **The delta stays unresolved, and the registration says so before the number.** At 40 held-out tasks this
  design resolves 18.53pp, and no effect this lane has measured is that large. What is bought here is a count,
  not a point estimate: `pass^4` predicted in 0.875–0.975, printed with its interval and not graded as a claim.
- **`serveYield.opportunity` stays near 10% of renders** (4 of 40 in R143), because the reference arm passes
  most of retail whatever the memory does. If it doubles, the rotation changed which tasks the memory spoke to
  and not only which item it spoke with.

## Refutation

- **`maxRenders` = 12 again, or no `serveRotation` block in the artefact.** The exclusion never reached the
  store, the arm is R143's treatment with a new store, and nothing about allocation was measured. Read from the
  artefact rather than from the header, because the header is an intention.
- **`breaks` ≥ 5.** Concentration is not what makes this store harmful, and the next dollar goes to the outcome
  counter (R129), for which R143's own attribution is the evidence: one item took 18 opportunities with zero
  repairs, and at the lane's 64% repair rate per opportunity that is evidence at p < 1e-8 *within one phase*.
  The counter was refused for three rounds on the ground that an item served once or twice cannot be told from
  the base rate; the renders R143 measured are not once or twice.
- **`repairs` ≤ 1.** The ranking's preference was the repair: the item it favoured was the one that rescued
  trials, and spreading service removed the gain with the harm. Then the axis is *selection*, and the honest
  conclusion is that this lane's ranking is right about one item and cannot say which.
- **`served` < 30 of 40.** The bound starved the phase, and the reading is a dose — the axis this lane has
  already priced — rather than an allocation.
- **`serveSplit.served.passed` moves by more than 5 trials in either direction.** At 36 control-passed trials a
  five-trial move is the whole of R143's own between-run spread (R141 and R143-official ran this treatment
  twice and differed by 7.5pp), so a larger move says the arm's difference is not the rotation's.

## Decision rule, stated before the number

| outcome | what the next dollar buys |
| --- | --- |
| breaks ≤ 2 and repairs ≥ 3 | allocation is the lever: ship the rotation as the serving default, and buy the same arm on the swapped fold so the pool reads 114 pairs |
| breaks = 3 (unchanged) and repairs ≥ 3 | the rotation is inert on a rich store: the harm is content, and the next arm is the outcome counter (R129) |
| breaks ≥ 5 | allocation harms: withdraw the policy, and the counter is the only remaining lever with within-phase evidence |
| repairs ≤ 1 | the ranking was right about its favourite: selection, not allocation, and the next arm is a ranking instrument rather than a serving rule |
| `maxRenders` = 12 or no `serveRotation` | instrument failure: fix, assert, and re-dispatch at $0 against the same store |

## Cost

**$0.3840**, which is this fold's measured bill rather than an estimate — `official` ran on 2026-11-18 and its
artefact carries the number (learn, memory and reference phases, off-peak, 114 episodes per arm). One dispatch,
not two: the swapped fold's rotation is the identity by arithmetic, and buying an identity is buying a second
sample of the run it is compared with.

The dispatch is sent off-peak with no `not_before`. The rate card's peak windows are 01–04 and 06–10 UTC, the
registration is opened at 17:05 UTC, and the job needs 100 minutes.
