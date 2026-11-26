---
id: R233-the-order
step: R233
opened: 2026-11-26
arms: none
sample: 456
gates: V0
---

# R233 — the cut was never the problem; the order was

Registered 26 November 2026 by R232's reading, **after** it and not before. **No dispatch.** R232 asked what the agent
sees and the answer retired the round's own worry: the block is not a 3,699-item artefact cut to eight lines, it is 8.10
items at the moment of a clause-board call and 2.41 at a contract-board one, so the cap hides 14 of the 636 writes the
clause board reaches (2.2%) and costs the contract nothing (463 shown, 463 reached). Two of the three bars hold and the
third fails on a reference quantity, which is a defect in this instrument and not in the rule.

What the fourteen are is the next question, and the round that produced them already answered it in miniature. The one
hidden write inspected by hand was the ninth line of a twelve-item block:

```
1. cancel    open      5. return   settled   9. modify  open   <- needed here
2. cancel    open      6. return   open
3. return    settled   7. return   open
4. return    settled   8. return   open
```

Five of the first eight lines were one family, three of them settled, and the ask the write needed was open the whole
time. The block lists asks **in the order they were stated**, so a settled ask from the contract outranks an open one
stated later — and the cap then hides a live requirement behind finished work.

## What the round builds

One ordering, applied where the block is rendered and nowhere else:

    open items first, settled items after, statement order preserved within each group

It is content-free: no model, no score, no vocabulary. Its only input is the `settled` flag the board already computes,
which makes it the cheapest rule this lane has ever tested and the only one that cannot change what the board *knows* —
only which eight lines an agent reads.

## The bars

- **B1 displayed coverage**: the clause board must show an open ask of the write's family for at least **634 of 654**
  required writes (**97.0%**) on the control grid, against 622 (95.1%) unordered. An ordering that still hides twenty
  writes has failed the purpose it was registered for; the ceiling is reach, 636.
- **B2 no cost to the shipped board**: the contract's ordered displayed coverage must be **at least 463**, its unordered
  level. A contract board is 2.41 items a call, so an ordering can only help it — unless its asks are settled early,
  in which case this bar is the finding.
- **B3 hidden share**: on the clause board, at most **1.0%** of the writes it reaches may be hidden (**≤ 6 of 636**),
  a tenth of R232's 2.2%. The bar is a tenth because the ordering is supposed to remove the mechanism, not shave it.

## Prediction

- **B1 holds and lands near the ceiling.** The mechanism is mechanical: every hidden write R232 found was hidden by a
  settled item, and moving settled items below open ones can only lift open items into the window.
- **B2 holds trivially.** The contract board averages 2.41 items a call, under the cap before any ordering is applied,
  so the reordering cannot change which items are in the first eight unless a call carries more than eight.
- **B3 is the one that can fail**, and if it does the cause is named in advance: the corpus offers 8.1 asks a required
  write, so a block can hold more than eight **open** items and the cap binds on openness rather than on settlement.

## Refutation

- **B1 failing while reach is unchanged** means the block holds more than eight open items at the moment that matters,
  so the binding constraint is the cap and not the order, and the successor is `MAX_ITEMS` or a one-line-per-family
  grouping — the first change in this lane to a rendering parameter rather than to a rule.
- **B2 failing** means the contract's own asks are settled before the calls that need them, which contradicts the
  contract board's 2.41 items a call and would point at the settlement rule rather than at the ordering.
- **Both holding** means the display axis is closed at the product's cap, and the lane's remaining question is the one
  it has deferred for three rounds: whether any of this changes what a model does. That is R234, and it is the first
  round since R223 that has to buy tokens.
