---
id: R235-clause-accuracy
step: R235
opened: 2026-11-27
arms: 2
sample: 912
gates: V1
---

# R235 — the one question four ¥0 rounds could not ask: does any of it change what a model does

Registered 27 November 2026 by R234's reading, **after** it and not before. **Armed, not dispatched.** Four rounds have
now been read on a board no model was ever shown: R231 measured where the requirement lives, R232 measured the block the
product renders, R233 re-ordered it and R234 folded it. Together they closed the rendering axis at zero hidden writes
for **¥0**, and none of them touched a token of inference. The clause rule covers **95.4%** of the required writes
against the contract board's **63.6%**, displays **97.2%** of them at the product's own cap, and costs **8.10 lines a
call** where the contract costs **2.41**.

What has never been measured is whether an agent that reads a block holding an open ask for 97.2% of the writes the
evaluator grades succeeds more often than one that reads a block holding 70.8%. That is this round, and it is the first
round since R223 that buys tokens.

## What the round dispatches

Two arms over the same 114 retail tasks, four attempts each — **456 episodes an arm, 912 in the pair**, the grid R218b
already paid for and the only grid this lane has with both placements measured:

| arm | the board it serves | items a call | required writes it covers |
|---|---|---|---|
| `board` (carrier) | the contract's, unchanged | 2.41 | 63.6% |
| `clause` | R231's admission, R233's order, R234's fold | 8.10 | 95.4% |

Everything else is held: the same placement (`tail`), the same settlement grades (`name`, `overlap`), the same
`blockCeilingChars` of 500, the same task sample, the same seed, one attempt a task a trial (four trials).

## What it costs, before it is armed

Read from `eval/tools/resolution.py` over R218b's own pair, which is a ¥0 computation and not an estimate:

| attempts a task | episodes | minimum detectable effect | price |
|---|---|---|---|
| 1 | 228 | 12.24 pp | ¥9.0 |
| 2 | 456 | 8.89 pp | ¥18.1 |
| **4** | **912** | **6.72 pp** | **¥36.2** |
| 9.49 | 2,164 | 5.00 pp | ¥85.8 |

And the constraint that decides the design: **the domain's floor is 3.21 pp at unlimited attempts.** Repeating a task
buys attempts, not tasks, so no budget resolves an effect below 3.21 pp on 114 tasks — a smaller effect would need a
domain with more of them, which is the third-domain round and not this one. The round is therefore armed at four
attempts and priced at **¥36.2**, and it can see 6.72 pp.

## The bars

- **B1 non-inferiority.** The clause arm's pass rate must not be below the contract arm's by more than **3.21 pp** — the
  domain's floor, not a round number. A rule that covers 31.8 points more of the graded writes and makes the agent worse
  is a rule that converts completeness into contradiction, which is the failure mode R187 and R218b measured for a block
  that states an obligation nine times.
- **B2 the effect must clear the grid's own resolution.** If the clause arm is better, the difference must be at least
  **6.72 pp** to be read at four attempts. A smaller positive delta is reported as **UNRESOLVED at this sample**, not as
  a win: the lane has published one +4.8 pp pooled null (R219) and will not publish a second under a bar it cannot see.
- **B3 the mechanism must be present in the served artefact.** On at least **95%** of the served blocks the clause arm
  must carry an open ask of the family the episode later writes — the display measurement of R234, taken on the
  *dispatched* transcripts rather than on the replay. A round whose accuracy column moves without its mechanism moving
  is a round that measured something else.

## Prediction

- **B1 holds, and by a margin rather than at the bar.** The block's job is to keep an obligation live until it is
  written; 31.8 points more of the graded writes have a live ask in the clause arm, and the four orders of magnitude
  between a 3.21 pp floor and that gap is not a place this corpus has hidden a reversal before.
- **B2 is the round's real uncertainty.** 6.72 pp is a third of the coverage gap and twice anything this lane has
  resolved; the most likely outcome is a delta between zero and the MDE, reported as unresolved.
- **B3 holds by construction** and is registered anyway: it is the bar that would catch a dispatch whose arm did not
  receive the treatment, which is a failure this lane has had (R218d's `NO_DOSE`).

## Refutation

- **B1 failing** means more coverage made the agent worse, and the lane's whole display axis is then a measurement of
  the instrument rather than of the product: the block would be re-billing a contradiction, and the successor is a
  selection rule (which obligations to *omit*) rather than an admission rule (which to add).
- **B1 holding with B2 unresolved** is the expected null and is still a result: it says the coverage gap is not where
  task success lives, which relocates the lane's next four rounds to the third domain and to the external benchmarks
  rather than to a fifth content rule.
- **B3 failing with the accuracy column moving** means the replay and the dispatch disagree about what was served, which
  is the one defect that would invalidate the reading rather than refuse the rule. The round is then re-dispatched
  before anything is quoted from it.
