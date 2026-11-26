---
id: R234-one-line
step: R234
opened: 2026-11-26
arms: none
sample: 456
gates: V0
---

# R234 — the block fills its window with repetition

Registered 26 November 2026 by R233's reading, **after** it and not before. **No dispatch.** R233 moved the ordering and
recovered ten of R232's fourteen hidden writes: the clause board shows an open ask for 632 of the 654 required writes
(96.6%) instead of 622, hides 4 instead of 14, and costs the contract nothing. It missed its own bar by three writes,
and the residue is uniform enough to name in one line:

| episode | the ask the write needed | its position among **open** asks | open asks on the block | block length |
|---|---|---|---|---|
| a4beb7a0 | `modify` | 10 | 15 | 15 |
| c7a5a0cf | `modify` | 9 | 11 | 11 |
| 2c110c2f | `modify` | 10 | 39 | 41 |
| a3d01c11 | `modify` | 11 | 16 | 16 |

Every one is a `modify` behind nine to thirty-nine **open** asks of other families, and the families in front of it are
not diverse. The 41-item block holds nine `address` asks; the 15-item block holds eight `address` and three `exchange`.
The user restates, and the parser is right to record each statement: they are separate turns, separate clauses, and the
board is asked which obligations exist, not which are distinct. The window then spends its eight lines on the same
obligation nine times.

## What the round builds

One rendering rule, applied after the ordering and before the cut:

    one line per family — the first open item of each family, in statement order

It removes nothing from the board and changes no settlement: the folded lines are still there, they are simply counted
once when the window is filled. The rule is content-free in the same sense R233's is — its input is the item's family,
which every board already carries.

## The bars

- **B1 displayable**: the clause board must show an open ask for at least **645 of 654** required writes (**98.6%**).
  That is not a round number chosen for comfort: 645 is what B1's 97.0% bar plus the four residual writes plus three
  more would give, and the registration states it as the round's own target rather than as an increment.
- **B2 no cost to the shipped board**: the contract's grouped level must be at least its own statement-order level
  (463 on the control grid). A contract board is 2.41 items a call and holds few repeats, so this bar should be free —
  and it is registered because a rounding change that costs the shipped board is a change that has to be argued for.
- **B3 hidden share**: at most **0.5%** of the writes the clause board reaches may be hidden (**≤ 3 of 636**), against
  R233's measured 0.6%.

## Prediction

- **B1 holds.** Folding nine `address` lines into one lifts the `modify` ask from position 10 to position 2 in the
  widest case, and no case in the residue needs more than three lines once the families collapse.
- **B2 holds trivially**, for the reason above.
- **B3 is the one at risk**, and the risk is structural: a block whose open asks span more than eight **families** cannot
  be displayed at eight lines no matter how it is folded. If the residue survives, it survives as breadth rather than as
  repetition, and that is a different problem — one the cap cannot solve and a ranking could.

## Refutation

- **B1 failing with the folded count unchanged** would mean the residue is breadth, not repetition, and the lane's
  rendering axis is closed: no content-free rule can put nine distinct families in eight lines.
- **B1 and B3 both holding** closes the display axis at the product's cap and makes the next round the one this lane
  has deferred since R223 — whether any of it changes what a model does. That is R235, and it is the first round since
  R223 that has to buy tokens: ¥34 for the clause rule's accuracy dispatch on the grid already paid for.
- **B2 failing** would mean the folding costs the shipped board, which would point at the contract board's own repeats
  and make this a selection rule rather than a rendering one.
