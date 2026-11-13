#!/usr/bin/env python3
"""R90 readback: the guard was taught, and the store turned out not to be the same store.

The registration is `prereg/R90-guard-stops-eating-references.md`. R88 lost 46 of 128 entity values to
`kernel/guard.ts`, whose phone rule is ten digits and a τ² retail answer is made of ten-digit product
ids, so a record reached the model naming the *shape* of an answer with `[phone]` where the identity
belonged. R90 exempts a bare digit run under a reference key and predicted three readable things: the
store keeps its identities, nothing else about the write moves, and `pass^4` behaves accordingly.

What the arm measured:

  faithfulness   171 of 172 entity values kept (99.42%), exactly one redacted
  records        15, not the 12 the registration predicted (±2)
  pack           2,400 / 2,010, meanIds 1, droppedForSize 1,596 -- as Amendment 1 inherited
  coverage       28.00% at the median, against R89's 25.00%
  pass^4         0.6316 ±12.52pp, +5.66pp over the published 0.575 and -7.02pp against R89's 0.7018

So the signature held and the outcome stayed above the published bar, and the arm still cannot say
what the identity was worth -- because the store it priced is not the store R89 priced. R89 wrote 12
corrections from its learn half, this run wrote 15 from the same 57 tasks at the same one trial, and
only 8 task ids are shared. The learn half is a sampling of a model, the store is built from whichever
tasks that sampling failed, and so the *treatment* changes between two runs whose registration says
"one variable". That is a defect of this lane's design rather than of this arm, and it is the reason
the readback grades three things apart:

  the signature   the exemption is on the write path      (kept >= 95%, redacted == 1)
  the write       records and clipping, as registered     (this is the row that fails)
  the outcome     pass^4 against the published bar        (and its interval, which overlaps R89's)

The verdict is `ABANDONED` on the design, and the sentence this file exists to keep separable is that
the 99.42% is real, the +5.66pp is real, and neither of them is evidence about what the placeholder
cost -- the next arm has to freeze the store before any of these questions can be asked.

States, the same four the other verifiers use:

  GRADED          every graded prediction holds and no refutation fired.
  NO_MEASUREMENT  the artefact cannot answer the question: no census, or no counts in it.
  DISCARDED       the artefact is another arm, another unit or another scenario pair.
  ABANDONED       a refutation fired.

Usage:
  python3 eval/tools/fetch_evidence.py --repo microglia --run <run-id> --out /tmp/r90
  python3 r90_readback.py --dir /tmp/r90 [--previous /tmp/r89]
  python3 r90_readback.py --self-test
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
    share,
)

# Quoted from `prereg/R90-guard-stops-eating-references.md`, written before the measurement existed.
PREDICTED_RECORDS = 12
PREDICTED_RECORD_SLACK = 2
PREDICTED_CLIPPED = 2
PREDICTED_KEPT_SHARE = 0.95
PREDICTED_REDACTED = 1
PREDICTED_BUDGET = 2400
PREDICTED_CAPACITY = 2010
PREDICTED_SAMPLE = 228
PREDICTED_MEAN_IDS = 1
PREDICTED_COVERAGE_P50_MIN = 0.25
R89_COVERAGE_P50 = 0.25
R89_PASS4 = 0.7018
PUBLISHED_PASS4 = 0.575
REQUIRED_SCENARIO = {"learn": "retail", "test": "retail", "recall": "retail"}


def correction_tasks(artefact: dict[str, Any]) -> list[str]:
    """The task ids the store was built from, as the run's own census names them."""
    census = (artefact.get("tau2") or {}).get("yieldCensus")
    if not isinstance(census, dict):
        return []
    rows = census.get("perCorrection")
    if not isinstance(rows, list):
        return []
    return [str(row.get("taskId")) for row in rows if isinstance(row, dict) and row.get("taskId") is not None]


def store_overlap(
    current: dict[str, Any], previous: dict[str, Any]
) -> dict[str, Any] | None:
    """How much of the previous arm's store this run rebuilt.

    The quantity the registration assumed was fixed by saying "one variable". It is not: the learn
    half is one trial per task, so which tasks fail is a draw, and the store is made of the failures.
    """
    mine = correction_tasks(current)
    theirs = correction_tasks(previous)
    if not mine or not theirs:
        return None
    shared = sorted(set(mine) & set(theirs), key=lambda value: (len(value), value))
    return {
        "current": len(mine),
        "previous": len(theirs),
        "shared": shared,
        "onlyCurrent": sorted(set(mine) - set(theirs), key=lambda value: (len(value), value)),
        "onlyPrevious": sorted(set(theirs) - set(mine), key=lambda value: (len(value), value)),
    }


def grade(
    artefact: dict[str, Any], previous: dict[str, Any] | None = None
) -> tuple[str, Report]:
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

    # ---- the signature: is the exemption on the path the driver takes? ----------------------------
    # The registration's first prediction and the only one that distinguishes a guard that was taught
    # from a guard that was edited and never called. `redacted` is the counter that makes the share
    # readable: 172 of 172 kept would mean the exemption is taking values the guard should have kept.
    faithfulness = tau2.get("faithfulness") or {}
    entities = faithfulness.get("entities")
    kept = faithfulness.get("kept")
    redacted = faithfulness.get("redacted")
    kept_share = share(number(kept) or 0, number(entities) or 0) if isinstance(entities, int) else None
    if kept_share is None:
        report.predict(
            f"at least {PREDICTED_KEPT_SHARE:.0%} of the corrections' own values survive the write",
            None,
            f"faithfulness absent or empty: entities {entities!r}, kept {kept!r}",
        )
    else:
        report.predict(
            f"at least {PREDICTED_KEPT_SHARE:.0%} of the corrections' own values survive the write",
            kept_share >= PREDICTED_KEPT_SHARE and redacted == PREDICTED_REDACTED,
            f"{kept} of {entities} kept ({kept_share:.2%}), {redacted!r} replaced by the guard "
            f"(R88: 82 of 128 = 64.06%)",
        )
        # The registration's second refutation: the share is unchanged, so the exemption is not on
        # the write path -- a stale build, or a second redaction site the edit missed.
        report.refute(
            "the guard change is not on the write path",
            kept_share < PREDICTED_KEPT_SHARE,
            f"{kept_share:.2%} kept: R88 kept 64.06%, so the exemption did not reach the record",
        )
        # The registration's third refutation: an exemption that takes more than its documented case
        # makes the counter an alibi rather than a measurement.
        report.refute(
            "the exemption takes more than the one case it documents",
            isinstance(redacted, int) and redacted > PREDICTED_REDACTED,
            f"{redacted!r} value(s) replaced while the exemption is active",
        )

    # ---- the write, held fixed: the row that fails -------------------------------------------------
    learning = tau2.get("learning") or {}
    report.predict(
        f"the write is unchanged: {PREDICTED_RECORDS}±{PREDICTED_RECORD_SLACK} records, "
        f"{PREDICTED_CLIPPED} clipped",
        abs(written - PREDICTED_RECORDS) <= PREDICTED_RECORD_SLACK and clipped == PREDICTED_CLIPPED,
        f"{written} record(s), {clipped} clipped (registered {PREDICTED_RECORDS}±{PREDICTED_RECORD_SLACK}"
        f" / {PREDICTED_CLIPPED}, R89 wrote 12 / 1)",
    )
    report.predict(
        "the write costs no model call, so nothing could fault",
        isinstance(learning.get("events"), int)
        and learning.get("candidates") == learning.get("events")
        and (learning.get("llmFailed", 0) in (0, None)),
        f"events {learning.get('events')!r}, candidates {learning.get('candidates')!r}, "
        f"llmFailed {learning.get('llmFailed')!r}",
    )

    # ---- the pack, inherited by Amendment 1 --------------------------------------------------------
    pack = tau2.get("pack")
    if not isinstance(pack, dict):
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
        "the budget and the capacity are at the registered values",
        budget == PREDICTED_BUDGET and capacity == PREDICTED_CAPACITY and requests == PREDICTED_SAMPLE,
        f"budget {budget!r}, capacity {capacity!r}, requests {requests!r}",
    )
    # Amendment 1 replaced the registration's "nothing is dropped for size" with R89's measurement,
    # because an arm whose only variable is the guard cannot predict its pack. Graded as "did not
    # change", which is the stricter reading: restoring an identity makes a record *longer*.
    report.predict(
        "the pack carries one record, as R89 measured",
        mean_ids == PREDICTED_MEAN_IDS
        and isinstance(dropped, int)
        and dropped > 0
        and filled == PREDICTED_SAMPLE
        and empty == 0,
        f"meanIds {mean_ids!r}, meanChars {mean_chars!r}, droppedForSize {dropped!r}, "
        f"emptiedBySize {emptied!r}, filled {filled!r}, empty {empty!r}",
    )

    # ---- the read ----------------------------------------------------------------------------------
    coverage = median_nonzero(tau2)
    # The census block rather than its `statuses` sub-block: `servable` sits beside the statuses, and the
    # nested read reported a reachable store as `active`, which is the same number here and not the same
    # field -- the distinction matters the first time the two disagree.
    store = tau2.get("store") if isinstance(tau2.get("store"), dict) else {}
    servable = store.get("servable") if isinstance(store.get("servable"), int) else store.get("active")
    if coverage is None:
        report.predict(
            f"the pack's median non-zero coverage clears {PREDICTED_COVERAGE_P50_MIN:.0%}",
            None,
            "coverage absent",
        )
    else:
        moved = coverage - R89_COVERAGE_P50
        report.predict(
            f"the pack's median non-zero coverage clears {PREDICTED_COVERAGE_P50_MIN:.0%}",
            coverage >= PREDICTED_COVERAGE_P50_MIN,
            f"{coverage:.2%} against R89's {R89_COVERAGE_P50:.2%} and R88's 9.09% "
            f"({moved * 100:+.2f}pp, at meanIds {mean_ids!r})",
        )

    # ---- the outcome -------------------------------------------------------------------------------
    tasks = metrics.get("tasks")
    pass4 = number(metrics.get("pass4"))
    half = interval_half_width(pass4, int(tasks)) if pass4 is not None and isinstance(tasks, int) else None
    if pass4 is None:
        report.predict(
            f"pass^4 does not fall below the published {PUBLISHED_PASS4:.3f}", None, "pass4 absent"
        )
    else:
        band = "" if half is None else f" ±{half * 100:.2f}pp at n={tasks}"
        report.predict(
            f"pass^4 does not fall below the published {PUBLISHED_PASS4:.3f}",
            pass4 >= PUBLISHED_PASS4,
            f"{pass4:.4f}{band} against {PUBLISHED_PASS4}, {pass4 - PUBLISHED_PASS4:+.4f} "
            f"({(pass4 - PUBLISHED_PASS4) * 100:+.2f}pp), gates_passed {metrics.get('gates_passed')!r}",
        )
        # The registration's fourth refutation, and the first arrangement in which it would have been
        # evidence *for* a negative effect rather than against one.
        report.refute(
            "whole records carrying real identities still make the agent worse than no memory",
            coverage is not None
            and coverage >= PREDICTED_COVERAGE_P50_MIN
            and pass4 < PUBLISHED_PASS4,
            f"{pass4:.4f} at coverage {coverage if coverage is None else round(coverage, 4)}",
        )
        # Not a registration row: the comparison the registration's title implies. Reported with both
        # intervals so a reader can see that the difference is inside the noise rather than conclude
        # from the point estimates that restoring identities cost 7 points.
        if half is not None:
            r89_half = interval_half_width(R89_PASS4, int(tasks))
            overlap = (pass4 + half) >= (R89_PASS4 - r89_half) if r89_half is not None else None
            report.note(
                f"against R89: {pass4 - R89_PASS4:+.4f} ({(pass4 - R89_PASS4) * 100:+.2f}pp); "
                f"intervals {pass4 - half:.4f}-{pass4 + half:.4f} and "
                f"{R89_PASS4 - (r89_half or 0):.4f}-{R89_PASS4 + (r89_half or 0):.4f}"
                + ("" if overlap is None else (", overlapping" if overlap else ", disjoint"))
            )
    report.predict("the arm was scored on four trials", metrics.get("k") == 4, f"k={metrics.get('k')!r}")

    # ---- the design: was this one variable? ---------------------------------------------------------
    # Written by this readback rather than quoted from the registration, and marked as such. The
    # registration's premise is that the guard is the only thing that moved, and the store is built
    # from whichever learn tasks failed -- a draw, not a constant. Without this row a -7.02pp would be
    # read as "the identity made it worse", which is a statement about a store this arm never priced.
    if previous is None:
        report.note(
            "the store-fixed row cannot be read without the previous arm; pass --previous to price it"
        )
    else:
        overlap = store_overlap(artefact, previous)
        if overlap is None:
            report.note("the store-fixed row cannot be read: one of the two arms states no correction census")
        else:
            fixed = overlap["current"] == overlap["previous"] and not overlap["onlyCurrent"] and not overlap["onlyPrevious"]
            report.refute(
                "the store is the store the previous arm built, so the guard is the only variable",
                not fixed,
                f"{overlap['current']} correction(s) here against {overlap['previous']} there, "
                f"{len(overlap['shared'])} task id(s) shared, "
                f"{len(overlap['onlyCurrent'])} only here, {len(overlap['onlyPrevious'])} only there",
            )
            report.note(
                "corrections that are only here: " + (", ".join(overlap["onlyCurrent"]) or "none")
            )
            report.note(
                "corrections that are only in the previous arm: "
                + (", ".join(overlap["onlyPrevious"]) or "none")
            )

    # ---- the verdict -------------------------------------------------------------------------------
    if written == 0:
        report.refute("the arm wrote a store", True, "0 records: the arm did not run")
        return "ABANDONED", report
    if servable == 0:
        report.refute("the store is reachable by the recall scope the arm asks in", True, "0 servable")
        return "ABANDONED", report

    items = sampled_items(tau2)
    if items:
        longest = max(len(str(item.get("statement", ""))) for item in items)
        report.note(f"sampled items: {len(items)}, longest statement {longest} chars (artefact truncates)")

    if report.refutation_fired or not report.predictions_ok:
        return "ABANDONED", report
    return "GRADED", report


def base(**over: Any) -> dict[str, Any]:
    """A GRADED artefact: the exemption on the write path, the write and pack as registered."""
    artefact: dict[str, Any] = {
        "id": "poc-l4",
        "metrics": {"pass4": 0.70, "k": 4, "tasks": 57, "published_pass4": PUBLISHED_PASS4, "gates_passed": 3},
        "tau2": {
            "scenario": {"learn": "retail", "test": "retail", "recall": "retail"},
            "distillUnit": {"unit": "raw", "traces": 0, "traced": 0, "claims": 12},
            "learning": {"edited": 12, "events": 12, "candidates": 12, "distilled": 12, "llmFailed": 0},
            "rawlog": {"records": 12, "clipped": 2, "toolBan": False, "ceiling": 2000},
            "store": {"stored": 12, "active": 12, "servable": 12, "statuses": {"active": 12, "candidate": 0}},
            "faithfulness": {
                "corrections": 12,
                "entities": 128,
                "kept": 127,
                "whole": 11,
                "unwritten": 0,
                "redacted": 1,
            },
            "pack": {
                "budget": PREDICTED_BUDGET,
                "capacity": PREDICTED_CAPACITY,
                "requests": PREDICTED_SAMPLE,
                "filled": PREDICTED_SAMPLE,
                "empty": 0,
                "emptiedBySize": 0,
                "droppedForSize": 1596,
                "summary": {"meanIds": 1, "meanChars": 1780},
            },
            "coverage": {"nonzeroQuantiles": {"p50": 0.28}, "measuredPairs": 228},
            "yieldCensus": {"corrections": 12, "perCorrection": [{"taskId": str(i), "claims": 1} for i in range(12)]},
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


def previous_arm(**over: Any) -> dict[str, Any]:
    """An arm that built the same store: the fixture the store-fixed row is graded against."""
    return base(**over)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dir", help="directory holding the arm artefacts")
    parser.add_argument("--previous", help="directory or file holding the arm this one is compared to")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        same_store = previous_arm()
        r89_store = previous_arm(
            **{
                "tau2.yieldCensus": {
                    "corrections": 12,
                    "perCorrection": [{"taskId": task, "claims": 1} for task in
                                      ["3", "15", "18", "20", "32", "33", "34", "38", "41", "100", "107", "110"]],
                }
            }
        )
        cases: list[tuple[str, dict[str, Any], dict[str, Any] | None, str]] = [
            ("the exemption is on the write path and the write is as registered", base(), same_store, "GRADED"),
            (
                "the guard never reached the record",
                base(**{"tau2.faithfulness": {"corrections": 12, "entities": 128, "kept": 82, "redacted": 1}}),
                same_store,
                "ABANDONED",
            ),
            (
                "the exemption takes a value the guard should have kept",
                base(**{"tau2.faithfulness": {"corrections": 12, "entities": 128, "kept": 127, "redacted": 3}}),
                same_store,
                "ABANDONED",
            ),
            (
                "fifteen records is outside the registered slack, and that is the row that fails",
                base(**{
                    "tau2.rawlog": {"records": 15, "clipped": 2, "toolBan": False, "ceiling": 2000},
                }),
                same_store,
                "ABANDONED",
            ),
            (
                "R90 as measured: the signature held, the store did not",
                base(**{
                    "tau2.rawlog": {"records": 15, "clipped": 2, "toolBan": False, "ceiling": 2000},
                    "tau2.faithfulness": {
                        "corrections": 15,
                        "entities": 172,
                        "kept": 171,
                        "whole": 14,
                        "unwritten": 0,
                        "redacted": 1,
                    },
                    "tau2.learning": {"edited": 15, "events": 15, "candidates": 15, "distilled": 15, "llmFailed": 0},
                    "tau2.coverage": {"nonzeroQuantiles": {"p50": 0.28}, "measuredPairs": 228},
                    "tau2.pack": {
                        "budget": 2400,
                        "capacity": 2010,
                        "requests": 228,
                        "filled": 228,
                        "empty": 0,
                        "emptiedBySize": 0,
                        "droppedForSize": 1596,
                        "summary": {"meanIds": 1, "meanChars": 1825.3},
                    },
                    "metrics": {"pass4": 0.6316, "k": 4, "tasks": 57, "gates_passed": 3},
                    "tau2.yieldCensus": {
                        "corrections": 15,
                        "perCorrection": [{"taskId": task, "claims": 1} for task in
                                          ["0", "15", "18", "20", "27", "31", "32", "33", "34", "38",
                                           "103", "104", "107", "109", "111"]],
                    },
                }),
                r89_store,
                "ABANDONED",
            ),
            (
                "a pack carrying two records is another cell, not this one",
                base(**{"tau2.pack.summary": {"meanIds": 2, "meanChars": 1800}}),
                same_store,
                "ABANDONED",
            ),
            (
                "an arm at another budget cannot price this pack",
                base(**{"tau2.pack.budget": 4800}),
                same_store,
                "ABANDONED",
            ),
            (
                "another unit is discarded rather than reinterpreted",
                base(**{"tau2.distillUnit": {"unit": "trace"}}),
                same_store,
                "DISCARDED",
            ),
            (
                "an artefact written before the pack census cannot price a pack",
                base(**{"tau2.pack": None}),
                same_store,
                "NO_MEASUREMENT",
            ),
            (
                "an arm that wrote nothing is named by its layer",
                base(**{"tau2.rawlog": {"records": 0, "clipped": 0, "toolBan": False}}),
                same_store,
                "ABANDONED",
            ),
            (
                "records intact, coverage above the floor, and the agent still worse than no memory",
                base(**{
                    "metrics": {"pass4": 0.50, "k": 4, "tasks": 57, "gates_passed": 3},
                    "tau2.coverage": {"nonzeroQuantiles": {"p50": 0.30}, "measuredPairs": 228},
                }),
                same_store,
                "ABANDONED",
            ),
        ]
        failures = 0
        for name, artefact, previous, want in cases:
            got, report = grade(artefact, previous)
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
    previous: dict[str, Any] | None = None
    if args.previous:
        candidate = Path(args.previous)
        path = candidate if candidate.is_file() else next(
            iter(sorted(candidate.glob("arms/*/poc-l4.json")) or sorted(candidate.glob("**/poc-l4.json"))),
            None,
        )
        if path is None:
            print("no previous artefact found under " + str(candidate))
            return 2
        previous = json.loads(Path(path).read_text())

    paths = sorted(root.glob("arms/*/poc-l4.json")) or sorted(root.glob("**/poc-l4.json"))
    if not paths:
        print("no artefact found: expected arms/<arm>/poc-l4.json under " + str(root))
        return 2
    status = 0
    for path in paths:
        artefact = json.loads(path.read_text())
        verdict, report = grade(artefact, previous)
        print(f"{path.parent.name}: {verdict}")
        print(report.render())
        if verdict == "ABANDONED":
            status = 1
    return status


if __name__ == "__main__":
    sys.exit(main())
