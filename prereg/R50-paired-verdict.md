---
id: R50-paired-verdict
step: R50
opened: 2026-11-08
arms: memory,reference
sample: 200
gates: V1,V2,V3,V5,V6,V7,V8,V15,V16,V17,V32,V33,V44
recallFloor: 0.01
facadePair: as-is-floored
---

# R50 — a gate that could not pass is replaced by a state that cannot lie

**Registered** 2026-11-08, before any R50 dispatch, from the reading R49 produced.
Nothing about the memory changes in this registration. What changes is the sentence
the lane is allowed to say about it.

## The defect this registration answers

R49 (run `3ea349af`) fired two gates, and only one of them was about the memory:

```
[l4-pair] paired n=50 delta=-4.00pp [-14.00, 6.00] p=0.6875 lost=4 gained=2
[l4-pair] FAIL l4-paired: -4.00pp (p=0.6875, n=50)
[l4-pair] FAIL V5-resolution: minimum detectable 13.73pp
```

`l4-paired` passed only on `delta >= 0 && p` below 0.05. The pair's minimum detectable
difference on τ² retail is **13.73pp at n = 50**, and it is 9.05pp even at the
scenario's full 115 tasks — the scenario's whole population cannot resolve 6pp at
pass^4. So the gate was unreachable **by construction**: no effect the mechanism
could plausibly have, in either direction, can satisfy it here. A line that is
always red is not a gate; it is a line that teaches its readers to ignore red.

The failure `V5-resolution` exists to prevent was a design whose MDE was 21.4pp
against a 6pp bar **publishing a delta anyway**. The cure for that is not a
permanently red build on every scenario that cannot reach 6pp. It is a readout
that refuses to claim a direction it cannot resolve.

## The one thing that changes

`l4-paired` becomes the gate it was always described as mirroring — the R45
revert rule — and a second, non-blocking gate reports whether the pair resolves
what it is being asked about.

| Gate | Criterion | Blocks | State it produces |
| --- | --- | --- | --- |
| `l4-paired` | neither R45 revert branch fires | yes | `HARM` fails it; `BENEFIT` and `UNRESOLVED` pass it |
| `l4-effect-resolved` | `\|delta\| >= minimum detectable difference`, or no direction claimed | no | `UNRESOLVED` fails it; it is a statement about the sample, not about the memory |
| `l4-same-split` | both arms scored exactly the same tasks | yes | unchanged |

`V5-resolution` is **not** touched. It still says the sample cannot resolve 6pp, and
on τ² retail it always will. What changes is that the *finding* gate stops
pretending that statement is a failure of the memory.

The verdict is one of three states, computed by `pairedVerdict` in
`packages/eval/src/paired-verdict.ts` from the same two numbers the report prints:

- **HARM** — the R45 rule fired, called rather than copied. Blocking.
- **BENEFIT** — a positive delta, `p` below 0.05, **and** `delta >= detectablePp`. The third
  clause is new: without it a +4.00pp delta at an MDE of 13.73pp would be published
  as a benefit the experiment had already certified it could not see.
- **UNRESOLVED** — everything else, carrying `excludedAbovePp` so a reader learns
  what was excluded rather than merely that nothing was concluded. `claim` is
  `null` in this state, because a field that is always a string is a field a
  downstream writer will concatenate into a claim.

## Re-reading R49 under the new registration

This is a check of the instrument against a reading already in hand, not a new
measurement, and it is what the next dispatch's readback must reproduce:

| Reading | Old gate | New state | New `l4-paired` |
| --- | --- | --- | --- |
| R47 +12.00pp, p = 0.1094 | FAIL | UNRESOLVED | PASS (no harm) |
| R48 −6.00pp, p = 0.4531, 965 packs | FAIL | HARM | **FAIL** |
| R49 −4.00pp, p = 0.6875, 949 packs | FAIL | UNRESOLVED | PASS (no harm) |

R48 is the one that must stay red: it is the only reading in the lane's history
that fires a revert branch, and the new condition is strictly weaker than the old
one everywhere except there.

## Prediction

- `l4-paired` passes on the next dispatch. The last three within-run readings are
  +12.00, −6.00 and −4.00pp; a fourth at −4.00pp or better passes, and the revert
  rule's below-bar branch needs −5pp **and** a served pack to fire.
- `l4-effect-resolved` fails, and the artefact records `UNRESOLVED` with
  `excludedAbovePp` between 9 and 14. If it reports something else, the pair was
  drawn differently from the last three and the split — not the memory — is what
  changed.
- `V5-resolution` fails at the same magnitude it has failed at since R45: 13.73pp at
  n = 50, 9.05pp at n = 115.
- The three-state verdict changes no accuracy number. `pass^4` per arm, the paired
  delta, its interval and its p-value are byte-identical to what the old gate read.

## Refutation

- If `l4-paired` passes on a reading whose revert rule fires, the verdict and the
  gate have diverged and the gate is abandoned rather than patched: two
  implementations of one condition is the defect this registration exists to remove.
- If `l4-effect-resolved` passes while `|delta|` is below `detectablePp`, the resolution
  clause is not being read, and the run is discarded.
- If any committed reading other than R48 changes its `l4-paired` verdict, the new
  condition is not the old one restricted to harm and the change is reverted.
- If the artefact gains a `claim` string in the `UNRESOLVED` state, the field is
  doing what it was built not to do and the run is refused.
