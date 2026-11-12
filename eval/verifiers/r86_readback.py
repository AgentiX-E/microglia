#!/usr/bin/env python3
"""R86 readback: which error did eleven of fifteen distillation calls throw?

The registration is `prereg/R86-llm-fault-census.md`. It is not an experiment on memory: R58 is read
and it is `NO_MEASUREMENT` because the store it graded was built from four of fifteen events, the
other eleven answered by the rule fallback and reported as one number with no code. This round exists
to turn that number into a cause, and the three candidate causes have three different fixes:

  the reply was cut by the token ceiling      -> raise the ceiling, or shrink what the prompt carries
  the reply was prose, or a shape the schema   -> change the form's instruction, not the ceiling
  refuses
  the provider refused, timed out, or 429'd    -> change concurrency and backoff; no prompt change

The artefact's `learning.llmFailedReasons` is the distribution and `learning.llmFailedSamples` is one
quotable specimen per code. Both were added the same night R58 was read, because the count without
them is exactly as actionable as no count.

This readback deliberately does **not** grade the store: ten tasks sit under the coverage floor by
construction and `pass^4` over ten tasks is a number about ten tasks. A run that publishes either as a
reading is publishing a number the sample cannot carry, and the registration says so before the run.

States:

  GRADED          the distribution arrived, and one code dominates it.
  NO_MEASUREMENT  the faults are counted and no code reached the artefact.
  DISCARDED       the artefact is another unit or another scenario pair.
  ABANDONED       a refutation fired: no fault at this load, or the codes name the provider rather
                  than the ceiling or the form.

Usage:
  python3 eval/tools/fetch_evidence.py --repo microglia --run <run-id> --out /tmp/r86
  python3 r86_readback.py --dir /tmp/r86
  python3 r86_readback.py --self-test
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from _funnel import STOPPED_PREFIX, funnel_notes

STATES = ("GRADED", "NO_MEASUREMENT", "DISCARDED", "ABANDONED")

# Quoted from `prereg/R86-llm-fault-census.md`, written before the measurement existed.
DOMINANT_CODE = "MG_E_INVALID_SIGNAL"
DOMINANT_SHARE_MIN = 0.60
# The two codes that name a provider rather than a prompt: the ceiling and the form are both innocent
# when these dominate, and the fix is concurrency and backoff.
PROVIDER_CODES = ("MG_E_PROVIDER", "MG_E_TIMEOUT", "MG_E_RATE_LIMIT", "unknown")
REQUIRED_SCENARIO = {"learn": "retail", "test": "retail", "recall": "retail"}
SAMPLE_CEILING = 200


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
    if not isinstance(asked, int) or not isinstance(failed, int):
        report.predict(
            "the artefact counts the events and the faults",
            None,
            f"events {asked!r}, llmFailed {failed!r}",
        )
        return "NO_MEASUREMENT", report

    report.predict(
        "at least one distillation call faulted at this load",
        failed >= 1,
        f"{failed} of {asked} event(s)",
    )
    if failed == 0:
        # The registration's first refutation: a rate that falls to zero at a tenth of the load is a
        # throughput effect, and neither the ceiling nor the form is implicated. There is nothing to
        # repair and nothing to grade.
        report.refute("the faults were a property of the prompt rather than of the load", True, f"0 of {asked}")
        return "ABANDONED", report

    codes = distribution(learning)
    if codes is None:
        # The registration's second refutation, and the one that matters most: the instrument was
        # added the night before this dispatch, so a run that carries the count and no code is a run
        # whose instrument never reached the artefact.
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
            # The preview is the only string that separates a reply cut off mid-object from a reply
            # written in prose with an object inside it, and those two have different fixes.
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

    # The store is not graded, and the readback says so rather than silently skipping it: ten tasks
    # sit under the coverage floor by construction, and a `pass^4` over ten tasks is a number about
    # ten tasks. The registration's fifth prediction is exactly this refusal.
    coverage = (tau2.get("coverage") or {}).get("medians")
    pass4 = metrics.get("pass4")
    report.note(
        "the store is not graded on this dispatch: "
        f"coverage {json.dumps(coverage) if coverage is not None else 'absent'}, "
        f"pass4 {pass4!r}, tasks {metrics.get('tasks')!r} against the lane's floor"
    )
    report.predict(
        "the run does not publish a store reading the sample cannot carry",
        metrics.get("tasks") is not None and int(metrics.get("tasks") or 0) < 40,
        f"tasks {metrics.get('tasks')!r}",
    )

    if report.refutation_fired:
        return "ABANDONED", report
    if not report.predictions_ok:
        return "ABANDONED", report
    return "GRADED", report


def base_artefact(**over: Any) -> dict[str, Any]:
    """A GRADED artefact: eleven faults, all of them invalid-signal, with one quotable specimen."""
    artefact: dict[str, Any] = {
        "id": "poc-l4",
        "metrics": {"pass4": 0.4, "k": 4, "tasks": 10},
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
            ("a census that names one dominant code grades", base_artefact(), "GRADED"),
            (
                "no fault at a tenth of the load abandons: the load was the cause",
                base_artefact(**{
                    "tau2.learning.llmFailed": 0,
                    "tau2.learning.llmFailedReasons": {},
                }),
                "ABANDONED",
            ),
            (
                "a count with no distribution is the defect this round exists to end",
                base_artefact(**{"tau2.learning.llmFailedReasons": None,
                                 "tau2.learning.llmFailedSamples": None}),
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
                "a dispatch that graded the store on ten tasks fails its own refusal",
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
                        "0": STOPPED_PREFIX + " 15 correction(s) -> 15 asked -> 0 candidate(s) -> "
                             "0 admitted -> 0 stored -> 0 servable (0 refused, 0 failed): the "
                             "interpreter answered all 15 event(s) with no claim of its own",
                    },
                },
                [
                    "stopped before measurement: 15 correction(s) -> 15 asked -> 0 candidate(s)",
                    "with no claim of its own",
                ],
            ),
            (
                "the codes are printed in the context, not only graded",
                base_artefact(),
                [f"fault codes: {DOMINANT_CODE} 11"],
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
