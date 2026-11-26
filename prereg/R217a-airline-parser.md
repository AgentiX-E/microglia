---
id: R217a-airline-parser
step: R217a
opened: 2026-11-26
arms: none
sample: 50
gates: V0
recallFloor: 0.6
---

# R217a — the airline parser, before the airline dispatch

Registered 26 November 2026 by R226, which admitted R217 and named the one thing standing in front of it. **No
dispatch, no model call.** The board is a retail parser: `FAMILIES` maps the eight retail write tools to the six ask
families, `CUES` recognises the retail vocabulary, and settlement matches a receipt's touched item names against the
words of the ask. None of that exists for airline, and a dispatch with none of it would serve a block whose items never
settle — a broken instrument reporting a null, which is the worst of the three possible outcomes (R215 spent a round
repairing exactly that defect in the domain where the repairs were measurable).

## What the airline domain needs, and where each piece comes from

| piece | retail | airline | source |
|---|---|---|---|
| write tools → family | `cancel_pending_order` → cancel, `modify_pending_order_items` → modify, ... | `cancel_reservation` → cancel, `update_reservation_flights` → modify, `update_reservation_passengers` → passenger, `update_reservation_baggages` → baggage, `book_reservation` → book, `send_certificate` → compensation | the domain's own tool schemas |
| ask cues | exchange / return / cancel / modify / address / payment / transfer | the same seven plus baggage and passenger, because "add a bag" names a family the retail table has no word for | the 50 requests' `reason_for_call` |
| settlement objects | a product name inside the item's words | a reservation code or a route, since an airline receipt's argument is a reservation id and a flight list | `initial_state` and `evaluation_criteria.actions` |

The 50 tasks are fetched as data, not as prose: `data/tau2/domains/airline/tasks.json` at the pinned tau2 ref carries
each task's `reason_for_call` and the actions the evaluator requires, which is a ground truth the parser never sees at
run time and the census grades against.

## The bar

`--census` over the 50 airline requests: **family recall at or above the retail parser's own** on retail's 114. The
retail numbers are the reference because they are the ones the shipped block was tuned against, and a domain entered
with a weaker parser would produce a null that says nothing about memory.

Two secondary columns, both required to be stated rather than thresholded:

- **asks per task** — airline requests are policy-dense and singular ("cancel reservation EHGLP3"), so the retail set
  machinery may over-fire; the number is a prediction and the census is its test.
- **unattributed share** — a receipt whose family the request names but whose object the parser cannot read. In retail
  this was a real defect class (AUDIT 34.225); in airline the reservation code is stripped as an identifier, so the
  object has to come from the route or the passenger's name and that is where this parser is most likely to fail.

## Prediction

- **Family recall above retail's, at a lower ask count per task.** The requests are written as single actions with a
  policy in them, and the census's denominator counts required actions rather than clauses.
- **Settlement will be weaker than retail's**, because the object is an itinerary rather than a catalogue name: this is
  the column expected to fail first, and the round's honest outcome may be a parser that reports items and refuses to
  report them settled.

## Refutation

- **Recall below retail's** closes R217 before dispatch. A block that cannot see its own successes is not a treatment;
  it is a different treatment, and the round registered on it would be measuring the wrong one.
- **A settlement rate near zero with a correct family rate** is not a refutation of the domain, it is a finding about
  object naming: the round would then register the block as items-only for airline and say so in the reading, because a
  board that lists asks and never claims one is done is still a checker and never a false one.
