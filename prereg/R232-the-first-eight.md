---
id: R232-the-first-eight
step: R232
opened: 2026-11-26
arms: none
sample: 456
gates: V0
---

# R232 — the block is the first eight asks, and the ninth is where the work is

Registered 26 November 2026 by R231's reading, **after** it and not before. **No dispatch.** R231 answered the
question the lane has been asking since R217 — *where does the requirement live* — and the answer is: in the
contract's turn as a whole, plus every later clause that carries its own verb. That rule recovers 154 of the 155
later-turn writes (99.4%) and covers **95.4%** of the 654 required writes, against the contract's 63.6%. It failed its
efficiency bar at 17.72 items per rescued write, and that failure is a price, not a mechanism: the corpus offers
5,311 asks across 2,453 user turns for 654 required writes.

So the block can be made nearly complete. It cannot be made small, and that is where the product enters the
measurement for the first time in this lane:

> the block is rendered as `items[:MAX_ITEMS]` — **eight lines**, in the order the asks were stated

A board with 3,699 items is cut to eight. If the required ask is the twelfth stated, the agent never sees it, and a
coverage of 95.4% is a property of an artefact nobody is shown. R231's result is therefore not actionable until the
display is measured, and the shipped default has not moved in seven rounds for a reason this round may finally name.

## What the round builds

No new admission rule. One measurement of the artefact as it is rendered:

    at the moment of each graded write, take the messages before the call, build the board the product would serve,
    keep the first MAX_ITEMS items, and ask whether an **open** item of the write's family is among them

That is `--scope displayed`. It differs from every previous board in one way and it is the whole round: the previous
boards ask what the transcript *supports*, and this one asks what the agent *sees*.

Two scopes are displayed side by side, because the round's question is a comparison and not a level: the contract's
board (`request`) and R231's (`clause`). The first eight of the contract's 2.4 items an episode are almost all of it;
the first eight of the clause board's 9.2 are a fifth of it.

## The bars

- **B1 displayed coverage**: on at least one scope, **73.6%** of the discharged required writes must have an open item
  of their family displayed at the moment the write happens. Same absolute bar as R231's B3, because the round is
  asking whether the coverage that round measured survives being displayed.
- **B2 hidden share**: for the scope that passes B1, the required writes it covers but does **not** display must be at
  most **20%** of the writes it covers. A rule whose coverage is four fifths invisible is a rule that changes the
  instrument and not the product, and the twenty is registered rather than fitted.
- **B3 no display tax on the contract**: the contract's displayed coverage must be within **4 writes** of its full
  coverage (63.6% of 654 is 416, so 412). The contract board is the shipped one; if the cap costs it anything, the cap
  is the finding and not the clause rule.

## Prediction

- **B1 probably holds on the contract and probably fails on the clause board**, and the failure is the useful one: the
  contract states 2.4 asks an episode against a cap of 8, so the display is almost never full when it matters, while
  the clause board states 9.2 and fills the display before the task's second ask.
- **B2 is where the clause rule is expected to die**, and it should: 1,153 of its asks are inheritance-reached objects
  offered *after* the contract's turn, and the display order is statement order, so those objects sit behind the first
  eight lines.
- **B3 should hold easily**, and it is registered because a bar that only ever fires on the new rule is a bar that
  cannot fail and therefore cannot inform.

## Refutation

- **B1 failing on both scopes** means the cap is not the instrument's problem and the lane's whole coverage column has
  been measuring a block that no agent reads — which would be the largest correction in this lane's history and would
  retire the coverage axis until the display is redesigned.
- **B1 and B2 holding for `clause`** means the display order is what makes the clause rule shippable, and the
  round's successor is the ordering rule (recency, or open-before-settled) rather than an admission rule.
- **B2 failing while B1 holds** means the rule's coverage is real, displayable in principle, and invisible in fact at
  the shipped cap — so the next round is `MAX_ITEMS` and the ordering, with the coverage column held fixed.
