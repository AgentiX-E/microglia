#!/usr/bin/env python3
"""R87 readback: the same census, at the size where the failure population exists.

The registration is `prereg/R87-fault-census-at-size.md`. R86 asked the right question and could not
answer it: its cap was justified with *"every task in it contributes corrections"*, `teachingOf` returns
`undefined` for a task that passed, and the run therefore made **one** distillation call instead of
fifteen. At R58's 11/15 a single quiet call has probability 0.27, so not even the registered refutation
could fire — the arm was unmeasured, not refuted.

The change is the sample, not the instrument: 57 learning tasks, which is the half R58 learned from, and
an evaluation cap of one, because the quantity is produced by the learning half and grading it buys
nothing this registration reports.

So this readback grades one thing more than `r86` did, and it is the registration's own floor: **eight
calls**. Below it a code distribution is a list, the arithmetic in the registration is wrong, and the
verdict is `NO_MEASUREMENT` rather than a refutation — the fault would be in the registration rather
than in the distiller.

States:

  GRADED          at least eight calls, at least one fault, one code dominating, specimens quotable.
  NO_MEASUREMENT  too few calls to grade a distribution, or the count arrived without the codes.
  DISCARDED       the artefact is another unit or another scenario pair.
  ABANDONED       a refutation fired: a real load and no fault, the codes naming the provider, or a
                  store reading the one-task evaluation cannot carry.

Usage:
  python3 eval/tools/fetch_evidence.py --repo microglia --run <run-id> --out /tmp/r87
  python3 r87_readback.py --dir /tmp/r87
  python3 r87_readback.py --self-test
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from _funnel import STOPPED_PREFIX, funnel_notes

STATES = ("GRADED", "NO_MEASUREMENT", "DISCARDED", "ABANDONED")

# Quoted from `prereg/R87-fault-census-at-size.md`, written before the measurement existed.
DOMINANT_CODE = "MG_E_INVALID_SIGNAL"
DOMINANT_SHARE_MIN = 0.60
# The registration's own floor. Seven calls is a list; eight is the smallest population over which
# "one code dominates" is a statement rather than an anecdote.
CALLS_MIN = 8
PROVIDER_CODES = ("MG_E_PROVIDER", "MG_E_TIMEOUT", "MG_E_RATE_LIMIT", "unknown")
REQUIRED_SCENARIO = {"learn": "retail", "test": "retail", "recall": "retail"}
SAMPLE_CEILING = 200
# The evaluation cap is one task, so four episodes. Anything at or above this is a dispatch that
# graded a store, which the registration says it does not.
STORE_GRADED_TASKS = 40


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


def distribution(learning: dict[str, Any]) -> dict[str, int] | None:
    reasons = learning.get("llmFailedReasons")
    if not isinstance(reasons, dict) or not reasons:
        return None
    out: dict[str, int] = {}
    for code, count in reasons.items():
        if isinstance(count, int) and not isinstance(count, bool) and count >= 0:
            out[str(code)] = count
    return out or None


def grade(artefact: dict[str, Any]) -> tuple[str, Report]:
    report = Report()
    tau2 = artefact.get("tau2") or {}
    metrics = artefact.get("metrics") or {}

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
    if unit.get("unit") != "trace":
        report.refute("the dispatch ran the unit the faults belong to", True, f"unit {unit.get('unit')!r}")
        return "DISCARDED", report

    learning = tau2.get("learning") or {}
    asked = learning.get("events")
    failed = learning.get("llmFailed")
    claims = learning.get("candidates")
    if not isinstance(asked, int) or not isinstance(failed, int):
        report.predict(
            "the artefact counts the events and the faults",
            None,
            f"events {asked!r}, llmFailed {failed!r}",
        )
        return "NO_MEASUREMENT", report

    # The population first, because everything below it is a statement about a distribution and a
    # distribution over seven calls is a list. R86 is the case this exists for: it had one call and its
    # refutation could not fire, so no verdict about the distiller was available at all.
    if asked < CALLS_MIN:
        report.predict(
            f"the learning half produced at least {CALLS_MIN} distillation calls",
            False,
            f"{asked} call(s); the registration's arithmetic predicted 15 from 57 learning tasks",
        )
        report.refute(
            "the population arithmetic holds at this size",
            True,
            f"{asked} call(s) cannot grade a distribution over codes",
        )
        report.note(
            "the store is not read: a code distribution over "
            f"{asked} call(s) is a list, and the fault is in the registration rather than the distiller"
        )
        return "NO_MEASUREMENT", report

    report.predict(
        f"the learning half produced at least {CALLS_MIN} distillation calls",
        True,
        f"{asked} call(s), {claims!r} claim(s), {failed} fault(s)",
    )
    report.predict(
        "at least one distillation call faulted at this load",
        failed >= 1,
        f"{failed} of {asked}",
    )
    if failed == 0:
        # A real load and no fault: the eleven at fifteen were throughput, not the prompt, and neither
        # the ceiling nor the form is implicated.
        report.refute("the faults were a property of the prompt rather than of the load", True, f"0 of {asked}")
        return "ABANDONED", report

    codes = distribution(learning)
    if codes is None:
        report.predict("the codes reached the artefact, not only the count", False, "llmFailedReasons absent")
        report.refute("the instrument reached the run", True, "the count is recorded and the distribution is not")
        return "NO_MEASUREMENT", report

    total = sum(codes.values())
    report.predict(
        "the distribution sums to the count it explains",
        total == failed,
        f"{total} coded of {failed} counted",
    )
    report.note("fault codes: " + ", ".join(f"{code} {count}" for code, count in sorted(codes.items())))
    # The one outcome R86 saw and the enumeration does not name: a reply that parsed and carried no
    # claim, counted as neither a candidate nor a fault. It cannot be derived per call from these
    # counters, so it is stated as the residual a reader should expect: events not explained by faults
    # and not producing claims.
    empty = asked - failed - (1 if isinstance(claims, int) and claims > 0 else 0)
    if isinstance(claims, int):
        report.note(
            f"replies outside the census: {max(0, empty)} event(s) neither faulted nor produced a claim "
            f"(events {asked}, faults {failed}, claims {claims})"
        )

    dominant = codes.get(DOMINANT_CODE, 0)
    dominant_share = share(dominant, total)
    report.predict(
        f"{DOMINANT_CODE} carries at least {DOMINANT_SHARE_MIN:.0%} of the faults",
        dominant_share is not None and dominant_share >= DOMINANT_SHARE_MIN,
        f"{dominant} of {total} ({dominant_share:.0%})" if dominant_share is not None else "no fault coded",
    )

    samples = learning.get("llmFailedSamples")
    if not isinstance(samples, dict) or not samples:
        report.predict("each code carries one quotable specimen", False, "llmFailedSamples absent")
    else:
        unusable = [
            code
            for code in codes
            if not isinstance(samples.get(code), str)
            or samples.get(code, "").strip() == ""
            or len(samples.get(code, "")) > SAMPLE_CEILING
        ]
        report.predict(
            "each code carries one quotable specimen, bounded",
            not unusable,
            f"{len(samples)} sample(s), unusable: {', '.join(sorted(unusable)) or 'none'}",
        )
        signal_sample = samples.get(DOMINANT_CODE)
        if isinstance(signal_sample, str) and signal_sample != "":
            report.predict(
                "the invalid-signal specimen carries the reply's own opening characters",
                "<-" in signal_sample,
                signal_sample[:120],
            )

    provider = sum(count for code, count in codes.items() if code in PROVIDER_CODES)
    provider_share = share(provider, total)
    if provider_share is not None:
        report.note(
            f"provider-side codes carry {provider} of {total} ({provider_share:.0%}): "
            f"{'the ceiling and the form are innocent' if provider_share > 0.5 else 'the ceiling or the form is implicated'}"
        )
        report.refute(
            "the faults name the prompt rather than the provider",
            provider_share > 0.5,
            f"{provider_share:.0%} of the faults are provider-side",
        )

    # The store is not graded: the evaluation cap is one task, so `pass^4` would be a number about one
    # task, and the registration says so before the run.
    coverage = (tau2.get("coverage") or {}).get("medians")
    pass4 = metrics.get("pass4")
    tasks = metrics.get("tasks")
    report.note(
        "the store is not graded on this dispatch: "
        f"coverage {json.dumps(coverage) if coverage is not None else 'absent'}, "
        f"pass4 {pass4!r}, tasks {tasks!r} against the lane's floor"
    )
    report.predict(
        "the run does not publish a store reading the one-task evaluation cannot carry",
        tasks is not None and int(tasks or 0) < STORE_GRADED_TASKS,
        f"tasks {tasks!r}",
    )

    if report.refutation_fired:
        return "ABANDONED", report
    if not report.predictions_ok:
        return "ABANDONED", report
    return "GRADED", report


def base_artefact(**over: Any) -> dict[str, Any]:
    """A GRADED artefact: fifteen calls, eleven faults, all of them invalid-signal, one specimen."""
    artefact: dict[str, Any] = {
        "id": "poc-l4",
        "metrics": {"pass4": 0.4, "k": 4, "tasks": 1},
        "tau2": {
            "scenario": {"learn": "retail", "test": "retail", "recall": "retail"},
            "learning": {
                "edited": 15,
                "events": 15,
                "candidates": 4,
                "distilled": 4,
                "llmFailed": 11,
                "llmFailedReasons": {DOMINANT_CODE: 11},
                "llmFailedSamples": {
                    DOMINANT_CODE: 'MG_E_INVALID_SIGNAL: LLM response is not JSON <- {"candidates":[{"kind"'
                },
            },
            "distillUnit": {"unit": "trace", "traces": 15, "traced": 15, "claims": 4},
            "coverage": {"medians": {"medianNonzero": 0.09}},
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
            ("a census with the population and one dominant code grades", base_artefact(), "GRADED"),
            (
                "one call cannot grade a distribution, and the fault is the registration's",
                base_artefact(**{
                    "tau2.learning.events": 1,
                    "tau2.learning.candidates": 0,
                    "tau2.learning.llmFailed": 0,
                    "tau2.learning.llmFailedReasons": {},
                    "tau2.learning.llmFailedSamples": {},
                }),
                "NO_MEASUREMENT",
            ),
            (
                "seven calls is a list, so the floor refuses the reading",
                base_artefact(**{
                    "tau2.learning.events": 7,
                    "tau2.learning.llmFailed": 5,
                    "tau2.learning.llmFailedReasons": {DOMINANT_CODE: 5},
                }),
                "NO_MEASUREMENT",
            ),
            (
                "a real load with no fault abandons: the load was the cause",
                base_artefact(**{"tau2.learning.llmFailed": 0, "tau2.learning.llmFailedReasons": {}}),
                "ABANDONED",
            ),
            (
                "a count with no distribution is the defect this round exists to end",
                base_artefact(**{"tau2.learning.llmFailedReasons": None, "tau2.learning.llmFailedSamples": None}),
                "NO_MEASUREMENT",
            ),
            (
                "a distribution that does not sum to the count fails, because one of them is wrong",
                base_artefact(**{"tau2.learning.llmFailedReasons": {DOMINANT_CODE: 4}}),
                "ABANDONED",
            ),
            (
                "a provider code dominating refutes the prompt hypothesis",
                base_artefact(**{"tau2.learning.llmFailedReasons": {"MG_E_PROVIDER": 9, DOMINANT_CODE: 2}}),
                "ABANDONED",
            ),
            (
                "a specimen without the reply's opening cannot separate the three failures",
                base_artefact(**{"tau2.learning.llmFailedSamples": {DOMINANT_CODE: "MG_E_INVALID_SIGNAL: not JSON"}}),
                "ABANDONED",
            ),
            (
                "another unit is discarded rather than reinterpreted",
                base_artefact(**{"tau2.distillUnit.unit": "correction"}),
                "DISCARDED",
            ),
            (
                "another scenario pair is discarded",
                base_artefact(**{"tau2.scenario.test": "airline"}),
                "DISCARDED",
            ),
            (
                "an artefact that counts neither events nor faults cannot be read",
                base_artefact(**{"tau2.learning.llmFailed": None}),
                "NO_MEASUREMENT",
            ),
            (
                "a dispatch that graded the store on 57 tasks fails its own refusal",
                base_artefact(**{"metrics.tasks": 57}),
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

        context_cases: list[tuple[str, dict[str, Any], list[str]]] = [
            (
                "a run stopped at the funnel relays the chain and the driver's sentence",
                {
                    "id": "poc-l4",
                    "metrics": {"status_no_measurement": 1, "k": 4},
                    "notes": {
                        "0": STOPPED_PREFIX + " 1 correction(s) -> 1 asked -> 0 candidate(s) -> "
                             "0 admitted -> 0 stored -> 0 servable (0 refused, 0 failed): the "
                             "interpreter answered all 1 event(s) with no claim of its own",
                    },
                },
                [
                    "stopped before measurement: 1 correction(s) -> 1 asked -> 0 candidate(s)",
                    "with no claim of its own",
                ],
            ),
            (
                "the codes and the residual replies are printed, not only graded",
                base_artefact(),
                [f"fault codes: {DOMINANT_CODE} 11", "replies outside the census"],
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
        total_cases = len(cases) + len(context_cases)
        print(f"self-test: {total_cases - failures}/{total_cases} cases")
        return 0 if failures == 0 else 1

    if not args.dir:
        parser.error("--dir or --self-test is required")
    root = Path(args.dir)
    arms = sorted(root.glob("arms/*/poc-l4.json"))
    if not arms:
        arms = sorted(root.glob("**/poc-l4.json"))
    if not arms:
        print(f"no poc-l4.json under {root}", file=sys.stderr)
        return 2
    worst = 0
    for path in arms:
        artefact = json.loads(path.read_text())
        state, report = grade(artefact)
        print(f"== {path.parent.name}: {state}")
        print(report.render())
        if state != "GRADED":
            worst = 1
    return worst


if __name__ == "__main__":
    sys.exit(main())
