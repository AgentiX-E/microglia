---
id: R10-template-transfer
step: R10
opened: 2026-10-30
arms: none,full
sample: 20
gates: V24
---

# R10 — does a rule transfer when its structure does?

## What R9.4 measured

Three hundred and eighty cross-database exercises of eighty rules, each rule shown one question at a
time from a database it was not learned in:

| Stratum | Rules | Cross-database delta | repair | break | home delta |
|---|---|---|---|---|---|
| positive | 22 | −2.27pp [−7.86, +2.68] | 6.7% | 10.4% | +7.05pp |
| zero | 23 | −1.74pp [−5.98, +2.86] | 5.8% | 7.9% | 0.00pp |
| negative | 35 | −2.29pp [−5.49, +0.90] | 3.9% | 7.2% | −8.71pp |

The reading was not "the rule harms". A harmful rule would break more and repair less; this one
repairs a little and breaks a little more, which is what a rule does when it is **not read**. The
same-database control says why: when the foreign case came from the rule's own database, repair rose
to 3.52% and break to 42.6% — the rule was obeyed, and mostly wrongly. Across a database boundary it
is neither obeyed nor wrong, it is ignored, because "`price` is stored as text, cast before
comparing" has no `price` to be about.

## The construction this file tests

Two published systems say the sentence is the problem, not the memory.

- **ODIS** (arXiv 2310.06302) isolates what makes an in-domain demonstration work: the **SQL
  distribution**, not the question distribution. It synthesises in-domain examples and gains 1.1 and
  11.8 points on two cross-domain benchmarks.
- **SQL-Exchange** (arXiv 2508.07087, PVLDB 2026) maps a query to a target schema by **preserving the
  source query's structure and substituting only the domain-specific elements**, and reports that
  mapped demonstrations beat raw source-schema ones consistently across model families.

R10 turns a rule into the thing SQL-Exchange says transfers: a structural pattern with slots.

```
CAST({column} AS REAL) when {column} is TEXT and compared to a number
GROUP BY {grain} when the question asks for a count per group
```

Distillation emits the template; transfer binds its slots against the **target** schema before the
rule is shown, and a template whose slots cannot be bound is withheld rather than shown unbound.

## Prediction

- Arm B's cross-database **repair rate exceeds 6.7%** — the R9.4 reading — because a bound template has a referent in the target database where a prose rule has none.
- Arm B's cross-database **break rate falls below 10.4%**, and the repair-minus-break pair improves even if the accuracy delta stays inside its interval. A rule that repairs more and breaks less is a different rule, and the pair is the measurement that can show it on a sample this size.
- **Withheld rules** — templates whose slots do not bind — are at least 20% of the family. SQL-Exchange's substitution is not always possible, and a construction that claims to bind everything is a construction that has not been checked against the schemas it will meet.
- A rule withheld for unbindable slots shows a cross-database delta of exactly zero, by construction, and the artefact says how many were withheld rather than silently scoring them as unhelpful.

## Refutation

- If arm B's **break rate does not fall below 8%**, the structural hypothesis is wrong for this class of rule. The memory layer is then documented as an in-database prompt — "a rule is useful exactly where it was learned" — and no transfer claim appears anywhere in this project again.
- If arm B's net cross-database effect is **≤ 0** with an interval excluding it, R9's closing condition ("the memory is a lookup and not a lesson") holds at the structural level too, and the R-series closes for good.
- If B repairs more than A **and** breaks more than A, neither hypothesis is supported: the template changed what the model attends to without changing whether it is right, and the next stage is a different question rather than a bigger version of this one.
- If more than 60% of rules are withheld as unbindable, the measurement is about the binder and not about transfer, and no verdict is issued from this run.

## What this does not test

It does not test whether a template generalises across model families — one model, the one the rest
of the study uses. It does not test whether the template form helps *within* a database; the
same-database arms are unchanged, and a win there would be a different finding reported separately.
