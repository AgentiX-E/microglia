---
id: TEMPLATE
step: R0.0
opened: 2000-01-01
arms: none
sample: 1
gates: V0
---

# <step> — <one line naming the experiment>

Copy this file to `prereg/<id>.md` and replace every angle bracket. `pnpm eval:prereg` refuses a
copy that still contains one, and the `sota` workflow refuses a dispatch that names no file at
all. The header is what the gate reads; the two sections below are what a reader reads six weeks
later, when the number is in and the prediction is the only thing that can still be wrong.

## Prediction

- One bullet per claim, each one checkable against the artefact and false in principle. "The
  mechanism will help" is not a prediction; "the arm moves at least three points with an interval
  that excludes zero" is.
- State the number you expect, not only the direction: a prediction that cannot be wrong by a
  specific amount cannot be right by one either.
- Predict the instrument too. What would have to be true of the run for the result to mean
  anything — the answer rate, the gold execution rate, the number of rules exercised.

## Refutation

- The conditions under which the stage is abandoned rather than reinterpreted. Write them before
  the run, because after it every outcome has a story that explains it.
- Name the measurement that would end the line of work, not the one that would merely weaken it.
- Say what the alternatives are. A refutation that leaves the cause ambiguous turns the next
  stage into a search rather than a test.
