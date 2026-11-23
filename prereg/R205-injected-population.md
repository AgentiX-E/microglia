---
id: R205-injected-population
step: R205
opened: 2026-11-23
# R204's arm ran once and could not be read. The mechanism held — 40 calls, six sentences, 34 refusals, a store
# that did not move — and the reading the registration named as primary, the inert share, described a population
# the agent never saw: `serveYield.renders` counts the packs the facade served, and 34 of those 40 episodes carried
# nothing. This is the same arm under the same registration with one instrument added: the agent reports, per
# episode, whether its prompt carried a body, the join drops the episodes that did not, and the count it dropped
# is published. Nothing about the store, the split, the tasks, the trials or the body changes, so the fold this
# buys is poolable with R204's own key rather than being another arm.
arms: both
sample: 114
gates: V0,V1,V2,V3,V5,V8
recallFloor: 0
facadePair: off
facadeNotes: off
facadeShapes: off
distillScope: all
distillUnit: raw
rawCeiling: 2000
serveBody: guidance
speakMargin: 0
trials: 1
trainDomain: retail
testDomain: retail
recallDomain: retail
packBudget: 2400
taskSplit: official
trainTasks: 74
testTasks: 40
release: v1.0.1
claimRuler: interval
---

# R205 — the same arm, read over the population that carried a body

**Registered** 2026-11-23, after R204's first fold and before this dispatch. The arm is unchanged: R99's store
(raw, scope `all`, the 74/40 official split, one trial), `serveBody: guidance`, one summariser call an episode,
nothing written back. What changes is what the artefact can say about itself.

## What R204 measured, and what it could not

Run 45192820103 came back with the mechanism intact and the headline reading unquotable:

| reading | the fold | verdict |
| --- | --- | --- |
| the call | 40 calls, 6 sentences, 34 refusals, 0 failures | held, arithmetic closes |
| the store | 73 → 73, `grew: false` | held, measured on the file |
| the served share | `serveYield` 50 renders / 40 inert = 80.0% | **over the facade's packs, not the prompts** |
| the delta | +5.00 pp, [−7.5, +17.5] against 19.81 pp detectable | UNRESOLVED, as registered |
| the price | 3,099,936 against the control's 3,246,017 prompt tokens | negative — the refusals in the bill |

The share was over 50 renders of which six carried a body. The gate written the round before refused a fold whose
guidance *call failed*, and this fold had no failures at all: it declined through the other path, and the gate
named a cause rather than an effect. **The fix is the effect.** `injectedEpisodes` is one flag per episode, raised
where the injected message is built; the join drops the episodes that carried nothing; `serveYield.withheld` is
the number it dropped. Two gates changed in the same commit: the ledger refuses a transient fold whose census does
not close or whose artefact carries no `withheld`, and the readback grades the share only when the population is
named.

## Prediction

- **`withheld` is present and non-zero.** Between 30 and 38 of the 40 evaluated episodes will carry no body: R204
  measured 34, and the arm's own census agrees with R200's 78.7% outcome-based inert share within 6 pp.
- **The renders fall to the bodies.** `serveYield.renders` drops from 50 to the number of episodes that spoke —
  and `repairs + breaks + inert == renders` still closes, which is the identity the join now has one denominator
  for.
- **The share is quoted with its interval, and the interval is the reading.** Over six to ten renders a Wilson
  interval is 30–40 pp wide, so the ±10 pp band cannot be tested and the refutation requires the *lower bound* to
  clear it. A share that comes back at 80% over six bodies is consistent with the pool and is not evidence that
  the body did anything.
- **The mechanism's three readings hold again**: one call an episode, `before == after`, no provider failure, and
  the sentence well under 400 characters.
- **The price stays below the block arm's 3,299.6 tokens an episode, and may again be negative.** A negative
  premium is the refusal rate in another column; the readback reports it as a failed prediction rather than as a
  saving, and that is the correct reading of it.

## Refutation

- **If `withheld` is absent from the pair**, the instrument did not reach the run and the round is a repair rather
  than a result. This is the first thing checked, because every other reading depends on it.
- **If `withheld` equals the episode count**, nothing was injected on any episode and the fold is about the prompt.
- **If the census does not close** (`calls != sentences + refusals + failures`), the arm's own arithmetic is
  broken and no population can be named from it.
- **If the store grows**, this is a lesson arm with a step in front of it.
- **If the inert interval's lower bound clears 78.7% + 10 pp**, the published 59.9% does not transfer to a
  single-shot retail harness, and that is a finding about the corpora rather than about the body.
- **If the bill meets the block arm's 3,299.6 tokens an episode**, the arm paid for the block as context and for
  the sentence, so the body is not what shipped.

## Price

**≈ ¥3–4**: two arms × 114 tasks × 1 trial at R198's measured ¥2.75, plus one summariser call an episode. The
engineering is paid; the dispatch buys the population reading the first fold could not produce, and it validates
the instrument in production before any further arm depends on it.

## What this round does not settle

The refusal rate. 34 of 40 episodes had nothing to say, and that is a statement about the **material** — records
retrieved from other retail tasks — rather than about the body. The literature's largest published effect
(*More Memory, Worse Agents*, 59.9%) summarises the failing trajectory of the task at hand and discards it; this
arm summarises retrieved records and mostly declines. The arm that carries that difference is the next
registration, and it is not this one.
