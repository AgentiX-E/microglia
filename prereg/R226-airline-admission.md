---
id: R226-airline-admission
step: R226
opened: 2026-11-26
arms: none
sample: 0
gates: V0
recallFloor: 0
---

# R226 — the airline grid, admitted or refused before it is bought

Registered 26 November 2026. **No dispatch, and no artefact beyond the ones already on disk.** R223 established the
admissibility test and used it twice, both times to cancel: an effect smaller than a grid's floor cannot be resolved at
any price, so a round that exists to detect one is a round whose answer is known in advance and is "no significant
difference". This round applies the same test to the only purchase the queue still holds — R217, the airline column —
and to the price the queue carries for it.

## The two numbers

| number | value | where it comes from |
|---|---|---|
| the smallest effect an airline grid of 50 tasks can resolve | **4.85 pp** at unlimited attempts; **6.72 pp** at four | `resolution.py` on R218b's 228 pairs with `--domain-tasks 50` |
| the largest effect the mechanism has produced anywhere | **7.90 pp** | R216, control → front, 114 tasks, the parser repairs |

The floor is computed by transferring retail's decomposition (`var(m) = 0.20247/m + 0.01496`) to a 50-task domain. That
transfer is an **assumption and not a measurement**: `b`, the task-heterogeneity term, is a property of the domain, and
airline's is unknown until an airline grid exists. What the assumption buys is an order of magnitude, and the order of
magnitude is what the test needs — a floor that lands anywhere between 3 and 7 points decides the same thing.

## Verdict: admitted, at the four-attempt rung, by 1.18 points of margin

**7.90 > 6.72**, so a 50-task grid at four attempts can see the mechanism at its measured size, and the round passes
admission. It passes by **1.18 points**, which is the whole of the margin and has three consequences that have to be
stated rather than discovered later:

1. **The effect has to transfer at 85% of its retail size.** 6.72 / 7.90 = 0.85. A transfer at two thirds of retail's
   effect is invisible on this grid, and a null reading would then be a statement about the grid rather than about the
   mechanism — the exact failure mode R222 and R224 were cancelled for.
2. **The one-attempt rung fails admission outright.** At one attempt the same grid resolves 12.24 pp, so the four
   attempts are not a luxury; they are what makes the round admissible at all.
3. **The floor is not lowered by attempts.** 4.85 pp at 50 tasks against 3.21 pp at 114: airline is a **worse**
   measuring instrument than retail per task, because it has fewer independent tasks. What airline buys is not
   resolution — it is a second domain, and a domain is the only thing that can say whether a finding is about memory or
   about retail.

## The price, corrected

The queue carries **¥5.4** for R217. That figure was registered when the round was one attempt an arm; the design it now
needs is four attempts over two arms, which is **400 episodes**, and the lane's own measured rate is $0.0052–0.0056 an
episode:

| grid | episodes | price at the measured rate | the figure in the queue |
|---|---|---|---|
| 50 tasks × 4 attempts × 2 arms | 400 | **$2.20 ≈ ¥16** | ¥5.4 |
| 50 tasks × 1 attempt × 2 arms | 100 | $0.55 ≈ ¥4 | — |

So the queue's price was **3× short**, and it was short in the direction that makes a round look affordable
(AUDIT 34.316). The corrected price is ¥16, and it is still the cheapest item on the queue by two orders of magnitude
against the $68.7 that was cancelled.

## What the round still needs before it can be dispatched

The board is a **retail parser**: `FAMILIES` maps retail write tools to ask families, and an airline transcript's
writes (`cancel_reservation`, `update_reservation_flights`, `update_reservation_baggages`) are not in it. A dispatch
today would serve a block whose items never settle, which is not a null result — it is a broken instrument reporting
one. That work is **R217a**, registered at ¥0 beside this document, and its bar is a census rather than a dispatch: the
airline tasks carry their own required actions, so the parser's recall on them is measurable before a cent is spent.

## Prediction

- **The airline board will fire on fewer asks per task than retail's.** Airline requests are policy-dense and singular
  ("cancel reservation EHGLP3"), and the retail parser's set-ask machinery exists for a catalogue domain.
- **R217 will read within ±6.7 pp of control, whatever the sign**, unless the transfer is nearly complete. That is not a
  prediction about memory; it is a prediction about the grid, and it is the reason the round's bar is written at the
  four-attempt rung rather than at the mean.
- **The airline column on the board is not saturated** — top 84.0, median 63.8 over 24 rows — so unlike retail, a real
  effect there would be visible in the *ranking* even when it is inside the floor. That asymmetry is the argument for
  buying the domain at all.

## Refutation

- **An airline grid whose `b` lands above 0.0150** raises the floor above 4.85 pp and makes the four-attempt rung
  inadmissible in turn; the honest response is to stop at 50 tasks and report the domain as unresolvable rather than to
  buy attempts.
- **A parser census below the retail parser's recall** refutes the transfer premise and closes R217 before dispatch: a
  block that cannot see its own successes is the defect R215 spent a round repairing, and it would have to be repaired
  again in a domain where the repairs were never measured.
- **A price above ¥20 at the measured rate** would make R217 more expensive than a retail replication, and the round
  would then have to argue for the domain rather than for the resolution — which is a different and weaker case.
