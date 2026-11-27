---
id: R240-third-domain
step: R240
opened: 2026-11-27
arms: 0
sample: 8
gates: B1 B2 B3
---

# R240 — the third domain's records, and the alphabet the record grade is written in

Registered 27 November 2026, before any dispatch. It spends nothing: `arms: 0`, and B3 says so in money.

Three rounds have ended by correcting a number rather than by buying one: R238 found that the 6.8% it had published as
a settlement defect was the distance between two settlement rules; R239 found that a family-level bar could not see a
gap that lived in the ask unit. This round is registered on the suspicion that the record grade — the third of
`goal_board`'s three settlement grades — is written in **one domain's alphabet**, and that a second domain would read
zero on it and the zero would look like a corpus whose requests name nothing.

## Prediction

- **B1 — the grammar is the defect, and it is decidable.** An ask's clause spells an identifier; the receipt carries
  one; the grade fires when the sets intersect. `RECORD` required a `#` and a short letter prefix, which is how retail
  writes an order (`#W2378156`). **Prediction: a telecom request cannot produce that shape at all**, so the grade
  reads **0 of 8** graded writes on the 20-task sample, and a rule that also reads a bare prefixed id (`L1002`) and a
  phone number reads more. Measured, not asserted: `scripts/build_telecom_records.py`.
- **B2 — the repair is not a token table, and the sample says why.** A phone number is the only handle a telecom
  request gives on a line, and in this domain's own database a customer's `phone_number` **equals one of their
  lines'**. **Prediction: the single ambiguous token in the projection (`555-123-2002`) is claimed by `customer:C1001`
  and `line:L1002`**, so a table that ignores the ambiguity reaches 8 of 8 and a table that refuses it reaches 0 of 8.
  The prediction is that **no token-table repair exists**: the third domain needs a different handle, not a wider
  pattern.
- **B3 — zero spend, and the retail grid is byte-identical.** No model is called. The grammar widens on both sides
  (`RECORD` and the receipt-side `ID`), so the prediction is that every published reading either does not move or
  moves by a stated amount that is regenerated and recorded: **B1 wired 431/456 and B2 acted 394/403 stay
  byte-identical**, and the only movement is on the comparison arm's diagnostic column (`served` 479 → 477).

## Refutation

- **If the shipped rule already reaches a telecom write**, B1's premise is wrong: the alphabet is not one domain's and
  the round reports the reach it measured, with no grammar change shipped.
- **If the ambiguous token is not ambiguous**, the projection is wrong (a customer's phone is not a line's) and the
  round is re-registered rather than reinterpreted — the ambiguity is read from `db.toml`, not assumed.
- **If the ambiguity is real but harmless** — every ambiguous request happens to target the record it also names — the
  finding is weaker than registered and must be reported as such: the sample is 20 tasks and 8 writes, and a rule that
  over-credits would not show it here.
- **If any published manifest moves by more than the two writes named in B3**, the grammar change is a regression and
  is reverted, not regenerated: a recall repair that costs a published number is a different round.

## What is not claimed

No accuracy, no coverage, no mechanism. The sample is the domain's 20-task "small" split, not its 114-task base set,
because the base set's task file is 14 MB and the projection needs only the graded writes; the reading says `8` where a
reader might expect a hundred, and that is the sample rather than the domain.
