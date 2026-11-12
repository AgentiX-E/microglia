#!/usr/bin/env python3
"""R89 readback: the pack was the constraint, and 2,400 still does not carry two records.

The registration is `prereg/R89-pack-carries-what-it-wrote.md`. R88 left a store of twelve whole
records and a pack that could hold 810 characters of statement, so a record was written and then
dropped at render, and every artefact in the lane reported the consequence as "nothing relevant". R89
raised the budget to 2,400 and predicted that nothing would be dropped and that one recall would carry
two records.

What the arm measured:

  pass^4     0.7018 (+12.68pp over the published 0.575), gates_passed 3
  coverage   25.00% at the median, against R88's 9.09% and R85's 13.04%
  recall     228 of 228 served, 0 empty
  pack       budget 2,400, capacity 2,010, **droppedForSize 1,596**, **meanIds 1**

So the outcome moved and the mechanism did not. One record of ~1,717 characters fills a 2,400-character
pack to 2,107 once the 390-character wrapper is charged, which leaves 293: no second record fits, and
the other eleven candidates are dropped for size on every one of the 228 requests. The arm therefore
priced a **dose** it did not intend to give -- one long record instead of one 700-character record --
and its refutation fires. It is graded `ABANDONED` on the design rather than on the outcome, and the
sentence this file exists to keep separable is that the +12.68pp is real and is *not* evidence that the
pack carries what the writer wrote.

States, the same four the other verifiers use:

  GRADED          every graded prediction holds and no refutation fired.
  NO_MEASUREMENT  the artefact cannot answer the question: no census, or no counts in it.
  DISCARDED       the artefact is another arm, another unit or another scenario pair.
  ABANDONED       a refutation fired.

Usage:
  python3 eval/tools/fetch_evidence.py --repo microglia --run <run-id> --out /tmp/r89
  python3 r89_readback.py --dir /tmp/r89
  python3 r89_readback.py --self-test
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from _funnel import funnel_notes
from r88_readback import (
    Report,
    interval_half_width,
    median_nonzero,
    number,
    sampled_items,
    statuses_of,
)

# Quoted from `prereg/R89-pack-carries-what-it-wrote.md`, written before the measurement existed.
PREDICTED_BUDGET = 2400
PREDICTED_CAPACITY = 2010
PREDICTED_SAMPLE = 228
PREDICTED_MEAN_IDS_MIN = 2
PREDICTED_COVERAGE_P50_MIN = 0.25
PUBLISHED_PASS4 = 0.575
REQUIRED_SCENARIO = {"learn": "retail", "test": "retail", "recall": "retail"}


def pack_census(tau2: dict[str, Any]) -> dict[str, Any] | None:
    block = tau2.get("pack")
    return block if isinstance(block, dict) else None


def grade(artefact: dict[str, Any]) -> tuple[str, Report]:
    report = Report()
    tau2 = artefact.get("tau2") or {}
    metrics = artefact.get("metrics") or {}

    # The chain that carries the treatment, before the treatment: a dead arm is named by its layer.
    funnel_notes(report, artefact)

    scenario = tau2.get("scenario")
    if isinstance(scenario, dict):
        mismatched = {
            key: scenario.get(key) for key, want in REQUIRED_SCENARIO.items() if scenario.get(key) != want
        }
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
        report.predict("the artefact records the unit it distilled", None, "distillUnit absent")
        return "NO_MEASUREMENT", report
    if unit.get("unit") != "raw":
        report.refute(
            "the dispatch ran the treatment rather than another unit", True, f"unit {unit.get('unit')!r}"
        )
        return "DISCARDED", report

    records = tau2.get("rawlog")
    if not isinstance(records, dict):
        report.predict("the artefact records what the store holds", None, "rawlog absent")
        return "NO_MEASUREMENT", report
    written = records.get("records")
    clipped = records.get("clipped")
    if not isinstance(written, int) or not isinstance(clipped, int):
        report.predict("the record census carries its counts", None, json.dumps(records)[:120])
        return "NO_MEASUREMENT", report

    # ---- the write, held fixed -------------------------------------------------------------------
    # Amendment 1: this arm does not move the ceiling, so it inherits what R88 measured rather than
    # predicting the quantity. Graded as "did not change", not as "equals the prediction" -- and the
    # grade is where Amendment 1 turned out to be too strong. The store is built from the tasks whose
    # episodes *failed*, so which twelve corrections exist depends on the trials, and this run's twelve
    # are not R88's twelve: 135 entity values against 128, tasks 3 and 32 present, others absent. A
    # clipping count is therefore comparable in direction across two runs and not by value, which the
    # detail string says instead of leaving the reader to notice it.
    faithfulness_block = tau2.get("faithfulness") or {}
    entities = faithfulness_block.get("entities")
    report.predict(
        "the write is unchanged: same records, same clipping, no model call",
        written == 12 and clipped == 2,
        f"{written} record(s), {clipped} clipped (R88: 12 / 2), llmFailed "
        f"{(tau2.get('learning') or {}).get('llmFailed')!r}",
    )
    report.note(
        f"the correction population is rebuilt from this run's failures: {entities!r} entity value(s) "
        f"against R88's 128, so `clipped` is comparable in direction and not by value"
    )
    learning = tau2.get("learning") or {}
    report.note(
        f"learning: {learning.get('events')!r} event(s), {learning.get('candidates')!r} candidate(s), "
        f"{learning.get('distilled')!r} distilled"
    )

    # ---- the pack --------------------------------------------------------------------------------
    pack = pack_census(tau2)
    if pack is None:
        report.predict(
            "the artefact states the budget and the capacity its pack ran at",
            None,
            "pack census absent: the arm predates the instrument",
        )
        return "NO_MEASUREMENT", report

    budget = pack.get("budget")
    capacity = pack.get("capacity")
    requests = pack.get("requests")
    summary = pack.get("summary") if isinstance(pack.get("summary"), dict) else {}
    mean_ids = number(summary.get("meanIds"))
    mean_chars = number(summary.get("meanChars"))
    dropped = pack.get("droppedForSize")
    emptied = pack.get("emptiedBySize")
    filled = pack.get("filled")
    empty = pack.get("empty")

    report.predict(
        "the budget and the capacity are in the artefact, at the registered values",
        budget == PREDICTED_BUDGET and capacity == PREDICTED_CAPACITY and requests == PREDICTED_SAMPLE,
        f"budget {budget!r}, capacity {capacity!r}, requests {requests!r}",
    )

    # The registration's first prediction, and the only one that says the pack is big enough.
    report.predict(
        "nothing is dropped for size",
        dropped == 0 and emptied == 0,
        f"droppedForSize {dropped!r}, emptiedBySize {emptied!r}, filled {filled!r}, empty {empty!r}",
    )
    # The registration's own second refutation. `droppedForSize` is the counter a run's artefact now
    # carries, so a budget that still refuses candidates says so without a reader inferring it.
    report.refute(
        "the capacity arithmetic is wrong for the text this lane writes",
        isinstance(dropped, int) and dropped > 0,
        f"{dropped} candidate(s) dropped for size over {requests!r} request(s)",
    )

    servable = None
    store = statuses_of(tau2)
    if isinstance(store.get("servable"), int):
        servable = store["servable"]
    elif isinstance(store.get("active"), int):
        servable = store["active"]

    report.predict(
        "one recall carries two records, not one",
        mean_ids is not None and mean_ids >= PREDICTED_MEAN_IDS_MIN,
        f"meanIds {mean_ids!r}, meanChars {mean_chars!r}"
        + (f", servable {servable}" if servable is not None else ""),
    )
    # The registration's third refutation: with something servable and one id per pack, the budget is
    # not what bounds it, and raising the budget again would buy nothing.
    report.refute(
        "something other than the budget bounds the pack",
        mean_ids is not None and mean_ids <= 1 and (servable is None or servable >= 2),
        f"meanIds {mean_ids!r} with {servable!r} servable",
    )

    # ---- the read --------------------------------------------------------------------------------
    coverage = median_nonzero(tau2)
    report.predict(
        f"the pack's median non-zero coverage clears {PREDICTED_COVERAGE_P50_MIN:.0%}",
        None if coverage is None else coverage >= PREDICTED_COVERAGE_P50_MIN,
        "coverage absent"
        if coverage is None
        else f"{coverage:.2%} against R88's 9.09% and R85's 13.04%",
    )
    report.refute(
        "two records per request and the question still shares almost no content word with them",
        coverage is not None
        and mean_ids is not None
        and mean_ids >= PREDICTED_MEAN_IDS_MIN
        and coverage < PREDICTED_COVERAGE_P50_MIN,
        f"{coverage if coverage is None else round(coverage, 4)} at meanIds {mean_ids!r}",
    )

    # ---- the outcome -----------------------------------------------------------------------------
    tasks = metrics.get("tasks")
    pass4 = number(metrics.get("pass4"))
    if pass4 is not None:
        half = interval_half_width(pass4, int(tasks)) if isinstance(tasks, int) else None
        band = "" if half is None else f" ±{half * 100:.2f}pp at n={tasks}"
        report.predict(
            f"pass^4 does not fall below the published {PUBLISHED_PASS4:.3f}",
            pass4 >= PUBLISHED_PASS4,
            f"{pass4:.4f}{band} against {PUBLISHED_PASS4}, gates_passed {metrics.get('gates_passed')!r}",
        )
        # The registration's fifth refutation, and the one that would have been evidence for the
        # negative effect rather than against it.
        report.refute(
            "records reaching the model intact still make the agent worse",
            half is not None and pass4 + half < PUBLISHED_PASS4,
            f"{pass4:.4f} with a {half * 100 if half is not None else 0:.2f}pp half-width",
        )
    else:
        report.predict(f"pass^4 does not fall below the published {PUBLISHED_PASS4:.3f}", None, "pass4 absent")

    report.refute("the arm was scored on four trials", metrics.get("k") != 4, f"k={metrics.get('k')!r}")

    # ---- the verdict -----------------------------------------------------------------------------
    if written == 0:
        report.refute("the arm wrote a store", True, "0 records: the arm did not run")
        return "ABANDONED", report
    if servable == 0:
        report.refute("the store is reachable by the recall scope the arm asks in", True, "0 servable")
        return "ABANDONED", report

    items = sampled_items(tau2)
    if items:
        report.note(f"sampled items: {len(items)}, longest statement {max(len(str(i.get('statement', ''))) for i in items)} chars (artefact truncates)")

    if report.refutation_fired or not report.predictions_ok:
        return "ABANDONED", report
    return "GRADED", report


def base(**over: Any) -> dict[str, Any]:
    """A GRADED artefact: a pack that states its budget, carries two records and refuses nothing."""
    artefact: dict[str, Any] = {
        "id": "poc-l4",
        "metrics": {"pass4": 0.70, "k": 4, "tasks": 57, "published_pass4": PUBLISHED_PASS4, "gates_passed": 3},
        "tau2": {
            "scenario": {"learn": "retail", "test": "retail", "recall": "retail"},
            "distillUnit": {"unit": "raw", "traces": 0, "traced": 0, "claims": 12},
            "learning": {"edited": 12, "events": 12, "candidates": 12, "distilled": 12, "llmFailed": 0},
            "rawlog": {"records": 12, "clipped": 2, "toolBan": False, "ceiling": 2000},
            "store": {"stored": 12, "active": 12, "servable": 12, "statuses": {"active": 12, "candidate": 0}},
            "pack": {
                "budget": PREDICTED_BUDGET,
                "capacity": PREDICTED_CAPACITY,
                "requests": PREDICTED_SAMPLE,
                "filled": PREDICTED_SAMPLE,
                "empty": 0,
                "emptiedBySize": 0,
                "droppedForSize": 0,
                "summary": {"meanIds": 2, "meanChars": 1800},
            },
            "coverage": {"nonzeroQuantiles": {"p50": 0.31}, "measuredPairs": 228},
        },
    }
    for path, value in over.items():
        node = artefact
        keys = path.split(".")
        for key in keys[:-1]:
            if not isinstance(node.get(key), dict):
                node[key] = {}
            node = node[key]
        node[keys[-1]] = value
    return artefact


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dir", help="directory holding the arm artefacts")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        cases: list[tuple[str, dict[str, Any], str]] = [
            ("a pack that carries two records and refuses nothing grades", base(), "GRADED"),
            (
                "R89's own reading, which abandoned on the mechanism while the outcome rose",
                base(**{
                    "tau2.rawlog": {"records": 12, "clipped": 1, "toolBan": False, "ceiling": 2000},
                    "tau2.pack": {
                        "budget": 2400,
                        "capacity": 2010,
                        "requests": 228,
                        "filled": 228,
                        "empty": 0,
                        "emptiedBySize": 0,
                        "droppedForSize": 1596,
                        "summary": {"meanIds": 1, "meanChars": 1717.2},
                    },
                    "tau2.coverage": {"nonzeroQuantiles": {"p50": 0.25}, "measuredPairs": 228},
                    "metrics": {"pass4": 0.7018, "k": 4, "tasks": 57, "gates_passed": 3},
                }),
                "ABANDONED",
            ),
            (
                "a run at another budget is a different cell, not this one",
                base(**{"tau2.pack.budget": 1200}),
                "ABANDONED",
            ),
            (
                "an artefact written before the pack census cannot price a pack",
                base(**{"tau2.pack": None}),
                "NO_MEASUREMENT",
            ),
            (
                "another unit is discarded rather than reinterpreted",
                base(**{"tau2.distillUnit": {"unit": "trace"}}),
                "DISCARDED",
            ),
            (
                "an arm that wrote nothing is named by its layer",
                base(**{"tau2.rawlog": {"records": 0, "clipped": 0, "toolBan": False}}),
                "ABANDONED",
            ),
            (
                "a pack carrying two records with coverage under the bar refutes the object",
                base(**{"tau2.coverage": {"nonzeroQuantiles": {"p50": 0.12}}}),
                "ABANDONED",
            ),
        ]
        failures = 0
        for name, artefact, want in cases:
            got, report = grade(artefact)
            mark = "ok  " if got == want else "FAIL"
            if got != want:
                failures += 1
            print(f"{mark} {got:<15} {name}")
            if got != want:
                print(report.render())
        print(f"\n{len(cases) - failures} of {len(cases)} self-test cases")
        return 0 if failures == 0 else 1

    if not args.dir:
        parser.error("--dir or --self-test is required")
    root = Path(args.dir)
    paths = sorted(root.glob("arms/*/poc-l4.json")) or sorted(root.glob("**/poc-l4.json"))
    if not paths:
        print("no artefact found: expected arms/<arm>/poc-l4.json under " + str(root))
        return 2
    status = 0
    for path in paths:
        artefact = json.loads(path.read_text())
        verdict, report = grade(artefact)
        print(f"{path.parent.name}: {verdict}")
        print(report.render())
        if verdict == "ABANDONED":
            status = 1
    return status


if __name__ == "__main__":
    sys.exit(main())
