#!/usr/bin/env python3
"""R55.0 readback: does anything in the store recur?

The registration is `prereg/R55-material.md`. Its measurement stage has no treatment: it reads two
integers per item that the store already holds, which is why it rides on R56's dispatch at no extra
cost.

The question exists because the competitive record's `sup3` arm admits a claim only when at least
three distinct tasks derived it — 31 of 292 retail guidelines (10.6%), 14 of 101 airline (13.9%) —
and this project has never been able to compute the equivalent number about its own store. It could
not, until R56: the τ² write path never set `EvidenceRef.taskId`, so `distinctTasks` fell back to the
run id, one run per correction, and every item counted as 1 whatever the store contained (AUDIT
34.58). A reading of "our rules never recur" would have been a reading of the recorder.

States, the same four the other verifiers use:

  GRADED          every graded prediction holds and no refutation fired.
  NO_MEASUREMENT  the artefact carries no `supportTasks`, so the question cannot be asked.
  DISCARDED       the scenario pair is not the one the registration names.
  ABANDONED       a refutation fired: nothing recurs, and the account of support is wrong here.

Usage:
  python3 eval/tools/fetch_evidence.py --repo microglia --run <run-id> --out /tmp/r56
  python3 r55_readback.py --dir /tmp/r56
  python3 r55_readback.py --self-test
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

STATES = ("GRADED", "NO_MEASUREMENT", "DISCARDED", "ABANDONED")

# Quoted from `prereg/R55-material.md`, written before the measurement existed.
PREDICTED_AT_THREE_MIN = 2
PREDICTED_AT_TWO_SHARE_MIN = 0.25
PREDICTED_REGISTER_GAP_MIN = 0.15
PREDICTED_SERVABLE_MAX = 40
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
    if denominator <= 0:
        return None
    return numerator / denominator


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


def names_tool(entry: dict[str, Any], inventory: list[str]) -> bool:
    text = f"{entry.get('when') or ''}\n{entry.get('statement') or ''}".lower()
    return any(name.lower() in text for name in inventory)


def distribution(values: list[int]) -> dict[int, int]:
    out: dict[int, int] = {}
    for value in values:
        out[value] = out.get(value, 0) + 1
    return dict(sorted(out.items()))


def grade(artefact: dict[str, Any]) -> tuple[str, Report]:
    report = Report()
    tau2 = artefact.get("tau2") or {}
    store = tau2.get("store") or {}
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

    items = sampled_items(tau2)
    if items is None:
        report.predict("the artefact carries the store's own text", None, "storeItems absent")
        return "NO_MEASUREMENT", report

    population = active_population(items)
    counts = [support_of(entry) for entry in population]
    if not population:
        report.predict("the sample carries at least one active item", None, f"{len(items)} sampled")
        return "NO_MEASUREMENT", report
    if any(count is None for count in counts):
        # R55's own fourth refutation: an instrument that did not record its subject cannot be read
        # as a store with no recurrence, and a partial sample cannot be read as a store either.
        report.predict(
            "every sampled item carries its distinct-task count",
            None,
            f"{sum(1 for count in counts if count is None)} of {len(population)} missing supportTasks",
        )
        return "NO_MEASUREMENT", report

    values = [count for count in counts if count is not None]
    at_three = sum(1 for value in values if value >= 3)
    at_two = sum(1 for value in values if value >= 2)
    two_share = share(at_two, len(values))
    servable = store.get("servable")

    report.predict(
        f"at least {PREDICTED_AT_THREE_MIN} sampled item(s) reach support 3",
        at_three >= PREDICTED_AT_THREE_MIN,
        f"{at_three} of {len(values)} (distribution {distribution(values)})",
    )
    report.predict(
        f"at least {PREDICTED_AT_TWO_SHARE_MIN:.0%} of sampled items reach support 2",
        two_share is not None and two_share >= PREDICTED_AT_TWO_SHARE_MIN,
        f"{at_two} of {len(values)} ({two_share:.3%})" if two_share is not None else "no items",
    )
    report.predict(
        f"the store stays under {PREDICTED_SERVABLE_MAX} servable items",
        servable is not None and servable < PREDICTED_SERVABLE_MAX,
        f"{servable} servable" if servable is not None else "servable absent",
    )

    # The register reading, on the same mechanical test R56 uses: a condition naming one of the
    # split's action names is in the procedure's register, and one naming none is in the user's.
    form = tau2.get("distillForm") or {}
    inventory = [str(name) for name in form.get("toolInventory") or []]
    if not inventory:
        report.predict(
            f"items at support 2 name a tool {PREDICTED_REGISTER_GAP_MIN:.0%} less often than items at support 1",
            None,
            "no tool inventory in the artefact: the register test cannot run",
        )
    else:
        many = [entry for entry in population if (support_of(entry) or 0) >= 2]
        one = [entry for entry in population if (support_of(entry) or 0) == 1]
        many_share = share(sum(1 for entry in many if names_tool(entry, inventory)), len(many))
        one_share = share(sum(1 for entry in one if names_tool(entry, inventory)), len(one))
        if many_share is None or one_share is None:
            report.predict(
                f"items at support 2 name a tool {PREDICTED_REGISTER_GAP_MIN:.0%} less often than items at support 1",
                None,
                f"support>=2: {len(many)} item(s), support 1: {len(one)} item(s)",
            )
        else:
            report.predict(
                f"items at support 2 name a tool {PREDICTED_REGISTER_GAP_MIN:.0%} less often than items at support 1",
                one_share - many_share >= PREDICTED_REGISTER_GAP_MIN,
                f"support 1: {one_share:.3f} ({len(one)}), support >=2: {many_share:.3f} ({len(many)})",
            )

    report.predict(
        "the run is the registered trial count: four",
        (metrics.get("k") or 0) == 4,
        f"k={metrics.get('k')}, tasks={metrics.get('tasks')}",
    )
    episodes = (metrics.get("tasks") or 0) * (metrics.get("k") or 0)
    report.note(
        f"episodes {episodes} ({metrics.get('tasks')} tasks at k={metrics.get('k')}); "
        "the registration declares sample 228 and reads the count as context"
    )
    block = tau2.get("storeItems") or {}
    report.note(
        f"sample: {len(items)} items, {len(population)} active, {block.get('omitted')} omitted, "
        f"{block.get('truncated')} truncated"
    )
    if at_two == 0:
        report.note("no item reaches support 2: every claim in this store was derived once")

    # R55's first refutation, verbatim: nothing reaching 2 closes the support axis here.
    report.refute(
        "nothing recurs: no item reaches support 2, so the grain is one claim per correction",
        at_two == 0,
        f"distribution {distribution(values)}",
    )

    if report.refutation_fired:
        return "ABANDONED", report
    return ("GRADED" if report.predictions_ok else "ABANDONED"), report


# --------------------------------------------------------------------------- #
# self-test
# --------------------------------------------------------------------------- #


def base_artefact(**over: Any) -> dict[str, Any]:
    """A GRADED artefact: two items recur, the register reading separates, the store stays thin."""
    artefact: dict[str, Any] = {
        "id": "poc-l4",
        "metrics": {"pass4": 0.44, "k": 4, "tasks": 57},
        "tau2": {
            "scenario": {"learn": "retail", "test": "retail", "recall": "retail"},
            "distillForm": {
                "form": "procedure",
                "toolInventory": ["cancel_pending_order", "find_user"],
                "refused": 3,
            },
            "store": {"stored": 16, "active": 16, "servable": 16, "conditioned": 16, "unconditioned": 0},
            "storeItems": {
                "items": [
                    {"id": "a", "status": "active", "supportTasks": 3, "when": "when a customer cancels an order",
                     "statement": "confirm the order before acting"},
                    {"id": "b", "status": "active", "supportTasks": 3, "when": "when an order has not shipped",
                     "statement": "confirm the order before acting"},
                    {"id": "c", "status": "active", "supportTasks": 2, "when": "when a refund is requested",
                     "statement": "confirm the payment first"},
                    {"id": "d", "status": "active", "supportTasks": 1, "when": "when find_user returns a row",
                     "statement": "call cancel_pending_order"},
                    {"id": "e", "status": "active", "supportTasks": 1, "when": "when find_user matches twice",
                     "statement": "call find_user again"},
                ],
                "limit": 64,
                "maxChars": 240,
                "omitted": 0,
                "truncated": 0,
            },
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
        only_once = {
            "id": "poc-l4",
            "metrics": {"k": 4, "tasks": 57},
            "tau2": {
                "scenario": {"learn": "retail", "test": "retail", "recall": "retail"},
                "distillForm": {"form": "procedure", "toolInventory": ["find_user"], "refused": 0},
                "store": {"stored": 2, "servable": 2},
                "storeItems": {
                    "items": [
                        {"id": "a", "status": "active", "supportTasks": 1, "when": "w", "statement": "s"},
                        {"id": "b", "status": "active", "supportTasks": 1, "when": "w", "statement": "s"},
                    ],
                    "limit": 64,
                    "maxChars": 240,
                    "omitted": 0,
                    "truncated": 0,
                },
            },
        }
        cases: list[tuple[str, dict[str, Any], str]] = [
            ("a store where two items recur grades", base_artefact(), "GRADED"),
            (
                "nothing reaching support 2 closes the support axis",
                only_once,
                "ABANDONED",
            ),
            (
                "a different scenario pair is discarded rather than reinterpreted",
                base_artefact(**{"tau2.scenario.test": "airline"}),
                "DISCARDED",
            ),
            (
                "an artefact without the sample cannot be read",
                base_artefact(**{"tau2.storeItems": None}),
                "NO_MEASUREMENT",
            ),
            (
                "a sample with no active item cannot be read either",
                base_artefact(**{"tau2.storeItems.items": [
                    {"id": "a", "status": "retired", "supportTasks": 3, "when": "w", "statement": "s"},
                ]}),
                "NO_MEASUREMENT",
            ),
            (
                "an item without its count makes the sample partial",
                base_artefact(**{"tau2.storeItems.items": [
                    {"id": "a", "status": "active", "supportTasks": 3, "when": "w", "statement": "s"},
                    {"id": "b", "status": "active", "when": "w", "statement": "s"},
                ]}),
                "NO_MEASUREMENT",
            ),
            (
                "one item at support 3 is not the two the prediction asks for",
                base_artefact(**{"tau2.storeItems.items": [
                    {"id": "a", "status": "active", "supportTasks": 3, "when": "w", "statement": "s"},
                    {"id": "b", "status": "active", "supportTasks": 2, "when": "w", "statement": "s"},
                    {"id": "c", "status": "active", "supportTasks": 2, "when": "w", "statement": "s"},
                ]}),
                "ABANDONED",
            ),
            (
                "the store spending its whole budget on items abandons the density reading",
                base_artefact(**{"tau2.store": {"stored": 60, "servable": 60}}),
                "ABANDONED",
            ),
            (
                "no inventory leaves the register prediction ungraded, and the run still grades",
                base_artefact(**{"tau2.distillForm.toolInventory": []}),
                "GRADED",
            ),
            (
                "a register that does not separate fails the prediction",
                base_artefact(**{"tau2.storeItems.items": [
                    {"id": "a", "status": "active", "supportTasks": 3, "when": "when find_user matches",
                     "statement": "call cancel_pending_order"},
                    {"id": "b", "status": "active", "supportTasks": 3, "when": "when find_user matches",
                     "statement": "call cancel_pending_order"},
                    {"id": "c", "status": "active", "supportTasks": 2, "when": "when find_user matches",
                     "statement": "call cancel_pending_order"},
                    {"id": "d", "status": "active", "supportTasks": 1, "when": "when a customer cancels",
                     "statement": "confirm the order"},
                ]}),
                "ABANDONED",
            ),
            (
                "a pair that did not run four trials abandons",
                base_artefact(**{"metrics.k": 1}),
                "ABANDONED",
            ),
            (
                "a sample that carries no status is read over the whole sample",
                base_artefact(**{"tau2.storeItems.items": [
                    {"id": "a", "supportTasks": 3, "when": "when a customer cancels", "statement": "s"},
                    {"id": "b", "supportTasks": 3, "when": "when an order ships", "statement": "s"},
                    {"id": "c", "supportTasks": 2, "when": "when a refund is requested", "statement": "s"},
                ]}),
                "GRADED",
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
        if state in ("ABANDONED", "DISCARDED"):
            worst = 1
    return worst


if __name__ == "__main__":
    sys.exit(main())
