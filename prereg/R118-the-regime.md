---
id: R118-the-regime
step: R118
opened: 2026-11-14
arms: memory
sample: 160
gates: V0,V1,V2,V3,V5,V8
recallFloor: 0
facadePair: off
facadeNotes: off
# The stop this registration is. Its claim is a census, and `pass^4` at forty tasks resolves ±10pp on
# the difference — so the evaluation half is a cost the registration does not read. Declared in the
# header rather than left to a repository variable, because a global that could turn the stop off
# would let a dispatch pay for the half this arm exists to not buy.
learnOnly: true
distillScope: all
distillUnit: correction
distillForm: lesson
trainDomain: retail
testDomain: retail
recallDomain: retail
packBudget: 2400
taskSplit: official
trainTasks: 74
testTasks: 40
release: v1.0.1
---

# R118 — the regime, re-run: is a blank reply the budget, or the model

**Registered** 2026-11-14, after R112 closed the axis this registration would otherwise have had to
assume. Three things are already measured and none of them is this:

> R104 (`43589735959`) asked the distiller about **73 corrections** and recorded
> `distillReplies {calls: 73, empty: 0, chars: 6824}` with `learning.llmFailed: 63` under
> `MG_E_INVALID_SIGNAL`. Ten calls answered, sixteen candidates, six stored. `6824 / 10 ≈ 682`
> characters per answered call, against R111's pre-flight of **671 characters in one call** — so the
> other 63 replies carried **no visible character at all**.

> R112 (`43621097332`) asked one fixture correction of **8 candidate `(model, form)` pairs**, one call
> each, `thinking: 'off'`, and every one answered: `lesson` two conditioned claims, `repair` /
> `procedure` / `lexicon` one each, on both models. `reasoningTokens: 0` on every call. **Model and
> form are excluded**, and `lesson` — the form R104 already ran — is the best of the four.

So the surviving explanation for 63 blank replies is the **regime** the 73 calls ran under. R104's
client sent no `thinking` parameter, so the endpoint's default was in force; the default for this model
is to think; thinking is billed at the output rate and is taken from the same 1,200-token ceiling the
reply needs. A reply that spends its ceiling reasoning is a reply with no content.

## What one arm changes

Two changes, and only one of them is a treatment:

| change | what it is | why it is not two treatments |
| --- | --- | --- |
| `thinking: 'off'` stated by the client | R104's regime was an inherited default | it is the same switch R112 already ran under, so the arm asks R104's question in a regime R112 has documented |
| the stop after the learning half | no evaluation is bought | a stop cannot influence a census that is complete before it |

Everything else is R104's: `distillScope: all`, `distillUnit: correction`, `distillForm: lesson`, the
official 74/40 split, `packBudget: 2400`, `release v1.0.1`, `deepseek/deepseek-flash`.

## Prediction

- The artefact is a **no-measurement** record whose `distillDiagnostics` carries `funnel`, `distill`
  (with `replies`, `client`, `faults`, `report`), `merge`, `learn`, `corrections` and `silence`.
- `distillClient.reasoningTokens` on the artefact is **0**, which is the switch being stated rather
  than inherited.
- The four states of `distillReplies` sum to `calls`, and `calls` equals R104's 73 — the population did
  not change.
- `silence.state` is one of the five the reader names, and its sentence quotes a share rather than a
  count alone.

## Refutation

- **`silence.state: mostly-blank` again, with `reasoningTokens: 0`** refutes the budget explanation:
  the model declines these corrections rather than running out of room, the lever moves to the unit,
  and R113a is the next dollar.
- **`reasoningTokens: 0` while `calls` is below 73** refutes the arm rather than the hypothesis: the
  client refused calls it was budgeted for, and a census over a truncated population is not R104's
  census.
- **`unasked`** refutes the dispatch: no reply was recorded, so nothing about the distiller is measured.
- A `distillFaults` count that differs from R104's 63 by more than the state partition can absorb
  refutes the comparison, because the population or the client changed in a way the header does not
  name.

## Why this buys no score

R104's own pair answers it: two facades of one dispatch, one store, one split, one seed, five items a
request, `folded 0` — `per-failure 55.00%` against `collapse 72.50%`, a **17.5pp** difference with no
treatment at all. Forty tasks resolve ±10pp on a difference. A `pass^4` from this arm would therefore be
a number this record could not order against anything, and the census it is asking for is complete
before the first episode.

## Cost

**~$0.19**, which is the learning half of a dispatch at R85's billed band: 74 tasks, one trial each,
about 1,233 agent calls, and 73 distillation calls. The evaluation half R104 paid for — 160 episodes —
is the $1.02 this registration does not spend.

## What this unlocks

| reading | question it answers | what it decides |
| --- | --- | --- |
| `silence.state` | was the 63 a budget or a refusal | whether the next lever is the regime or the unit |
| `distillReplies`'s four states | which silence, on the population R104 ran | whether R111's two-state census was hiding a third kind again |
| `distillClient.reasoningTokens` | what thinking cost, where it is now zero | the price of a parameter nobody sent |
| `store.conditioned` | whether the store's five-of-six survived the change | whether the six format claims of §192 are a property of the population or of the run |
