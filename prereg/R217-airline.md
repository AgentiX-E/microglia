---
id: R217-airline
step: R217
opened: 2026-11-26
arms: [control, board]
sample: 400
gates: V0
recallFloor: 0.6
---

# R217 — the airline column: 50 independent tasks, a second domain

Registered 26 November 2026, **re-scoped** by R226. The round was first written as a transfer test of a four-rule
retail parser and priced at ¥6 for one attempt an arm. Both of those numbers are now stale, and the round's own
instrument is what says so: the design it needs is four attempts over two arms, which is 400 episodes and about
**CNY 16**, and the question worth its price is no longer "does the parser transfer" but "does the *finding* transfer".

## Why this is the only purchase left

Retail's floor is **3.21 pp** at its 114 tasks and no attempt count lowers it (R223). Every retail round still queued —
R222's admission rule, R224's reconstruction, R224b's reveal-keyed gate — was cancelled because its effect sits below
that floor. What remains is the one thing that is not a retail measurement: **a second domain**. Airline holds 50 tasks,
its published column is unsaturated (top **84.0**, median **63.8** over 24 rows), and it is the only place where a
finding about *memory* can be separated from a finding about *retail*.

## What is measured

Two arms over the same 50 tasks, four attempts each, control against board. The registered reading is the paired
`pass_1` delta with its sign test, and beside it the three columns no row on the board publishes:

| column | what it is |
|---|---|
| `servedShare` | what fraction of episodes the block was actually written into |
| `skipDelta` / `serveDelta` | the treatment effect on the pairs a gate would refuse and on the pairs it would serve (R223's estimator) |
| stratified reading | the delta on the tasks the control solved every attempt against the tasks it solved some of — the +7.5 / −9.5 split, measured in a second domain |

## The bar, and why it is a bound

R226 prices the grid: **6.72 pp at four attempts**, **4.85 pp at the floor**, against a mechanism measured at **7.90 pp**
in retail. So the round passes admission by 1.18 points and the transfer has to be at least **85%** of retail's effect
to be visible. **A reading inside 6.72 pp is therefore a statement about the grid**, and it will be reported as one —
not as evidence that memory does not work on airline.

One secondary bar, carried from R216: the arm's cache hit rate must stay within three points of the control's. A
channel that cannot be served cheaply is a channel that will not ship whatever its accuracy.

## Prediction

- **The paired delta lands inside ±6.72 pp** unless the transfer is nearly complete. This is a prediction about the
  grid, not about memory, and it is written down before the dispatch so the reading cannot be re-narrated afterwards.
- **The stratification reproduces with the same sign if it is a memory effect**: harm on the tasks the control solves
  every attempt, gain on the ones it solves some of. A sign flip in a second domain would make the retail split a
  property of retail's task distribution.
- **The airline block will be thinner than retail's** — fewer asks, fewer settlements — because the domain's requests
  are singular and its receipts name itineraries rather than catalogue items.

## Refutation

- **A served-share far below retail's** (below 70%) refutes the transfer of the state channel and makes the round a
  measurement of an empty block; the reading would then be withdrawn rather than quoted.
- **A delta above +6.72 pp in either direction** is a resolvable finding and the first one this project has produced in
  a domain other than retail; it would be submitted to the board's airline column as a row with its served share, which
  no row there carries.
- **A floor recomputed from airline's own decomposition above 4.85 pp** means the domain is a worse instrument than the
  transfer assumed, and the round's next iteration would be more tasks rather than more attempts.
