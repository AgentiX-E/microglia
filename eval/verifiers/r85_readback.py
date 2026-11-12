#!/usr/bin/env python3
"""R85 readback: is a store made of episodes better than a store made of claims about them?

The registration is `prereg/R85-rawlog-unit.md`. Its treatment changes exactly one variable against
the arm R58 ran -- what the store is made of -- and the reading has two halves that fail for different
reasons: the *write* (a record per correction, no model call, every entity preserved) and the *read*
(a pack whose text shares the question's words, which is what a lexical retriever can match).

The readback grades the write before the read, because a coverage number from a store the ceiling cut
is not the arm's. `faithfulness` is the instrument that separates the two, and it is the half of the
memory tax this lane had no measurement for: `Memory Tax` names it `faithfulness` (the detail was
destroyed when the memory was written) against `accessibility` (the detail survived and the retriever
never served it), and only the second was instrumented here.

`rawlog.clipped` is printed and not graded. The registration states the write-side claim on
faithfulness -- "a number below 0.95 refutes the arm's own claim to be a record rather than a summary
of one" -- and names the ceiling as the *cause* of any loss, counted per record. Grading the share
directly would add a threshold the registration never stated, so the census prints the count and the
refutation's evidence says whether the ceiling was the only thing that cut text.

States, the same four the other verifiers use:

  GRADED          every graded prediction holds and no refutation fired.
  NO_MEASUREMENT  the artefact cannot answer the question: no unit, no record census, no counts.
  DISCARDED       the artefact is another arm or another scenario pair.
  ABANDONED       a refutation fired: no records, entities lost, coverage under the bar, or a drop.

Usage:
  python3 eval/tools/fetch_evidence.py --repo microglia --run <run-id> --out /tmp/r85
  python3 r85_readback.py --dir /tmp/r85
  python3 r85_readback.py --self-test
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any

from _funnel import STOPPED_PREFIX, funnel_notes
from _retention import retention_note

STATES = ("GRADED", "NO_MEASUREMENT", "DISCARDED", "ABANDONED")

# Quoted from `prereg/R85-rawlog-unit.md`, written before the measurement existed.
PREDICTED_FAITHFULNESS_MIN = 0.95
PREDICTED_COVERAGE_P50_MIN = 0.12
PUBLISHED_PASS4 = 0.575
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


def interval_half_width(pass4: float, tasks: int) -> float | None:
    """The half-width a four-trial pass rate earns at this many tasks, as a normal approximation.

    A per-task `pass^4` is a Bernoulli, so the standard error is `sqrt(p(1-p)/n)` and the 95% band is
    1.96 of it. It is an approximation and it is named as one: the registration promised an interval
    rather than a claim at n=57, and a number quoted without one is the defect every earlier round
    has had to correct after the fact.
    """
    if tasks <= 0:
        return None
    return 1.96 * math.sqrt(max(pass4 * (1.0 - pass4), 0.0) / tasks)


def record_block(tau2: dict[str, Any]) -> dict[str, Any] | None:
    block = tau2.get("rawlog")
    return block if isinstance(block, dict) else None


def sampled_items(tau2: dict[str, Any]) -> list[dict[str, Any]]:
    block = tau2.get("storeItems")
    if not isinstance(block, dict):
        return []
    items = block.get("items")
    return items if isinstance(items, list) else []


def median_nonzero(tau2: dict[str, Any]) -> float | None:
    coverage = tau2.get("coverage")
    if not isinstance(coverage, dict):
        return None
    medians = coverage.get("medians")
    if isinstance(medians, dict):
        value = medians.get("medianNonzero")
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return float(value)
    quantiles = coverage.get("nonzeroQuantiles")
    if isinstance(quantiles, dict):
        value = quantiles.get("p50")
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return float(value)
    return None


def grade(artefact: dict[str, Any], pair: dict[str, Any] | None = None) -> tuple[str, Report]:
    report = Report()
    tau2 = artefact.get("tau2") or {}
    metrics = artefact.get("metrics") or {}

    # The chain that was supposed to carry the treatment, before the treatment. A raw arm's funnel
    # cannot stop at the model -- it asks none -- so a stop here is a stop at the capture, the
    # admission or the parser, and the sentence names which.
    funnel_notes(report, artefact)

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
        report.predict("the artefact records the unit it distilled", None, "distillUnit absent")
        return "NO_MEASUREMENT", report
    if unit.get("unit") != "raw":
        report.refute(
            "the dispatch ran the treatment rather than another unit",
            True,
            f"unit {unit.get('unit')!r}",
        )
        return "DISCARDED", report
    if isinstance(unit.get("consolidation"), dict):
        # Not a refutation: the arm is defined by records, and a merging pass over records is a second
        # variable the registration did not name. Reported, because a store that consolidated is not
        # the store the coverage prediction is about.
        report.note("the claim-merging pass ran on a record store: this arm is not the registered one")
        return "DISCARDED", report

    records = record_block(tau2)
    if records is None:
        report.predict("the artefact records what the store holds", None, "rawlog absent")
        return "NO_MEASUREMENT", report
    written = records.get("records")
    clipped = records.get("clipped")
    if not isinstance(written, int) or not isinstance(clipped, int):
        report.predict("the record census carries its counts", None, json.dumps(records)[:120])
        return "NO_MEASUREMENT", report

    # ---- the write -------------------------------------------------------------------------------
    # Diagnostic, not a bar. The registration puts the write-side claim on faithfulness ("a number
    # below 0.95 refutes the arm's own claim to be a record"), and the ceiling appears there as the
    # *cause* of any loss, counted by `rawlog.clipped`. So the share is printed beside the prediction
    # rather than graded on its own: a threshold here would be a gate the registration never stated,
    # and this lane has already paid once for asserting an arm's premise without measuring it.
    clipped_share = share(clipped, written)
    if clipped_share is not None:
        report.note(
            f"records clipped by the ceiling: {clipped} of {written} ({clipped_share:.1%})"
            + (" — the ceiling is where any lost detail went" if clipped else "")
        )

    form = tau2.get("distillForm") or {}
    items = sampled_items(tau2)
    bad_items = [
        entry
        for entry in items
        if entry.get("kind") != "exemplar" or not str(entry.get("statement", "")).startswith("Q: ")
    ]
    report.predict(
        "the store is made of records, and the artefact says so",
        written >= 1 and form.get("form") == "record" and records.get("toolBan") is False and not bad_items,
        f"{written} record(s), form {form.get('form')!r}, ban {records.get('toolBan')!r}, "
        f"{len(bad_items)} sampled item(s) that are not records",
    )

    learning = tau2.get("learning") or {}
    asked = learning.get("events")
    candidates = learning.get("candidates")
    dropped = learning.get("dropped") or {}
    failed = learning.get("llmFailed", 0)
    answered_every = (
        isinstance(asked, int)
        and isinstance(candidates, int)
        and asked > 0
        and candidates == asked
        and not dropped
        and (failed in (0, None))
    )
    report.predict(
        "the write asked the model nothing, so nothing could fault",
        answered_every,
        f"events {asked!r}, candidates {candidates!r}, dropped {dropped!r}, llmFailed {failed!r}",
    )

    faithfulness = tau2.get("faithfulness")
    if not isinstance(faithfulness, dict) or not isinstance(faithfulness.get("entities"), int):
        report.predict(
            f"at least {PREDICTED_FAITHFULNESS_MIN:.0%} of the corrections' own entities survive the write",
            None,
            "faithfulness absent: the run predates the instrument or the corpus carried no entity",
        )
        kept_share = None
    else:
        kept_share = share(faithfulness.get("kept", 0), faithfulness["entities"])
        if kept_share is None:
            report.predict(
                f"at least {PREDICTED_FAITHFULNESS_MIN:.0%} of the corrections' own entities survive the write",
                None,
                "no correction carried an entity",
            )
        else:
            report.predict(
                f"at least {PREDICTED_FAITHFULNESS_MIN:.0%} of the corrections' own entities survive the write",
                kept_share >= PREDICTED_FAITHFULNESS_MIN,
                f"{faithfulness.get('kept')} of {faithfulness['entities']} kept ({kept_share:.2%}), "
                f"whole in {faithfulness.get('whole')} of {faithfulness.get('corrections')} correction(s)",
            )
            report.refute(
                "the ceiling clipped the records rather than the write abstracting them",
                kept_share < PREDICTED_FAITHFULNESS_MIN,
                f"{kept_share:.2%} kept, and "
                + (
                    "the ceiling is the only thing that cut text"
                    if clipped
                    else "nothing was clipped, so the loss is not the ceiling"
                ),
            )

    # ---- the read --------------------------------------------------------------------------------
    coverage = median_nonzero(tau2)
    if coverage is None:
        report.predict("the pack's median non-zero coverage clears the floor", None, "coverage absent")
    else:
        report.predict(
            f"the pack's median non-zero coverage clears {PREDICTED_COVERAGE_P50_MIN:.0%}",
            coverage >= PREDICTED_COVERAGE_P50_MIN,
            f"{coverage:.2%} against R58's 10.53% on the same corpus",
        )
        # The refutation the line of work turns on: records that do not share the question's words
        # either mean lexical overlap was never the constraint, and the preprints' finding is about
        # their corpora rather than about this lane.
        report.refute(
            "lexical overlap was never the constraint",
            written >= 1 and coverage < PREDICTED_COVERAGE_P50_MIN,
            f"{coverage:.2%} with {written} record(s) in the store",
        )

    tasks = metrics.get("tasks")
    pass4 = metrics.get("pass4")
    if isinstance(pass4, (int, float)) and not isinstance(pass4, bool):
        half = interval_half_width(float(pass4), int(tasks)) if isinstance(tasks, int) else None
        band = "" if half is None else f" ±{half * 100:.2f}pp at n={tasks}"
        report.predict(
            f"pass^4 does not fall below the published {PUBLISHED_PASS4:.3f}",
            float(pass4) >= PUBLISHED_PASS4,
            f"{float(pass4):.4f}{band} against {PUBLISHED_PASS4}",
        )
        report.refute(
            "records cost more than the interval can absorb",
            half is not None and float(pass4) + half < PUBLISHED_PASS4,
            f"{float(pass4):.4f} + {half * 100 if half is not None else 0:.2f}pp still below "
            f"{PUBLISHED_PASS4}" if half is not None else f"{float(pass4):.4f}",
        )
    else:
        report.predict(f"pass^4 does not fall below the published {PUBLISHED_PASS4:.3f}", None, "pass4 absent")

    k = metrics.get("k")
    report.refute(
        "the arm was scored on four trials",
        k != 4,
        f"k={k!r}",
    )
    per_trial = artefact.get("per_trial")
    report.predict(
        "the trial ledger is present, so retention can be recomputed from the artefact",
        isinstance(per_trial, list) and len(per_trial) > 0,
        f"{len(per_trial) if isinstance(per_trial, list) else 0} row(s)",
    )
    if pair is None:
        report.note("no pair file beside the arm: the delta is not read here")
    report.note(retention_note(pair or {}))

    # ---- the verdict -----------------------------------------------------------------------------
    if written == 0:
        report.refute("the arm wrote a store", True, "0 records: the arm did not run")
        return "ABANDONED", report
    servable = ((tau2.get("store") or {}).get("servable"))
    if isinstance(servable, int) and servable == 0:
        report.refute("the store is reachable by the recall scope the arm asks in", True, "0 servable")
        return "ABANDONED", report

    if report.refutation_fired:
        return "ABANDONED", report
    if not report.predictions_ok:
        return "ABANDONED", report
    return "GRADED", report


def base_record(**over: Any) -> dict[str, Any]:
    """A GRADED artefact: records in the store, one candidate per event, all entities kept."""
    artefact: dict[str, Any] = {
        "id": "poc-l4",
        "metrics": {"pass4": 0.62, "k": 4, "tasks": 57, "published_pass4": PUBLISHED_PASS4},
        "per_trial": [{"id": "retail/1", "trial": 0, "reward": 1}],
        "tau2": {
            "scenario": {"learn": "retail", "test": "retail", "recall": "retail"},
            "learning": {"edited": 15, "events": 15, "candidates": 15, "distilled": 15},
            "distillForm": {"form": "record", "toolInventory": ["cancel_pending_order"], "refused": 0},
            "distillUnit": {"unit": "raw", "traces": 0, "traced": 0, "claims": 15},
            "rawlog": {"records": 15, "clipped": 0, "toolBan": False},
            "faithfulness": {
                "corrections": 15,
                "withoutEntities": 0,
                "entities": 40,
                "kept": 40,
                "whole": 15,
            },
            "storeItems": {
                "items": [
                    {
                        "id": "a",
                        "kind": "exemplar",
                        "status": "active",
                        "statement": 'Q: cancel W237\nA: cancel_pending_order(order_id="W237")',
                        "supportTasks": 1,
                    }
                ]
            },
            "store": {"stored": 15, "active": 15, "servable": 15},
            "coverage": {"medians": {"medianNonzero": 0.21}, "measuredPairs": 456},
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
            ("a raw arm whose records survive and clear the floor grades", base_record(), "GRADED"),
            (
                "another unit is discarded rather than reinterpreted",
                base_record(**{"tau2.distillUnit.unit": "trace"}),
                "DISCARDED",
            ),
            (
                "a record store that was consolidated is a second variable, not this arm",
                base_record(**{"tau2.distillUnit.consolidation": {"groups": 1}}),
                "DISCARDED",
            ),
            (
                "an artefact that records no census cannot be read",
                base_record(**{"tau2.rawlog": None}),
                "NO_MEASUREMENT",
            ),
            (
                "an empty store abandons: the arm did not run",
                base_record(**{
                    "tau2.rawlog": {"records": 0, "clipped": 0, "toolBan": False},
                    "tau2.storeItems": {"items": []},
                    "tau2.store": {"stored": 0, "active": 0, "servable": 0},
                }),
                "ABANDONED",
            ),
            (
                "a store nothing can reach abandons, whatever it holds",
                base_record(**{"tau2.store.servable": 0}),
                "ABANDONED",
            ),
            (
                "a clipped record is a summary written by slice, and the run abandons on it",
                base_record(**{"tau2.faithfulness": {
                    "corrections": 15, "withoutEntities": 0, "entities": 40, "kept": 20, "whole": 2,
                }}),
                "ABANDONED",
            ),
            (
                "records that do not share the question's words refute the hypothesis",
                base_record(**{"tau2.coverage.medians.medianNonzero": 0.09}),
                "ABANDONED",
            ),
            (
                "no faithfulness block leaves the write prediction ungraded rather than failed",
                base_record(**{"tau2.faithfulness": None}),
                "GRADED",
            ),
            (
                # Clipping is the registered *cause*, not a registered bar: a store that clipped has
                # to lose its detail in `faithfulness` before the arm is refuted, and this fixture
                # clips four records while keeping every entity.
                "clipped records alone do not abandon, because the loss is measured on the entities",
                base_record(**{"tau2.rawlog": {"records": 100, "clipped": 4, "toolBan": False}}),
                "GRADED",
            ),
            (
                "a pass^4 below the published number fails the prediction",
                base_record(**{"metrics.pass4": 0.40}),
                "ABANDONED",
            ),
            (
                "a run that did not score four trials abandons",
                base_record(**{"metrics.k": 1}),
                "ABANDONED",
            ),
            (
                "another scenario pair is discarded",
                base_record(**{"tau2.scenario.test": "airline"}),
                "DISCARDED",
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

        context_cases: list[tuple[str, dict[str, Any], list[str]]] = [
            (
                "a run stopped at the capture relays the chain and the driver's sentence",
                {
                    "id": "poc-l4",
                    "metrics": {"status_no_measurement": 1, "k": 4},
                    "notes": {
                        "0": STOPPED_PREFIX + " 14 correction(s) -> 14 asked -> 14 candidate(s) -> "
                             "14 admitted -> 14 stored -> 0 servable (0 refused, 0 failed): the store "
                             "holds items and none is reachable by the recall scope this arm asks in",
                    },
                },
                [
                    "stopped before measurement: 14 correction(s) -> 14 asked -> 14 candidate(s)",
                    "none is reachable by the recall scope",
                ],
            ),
            (
                "a pair with no retention says so instead of printing nothing",
                base_record(),
                ["retention: absent (no per_trial ledger on both arms"],
            ),
            (
                "the census prints the clipped share, because it is where any lost detail went",
                base_record(**{"tau2.rawlog": {"records": 100, "clipped": 4, "toolBan": False}}),
                ["records clipped by the ceiling: 4 of 100 (4.0%)"],
            ),
        ]
        for label, artefact, expected in context_cases:
            _, report = grade(artefact)
            text = report.render()
            missing = [line for line in expected if line not in text]
            mark = "ok  " if not missing else "FAIL"
            if missing:
                failures += 1
            print(f"  {mark} {label}")
            if missing:
                print(report.render())
        print(f"self-test: {len(cases) + len(context_cases) - failures}/{len(cases) + len(context_cases)} cases")
        return 0 if failures == 0 else 1

    if not args.dir:
        parser.error("--dir or --self-test is required")
    root = Path(args.dir)
    arms = sorted(path for path in root.glob("arms/*/poc-l4.json"))
    if not arms:
        arms = sorted(root.glob("**/poc-l4.json"))
    if not arms:
        print(f"no poc-l4.json under {root}", file=sys.stderr)
        return 2
    worst = 0
    for path in arms:
        artefact = json.loads(path.read_text())
        pair_path = path.parent / "poc-l4-pair.json"
        pair = json.loads(pair_path.read_text()) if pair_path.exists() else None
        state, report = grade(artefact, pair)
        print(f"== {path.parent.name}: {state}")
        print(report.render())
        if state != "GRADED":
            worst = 1
    return worst


if __name__ == "__main__":
    sys.exit(main())
