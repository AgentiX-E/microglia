---
id: R211-rescue-rate
step: R211
opened: 2026-11-24
# One arm, because the other side was bought on the twenty-fourth of November and is committed as a document:
# `eval/manifests/note-bank-baseline.json` is R208's bank stripped to the four fields a conditional rate needs.
arms: treatment
sample: 50
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
trials: 2
trainDomain: retail
testDomain: retail
recallDomain: retail
packBudget: 2400
taskSplit: official
trainTasks: 0
testTasks: 50
release: v1.0.1
claimRuler: interval
---

# R211 — the rate a note has to beat

**Registered** 2026-11-24, **built** 2026-11-24 before its dispatch. It replaces R210's planned fold, which was
affordable and blind.

## What the fold would have measured

R210's next step was fifty failing tasks, two arms, four rounds — four hundred episodes, ¥12.5 at the price the
bank measured. Its headline was `pass^k` lift: the fraction of tasks that pass *every* attempt, treatment minus
control.

That number cannot move. `pass^k` is "all k attempts passed" (`r206_readback.py:109`), a note is written only after
a **failed** attempt, and the driver writes notes only between rounds (`run_split.py:1290`, `index + 1 < rounds`).
So:

- a task that receives a note has already failed attempt 0, and its `pass^k` is zero whatever the note says;
- a task that passes attempt 0 never has a note — the file is empty when attempt 1 opens — and evolves exactly as
  its control does.

The treatment's `pass^k` therefore equals the control's in expectation, for a perfect summariser and for a
useless one alike. Four hundred episodes would have bought a null that is a property of the endpoint rather than
of the material, and the lane would have recorded it as evidence about the notes.

The mechanism lives one level down: in the transition from a failed attempt to the one after it. That is the only
place a note can act, so that is what this registration measures.

## The counterfactual, already paid

R208's bank ran the whole split, four trials a task, no sidecar: 456 episodes, `pass^1` 81.4%, `pass^4` 56.1%,
$2.0103. Restricted to the fifty tasks it failed at least once:

| reading | value |
|---|---|
| attempt 0 fails | 23 of 50 (the other 27 pass and are not opportunities) |
| of those 23, attempt 1 passes | **15 (65.2%)** |
| all failing transitions, 114 tasks | 39 of 63 (61.9%) |

An attempt that follows a failed attempt passes nearly two times in three **with nothing carried at all**. A note
that "rescued seven tasks" has rescued nothing if five of them would have passed anyway. Every claim this lane
makes from here is stated against 65.2%, not against zero — which is also why R210's material specificity
(44.7% against a 23% chance rate) was the right measure to have built first.

The baseline is a committed document, not a memory: `eval/manifests/note-bank-baseline.json` carries R208's
rewards with the commit they ran at, the grid, and the bill.

## The arm

Fifty failing tasks, **two rounds, one arm**: 100 episodes. Round 0 is an ordinary attempt with an empty note
file; if it fails, the summariser writes a note from the attempt and its verdict (`--note-verdict`, R208's
material); round 1 opens with that note served.

Round 0 is also the arm's own control. No note exists before it, so its pass count is a sample from the same
process the bank was sampled from — 27 of 50 passed there — and comparing the two is a drift check that costs
nothing. It is the reason one arm can stand in for two: the assumption is measured inside the run rather than
asserted across two runs.

Two rounds and not four: the note is written at the end of round 0 and read at the start of round 1, which is the
whole mechanism. Rounds 2 and 3 add notes to a trajectory that has already been rescued or not, and they cost
another ¥6.3 to say so.

## Prediction

- **At least 18 of the fifty tasks fail attempt 0.** The bank failed 23; a run materially below that is a
  different population and the reading is about a grid that got easier, not about the notes.
- **Every note written is served.** The sidecar's own counters state lookups and hits, and a rescue rate with zero
  lookups is a rate over attempts that never saw the material.
- **The rescue rate is at least 65.2%.** Inert material reproduces the baseline; material that costs an attempt
  would fall below it, and that is a finding about the material rather than a failed run.
- **The drift check agrees within four tasks.** 27 of 50 either side is the expected agreement; a wider gap voids
  the comparison instead of widening the interval.

## Refutation

- **If fewer than 12 opportunities are observed, this registration is not testable** and the state is
  `NO_MEASUREMENT` with the reason in the artefact: fifty tasks four rounds deep failed 23 times at attempt 0, and
  a run that fails eleven times is a grid whose price was spent on successes.
- **If the drift check disagrees by more than four tasks, the comparison is void.** The bank would then not be
  this run's counterfactual — a provider change, a release change, or a task list that is not the one named — and
  the honest output is `DRIFT` with the two counts, not a delta.
- **If the arm's upper limit sits below 90.2% (the baseline plus the registered 25 points), the material has no
  behavioural effect at this scale.** That is `NO_LIFT`: a 25-point lift is excluded at n = 23, and the next
  dispatch must change the mechanism — EDV's verify-then-admit, which validates a note against the verdict before
  admission — rather than the wording of the sentence.
- **If the rescue rate rises but the exact test does not clear 0.05, the result is `INCONCLUSIVE`**, which is a
  statement about twenty-three opportunities and not about the material.

## Price, measured

| item | value |
|---|---|
| episodes | 100 (50 tasks × 2 rounds, one arm) |
| price per episode | $0.0044 (R208's bank, 456 episodes) |
| bill | **$0.44 ≈ ¥3.1** |
| wall clock | ≈13 min at concurrency 3, plus 9 min of install |
| window | off-peak only; the guard refuses a start inside the provider's 01–04 or 06–10 UTC bands |

The comparison this replaces was 400 episodes, ¥12.5, and blind. This one is a quarter of the price and can
exclude the effect it registers.

## What the product uses

Nothing yet, and deliberately. A note that does not change the attempt after it is a sentence the product should
not spend a call on, and R211 is the gate that decides whether `serveBody: guidance` stays. If the rate clears
90.2%, the next registration extends to four rounds and to the second domain; if it does not, the note lane's
material is replaced by an admission test rather than tuned.
