#!/usr/bin/env python3
"""Arm ablation: every variant a run measured, graded against the arm it was supposed to beat.

The BIRD lane has been able to run several prompt variants in one dispatch for months, and each
artefact already stores a per-case verdict for every one of them under `arms`. Nothing read that
field in aggregate, so the repository's largest measured effect sat unread in a committed file:

    poc-sota-bird-dev-R26-channels.json, arm `linked`, 1,534 questions
    primary 57.76%   linked 48.17%   broke 202   repaired 55   McNemar p = 6.4e-21

**Schema linking — the mechanism the literature prices highest — costs 9.58pp as implemented**, and
the reason is in the same file: the arm's own error taxonomy moves `table-missing` from 107 to 291 and
turns 44 predictions into statements with no readable `FROM`. The pruner removes tables the answer
needs, which is the one failure a pruner cannot be rescued from, because the model writes a query over
what it can see.

This verifier exists so that a result of that size cannot be published without being noticed. It
grades every arm in every artefact the same way the readbacks grade an experimental round: paired,
exact, and against the primary arm rather than against a mean.

`NO_MEASUREMENT` covers the honest case where an artefact ran one arm; a single arm is not an ablation
and reporting a delta of zero for it would be the defect this file is about.

Usage:
  python3 eval/verifiers/arm_ablation.py --artefact eval/results/poc-sota-bird-dev-R26-channels.json
  python3 eval/verifiers/arm_ablation.py --self-test
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Sequence

from error_budget import CLASSES, classify

STATES = ("GRADED", "NO_MEASUREMENT", "DISCARDED")
ALPHA = 0.05
TABLE_CLASSES = ("table-missing", "table-extra", "table-both")


@dataclass(frozen=True)
class ArmReading:
    """One variant, against the primary arm on the same questions."""

    name: str
    n: int
    primary: int
    arm: int
    broke: int
    repaired: int
    p_value: float
    half_width_pp: float
    primary_taxonomy: dict[str, int]
    arm_taxonomy: dict[str, int]

    @property
    def delta_pp(self) -> float:
        """Arm minus primary: positive means the variant helped."""
        return (self.arm - self.primary) / self.n * 100 if self.n else 0.0

    @property
    def resolved(self) -> bool:
        return self.p_value < ALPHA

    @property
    def verdict(self) -> str:
        if not self.resolved:
            return "UNRESOLVED"
        return "HELPED" if self.delta_pp > 0 else "HURT"

    def missing_shift(self) -> int:
        """How many more errors the variant has where a table gold needed is absent.

        The number that explains a hurt verdict rather than merely reporting it: a pruner can only
        lose accuracy by removing something, and this is the count of times it did.
        """
        before = sum(self.primary_taxonomy[name] for name in ("table-missing", "table-both"))
        after = sum(self.arm_taxonomy[name] for name in ("table-missing", "table-both"))
        return after - before


def mcnemar_exact(broke: int, repaired: int) -> float:
    """Two-sided exact McNemar over the discordant pairs."""
    n = broke + repaired
    if n == 0:
        return 1.0
    tail = sum(math.comb(n, i) for i in range(min(broke, repaired) + 1)) / 2**n
    return min(1.0, 2 * tail)


def readings_of(name: str, cases: Sequence[dict[str, Any]]) -> list[ArmReading]:
    """One reading per arm the cases mention, in the order the run declared them."""
    names: list[str] = []
    for case in cases:
        for arm in (case.get("arms") or {}):
            if arm not in names:
                names.append(arm)
    out: list[ArmReading] = []
    for arm in names:
        primary = 0
        won = 0
        broke = 0
        repaired = 0
        primary_taxonomy = {key: 0 for key in CLASSES}
        arm_taxonomy = {key: 0 for key in CLASSES}
        scored = 0
        for case in cases:
            verdict = case.get("correct")
            arm_verdict = (case.get("arms") or {}).get(arm)
            # A case that either side did not score cannot contribute to a paired comparison, and
            # skipping it is what makes `n` the number of comparable questions rather than the
            # number of rows in the file.
            if verdict is None or arm_verdict is None:
                continue
            scored += 1
            if verdict is True:
                primary += 1
            if arm_verdict is True:
                won += 1
            if verdict is True and arm_verdict is not True:
                broke += 1
            if arm_verdict is True and verdict is not True:
                repaired += 1
            if verdict is not True:
                kind = classify(case.get("goldSql"), case.get("predictedSql"))
                primary_taxonomy[kind] += 1
            if arm_verdict is not True:
                sql = (case.get("armSql") or {}).get(arm)
                kind = classify(case.get("goldSql"), sql if sql is not None else case.get("predictedSql"))
                arm_taxonomy[kind] += 1
        out.append(
            ArmReading(
                name=arm,
                n=scored,
                primary=primary,
                arm=won,
                broke=broke,
                repaired=repaired,
                p_value=mcnemar_exact(broke, repaired),
                half_width_pp=1.96 * math.sqrt(max(broke + repaired, 1)) / scored * 100 if scored else 0.0,
                primary_taxonomy=primary_taxonomy,
                arm_taxonomy=arm_taxonomy,
            )
        )
    return out


def verdicts(readings: Sequence[ArmReading]) -> tuple[str, tuple[str, ...]]:
    if not readings:
        return "NO_MEASUREMENT", ("no arm was recorded: one prompt is not an ablation",)
    reasons: list[str] = []
    for reading in readings:
        reasons.append(
            f"{reading.name}: {reading.delta_pp:+.2f}pp, broke {reading.broke} repaired "
            f"{reading.repaired}, p={reading.p_value:.2e}"
        )
    return "GRADED", tuple(reasons)


def render(name: str, readings: Sequence[ArmReading], state: str, reasons: Sequence[str]) -> str:
    lines = [f"{name}"]
    if not readings:
        lines.append("  no arm recorded")
    for reading in readings:
        lines.append(
            f"  {reading.name:<14}{reading.arm:>6}/{reading.n:<6} {reading.delta_pp:>+8.2f}pp  "
            f"broke {reading.broke:>4} repaired {reading.repaired:>4}  p={reading.p_value:>9.2e}  "
            f"±{reading.half_width_pp:>5.2f}  {reading.verdict}"
        )
        shift = reading.missing_shift()
        if shift != 0:
            lines.append(
                f"  {'':<14}errors where a needed table is absent: "
                f"{sum(reading.primary_taxonomy[k] for k in ('table-missing', 'table-both'))} -> "
                f"{sum(reading.arm_taxonomy[k] for k in ('table-missing', 'table-both'))} ({shift:+d})"
            )
        unreadable = reading.arm_taxonomy.get("unparseable", 0) - reading.primary_taxonomy.get(
            "unparseable", 0
        )
        if unreadable != 0:
            lines.append(f"  {'':<14}predictions with no readable FROM: {unreadable:+d}")
    lines.append(f"state: {state}")
    for reason in reasons:
        lines.append(f"  - {reason}")
    return "\n".join(lines)


def load(path: Path) -> list[dict[str, Any]]:
    document = json.loads(path.read_text(encoding="utf-8"))
    cases = document.get("per_case")
    if not isinstance(cases, list):
        raise SystemExit(f"arm-ablation-unreadable:{path}:no per_case")
    return cases


def self_test() -> int:
    checks = _Checks()

    def case(correct: bool, **arms: Any) -> dict[str, Any]:
        return {"goldSql": "SELECT a FROM x", "predictedSql": "SELECT a FROM x", "correct": correct, "arms": arms}

    # 1. A variant that never fails is +0pp, not +100pp: the delta is against the primary arm on the
    #    same questions, which is the only comparison the artefacts support.
    same = readings_of("same", [case(True, v=True), case(False, v=False), case(True, v=True)])
    checks.equal(len(same), 1, "one arm, one reading")
    checks.near(same[0].delta_pp, 0.0, 1e-9, "an identical arm is level")
    checks.equal(same[0].broke, 0, "and breaks nothing")
    checks.equal(same[0].p_value, 1.0, "so its p-value is the null")

    # 2. The shape the repository actually found: a variant that breaks far more than it repairs.
    hurt = readings_of(
        "hurt",
        [case(True, v=False) for _ in range(202)] + [case(False, v=True) for _ in range(55)] + [case(True, v=True) for _ in range(30)],
    )[0]
    checks.equal(hurt.broke, 202, "the breaks are counted")
    checks.equal(hurt.repaired, 55, "and the repairs")
    checks.truthy(hurt.p_value < 1e-17, "a 202-to-55 split is not noise")
    checks.equal(hurt.verdict, "HURT", "and the verdict says which way")
    checks.near(hurt.delta_pp, -147 / 287 * 100, 1e-9, "the delta is over the comparable questions")

    # 3. An unresolved variant is not called an improvement, however large its point estimate.
    noise = readings_of("noise", [case(True, v=False) for _ in range(7)] + [case(False, v=True) for _ in range(5)])[0]
    checks.truthy(noise.p_value > ALPHA, "seven against five is not a result")
    checks.equal(noise.verdict, "UNRESOLVED", "and it is named that way")

    # 4. A case either side did not score leaves the comparison rather than counting as a loss.
    partial = readings_of(
        "partial",
        [
            {"goldSql": "SELECT a FROM x", "predictedSql": "SELECT a FROM x", "correct": True, "arms": {}},
            {"goldSql": "SELECT a FROM x", "predictedSql": "SELECT a FROM x", "correct": True, "arms": {"v": None}},
            {"goldSql": "SELECT a FROM x", "predictedSql": "SELECT a FROM x", "correct": True, "arms": {"v": True}},
        ],
    )[0]
    checks.equal(partial.n, 1, "only the comparable question counts")
    checks.equal(partial.arm, 1, "and it is counted once")

    # 5. No arm at all is a measurement that did not happen, and it says so.
    checks.equal(readings_of("single", [case(True)]), [], "a single prompt records no arm")
    checks.equal(verdicts([])[0], "NO_MEASUREMENT", "and that is not a pass")
    checks.equal(verdicts([hurt])[0], "GRADED", "an ablation grades")

    # 6. The explanation travels with the verdict: a pruner loses accuracy by removing tables, and
    #    the taxonomy shift is how that becomes a number rather than a suspicion.
    shrinking = readings_of(
        "shrinking",
        [
            {"goldSql": "SELECT a FROM x JOIN y", "predictedSql": "SELECT a FROM x JOIN y", "correct": True,
             "arms": {"p": False}, "armSql": {"p": "SELECT a FROM x"}},
            {"goldSql": "SELECT a FROM x JOIN y", "predictedSql": "SELECT a FROM x JOIN y", "correct": True,
             "arms": {"p": True}, "armSql": {"p": "SELECT a FROM x JOIN y"}},
        ],
    )[0]
    checks.equal(shrinking.missing_shift(), 1, "one more error where a needed table is absent")

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

    def truthy(self, actual: object, why: str) -> None:
        self.total += 1
        if not actual:
            self.failed.append(f"{why}: expected truthy, got {actual!r}")

    def report(self) -> int:
        for failure in self.failed:
            print(f"FAIL  {failure}", file=sys.stderr)
        print(f"{self.total - len(self.failed)}/{self.total} arm-ablation self-checks passed", file=sys.stderr)
        return 0 if not self.failed else 1


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--artefact", action="append", default=[], metavar="PATH")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        return self_test()
    if not args.artefact:
        parser.error("no artefact given; pass --artefact PATH or --self-test")

    exit_code = 0
    for path in args.artefact:
        readings = readings_of(Path(path).stem, load(Path(path)))
        state, reasons = verdicts(readings)
        print(render(Path(path).stem, readings, state, reasons))
        print()
        if state != "GRADED":
            exit_code = 1
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
