#!/usr/bin/env python3
"""R51 readback: grade the condition-carrying artefact against its registration.

The registration is `prereg/R51-condition-carrying.md`: five predictions and five
refutations, all of them written before the dispatch. The predictions are censuses,
not an accuracy number, and that is the point -- R51 asks whether the write path
produced a trigger at all, because R49 measured a store of ten rules in which none
could be found by a question.

Three outcomes are possible and they are not interchangeable:

  GRADED          every prediction that applies holds and no refutation fired.
  NO_MEASUREMENT  the census is absent, or the pre-flight refused. Nothing claimed.
  ABANDONED       a refutation fired. The account of *why* the pack was thin is
                  wrong, so there is no contribution to report -- not even a null.

Usage:
  python3 r51_readback.py --dir <extracted-arm-dir>
  python3 r51_readback.py --self-test
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

# The same three states the R49 verifier uses; a fourth would be a conclusion.
STATES = ("GRADED", "NO_MEASUREMENT", "ABANDONED")

# Registered before the dispatch, quoted here so the verifier cannot drift from
# the file it grades against.
PREDICTED_CONDITIONED_MIN = 4
PREDICTED_EMPTY_MAX = 0.25
PREDICTED_P50_MIN = 0.12
PREDICTED_MEAN_PACK = (1.4, 2.4)
# R49's measured empty share, the baseline every improvement is stated against.
R49_EMPTY_SHARE = 579 / 1528


class Report:
    def __init__(self) -> None:
        self.predictions: list[tuple[str, bool | None, str]] = []
        self.refutations: list[tuple[str, bool, str]] = []

    def predict(self, name: str, ok: bool | None, detail: str = "") -> None:
        self.predictions.append((name, None if ok is None else bool(ok), detail))

    def refute(self, name: str, fired: bool, detail: str = "") -> None:
        self.refutations.append((name, bool(fired), detail))

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
        return "\n".join(lines)


def share(numerator: float, denominator: float) -> float | None:
    if denominator <= 0:
        return None
    return numerator / denominator


def grade(artefact: dict[str, Any]) -> tuple[str, Report]:
    report = Report()
    tau2 = artefact.get("tau2") or {}
    store = tau2.get("store") or {}
    recall = tau2.get("recall") or {}
    coverage = tau2.get("coverage") or {}
    quantiles = coverage.get("nonzeroQuantiles") or {}
    verdict = artefact.get("verdict") or {}
    metrics = artefact.get("metrics") or {}

    # The census is the whole measurement. A run written before it existed, or one
    # whose switch never reached the store, cannot answer any of the five
    # predictions -- and reading an absent field as zero would turn "not measured"
    # into "measured, and the write path produced nothing", which is the exact
    # substitution R49's census was built to prevent.
    conditioned = store.get("conditioned")
    servable = store.get("servable")
    requests = recall.get("requests")
    if conditioned is None or servable is None or requests is None:
        report.predict("the census is present", None, "conditioned/servable/requests absent")
        report.refute("a census that was never taken", False)
        return "NO_MEASUREMENT", report

    empty = recall.get("empty")
    if empty is None:
        empty = requests - (recall.get("served") or 0)
    empty_share = share(empty, requests)
    mean_pack = tau2.get("meanPackIds")
    p50 = quantiles.get("p50")

    report.predict(
        f"the store states conditions ({PREDICTED_CONDITIONED_MIN}+ of the servable items)",
        conditioned >= PREDICTED_CONDITIONED_MIN,
        f"{conditioned} of {servable}",
    )
    report.predict(
        f"the empty-pack share falls to {PREDICTED_EMPTY_MAX:.0%} or less",
        empty_share is not None and empty_share <= PREDICTED_EMPTY_MAX,
        f"{empty}/{requests} ({empty_share:.3%})" if empty_share is not None else "no requests",
    )
    report.predict(
        f"median rule/query coverage rises to {PREDICTED_P50_MIN:.0%} or more",
        p50 is not None and p50 >= PREDICTED_P50_MIN,
        f"p50 {p50:.4f}" if p50 is not None else "p50 absent",
    )
    report.predict(
        f"the mean pack carries {PREDICTED_MEAN_PACK[0]}-{PREDICTED_MEAN_PACK[1]} rules per request",
        mean_pack is not None
        and PREDICTED_MEAN_PACK[0] <= mean_pack <= PREDICTED_MEAN_PACK[1],
        f"{mean_pack:.3f}" if mean_pack is not None else "meanPackIds absent",
    )

    state = verdict.get("state")
    gate_pass = None
    for gate in artefact.get("gates") or []:
        if gate.get("id") == "l4-paired":
            gate_pass = gate.get("pass")
    report.predict(
        "no revert branch fires: the memory does not cost accuracy",
        (state != "HARM") and (gate_pass is not False),
        f"verdict {state}, l4-paired {'pass' if gate_pass else 'absent/fail'}",
    )

    learning = tau2.get("learning") or {}
    origin = tau2.get("domainOrigin") or {}
    instrument_ok = (
        (mean_pack or 0) > 0
        and (learning.get("distillFailed") or 0) == 0
        and (origin.get("storedWithoutDomain") or 0) == 0
        and (origin.get("unscopedIn") or 0) == 0
    )
    report.predict(
        "the instrument holds: a non-empty pack, no distiller failure, every item accounted",
        instrument_ok,
        f"mean {mean_pack}, distillFailed {learning.get('distillFailed')}, "
        f"withoutDomain {origin.get('storedWithoutDomain')}, unscoped {origin.get('unscopedIn')}",
    )
    report.predict(
        "the same episodes as R49: 4 trials over the held-out half",
        (metrics.get("k") or 0) == 4 and (metrics.get("tasks") or 0) == 50,
        f"k={metrics.get('k')}, tasks={metrics.get('tasks')}",
    )

    # Refutations. Each names one way the account of the defect can be wrong, and
    # each is read before any accuracy number, because a run that fails one of
    # these has nothing to say about accuracy at all.
    report.refute(
        "the write path still produces no condition",
        conditioned == 0,
        f"conditioned {conditioned} of {servable}",
    )
    report.refute(
        "conditions exist and do not reach the pack",
        conditioned >= PREDICTED_CONDITIONED_MIN
        and empty_share is not None
        and empty_share > 0.30,
        f"conditioned {conditioned}, empty share {empty_share:.3%}" if empty_share is not None else "",
    )
    report.refute(
        "the pack fills on scope alone, with no topical gain",
        empty_share is not None
        and empty_share <= PREDICTED_EMPTY_MAX
        and (p50 is None or p50 < PREDICTED_P50_MIN),
        f"empty share {empty_share:.3%}, p50 {p50}",
    )
    report.refute(
        "the memory costs accuracy and the revert rule fires",
        state == "HARM",
        str(verdict.get("reason") or ""),
    )
    report.refute(
        "the run certified nothing",
        not instrument_ok,
        "instrument gate failed",
    )

    if report.refutation_fired:
        return "ABANDONED", report
    return ("GRADED" if report.predictions_ok else "ABANDONED"), report


# --------------------------------------------------------------------------- #
# self-test
# --------------------------------------------------------------------------- #


def base_artefact(**over: Any) -> dict[str, Any]:
    """A clean GRADED artefact: the R49 store with its conditions written."""
    artefact: dict[str, Any] = {
        "id": "poc-l4",
        "metrics": {"pass4": 0.42, "k": 4, "tasks": 50},
        "tau2": {
            "meanPackIds": 1.9,
            "store": {"stored": 10, "active": 10, "servable": 10, "conditioned": 9, "unconditioned": 1},
            "recall": {"requests": 1528, "served": 1420, "empty": 108},
            "coverage": {"nonzeroQuantiles": {"p50": 0.31, "p90": 0.62, "max": 1.0}},
            "learning": {"rows": 32, "edited": 5, "distillFailed": 0},
            "domainOrigin": {"storedWithDomain": 10, "storedWithoutDomain": 0, "unscopedIn": 0},
        },
        "verdict": {"state": "UNRESOLVED", "reason": "does not clear the resolution"},
        "gates": [{"id": "l4-paired", "pass": True, "blocking": True}],
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
        cases: list[tuple[str, dict[str, Any], str]] = [
            ("a clean condition-carrying artefact grades", base_artefact(), "GRADED"),
            (
                "an unconditioned store abandons: the write path is not the defect",
                base_artefact(**{"tau2.store.conditioned": 0}),
                "ABANDONED",
            ),
            (
                "a conditioned store that still serves empty packs abandons",
                base_artefact(**{"tau2.recall.empty": 610, "tau2.recall.served": 918}),
                "ABANDONED",
            ),
            (
                "a pack that fills on scope alone abandons",
                base_artefact(**{"tau2.coverage.nonzeroQuantiles.p50": 0.05}),
                "ABANDONED",
            ),
            (
                "a harm verdict abandons regardless of the census",
                base_artefact(**{"verdict.state": "HARM"}),
                "ABANDONED",
            ),
            (
                "a failed l4-paired treats as harm",
                base_artefact(gates=[{"id": "l4-paired", "pass": False, "blocking": True}]),
                "ABANDONED",
            ),
            (
                "an absent census is a non-measurement, never a zero",
                {"id": "poc-l4", "metrics": {"k": 4, "tasks": 50}, "tau2": {"recall": {"requests": 10}}},
                "NO_MEASUREMENT",
            ),
            (
                "a distiller that failed certifies nothing",
                base_artefact(**{"tau2.learning.distillFailed": 1}),
                "ABANDONED",
            ),
            (
                "the wrong sample size is not this registration",
                base_artefact(**{"metrics.tasks": 115}),
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
    worst = 0
    for path in artefacts:
        state, report = grade(json.loads(path.read_text()))
        print(f"{path}\n  {state}\n{report.render()}\n")
        if state == "ABANDONED":
            worst = 1
    return worst


if __name__ == "__main__":
    sys.exit(main())
