#!/usr/bin/env python3
"""R91 readback: was the store the same store?

The registration is `prereg/R91-store-frozen-to-the-failures-it-read.md`. R90's readback fired a row its
registration did not contain: R89 built its store from 12 failed learn tasks and R90 from 15, on the same
57 tasks at the same one trial with the same model, with 8 ids in common. The learn half is one trial per
task, so which tasks fail is a draw, and every arm in this lane had been changing its store as well as its
treatment.

R91 replaces that draw with a list. `eval/pins/r90-retail.json` names R90's fifteen failures, `tau2-pin.ts`
prices them against the pinned corpus, and the driver skips the episodes the list replaces. So this arm
does not test a hypothesis about memory; it tests whether the instrument is deterministic. Four rows, all
equalities rather than directions:

  the pin       on the path, with R90's fifteen failures over 57 tasks
  the write     fifteen records, 172 entity values, 171 kept, one redacted
  the pack      meanChars 1,825.3, droppedForSize 1,596, meanIds 1, 228 filled
  the read      coverage p50 0.28
  the queries   recorded at all, and whether a pin replaced any of them
  the outcome   pass^4 with its interval and **no direction**

The last row is the arm's product. At a fixed store the evaluation half is still 57 tasks x 4 trials of a
sampled model, so its `pass^4` is the first estimate of that draw's own spread -- the number every later
delta is read against, and the one this lane has been quoting point estimates without.

## What this registration got wrong, found by its own readback

Two of the five rows were mis-specified, and the refutations they fired named the wrong mechanism. A pack is
a function of (store, query, pack options). This arm pinned the first, and the query is the user simulator's
sampled first turn -- `microglia_agent.py` recalls on `message.content`, which τ² generates from
`user_scenario.instructions` -- so the pack was still a draw while the arm's header said two variables had
become one. Three arms put it beyond argument: mean pack characters 1,717.2 (R89), 1,825.3 (R90) and 1,812.1
(R91), over stores holding 12, 15 and 15 corrections.

So `the pack carries the same text` and `the coverage is R90's` are graded as written, because a registration
is the contract, and both fail. What they establish is not that the renderer is nondeterministic and not that
the memory did anything: it is that the instrument was one pin short. R92's `tau2-queries.ts` records every
query, `queries.replaced` proves a pin reached the requests, and an arm that carries that block lets a later
readback pair packs by question instead of by hope.

States, the same four the other verifiers use:

  GRADED          every graded prediction holds and no refutation fired.
  NO_MEASUREMENT  the artefact cannot answer the question: no census, or no counts in it.
  DISCARDED       the artefact is another arm, another unit or another scenario pair.
  ABANDONED       a refutation fired.

Usage:
  python3 eval/tools/fetch_evidence.py --repo microglia --run <run-id> --out /tmp/r91
  python3 r91_readback.py --dir /tmp/r91
  python3 r91_readback.py --self-test
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
)

# Quoted from `prereg/R91-store-frozen-to-the-failures-it-read.md`, written before the measurement existed.
PREDICTED_PIN_FAILURES = 15
PREDICTED_PIN_TASKS = 57
PREDICTED_RECORDS = 15
PREDICTED_ENTITIES = 172
PREDICTED_KEPT = 171
PREDICTED_REDACTED = 1
PREDICTED_STORED = 15
PREDICTED_MEAN_CHARS = 1825.3
PREDICTED_MEAN_CHARS_TOLERANCE = 0.05
PREDICTED_DROPPED = 1596
PREDICTED_MEAN_IDS = 1
PREDICTED_SAMPLE = 228
PREDICTED_COVERAGE_P50 = 0.28
PUBLISHED_PASS4 = 0.575
REQUIRED_SCENARIO = {"learn": "retail", "test": "retail", "recall": "retail"}


def store_statements(artefact: dict[str, Any]) -> list[str] | None:
    """The statements the artefact sampled out of its store, or None when it sampled none.

    The strongest determinism check this arm can make: a pin makes the store a function of the corpus and
    the list, so two runs of it write the same fifteen records character for character. Comparing the
    sample is enough and is cheaper than re-deriving the store from the corpus.
    """
    block = (artefact.get("tau2") or {}).get("storeItems")
    if not isinstance(block, dict):
        return None
    items = block.get("items")
    if not isinstance(items, list) or not items:
        return None
    return [str(item.get("statement", "")) for item in items if isinstance(item, dict)]


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
    if not isinstance(written, int):
        report.predict("the record census carries its count", None, json.dumps(records)[:120])
        return "NO_MEASUREMENT", report

    # ---- the pin: is the learn half replayed rather than drawn? -----------------------------------
    learning = tau2.get("learning") or {}
    pin = learning.get("pin")
    if not isinstance(pin, dict):
        # The registration says nothing below is read when this row fails, and the verdict is
        # `ABANDONED` on that basis. What the readback still does is collect the rest of the evidence:
        # R91's artefact dropped the field in `tau2-instrument`'s projection while its log said
        # `learn half pinned: 15 of 57`, and a readback that stopped here would report a defect of the
        # artefact as a defect of the arm. The store-identity row below is what separates the two.
        report.refute(
            "the pin is on the path the driver takes",
            True,
            "learning.pin absent: the artefact cannot say whether this store was replayed",
        )
    else:
        failures = pin.get("failures")
        tasks = pin.get("tasks")
        report.predict(
            "the pin names R90's failures over this run's learn half",
            failures == PREDICTED_PIN_FAILURES and tasks == PREDICTED_PIN_TASKS,
            f"{failures!r} failure(s) over {tasks!r} task(s), source {pin.get('source')!r}",
        )
        # The registration's first refutation: a pin that reached the driver with another count is a
        # header, a workflow join or a split that disagrees with the list, and the store it built is not
        # the one the registration priced.
        report.refute(
            "the pinned list is not the list this arm registered",
            failures != PREDICTED_PIN_FAILURES,
            f"{failures!r} failure(s) against the registered {PREDICTED_PIN_FAILURES}",
        )
    report.predict(
        "the write replays rather than redraws",
        written == PREDICTED_RECORDS,
        f"{written} record(s) against R90's {PREDICTED_RECORDS}",
    )

    # ---- the write: field-for-field reproduction ---------------------------------------------------
    faithfulness = tau2.get("faithfulness") or {}
    entities = faithfulness.get("entities")
    kept = faithfulness.get("kept")
    redacted = faithfulness.get("redacted")
    report.predict(
        "the corrections' own values reproduce R90's exactly",
        entities == PREDICTED_ENTITIES and kept == PREDICTED_KEPT and redacted == PREDICTED_REDACTED,
        f"entities {entities!r}, kept {kept!r}, redacted {redacted!r} "
        f"(R90: {PREDICTED_ENTITIES} / {PREDICTED_KEPT} / {PREDICTED_REDACTED})",
    )
    # The registration's second refutation, and the most important one: if a correction is not a function
    # of the corpus and the list, this lane cannot freeze a store at all and every ablation behind it is
    # built on sand.
    report.refute(
        "a correction is not a function of the corpus and the list",
        entities is not None and entities != PREDICTED_ENTITIES,
        f"{entities!r} entity value(s) against R90's {PREDICTED_ENTITIES}: the write drew from something",
    )
    # The census block, not its `statuses` sub-block: `stored` and `servable` sit beside the statuses
    # rather than inside them, and reading the nested one reported a whole store as incomplete.
    store = tau2.get("store") if isinstance(tau2.get("store"), dict) else {}
    stored = store.get("stored")
    servable = store.get("servable") if isinstance(store.get("servable"), int) else store.get("active")
    report.predict(
        "the store is whole",
        stored == PREDICTED_STORED,
        f"stored {stored!r}, servable {servable!r}",
    )
    report.refute(
        "the pin is partial: a named failure produced no record",
        isinstance(stored, int) and stored != PREDICTED_STORED,
        f"stored {stored!r} of {PREDICTED_STORED} pinned failure(s)",
    )

    # ---- the store itself: the only reading that survives a broken projection ----------------------
    # Written by this readback rather than quoted from the registration. R91's first artefact carried no
    # `learning.pin` -- the projection dropped the field -- while the run's log said `learn half pinned:
    # 15 of 57`. The artefact is what a readback may read, so the row above stays a refutation; this one
    # asks the question the field was there to answer, from the store's own text.
    if previous is None:
        report.note("the store-identity row cannot be read without the previous arm; pass --previous")
    else:
        mine = store_statements(artefact)
        theirs = store_statements(previous)
        if mine is None or theirs is None:
            report.note("the store-identity row cannot be read: one arm sampled no statements")
        else:
            identical = mine == theirs
            report.predict(
                "the store is byte-identical to the previous arm's, which is what a pin buys",
                identical,
                f"{len(mine)} statement(s), {'identical' if identical else 'different'}",
            )
            if not identical:
                differing = sum(1 for left, right in zip(mine, theirs) if left != right)
                report.refute(
                    "the store a pin rebuilt is not the store it names",
                    True,
                    f"{differing} of {min(len(mine), len(theirs))} shared position(s) differ",
                )

    # ---- the query: the pack's ranking input, and the one no arm recorded -------------------------
    # R92. `buildPack` ranks candidates on BM25 over the query text; the query is the user simulator's
    # first turn, which τ² samples. So a pack is a function of (store, query, options) and this arm pinned
    # one of the three -- which is why the two rows below cannot hold, and why the absence of this block is
    # the finding rather than a gap in the report.
    queries = tau2.get("queries")
    if not isinstance(queries, dict):
        report.predict(
            "the artefact records the questions retrieval was asked", None,
            "queries absent: the pack's ranking input was never recorded, so a pack difference has no cause",
        )
    else:
        replaced = queries.get("replaced")
        report.predict(
            "the artefact records the questions retrieval was asked",
            isinstance(queries.get("requests"), int) and queries.get("digest") is not None,
            f"{queries.get('requests')!r} request(s), mean {queries.get('meanChars')!r} chars, "
            f"digest {queries.get('digest')!r}, replaced {replaced!r}, pin {queries.get('pin')!r}",
        )
        # A pin that replaced nothing is not a pin: the run would have reported itself pinned while every
        # pack was ranked on the phrasing the simulator drew.
        report.refute(
            "the arm declared a query pin that reached no request",
            queries.get("pin") is not None and replaced == 0,
            f"pin {queries.get('pin')!r} with {replaced!r} replacement(s)",
        )

    # ---- the pack and the read: inherited, because their inputs are --------------------------------
    pack = tau2.get("pack")
    if not isinstance(pack, dict):
        report.predict(
            "the artefact states the pack its recall ran through", None, "pack census absent"
        )
        return "NO_MEASUREMENT", report
    summary = pack.get("summary") if isinstance(pack.get("summary"), dict) else {}
    mean_chars = number(summary.get("meanChars"))
    mean_ids = number(summary.get("meanIds"))
    dropped = pack.get("droppedForSize")
    filled = pack.get("filled")
    empty = pack.get("empty")

    report.predict(
        "the pack carries the same text as R90's",
        mean_chars is not None
        and abs(mean_chars - PREDICTED_MEAN_CHARS) <= PREDICTED_MEAN_CHARS_TOLERANCE
        and mean_ids == PREDICTED_MEAN_IDS
        and dropped == PREDICTED_DROPPED
        and filled == PREDICTED_SAMPLE
        and empty == 0,
        f"meanChars {mean_chars!r}, meanIds {mean_ids!r}, droppedForSize {dropped!r}, "
        f"filled {filled!r}, empty {empty!r}",
    )
    # The registration's third refutation, reworded after the fact and deliberately kept as a refutation:
    # two runs holding the same records served different text, and the registration's explanation (a
    # renderer, an admission decision or a clock) was wrong. The cause is one level up: the two runs were
    # asked different questions. R89 answered 1,717.2 mean characters, R90 1,825.3 and R91 1,812.1 -- three
    # draws, over stores of 12, 15 and 15 corrections -- and no arm recorded a query, so no artefact could
    # say so. R92 adds the census; until an arm carries one, this row prices the instrument, not the memory.
    report.refute(
        "the same records were served as different text",
        mean_chars is not None and abs(mean_chars - PREDICTED_MEAN_CHARS) > PREDICTED_MEAN_CHARS_TOLERANCE,
        f"meanChars {mean_chars!r} against R90's {PREDICTED_MEAN_CHARS}: the store was replayed and the "
        "questions were not, and `buildPack` ranks on the questions",
    )

    coverage = median_nonzero(tau2)
    # Coverage is measured between the query and the pack, so it inherits both draws rather than one: the
    # registration's "because the store and the pack are [the same]" was a premise the arm had no
    # instrument for, and the row is graded as written so the record shows the premise was wrong.
    report.predict(
        "the coverage is R90's, because the store and the pack are",
        None if coverage is None else abs(coverage - PREDICTED_COVERAGE_P50) < 1e-9,
        "coverage absent" if coverage is None else f"{coverage:.4f} against R90's {PREDICTED_COVERAGE_P50:.4f}",
    )
    report.refute(
        "the same store measured different coverage",
        coverage is not None and abs(coverage - PREDICTED_COVERAGE_P50) >= 1e-9,
        f"{coverage if coverage is None else round(coverage, 4)} against {PREDICTED_COVERAGE_P50}: coverage "
        "is a reading of (query, pack), and only the pack was held",
    )
    report.note(
        "two rows of this registration were mis-specified: a pack is a function of (store, query, options), "
        "the arm pinned the first, and the second is sampled by the user simulator on every trial"
    )

    # ---- the outcome: reported, not predicted -----------------------------------------------------
    tasks_run = metrics.get("tasks")
    pass4 = number(metrics.get("pass4"))
    if pass4 is None:
        report.predict(
            f"pass^4 does not fall below the published {PUBLISHED_PASS4:.3f}", None, "pass4 absent"
        )
    else:
        half = interval_half_width(pass4, int(tasks_run)) if isinstance(tasks_run, int) else None
        band = "" if half is None else f" ±{half * 100:.2f}pp at n={tasks_run}"
        report.predict(
            f"pass^4 does not fall below the published {PUBLISHED_PASS4:.3f}",
            pass4 >= PUBLISHED_PASS4,
            f"{pass4:.4f}{band} against {PUBLISHED_PASS4}, {pass4 - PUBLISHED_PASS4:+.4f} "
            f"({(pass4 - PUBLISHED_PASS4) * 100:+.2f}pp), gates_passed {metrics.get('gates_passed')!r}",
        )
        # The arm's product, in the log rather than in a prediction: at a fixed store this interval is the
        # evaluation draw's own spread, and it is the bar every later delta is read against.
        if half is not None:
            report.note(
                f"the evaluation draw's spread at this store: {pass4:.4f} ±{half * 100:.2f}pp at n={tasks_run}"
                + f" (against R90's 0.6316, a difference of {pass4 - 0.6316:+.4f})"
            )
    report.predict("the arm was scored on four trials", metrics.get("k") == 4, f"k={metrics.get('k')!r}")

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
    """A GRADED artefact: R90's store, replayed, with every field reproduced."""
    artefact: dict[str, Any] = {
        "id": "poc-l4",
        "metrics": {"pass4": 0.6316, "k": 4, "tasks": 57, "published_pass4": PUBLISHED_PASS4, "gates_passed": 3},
        "tau2": {
            "scenario": {"learn": "retail", "test": "retail", "recall": "retail"},
            "distillUnit": {"unit": "raw", "traces": 0, "traced": 0, "claims": 15},
            "learning": {
                "rows": 57,
                "edited": 15,
                "events": 15,
                "candidates": 15,
                "distilled": 15,
                "llmFailed": 0,
                "pin": {
                    "source": "R90 (run 43273198959)",
                    "failures": PREDICTED_PIN_FAILURES,
                    "tasks": PREDICTED_PIN_TASKS,
                    "corpus": "/work/.tau2-bench/data/tau2/domains/retail/tasks.json",
                },
            },
            "rawlog": {"records": PREDICTED_RECORDS, "clipped": 2, "toolBan": False, "ceiling": 2000},
            "store": {
                "stored": PREDICTED_STORED,
                "active": PREDICTED_STORED,
                "servable": PREDICTED_STORED,
                "statuses": {"active": PREDICTED_STORED, "candidate": 0},
            },
            "faithfulness": {
                "corrections": 15,
                "entities": PREDICTED_ENTITIES,
                "kept": PREDICTED_KEPT,
                "whole": 14,
                "unwritten": 0,
                "redacted": PREDICTED_REDACTED,
            },
            "pack": {
                "budget": 2400,
                "capacity": 2010,
                "requests": PREDICTED_SAMPLE,
                "filled": PREDICTED_SAMPLE,
                "empty": 0,
                "emptiedBySize": 0,
                "droppedForSize": PREDICTED_DROPPED,
                "summary": {"meanIds": PREDICTED_MEAN_IDS, "meanChars": PREDICTED_MEAN_CHARS + 0.007},
            },
            "coverage": {"nonzeroQuantiles": {"p50": PREDICTED_COVERAGE_P50}, "measuredPairs": PREDICTED_SAMPLE},
            # R92's census, in the fixture because the guard is only as good as the shape it grades: an
            # artefact from this arm could not carry it, and one that does must be read rather than assumed.
            "queries": {
                "requests": PREDICTED_SAMPLE,
                "distinct": PREDICTED_SAMPLE,
                "meanChars": 214.5,
                "p50Chars": 203,
                "digest": "abcd1234abcd1234",
                "askedDigest": "abcd1234abcd1234",
                "replaced": 0,
                "pin": None,
                "texts": [{"index": 0, "text": "cancel my reservation"}],
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
    parser.add_argument("--previous", help="the artefact this one should reproduce, for the store row")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        cases: list[tuple[str, dict[str, Any], str]] = [
            ("a replayed store that reproduces R90 grades", base(), "GRADED"),
            (
                "a run that drew its own store is not this arm",
                base(**{"tau2.learning": {"rows": 57, "edited": 15, "events": 15}}),
                "ABANDONED",
            ),
            (
                "a pin with another count is not the list this arm registered",
                base(**{
                    "tau2.learning": {
                        "rows": 57,
                        "edited": 14,
                        "events": 14,
                        "pin": {"source": "R90", "failures": 14, "tasks": 57},
                    }
                }),
                "ABANDONED",
            ),
            (
                "the write drew from something: the population is not a function of the list",
                base(**{"tau2.faithfulness": {"corrections": 15, "entities": 128, "kept": 127, "redacted": 1}}),
                "ABANDONED",
            ),
            (
                "the store is smaller than the pin it claims",
                base(**{"tau2.store": {"stored": 14, "active": 14, "servable": 14}}),
                "ABANDONED",
            ),
            (
                "the same records were served as different text",
                base(**{"tau2.pack.summary": {"meanIds": 1, "meanChars": 1717.2}}),
                "ABANDONED",
            ),
            (
                "a pack carrying two records is another cell, not this one",
                base(**{"tau2.pack.summary": {"meanIds": 2, "meanChars": 1825.3}}),
                "ABANDONED",
            ),
            (
                "the same pack measured different coverage",
                base(**{"tau2.coverage": {"nonzeroQuantiles": {"p50": 0.31}, "measuredPairs": 228}}),
                "ABANDONED",
            ),
            (
                "another unit is discarded rather than reinterpreted",
                base(**{"tau2.distillUnit": {"unit": "trace"}}),
                "DISCARDED",
            ),
            (
                "an artefact written before the pack census cannot price a pack",
                base(**{"tau2.pack": None}),
                "NO_MEASUREMENT",
            ),
            (
                "a declared query pin that replaced nothing is not a pin",
                base(**{
                    "tau2.queries": {
                        "requests": PREDICTED_SAMPLE,
                        "distinct": PREDICTED_SAMPLE,
                        "digest": "abcd1234abcd1234",
                        "replaced": 0,
                        "pin": "eval/pins/r92-retail-queries.json",
                    }
                }),
                "ABANDONED",
            ),
            (
                "an arm that wrote nothing is named by its layer",
                base(**{"tau2.rawlog": {"records": 0, "clipped": 0, "toolBan": False}}),
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
