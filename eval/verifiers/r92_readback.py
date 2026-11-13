#!/usr/bin/env python3
"""R92 readback: is this the first number anyone can compare?

The registration is `prereg/R92-the-benchmarks-own-halves.md`. Every held-out number in this record —
0.5752, 0.5614, 0.7018, 0.6316 — was measured on a set this lane cut itself (`TRAIN_SHARE = 0.5`, 57/57),
because nobody read `data/tau2/domains/retail/split_tasks.json`. τ² ships **74 train / 40 test** in that
file, and the published held-out figure this lane has been ranking itself against (ALTK-Evolve, 67.5%) was
produced on the 40.

So this arm is not a treatment. It is the same lane, on the sample the benchmark defines, and its rows are
equalities about the instrument before they are anything about memory:

  the release   the artefact names v1.0.1, the release the 67.5% was produced on
  the halves    74 learned, 40 held out, and `metrics.tasks` = 40
  the store     built from the wider half: `learning.edited` in [10, 25]
  the write     whole: `store.stored` = `learning.edited`, at least one servable
  the pack      R90's shape, not R90's text: budget 2,400, capacity 2,010, `meanIds` 1, `droppedForSize` > 0
  the question  recorded (`queries.requests` = 160), unpinned by design (`replaced` = 0, `pin` null)
  the outcome   `pass^4` against 0.575, with its interval and **no direction**

The last two rows are this round's addition to the instrument. R91 showed that a pack is a function of
(store, query, pack options) and that the query is sampled; this arm records the query instead of pinning
it, because its product is an absolute number and a pinned phrasing is a stimulus no user typed. A readback
that cannot see the census must say so rather than assume the questions were identical.

States, the same four the other verifiers use:

  GRADED          every graded prediction holds and no refutation fired.
  NO_MEASUREMENT  the artefact cannot answer the question: no split, no census, or no counts in it.
  DISCARDED       the artefact is another arm, another unit or another scenario pair.
  ABANDONED       a refutation fired.

Usage:
  python3 eval/tools/fetch_evidence.py --repo microglia --run <run-id> --out /tmp/r92
  python3 r92_readback.py --dir /tmp/r92
  python3 r92_readback.py --self-test
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from _funnel import funnel_notes
from r88_readback import Report, interval_half_width, number, sampled_items

# Quoted from `prereg/R92-the-benchmarks-own-halves.md`, written before the measurement existed.
PREDICTED_TRAIN = 74
PREDICTED_TASKS = 40
PREDICTED_SAMPLE = 160
PREDICTED_EDITED_LOW = 10
PREDICTED_EDITED_HIGH = 25
PREDICTED_BUDGET = 2400
PREDICTED_CAPACITY = 2010
PUBLISHED_PASS4 = 0.575
# The release the published figure was produced on, and the one this registration pinned. R92's first
# dispatch ran v0.2.0, which does not ship the split file at all; the bodies and the retail reward moved
# between the two, so a number is comparable to 67.5% only inside this release.
REQUIRED_RELEASE = "v1.0.1"
REQUIRED_SCENARIO = {"learn": "retail", "test": "retail", "recall": "retail"}


def split_lengths(tau2: dict[str, Any]) -> tuple[int | None, int | None]:
    """The two halves as the artefact records them, or `None` where it records neither.

    `split` holds the unqualified ids the driver asked τ² for; `metrics.tasks` is the scored half. The two
    are checked against each other rather than one standing for both: a run that asked for 40 tasks and
    scored 40 is an arm, and a run that asked for 40 and scored 12 is a corpus mismatch that produced a
    number.
    """
    block = tau2.get("split")
    if not isinstance(block, dict):
        return None, None
    train = block.get("train")
    test = block.get("test")
    return (
        len(train) if isinstance(train, list) else None,
        len(test) if isinstance(test, list) else None,
    )


def grade(
    artefact: dict[str, Any], previous: dict[str, Any] | None = None
) -> tuple[str, Report]:
    report = Report()
    tau2 = artefact.get("tau2") or {}
    metrics = artefact.get("metrics") or {}

    funnel_notes(report, artefact)

    scenario = tau2.get("scenario")
    if isinstance(scenario, dict):
        mismatched = {
            key: scenario.get(key)
            for key, want in REQUIRED_SCENARIO.items()
            if scenario.get(key) != want
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
            "the dispatch ran the treatment rather than another unit",
            True,
            f"unit {unit.get('unit')!r}",
        )
        return "DISCARDED", report

    # ---- the halves: the arm's whole subject ------------------------------------------------------
    train, test = split_lengths(tau2)
    if train is None or test is None:
        report.predict(
            "the artefact records the two halves it ran",
            None,
            "split block absent: the sample this arm exists to fix was not recorded",
        )
        return "NO_MEASUREMENT", report
    scored = metrics.get("tasks")
    report.predict(
        "the halves are the benchmark's: 74 learned, 40 held out",
        train == PREDICTED_TRAIN and test == PREDICTED_TASKS,
        f"train {train}, test {test} (registered {PREDICTED_TRAIN} / {PREDICTED_TASKS})",
    )
    # The registration's first refutation, and the one that decides whether anything below is comparable:
    # a number produced on this lane's own cut is the defect, not a smaller sample of the fix.
    report.refute(
        "the split was not read",
        train != PREDICTED_TRAIN or test != PREDICTED_TASKS,
        f"{train} / {test} against the registered {PREDICTED_TRAIN} / {PREDICTED_TASKS}",
    )
    report.predict(
        "the scored half is the held-out half",
        scored == PREDICTED_TASKS,
        f"metrics.tasks {scored!r}",
    )
    report.refute(
        "the run absorbed a corpus mismatch and reported a number anyway",
        scored is not None and scored != PREDICTED_TASKS,
        f"metrics.tasks {scored!r} for {test} held-out task(s)",
    )

    # ---- the release: the axis this round added, and the one a dispatch paid for ---------------------
    #
    # `split_tasks.json` ships from v1.0.0 and the competitor's held-out figure was produced on v1.0.1, so
    # the release is part of what the number means: 0 of 114 retail task bodies survive the boundary, and
    # retail's `reward_basis` moves from the implicit `DB+COMMUNICATE` to a declared `DB+NL_ASSERTION` on
    # 112 tasks. An artefact that does not name it cannot be ranked against a published figure, and
    # "absent" is graded as a failure rather than read as the release the lane used to pin.
    benchmark = tau2.get("benchmark")
    version = benchmark.get("version") if isinstance(benchmark, dict) else None
    commit = benchmark.get("commit") if isinstance(benchmark, dict) else None
    report.predict(
        f"the artefact names the release it ran ({REQUIRED_RELEASE})",
        version == REQUIRED_RELEASE,
        f"{version!r} at {str(commit)[:8]!r}",
    )
    report.refute(
        "the run changed the release between the registration and the measurement",
        version is not None and version != REQUIRED_RELEASE,
        f"release {version!r} against the registered {REQUIRED_RELEASE}",
    )

    # ---- the store: rebuilt from the wider half ---------------------------------------------------
    learning = tau2.get("learning") or {}
    edited = learning.get("edited")
    in_band = isinstance(edited, int) and PREDICTED_EDITED_LOW <= edited <= PREDICTED_EDITED_HIGH
    report.predict(
        "the store is built from the wider half, at the corpus's own failure rate",
        in_band,
        f"learning.edited {edited!r} for a band of {PREDICTED_EDITED_LOW}–{PREDICTED_EDITED_HIGH} "
        f"over {train} learned task(s)",
    )
    store = tau2.get("store") if isinstance(tau2.get("store"), dict) else {}
    stored = store.get("stored")
    servable = store.get("servable") if isinstance(store.get("servable"), int) else store.get("active")
    report.predict(
        "the write is whole: every correction reached the store",
        isinstance(stored, int) and isinstance(edited, int) and stored == edited,
        f"stored {stored!r}, edited {edited!r}, servable {servable!r}",
    )
    # The registration's third refutation: a wider half that failed the write is not a memory, and every
    # counter downstream would still read as a measurement.
    report.refute(
        "the store is smaller than the corrections that produced it",
        edited == 0 or (isinstance(stored, int) and isinstance(edited, int) and stored < edited),
        f"stored {stored!r} of {edited!r} edited",
    )

    # ---- the question: recorded, and unpinned by design --------------------------------------------
    queries = tau2.get("queries")
    if not isinstance(queries, dict):
        report.predict(
            "the artefact records the questions retrieval was asked",
            None,
            "queries absent: this arm's packs cannot be explained, and the next arm cannot pin them",
        )
    else:
        requests = queries.get("requests")
        replaced = queries.get("replaced")
        report.predict(
            "the question is recorded, once per evaluation episode",
            requests == PREDICTED_SAMPLE,
            f"{requests!r} request(s) for {PREDICTED_SAMPLE} episode(s), mean "
            f"{queries.get('meanChars')!r} chars, digest {queries.get('digest')!r}",
        )
        report.predict(
            "the question is the one the simulator drew, because this arm ranks an absolute number",
            queries.get("pin") is None and replaced == 0,
            f"pin {queries.get('pin')!r}, replaced {replaced!r}",
        )
        # A pin that replaced nothing would be an arm reporting itself pinned while every pack was ranked
        # on the drawn phrasing -- the defect R92's own instrument exists to make impossible.
        report.refute(
            "the arm declared a query pin that reached no request",
            queries.get("pin") is not None and replaced == 0,
            f"pin {queries.get('pin')!r} with {replaced!r} replacement(s)",
        )

    # ---- the pack: R90's shape, not R90's text -----------------------------------------------------
    pack = tau2.get("pack")
    if not isinstance(pack, dict):
        report.predict(
            "the artefact states the pack its recall ran through", None, "pack census absent"
        )
        return "NO_MEASUREMENT", report
    summary = pack.get("summary") if isinstance(pack.get("summary"), dict) else {}
    mean_ids = number(summary.get("meanIds"))
    dropped = pack.get("droppedForSize")
    report.predict(
        "the pack keeps R90's occupancy: 2,400 characters, one record, and drops counted",
        pack.get("budget") == PREDICTED_BUDGET
        and pack.get("capacity") == PREDICTED_CAPACITY
        and mean_ids == 1
        and isinstance(dropped, int)
        and dropped > 0,
        f"budget {pack.get('budget')!r}, capacity {pack.get('capacity')!r}, meanIds {mean_ids!r}, "
        f"droppedForSize {dropped!r}, filled {pack.get('filled')!r}",
    )
    # The text is deliberately *not* graded against R90: the records are new and the questions are a fresh
    # draw. Quoting `meanChars` as a reproduction would be the error R91's readback was rewritten to stop.
    report.note(
        f"meanChars {summary.get('meanChars')!r} and coverage are readings of (question draw, pack); this "
        "arm pins neither and they are not comparable to R90's"
    )

    # ---- the outcome: reported, not predicted ------------------------------------------------------
    tasks_run = metrics.get("tasks")
    pass4 = number(metrics.get("pass4"))
    if pass4 is None:
        report.predict(
            f"pass^4 does not fall below the 40-task baseline {PUBLISHED_PASS4:.3f}", None, "pass4 absent"
        )
    else:
        half = interval_half_width(pass4, int(tasks_run)) if isinstance(tasks_run, int) else None
        band = "" if half is None else f" ±{half * 100:.2f}pp at n={tasks_run}"
        report.predict(
            f"pass^4 does not fall below the 40-task baseline {PUBLISHED_PASS4:.3f}",
            pass4 >= PUBLISHED_PASS4,
            f"{pass4:.4f}{band} against {PUBLISHED_PASS4}, {pass4 - PUBLISHED_PASS4:+.4f} "
            f"({(pass4 - PUBLISHED_PASS4) * 100:+.2f}pp), gates_passed {metrics.get('gates_passed')!r}",
        )
        # The registration's fourth refutation, and the one that would be evidence rather than a
        # measurement problem: a store built from 74 tasks, every record intact, at the sample the
        # competitor used, scoring below the baseline on the split the benchmark defines.
        report.refute(
            "the memory scores below the baseline on the benchmark's own halves",
            pass4 < PUBLISHED_PASS4,
            f"{pass4:.4f} against {PUBLISHED_PASS4} at n={tasks_run}",
        )
        if half is not None:
            report.note(
                f"the evaluation draw's spread at this store: {pass4:.4f} ±{half * 100:.2f}pp at n={tasks_run}"
                + ("" if previous is None else f" (a previous arm is available but not compared here: "
                   "different split)")
            )
    report.predict("the arm was scored on four trials", metrics.get("k") == 4, f"k={metrics.get('k')!r}")

    # ---- the verdict -------------------------------------------------------------------------------
    if isinstance(edited, int) and edited == 0:
        report.refute("the arm wrote a store", True, "0 corrections: the wider half failed the write")
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
    """A GRADED artefact: the benchmark's halves, a store built from all 74, every census present."""
    artefact: dict[str, Any] = {
        "id": "poc-l4",
        "metrics": {"pass4": 0.6, "k": 4, "tasks": PREDICTED_TASKS, "gates_passed": 3},
        "tau2": {
            "scenario": {"learn": "retail", "test": "retail", "recall": "retail"},
            "distillUnit": {"unit": "raw", "traces": 0, "traced": 0, "claims": 16},
            "split": {
                "train": [f"retail/{index}" for index in range(PREDICTED_TRAIN)],
                "test": [f"retail/{100 + index}" for index in range(PREDICTED_TASKS)],
            },
            "learning": {
                "rows": PREDICTED_TRAIN,
                "unanswered": 0,
                "edited": 16,
                "events": 16,
                "candidates": 16,
                "distilled": 16,
                "distillFailed": 0,
                "llmFailed": 0,
            },
            "rawlog": {"records": 16, "clipped": 1, "toolBan": False, "ceiling": 2000},
            "store": {"stored": 16, "active": 16, "servable": 16},
            "benchmark": {"version": REQUIRED_RELEASE, "commit": "b711c1ead46f55111bf765cf44d5da8bacc2d28c"},
            "queries": {
                "requests": PREDICTED_SAMPLE,
                "distinct": PREDICTED_SAMPLE,
                "meanChars": 219.5,
                "p50Chars": 208,
                "digest": "abcd1234abcd1234",
                "askedDigest": "abcd1234abcd1234",
                "replaced": 0,
                "pin": None,
                "texts": [{"index": 0, "text": "cancel my reservation"}],
            },
            "pack": {
                "budget": PREDICTED_BUDGET,
                "capacity": PREDICTED_CAPACITY,
                "requests": PREDICTED_SAMPLE,
                "filled": PREDICTED_SAMPLE,
                "empty": 0,
                "emptiedBySize": 0,
                "droppedForSize": 1120,
                "summary": {"meanIds": 1, "meanChars": 1810.4},
            },
            "storeItems": {
                "items": [
                    {
                        "id": "k_1",
                        "kind": "exemplar",
                        "status": "active",
                        "statement": "confirm which order the customer means",
                        "trust": 0.9,
                        "scope": {"domain": "retail"},
                        "supportTasks": 1,
                        "evidence": 1,
                    }
                ]
            },
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
    parser.add_argument("--previous", help="an earlier arm, read only for the note it prints")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        cases: list[tuple[str, dict[str, Any], str]] = [
            ("the benchmark's halves over a store built from 74 grades", base(), "GRADED"),
            # The axis this round added. A number is comparable only inside the release it was measured
            # on, so an artefact that does not name it is a failure to grade, not a default.
            (
                "an artefact that does not name its release cannot be ranked",
                base(**{"tau2.benchmark": None}),
                "ABANDONED",
            ),
            (
                "the release this lane used to pin is not this arm",
                base(**{"tau2.benchmark": {"version": "v0.2.0", "commit": "0" * 40}}),
                "ABANDONED",
            ),
            (
                "this lane's own cut is not this arm",
                base(**{
                    "tau2.split": {"train": [f"retail/{i}" for i in range(57)], "test": ["retail/1"]},
                    "metrics": {"pass4": 0.6, "k": 4, "tasks": 57, "gates_passed": 3},
                }),
                "ABANDONED",
            ),
            (
                "a scored half of 12 is a corpus mismatch that produced a number",
                base(**{"metrics": {"pass4": 0.6, "k": 4, "tasks": 12, "gates_passed": 3}}),
                "ABANDONED",
            ),
            (
                "a store outside the band the wider half implies",
                base(**{"tau2.learning": {"rows": 74, "unanswered": 0, "edited": 40, "events": 40}}),
                "ABANDONED",
            ),
            (
                "a write that dropped a correction",
                base(**{"tau2.store": {"stored": 12, "active": 12, "servable": 12}}),
                "ABANDONED",
            ),
            (
                "an arm that fits fewer records in the pack is another cell",
                base(**{"tau2.pack.summary": {"meanIds": 2, "meanChars": 900.0}}),
                "ABANDONED",
            ),
            (
                "a pack that dropped nothing is not this lane's pack",
                base(**{"tau2.pack.droppedForSize": 0}),
                "ABANDONED",
            ),
            (
                "a query census over the wrong number of episodes",
                base(**{
                    "tau2.queries": {
                        "requests": 228,
                        "distinct": 228,
                        "replaced": 0,
                        "pin": None,
                        "digest": "abcd1234abcd1234",
                    }
                }),
                "ABANDONED",
            ),
            (
                "a declared query pin that replaced nothing is not a pin",
                base(**{
                    "tau2.queries": {
                        "requests": PREDICTED_SAMPLE,
                        "distinct": PREDICTED_SAMPLE,
                        "replaced": 0,
                        "pin": "eval/pins/r92-retail-queries.json",
                        "digest": "abcd1234abcd1234",
                    }
                }),
                "ABANDONED",
            ),
            (
                "a memory below the published baseline is the finding, not a pass",
                base(**{"metrics": {"pass4": 0.55, "k": 4, "tasks": 40, "gates_passed": 3}}),
                "ABANDONED",
            ),
            (
                "another unit is discarded rather than reinterpreted",
                base(**{"tau2.distillUnit": {"unit": "trace"}}),
                "DISCARDED",
            ),
            (
                "another scenario pair is discarded rather than graded",
                base(**{"tau2.scenario": {"learn": "retail", "test": "airline", "recall": "retail"}}),
                "DISCARDED",
            ),
            (
                "an artefact with no pack census cannot price a pack",
                base(**{"tau2.pack": None}),
                "NO_MEASUREMENT",
            ),
            (
                "an artefact with no split cannot say whose halves it ran",
                base(**{"tau2.split": None}),
                "NO_MEASUREMENT",
            ),
            (
                "an artefact with no query census still grades, and says the rows are n/a",
                base(**{"tau2.queries": None}),
                "GRADED",
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
    previous: dict[str, Any] | None = None
    if args.previous:
        candidate = Path(args.previous)
        found = candidate if candidate.is_file() else next(
            iter(sorted(candidate.glob("arms/*/poc-l4.json")) or sorted(candidate.glob("**/poc-l4.json"))),
            None,
        )
        if found is None:
            print("no previous artefact found under " + str(candidate))
            return 2
        previous = json.loads(Path(found).read_text())

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
