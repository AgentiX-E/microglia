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

## Amendments, written before the census ran (2026-10-31)

Four decisions the text above does not settle, fixed here before `pnpm eval:template` was run with
the link binder. None of them moves a prediction; all of them say how one is counted.

1. **The kill condition is stated over attempts.** A rule is now attempted once per *foreign
   question*, because the binder reads the question's links and two questions in one database link
   different tables. The attempt is the unit the arm spends a call on, so it is the unit that decides
   whether a run measures the binder. R10's numbers are stated both ways — 66.8% of rules, 69.3% of
   2,590 attempts — so the two stages remain comparable on either unit, and both are reported.

2. **A name match outranks a link, and the shortest-name tie-break applies only among the tables the
   question names.** The text above fixes what to do when the question names more than one table; it
   is silent on a rule that spells the table it is looking for. Reading the tie-break as prior to a
   name match would withhold `posts` → `posts` whenever another linked table happened to be equally
   short, and the census would then measure spelling ties rather than the hypothesis. The order is:
   a linked table whose name matches; else the question's own anchor when there is exactly one; else
   the shortest of the anchors, withholding when two are equally short.

3. **The census reads every scored question; the arm reads twenty per database.** The panel is drawn
   by hash from the same pool (`targetPanels`), so it is a sample of the population the census
   measures rather than the same set. The kill condition is applied to the population, which is the
   conservative direction: a construction that cannot bind at large cannot bind on a sample of it.

4. **A column agrees in kind, and an undeclared type agrees with everything.** "Name overlap with a
   type agreement" is read as: the two columns' SQLite affinities match (`integer`, `text`, `real`,
   `temporal`, `blob`), and a column whose declaration is empty or unrecognised is not treated as a
   disagreement — an absence of information is not evidence that a rule is about something else. The
   family comes from `PRAGMA table_info`, which is the database's own answer, rather than from
   re-reading `CREATE TABLE` with a second grammar.

## Outcome, before the dispatch (2026-10-31)

`pnpm eval:template` now runs both binders: R10's name comparison against the whole target schema,
and R11's link binding, which reads every rule against every *question* the split scores. Zero model
calls, same command, one artefact each (`poc-template-census.json`, `poc-template-linked-census.json`).

| Reading | R10 (name) | R11 (link) |
|---|---|---|
| rules | 289 | 289 |
| attempted | 259 | 259 |
| bound in at least one foreign place | **10 — 3.9%** | **57 — 22.0%** |
| slotless | 76 — 29.3% | 76 — 29.3% |
| **withheld, over rules** | **173 — 66.8%** | **126 — 48.6%** |
| **withheld, over attempts** | **1,796 / 2,590 — 69.3%** | **51,159 / 82,137 — 62.3%** |

Binding a table to the table the question names is worth more than five times as many rules
(3.9% → 22.0%) and takes the rule-level withhold from two thirds to under half. It does not take the
attempt-level share under the bar: **62.3% against the 60% this file fixed as its kill condition**,
and nowhere near the 20% it predicted. **R11 issues no verdict and arm B is not dispatched.**

**The reasons, which are the residue worth keeping.** Every withheld attempt names the slot that
stopped it and, for the first time, why:

| Reason | Attempts | Share of the withheld |
|---|---|---|
| `no-column` — the target has no column by that name, in the table the rule bound to | 30,692 | **60.0%** |
| `no-table` — the question named no table the slot could take | 12,114 | 23.7% |
| `table-tie` — two anchors of equal length, and the file withholds rather than guesses | 7,541 | 14.7% |
| `column-kind` — the name is there and the column holds another kind of thing | 812 | **1.6%** |

So the type agreement is not what refuses this construction — it stops 1.6% of the withheld, and 812
attempts is not a wall. **The wall is vocabulary**: three in five refusals are a column the target
database does not have at all. A table slot has a referent the question can supply, because questions
name tables; a column does not, because the column is the thing the rule is *about*, and no reading of
the question invents it. That is R9's "a rule's value is bounded by its own database" restated at the
level of the binder, with a count.

**What R11 does not license.** The table-tie is 9.2% of all attempts and it was fixed before the code
existed ("the slot is a referent, not a guess"). A construction that guessed would be a different
construction, and this file does not test it: its failure mode is a confident statement about the
wrong table, which is the harm R9 measured at 42.6% break on same-database foreign rules. The
refutation clause applies as written — the memory layer is an in-database prompt, no transfer claim
appears anywhere in this project again, and the R-series' transfer question is closed.

**Cost.** 0 model calls. The two censuses together are 82,137 pure-function bindings and two schema
reads per database.
