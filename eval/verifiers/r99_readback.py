#!/usr/bin/env python3
"""R99 readback: did five times the store buy anything?

The registration is `prereg/R99-the-supply-arm.md`, and it exists because every round since R85 read this
lane's nulls as a supply problem: fifteen records are too few, the pack is too narrow, the record mentions
a fifth of the question. R99 changes exactly one thing — `distillScope: edited` to `all`, which turns the
fifteen corrections a pinned learn half produces into the roughly seventy-three that every task produces —
and it wrote its decision rule into the file before the dispatch:

    pass^4 >= 0.775   supply was the constraint; the line continues
    0.700 - 0.775     a replication of R93 at five times the store
    < 0.700           the supply line closes

So this verifier's job is narrower than the other rounds': it asks whether the artefact is R99's arm at
all, whether the treatment was delivered as registered, and which of the three branches the number falls
in. The branch is graded rather than described, which is the point of pre-registering it.

  the arm        scope `all` (not `edited`, which is every arm before this one), unit `raw`
  the supply     `learning.distilled` in [60, 80] and strictly more than R93's fifteen
  the write      whole: `store.stored` == `learning.distilled`, all of them servable
  the delivery   161 requests, all served, 1.1 to 1.5 items per pack
  the census     `served.distinct` present, positive, and no larger than the store
  the sample     the benchmark's own halves, 40 scored, nothing unscored, v1.0.1
  the branch     one of the three above

States, the same four the other verifiers use:

  GRADED          the arm is R99's and the branch is the confirming one or the replication.
  NO_MEASUREMENT  the artefact cannot answer: no store, no delivery census, no scored half.
  DISCARDED       another arm: another unit, another scope, another scenario pair.
  ABANDONED       a refutation fired: the store did not widen, the write did not hold, or **the number
                  closed the supply line**. The last one is the registered outcome this round actually
                  produced, and calling it ABANDONED is the house convention — a refutation that fired is
                  the finding, not a broken instrument.

Usage:
  python3 eval/tools/fetch_evidence.py --repo microglia --run <run-id> --out /tmp/r99
  python3 r99_readback.py --dir /tmp/r99
  python3 r99_readback.py --self-test
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from _funnel import funnel_notes
from r88_readback import Report, interval_half_width, number

# Quoted from `prereg/R99-the-supply-arm.md`, written before the measurement existed.
PREDICTED_DISTILLED_LOW = 60
PREDICTED_DISTILLED_HIGH = 80
R93_DISTILLED = 15
PREDICTED_SAMPLE = 160
PREDICTED_TASKS = 40
PREDICTED_TRAIN = 74
PREDICTED_PACK_REQUESTS = 161
PREDICTED_MEAN_IDS_LOW = 1.1
PREDICTED_MEAN_IDS_HIGH = 1.5
SUPPLY_CONFIRMED = 0.775
SUPPLY_CLOSES = 0.700
REQUIRED_RELEASE = "v1.0.1"
REQUIRED_SCENARIO = {"learn": "retail", "test": "retail", "recall": "retail"}
REQUIRED_SCOPE = "all"


def split_lengths(tau2: dict[str, Any]) -> tuple[int | None, int | None]:
    """The two halves as the artefact records them, or `None` where it records neither."""
    block = tau2.get("split")
    if not isinstance(block, dict):
        return None, None
    train = block.get("train")
    test = block.get("test")
    return (
        len(train) if isinstance(train, list) else None,
        len(test) if isinstance(test, list) else None,
    )


def branch(pass4: float) -> tuple[str, str]:
    """The registered decision rule, as code rather than as a sentence somebody re-reads."""
    if pass4 >= SUPPLY_CONFIRMED:
        return "confirmed", (
            f"{pass4:.3f} >= {SUPPLY_CONFIRMED}: supply was the constraint and the line continues"
        )
    if pass4 >= SUPPLY_CLOSES:
        return "replicated", (
            f"{pass4:.3f} in [{SUPPLY_CLOSES}, {SUPPLY_CONFIRMED}): five times the store, the same score"
        )
    return "closed", (
        f"{pass4:.3f} < {SUPPLY_CLOSES}: the supply line closes — the store was not the constraint"
    )


def grade(artefact: dict[str, Any]) -> tuple[str, Report]:
    report = Report()
    tau2 = artefact.get("tau2") or {}
    metrics = artefact.get("metrics") or {}

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

    # ---- the treatment: the one variable this arm changes -----------------------------------------
    #
    # `edited` is every arm before this one and `all` is this one. Grading the scope rather than assuming
    # it is what stops a dispatch that silently kept the old value from being read as a supply result: the
    # store would be fifteen records and the score would be R93's, reported under R99's name.
    scope = tau2.get("distillScope")
    if scope is None:
        report.predict(
            "the artefact records which claims the store admitted",
            None,
            "distillScope absent: the treatment cannot be read from this artefact",
        )
        return "NO_MEASUREMENT", report
    if scope != REQUIRED_SCOPE:
        report.refute(
            "the dispatch ran the widened scope rather than the old one",
            True,
            f"scope {scope!r} against the registered {REQUIRED_SCOPE!r}",
        )
        return "DISCARDED", report

    # ---- the halves ------------------------------------------------------------------------------
    train, test = split_lengths(tau2)
    if train is None or test is None:
        report.predict(
            "the artefact records the two halves it ran",
            None,
            "split block absent: the sample this arm is comparable to R93 on was not recorded",
        )
        return "NO_MEASUREMENT", report
    report.predict(
        "the halves are the benchmark's: 74 learned, 40 held out",
        train == PREDICTED_TRAIN and test == PREDICTED_TASKS,
        f"train {train}, test {test} (registered {PREDICTED_TRAIN} / {PREDICTED_TASKS})",
    )
    report.refute(
        "the pair is no longer comparable to R93",
        train != PREDICTED_TRAIN or test != PREDICTED_TASKS,
        f"{train} / {test} against the registered {PREDICTED_TRAIN} / {PREDICTED_TASKS}",
    )
    scored = metrics.get("tasks")
    report.predict("the scored half is the held-out half", scored == PREDICTED_TASKS, f"metrics.tasks {scored!r}")

    benchmark = tau2.get("benchmark")
    version = benchmark.get("version") if isinstance(benchmark, dict) else None
    report.predict(
        f"the artefact names the release it ran ({REQUIRED_RELEASE})",
        version == REQUIRED_RELEASE,
        f"{version!r}",
    )

    # ---- the supply: did the store actually widen? -----------------------------------------------
    learning = tau2.get("learning") or {}
    distilled = learning.get("distilled")
    store = tau2.get("store") if isinstance(tau2.get("store"), dict) else {}
    stored = store.get("stored")
    servable = store.get("servable")
    if not isinstance(distilled, int):
        report.predict(
            "the artefact counts the records the store holds", None, "learning.distilled absent"
        )
        return "NO_MEASUREMENT", report
    in_band = PREDICTED_DISTILLED_LOW <= distilled <= PREDICTED_DISTILLED_HIGH
    report.predict(
        f"the store widened into the registered band of {PREDICTED_DISTILLED_LOW}–{PREDICTED_DISTILLED_HIGH}",
        in_band,
        f"learning.distilled {distilled} (R93: {R93_DISTILLED})",
    )
    # The registration's first refutation: a scope that did not widen the store tested nothing, and every
    # counter downstream would still read as a supply arm.
    report.refute(
        "the scope changed and the store did not",
        distilled <= R93_DISTILLED,
        f"{distilled} record(s) against R93's {R93_DISTILLED}",
    )
    report.predict(
        "the write is whole: every correction reached the store",
        isinstance(stored, int) and stored == distilled,
        f"stored {stored!r}, distilled {distilled!r}",
    )
    report.refute(
        "the store is smaller than the corrections that produced it",
        isinstance(stored, int) and stored < distilled,
        f"stored {stored!r} of {distilled!r}",
    )
    report.predict(
        "every stored record is servable in the scenario it learned in",
        isinstance(servable, int) and isinstance(stored, int) and servable == stored,
        f"servable {servable!r} of {stored!r}",
    )

    # ---- the delivery ----------------------------------------------------------------------------
    pack = tau2.get("pack") if isinstance(tau2.get("pack"), dict) else {}
    summary = pack.get("summary") if isinstance(pack.get("summary"), dict) else {}
    requests = pack.get("requests")
    filled = pack.get("filled")
    mean_ids = number(summary.get("meanIds"))
    if requests is None or mean_ids is None:
        report.predict(
            "the artefact prices the pack it served", None, "pack.requests or pack.summary.meanIds absent"
        )
        return "NO_MEASUREMENT", report
    report.predict(
        f"the lane asked {PREDICTED_PACK_REQUESTS} times, as R93 did on the same sample",
        requests == PREDICTED_PACK_REQUESTS,
        f"requests {requests!r}",
    )
    report.predict(
        f"the pack averaged {PREDICTED_MEAN_IDS_LOW}–{PREDICTED_MEAN_IDS_HIGH} items, more than R93's 1.08",
        PREDICTED_MEAN_IDS_LOW <= mean_ids <= PREDICTED_MEAN_IDS_HIGH,
        f"meanIds {mean_ids:.3f}",
    )
    report.predict(
        "no request went unserved, so a zero cannot be blamed on the pack having nothing",
        filled == requests,
        f"filled {filled!r} of {requests!r}",
    )

    # ---- the census R93 did not have ---------------------------------------------------------------
    #
    # The store's size is the header's claim; this is what the run did with it. R93 ran before the field
    # existed, so its fifteen-record store has a mean and no distribution, and the first question a
    # supply arm has to answer — how much of the store was ever used — could not be asked until now.
    served = tau2.get("served") if isinstance(tau2.get("served"), dict) else {}
    distinct = served.get("distinct")
    identified = served.get("identified")
    if distinct is None:
        report.predict(
            "the artefact reports which records were served, not only how many",
            None,
            "served.distinct absent: this artefact predates the census",
        )
        return "NO_MEASUREMENT", report
    report.predict(
        "the census covers every request the pack served",
        identified == requests,
        f"identified {identified!r} of {requests!r}",
    )
    report.predict(
        "some of the store was never served, which is what makes the header's ratio an upper bound",
        isinstance(distinct, int) and 0 < distinct <= stored,
        f"{distinct} distinct of {stored!r} stored",
    )

    # ---- the branch, which the registration fixed before the run ------------------------------------
    pass4 = number(metrics.get("pass4"))
    if pass4 is None:
        report.predict("the artefact carries a pass^4", None, "metrics.pass4 absent")
        return "NO_MEASUREMENT", report
    verdict, sentence = branch(pass4)
    half = interval_half_width(pass4, scored if isinstance(scored, int) else 0)
    report.note(
        f"pass^4 {pass4:.3f}"
        + ("" if half is None else f" ± {half * 100:.2f}pp")
        + f" over {scored!r} scored task(s)"
    )
    # The branch is recorded rather than predicted. A verifier that expected one of the three outcomes
    # would be a verifier that cannot confirm the hypothesis it was written to test — the registration
    # fixed the rule, not the answer, and grading the answer here would make the file an opinion.
    report.note(f"registered branch: {verdict} — {sentence}")
    # The registered closing condition, graded as a refutation rather than as a bad mood: the arm asked
    # whether the store's population is the constraint, and a number below the threshold answers no.
    report.refute("supply was the constraint", verdict == "closed", sentence)
    if verdict == "closed":
        return "ABANDONED", report
    return "GRADED", report


def base(**overrides: Any) -> dict[str, Any]:
    """A sound R99 artefact, with dotted overrides for the self-test."""
    artefact: dict[str, Any] = {
        "metrics": {"pass4": 0.625, "k": 4, "tasks": PREDICTED_TASKS, "gates_passed": 3},
        "tau2": {
            "scenario": dict(REQUIRED_SCENARIO),
            "distillUnit": {"unit": "raw", "traces": 0, "traced": 0, "claims": 73},
            "distillScope": REQUIRED_SCOPE,
            "benchmark": {"version": REQUIRED_RELEASE, "commit": "fc0055dc", "judge": "deepseek/deepseek-flash"},
            "split": {"train": [f"retail/{i}" for i in range(PREDICTED_TRAIN)],
                      "test": [f"retail/{i}" for i in range(PREDICTED_TASKS)]},
            "learning": {"rows": PREDICTED_TRAIN, "unanswered": 0, "edited": 15, "distilled": 73},
            "store": {"stored": 73, "active": 73, "servable": 73},
            "pack": {"requests": PREDICTED_PACK_REQUESTS, "filled": PREDICTED_PACK_REQUESTS,
                     "summary": {"meanIds": 1.292, "meanChars": 1986.1}},
            "served": {"requests": PREDICTED_PACK_REQUESTS, "identified": PREDICTED_PACK_REQUESTS,
                       "distinct": 40, "meanPerRequest": 1.292, "maxPerRequest": 2, "byItem": []},
        },
    }
    for path, value in overrides.items():
        node = artefact
        parts = path.split(".")
        for part in parts[:-1]:
            node = node[part]
        node[parts[-1]] = value
    return artefact


def self_test() -> int:
    # (name, artefact, expected state, expected predictions-ok). The fourth element is what keeps a case
    # from passing for the wrong reason: a delivery prediction can fail on a valid arm, and a self-test
    # that only asserted the state would call that a pass.
    cases: list[tuple[str, dict[str, Any], str, bool | None]] = [
        ("a widened store that lost three tasks closes the supply line", base(), "ABANDONED", True),
        (
            "a widened store that cleared the bar would have confirmed supply",
            base(**{"metrics": {"pass4": 0.8, "k": 4, "tasks": PREDICTED_TASKS, "gates_passed": 3}}),
            "GRADED",
            True,
        ),
        (
            "a widened store that merely reproduced R93 is graded, not claimed",
            base(**{"metrics": {"pass4": 0.725, "k": 4, "tasks": PREDICTED_TASKS, "gates_passed": 3}}),
            "GRADED",
            True,
        ),
        (
            "a run at the old scope is another arm and is discarded",
            base(**{"tau2.distillScope": "edited"}),
            "DISCARDED",
            None,
        ),
        (
            "a scope that did not widen the store tested nothing",
            base(**{"tau2.learning.distilled": 15, "tau2.store": {"stored": 15, "active": 15, "servable": 15}}),
            "ABANDONED",
            False,
        ),
        (
            "a store smaller than the corrections that produced it",
            base(**{"tau2.store": {"stored": 61, "active": 61, "servable": 61}}),
            "ABANDONED",
            False,
        ),
        (
            "another unit is discarded rather than reinterpreted",
            base(**{"tau2.distillUnit": {"unit": "trace"}}),
            "DISCARDED",
            None,
        ),
        (
            "another scenario pair is discarded rather than graded",
            base(**{"tau2.scenario": {"learn": "retail", "test": "airline", "recall": "retail"}}),
            "DISCARDED",
            None,
        ),
        (
            "a pair on this lane's own cut is not comparable to R93",
            base(**{"tau2.split": {"train": [f"retail/{i}" for i in range(57)],
                                   "test": [f"retail/{i}" for i in range(57)]}}),
            "ABANDONED",
            False,
        ),
        (
            "an artefact with no scope cannot say which arm it ran",
            base(**{"tau2.distillScope": None}),
            "NO_MEASUREMENT",
            None,
        ),
        (
            "an artefact with no lesson from the distiller cannot size the store",
            base(**{"tau2.learning": {"rows": PREDICTED_TRAIN, "unanswered": 0, "edited": 15}}),
            "NO_MEASUREMENT",
            None,
        ),
        (
            "an artefact with no pack census cannot price a pack",
            base(**{"tau2.pack": None}),
            "NO_MEASUREMENT",
            None,
        ),
        (
            "an artefact from before the served census says so rather than guessing",
            base(**{"tau2.served": None}),
            "NO_MEASUREMENT",
            None,
        ),
        (
            "an artefact with no split cannot say whose halves it ran",
            base(**{"tau2.split": None}),
            "NO_MEASUREMENT",
            None,
        ),
        (
            "a pack that averaged R93's 1.08 items failed to widen the delivery, and the score still closes",
            base(**{"tau2.pack": {"requests": PREDICTED_PACK_REQUESTS, "filled": PREDICTED_PACK_REQUESTS,
                                  "summary": {"meanIds": 1.08, "meanChars": 1200.0}}}),
            "ABANDONED",
            False,
        ),
        (
            "a request nobody answered fails the filled prediction rather than reading as a pack of zero",
            base(**{"tau2.pack": {"requests": PREDICTED_PACK_REQUESTS, "filled": 158,
                                  "summary": {"meanIds": 1.292, "meanChars": 1986.1}}}),
            "ABANDONED",
            False,
        ),
    ]
    failures = 0
    for name, artefact, want, want_predictions in cases:
        got, report = grade(artefact)
        predictions_ok = report.predictions_ok
        state_ok = got == want
        predicates_ok = want_predictions is None or predictions_ok == want_predictions
        mark = "ok  " if state_ok and predicates_ok else "FAIL"
        if not (state_ok and predicates_ok):
            failures += 1
        print(f"{mark} {got:<15} {name}")
        if not (state_ok and predicates_ok):
            print(report.render())
    print(f"\n{len(cases) - failures} of {len(cases)} self-test cases")
    return 0 if failures == 0 else 1


def main() -> int:
    parser = argparse.ArgumentParser(description="R99 readback")
    parser.add_argument("--dir", help="a fetched evidence directory (arms/<arm>/poc-l4.json)")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        return self_test()

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
