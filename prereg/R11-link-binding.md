---
id: R11-link-binding
step: R11
opened: 2026-10-30
arms: none,full
sample: 20
gates: V24, V28
---

# R11 — bind the slot to the question, not to the spelling

## What R10 measured without spending anything

R10 asked whether a rule travels when its structure does, and turned the rule into a template whose
slots are its identifiers that the home schema has. Its kill condition was fixed before the code:
*if more than 60% of the family is withheld as unbindable, the measurement is about the binder.*

`pnpm eval:template` answered it from the artefact and the eleven BIRD schemas, for zero calls:

| Reading | Value |
|---|---|
| rules | 289 (1,288 entries; five folds repeat each rule once) |
| with a home database / homeless | 259 / 30 |
| bound in at least one foreign database | **10 — 3.9%** |
| slotless | 76 — 29.3% |
| withheld | **173 — 66.8%** |
| blockers | table `posts` 103, `cards` 91, `drivers` 86, column `lap` 80, `patient` 70 |

So arm B was never dispatched and no verdict was issued. The blockers are the useful part: every one
is a **domain element** — the word that makes a rule about one database. SQL-Exchange substitutes
those by mapping a query into the target schema, where the target's own elements are known because
the query is being written against them. Comparing spellings is not that operation.

## The construction this file tests

The target's elements are not unknown to us: for every foreign question the lane already computes the
schema links it is about to show the model (`linkSchema`). R11 binds against those links.

```
rule (home: codebase_community)   A post with no accepted answer has a NULL AcceptedAnswerId
slot                              table {posts}  (its home schema has it)
target question                   "... how many badges were earned by the user who posted the most ..."
target links                      users, badges
binding                           table slot -> users   (the table the question names)
shown                             A user with no accepted answer has a NULL AcceptedAnswerId
```

Three decisions, each of which the arm can be wrong about:

- **A table slot binds to a table the question links.** When the question names more than one table,
  the shortest linked name wins, and a tie withholds: the slot is a referent, not a guess.
- **A column slot binds inside the linked table**, by name overlap with a type agreement; if the
  column the slot names is absent from that table, the rule is withheld.
- **A slot with no candidate withholds the rule**, as in R10. Nothing is ever shown half-bound.

## Prediction

- **Fewer than 20% of the family is withheld**, against R10's 66.8% — measured by
  `pnpm eval:template` before the dispatch, so this prediction is refutable for free.
- Arm B's cross-database **repair rate exceeds 6.7%** and its **break rate falls below 10.4%**, the
  R9.4 readings for the same rules shown as prose.
- The rules R10 could not bind are the ones this stage is *for*: among the 173 withheld by name, the
  repair rate should be at least as high as among the 10 that bound by name, because the first group
  is the one whose elements were domain-specific and therefore the one a link can genuinely replace.

## Refutation

- If the census still withholds **more than 60%**, R11 is refused like R10 and the failure is in the
  idea of binding at all; the memory layer is then documented as an in-database prompt and the
  transfer question closes permanently.
- If withholding falls below 20% but the **break rate does not fall below 8%**, structure is not what
  transfers even when the referent is right, and the R-series closes on that finding.
- If repair rises and break rises with it, the template changed attention without changing
  correctness, and the next stage is a different question rather than a bigger one.
- If the bound rules' net effect is **≤ 0** with an interval excluding zero, the memory is a lookup at
  the structural level too.

## What this does not test

Whether a template generalises across model families, and whether it helps *within* a database. One
model, one split (`minidev`), the same panel R9.4 measured, so the comparison is against a cell that
already exists rather than against a rerun.
