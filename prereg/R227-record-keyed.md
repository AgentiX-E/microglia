---
id: R227-record-keyed
step: R227
opened: 2026-11-26
arms: none
sample: 50
gates: V0
recallFloor: 0.75
---

# R227 — settle by the record, not by the family

Registered 26 November 2026 by R217a's refutation. **No dispatch.** This round rewrites the board's settlement
*contract*; it does not extend a word list, and the distinction is the whole of the registration.

## What R217a found

The retail parser, taught the airline domain's five write tools and three words, reaches **15 of 50** required airline
writes — **30.0%** family recall against its own **83.3%** on retail, measured by the same census over tasks from the
same corpus. The misses decompose into four causes, and only two of them are about words:

| cause | count | what it is |
|---|---|---|
| **the ask is not the action** | 5 cancel + 1 transfer | the policy makes the correct action a *different family* from the stated ask: a change is settled by cancel-and-rebook, a refusal by a transfer |
| **no action verb** | 5 book | "you want to fly from New York to Seattle" states a route and no action; "make a reservation" names an object and no verb |
| **cue priority** | 6 modify / 3 passenger / 3 baggage | one clause carries one family, and these asks carry two: "change the passenger to yourself" reports a modify |
| **domain collision** | 5 | the retail cue for `return` fires on "the return flight is May 20", where `return` names a leg |

## Why this is a contract problem

The board's settlement rule is: *an item is settled when a receipt of the same family names the product the ask names.*
That rule is sound in a **catalogue** domain, where the request states the action ("exchange the keyboard") and the tool
that performs it is named after the action. It is not sound in a **policy** domain, where the request states an
intention ("move my flight to Thursday") and the correct action is whatever the rules permit — a cancel plus a booking,
or a transfer to a human when they do not.

Teaching more words cannot fix that, and a parser that tried would be a lexicon fitted to the corpus, which the cue
table's own comment forbids. What can fix it is a weaker and more portable rule:

> an item is settled when a receipt **touches the record the ask names**, whichever family that receipt is in.

## What the round builds

`scope="record"` beside the existing `scope="family"`, sharing every other line of the parser:

1. **The record.** An ask names it if its words contain a reservation code, or — when the code is absent — the origin,
   the destination, or the passenger named in the request. Codes are stripped by the existing `ID` rule, so a record is
   matched on the words a request actually says.
2. **The touch.** A receipt touches a record when any of its arguments carries that code, or when its result names a
   reservation the request named. The write's own family is recorded and **not** used as a gate.
3. **The refusal, unchanged.** An item with no touch stays unsettled, and a touch on a record no ask named stays
   `unrequested`. The false-accusation rate is the number that matters and it is measured, not asserted.

## The bar, and why it is not the old one

**Record recall at or above 0.75** on the 50 airline requests, measured by the census before any dispatch — the share of
required writes whose record the parser names. Family recall is retired as a bar: it is the wrong quantity in a domain
where the action and the ask disagree, and keeping it would grade the parser on a rule the domain does not follow.

Two secondary columns, both reported and neither thresholded, because the first is expected to be weak:

- **the false-accusation rate on retail**, which must not rise above its current value: the record rule is *weaker* than
  the family rule, so the risk is a board that says "done" for work nobody asked for — the harm channel R213 measured.
- **the settlement rate on airline**, which may be near zero and still be a result: a board that lists asks and never
  claims one is done is still a checker and never a false one.

## Prediction

- **Record recall clears 0.75 on airline while family recall stays near 0.3**, because the asks name their records
  ("reservation EHGLP3", "my upcoming Houston to Denver trip") far more reliably than they name their actions.
- **Retail's false-accusation rate rises**, and if it rises the round reports the trade rather than hiding it: the
  record rule is buying airline recall with retail precision, and a domain-scoped default is the honest response.
- **R217 is re-registered only after this passes**, at the price R226 computed (¥16, 400 episodes, 6.72 pp of
  resolution at the four-attempt rung).

## Refutation

- **Record recall below 0.75** closes the airline column for this parser family, and the honest statement becomes that
  the board is a catalogue instrument: it does not transfer to policy domains, and the project says so instead of
  shipping a block that reports nothing.
- **A retail false-accusation rate above its current value by more than two points** refutes the weaker rule as a
  default, and the record scope stays available as an airline-only mode rather than replacing the family scope.
- **A settlement rate of zero with a record recall above 0.75** means the receipt side is where the domain resists, not
  the ask side, and the next round measures what an airline write's arguments actually carry before writing any rule.
