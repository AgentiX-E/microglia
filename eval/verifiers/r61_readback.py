#!/usr/bin/env python3
"""R61 readback: was the floor the constraint, and is the corroboration real?

The registration is `prereg/R61-floor.md`. R60 raised the trace ceiling from three to six and the
yield moved exactly as predicted — median claims per correction 2 -> 3, mean 2.21 -> 3.08 — while
corroboration did not move at all: support 2 stayed at one item and support 3 stayed at none. Two
readings in, pointing at the pass that is supposed to recognise two tasks saying one thing.

That pass had two defects, both provable from R60's artefact without an arm: a condition veto with no
discriminating power that refused the store's most similar pair, and single linkage reporting a chain
as three tasks agreeing. Both are fixed, and the artefact now carries a sweep of the floor.

So this readback grades the instrument before the result:

  the sweep     does it describe the same store the census does, and does complete linkage hold?
  the floor     does a group of three exist at the unchanged 0.60, and does it carry three tasks?
  the price     did the store survive, and does the corroboration reach the served pack?

States, the same four the other verifiers use:

  GRADED          every graded prediction holds and no refutation fired.
  NO_MEASUREMENT  the artefact cannot answer the question: no sweep, no census, or no store.
  DISCARDED       the artefact is the control arm or another scenario pair.
  ABANDONED       a refutation fired, or a graded prediction failed.

Usage:
  python3 eval/tools/fetch_evidence.py --repo microglia --run <run-id> --out /tmp/r61
  python3 r61_readback.py --dir /tmp/r61
  python3 r61_readback.py --self-test
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

STATES = ("GRADED", "NO_MEASUREMENT", "DISCARDED", "ABANDONED")

# Quoted from `prereg/R61-floor.md`, written before the arm ran.
OPERATING_THRESHOLD = 0.60
PREDICTED_GROUP_OF_THREE = 1
PREDICTED_MAX_SUPPORT = 3
PREDICTED_SUPPORT3_MIN = 1
PREDICTED_RETAINED_SHARE_MIN = 0.50
PREDICTED_CROSS_TASK_GROUPS = 1
# The measured drift of a control arm dispatched twice, from R59. A delta inside it is not a reading.
CONTROL_DRIFT_PP = 3.51
# R60's readings, quoted so every comparison is against a number rather than a memory.
R60_GROUPS = 1
R60_LARGEST_GROUP = 2
R60_SUPPORT3 = 0
REQUIRED_SCENARIO = {"learn": "retail", "test": "retail", "recall": "retail"}


class Report:
    def __init__(self) -> None:
        self.predictions: list[tuple[str, bool | None, str]] = []
        self.refutations: list[tuple[str, bool, str]] = []
        self.context: list[str] = []

    def predict(self, name: str, ok: bool | None, detail: str = "") -> None:
        self.predictions.append((name, None if ok is None else bool(ok), detail))

    def refute(self, name: str, fired: bool, detail: str = "") -> None:
        self.refutations.append((name, bool(fired), detail))

    def note(self, text: str) -> None:
        self.context.append(text)

    @property
    def predictions_ok(self) -> bool:
        return all(ok is not False for _, ok, _ in self.predictions)

    @property
    def refutation_fired(self) -> bool:
        return any(fired for _, fired, _ in self.refutations)

    def render(self) -> str:
        lines = ["predictions:"]
        for name, ok, detail in self.predictions:
            mark = "n/a " if ok is None else ("PASS" if ok else "FAIL")
            lines.append(f"  {mark}  {name}{'' if not detail else f'  ({detail})'}")
        lines.append("refutations:")
        for name, fired, detail in self.refutations:
            lines.append(f"  {'FIRED' if fired else 'clear'} {name}{'' if not detail else f'  ({detail})'}")
        if self.context:
            lines.append("context (not graded):")
            for text in self.context:
                lines.append(f"  {text}")
        return "\n".join(lines)


def _dig(document: dict[str, Any], path: str, default: Any = None) -> Any:
    node: Any = document
    for part in path.split("."):
        if not isinstance(node, dict) or part not in node:
            return default
        node = node[part]
    return node


def _scenario_ok(document: dict[str, Any]) -> bool:
    scenario = _dig(document, "tau2.scenario") or {}
    return all(scenario.get(key) == value for key, value in REQUIRED_SCENARIO.items())


def grade(document: dict[str, Any]) -> tuple[str, Report]:
    report = Report()
    unit = _dig(document, "tau2.distillUnit.unit")
    if unit != "trace":
        report.note(f"unit '{unit}' is not the trace arm this round treats")
        return "DISCARDED", report
    if not _scenario_ok(document):
        report.note(f"scenario {_dig(document, 'tau2.scenario')} is not the registered pair")
        return "DISCARDED", report
    census = _dig(document, "tau2.distillUnit.consolidation")
    sweep = _dig(document, "tau2.consolidationSweep")
    if census is None:
        report.note("consolidation absent: this arm did not run the pass")
        return "NO_MEASUREMENT", report
    # The operating setting is the registered one. An arm at another condition floor is the
    # ablation, which the artefact already carries as a column of its own sweep: grading it as the
    # treatment would compare the treatment with itself and call the difference a reading.
    if int(census.get("conditionMinShared") or 0) != 0:
        report.note(
            f"condition floor {census.get('conditionMinShared')} is not the registered operating "
            "setting: this is the veto's ablation, not the treatment"
        )
        return "DISCARDED", report
    if sweep is None:
        report.note("consolidationSweep absent: this artefact predates the instrument")
        return "NO_MEASUREMENT", report
    store = _dig(document, "tau2.storeItems") or {}
    items = store.get("items") or []
    if not items:
        report.note("no sampled store: the readback cannot check the census against it")
        return "NO_MEASUREMENT", report

    operating = sweep.get("operating") or {}
    points = sweep.get("points") or []

    # 1. The instrument describes the store the census describes. A sweep that recomputed the
    #    operating point could disagree with the pass the store was written from.
    same = (
        operating.get("threshold") == census.get("threshold")
        and operating.get("conditionMinShared") == census.get("conditionMinShared")
        and operating.get("groups") == census.get("groups")
        and operating.get("merged") == census.get("merged")
        and operating.get("maxSupport") == census.get("maxSupportAfter")
    )
    report.predict(
        "the sweep's operating point is the pass's own census",
        same,
        f"operating {operating.get('groups')}/{operating.get('merged')}/{operating.get('maxSupport')} "
        f"against census {census.get('groups')}/{census.get('merged')}/{census.get('maxSupportAfter')}",
    )

    # 2. Complete linkage's invariant, over every group rather than the largest.
    groups = list(sweep.get("groups") or [])
    below = [group for group in groups if group.get("weakestPair", 0) < float(operating.get("threshold") or 0) - 1e-9]
    report.predict(
        "every group's weakest pair clears the floor it was produced at",
        not below,
        f"{len(below)} group(s) below {operating.get('threshold')}" if below else f"{len(groups)} group(s) checked",
    )

    # 3. A group of three at the unchanged statement floor. Measured at one before the registration.
    threes = [group for group in groups if len(group.get("ids") or []) >= 3]
    report.predict(
        "a group of three exists at the 0.60 statement floor",
        len(threes) >= PREDICTED_GROUP_OF_THREE,
        f"{len(threes)} group(s) of three or more, largest {operating.get('largestGroup')}",
    )

    # 4. Support three, from the census and then from the store it shipped.
    store_support = [int(item.get("supportTasks") or 0) for item in items]
    support3 = [count for count in store_support if count >= 3]
    report.predict(
        "max support reaches three",
        int(census.get("maxSupportAfter") or 0) >= PREDICTED_MAX_SUPPORT
        and len(support3) >= PREDICTED_SUPPORT3_MIN,
        f"census {census.get('maxSupportAfter')}, store {len(support3)} item(s) at three or more",
    )

    # 5. The merge bought a task rather than folding one task's own claims.
    cross = int(census.get("crossTaskGroups") or 0)
    report.predict(
        "at least one group's union covers a task no single member held",
        cross >= PREDICTED_CROSS_TASK_GROUPS,
        f"{cross} group(s)",
    )

    # 6. The store survived the looser floor.
    considered = int(census.get("considered") or 0)
    retained = int(census.get("retained") or 0)
    share = retained / considered if considered else 0.0
    report.predict(
        "the pass keeps at least half the store it read",
        share >= PREDICTED_RETAINED_SHARE_MIN,
        f"{retained} of {considered} kept ({share * 100:.1f}%)",
    )

    # 7. The veto's ablation never merges more than the operating setting does.
    at_operating = {
        float(point.get("threshold") or 0): int(point.get("groups") or 0)
        for point in points
        if int(point.get("conditionMinShared") or 0) == int(operating.get("conditionMinShared") or 0)
    }
    at_veto = {
        float(point.get("threshold") or 0): int(point.get("groups") or 0)
        for point in points
        if int(point.get("conditionMinShared") or 0) == 3
    }
    monotone = all(at_veto.get(floor, 0) <= count for floor, count in at_operating.items())
    report.predict(
        "the veto's ablation merges no more than the operating setting, at every floor",
        monotone,
        ", ".join(
            f"{floor:.2f}: {at_operating.get(floor, 0)} vs {at_veto.get(floor, 0)}"
            for floor in sorted(at_operating)
        ),
    )

    # The refutations, in the order the registration states them.
    widest = max(
        (len(group.get("ids") or []) for group in groups),
        default=0,
    )
    report.refute(
        "the floor was never the constraint: no duplicate family exists at any floor",
        widest < 2,
        f"largest group {widest} at 0.60, sweeping {len(points)} point(s)",
    )
    report.refute(
        "the group of three is one task's three claims",
        widest >= 3 and cross == 0,
        f"largest group {widest}, {cross} group(s) bought a task",
    )
    report.refute(
        "the looser floor cost precision: a group contains a pair below its own floor",
        bool(below),
        f"{len(below)} group(s) below the floor",
    )

    pair = document.get("_pair") or {}
    delta = _dig(pair, "comparison.deltaPp")
    if delta is None:
        report.note("no comparison block: the paired delta is ungraded, not zero")
    
    if delta is not None:
        report.refute(
            "the corroboration does not survive into the served pack",
            float(delta) < -CONTROL_DRIFT_PP,
            f"paired delta {float(delta):+.2f}pp against a drift of {CONTROL_DRIFT_PP:.2f}pp",
        )
        report.note(
            f"paired delta is reported and not claimed: {float(delta):+.2f}pp "
            f"(p={_dig(pair, 'comparison.pValue')}, n={_dig(pair, 'comparison.paired')})"
        )

    report.note(
        f"sweep: {len(points)} point(s), operating {operating.get('threshold')}/"
        f"{operating.get('conditionMinShared')}, largest group {widest}, "
        f"support {census.get('supportBefore')} -> {census.get('supportAfter')}"
    )
    report.note(
        "R60 for comparison: "
        f"{R60_GROUPS} group, largest {R60_LARGEST_GROUP}, support 3 at {R60_SUPPORT3}"
    )
    for group in groups[:6]:
        report.note(
            f"group {group.get('ids')}: {group.get('supportTasks')} task(s), "
            f"weakest {group.get('weakestPair')}, conditions share {group.get('conditionShared')}"
        )

    if report.refutation_fired:
        return "ABANDONED", report
    if not report.predictions_ok:
        return "ABANDONED", report
    return "GRADED", report


def base_artefact(**overrides: Any) -> dict[str, Any]:
    document: dict[str, Any] = {
        "tau2": {
            "scenario": dict(REQUIRED_SCENARIO),
            "distillUnit": {
                "unit": "trace",
                "traces": 30,
                "traced": 12,
                "claims": 37,
                "consolidation": {
                    "considered": 36,
                    "groups": 1,
                    "merged": 2,
                    "retained": 34,
                    "threshold": 0.6,
                    "conditionMinShared": 0,
                    "supportBefore": {"1": 36},
                    "supportAfter": {"1": 33, "3": 1},
                    "maxSupportBefore": 1,
                    "maxSupportAfter": 3,
                    "crossTaskGroups": 1,
                    "weakestPair": 0.62,
                    "largestGroup": 3,
                },
            },
            "consolidationSweep": {
                "operating": {
                    "threshold": 0.6,
                    "conditionMinShared": 0,
                    "groups": 1,
                    "merged": 2,
                    "maxSupport": 3,
                    "largestGroup": 3,
                },
                "points": [
                    {"threshold": 0.6, "conditionMinShared": 0, "groups": 1, "merged": 2},
                    {"threshold": 0.6, "conditionMinShared": 3, "groups": 0, "merged": 0},
                ],
                "groups": [
                    {"ids": ["k1", "k2", "k3"], "supportTasks": 3, "weakestPair": 0.62, "conditionShared": 0, "crossTask": True}
                ],
            },
            "storeItems": {
                "items": [
                    {"id": "k1", "supportTasks": 3, "statement": "a", "status": "active"},
                    {"id": "k2", "supportTasks": 1, "statement": "b", "status": "retired"},
                ],
                "omitted": 0,
            },
        },
        "metrics": {"k": 4},
        "_pair": {"comparison": {"paired": 57, "deltaPp": 1.1, "pValue": 0.9}},
    }
    for path, value in overrides.items():
        node = document
        parts = path.split(".")
        for part in parts[:-1]:
            node = node.setdefault(part, {})
        if value is None:
            node.pop(parts[-1], None)
        else:
            node[parts[-1]] = value
    return document


def self_test() -> int:
    no_sweep = base_artefact(**{"tau2.consolidationSweep": None})
    no_census = base_artefact(**{"tau2.distillUnit.consolidation": None})
    no_store = base_artefact(**{"tau2.storeItems": None})
    control = base_artefact(**{"tau2.distillUnit.unit": "correction"})
    replay = base_artefact(**{"tau2.distillUnit.consolidation.conditionMinShared": 3})
    inconsistent = base_artefact(**{"tau2.consolidationSweep.operating.groups": 0})
    chain = base_artefact(**{"tau2.consolidationSweep.groups": [
        {"ids": ["k1", "k2", "k3"], "supportTasks": 3, "weakestPair": 0.4, "conditionShared": 0, "crossTask": True}
    ]})
    no_three = base_artefact(**{
        "tau2.distillUnit.consolidation.groups": 1,
        "tau2.distillUnit.consolidation.merged": 1,
        "tau2.distillUnit.consolidation.retained": 35,
        "tau2.distillUnit.consolidation.maxSupportAfter": 2,
        "tau2.distillUnit.consolidation.supportAfter": {"1": 35, "2": 1},
        "tau2.consolidationSweep.operating.maxSupport": 2,
        "tau2.consolidationSweep.operating.largestGroup": 2,
        "tau2.consolidationSweep.groups": [
            {"ids": ["k1", "k2"], "supportTasks": 2, "weakestPair": 0.88, "conditionShared": 1, "crossTask": True}
        ],
    })
    one_task = base_artefact(**{
        "tau2.distillUnit.consolidation.crossTaskGroups": 0,
        "tau2.consolidationSweep.groups": [
            {"ids": ["k1", "k2", "k3"], "supportTasks": 1, "weakestPair": 0.7, "conditionShared": 2, "crossTask": False}
        ],
    })
    collapsed = base_artefact(**{"tau2.distillUnit.consolidation.retained": 4})
    worsened = base_artefact(**{"_pair": {"comparison": {"paired": 57, "deltaPp": -9.0, "pValue": 0.01}}})
    no_pair = base_artefact(**{"_pair": None})

    cases: list[tuple[str, dict[str, Any], str, str | None]] = [
        ("a run at 0.6 with no veto grades", base_artefact(), "GRADED", "group of three"),
        ("an artefact from before the instrument cannot be read", no_sweep, "NO_MEASUREMENT", "consolidationSweep absent"),
        ("a trace arm with no census did not run its pass", no_census, "NO_MEASUREMENT", "consolidation absent"),
        ("an arm at the veto's floor is the ablation, not the treatment", replay, "DISCARDED", "veto's ablation"),
        ("an arm with no sampled store cannot be checked", no_store, "NO_MEASUREMENT", "no sampled store"),
        ("the correction arm is discarded", control, "DISCARDED", "unit 'correction'"),
        ("a sweep that disagrees with its own census abandons", inconsistent, "ABANDONED", "operating point is the pass"),
        ("a group below its floor voids the linkage", chain, "ABANDONED", "weakest pair clears the floor"),
        ("no group of three is the registration's first refutation", no_three, "ABANDONED", "no duplicate family"),
        ("a group of three from one task is one failure restated", one_task, "ABANDONED", "three claims"),
        ("a store that collapses is the dilution reading", collapsed, "ABANDONED", "at least half the store"),
        ("a paired delta beyond the drift refutes the served pack", worsened, "ABANDONED", "served pack"),
        ("an artefact with no pair file still grades the instrument", no_pair, "GRADED", "no comparison block"),
    ]
    failures = 0
    for label, artefact, expected, fragment in cases:
        state, report = grade(artefact)
        rendered = report.render()
        honoured = fragment is None or fragment in rendered
        mark = "ok  " if state == expected and honoured else "FAIL"
        if state != expected or not honoured:
            failures += 1
        print(f"  {mark} {label} -> {state}")
        if state != expected or not honoured:
            print(rendered)
    print()
    print("SELF-TEST PASSED" if failures == 0 else f"SELF-TEST FAILED ({failures})")
    return 0 if failures == 0 else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dir", help="evidence directory from fetch_evidence.py")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args(argv)
    if args.self_test:
        return self_test()
    if not args.dir:
        parser.error("--dir is required unless --self-test is given")
    root = Path(args.dir)
    artefacts = sorted(path for path in root.rglob("poc-l4.json"))
    if not artefacts:
        print(f"no poc-l4.json under {root}", file=sys.stderr)
        return 2
    pairs = sorted(root.rglob("poc-l4-pair.json"))
    pair_document = json.loads(pairs[0].read_text()) if pairs else {}
    worst = 0
    for path in artefacts:
        document = json.loads(path.read_text())
        document["_pair"] = pair_document
        state, report = grade(document)
        print(f"{path}\n  {state}\n{report.render()}\n")
        if state in ("ABANDONED", "DISCARDED"):
            worst = 1
    return worst


if __name__ == "__main__":
    sys.exit(main())
