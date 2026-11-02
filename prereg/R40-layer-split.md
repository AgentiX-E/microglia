---
id: R40-layer-split
step: R40
opened: 2026-11-02
arms: none
sample: 130
gates: V72,V73,V74
---

# R40 — the layer split, and the table that stops being a paragraph

**Registered** 2026-11-02, before the move's readings were taken. **Stage**: R27 stage 3, the last
third of the protocol/adapter refactor (`ROADMAP` R27, `TECH-DESIGN` §17.64, `AUDIT` §24.7).

## What this round is, and what it is not

Stage 1 moved the gates and the paired statistics into `packages/protocol`; stage 2 made the τ² lane
supply them and narrowed the generality claim to the apparatus. Stage 3 is the move that was left:
**the SQL modules out of `eval`**, so that `core ← protocol ← sql ← eval` is a graph the compiler and
a gate can see rather than a sentence in a design document.

It changes no number. That is the whole claim, and it is also why the round needs its own
measurement: a move whose only evidence is "the tests still pass" is a move nobody can audit later,
and this project has already published one coupling table (`PROGRESS` §136) whose numbers were
measured once by hand and never recomputed.

## The claim under test

> The library is scenario-agnostic: `core` contains no scenario vocabulary in code, and the
> text-to-SQL surface is a known, bounded set of modules that can be moved without touching a
> single published number.

## Prediction

- **`core` names no scenario word in code** — every hit in it is inside a test. Measured by `V74`, which
  strips comments from all 37 core modules and counts the strict list.
- **between 10 and 14 modules outside the adapter keep a scenario word in code**, and therefore need a
  written reason rather than a move. Measured by `V72`; each one is a row in `DEFERRALS`.
- **the adapter package is 1,600–1,900 lines across 6–8 modules.** Measured by `layerTotals('sql')`.
- **every package edge points downward, and there are fewer than 10 of them.** Measured by `V73` over the
  parsed import graph.
- **the move changes no artefact**: `pnpm eval:protocol` revalidates all 31 committed artefacts, and every
  other `eval:*` reading in the chain rewrites its artefact byte for byte.
- **coverage does not regress**: four dimensions ≥ 95%, and `coupling.ts` at 100 on all four.

## Refutation

- **If any module outside `packages/sql` carries a scenario word with no written reason**, `V72`
  fails and the round publishes the gap rather than the split: the count would then be measuring
  what the move missed, which is the more useful number.
- **If any package imports upward**, `V73` fails and the dependency direction is withdrawn from the
  positioning text — it would mean the graph is a preference rather than a constraint.
- **If any committed artefact changes byte**, P5 is false, the move is not mechanical, and it
  reverts. The point of a mechanical stage is that it can be checked mechanically.
- **If `core` shows a scenario word in code**, `V74` fails and the README sentence it certifies is
  struck rather than qualified.

## What would make this round worthless

A gate that passes because it cannot fail. `V72` would be vacuous if the classification were derived
from the verdict rather than the other way round, so the classification is a table in the source and
the word count is computed — a module that is added to `eval` with `sqlite` in it fails the build
until someone either moves it or writes a reason. The three gates are therefore falsifiable by a
future merge, which is the only kind of gate this record accepts.

## Disclosure

The `DEFERRALS` table was written while placing the files, and the readings are produced by the same
command that grades them. So the round's epistemic weight is in **the gates and the artefact**, not
in its point estimates: a reader who distrusts the classification can rerun `pnpm eval:coupling` and
read the reasons for themselves, and the twelve reasons are one grep away from the twelve modules.
What the round does *not* claim is that twelve is the right number — it claims that twelve is the
number today, that each has a dependency named in writing, and that a thirteenth cannot arrive
silently.

## Cost

Zero model calls, zero dispatches, no dataset. One command over the working tree.
