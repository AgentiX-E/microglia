---
id: R220c-moveprice
step: R220c
opened: 2026-11-26
# R216b measured the shipped tail placement at −4% against the second-system shape and explained it with a number it
# never measured: that a change behind the conversation re-bills the block and nothing else, while a change in front of
# it re-bills everything the block sits in front of. `movePrice` is that number, the probe already computes it, and no
# dispatch has ever asked for it. A derived explanation of a measured bill is the shape this project refuses.
arms: none
sample: 1
gates: V0
recallFloor: 0
---

# R220c — the price of a move, measured on the shipped shape

Registered 26 November 2026. One probe dispatch, no benchmark arm: the five prompt shapes `PACK_PLACEMENTS` defines,
nine growing turns each, and **one extra call per shape with the block's body changed on it**. That extra call is the
whole round. Held still, every placement's steady state is the control's plus one write, so the shapes are
indistinguishable in the column R216b's −4% needs; the difference lives in what a change re-bills, and `movePrice`
computes it from the provider's own `prompt_cache_hit_tokens`.

## What is measured

One artefact, `eval/results/cache-placement.json`, whose `move_tokens` field is a number per placement: the tokens a
call paid beyond the shape's own median steady state, on the call that changed the block. Signed on purpose — a
change that hit the cache harder than the median reads negative, and clamping it would make every shape look as if it
paid at least nothing per move.

| quantity | where it comes from |
|---|---|
| `move_tokens.tail` | the shipped placement, R220b's subject |
| `move_tokens.system-second` | R216b's comparison shape |
| `move_tokens.first-turn` | ExpeL's placement, the one with the most to re-bill |
| `cache_field_reported_calls` | whether the provider reported the counter at all |
| `block_tokens_measured` | the block the numbers are per, so the reading can be scaled to a pack |

## Prediction

- **The tail pays less per move than any placement that puts the block in front of the conversation.** That is the
  mechanism R216b's −4% names, and the prediction is the sign rather than the size: a move behind the conversation
  re-bills the block, a move in front of it re-bills the block plus every token the block sits in front of.
- **The ordering is `tail` < `system-second` < `system-merged` < `first-turn`**, because each step puts the block in
  front of strictly more material — the conversation, the conversation plus the policy, and the task statement itself.
- **`move_tokens.tail` is within one block of zero**: a change behind the conversation costs the block's own tokens and
  nothing else, so the reading should land near `block_tokens_measured` rather than near the prompt's size.
- **The probe reports the cache counter on every call.** `cache_field_reported_calls == calls`; a probe that read no
  counter is not a measurement, and `placementVerdict` already refuses it as `inconclusive` rather than as zero.

## Refutation

- **A tail move priced at or above a front placement's move** refutes the mechanism R216b's −4% was explained with,
  and the honest consequence is that the −4% stays unexplained: it would then be a reading about the shape's steady
  state rather than about its moves, and every later quote of it has to say so.
- **A tail move within noise of all other shapes** would say the block is too small a fraction of the prompt for a
  move to be visible at this size, which refutes the reading's usefulness rather than its direction — the answer is a
  larger `--block-tokens`, not a claim.
- **`inconclusive`** — the provider reported no cache counter — ends the round without a number. It does not license
  the derived figure: a derivation quoted because the measurement failed is the defect this round exists to remove.
