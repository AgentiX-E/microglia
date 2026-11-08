#!/usr/bin/env python3
"""R58 readback: does the store now hold a claim that recurs?

The registration is `prereg/R58-trace-unit.md`. Its treatment has two halves and they are read
separately: the *unit* (one task trace instead of one correction, so a claim can be derived by more
than one task) and the *pass* (consolidation over the finished store, so paraphrases of one claim
become one item with the union of its evidence).

Four things had to be true before this question could be asked at all, and R55.0 is the record of
the first: the write path never set `EvidenceRef.taskId`, so support fell back to the run id and was
1 by construction (AUDIT 34.58). R58 adds the other three — a unit that carries more than one claim,
a prompt whose condition can be written in the requester's register, and a pass that reads the store
after it is written rather than during the write.

States, the same four the other verifiers use:

  GRADED          every graded prediction holds and no refutation fired.
  NO_MEASUREMENT  the artefact cannot answer the question: no unit, no traces, or no census.
  DISCARDED       the artefact is the control arm or another scenario pair.
  ABANDONED       a refutation fired: nothing recurs, the pass is inert, or the store was halved.

Usage:
  python3 eval/tools/fetch_evidence.py --repo microglia --run <run-id> --out /tmp/r58
  python3 r58_readback.py --dir /tmp/r58
  python3 r58_readback.py --self-test
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

STATES = ("GRADED", "NO_MEASUREMENT", "DISCARDED", "ABANDONED")

# Quoted from `prereg/R58-trace-unit.md`, written before the measurement existed.
PREDICTED_SUPPORT3_MIN = 1
PREDICTED_SUPPORT2_SHARE_MIN = 0.25
PREDICTED_RETAINED_SHARE_MIN = 0.50
PREDICTED_TRACED_SHARE_MIN = 0.80
PREDICTED_COVERAGE_P50_MIN = 0.12
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


def share(numerator: float, denominator: float) -> float | None:
    return None if denominator <= 0 else numerator / denominator


def distribution(values: list[int]) -> dict[int, int]:
    out: dict[int, int] = {}
    for value in values:
        out[value] = out.get(value, 0) + 1
    return dict(sorted(out.items()))


def sampled_items(tau2: dict[str, Any]) -> list[dict[str, Any]] | None:
    block = tau2.get("storeItems")
    if not isinstance(block, dict):
        return None
    items = block.get("items")
    return items if isinstance(items, list) and items else None


def active_population(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    carries_status = any("status" in entry for entry in items)
    return [entry for entry in items if entry.get("status") == "active"] if carries_status else items


def support_of(entry: dict[str, Any]) -> int | None:
    value = entry.get("supportTasks")
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None


def census_of(tau2: dict[str, Any]) -> dict[str, Any] | None:
    unit = tau2.get("distillUnit")
    if not isinstance(unit, dict):
        return None
    block = unit.get("consolidation")
    return block if isinstance(block, dict) else None


def grade(artefact: dict[str, Any]) -> tuple[str, Report]:
    report = Report()
    tau2 = artefact.get("tau2") or {}
    metrics = artefact.get("metrics") or {}

    scenario = tau2.get("scenario")
    if isinstance(scenario, dict):
        mismatched = {key: scenario.get(key) for key, want in REQUIRED_SCENARIO.items() if scenario.get(key) != want}
        if mismatched:
            report.refute(
                "the dispatch ran the registered scenario pair",
                True,
                f"learn {scenario.get('learn')}, test {scenario.get('test')}, recall {scenario.get('recall')}",
            )
            return "DISCARDED", report
    else:
        report.note("no scenario block: read as the registered pair")

    unit = tau2.get("distillUnit")
    if not isinstance(unit, dict):
        # R58's fourth refutation, and the one every earlier round has had to state: an artefact
        # that cannot say which unit ran cannot be read as the treatment.
        report.predict("the artefact records the unit it distilled", None, "distillUnit absent")
        return "NO_MEASUREMENT", report
    if unit.get("unit") != "trace":
        report.refute(
            "the dispatch ran the treatment rather than the control",
            True,
            f"unit {unit.get('unit')!r}",
        )
        return "DISCARDED", report

    traces = unit.get("traces")
    traced = unit.get("traced")
    if not isinstance(traces, int) or not isinstance(traced, int):
        report.predict("the artefact records what it read", None, "traces/traced absent")
        return "NO_MEASUREMENT", report
    corrections = (tau2.get("learning") or {}).get("edited")
    traced_share = share(traced, corrections) if isinstance(corrections, int) and corrections > 0 else None
    if traced_share is None:
        report.predict(
            f"at least {PREDICTED_TRACED_SHARE_MIN:.0%} of the corrections carry a trace",
            None,
            f"edited={corrections!r}, traced={traced}",
        )
    else:
        report.predict(
            f"at least {PREDICTED_TRACED_SHARE_MIN:.0%} of the corrections carry a trace",
            traced_share >= PREDICTED_TRACED_SHARE_MIN,
            f"{traced} of {corrections} ({traced_share:.3%}), {traces} trace(s) read",
        )
        if traced_share < PREDICTED_TRACED_SHARE_MIN:
            # The unit did not run on most of the population the reading is over: the store is
            # partly the control's, and a support number from it is not the treatment's.
            report.note("traced share below the floor: the unit under test did not run")
            return "NO_MEASUREMENT", report

    census = census_of(tau2)
    if census is None:
        report.predict("the recurrence pass ran and reported its census", None, "consolidation absent")
        return "NO_MEASUREMENT", report

    considered = census.get("considered")
    retained = census.get("retained")
    groups = census.get("groups")
    if not all(isinstance(value, int) for value in (considered, retained, groups)):
        report.predict("the census carries its counts", None, json.dumps(census)[:120])
        return "NO_MEASUREMENT", report

    after = census.get("supportAfter") or {}
    values: list[int] = []
    for key, count in after.items():
        try:
            support = int(key)
        except (TypeError, ValueError):
            continue
        values.extend([support] * int(count))
    if not values:
        report.predict("the census carries an after-distribution", None, "supportAfter empty")
        return "NO_MEASUREMENT", report

    at_three = sum(1 for value in values if value >= 3)
    at_two = sum(1 for value in values if value >= 2)
    two_share = share(at_two, len(values))
    retained_share = share(retained, considered)
    coverage = tau2.get("coverage") or {}
    medians = coverage.get("medians") or {}
    p50 = medians.get("medianNonzero")

    report.predict(
        f"at least {PREDICTED_SUPPORT3_MIN} item(s) reach support 3, the threshold the published leader admits at",
        at_three >= PREDICTED_SUPPORT3_MIN,
        f"{at_three} of {len(values)} (after {distribution(values)}, before {census.get('supportBefore')})",
    )
    report.predict(
        f"at least {PREDICTED_SUPPORT2_SHARE_MIN:.0%} of items reach support 2",
        two_share is not None and two_share >= PREDICTED_SUPPORT2_SHARE_MIN,
        f"{at_two} of {len(values)} ({two_share:.3%})" if two_share is not None else "no items",
    )
    report.predict(
        f"the pass keeps at least {PREDICTED_RETAINED_SHARE_MIN:.0%} of the store it read",
        retained_share is not None and retained_share >= PREDICTED_RETAINED_SHARE_MIN,
        f"{retained} of {considered} kept ({retained_share:.3%})" if retained_share is not None else "nothing read",
    )
    report.predict(
        f"the merged store still names the request: median coverage at or above {PREDICTED_COVERAGE_P50_MIN:.0%}",
        # Absent is not a failure: an artefact without the coverage block is an older driver, and a
        # prediction graded against a reading that was never taken would pass or fail on nothing.
        None if not isinstance(p50, (int, float)) else p50 >= PREDICTED_COVERAGE_P50_MIN,
        f"p50 {p50:.3%} ({coverage.get('measuredPairs')} pair(s))" if isinstance(p50, (int, float)) else "coverage absent",
    )
    report.predict(
        "the run is the registered trial count: four",
        (metrics.get("k") or 0) == 4,
        f"k={metrics.get('k')}, tasks={metrics.get('tasks')}",
    )

    report.note(
        f"census: {considered}→{retained} item(s), {groups} group(s) merged {census.get('merged')}, "
        f"threshold {census.get('threshold')}, refusals condition/payload/evidence "
        f"{census.get('refusedCondition')}/{census.get('refusedPayload')}/{census.get('refusedDuplicateEvidence')}"
    )
    # The pair lives in its own file: the arm artefact grades one store, and a delta needs two.
    # Absent is stated as absent rather than printed as `Nonepp`, which is what a reader would
    # otherwise have to interpret as a zero.
    pair = artefact.get("_pair") or {}
    comparison = pair.get("comparison") or {}
    if isinstance(comparison, dict) and comparison.get("paired"):
        report.note(
            "paired delta is reported and not claimed: "
            f"{comparison.get('deltaPp'):.2f}pp (p={comparison.get('p'):.4f}, "
            f"n={comparison.get('paired')}, {comparison.get('gained')} gained, "
            f"{comparison.get('lost')} lost, verdict {(pair.get('verdict') or {}).get('state')})"
        )
    else:
        report.note("no pair file beside the arm: the delta is not read here")

    # R58's refutations, in the order the registration states them.
    report.refute(
        "nothing recurs even after the pass: no item reaches support 2",
        at_two == 0,
        f"after {distribution(values)}",
    )
    report.refute(
        "the pass is inert: it merged no group, so recurrence never appeared to be consolidated",
        groups == 0,
        f"{groups} group(s) over {considered} item(s)",
    )
    report.refute(
        "the pass bought support by halving the store",
        retained_share is not None and retained_share < PREDICTED_RETAINED_SHARE_MIN,
        f"{retained} of {considered} kept",
    )

    if report.refutation_fired:
        return "ABANDONED", report
    return ("GRADED" if report.predictions_ok else "ABANDONED"), report


# --------------------------------------------------------------------------- #
# self-test
# --------------------------------------------------------------------------- #


def base_artefact(**over: Any) -> dict[str, Any]:
    """A GRADED artefact: one claim reaches 3, the pass merges two groups, coverage clears 12%."""
    artefact: dict[str, Any] = {
        "id": "poc-l4",
        "metrics": {"pass4": 0.52, "k": 4, "tasks": 57, "paired_delta_pp": 6.1, "paired_p": 0.42, "paired_n": 57},
        "tau2": {
            "scenario": {"learn": "retail", "test": "retail", "recall": "retail"},
            "learning": {"edited": 32},
            "distillUnit": {
                "unit": "trace",
                "traces": 32,
                "traced": 31,
                "claims": 78,
                "consolidation": {
                    "considered": 18,
                    "groups": 3,
                    "merged": 5,
                    "retained": 13,
                    "threshold": 0.7,
                    "refusedCondition": 1,
                    "refusedPayload": 0,
                    "refusedDuplicateEvidence": 0,
                    "supportBefore": {"1": 18},
                    "supportAfter": {"1": 9, "2": 3, "3": 1},
                    "maxSupportBefore": 1,
                    "maxSupportAfter": 3,
                },
            },
            "coverage": {"measuredPairs": 228, "medians": {"medianNonzero": 0.146, "medianAllPairs": 0.132}},
            "store": {"stored": 21, "active": 13, "servable": 13},
        },
    }
    for path, value in over.items():
        node = artefact
        keys = path.split(".")
        for key in keys[:-1]:
            node = node.setdefault(key, {})
        node[keys[-1]] = value
    return artefact


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dir", help="directory holding the arm artefacts")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        inert = base_artefact(**{"tau2.distillUnit.consolidation.groups": 0,
                                 "tau2.distillUnit.consolidation.merged": 0,
                                 "tau2.distillUnit.consolidation.retained": 18,
                                 "tau2.distillUnit.consolidation.supportAfter": {"1": 18}})
        halved = base_artefact(**{"tau2.distillUnit.consolidation.retained": 6,
                                  "tau2.distillUnit.consolidation.merged": 12,
                                  "tau2.distillUnit.consolidation.supportAfter": {"3": 6}})
        once = base_artefact(**{"tau2.distillUnit.consolidation.groups": 2,
                                "tau2.distillUnit.consolidation.merged": 2,
                                "tau2.distillUnit.consolidation.retained": 16,
                                "tau2.distillUnit.consolidation.supportAfter": {"1": 16}})
        cases: list[tuple[str, dict[str, Any], str]] = [
            ("a trace arm whose store now recurs grades", base_artefact(), "GRADED"),
            ("a pass that merged nothing abandons: the mechanism never appeared", inert, "ABANDONED"),
            ("a store that reaches 3 by halving is the R56 defect and abandons", halved, "ABANDONED"),
            ("support 2 without support 3 fails the prediction and abandons", once, "ABANDONED"),
            (
                "the correction arm is discarded rather than reinterpreted",
                base_artefact(**{"tau2.distillUnit.unit": "correction"}),
                "DISCARDED",
            ),
            (
                "an artefact that does not record its unit cannot be read",
                base_artefact(**{"tau2.distillUnit": None}),
                "NO_MEASUREMENT",
            ),
            (
                "a trace arm with no census did not run its pass",
                base_artefact(**{"tau2.distillUnit.consolidation": None}),
                "NO_MEASUREMENT",
            ),
            (
                "traces on too few corrections leaves the treatment unmeasured",
                base_artefact(**{"tau2.distillUnit.traced": 3}),
                "NO_MEASUREMENT",
            ),
            (
                "another scenario pair is discarded",
                base_artefact(**{"tau2.scenario.test": "airline"}),
                "DISCARDED",
            ),
            (
                "a coverage reading under the bar fails, and the run abandons on it",
                base_artefact(**{"tau2.coverage.medians.medianNonzero": 0.061}),
                "ABANDONED",
            ),
            (
                "no coverage block leaves the register prediction ungraded rather than failed",
                base_artefact(**{"tau2.coverage": None}),
                "GRADED",
            ),
            (
                "a run that did not score four trials abandons",
                base_artefact(**{"metrics.k": 1}),
                "ABANDONED",
            ),
        ]
        failures = 0
        for label, artefact, expected in cases:
            state, report = grade(artefact)
            mark = "ok  " if state == expected else "FAIL"
            if state != expected:
                failures += 1
            print(f"  {mark} {label} -> {state}")
            if state != expected:
                print(report.render())
        print()
        print("SELF-TEST PASSED" if failures == 0 else f"SELF-TEST FAILED ({failures})")
        return 0 if failures == 0 else 1

    if not args.dir:
        parser.error("--dir is required unless --self-test is given")
    root = Path(args.dir)
    artefacts = sorted(root.rglob("poc-l4.json"))
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
