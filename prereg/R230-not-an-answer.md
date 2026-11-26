---
id: R230-not-an-answer
step: R230
opened: 2026-11-26
arms: none
sample: 114
gates: V0
---

# R230 — admit a later-turn ask only from a turn that is not an answer

Registered 26 November 2026 by R229's taxonomy. **No dispatch.** R229 left the block's largest measured defect on the
table and named it: of the 232 writes the turn-one contract cannot account for, **155 (66.8%)** are asks the
conversation states after the first user turn. Coverage under every user turn is 95.6% at 4.9× the items, and the extra
items are the user's *answers* read as asks — "the mechanical keyboard", "box", "manuals", "processing time".

## What the round builds

One discriminator, and it needs no vocabulary:

    an ask is admitted from a user turn after the first **only when the assistant's previous turn did not ask the user
    a question**

A reply to a question is a value filling a slot the agent requested; it is not a requirement. A turn that follows an
agent statement or a tool call is the user volunteering something, and that is where a new requirement can live. The
test is on the *transcript*: does the assistant turn before the user turn contain a question mark. Nothing about the
domain, no cue list, no model call.

The binding rule is unchanged from R229 — an item is an ask, settled by a write of its family to a record the episode
opened, one ask per call — so the round changes **one thing** and the comparison is against R229's own numbers.

## The bars

- **B1 recovery**: of the 155 writes R229 attributed to later-turn asks, at least **60%** (93) must still be accounted
  for. A filter that removes the noise by removing the signal is a return to turn one.
- **B2 noise**: the admitted asks must not exceed **twice** the turn-one contract's 970 items — 1,940. R229's
  follow-everything arm is 4,761, and 3.90 unneeded open items per episode is the number that refuses it.
- **B3 coverage**: at least **73.6%** of the discharged required writes, which is ten points over the request board's
  63.6%. B1 alone can be satisfied by a filter that helps only where the writes are; this one says the help has to be
  worth having.

## Prediction

- **B1 likely holds.** The new requirements in this corpus are volunteered ("actually, also return the lamp"), and a
  volunteered turn is not preceded by a question.
- **B2 is the bar at risk.** τ²'s simulator often answers a question and adds something in the same turn ("yes, the
  purple one — and can you also check the other order?"), and a whole-turn test admits the answer's words with the
  requirement's. If B2 fails, the discriminator has to move from the turn to the **clause**, which is a different round
  and a bigger one.
- **B3 is where the round is decided.** R229's `askAll` shows 95.6% is reachable; the question is how much of it
  survives a filter that admits 20% of the items.

## Refutation

- **B1 failing** means the later-turn asks are not distinguishable from the answers by turn position, and with that the
  content question closes for this corpus: a contract cannot be read continuously (4.9× noise) and cannot be filtered
  by structure (recovery lost), so the block's completeness is bounded by what a single snapshot can hold.
- **B2 failing with B1 holding** is the interesting failure: the signal is recoverable and the noise is not removable at
  turn granularity, which points at the clause and at the user simulator's habit of combining an answer with a
  requirement. That would be the first result in this lane that locates a defect in the *benchmark's* user model rather
  than in the block.
