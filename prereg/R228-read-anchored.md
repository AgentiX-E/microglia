---
id: R228-read-anchored
step: R228
opened: 2026-11-26
arms: none
sample: 114
gates: V0
---

# R228 — bind the item to the read, not to the words

Registered 26 November 2026 by R227's refutation. **No dispatch.** This round changes what a board item is *about*:
not a phrase the request states, but a record the episode reads.

## What R227 found

The record rule reached **27 of 50** graded airline writes (**54.0%**) against a bar of 0.75, and **30 of 50** even
when the family rule it retires is counted beside it. The ladder is on the artefact: code 7 (14.0%), a token only one
of the user's records carries 25 (50.0%), two identity tokens together 27 (54.0%), the family 15 (30.0%).

The 23 misses are not a parser defect, and this is the part that decides the successor:

| cause | writes | what the request says |
|---|---|---|
| **a set selected by a predicate** | 13 | "cancel all of your upcoming flights", "all your future reservations that contain any flights that are longer than 4 hours", "booked multiple flights for the same day", "downgrade all business flights to economy" |
| **the policy chooses the object** | 6 | "the cheapest business round trip", "exactly the same as your current reservation", "a flight from NY to explore the West Coast" |
| **the record is unnamed by design** | 2 | "change the passenger name on the reservation", with nine reservations on the account |
| **no record at all** | 1 | a transfer to a human, which is a refusal and not a write |
| **one ask, two records** | 1 | a change settled by cancel-and-rebook |

A set defined by a predicate over state — cabin, duration, date-equality — cannot be named by any token rule, because
the tokens are *computed from the records*, not stated by the user. And an object the policy chooses cannot be named
at all, because at the time the user speaks it does not exist.

## What the round builds

The anchor moves from the request to the **read**. In τ² a write is always preceded by a read of the record it
touches — `get_reservation_details`, `get_order_details`, `get_user_details` — because the identifiers are not in the
request. So a board item becomes:

    an item is a record the episode has read, carrying the fields the read returned and the count of asks the
    request stated on that record or on the set it belongs to
    it is settled by the first successful write that touches it, whatever family that write is in
    it is `unrequested` when a write touches a record no read in the episode reached

The last line is what keeps the rule from becoming a rubber stamp: the board can only credit a record it has seen,
and a write to a record nobody read is exactly the failure τ² charges for.

## The bar, and why it is not R227's

R227's bar was a property of the corpus and it failed on the corpus. R228's bar is a **comparison on a grid already on
disk**, because the instrument it needs has been paid for:

- **settlement**: on the retail grid R218b produced, the read-anchored board settles at least as many writing episodes
  as the request-anchored board (the 1.18 pp admission R226 priced). Replay, not dispatch: ¥0.
- **false accusation**: the share of `unrequested` entries per episode must not rise above the request-anchored
  board's. The read-anchored rule is *wider* — every record the agent reads becomes an item — so this is the number
  that can kill it, and it is measured on the same artefact.
- **the airline column stays closed** until both hold on retail. A rule that fails on the domain where it is
  measurable is not a rule that will work where it is not.

## Prediction

- **Settlement rises**: the read-anchored board settles the episodes where the request's words and the receipt's
  product never met, which is the deficit the stratified reading attributed to the mixed stratum.
- **`unrequested` rises**, and the round reports the trade rather than hiding it. If it rises by more than the
  settlement gains, the round is REFUTED on its own second bar, because a board that credits unattributed work is the
  harm channel R213 measured at 8.5% of met requirements.
- **The airline set asks become reachable**: "all your upcoming flights" is settled by the writes that follow the
  reads of those flights, because the set is the read set and not a parse.

## Refutation

- **Settlement no better than the request-anchored board on retail** closes the read-anchored contract, and with it the
  state channel as this project has taken it: three anchors (request, reveal, record) would then all be at chance, and
  the honest statement is that the block's content is not the lever this benchmark can see.
- **`unrequested` rising by more than the settlement gains** refuses the round even if settlement improves, because the
  product's cost of a false "done" is the harm this lane has measured since R213.
