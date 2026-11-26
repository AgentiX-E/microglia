---
id: R231-the-clause
step: R231
opened: 2026-11-26
arms: none
sample: 114
gates: V0
---

# R231 — admit the requirement clause, not the turn

Registered 26 November 2026 by R230's reading, **after** it and not before. **No dispatch.** R230 refused the
turn-level discriminator on two of its three bars and left the reason in the numbers: of 2,453 user turns, **1,893
(77.2%) follow an assistant question**, so "not an answer" admits 560 turns and refuses everything else — recovery of
the 155 later-turn writes is 25 (16.1%), and coverage lands at 62.7%, *below* the request board's 63.6%.

The requirement and the answer share a turn. The material is inside the turn, so the next discriminator has to be
inside it too.

## What the round builds

One change, and it adds no word to the lexicon:

    the first turn is read as a whole, as it is today;
    from every later turn, admit only the clauses that **name their own family**, so a clause inherits a family only
    inside the turn that states the contract, and never across the boundary into a later turn

This is the parser's own inheritance rule, restricted in scope. `items_of` gives a clause the family of the clause
before it **within the same sentence** so that "the smart thermostat for one compatible with Google Home" is an
exchange rather than a fragment; the same rule, applied inside an answer, converts the *value* into a *requirement* —
"yes, the purple one" inherits the exchange that was asked about, and becomes a second ask with the answer's words.
R229's follow-everything arm is 4,761 items for exactly that reason, and 3.90 unneeded open items an episode is the
number that refused it.

No new vocabulary, no model call, no cue list: the admission rule is a restriction on where an existing rule may
reach.

## The bars

- **B1 recovery**: of the 155 writes R230 attributed to later-turn asks, at least **60%** (93) must be accounted for.
  Unchanged from R230, and it is the bar that round failed. A clause rule that keeps only the contract's own turn is
  a return to turn one and is not a candidate.
- **B2 efficiency**: the items the board adds over the contract must not exceed **1.5 per write rescued** — that is,
  `items - requestItems <= 1.5 * recovered`. **This bar is restated, not inherited, and the reason is R230's own
  reading**: R230 passed the count-limit version (1,110 items against 1,940) while rescuing 26% of the writes it was
  supposed to rescue, so the count was not binding — it was a bar a nearly-empty rule passes, which is the mirror of
  the defect AUDIT 34.321 refused (a bar a rule passes by being itself). A ratio binds in the direction that matters:
  every item the rule buys has to come with a write.
- **B3 coverage**: at least **73.6%** of the discharged required writes — ten points over the request board's 63.6%,
  and unchanged from R230.

## Prediction

- **B1 is likely to hold and is not certain.** A volunteered requirement carries its own verb ("can you also cancel
  the other order"), so it names its own family. It will not hold for the asks that are *lists* continued across
  clauses ("return the lamp and the chair"), where the second object has no verb of its own and only inheritance can
  reach it — R216's census already measured this shape at 79.6% recall against 75.2% when the near-repeat folding was
  loosened.
- **B2 is the bar the round is built around.** The efficiency ratio is the one quantity a clause rule should move and
  a turn rule cannot: R230's ratio is 5.6 items per rescued write (140 extra items for 25 writes).
- **B3 is where the round is decided.** 95.6% is reachable with all four beams on and 63.6% with one; the question is
  whether clause admission lands ten points up, and it needs 481 of 654.

## Refutation

- **B1 failing** means a later-turn requirement is not distinguishable from an answer by turn *or* by clause — with
  that, the content question closes for this corpus with three independent refusals, and the lane's remaining work is
  the cost axis and the second domain rather than a fourth content rule.
- **B2 failing with B1 holding** means the clause rule rescues the writes but pays in items, which would say the
  corpus states requirements in object lists rather than in clauses, and the admission rule would have to move to the
  object.
- **B3 failing while B1 and B2 hold** would be the sharpest result available here: the later-turn writes would be
  recovered cheaply but they would be a small part of the deficit, which would relocate the block's loss from
  disclosure order to the binding rule itself.
