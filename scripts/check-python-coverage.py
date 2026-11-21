#!/usr/bin/env python3
"""Fail the gate on a Python module the lane's suites do not actually cover.

The Node side has had a threshold since the first round: `pnpm test` fails below it. The Python drivers had a
*number* in the reports and no gate under it — every python step in `ci.yml` ran the suites and printed their
output, so a module could lose coverage in a refactor and the build would stay green. The figure in `AUDIT.md`
was therefore a measurement rather than a requirement, which is the difference this script removes.

Two rules, and both are needed:

* **every module that a driver runs** must reach the floor on lines *and* branches, counted together. A module at
  99% of its lines and 60% of its branches is a module whose `if` has one arm nobody has ever taken;
* **the report must not be empty or nearly empty.** A coverage run that measured nothing reports 100% of
  nothing, and a gate that passes on an empty report is the failure mode this lane has hit twice — a suite that
  exited early, a discovery pattern that matched no files. So the script refuses a report whose file count is
  below `--expect-files`.

`test_*.py` files are measured but not floored, and the exemption is stated rather than inferred: a test file
contains time-of-day branches (`skipTest` at 00:00 UTC, the `return` a fixed clock makes unreachable) that no
amount of testing can cover on one machine, and the number that matters is the one for the code those files
exist to check. Their contribution is still in the total, which is floored.

Usage:
  check-python-coverage.py build/coverage-python.json --min 95
  check-python-coverage.py --self-test
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys
import tempfile

FLOOR = 95.0
# The lane's own drivers plus the dispatch guard: six modules at the time of writing. A floor a little under
# the count is the point — it catches "the run measured almost nothing" without pinning the exact tree.
EXPECT_FILES = 4


def measured(entry: dict) -> "tuple[float, int, int]":
    """One file's percentage over lines and branches together, with the two counts it came from.

    `percent_covered` is deliberately not read: it is the tool's own arithmetic, and this gate exists to be
    independent of the number a report prints. Branches are counted as taken or not taken, which is what the
    tool's `covered_branches` already means.

    The counts sit under `summary` for a file and at the top level for the report's totals, so the same
    function reads both rather than two functions that could drift.
    """
    summary = entry.get("summary") or entry
    statements = int(summary.get("num_statements") or 0)
    branches = int(summary.get("num_branches") or 0)
    covered = int(summary.get("covered_lines") or 0) + int(summary.get("covered_branches") or 0)
    total = statements + branches
    return (100.0 * covered / total if total else 100.0), covered, total


def is_test(path: str) -> bool:
    return pathlib.PurePath(path).name.startswith("test_")


def check(report: dict, floor: float = FLOOR, expect_files: int = EXPECT_FILES) -> "list[str]":
    """Every reason the report fails, as sentences. Empty means the gate passes."""
    files = report.get("files") or {}
    problems: "list[str]" = []
    if len(files) < expect_files:
        problems.append(f"the report covers {len(files)} modules, fewer than the {expect_files} the lane has")

    below = []
    for path, entry in sorted(files.items()):
        percent, covered, total = measured(entry)
        if is_test(path):
            print(f"  {percent:5.1f}%  {covered:5}/{total:<5} {path}  (a suite, not floored)")
            continue
        print(f"  {percent:5.1f}%  {covered:5}/{total:<5} {path}")
        if percent + 1e-9 < floor:
            below.append(f"{path} is at {percent:.1f}%, below the {floor:g}% floor")
    problems.extend(below)

    totals = report.get("totals") or {}
    percent, covered, total = measured(totals)
    print(f"  {percent:5.1f}%  {covered:5}/{total:<5} all measured lines and branches")
    if percent + 1e-9 < floor:
        problems.append(f"the tree as a whole is at {percent:.1f}%, below the {floor:g}% floor")
    return problems


def self_test() -> int:
    """Each rule fires on the report that breaks it, and a clean report passes."""
    def module(statements: int, covered: int, branches: int, taken: int) -> dict:
        return {"summary": {"num_statements": statements, "covered_lines": covered,
                            "num_branches": branches, "covered_branches": taken}}

    clean = {
        "files": {
            "eval/drivers/alfworld/agent.py": module(100, 100, 40, 40),
            "eval/drivers/alfworld/floor.py": module(50, 50, 10, 10),
            "eval/drivers/alfworld/distill.py": module(50, 50, 10, 10),
            "eval/drivers/alfworld/test_agent.py": module(100, 90, 20, 10),
        },
        "totals": module(300, 296, 80, 76),
    }
    cases = [
        ("a clean report passes", clean, FLOOR, 4, []),
        (
            "a module under the floor is named with its number",
            {"files": dict(clean["files"], **{"eval/drivers/alfworld/agent.py": module(100, 90, 40, 40)}),
             "totals": clean["totals"]},
            FLOOR,
            4,
            ["agent.py is at 92.9%, below the 95% floor"],
        ),
        (
            "a branch nobody takes fails a module whose lines are all covered",
            {"files": dict(clean["files"], **{"eval/drivers/alfworld/floor.py": module(50, 50, 10, 2)}),
             "totals": clean["totals"]},
            FLOOR,
            4,
            ["floor.py is at 86.7%, below the 95% floor"],
        ),
        ("an empty report is refused rather than passed", {"files": {}, "totals": module(0, 0, 0, 0)}, FLOOR, 4,
         ["the report covers 0 modules"]),
        (
            "a suite below the floor is reported and not failed",
            {"files": clean["files"], "totals": clean["totals"]},
            FLOOR,
            4,
            [],
        ),
        (
            "the tree total is floored too",
            {"files": {path: module(10, 10, 0, 0) for path in clean["files"]},
             "totals": module(40, 30, 0, 0)},
            FLOOR,
            4,
            ["the tree as a whole is at 75.0%"],
        ),
    ]
    failures = 0
    for name, report, floor, expect, wanted in cases:
        print(f"== {name}")
        problems = check(report, floor, expect)
        if wanted and not any(wanted[0] in problem for problem in problems):
            print(f"FAIL expected {wanted[0]!r}, got {problems}")
            failures += 1
        elif not wanted and problems:
            print(f"FAIL expected no problem, got {problems}")
            failures += 1
        else:
            print("ok")
    print("PASS the coverage gate fires on each rule and passes a clean report" if not failures
          else f"FAIL {failures} of {len(cases)} cases")
    return 0 if not failures else 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Enforce the Python lane's coverage floor from a coverage.py json report")
    parser.add_argument("report", nargs="?", help="the json `coverage json` wrote")
    parser.add_argument("--min", type=float, default=FLOOR, help=f"the floor, in percent (default {FLOOR:g})")
    parser.add_argument("--expect-files", type=int, default=EXPECT_FILES, help="the fewest modules a real report has")
    parser.add_argument("--self-test", action="store_true")
    arguments = parser.parse_args()

    if arguments.self_test:
        return self_test()
    if not arguments.report:
        parser.error("a report is required unless --self-test is given")
    try:
        report = json.loads(pathlib.Path(arguments.report).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        print(f"FAIL the coverage report cannot be read: {error}")
        return 1

    problems = check(report, arguments.min, arguments.expect_files)
    if problems:
        for problem in problems:
            print(f"FAIL {problem}")
        return 1
    print(f"PASS every module the drivers run is at or above {arguments.min:g}%")
    return 0


if __name__ == "__main__":
    sys.exit(main())
