---
id: R53-use-time-calibration
step: R53
opened: 2026-11-08
arms: memory,reference
sample: 200
gates: V1,V2,V3,V5,V6,V7,V8,V32,V44
recallFloor: 0
facadePair: off
---

# R53 — the pack's instruction is the variable, and three levels of it

**Registered** 2026-11-08, undispatched. Blocked on R51's readback by the one-lane rule:
every arm is a comparison, and no comparison may be interpreted while another is open.

## Why this and not more retrieval

R51 fixed the two boundaries that dropped the question: the write side never saw it, the
read side ignored the condition. If packs now arrive with conditions attached, the next
question is what the model does with them, and the 2026 literature is unusually specific
about the answer.

- **MemTrapBench** ran five memory frameworks against no-memory on two model families.
  Every one scored worse, and the strongest still lost more than 10%. Its diagnosis is not
  relevance: a *correct, relevant* memory anchors the model to a frame that no longer fits
  the question. Its intervention is an inference-time instruction — no retraining, no index
  — and it recovers performance.
- **MemCalib** splits each retrieved atom's target influence into Ignore / Bound / Control
  and finds over-use, not under-use, is the dominant error. The best frontier model scores
  46.25 of 100.
- **RPEval** finds the same asymmetry with an inverse-scaling flavour: humans 0.86 at
  ignoring an irrelevant preference, GPT-5 0.12.
- **OP-Bench** attached five memory systems to four backbones and every one scored below
  the no-memory baseline.

Our pack already carries the mitigation in its weakest form: a note telling the model to
apply an item only where its condition holds. It is stated to a model that has just been
handed the rule, in the same breath, with no licence to disregard it.

## The one variable

`injectionNote` in `apply/pack.ts`. Same store, same recall, same items, same order — the
only thing that changes between arms is the sentence that precedes them, at three levels:

| Level | The note | Reads as |
| --- | --- | --- |
| `none` | empty | here are rules |
| `today` | apply an item only where its condition holds | here are rules, check the condition |
| `calibrated` | the above, plus: a recalled rule may describe a situation this request is not; where the rule and the current observation disagree, the observation is the evidence | here are rules, one of which may be a trap |

Three levels and not two, because the difference between `none` and `today` is already
measured on BIRD (half the answers changed, none of the scores), and the interesting
question is whether the *hardened* sentence does what AdaptiveMem reports.

## Prediction

- `calibrated` at or above `today` at the pair's resolution, and above `today` by at least
  the smallest effect 200 episodes can resolve. Below that, no claim is made either way.
- The delivery census is identical across the three arms to the digit: same packs, same
  items, same coverage histogram. If any of the three moves, the arms differ in something
  other than the note and the comparison is abandoned.
- The parse rate stays within two points of the `today` arm, because a note that costs the
  model its tool-call format is a note that changed the answer for the wrong reason.
- The abstention census does not rise: a licence to disregard a rule must not become a
  licence to stop acting.

## Refutation

- If the three arms' delivery censuses are not identical, the experiment varied more than
  the note and is abandoned rather than reinterpreted.
- If `calibrated` is below `today` by more than the resolution, the hardened sentence is
  harmful and the line is closed: the pack would then be carrying an instruction whose only
  measured effect is to make the model doubt good rules.
- If the note's level cannot be recovered from the artefact — no field naming which of the
  three ran — the arm measured nothing, because two runs of one level would read as three.
- If the effect appears only in the abstention census and not in `pass^4`, the mechanism is
  making the agent hesitate rather than right, and it is recorded as such.
