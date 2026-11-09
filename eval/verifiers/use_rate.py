#!/usr/bin/env python3
"""Use rate: how often a served rule changed the answer at all.

Every memory ablation in this repository reports a delta over *tasks*. A delta over tasks is a delta
over tasks only if the memory was consulted on every task, and it was not. This verifier measures the
denominator directly, from the two SQL strings the harness already writes:

  identical   `predictedSql` and `baselineSql` are the same text after stripping. Whatever the pack
              contained, it produced no observable change on this question, so this question cannot
              carry any of the memory's effect.
  changed     the two texts differ. The memory may have caused the difference, or the decoder may have
              sampled differently; the artefact cannot separate those, and this verifier does not try.

So `inert_share` is a **lower bound on not-using** and `effective_share` an **upper bound on using**.
That asymmetry is the point: the number is a denominator, not an attribution.

The reading it exists for is the second one:

  delta per task    (won - lost) / n        -- what every table in this repository publishes
  delta per change  (won - lost) / changed  -- what the memory does when it does something

Two artefacts can agree on the first and disagree by a factor of two on the second, and the difference
is instrument, not system. AM-Sentry (arXiv 2607.06595) reports ~60% activation for planted memories;
this is the same quantity measured from text rather than from a reader's self-report.

One structural assertion, because a defect here would be invisible: a question whose two SQL strings
are identical must have identical correctness. If it does not, the artefact's `predictedSql` and its
`correct` are answering different questions, and no rate computed over them means anything. That is
`INCONSISTENT`, and it is graded before any share is printed.

Usage:
  python3 eval/verifiers/use_rate.py --artefact eval/results/poc-sota-bird-dev-R37-lexicon-grain.json
  python3 eval/verifiers/use_rate.py --dir /tmp/r37-evidence
  python3 eval/verifiers/use_rate.py --self-test
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

STATES = ("MEASURED", "NO_MEASUREMENT", "INCONSISTENT")


@dataclass(frozen=True)
class Reading:
    label: str
    n: int
    identical: int
    changed: int
    won: int
    lost: int

    @property
    def inert_share(self) -> float:
        return self.identical / self.n

    @property
    def effective_share(self) -> float:
        return self.changed / self.n

    @property
    def delta_pp_per_task(self) -> float:
        return (self.won - self.lost) / self.n * 100.0

    @property
    def delta_pp_per_change(self) -> float:
        # Only meaningful when `changed > 0`; the caller grades that as NO_MEASUREMENT rather than
        # dividing by zero, and every render path checks the state first.
        return (self.won - self.lost) / self.changed * 100.0


def measure(label: str, cases: list[dict[str, Any]]) -> tuple[str, Reading | None, str]:
    """Return (state, reading, why). States are decided before any share is computed."""
    if not cases:
        return "NO_MEASUREMENT", None, "the artefact carries no per-case rows"
    missing = [c for c in cases if "predictedSql" not in c or "baselineSql" not in c]
    if missing:
        return (
            "NO_MEASUREMENT",
            None,
            f"{len(missing)} of {len(cases)} rows carry no SQL pair, so nothing can be compared",
        )
    identical = changed = won = lost = 0
    for case in cases:
        same = (case.get("predictedSql") or "").strip() == (case.get("baselineSql") or "").strip()
        with_memory = bool(case.get("correct"))
        without = bool(case.get("withoutMemoryCorrect"))
        if same:
            identical += 1
            if with_memory != without:
                return (
                    "INCONSISTENT",
                    None,
                    f"case {case.get('id', '<no id>')} has identical SQL on both arms and a different "
                    "verdict on each, so `predictedSql` and `correct` describe different runs",
                )
            continue
        changed += 1
        if with_memory and not without:
            won += 1
        if without and not with_memory:
            lost += 1
    if changed == 0:
        return (
            "NO_MEASUREMENT",
            None,
            "every case produced the same SQL with and without memory, so there is no change to "
            "measure a rate over",
        )
    return "MEASURED", Reading(label, len(cases), identical, changed, won, lost), ""


def render(reading: Reading) -> str:
    lines = [
        f"{reading.label} (n={reading.n})",
        f"  identical        {reading.identical:>6}  {reading.inert_share:6.1%}  "
        "no observable change, so no effect to carry",
        f"  changed          {reading.changed:>6}  {reading.effective_share:6.1%}  "
        f"won {reading.won}, lost {reading.lost}",
        f"  delta per task   {reading.delta_pp_per_task:+7.2f}pp  the number every table publishes",
        f"  delta per change {reading.delta_pp_per_change:+7.2f}pp  the number the memory produces "
        "when it acts",
    ]
    return "\n".join(lines)


def grade(document: dict[str, Any], label: str = "") -> tuple[str, Reading | None, str]:
    name = label or str(document.get("id") or "<unnamed artefact>")
    return measure(name, document.get("per_case") or [])


def self_test() -> int:
    """Fixtures assert the *rejecting* direction, one per state and one per arithmetic trap."""
    def case(index: int, predicted: str, baseline: str, correct: bool, without: bool) -> dict[str, Any]:
        return {
            "id": f"q{index}",
            "predictedSql": predicted,
            "baselineSql": baseline,
            "correct": correct,
            "withoutMemoryCorrect": without,
        }

    all_identical = [case(i, "SELECT 1", "SELECT 1", True, True) for i in range(10)]
    two_changed_both_won = [
        case(i, "SELECT 1", "SELECT 1", True, True) for i in range(8)
    ] + [case(8, "SELECT 2", "SELECT 1", True, False), case(9, "SELECT 2", "SELECT 1", True, False)]
    every_case_lost = [case(i, "SELECT 2", "SELECT 1", False, True) for i in range(4)]
    contradictory = [
        case(0, "SELECT 1", "SELECT 1", True, False),
        case(1, "SELECT 2", "SELECT 1", True, False),
    ]

    cases = [
        ("ten identical rows leave nothing to take a rate over", all_identical, "NO_MEASUREMENT", None),
        ("an empty artefact measures nothing", [], "NO_MEASUREMENT", None),
        (
            "a row pair missing one side measures nothing",
            [{"id": "q", "predictedSql": "SELECT 1", "correct": True}],
            "NO_MEASUREMENT",
            None,
        ),
        ("identical SQL with two verdicts is self-contradictory", contradictory, "INCONSISTENT", None),
        ("two changes out of ten win both", two_changed_both_won, "MEASURED", "+100.00pp"),
        ("four changes out of four lose all", every_case_lost, "MEASURED", "-100.00pp"),
    ]
    failures = 0
    for label, rows, expected, fragment in cases:
        state, reading, why = measure("fixture", rows)
        rendered = render(reading) if reading is not None else why
        honoured = fragment is None or fragment in rendered
        ok = state == expected and honoured
        if not ok:
            failures += 1
        print(f"  {'ok  ' if ok else 'FAIL'} {label} -> {state}")
        if not ok:
            print(f"       expected {expected} containing {fragment!r}\n{rendered}")

    # The arithmetic trap this file exists for: the same ledger reads +20pp per task and +100pp per
    # change. Publishing only the first is what makes a working mechanism look inert.
    state, reading, _ = measure("fixture", two_changed_both_won)
    assert reading is not None
    per_task = reading.delta_pp_per_task
    per_change = reading.delta_pp_per_change
    trap_ok = abs(per_task - 20.0) < 1e-9 and abs(per_change - 100.0) < 1e-9
    if not trap_ok:
        failures += 1
    print(f"  {'ok  ' if trap_ok else 'FAIL'} per-task {per_task:+.2f}pp and per-change "
          f"{per_change:+.2f}pp are two different readings of one ledger")

    print()
    print("SELF-TEST PASSED" if failures == 0 else f"SELF-TEST FAILED ({failures})")
    return 0 if failures == 0 else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artefact", action="append", default=[], help="artefact json to read")
    parser.add_argument("--dir", help="evidence directory; every poc-sota-bird*.json under it is read")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args(argv)
    if args.self_test:
        return self_test()

    paths = [Path(p) for p in args.artefact]
    if args.dir:
        paths.extend(sorted(Path(args.dir).rglob("poc-sota-bird*.json")))
    if not paths:
        parser.error("one of --artefact, --dir or --self-test is required")

    worst = 0
    for path in paths:
        document = json.loads(path.read_text())
        state, reading, why = grade(document, path.stem)
        print(f"{state}\n{render(reading) if reading is not None else why}\n")
        if state != "MEASURED":
            worst = 1
    return worst


if __name__ == "__main__":
    sys.exit(main())
