#!/usr/bin/env python3
"""R88 readback: a record is not a claim, and three layers were treating it as one.

The registration is `prereg/R88-record-not-claim.md`. R85 ran the record arm and returned
`ABANDONED` on a number that named the next three defects: twelve records written, twelve clipped at
700 characters, **eleven refuted by each other** and one servable. Each reading has a different cause
in a different layer, so this readback grades them apart rather than summing them into a verdict:

  the write        records, no model call          (unchanged from R85)
  the ceiling      clipped <= 1, faithfulness >= 0.95   (700 -> 2000, measured on the corpus)
  the admission    every record active and servable      (events no longer contradict each other)
  the read         coverage >= 25%                 (twelve servable where one was)
  the outcome      pass^4 >= 0.575, with its interval

The admission rows are the new ones and they are the reason this arm is worth a dispatch: they are a
property of the write, so they are readable without a single evaluation episode, and R85's
`active 1, candidate 11` is the reading they exist to move.

`rawlog.clipped` is graded here, unlike in `r85_readback`, because this registration states it as a
prediction in its own words -- "At most one record is clipped" -- and a graded prediction has to be
quotable from the registration rather than invented by the readback.

States, the same four the other verifiers use:

  GRADED          every graded prediction holds and no refutation fired.
  NO_MEASUREMENT  the artefact cannot answer the question: no unit, no record census, no counts.
  DISCARDED       the artefact is another arm or another scenario pair.
  ABANDONED       a refutation fired.

Usage:
  python3 eval/tools/fetch_evidence.py --repo microglia --run <run-id> --out /tmp/r88
  python3 r88_readback.py --dir /tmp/r88
  python3 r88_readback.py --self-test
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any

from _funnel import funnel_notes
from _retention import retention_note

# Quoted from `prereg/R88-record-not-claim.md`, written before the measurement existed.
PREDICTED_FAITHFULNESS_MIN = 0.95
PREDICTED_MAX_CLIPPED = 1
PREDICTED_COVERAGE_P50_MIN = 0.25
REFUTING_COVERAGE_P50 = 0.15
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
    """The 95% half-width of a per-task `pass^4` at this many tasks, as a normal approximation."""
    if tasks <= 0:
        return None
    return 1.96 * math.sqrt(max(pass4 * (1.0 - pass4), 0.0) / tasks)


def number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


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
        value = number(medians.get("medianNonzero"))
        if value is not None:
            return value
    quantiles = coverage.get("nonzeroQuantiles")
    if isinstance(quantiles, dict):
        return number(quantiles.get("p50"))
    return None


def statuses_of(tau2: dict[str, Any]) -> dict[str, Any]:
    block = tau2.get("store")
    if not isinstance(block, dict):
        return {}
    inner = block.get("statuses")
    return inner if isinstance(inner, dict) else block


def grade(artefact: dict[str, Any], pair: dict[str, Any] | None = None) -> tuple[str, Report]:
    report = Report()
    tau2 = artefact.get("tau2") or {}
    metrics = artefact.get("metrics") or {}

    # The chain that carries the treatment, before the treatment. A raw arm asks the model nothing, so
    # a stop here is a stop at the capture, the admission or the parser, and the sentence says which.
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
    if isinstance(unit.get("consolidation"), dict):
        report.note("the claim-merging pass ran on a record store: this arm is not the registered one")
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

    # The ceiling that was stated. A run at another ceiling is a different experiment, and the whole
    # point of putting the number in the header is that this can be checked rather than assumed.
    ceiling = records.get("ceiling")
    if isinstance(ceiling, int):
        report.note(f"ceiling: {ceiling} characters (R85 ran at 700)")
    else:
        # Not graded: `rawlog.ceiling` arrives with the payload that carries it, and an artefact written
        # before that field existed is still a readable arm. Named so a 2000-run and a 700-run cannot be
        # silently compared.
        report.note("the census does not state its ceiling: read the header, not the artefact")

    # ---- the write -------------------------------------------------------------------------------
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
    report.predict(
        "the write costs no model call, so nothing could fault",
        isinstance(asked, int)
        and isinstance(candidates, int)
        and asked > 0
        and candidates == asked
        and not dropped
        and (failed in (0, None)),
        f"events {asked!r}, candidates {candidates!r}, dropped {dropped!r}, llmFailed {failed!r}",
    )

    # ---- the ceiling -----------------------------------------------------------------------------
    report.predict(
        f"at most {PREDICTED_MAX_CLIPPED} record is clipped, at the ceiling this arm stated",
        clipped <= PREDICTED_MAX_CLIPPED,
        f"{clipped} of {written} clipped" + (f" (ceiling {ceiling})" if isinstance(ceiling, int) else ""),
    )
    # The registration's own second refutation: a ceiling still below the population, wrong in the same
    # direction and for the third time.
    report.refute(
        "the ceiling is still below the population it has to hold",
        written > 0 and clipped > PREDICTED_MAX_CLIPPED,
        f"{clipped} of {written} clipped: raise it by the measured maximum, not by another guess",
    )

    faithfulness = tau2.get("faithfulness")
    kept_share: float | None = None
    if not isinstance(faithfulness, dict) or not isinstance(faithfulness.get("entities"), int):
        report.predict(
            f"at least {PREDICTED_FAITHFULNESS_MIN:.0%} of the corrections' own entities survive the write",
            None,
            "faithfulness absent: the run predates the instrument or the corpus carried no entity",
        )
    else:
        kept_share = share(faithfulness.get("kept", 0), faithfulness["entities"])
        unwritten = faithfulness.get("unwritten")
        if isinstance(unwritten, int) and unwritten > 0 and unwritten == faithfulness.get("corrections"):
            report.predict(
                f"at least {PREDICTED_FAITHFULNESS_MIN:.0%} of the corrections' own entities survive the write",
                None,
                f"no measurement: {faithfulness['entities']} entity(ies) in {unwritten} "
                f"correction(s) never reached the store",
            )
            kept_share = None
        elif kept_share is None:
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
                f"whole in {faithfulness.get('whole')} of {faithfulness.get('corrections')} correction(s)"
                + " — R85 kept 42.34%",
            )
            # The registration's third refutation, and its condition is the ceiling's clearance: below
            # 0.95 while nothing was clipped means the write abstracts somewhere the ceiling does not
            # explain, which is the record arm's central claim failing.
            report.refute(
                "the write abstracts somewhere the ceiling does not explain",
                clipped <= PREDICTED_MAX_CLIPPED and kept_share < PREDICTED_FAITHFULNESS_MIN,
                f"{kept_share:.2%} kept with {clipped} clipped",
            )

    # ---- the admission ---------------------------------------------------------------------------
    # The reading R85's `active 1, candidate 11` exists to move, and the only one this arm can grade
    # without an evaluation episode: admission is a property of the write.
    store_statuses = statuses_of(tau2)
    active = store_statuses.get("active")
    candidate = store_statuses.get("candidate")
    servable = store_statuses.get("servable", active)
    if not isinstance(active, int):
        report.predict("every record is admitted", None, "the store census carries no status counts")
    else:
        report.predict(
            "every record is admitted, because an event does not contradict another event",
            written > 0 and active >= written,
            f"{active} active of {written} record(s), {candidate!r} candidate"
            + (f", reasons {json.dumps(store_statuses.get('reasons'))}" if store_statuses.get("reasons") else "")
            + " — R85 admitted 1 of 12",
        )
        report.refute(
            "contradiction was not the only thing suppressing records",
            written > 0 and clipped <= PREDICTED_MAX_CLIPPED and active < written,
            f"{active} of {written} active with {clipped} clipped: the admission model is wrong for "
            f"events in a second way this registration did not name",
        )
    if isinstance(servable, int):
        report.note(f"servable in the recall scope: {servable} (R85: 1)")

    # ---- the read --------------------------------------------------------------------------------
    coverage = median_nonzero(tau2)
    if coverage is None:
        report.predict(
            f"the pack's median non-zero coverage clears {PREDICTED_COVERAGE_P50_MIN:.0%}",
            None,
            "coverage absent",
        )
    else:
        report.predict(
            f"the pack's median non-zero coverage clears {PREDICTED_COVERAGE_P50_MIN:.0%}",
            coverage >= PREDICTED_COVERAGE_P50_MIN,
            f"{coverage:.2%} against R85's 13.04% and R58's 10.53% on the same corpus",
        )
        # The registration's fifth refutation, conditioned on reachability: with every record servable
        # and coverage under the refuting bar, reachability was never the constraint -- the pack is.
        reachable = isinstance(servable, int) and written > 0 and servable >= written
        report.refute(
            "reachability was never the constraint; the pack is",
            reachable and coverage < REFUTING_COVERAGE_P50,
            f"{coverage:.2%} with {servable} of {written} servable",
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
            f"{pass4:.4f}{band} against {PUBLISHED_PASS4}",
        )
        report.refute(
            "records written whole and served reachable still make the agent worse",
            half is not None and pass4 + half < PUBLISHED_PASS4,
            f"{pass4:.4f} + {half * 100 if half is not None else 0:.2f}pp still below {PUBLISHED_PASS4}",
        )
    else:
        report.predict(
            f"pass^4 does not fall below the published {PUBLISHED_PASS4:.3f}", None, "pass4 absent"
        )

    k = metrics.get("k")
    report.refute("the arm was scored on four trials", k != 4, f"k={k!r}")
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
    if isinstance(servable, int) and servable == 0:
        report.refute("the store is reachable by the recall scope the arm asks in", True, "0 servable")
        return "ABANDONED", report

    if report.refutation_fired or not report.predictions_ok:
        return "ABANDONED", report
    return "GRADED", report


def base_record(**over: Any) -> dict[str, Any]:
    """A GRADED artefact: records written whole, every one admitted, coverage clear of the bar."""
    artefact: dict[str, Any] = {
        "id": "poc-l4",
        "metrics": {"pass4": 0.62, "k": 4, "tasks": 57, "published_pass4": PUBLISHED_PASS4},
        "per_trial": [{"id": "retail/1", "trial": 0, "reward": 1}],
        "tau2": {
            "scenario": {"learn": "retail", "test": "retail", "recall": "retail"},
            "learning": {"edited": 12, "events": 12, "candidates": 12, "distilled": 12},
            "distillForm": {"form": "record", "toolInventory": ["cancel_pending_order"], "refused": 0},
            "distillUnit": {"unit": "raw", "traces": 0, "traced": 0, "claims": 12},
            "rawlog": {"records": 12, "clipped": 0, "toolBan": False, "ceiling": 2000},
            "faithfulness": {
                "corrections": 12,
                "withoutEntities": 0,
                "entities": 137,
                "kept": 136,
                "whole": 11,
                "unwritten": 0,
            },
            "storeItems": {
                "items": [
                    {
                        "id": "a",
                        "kind": "exemplar",
                        "status": "active",
                        "statement": 'Q: cancel W237\nA: cancel_pending_order(order_id="W237")',
                        "supportTasks": 1,
                        "evidence": 1,
                    }
                ]
            },
            "store": {
                "stored": 12,
                "active": 12,
                "servable": 12,
                "statuses": {"active": 12, "candidate": 0, "quarantined": 0, "retired": 0, "other": 0},
            },
            "coverage": {"medians": {"medianNonzero": 0.31}, "measuredPairs": 456},
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
            ("a record arm that survives its own write grades", base_record(), "GRADED"),
            (
                "another unit is discarded rather than reinterpreted",
                base_record(**{"tau2.distillUnit.unit": "trace"}),
                "DISCARDED",
            ),
            (
                "a record store that was consolidated runs a second variable",
                base_record(**{"tau2.distillUnit.consolidation": {"groups": 1}}),
                "DISCARDED",
            ),
            (
                "an artefact that records no census cannot be read",
                base_record(**{"tau2.rawlog": None}),
                "NO_MEASUREMENT",
            ),
            (
                "the R85 store is still readable and still abandons, which is the regression",
                base_record(**{
                    "tau2.rawlog": {"records": 12, "clipped": 12, "toolBan": False},
                    "tau2.faithfulness.kept": 58,
                    "tau2.faithfulness.whole": 0,
                    "tau2.store": {
                        "stored": 12,
                        "active": 1,
                        "servable": 1,
                        "statuses": {"active": 1, "candidate": 11},
                        "reasons": {"insufficient-evidence": 11},
                    },
                    "tau2.coverage": {"medians": {"medianNonzero": 0.1304}},
                }),
                "ABANDONED",
            ),
            (
                "two clipped records say the ceiling is still below the population",
                base_record(**{"tau2.rawlog": {"records": 12, "clipped": 2, "toolBan": False, "ceiling": 2000}}),
                "ABANDONED",
            ),
            (
                "an unclipped store that still lost its entities refutes the write, not the ceiling",
                base_record(**{
                    "tau2.faithfulness.kept": 80,
                    "tau2.faithfulness.whole": 2,
                }),
                "ABANDONED",
            ),
            (
                "eleven candidates out of twelve say contradiction was not the only cause",
                base_record(**{
                    "tau2.store": {
                        "stored": 12,
                        "active": 1,
                        "servable": 1,
                        "statuses": {"active": 1, "candidate": 11},
                    }
                }),
                "ABANDONED",
            ),
            (
                "reachability arrived and coverage did not follow, so the pack is the constraint",
                base_record(**{"tau2.coverage": {"medians": {"medianNonzero": 0.13}}}),
                "ABANDONED",
            ),
            (
                "records whole and reachable that still cost the agent would be the negative effect",
                base_record(**{"metrics.pass4": 0.42}),
                "ABANDONED",
            ),
            (
                "an empty store abandons: the arm did not run",
                base_record(**{
                    "tau2.rawlog": {"records": 0, "clipped": 0, "toolBan": False, "ceiling": 2000},
                    "tau2.storeItems": {"items": []},
                    "tau2.store": {"stored": 0, "active": 0, "servable": 0},
                }),
                "ABANDONED",
            ),
            (
                "a store nobody wrote leaves the write ungraded rather than failed",
                base_record(**{
                    "tau2.faithfulness.unwritten": 12,
                    "tau2.faithfulness.kept": 0,
                    "tau2.faithfulness.whole": 0,
                }),
                "GRADED",
            ),
        ]

        failures = 0
        for label, artefact, expected in cases:
            verdict, report = grade(artefact, None)
            ok = verdict == expected
            print(f"  {'PASS' if ok else 'FAIL'}  {label} -> {verdict}" + ("" if ok else f" (expected {expected})"))
            if not ok:
                failures += 1
                print(report.render())
        print(f"self-test: {len(cases) - failures}/{len(cases)} cases")
        return 0 if failures == 0 else 1

    if args.dir is None:
        print("usage: r88_readback.py --dir <evidence-dir> | --self-test", file=sys.stderr)
        return 2

    root = Path(args.dir)
    arms = sorted(root.glob("arms/*/*.json"))
    if not arms:
        print(f"no arm artefact under {root}/arms", file=sys.stderr)
        return 2
    pair_path = root / "poc-l4-pair.json"
    pair = json.loads(pair_path.read_text()) if pair_path.exists() else None

    failed = 0
    for path in arms:
        if path.name.endswith("-pair.json"):
            continue
        artefact = json.loads(path.read_text())
        if not isinstance(artefact.get("metrics"), dict):
            continue
        verdict, report = grade(artefact, pair)
        print(f"== {path.parent.name}: {verdict}")
        print(report.render())
        if verdict != "GRADED":
            failed += 1
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
