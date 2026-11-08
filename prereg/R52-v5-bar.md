---
id: R52-v5-bar
step: R52
opened: 2026-11-08
arms: memory,reference
sample: 200
gates: V1,V2,V3,V5,V6,V7,V8,V32,V44
recallFloor: 0
facadePair: off
---

# R52 — the resolution gate becomes a contract about claims, and the power target becomes a report

**Registered** 2026-11-08, undispatched. It changes the shared protocol, so it is
written down before anything is built rather than inside the build.

## The contradiction R50 could not remove

`V5-resolution` blocks unless the minimum detectable difference is at most 6pp. On
τ² retail that number is **13.73pp at n = 50** and **9.05pp at all 115 tasks**: the
scenario's entire population cannot resolve 6pp at pass^4, at any effect size, for
any mechanism. The gate is therefore red on every τ² dispatch and will be red on
every future one. R50 fixed the finding gate that shared this pathology and left V5
alone on purpose — the bar it enforces is a constant of a protocol shared with the
BIRD lane, where 350 questions and 1,534 questions do reach it.

The cost of leaving it is now the thing R50 was created to remove: a permanently red
line. The benefit of leaving it is that V5 is *true* — the sample really cannot
resolve 6pp — and a bar that is true should keep saying so.

Both can hold at once, and that is what this registration proposes.

## The one thing that changes

V5 stops asking "is this sample good enough for a 6pp claim" — a question a lane can
fail for reasons no mechanism can fix — and asks **"does this run claim more than its
sample can resolve"**, which is a question about the run and is answerable on every
scenario.

| Reading | Before | After |
| --- | --- | --- |
| what V5 blocks on | `detectablePp` above 6 | a claim finer than `detectablePp` |
| what the 6pp bar becomes | the pass condition | `protocol.powerTarget`, reported and not blocking |
| who supplies the target | the protocol, as a constant | the scenario, defaulting to 6pp |
| what a lane that cannot reach it does | fails, on every dispatch | reports `UNRESOLVED` and claims nothing |

The pass condition, stated once: **`detectablePp` at or below `powerTarget`, or the run's verdict
is `UNRESOLVED`.** Since R50's `pairedVerdict` already produces `UNRESOLVED` exactly
when `|delta|` is below `detectablePp`, and produces `BENEFIT` only when `|delta| >=
detectablePp`, the two halves of the condition are the same statement seen from the
run and from the protocol. A run that reports a direction it cannot resolve fails,
and nothing else does.

This is not a loosening of the 6pp bar. The bar still appears in the artefact, still
in the summary line, and still decides what a lane may say when it *can* reach it. It
stops deciding whether a scenario is allowed to have produced a measurement.

## What must not change

- `V5-resolution` keeps its identifier. A gate renamed is a gate every committed
  readback stops finding.
- BIRD keeps 6pp, because it reaches it; `protocolGates` must accept the target as an
  input with 6 as the default, so a lane that passes no target behaves exactly as
  today.
- `pairedVerdict`'s `BENEFIT` clause is not relaxed. If a run may claim a direction
  only above its resolution, and V5 blocks only below it, the two agree by
  construction rather than by coincidence.
- τ² supplies its target from the scenario listing, not from a hope: at 115 tasks and
  the observed discordance the number is 9.05pp, and a target below it would be a
  target written to be met.

## Prediction

- No committed artefact changes state. R47, R48, R49 and BIRD's published cells all
  read the same verdicts after the change as before it, because the change is a
  condition on *new* dispatches and the old artefacts carry no `powerTarget`.
- A τ² dispatch after this change passes V5 while its artefact records
  `powerTarget: 9.05pp` and a verdict of `UNRESOLVED`. If it passes with a `BENEFIT`
  claim below nine points, the condition is being read from the wrong side.
- BIRD's cells are unchanged to the digit, because the default target is the
  constant that was there.

## Refutation

- If any committed BIRD or τ² artefact changes its verdict, the default did not
  survive the transplant and the change is reverted rather than patched.
- If a run passes V5 while claiming a `BENEFIT` smaller than its own
  `detectablePp`, the two halves have diverged and the registration is abandoned:
  the whole point is that the protocol and the readout cannot disagree.
- If `powerTarget` is ever supplied from an environment variable or a dispatch
  input, the registration is void. A bar a caller can type is a bar that will be
  typed to pass, which is the failure the pre-registration discipline exists to
  prevent.
- If a lane can pass V5 by reporting nothing at all — a run that measured nothing —
  the replacement has reproduced the vacuous pass R50 spent an iteration removing,
  and it is abandoned.
