#!/usr/bin/env python3
"""R49 readback: grade the paired-facade artefact against its registration.

The registration is `prereg/R49-within-run-pair.md`: eight predictions and
seven refutations. This verifier checks them mechanically so a reader does not
have to hold eight claims in their head, and so a run that violated the design
cannot be read as a result by accident.

A ninth prediction grades the write path's own census when the artefact reports
one (`tau2.writeAdmission`). It is `n/a` on every artefact written before the
switch existed, because "this run never asked" and "this run asked and refused
nothing" are different facts and only one of them is evidence.

Three outcomes are possible for the arm, and they are not interchangeable:

  GRADED            every prediction holds and no refutation fires. A delta is
                    printed only if the artefact's own state is PAIRED.
  NO_MEASUREMENT    the registered pre-flight refused, or the pair reports that
                    it did not measure. Nothing is claimed.
  ABANDONED         a refutation fired. The design was violated, so there is no
                    contribution to report -- not even a null one.

Usage:
  python3 r49-readback.py --dir <extracted-arm-dir> [--prereg-hash <sha256>]
  python3 r49-readback.py --self-test
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

TERMINAL_STATES = ("PAIRED", "REFUSED_CROSS_RUN", "NO_MEASUREMENT")
STORE_FINGERPRINT_PREFIX = "store:"


class Report:
    def __init__(self) -> None:
        self.predictions: list[tuple[str, bool, str]] = []
        self.refutations: list[tuple[str, bool, str]] = []

    def predict(self, name: str, ok: bool | None, detail: str = "") -> None:
        """`ok=None` means the prediction does not apply to this terminal state."""
        self.predictions.append((name, None if ok is None else bool(ok), detail))

    def refute(self, name: str, fired: bool, detail: str = "") -> None:
        self.refutations.append((name, bool(fired), detail))

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
        return "\n".join(lines)


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def revert_fields(pair: dict[str, Any]) -> list[str]:
    """Keys that would mean the facade contrast was handed to the R45 revert rule.

    Scanning the serialised document for the word is wrong: the artefact's own
    notes explain that no revert rule is consulted, and a substring match reads
    that sentence as the defect it denies.
    """
    found = [key for key in pair if "revert" in key.lower()]
    verdict = pair.get("verdict") or {}
    contrast = verdict.get("contrast") or {}
    for container in (verdict, contrast):
        if isinstance(container, dict):
            found += [key for key in container if "revert" in key.lower()]
    return found


def grade(pair: dict[str, Any], main: dict[str, Any], *, arms_written: bool) -> tuple[Report, str]:
    """Return the report and the terminal verdict."""
    report = Report()
    state = pair.get("state")
    verdict = pair.get("verdict") or {}
    contrast = verdict.get("contrast") or {}
    comparison = contrast.get("comparison") or {}
    scope = pair.get("scope") or {}
    served = pair.get("servedPacks") or {}
    floors = pair.get("floors") or {}
    metrics = main.get("metrics") or {}
    gates = main.get("samples") or []
    per_task = main.get("per_task")

    # --- P1: one attested scope, and a contrast the revert rule cannot read ---
    report.predict(
        "P1 the pair carries a contrast tagged facade-contrast with no scope field",
        state != "PAIRED" or (contrast.get("kind") == "facade-contrast" and "scope" not in contrast),
        f"kind={contrast.get('kind')!r} scope_in_contrast={'scope' in contrast}",
    )

    # --- P2: both facades scored exactly the same task ids ---
    if state == "PAIRED":
        paired = comparison.get("paired")
        task_count = len(per_task) if isinstance(per_task, list) else None
        report.predict(
            "P2 onlyFirst and onlySecond are zero and paired equals the held-out count",
            paired == task_count and comparison.get("onlyFirst") == 0 and comparison.get("onlySecond") == 0 and bool(paired),
            f"paired={paired} held_out={task_count} onlyFirst={comparison.get('onlyFirst')} onlySecond={comparison.get('onlySecond')}",
        )
    else:
        report.predict("P2 onlyFirst and onlySecond are zero and paired equals the held-out count", None,
                       f"not applicable: the run is {state}")

    # --- P3: both facades served at least one pack ---
    delivered = pair.get("treatmentDelivered")
    report.predict(
        "P3 both facades served at least one pack, so treatmentDelivered is true",
        None if state != "PAIRED" else (delivered is True and served.get("asIs", 0) > 0 and served.get("floored", 0) > 0),
        f"asIs={served.get('asIs')} floored={served.get('floored')} delivered={delivered}",
    )

    # --- P4: a positive floor can only shrink a pack ---
    report.predict(
        "P4 the floored facade serves fewer or equal packs than the as-is facade",
        None if state != "PAIRED" else (
            _is_number(served.get("floored")) and _is_number(served.get("asIs")) and served["floored"] <= served["asIs"]
        ),
        f"floored={served.get('floored')} asIs={served.get('asIs')}",
    )

    # --- P5: the artefact exists, states a terminal state, and names its floor ---
    report.predict(
        "P5 the pair artefact states a registered terminal state and both floors",
        state in TERMINAL_STATES and floors.get("asIs") == 0 and _is_number(floors.get("floored")),
        f"state={state!r} floors={floors}",
    )

    # --- P6: the main artefact still grades memory against the reference ---
    gate_ids = {gate.get("id") for gate in gates if isinstance(gate, dict)}
    report.predict(
        "P6 the main artefact still carries the l4-paired gate and the pair carries no revert input",
        "l4-paired" in gate_ids and not revert_fields(pair),
        f"gates={sorted(g for g in gate_ids if isinstance(g, str))}",
    )

    # --- P7: the new gate mirrors the paired state and passes for PAIRED / NO_MEASUREMENT ---
    facade_gate = next((gate for gate in gates if isinstance(gate, dict) and gate.get("id") == "l4-facade-pair"), None)
    report.predict(
        "P7 the l4-facade-pair gate exists, mirrors the state and passes unless the pair was refused",
        facade_gate is not None
        and facade_gate.get("actual") == state
        and facade_gate.get("pass") == (state != "REFUSED_CROSS_RUN"),
        f"gate={facade_gate}",
    )

    # --- P8: the pre-flight either passed or stopped the lane explicitly ---
    stopped = metrics.get("status_no_measurement")
    report.predict(
        "P8 the pre-flight either measured or left status_no_measurement=1 with status_not_run=0",
        (stopped == 1 and metrics.get("status_not_run") == 0) or stopped is None,
        f"status_no_measurement={stopped} status_not_run={metrics.get('status_not_run')}",
    )

    # --- P9: the write path reports a census that agrees with its own switch ---
    tau2 = main.get("tau2") if isinstance(main.get("tau2"), dict) else {}
    census = tau2.get("writeAdmission") if isinstance(tau2, dict) else None
    if not isinstance(census, dict):
        report.predict(
            "P9 the write path reports a census consistent with the mode it states",
            None,
            "not reported: this artefact predates the write-admission switch",
        )
    else:
        mode = census.get("mode")
        rephrased = census.get("rephrased")
        suppressed = census.get("suppressed")
        # `off` with refusals is not a weak result, it is a contradiction: the store
        # cannot have refused a write it was never allowed to judge.
        consistent = (
            mode in ("off", "neighbours")
            and _is_number(rephrased)
            and _is_number(suppressed)
            and rephrased >= 0
            and suppressed >= 0
            and (mode != "off" or (rephrased == 0 and suppressed == 0))
        )
        report.predict(
            "P9 the write path reports a census consistent with the mode it states",
            consistent,
            f"mode={mode!r} rephrased={rephrased} suppressed={suppressed}",
        )

    # --- refutations ---
    scope_fields = ("dispatchId", "preregId", "learnSplit", "testSplit", "seed", "trials", "model")
    missing = [field for field in scope_fields if not scope.get(field)]
    fingerprint = scope.get("storeFingerprint") or ""
    report.refute(
        "the two facades carry different scope values (defect 29 reproduced)",
        bool(missing) or not str(fingerprint).startswith(STORE_FINGERPRINT_PREFIX),
        f"missing={missing} fingerprint={fingerprint!r}",
    )

    held_out = scope.get("testSplit") if isinstance(scope.get("testSplit"), list) else []
    report.refute(
        "either facade scores no task, or the two facades do not score the same ids",
        state == "PAIRED" and (comparison.get("paired") != len(held_out) or not held_out),
        f"paired={comparison.get('paired')} testSplit={len(held_out)}",
    )

    report.refute(
        "the floored facade served zero packs, so the treatment never arrived",
        state == "PAIRED" and served.get("floored") == 0,
        f"floored={served.get('floored')}",
    )

    reason = str(verdict.get("reason") or "").lower()
    # The registered refusal names the provider or the pre-flight. `stopped == 1`
    # alone is not evidence: any refusal writes it, and accepting that would make
    # this refutation unfalsifiable.
    provider_marker = stopped == 1 and ("pre-flight" in reason or "provider" in reason)
    report.refute(
        "NO_MEASUREMENT was reported for a reason other than the registered pre-flight refusal",
        state == "NO_MEASUREMENT" and not provider_marker,
        f"state={state} status_no_measurement={stopped}",
    )

    report.refute(
        "the pair artefact is absent while both arms wrote their artefacts",
        arms_written and state is None,
        f"arms_written={arms_written}",
    )

    report.refute(
        "a Pass^4 number is quoted as the floor's contribution",
        "pass^4" in str(pair.get("summary", "")).lower() or "pass4" in json.dumps(contrast).lower(),
        str(pair.get("summary", ""))[:120],
    )

    report.refute(
        "the facade contrast was fed to the R45 revert rule",
        bool(revert_fields(pair)),
        f"keys={revert_fields(pair)}",
    )

    if report.refutation_fired:
        return report, "ABANDONED"
    if state == "NO_MEASUREMENT":
        return report, "NO_MEASUREMENT"
    if state == "REFUSED_CROSS_RUN":
        return report, "ABANDONED"
    if state == "PAIRED" and report.predictions_ok:
        return report, "GRADED"
    return report, "ABANDONED"


def load(directory: Path) -> tuple[dict[str, Any], dict[str, Any], bool]:
    pair_path = directory / "poc-l4-facade-pair.json"
    main_path = directory / "poc-l4.json"
    if not main_path.exists():
        raise SystemExit(f"no poc-l4.json in {directory}")
    main = json.loads(main_path.read_text(encoding="utf-8"))
    pair = json.loads(pair_path.read_text(encoding="utf-8")) if pair_path.exists() else {}
    arms = any((directory / name).exists() for name in ("poc-l4-reference.json", "poc-l4-facade-pair.json"))
    return pair, main, arms


def print_report(pair: dict[str, Any], report: Report, verdict: str) -> None:
    print(report.render())
    print()
    if verdict == "GRADED":
        comparison = (pair.get("verdict") or {}).get("contrast", {}).get("comparison", {})
        print(
            "RESULT GRADED: floor {floor} contributed {delta:+.2f}pp [{low:+.2f}, {high:+.2f}] "
            "at p={p:.4f} over n={n}".format(
                floor=(pair.get("floors") or {}).get("floored"),
                delta=comparison.get("deltaPp", 0.0),
                low=comparison.get("ciLowPp", 0.0),
                high=comparison.get("ciHighPp", 0.0),
                p=comparison.get("p", 1.0),
                n=comparison.get("paired", 0),
            )
        )
        print(f"summary: {pair.get('summary')}")
    elif verdict == "NO_MEASUREMENT":
        print(f"RESULT NO_MEASUREMENT: {((pair.get('verdict') or {}).get('reason'))}")
    else:
        print("RESULT ABANDONED: a refutation fired or a prediction failed; no contribution is reported.")


def self_test(fixture: Path) -> int:
    """Prove the verifier fails when it should. Every case is a mutation of a real artefact."""
    base_pair = json.loads((fixture / "poc-l4-facade-pair.json").read_text(encoding="utf-8"))
    base_main = json.loads((fixture / "poc-l4.json").read_text(encoding="utf-8"))
    failures: list[str] = []

    def case(name: str, expect: str, pair: dict[str, Any] | None = None, main: dict[str, Any] | None = None, arms: bool = True) -> None:
        got_pair = json.loads(json.dumps(base_pair if pair is None else pair))
        got_main = json.loads(json.dumps(base_main if main is None else main))
        report, verdict = grade(got_pair, got_main, arms_written=arms)
        if verdict != expect:
            failures.append(f"{name}: expected {expect}, got {verdict}\n{report.render()}")
        else:
            print(f"  ok   {name} -> {verdict}")

    print("self-test:")
    case("a clean PAIRED artefact grades", "GRADED")

    # The census is `n/a` above because the fixture predates the switch; these two
    # cases are the ones that make it a prediction rather than a paragraph.
    measured = json.loads(json.dumps(base_main))
    measured.setdefault("tau2", {})["writeAdmission"] = {
        "mode": "neighbours",
        "rephrased": 2,
        "suppressed": 5,
    }
    case("a write census that agrees with its switch grades", "GRADED", main=measured)

    contradicted = json.loads(json.dumps(base_main))
    contradicted.setdefault("tau2", {})["writeAdmission"] = {
        "mode": "off",
        "rephrased": 0,
        "suppressed": 3,
    }
    case("an off switch that refused three writes abandons", "ABANDONED", main=contradicted)

    mutated = json.loads(json.dumps(base_pair))
    mutated["scope"]["dispatchId"] = ""
    case("a blank dispatchId abandons", "ABANDONED", pair=mutated)

    mutated = json.loads(json.dumps(base_pair))
    mutated["scope"]["storeFingerprint"] = ""
    case("a missing store fingerprint abandons", "ABANDONED", pair=mutated)

    mutated = json.loads(json.dumps(base_pair))
    mutated["servedPacks"]["floored"] = 0
    case("a floored facade that served nothing abandons", "ABANDONED", pair=mutated)

    mutated = json.loads(json.dumps(base_pair))
    mutated["servedPacks"]["floored"] = 5
    mutated["servedPacks"]["asIs"] = 2
    case("a floored facade serving MORE than as-is fails P4", "ABANDONED", pair=mutated)

    mutated = json.loads(json.dumps(base_pair))
    mutated["verdict"]["contrast"]["comparison"]["paired"] = 3
    case("a mismatched paired count abandons", "ABANDONED", pair=mutated)

    mutated = json.loads(json.dumps(base_pair))
    mutated["verdict"]["contrast"]["scope"] = {"dispatchId": "x"}
    case("a contrast carrying a scope abandons", "ABANDONED", pair=mutated)

    mutated = json.loads(json.dumps(base_pair))
    mutated["__revert"] = True
    case("a revert input on the pair abandons", "ABANDONED", pair=mutated)

    mutated = json.loads(json.dumps(base_main))
    mutated["samples"] = [g for g in mutated["samples"] if g.get("id") != "l4-facade-pair"]
    case("a missing l4-facade-pair gate abandons", "ABANDONED", main=mutated)

    mutated = json.loads(json.dumps(base_main))
    mutated["samples"] = [g for g in mutated["samples"] if g.get("id") != "l4-paired"]
    case("a missing l4-paired gate abandons", "ABANDONED", main=mutated)

    stopped = {
        "state": "NO_MEASUREMENT",
        "verdict": {"state": "NO_MEASUREMENT", "reason": "the provider answered 5xx on every pre-flight call"},
        "scope": base_pair["scope"],
        "servedPacks": {"asIs": 0, "floored": 0},
        "floors": {"asIs": 0, "floored": 0.01},
        "treatmentDelivered": False,
        "summary": "NO_MEASUREMENT: the provider answered 5xx on every pre-flight call",
    }
    stopped_main = json.loads(json.dumps(base_main))
    stopped_main["metrics"] = {"status_no_measurement": 1, "status_not_run": 0}
    stopped_main.pop("per_task", None)
    stopped_main["samples"] = [
        {"id": "l4-paired", "pass": False, "actual": "n/a", "criterion": "x"},
        {"id": "l4-facade-pair", "pass": True, "actual": "NO_MEASUREMENT", "criterion": "x"},
    ]
    case("a provider stop reports NO_MEASUREMENT", "NO_MEASUREMENT", pair=stopped, main=stopped_main)

    unregistered = dict(stopped)
    unregistered["verdict"] = {"state": "NO_MEASUREMENT", "reason": "the store was empty"}
    case("an unregistered stop reason abandons", "ABANDONED", pair=unregistered, main=stopped_main)

    case("a missing pair artefact with both arms written abandons", "ABANDONED", pair={}, arms=True)

    if failures:
        print("\nSELF-TEST FAILED")
        for failure in failures:
            print(failure)
        return 1
    print("\nSELF-TEST PASSED")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Grade the R49 paired-facade artefact.")
    parser.add_argument("--dir", type=Path, help="directory holding the extracted arm artefacts")
    parser.add_argument("--fixture", type=Path, default=Path(__file__).resolve().parents[1] / "fixtures" / "r49-verifier")
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--json", action="store_true", help="emit the report as JSON")
    args = parser.parse_args()

    if args.self_test:
        return self_test(args.fixture)
    if args.dir is None:
        parser.error("--dir is required unless --self-test is given")

    pair, main, arms = load(args.dir)
    report, verdict = grade(pair, main, arms_written=arms)
    if args.json:
        print(
            json.dumps(
                {
                    "verdict": verdict,
                    "predictions": [{"name": n, "ok": o, "detail": d} for n, o, d in report.predictions],
                    "refutations": [{"name": n, "fired": f, "detail": d} for n, f, d in report.refutations],
                    "summary": pair.get("summary"),
                },
                indent=2,
            )
        )
    else:
        print_report(pair, report, verdict)
    return 0 if verdict == "GRADED" else (2 if verdict == "ABANDONED" else 3)


if __name__ == "__main__":
    sys.exit(main())
