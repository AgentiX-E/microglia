---
id: R53-use-time-calibration
step: R53
opened: 2026-11-08
arms: memory,reference
sample: 228
gates: V1,V2,V3,V5,V6,V7,V8,V32,V44
recallFloor: 0
facadePair: off
facadeNotes: three-level
trainDomain: retail
testDomain: retail
recallDomain: retail
---

**Header repaired 2026-11-08, before dispatch.** `sample: 200` was the *cross-domain* pair's size —
fifty airline tasks at four trials — copied from R51, and the domain trio was missing entirely. Both
are the R16 defect: a header that describes the last experiment rather than this one. A same-domain
retail run is 57 held-out tasks at k=4 = **228 episodes**, and with no `recallDomain` declared the
workflow falls back to the repository variable `TAU_TEST_DOMAIN`, which is still `airline` — so a
dispatch of this registration as written would have compared a retail store against airline tasks and
called the result a note-level effect. Nothing below changed; the predictions are about levels of one
sentence and were never about a sample size.

**Control repaired 2026-11-08, before dispatch — the treatment cannot be three dispatches.** The
first refutation below reads *"if the three arms' delivery censuses are not identical, the experiment
varied more than the note and is abandoned"*, and no arrangement of three separate dispatches can
satisfy it. Two dispatches of one configuration differ in their corrections, because the model
produces them at run time: R54 distilled from ten corrections and R56 from eight on the same 32-row
learning fold, and their delivered-pair counts were 2,765 and 2,984. A registration whose control is
"the three arms are identical except for the note" therefore cannot be graded by running three arms;
it would fail its own first refutation every time, and the failure would be honest and useless.

The note is also not a per-arm property in the code. `note: NOTE_PLAN.mode` is passed to
`openMicroglia`, so it is fixed for the host, and R49's two facades share one host — which is why the
paired-facade pattern cannot carry three notes either without a change.

So this registration is **blocked on a capability, not on a switch**: the note has to become a
*rendering option of one recall* rather than a property of the process, and the three levels have to
run as three facades over **one** store, one learning phase and one seed — R49's pattern generalised
from two facades to three. What then differs between arms is the sentence and the answers it produces,
which is the variable; what cannot differ is the store, which is what "same store, same items" has to
mean. `TAU_INJECTION_NOTE` reaching the workflow (AUDIT 34.66) was necessary and is not sufficient.

**Capability built 2026-11-08, before dispatch.** The blocked item is no longer blocked, and
building it found one defect that would have made the first refutation fire on a confound rather
than on the note.

The defect: the note is an attribute of the wrapper and the wrapper is charged to the character
budget, so at a fixed budget the `hardened` sentence — about 110 characters longer than `standard`
— bought its room by dropping the last rule. At budget 320 the `standard` arm carried one item and
the `hardened` arm carried none. Three levels that carry different packs are three treatments, not
three levels of one, and *"the delivery censuses are identical to the digit"* would have failed for
a reason that has nothing to do with the sentence. `RenderOptions.budgetBasis: 'note-excluded'`
charges the budget to the block's data and counts the wrapper as if it carried no note, so all
three levels have identical capacity by construction; the historical accounting stays the default
because an upgrade must not change what a published number measured. The test was written red
first, and it is the test that found this.

The capability, in the order the data flows:

| Piece | What it makes true |
| --- | --- |
| `RecallQuery.note` | the level is a rendering option of ONE recall, so three facades can share one host and one store |
| `MicrogliaOptions.budgetBasis` | the host declares what its budget is charged for, and the artefact records it |
| `resolveFacadeNotePlan` (`TAU_FACADE_NOTES`) | the arm is resolved from this registration, refuses a simultaneous floor pair, and refuses a single declared level beside a three-level arm |
| `prereg-notes.ts` + `facadeNotes: three-level` | the dispatch cannot choose its own levels, and the workflow reads the declaration rather than a repository variable |
| three facades in `tau2-driver.ts` | one learning phase, one store, one seed stream, three evaluations; the `standard` arm stays the arm the rest of the lane grades |
| `packIdentity` in the artefact | the control as a number: for every request two arms both saw, the served statements must be equal |
| `l4-note-identity` gate + `r53_readback.py` | a run that fails the control is `IDENTITY_BROKEN` and blocks, instead of reporting a delta |
| `poc-l4-facade-notes.json` | three arms, two contrasts against `standard`, the census per arm, and the basis that made the control possible |

Nothing below is weakened by this. The three predictions and the four refutations stand as written;
what changes is that the first refutation becomes checkable, because one run over one store can
produce censuses that are comparable to the digit on the side that matters — the items each pack
carried for the same request — while the side that cannot be held (how many requests the agent chose
to make) is reported per arm instead of asserted equal.

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
  the smallest effect 228 episodes can resolve. Below that, no claim is made either way.
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
