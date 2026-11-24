---
id: R212-paired-rescue
step: R212
opened: 2026-11-24
# Both arms, in one dispatch, at the same seeds: R211 measured the world and found that the bank is a different
# one. The comparison this registration makes is the only one that holds it.
arms: both
sample: 24
gates: V0
recallFloor: 0
facadePair: off
facadeNotes: off
facadeShapes: off
distillScope: all
distillUnit: raw
rawCeiling: 2000
serveBody: guidance
speakMargin: 0
trials: 4
trainDomain: retail
testDomain: retail
recallDomain: retail
packBudget: 2400
taskSplit: official
trainTasks: 0
testTasks: 24
release: v1.0.1
claimRuler: interval
---

# R212 — the control has to be bought in the same world

**Registered** 2026-11-24, **built** before its dispatch. R211 bought a reading for ¥3.1 and its own gate refused
it. This is what the refusal taught.

## What R211 measured

The arm ran: 100 episodes, 24.4 s each, **$0.4820** (¥3.4), fifty tasks at two rounds, one arm.

| reading | value |
|---|---|
| notes written / refused | **12 / 0** |
| verdicts shown | 12 |
| sidecar lookups / key hits / task hits | **103 / 13 / 13** |
| opportunities (attempt 0 failed) | 12 |
| rescued | 7 (58.3%) |
| drift check: attempt 0 | **38/50 vs bank 27/50** |
| verdict | **DRIFT** — the comparison is void |

Two things, and only one of them is a disappointment.

**The mechanism is live, at a hundred per cent, for the first time.** Twelve failures, twelve notes, twelve
verdicts, 103 lookups and 13 task hits: every note that was written was read, on the first dispatch in which the
sidecar met notes that exist. R206's pilot found nothing because nothing had been written; R207's found one refusal;
this is the first run in which the whole path from failure to served sentence executed end to end.

**The comparison is void, and the cause is my instrument.** The treatment's first attempts passed 38 of 50 where
the bank passed 27 of 50 — same tasks, same release, same `max_steps`. The drift gate fired, correctly. The reason
is a defect in the gate's own arithmetic: R211's tolerance of four tasks was described as "one standard error at
fifty", and that arithmetic assumes fifty independent draws. They are not independent. **One seed is shared by
every task of an attempt** (`run_split.py` derives round i's seed as `base + i` and every task in that round gets
it), so the seed is a random effect that moves all fifty tasks together. The unit of replication is the attempt's
seed, and there is one of them per arm. Eleven tasks of movement between two seeds is not a four-sigma surprise; it
is the between-world variance that a binomial standard error cannot see.

## What that changes

A baseline from another run is not admissible at this variance. The control has to be bought **in the same
dispatch, at the same seeds**, so that the two arms are two draws inside one world — the common-random-numbers
property, which is what makes the difference attributable to the note. This is exactly the second option offered
before R211 was dispatched (¥6.3 for both arms); it is now the only admissible one, and the ¥3.4 already spent
bought the measurement that says so rather than a number nobody could use.

Two further changes, both paid for by the same ¥3.4:

- **The population is the hard twenty-four** — the tasks the bank failed at least twice of four. Fifty tasks at two
  rounds yield 23 opportunities, and an opportunity is the only thing this design buys; four rounds over the
  twenty-four yield **44**, at 192 episodes against 400 for the same count over the fifty. The bank's pooled rescue
  rate on them is **20 of 44 (45.5%)** — harder tasks recover less, which is why the bar moves down with the
  population rather than staying at 65.2%.
- **The transitions are pooled.** On a four-round arm every consecutive pair is the same event — an attempt after a
  failure — with a note that by round three has accumulated two more sentences. `--pooled` sums them and the
  reading says `pooled` instead of `0->1`, so the claim stays legible.

## Prediction

- **At least 30 opportunities per arm.** The bank's own transition count on these twenty-four is 44 over four
  trials; a run materially below thirty is a world in which these tasks got easier and the reading is about that.
- **The two arms agree on attempt 0 within four tasks.** Same seeds, same tasks, same scaffold; anything else is a
  run that failed to hold the world it was supposed to hold.
- **Notes are written for at least half the failures.** R211 wrote twelve for twelve; a rate near half means the
  summariser is refusing on material the verdicts already explain.
- **The control's rescue rate is within ten points of 45.5%.** The bank's rate on this population is the only prior
  there is, and a control that misses it by more says the population, not the note, is what moved.

## Refutation

- **Fewer than twelve opportunities in either arm and the registration is not testable.** The state is
  `NO_MEASUREMENT`, exit 2, and the price was spent on successes.
- **A drift gap of more than four tasks between the two arms voids the comparison.** Both arms share a seed, so a
  gap here is not the world moving — it is a run that did not do what its argv says, and `DRIFT` is the report.
- **An arm whose upper limit sits below 70.5% (45.5% plus the registered twenty-five) has no effect at this scale.**
  That is `NO_LIFT`: the sentence is not the problem, and the next spend is EDV's verify-then-admit — a note
  validated against the verdict before it is served — which is measurable offline on the 85 stored failures for
  about ¥0.5.
- **If the control's own rescue rate lands outside 45.5% ± 10 and the treatment matches it**, the finding is about
  the population rather than about the note, and the lane's next question is which tasks can be rescued at all.

## Price, measured

| item | value |
|---|---|
| episodes | 192 (24 tasks × 4 rounds × 2 arms) |
| price per episode | $0.0044 (bank), $0.0048 (R211's arm, twenty-four seconds an episode) |
| bill | **$0.85–0.92 ≈ ¥6.0–6.6** |
| wall clock | ≈28 min at concurrency 3, plus 9 min of install |
| window | off-peak; the guard refuses a start inside 01–04 or 06–10 UTC |

R211's ¥3.4 plus this ¥6.0 is ¥9.4 — still below the ¥12.5 the cancelled fold would have cost, with a reading at
the end of it instead of a tautology.

## What the product uses

Nothing until the rate is read. If `RESCUED`, `serveBody: guidance` becomes a default rather than an experiment and
the next registration extends to the second domain; if `NO_LIFT`, the sentence stops being tuned and the lane moves
to admission.
