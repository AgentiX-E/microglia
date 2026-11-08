#!/usr/bin/env python3
"""R54 readback: grade a within-scenario artefact against its registration.

The registration is `prereg/R54-same-domain.md`. R51 is closed as ABANDONED by
its own readback, and this is the same mechanism measured in the configuration
its predictions were written for: a retail store answering retail questions and
recalling under retail, at floor 0. R51 inherited `TAU_TEST_DOMAIN=airline` from
a repository variable set for the transfer arm, so two of its three mechanism
predictions held on a cross-domain delivery and the third -- coverage -- graded a
transfer reading against a relevance bar. R49's "38% of requests were served an
empty pack" was likewise not a write-path defect: its floor of 0.01 emptied 571
packs of 1,516 by its own retention curve.

Four outcomes, and the fourth is written in the registration rather than invented
here:

  GRADED          every prediction that applies holds and no refutation fired.
  NO_MEASUREMENT  the census is absent. Nothing is claimed.
  DISCARDED       the artefact's `scenario` block is not retail/retail/retail.
                  R54's first refutation says such a dispatch "measured a
                  different experiment; it is discarded, not reinterpreted".
                  That is not a conclusion about the mechanism, which is why it
                  is a state of its own rather than ABANDONED.
  ABANDONED       a refutation fired. The account of why a condition does not
                  help is wrong, so there is no contribution to report.

The coverage prediction is graded on the quantity the committed instrument
already carries: `tau2.coverage.nonzeroQuantiles.p50`, the median over the pairs
that cleared zero. The same artefact now also carries
`tau2.coverage.medians.medianAllPairs` -- the median over every delivered pair,
zeros included -- which R47's population puts near 0.027 against the graded
4.5%. It is printed as context and **not graded**: R54 registers one bar on one
quantity, and a verifier that could choose between the two after seeing them
would be choosing the subject of the claim at read time. The registration's
Amendment records why the delivered median is the number a future registration
should ask for.

Usage:
  python3 r54_readback.py --dir <extracted-arm-dir>
  python3 r54_readback.py --self-test
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

# GRADED, NO_MEASUREMENT and ABANDONED are the three R49 and R51 use. DISCARDED
# is R54's own first refutation, spelled as a state so a wrong-configuration
# dispatch cannot be read as a scientific result.
STATES = ("GRADED", "NO_MEASUREMENT", "DISCARDED", "ABANDONED")

# Quoted from `prereg/R54-same-domain.md`, before the dispatch, so the verifier
# cannot drift from the file it grades against.
PREDICTED_CONDITIONED_MIN = 4
PREDICTED_EMPTY_MAX = 0.25
PREDICTED_P50_MIN = 0.12
PREDICTED_MEAN_PACK = (1.4, 2.4)
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


def scenario_of(tau2: dict[str, Any]) -> dict[str, Any] | None:
    """The three names the run actually used, or None when it recorded none.

    Absent is not a mismatch: an artefact from before R54's pinning has no
    `scenario` block at all, and refusing it would make every pre-R54 run
    unreadable. It is reported as unverifiable instead.
    """
    block = tau2.get("scenario")
    return block if isinstance(block, dict) else None


def grade(artefact: dict[str, Any]) -> tuple[str, Report]:
    report = Report()
    tau2 = artefact.get("tau2") or {}
    store = tau2.get("store") or {}
    recall = tau2.get("recall") or {}
    coverage = tau2.get("coverage") or {}
    quantiles = coverage.get("nonzeroQuantiles") or {}
    medians = coverage.get("medians") or {}
    verdict = artefact.get("verdict") or {}
    metrics = artefact.get("metrics") or {}

    # R54's first refutation, read before anything else: a dispatch that ran a
    # different pair measured a different experiment, and every census below it
    # would be a reading of the transfer arm wearing this registration's name.
    scenario = scenario_of(tau2)
    if scenario is not None:
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
        report.refute("the dispatch ran the registered scenario pair", False, "retail/retail/retail")
    else:
        report.predict(
            "the artefact states the scenario it ran",
            None,
            "no scenario block: written before R54 pinned the pair",
        )

    # The census is the measurement. An artefact with no census cannot answer any
    # prediction, and reading an absent field as zero would turn "not measured"
    # into "measured, and the write path produced nothing".
    conditioned = store.get("conditioned")
    servable = store.get("servable")
    requests = recall.get("requests")
    if conditioned is None or servable is None or requests is None:
        report.predict("the census is present", None, "conditioned/servable/requests absent")
        return "NO_MEASUREMENT", report

    empty = recall.get("empty")
    if empty is None:
        empty = requests - (recall.get("served") or 0)
    empty_share = share(empty, requests)
    mean_pack = tau2.get("meanPackIds")
    measured = coverage.get("measuredPairs")
    unmeasurable = coverage.get("unmeasurablePairs")
    injected = (tau2.get("use") or {}).get("injectedPairs")
    p50 = quantiles.get("p50")

    report.predict(
        f"the store states conditions ({PREDICTED_CONDITIONED_MIN}+ of the servable items)",
        conditioned >= PREDICTED_CONDITIONED_MIN,
        f"{conditioned} of {servable}",
    )
    report.predict(
        f"the empty-pack share stays at {PREDICTED_EMPTY_MAX:.0%} or less",
        empty_share is not None and empty_share <= PREDICTED_EMPTY_MAX,
        f"{empty}/{requests} ({empty_share:.3%})" if empty_share is not None else "no requests",
    )
    report.predict(
        f"median rule/query coverage reaches {PREDICTED_P50_MIN:.0%} or more",
        p50 is not None and p50 >= PREDICTED_P50_MIN,
        f"p50 {p50:.4f}" if p50 is not None else "p50 absent",
    )
    report.predict(
        f"the mean pack carries {PREDICTED_MEAN_PACK[0]}-{PREDICTED_MEAN_PACK[1]} rules per request",
        mean_pack is not None
        and PREDICTED_MEAN_PACK[0] <= mean_pack <= PREDICTED_MEAN_PACK[1],
        f"{mean_pack:.3f}" if mean_pack is not None else "meanPackIds absent",
    )

    state = verdict.get("state")
    gate_pass = None
    for gate in artefact.get("gates") or []:
        if gate.get("id") == "l4-paired":
            gate_pass = gate.get("pass")
    report.predict(
        "no revert branch fires: the memory does not cost accuracy",
        (state != "HARM") and (gate_pass is not False),
        f"verdict {state}, l4-paired {'pass' if gate_pass else 'absent/fail'}",
    )

    learning = tau2.get("learning") or {}
    origin = tau2.get("domainOrigin") or {}
    population_ok = (
        measured is not None
        and unmeasurable is not None
        and injected is not None
        and measured + unmeasurable == injected
    )
    instrument_ok = (
        (mean_pack or 0) > 0
        and (learning.get("distillFailed") or 0) == 0
        and (origin.get("storedWithoutDomain") or 0) == 0
        and (origin.get("unscopedIn") or 0) == 0
        and population_ok
    )
    report.predict(
        "the instrument holds: non-empty packs, no distiller failure, one coverage population",
        instrument_ok,
        f"mean {mean_pack}, distillFailed {learning.get('distillFailed')}, "
        f"withoutDomain {origin.get('storedWithoutDomain')}, unscoped {origin.get('unscopedIn')}, "
        f"pairs {measured}+{unmeasurable} vs injected {injected}",
    )
    report.predict(
        "the same episodes as R51: 4 trials over the held-out half",
        (metrics.get("k") or 0) == 4 and (metrics.get("tasks") or 0) == 50,
        f"k={metrics.get('k')}, tasks={metrics.get('tasks')}",
    )

    # The written text, because a count of conditions cannot say whether they
    # name the situation or the procedure. R54 registered that the artefact
    # carries the items in words for exactly this.
    sample = tau2.get("storeItems")
    if isinstance(sample, dict) and sample.get("items"):
        written = [item for item in sample["items"] if (item.get("when") or "").strip()]
        report.predict(
            "the artefact carries the store's own condition text",
            len(written) > 0,
            f"{len(written)} of {len(sample['items'])} sampled items state a condition, "
            f"{sample.get('omitted')} omitted",
        )
        for item in written[:3]:
            report.note(f"when: {item['when']}")
    else:
        report.predict("the artefact carries the store's own condition text", None, "storeItems absent")

    # Context, not a bar: the median over every delivered pair. The graded p50 is
    # the median over the survivors, and the two are far apart on this population.
    if medians.get("medianAllPairs") is not None:
        report.note(
            f"median over every delivered pair {medians['medianAllPairs']:.4f} "
            f"({medians.get('zeroPairs')} of {medians.get('pairs')} pairs at zero) -- not graded by R54"
        )
    elif medians:
        report.note("medians block present without a numeric medianAllPairs")
    else:
        report.note("no named medians block: the delivered-pair median is not recoverable from this artefact")

    # Refutations, each naming one way the account can be wrong. Read before any
    # accuracy number, because a run that fails one of these has nothing to say
    # about accuracy at all.
    report.refute(
        "the write path still produces no condition",
        conditioned == 0,
        f"conditioned {conditioned} of {servable}",
    )
    report.refute(
        "the conditions exist and do not name the situation",
        # R54's prose says "at 0.000 empty", which is what R51 measured. The
        # operative clause is the registered one -- the pack fills while the
        # median misses -- so a single non-zero empty pack cannot dodge it.
        p50 is not None
        and p50 < PREDICTED_P50_MIN
        and empty_share is not None
        and empty_share <= PREDICTED_EMPTY_MAX,
        f"p50 {p50}, empty share {empty_share:.3%}" if empty_share is not None else f"p50 {p50}",
    )
    report.refute(
        "recall and the register disagree: conditions name situations and the query is not what it seems",
        p50 is not None
        and p50 >= PREDICTED_P50_MIN
        and empty_share is not None
        and empty_share > PREDICTED_EMPTY_MAX,
        f"p50 {p50}, empty share {empty_share:.3%}",
    )
    report.refute(
        "the run cannot say what was written",
        not (isinstance(sample, dict) and sample.get("items")),
        "storeItems absent or empty",
    )
    report.refute(
        "the memory costs accuracy and the revert rule fires",
        state == "HARM",
        str(verdict.get("reason") or ""),
    )

    if report.refutation_fired:
        return "ABANDONED", report
    return ("GRADED" if report.predictions_ok else "ABANDONED"), report


# --------------------------------------------------------------------------- #
# self-test
# --------------------------------------------------------------------------- #


def base_artefact(**over: Any) -> dict[str, Any]:
    """A clean GRADED artefact: the R51 store, in the configuration R54 registers."""
    artefact: dict[str, Any] = {
        "id": "poc-l4",
        "metrics": {"pass4": 0.42, "k": 4, "tasks": 50},
        "tau2": {
            "meanPackIds": 1.9,
            "scenario": {"learn": "retail", "test": "retail", "recall": "retail"},
            "store": {"stored": 10, "active": 10, "servable": 10, "conditioned": 16, "unconditioned": 0},
            "recall": {"requests": 1527, "served": 1527, "empty": 0},
            "use": {"injectedPairs": 2188, "zeroCoveragePairs": 750},
            "coverage": {
                "measuredPairs": 2180,
                "unmeasurablePairs": 8,
                "nonzeroQuantiles": {"p50": 0.31, "p90": 0.62, "max": 1.0},
                "medians": {"pairs": 2180, "zeroPairs": 750, "medianAllPairs": 0.09, "medianNonzero": 0.31},
            },
            "storeItems": {
                "items": [{"id": "a", "when": "the user asks to cancel a pending order", "statement": "call cancel_pending_order"}],
                "limit": 64,
                "maxChars": 240,
                "omitted": 15,
                "truncated": 0,
            },
            "learning": {"rows": 32, "edited": 5, "distillFailed": 0},
            "domainOrigin": {"storedWithDomain": 10, "storedWithoutDomain": 0, "unscopedIn": 0},
        },
        "verdict": {"state": "UNRESOLVED", "reason": "does not clear the resolution"},
        "gates": [{"id": "l4-paired", "pass": True, "blocking": True}],
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
        cases: list[tuple[str, dict[str, Any], str]] = [
            ("a within-scenario artefact with a topical median grades", base_artefact(), "GRADED"),
            (
                "a retail store graded on airline questions is discarded, not interpreted",
                base_artefact(**{"tau2.scenario.test": "airline"}),
                "DISCARDED",
            ),
            (
                "a recall scope left in another scenario is discarded too",
                base_artefact(**{"tau2.scenario.recall": "airline"}),
                "DISCARDED",
            ),
            (
                "an unconditioned store abandons: the write path is not the defect",
                base_artefact(**{"tau2.store.conditioned": 0}),
                "ABANDONED",
            ),
            (
                "conditions that do not name the situation abandon the account",
                base_artefact(**{"tau2.coverage.nonzeroQuantiles.p50": 0.0488}),
                "ABANDONED",
            ),
            (
                "a topical median with an emptying pack abandons on the second reading",
                base_artefact(**{"tau2.recall.empty": 400, "tau2.recall.served": 1127}),
                "ABANDONED",
            ),
            (
                "a harm verdict abandons regardless of the census",
                base_artefact(**{"verdict.state": "HARM"}),
                "ABANDONED",
            ),
            (
                "a failed l4-paired treats as harm",
                base_artefact(gates=[{"id": "l4-paired", "pass": False, "blocking": True}]),
                "ABANDONED",
            ),
            (
                "an artefact with no store text certifies nothing about the write path",
                base_artefact(**{"tau2.storeItems": None}),
                "ABANDONED",
            ),
            (
                "a coverage block whose populations disagree abandons",
                base_artefact(**{"tau2.coverage.measuredPairs": 2188}),
                "ABANDONED",
            ),
            (
                "an absent census is a non-measurement, never a zero",
                {"id": "poc-l4", "metrics": {"k": 4, "tasks": 50}, "tau2": {"recall": {"requests": 10}}},
                "NO_MEASUREMENT",
            ),
            (
                "a pre-R54 artefact without a scenario block is still graded",
                base_artefact(**{"tau2.scenario": None}),
                "GRADED",
            ),
            (
                "a failed distiller certifies nothing",
                base_artefact(**{"tau2.learning.distillFailed": 1}),
                "ABANDONED",
            ),
            (
                "the wrong sample size is not this registration",
                base_artefact(**{"metrics.tasks": 115}),
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
