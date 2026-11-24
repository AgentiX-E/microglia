---
id: R213-debit-and-verdict
step: R213
opened: 2026-11-24
# Three arms in one world: no note, the paraphrase this lane has always served, and the evaluator's own
# verdict. The question is not whether memory helps on average -- R212 answered that -- but whether the
# paraphrase was the harm.
arms: three
sample: 24
gates: V0
recallFloor: 0
facadePair: off
facadeNotes: off
facadeShapes: off
distillScope: all
distillUnit: raw
rawCeiling: 2000
serveBody: guidance
speakMargin: 0
trials: 4
trainDomain: retail
testDomain: retail
recallDomain: retail
packBudget: 2400
taskSplit: official
trainTasks: 0
testTasks: 24
release: v1.0.1
claimRuler: interval
---

# R213 — the material may be wrong, not inert

**Registered** 2026-11-24, before the dispatch. R212 bought a behavioural answer (12/30 against 13/34, `NO_LIFT`)
and left two facts unexplained: the treatment's `pass^4` fell from 5/24 to 2/24, and its check-level transitions
showed 43 requirements broken against the control's 37 while repairing 40 against 38. A rate that nets two
opposite movements cannot say whether the material did nothing or cancelled itself.

## What the record already says, for free

`eval/tools/memory_debit.py` re-reads R212's two arms per requirement rather than per episode, and then asks
whether the note was even about the requirement that failed:

| reading | control | paraphrase |
|---|---|---|
| opportunities / rescued | 13/34 (38.2%) | 12/30 (40.0%) |
| requirements repaired | 38/85 (44.7%) | 40/83 (48.2%) |
| requirements broken | 37/332 (11.1%) | 43/334 (12.9%) |
| net (repaired − broken) | +1 | **−3** |
| admission bar `breaks/(repairs+breaks)` | — | 51.8% vs base 48.2% (headroom −3.6 pp) |

| reading | value |
|---|---|
| unmet requirements the note names | 40 of 82 (48.8%) |
| repaired when named | 22/40 (55.0%) |
| repaired when silent | 17/42 (40.5%) |
| exact p | 0.27 |

**The material is pointed at the wrong requirement half the time**, and where it names a requirement that
requirement is repaired 14.5 points more often. That association is not a causal claim — a note may name the easy
ones — but it is the only movement in this lane larger than its noise, and it has a mechanical explanation the
verdict removes: a summariser writing a sentence about a conversation can miss the one check that decides it.

## The three arms

| arm | material | model calls per failure | length |
|---|---|---|---|
| `control` | none | 0 | — |
| `paraphrase` | R208/R212's sentence, written from trajectory + verdict | 1 | 439 chars mean |
| `verdict` | the evaluator's verdict served as written (`--note-source verdict`) | **0** | 447 chars mean |

Same twenty-four hard tasks, four rounds, seeds shared within a round, all three arms in one dispatch. 288
episodes, **≈ $1.50 (¥10.7)**, ~50 minutes at concurrency 3. The verdict arm is the cheaper of the two materials
because it makes no summariser call at all.

## Prediction

- **P1** — the verdict arm's notes name **100%** of the unmet requirements of the attempt they came from, against
  the paraphrase's 48.8%. A mechanical prediction: if it fails, the renderer or the artefact is wrong and no other
  reading from this dispatch may be quoted.
- **P2** — the verdict arm repairs more requirements than the paraphrase arm (point estimate above 48.2%) and more
  than the control (above 44.7%), measured by `memory_debit`.
- **P3** — the verdict arm breaks **fewer** requirements than the paraphrase arm (below 12.9%), because a block
  that also lists what the attempt already met is the only part of a note that could prevent a break.
- **P4** — the verdict arm's admission bar falls below its own base repair rate (headroom ≥ 0), i.e. the population
  stops being net-negative at the requirement level.

## Refutation

- **If P2 fails** — repair at or below the control's — then naming a requirement does not cause its repair, the
  +14.5 pp association was confounding, and the material is inert whatever its selection. The next spend then
  leaves this mechanism entirely: no within-task sentence can be made to work, and the lane moves to cross-task
  material where the material exists before attempt 0 and `pass^k` is a legitimate endpoint.
- **If P3 fails** — the verdict arm breaks at least as much as the paraphrase — then the harm is not the prose and
  not the selection, and the break channel is a property of serving a block into a long policy-following
  conversation. That would close `serveBody: guidance` as a product default.
- **If P4 fails** — the population stays net-negative — a gate cannot pay for itself on this material (`b/(r+b)`
  above the base rate), which is R34's finding arriving on a second corpus and ends the admission line here.
- **If P1 fails** — nothing else from the dispatch is read.

## What this does not claim

The verdict is the evaluator's text. A product without an evaluator cannot serve it, and this arm is therefore a
measurement of the ceiling the material *could* reach with a perfect checker, not a deployable configuration. The
deployable question — how to get a verdict without a reward — is `P2`'s verify-then-admit, one step down the
roadmap, and it is the reason this registration measures the ceiling first.

## The instrument

`eval/tools/memory_debit.py`: repair, persistence and break per requirement, exact Fisher tests on both movements,
the admission bar, and the naming association. 79 self-check cases, 99% line and branch coverage, one file, no
model call. `eval/drivers/tau2/notes.py` gains `note_from_verdict` and `verdict_writer`; `run_split.py` gains
`--note-source`, so the arm is a dispatch argument rather than a second driver.
