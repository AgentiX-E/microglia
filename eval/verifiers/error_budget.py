#!/usr/bin/env python3
"""Error budget: how much of the remaining gap each mechanism could possibly close.

The BIRD lane publishes one number per arm -- execution accuracy -- and an accuracy says where a
system is, not where the next point comes from. This verifier reads the per-case record every run
already stores and splits the *errors* into the classes the candidate mechanisms can act on:

  table selection   the prediction read a different set of tables than the gold query. Schema
                    linking is the mechanism that acts here, and nothing else does.
  same tables       the prediction read exactly the gold tables and still got the wrong answer: a
                    filter, a join condition, an aggregation, a column. Candidate generation and
                    field semantics act here; schema linking cannot.
  unparseable       no `FROM` or `JOIN` could be found. Deliberately its own class: a row that
                    cannot be classified is not evidence for either mechanism, and counting it as
                    "same tables" would inflate the class a submission run is supposed to attack.

The number this produces is a **ceiling, not an estimate**. If every table-selection error were
repaired and nothing else changed, accuracy would rise by exactly the share of that class -- which is
the most a linker can be worth on this artefact, and therefore the number that decides whether the
linker is worth building before the other candidates.

Why this is worth a verifier rather than a paragraph: every round of this project has argued about
which mechanism to build next from papers, and the artefacts have always contained the answer. A
31% table-selection share is a reason to build the linker; a 5% share would be a reason not to, and
both are one pass over `per_case` away.

States, the same four the other verifiers use:

  GRADED          every error was classified and the ceiling is reported.
  NO_MEASUREMENT  there is no artefact, or no error to classify (a perfect run has no budget).
  DISCARDED       an artefact's cases cannot answer the question: no `goldSql`, or no `correct`.

Usage:
  python3 eval/verifiers/error_budget.py --artefact eval/results/poc-sota-bird-dev-R37-lexicon-grain.json
  python3 eval/verifiers/error_budget.py --self-test
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable, Sequence

STATES = ("GRADED", "NO_MEASUREMENT", "DISCARDED")

CLASSES = ("table-missing", "table-extra", "table-both", "same-tables", "unparseable")

# `FROM x`, `JOIN x`, `FROM x AS y` and the quoted spellings BIRD uses. Deliberately not a SQL
# parser: a subquery's FROM is a table reference too, and treating `FROM (SELECT …)` as unparseable
# is more honest than guessing which inner name it meant.
_FROM = re.compile(r'\b(?:from|join)\s+[`"\[]?([A-Za-z_][A-Za-z_0-9]*)', re.IGNORECASE)


def tables_of(sql: str | None) -> frozenset[str]:
    """The tables a statement reads, lowercased. Empty means the statement did not parse."""
    if not isinstance(sql, str):
        return frozenset()
    return frozenset(match.lower() for match in _FROM.findall(sql))


def classify(gold: str | None, predicted: str | None) -> str:
    """Which mechanism, if any, could turn this error into a correct answer."""
    want = tables_of(gold)
    got = tables_of(predicted)
    if not got:
        return "unparseable"
    missing = want - got
    extra = got - want
    if missing and extra:
        return "table-both"
    if missing:
        return "table-missing"
    if extra:
        return "table-extra"
    return "same-tables"


@dataclass(frozen=True)
class Budget:
    """One artefact's error split, and the ceiling each class implies."""

    name: str
    n: int
    correct: int
    counts: dict[str, int]
    by_difficulty: dict[str, dict[str, int]] = field(default_factory=dict)

    @property
    def errors(self) -> int:
        """Definite failures only.

        Not `n - correct`: an unscored case is neither, and the first version of this property
        subtracted it into the error count, which inflated every share by however many cases the
        harness could not score. The distinction is the whole reason the taxonomy has an
        `unparseable` class and the audit skips `None`.
        """
        return sum(self.counts.values())

    @property
    def unscored(self) -> int:
        return self.n - self.correct - self.errors

    @property
    def table_errors(self) -> int:
        return sum(self.counts[name] for name in ("table-missing", "table-extra", "table-both"))

    @property
    def ceiling_pp(self) -> float:
        """What accuracy would be if every table-selection error were repaired."""
        return self.table_errors / self.n * 100 if self.n else 0.0

    @property
    def share_of_errors(self) -> float:
        return self.table_errors / self.errors if self.errors else 0.0

    @property
    def accuracy(self) -> float:
        return self.correct / self.n * 100 if self.n else 0.0

    def if_table_fixed(self) -> float:
        return (self.correct + self.table_errors) / self.n * 100 if self.n else 0.0


def audit(name: str, cases: Sequence[dict[str, Any]]) -> Budget:
    counts = {key: 0 for key in CLASSES}
    by_difficulty: dict[str, dict[str, int]] = {}
    correct = 0
    for case in cases:
        verdict = case.get("correct")
        if verdict is True:
            correct += 1
            continue
        # Only a definite `False` is an error. `None` is a case the harness could not score, and a
        # run that treats "not scored" as "wrong" reports a budget for errors it never observed.
        if verdict is not False:
            continue
        kind = classify(case.get("goldSql"), case.get("predictedSql"))
        counts[kind] += 1
        bucket = str(case.get("difficulty") or "unknown")
        slot = by_difficulty.setdefault(bucket, {key: 0 for key in CLASSES})
        slot[kind] += 1
    return Budget(
        name=name,
        n=len(cases),
        correct=correct,
        counts=counts,
        by_difficulty=by_difficulty,
    )


def verdicts(budgets: Sequence[Budget]) -> tuple[str, tuple[str, ...]]:
    """One state for the set, and the reasons."""
    if not budgets:
        return "NO_MEASUREMENT", ("no artefact was supplied",)
    reasons: list[str] = []
    for budget in budgets:
        if budget.n == 0:
            reasons.append(f"{budget.name}: no cases")
        elif budget.errors == 0:
            reasons.append(f"{budget.name}: nothing to classify -- the run answered everything")
    if all(budget.n == 0 or budget.errors == 0 for budget in budgets):
        return "NO_MEASUREMENT", tuple(reasons)
    return "GRADED", tuple(reasons)


def render(budgets: Sequence[Budget], state: str, reasons: Sequence[str]) -> str:
    lines: list[str] = []
    for budget in budgets:
        lines.append(
            f"{budget.name}: n={budget.n} correct={budget.correct} ({budget.accuracy:.2f}%) "
            f"errors={budget.errors} unscored={budget.unscored}"
        )
        if budget.errors == 0:
            continue
        lines.append(f"  {'class':<14}{'count':>7}{'of errors':>11}{'of n':>9}")
        for name in CLASSES:
            count = budget.counts[name]
            share = count / budget.errors * 100
            lines.append(f"  {name:<14}{count:>7}{share:>10.1f}%{count / budget.n * 100:>8.2f}pp")
        lines.append(
            f"  {'':<14}{budget.table_errors:>7}{budget.share_of_errors * 100:>10.1f}%"
            f"{budget.ceiling_pp:>8.2f}pp  <- the ceiling for schema linking"
        )
        lines.append(
            f"  accuracy now {budget.accuracy:.2f}%, and {budget.if_table_fixed():.2f}% if every "
            f"table-selection error were repaired and nothing else changed"
        )
        for bucket in sorted(budget.by_difficulty):
            slot = budget.by_difficulty[bucket]
            total = sum(slot.values())
            table = sum(slot[name] for name in ("table-missing", "table-extra", "table-both"))
            lines.append(
                f"  {bucket:<10} {total:>4} errors, {table:>4} of them table selection "
                f"({table / total * 100:.0f}%)"
            )
    lines.append(f"state: {state}")
    for reason in reasons:
        lines.append(f"  - {reason}")
    return "\n".join(lines)


def load(path: Path) -> list[dict[str, Any]]:
    document = json.loads(path.read_text(encoding="utf-8"))
    cases = document.get("per_case")
    if not isinstance(cases, list):
        raise SystemExit(f"error-budget-unreadable:{path}:no per_case")
    for case in cases:
        if "goldSql" not in case and "correct" not in case:
            raise SystemExit(f"error-budget-unreadable:{path}:a case has neither goldSql nor correct")
    return cases


def self_test() -> int:
    checks = _Checks()
    base = {"difficulty": "simple"}

    def case(gold: str, predicted: str, correct: bool | None = False, **extra: Any) -> dict[str, Any]:
        return {**base, "goldSql": gold, "predictedSql": predicted, "correct": correct, **extra}

    # 1. The three table-selection shapes, each reachable and each counted once.
    checks.equal(classify("SELECT a FROM x", "SELECT a FROM x JOIN y"), "table-extra", "an extra table")
    checks.equal(classify("SELECT a FROM x JOIN y", "SELECT a FROM x"), "table-missing", "a missing table")
    checks.equal(
        classify("SELECT a FROM x JOIN y", "SELECT a FROM y JOIN z"), "table-both", "swapped tables"
    )
    checks.equal(classify("SELECT a FROM x", "SELECT b FROM x"), "same-tables", "same tables, wrong answer")

    # 2. A statement with no readable FROM is its own class, not a member of the semantic one. This
    #    is the mistake the class list exists to prevent: an unparseable prediction counted as
    #    "same tables" would inflate the class a submission run is supposed to attack.
    checks.equal(classify("SELECT a FROM x", "SELECT 1"), "unparseable", "no FROM at all")
    checks.equal(classify("SELECT a FROM x", None), "unparseable", "no prediction at all")

    # 3. Case folding and the quoted spellings BIRD uses.
    checks.equal(
        classify('SELECT * FROM "schools"', "select * from `SCHOOLS`"), "same-tables", "case and quoting"
    )
    checks.equal(len(tables_of("SELECT * FROM a JOIN b ON a.id = b.id")), 2, "two tables named")

    # 4. The budget itself: a correct case is not an error, and an unscored case is not one either.
    budget = audit(
        "fixture",
        [
            case("SELECT a FROM x", "SELECT a FROM x", correct=True),
            case("SELECT a FROM x", "SELECT a FROM x JOIN y"),
            case("SELECT a FROM x JOIN y", "SELECT a FROM x"),
            case("SELECT a FROM x", "SELECT b FROM x"),
            case("SELECT a FROM x", None, correct=None),  # unscored
        ],
    )
    checks.equal(budget.n, 5, "every case counts in n")
    checks.equal(budget.correct, 1, "the one correct case")
    checks.equal(budget.errors, 3, "three errors")
    checks.equal(budget.unscored, 1, "and the unscored case is neither an error nor a success")
    checks.equal(budget.table_errors, 2, "two of them are table selection")
    checks.near(budget.ceiling_pp, 40.0, 1e-9, "two of five cases is a 40pp ceiling")
    checks.near(budget.share_of_errors, 2 / 3, 1e-9, "and two of three errors")
    checks.near(budget.if_table_fixed(), 60.0, 1e-9, "one correct plus two repaired is three of five")

    # 5. A perfect run has no budget, and saying so is not a failure.
    perfect = audit("perfect", [case("SELECT a FROM x", "SELECT a FROM x", correct=True)])
    checks.equal(verdicts([perfect])[0], "NO_MEASUREMENT", "a perfect run has nothing to classify")
    checks.equal(verdicts([])[0], "NO_MEASUREMENT", "and neither does an empty one")
    checks.equal(verdicts([budget])[0], "GRADED", "a run with errors grades")

    # 6. Difficulty is split, because a mechanism that only helps `simple` is not the mechanism the
    #    leaderboard gap is made of.
    split = audit(
        "split",
        [
            case("SELECT a FROM x", "SELECT a FROM x JOIN y", difficulty="simple"),
            case("SELECT a FROM x", "SELECT a FROM x", correct=True, difficulty="challenging"),
        ],
    )
    checks.equal(split.by_difficulty["simple"]["table-extra"], 1, "the simple error is classified")
    checks.equal(
        "challenging" in split.by_difficulty,
        False,
        "a correct case contributes no error row",
    )

    return checks.report()


class _Checks:
    def __init__(self) -> None:
        self.total = 0
        self.failed: list[str] = []

    def equal(self, actual: object, expected: object, why: str) -> None:
        self.total += 1
        if actual != expected:
            self.failed.append(f"{why}: expected {expected!r}, got {actual!r}")

    def near(self, actual: float, expected: float, tolerance: float, why: str) -> None:
        self.total += 1
        if abs(actual - expected) > tolerance:
            self.failed.append(f"{why}: expected {expected}±{tolerance}, got {actual}")

    def report(self) -> int:
        for failure in self.failed:
            print(f"FAIL  {failure}", file=sys.stderr)
        print(f"{self.total - len(self.failed)}/{self.total} error-budget self-checks passed", file=sys.stderr)
        return 0 if not self.failed else 1


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--artefact", action="append", default=[], metavar="PATH")
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        return self_test()
    if not args.artefact:
        parser.error("no artefact given; pass --artefact PATH or --self-test")

    budgets = [audit(Path(path).stem, load(Path(path))) for path in args.artefact]
    state, reasons = verdicts(budgets)

    if args.json:
        print(
            json.dumps(
                {
                    "state": state,
                    "reasons": list(reasons),
                    "artefacts": [
                        {
                            "name": budget.name,
                            "n": budget.n,
                            "correct": budget.correct,
                            "counts": budget.counts,
                            "ceiling_pp": round(budget.ceiling_pp, 4),
                            "by_difficulty": budget.by_difficulty,
                        }
                        for budget in budgets
                    ],
                },
                indent=2,
            )
        )
    else:
        print(render(budgets, state, reasons))
    return 0 if state == "GRADED" else 1


if __name__ == "__main__":
    sys.exit(main())
