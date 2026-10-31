---
id: R20-anchored-hold
step: R20
opened: 2026-10-31
arms: full-anchored,full-anchored-hold,anchor-blank,anchor-hold
sample: 350
gates: V1,V2,V3,V4,V5,V6,V7,V8,V12,V32,V44
---

# R20 — the square: is the permission the ingredient, or the block?

## Why this file exists

R18 put the anchored cell on the control it had never had and the control was worse than the mechanism.
`anchor-blank` — the same second pass, the same draft, nothing added — came back **4.00pp below no
memory** (p = 0.0336, one sign in all five folds), while `full-anchored` came back at **exactly** no
memory. The paired difference between them is **+4.00pp** (27 gained, 13 lost, p = 0.0385). So the
record's only positive mechanism is not a gain: it is a repair of a loss that appears the moment a draft
is handed back and asked to be revised.

That leaves one question, and R18 cannot answer it, because `anchor-blank` and `full-anchored` differ in
**two** things at once:

1. the block of 1.85 items, and
2. the instruction that closes the prompt — "if none applies, return the first attempt unchanged" —
   which `anchorPromptFor` deletes along with the block, on the grounds that an instruction referring to
   an absent block is a different question.

The second of those is a licence to stop. It is the only text in the anchored prompt that speaks about
the draft rather than about the note, and it is what R18's number is most plausibly made of: a revision
request with nothing to revise toward and nothing saying the draft may stand is harmful; a revision
request that ends "you may leave this alone" is free. If that is the mechanism, the product sentence is
*show the note and tell the model it may decline*; if it is not, the product sentence is *show the note*,
and the instruction is decoration that costs tokens.

Two sentences that differ in one clause and move 4pp in opposite directions is precisely the kind of
claim this record has learned to distrust, so it is registered as a 2×2 rather than asserted.

## The design

Four cells, `injects` × `instruction`, all writing twice and all scoring the second call:

|  | conservative instruction | permissive instruction |
|---|---|---|
| **block** | `full-anchored` | `full-anchored-hold` |
| **no block** | `anchor-blank` | `anchor-hold` |

1. **`full-anchored-hold`** — the same pack as `full-anchored`, the same draft, and the permissive
   sentence instead of the conservative one. One paragraph differs; nothing else does.
2. **`anchor-hold`** — the permissive sentence with no pack. This is the cell that decides the
   interpretation: it is the blind revision plus the licence to stop, and nothing else.
3. **`anchor-blank`** and **`full-anchored`** are R18's two cells, re-run so that all four come from one
   dispatch and one set of questions.
4. **`none` and `full`** are the run's anchors to its own baseline.
5. **One new mode, no new machinery.** `AnchorMode` gains `'hold'`, whose instruction is addressed to the
   draft and therefore renders when the pack is empty; the other two modes stay suppressed on an empty
   pack, because they refer to items that are not there. `ANCHOR_INSTRUCTION` is the whole implementation.
6. **No new gate.** V12 requires injected rules to carry a condition, V32 requires the fold to learn, V44
   reconciles the store's domain-free items. V43 is inactive: no arm in this dispatch declares a standing,
   and a standing on `full-anchored-hold` would put a second sentence about the same block into the cell
   whose variable is the sentence.

## Prediction

- **`anchor-hold` is at or above `anchor-blank`, by 3 to 5pp.** This is the iteration's confirmatory
  claim. Blind revision costs 4.00pp; if the cost is "being asked to change something for no reason",
  saying "change only what is wrong" removes it. Expected `anchor-hold` within 1pp of `none`.
- **`full-anchored-hold` − `full-anchored` lies within ±2pp.** If the block already carries its own
  licence, the explicit sentence adds nothing and the two block cells are the same cell. This is the
  prediction that decides the product sentence, and a null here is a result rather than a failure.
- **The interaction is the finding.** `(hold − conservative | block) − (hold − conservative | no block)`
  is positive if the permission matters only where there is a block, and zero if the permission is doing
  the work everywhere. Either sign is interpretable; the design exists so that the sign is readable.
- **`full-anchored` and `anchor-hold` both land within 1pp of `none`**, reproducing R18's two readings.
- **`full` stays non-positive**, without a magnitude prediction: R18 broke a five-draw streak at −0.57pp
  and this record no longer has a defensible expectation for the size.

## Refutation

- **`anchor-hold` within 1pp of `anchor-blank`, both below `none`.** Then the permission is not the
  ingredient, R18's explanation is wrong, and the difference between the two conservative cells is the
  block itself — a note of 1.85 items shown beside a draft, worth +4.00pp with nothing said about how to
  use it. That would be the first positive reading for memory content in this record and it would
  contradict five closed axes at once, so it would be re-dispatched before anything is written about it.
- **`anchor-hold` at least 2pp *below* `anchor-blank`.** Then words cost what they cost and this sentence
  costs more than the harm it repairs, which is R17's `none-advisory` result generalised: the only text
  that helps is text that removes text. That outcome closes the prompt-intervention family entirely and
  leaves utility clearance (R19.2) as the only untried mechanism.
- **`full-anchored-hold` at least 2pp below `full-anchored`.** Two instructions about the same block are
  worse than one, and the permissive sentence does not compose with the conservative one. That is a
  finding about prompt length at the anchored position, and it makes every additional sentence in this
  family a cost rather than a candidate.
- **All four revision cells within 1pp of `none`.** Then nothing about the revision is measurable at this
  n and the iteration is inconclusive rather than null; it is re-dispatched.

## Resolution, stated before the run

R18 resolved 4.00pp on the paired difference it cared about with 40 discordant pairs (p = 0.0385), and
3.76pp on a marginal cell. The differences this iteration registers are of that size or larger — the
confirmatory one is predicted at 3 to 5pp — so:

1. **The confirmatory cell is `anchor-hold` − `anchor-blank`**, a paired McNemar over questions both arms
   answered. It is the only number that gets a verdict on the permission hypothesis.
2. **The interaction is reported with its interval and not tested.** Four cells at 350 questions give an
   interaction variance that this lane cannot resolve; it is reported as a decomposition of two main
   effects and no claim is attached to its sign.
3. **A null on the block row (`full-anchored-hold` ≈ `full-anchored`) is the product result.** It says the
   instruction is decoration wherever there is a note, the sentence is dropped from the shipped prompt,
   and the anchored arm's documentation loses a clause rather than gaining one.

## What a positive result would license

`anchor-hold` at or above `anchor-blank` **and** `full-anchored-hold` ≈ `full-anchored` licenses the
sentence: *the store may be consulted when a draft already exists, provided the reader is told the draft
may stand* — with the instruction attributed to the harm it repairs rather than to the note it
accompanies. It would still not license always-on injection, and it would not license calling the anchored
cell a gain: the best outcome on the table leaves it at no memory, which is the first time this project
would have a memory mechanism that is *free* rather than a mechanism that is *worth something*.
