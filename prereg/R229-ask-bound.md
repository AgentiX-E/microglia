---
id: R229-ask-bound
step: R229
opened: 2026-11-26
arms: none
sample: 114
gates: V0
---

# R229 — an item is an ask, and the read supplies the binding

Registered 26 November 2026 by R228's reading, before that reading's second half was taken. **No dispatch.** R228
priced two rules against each other on the grid R218b already paid for, and neither is a working memory:

| board | coverage of discharged writes | unaccounted | unneeded open items per episode |
|---|---|---|---|
| read (strict) | 98.5% | 0 | 2.53 |
| request | 63.6% | 232 | 0.69 |

The read board **cannot miss a discharge** — every write in this corpus touches a record the episode opened, so its
`unaccounted` column is empty and its coverage is 98.5% against the request board's 63.6%, +169 episodes complete and
1 lost. It reads as the answer until the last column: it opens 2.53 items per episode that no required write needs,
because it opens an item for **every record the agent looked at**. The request board has the opposite failure — it only
ticks a *named* ask on a receipt that names the product, so it misses a third of the work and accuses 232 calls of
being unasked.

The two failure modes are not two tuning problems. They are one representational fact:

> what is required is only in the request, and which record a call touched is only in the read.

## What the round builds

    an item is an ask the request states
    it is settled by a successful write **of its family to a record the episode opened**, one ask per call
    a write that finds no open ask of its family, or finds one but touches a record no read opened, is unaccounted

Relevance comes from the request; attribution comes from the read. Neither rule above can express it: the request
board's settlement test asks a receipt to *name* the ask's object, and the read board has no notion of an ask.

**No fallback to the request board's containment rule.** A fallback would make the measurement a union of the two rules
rather than a test of one, and a union that passes says nothing about the conjunction.

## The bars, all three paired against the request board on the same episodes

- **B1 settlement**: the ask board covers at least as many discharged required writes as the request board, and is
  complete on at least as many episodes. This is the column R228's read board won by 34.9 points, and the question is
  whether the conjunction keeps that gain or pays it back for relevance.
- **B2 accusation**: writes the board accounts to nothing must not exceed the request board's 232. The ask board is
  narrower than the read board by construction — it only credits a write whose record was opened **and** whose family
  has an open ask — so this bar is the one that catches over-narrowing.
- **B3 soundness**: at least **0.90** of the board's ticks must be backed by a write the evaluator requires. The ask
  board cannot nag, so its cost is the other one: binding a write to the wrong ask in a family with several. 0.90 is a
  constant in the tool rather than a number in a paragraph, and it was chosen before the reading: below nine ticks in
  ten, a tick is not evidence, and the block's entire claim is that a tick is evidence.

## Prediction

- **B1 holds, with coverage near the read board's.** The gains R228 measured are losses of *attribution*, and the
  conjunction keeps the read's attribution while taking relevance from the request.
- **B2 holds and is small but not zero.** The conjunction drops the read board's unconditional credit, so some writes
  will find no open ask — a second cancel on a task that asked for one, chiefly.
- **B3 is the bar at risk**, and the risk is named: a task with one `cancel` ask and two records opened binds in the
  order the writes arrive, so a tick can name the wrong order.

## Refutation

- **B1 failing** means attribution was never the deficit and the request board's 63.6% is not a parser limit — the
  successor would have to explain what else it is, because two independent rules would then fail on the same episodes.
- **B3 failing** closes the conjunction and with it every anchor this lane has: request (R223), reveal (R225), record
  (R227), read (R228) and ask-bound (R229) would all be refused, and the honest statement is not "the content is weak"
  but "**the two halves cannot be joined by a rule of this shape**" — relevance and attribution come from different
  places and binding them costs either the thing that makes a tick true or the thing that makes an item required.

Either outcome is a result this project can publish: the first admitted anchor in five rounds, or the first measured
statement of *why* none can be admitted.
