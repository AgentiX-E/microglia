#!/usr/bin/env python3
"""The evaluation's independent reading of R248's competition-domain gate.

The product's classifier lives in `packages/core/src/apply/competition-domain.ts` and is pinned by vitest. A second
reader that merely transcribed the manifest would agree for the wrong reason — both could share the same mistake.
This tool re-derives every verdict and reason from the fixture's bytes with an implementation that shares no code
with TypeScript. The rule comes from the project's scope boundary (R248): microglia competes in memory-augmented
task success; NL2SQL / chart / data-viz belong to nl2charts, where microglia is only the memory amplifier.

    python3 eval/tools/competition_domain.py --build                    # regenerate the manifest from the fixture
    python3 eval/tools/competition_domain.py --check                    # the manifest's own arithmetic is consistent
    python3 eval/tools/competition_domain.py --verify                   # re-derive from the fixture and compare fields
    python3 eval/tools/competition_domain.py --self-test                # boundaries, determinism, tamper detection

`--manifest` and `--fixture` redirect every mode, so the self-test can drive distinct tampers against temporary
files without touching the committed pair.

What this establishes: a measured memory gain is microglia's unit wherever it is taken; an absolute host-task score
belongs to nl2charts; a tie is ambiguous, never auto-assigned. No model was called here.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import sys
import tempfile
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "eval" / "fixtures" / "competition-domain.json"
MANIFEST = ROOT / "eval" / "manifests" / "competition-domain.json"

SCHEMA = "microglia/competition-domain@1"
FIXTURE_SCHEMA = "microglia/competition-domain-candidates@1"
VERDICTS = ("memory", "host", "ambiguous", "other")
REASONS = ("measured-memory-gain", "memory-benchmark", "host-task-score", "host-artifact", "mixed-signals", "no-signal")
UNITS = ("memory-gain", "absolute-task-score", "unknown")
HOST_ARTIFACTS = ("sql-query", "chart", "visualization")
ARTIFACTS = ("memory-pack", "sql-query", "chart", "visualization", "report", "other")
MEMORY_SIGNALS = frozenset((
    "longmemeval", "locomo", "memoryagentbench", "beam", "dolphinbench", "ama-bench",
    "memory-recall", "cross-session-recall", "episodic-memory", "semantic-memory", "knowledge-update",
    "temporal-reasoning",
))
HOST_SIGNALS = frozenset((
    "bird-ex", "spider-ex", "nl2sql-ex", "text2sql-ex", "chart-accuracy", "data2chart",
    "execution-accuracy", "schema-linking",
))


class Refusal(Exception):
    """A fixture or manifest this reader will not interpret."""


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_json(path: Path, label: str) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise Refusal(f"cannot read {label}: {exc}") from exc
    if not isinstance(value, dict):
        raise Refusal(f"{label} must be an object")
    return value


def classify(candidate: dict) -> dict:
    """Re-derive one domain decision from a candidate's bytes. No shared code with the product."""
    name = candidate.get("name")
    if not isinstance(name, str) or name.strip() == "":
        raise Refusal(f"candidate name must be a non-blank string: {name!r}")
    measures = candidate.get("measures")
    if not isinstance(measures, list):
        raise Refusal(f"candidate {name}: measures must be an array")
    for label in measures:
        if not isinstance(label, str):
            raise Refusal(f"candidate {name}: measure labels must be strings")
    artifact = candidate.get("artifact")
    if not isinstance(artifact, str) or artifact not in ARTIFACTS:
        raise Refusal(f"candidate {name}: unknown artifact {artifact!r}")
    unit = candidate.get("unit")
    if not isinstance(unit, str) or unit not in UNITS:
        raise Refusal(f"candidate {name}: unknown unit {unit!r}")

    memory_signals = 0
    host_measure_signals = 0
    for raw in measures:
        label = raw.lower()
        if label in MEMORY_SIGNALS:
            memory_signals += 1
        if label in HOST_SIGNALS:
            host_measure_signals += 1
    host_artifact = artifact in HOST_ARTIFACTS
    host_signals = host_measure_signals + (1 if host_artifact else 0)

    if unit == "memory-gain":
        verdict, reason = "memory", "measured-memory-gain"
        amplifier = host_artifact or host_measure_signals > 0
    elif unit == "absolute-task-score":
        amplifier = False
        if host_measure_signals > 0:
            verdict, reason = "host", "host-task-score"
        elif host_artifact:
            verdict, reason = "host", "host-artifact"
        elif memory_signals > 0:
            verdict, reason = "memory", "memory-benchmark"
        else:
            verdict, reason = "other", "no-signal"
    elif memory_signals > 0 and host_signals > 0:
        verdict, reason, amplifier = "ambiguous", "mixed-signals", False
    elif memory_signals > 0:
        verdict, reason, amplifier = "memory", "memory-benchmark", False
    elif host_signals > 0:
        verdict, reason, amplifier = "host", ("host-task-score" if host_measure_signals > 0 else "host-artifact"), False
    else:
        verdict, reason, amplifier = "other", "no-signal", False

    return {
        "verdict": verdict,
        "reason": reason,
        "amplifierRole": amplifier,
        "name": name,
        "unit": unit,
        "memorySignals": memory_signals,
        "hostSignals": host_signals,
    }


def build(fixture: dict) -> dict:
    """Derive the manifest from fixture bytes, adding only self-check arithmetic."""
    if fixture.get("schema") != FIXTURE_SCHEMA:
        raise Refusal(f"unexpected fixture schema: {fixture.get('schema')!r}")
    cases = fixture.get("cases")
    if not isinstance(cases, list) or not cases:
        raise Refusal("fixture cases must be a non-empty list")
    readings: list[dict] = []
    by_id: set[str] = set()
    for case in cases:
        case_id = case.get("id")
        if not isinstance(case_id, str) or case_id == "":
            raise Refusal("every case needs an id")
        if case_id in by_id:
            raise Refusal(f"duplicate case id: {case_id}")
        by_id.add(case_id)
        candidate = case.get("candidate")
        if not isinstance(candidate, dict):
            raise Refusal(f"case {case_id}: candidate must be an object")
        readings.append({"id": case_id, "expected": classify(candidate)})
    return {"schema": SCHEMA, "fixtureSchema": fixture.get("schema"), "cases": readings}


def check(manifest: dict) -> None:
    """Re-add the manifest's own arithmetic without reading the fixture."""
    if manifest.get("schema") != SCHEMA:
        raise Refusal(f"unexpected manifest schema: {manifest.get('schema')!r}")
    cases = manifest.get("cases")
    if not isinstance(cases, list) or not cases:
        raise Refusal("manifest cases must be a non-empty list")
    seen: set[str] = set()
    for entry in cases:
        case_id = entry.get("id")
        if not isinstance(case_id, str) or case_id in seen:
            raise Refusal(f"duplicate or missing case id: {case_id!r}")
        seen.add(case_id)
        exp = entry.get("expected")
        if not isinstance(exp, dict):
            raise Refusal(f"case {case_id}: expected must be an object")
        if exp.get("verdict") not in VERDICTS:
            raise Refusal(f"case {case_id}: unknown verdict")
        if exp.get("reason") not in REASONS:
            raise Refusal(f"case {case_id}: unknown reason")
        if not isinstance(exp.get("amplifierRole"), bool):
            raise Refusal(f"case {case_id}: amplifierRole must be a boolean")
        if not isinstance(exp.get("name"), str) or not isinstance(exp.get("unit"), str):
            raise Refusal(f"case {case_id}: name/unit must be strings")
        ms, hs = exp.get("memorySignals"), exp.get("hostSignals")
        if not (isinstance(ms, int) and not isinstance(ms, bool) and ms >= 0):
            raise Refusal(f"case {case_id}: memorySignals invalid")
        if not (isinstance(hs, int) and not isinstance(hs, bool) and hs >= 0):
            raise Refusal(f"case {case_id}: hostSignals invalid")
        # Verdict must be a pure function of the unit and the two signal counts. The reason's host-artifact vs
        # host-task-score nuance depends on the artifact, which the manifest does not carry, so that finer check
        # belongs to verify() against the fixture bytes; here only the decidable verdict ladder is re-added.
        unit = exp["unit"]
        if unit == "memory-gain":
            derived = "memory"
        elif unit == "absolute-task-score":
            if exp["hostSignals"] > 0:
                derived = "host"
            elif exp["memorySignals"] > 0:
                derived = "memory"
            else:
                derived = "other"
        elif exp["memorySignals"] > 0 and exp["hostSignals"] > 0:
            derived = "ambiguous"
        elif exp["memorySignals"] > 0:
            derived = "memory"
        elif exp["hostSignals"] > 0:
            derived = "host"
        else:
            derived = "other"
        if exp["verdict"] != derived:
            raise Refusal(f"case {case_id}: verdict disagrees with the ladder")


def verify(fixture: dict, manifest: dict) -> None:
    """Re-derive from fixture bytes and compare every field against the manifest."""
    derived = build(fixture)
    if derived.get("fixtureSchema") != manifest.get("fixtureSchema"):
        raise Refusal("fixture schema drift between derivation and manifest")
    if len(derived["cases"]) != len(manifest.get("cases", [])):
        raise Refusal("case count drift")
    for left, right in zip(derived["cases"], manifest["cases"]):
        if left["id"] != right["id"]:
            raise Refusal(f"case order drift: {left['id']} vs {right['id']}")
        expected = right.get("expected")
        if not isinstance(expected, dict):
            raise Refusal(f"case {right['id']}: expected missing")
        for key, value in left["expected"].items():
            if expected.get(key) != value:
                raise Refusal(f"case {right['id']}: {key} drifted")


def self_test(fixture_path: Path, manifest_path: Path) -> int:
    """Drive every refusal, boundary and tamper path with temporary files. Returns the assertion count."""
    assertions = 0

    def ok(condition: bool, label: str) -> None:
        nonlocal assertions
        assertions += 1
        if not condition:
            raise Refusal(f"self-test failed: {label}")

    fixture = load_json(fixture_path, "fixture")
    manifest = load_json(manifest_path, "manifest")
    built = build(fixture)
    check(built)
    verify(fixture, built)
    ok(built["schema"] == SCHEMA, "built schema")
    ok(len(built["cases"]) == len(fixture["cases"]), "built case count")

    covered_v = {e["expected"]["verdict"] for e in built["cases"]}
    covered_r = {e["expected"]["reason"] for e in built["cases"]}
    for v in VERDICTS:
        ok(v in covered_v, f"verdict {v} reachable")
    for r in REASONS:
        ok(r in covered_r, f"reason {r} reachable")
    ok(any(e["expected"]["amplifierRole"] for e in built["cases"]), "amplifier role reachable")

    # The deciding unit.
    gain = classify({"name": "x", "measures": ["bird-ex"], "artifact": "sql-query", "unit": "memory-gain"})
    ok(gain["verdict"] == "memory" and gain["amplifierRole"], "memory gain in a host is amplifier")
    absolute = classify({"name": "x", "measures": ["bird-ex"], "artifact": "sql-query", "unit": "absolute-task-score"})
    ok(absolute["verdict"] == "host" and absolute["reason"] == "host-task-score", "absolute host score")
    tie = classify({"name": "x", "measures": ["longmemeval", "bird-ex"], "artifact": "memory-pack", "unit": "unknown"})
    ok(tie["verdict"] == "ambiguous", "tie is ambiguous")
    # Case-insensitive label matching.
    upper = classify({"name": "x", "measures": ["LongMemEval"], "artifact": "memory-pack", "unit": "unknown"})
    ok(upper["verdict"] == "memory", "label matching is case-insensitive")
    ok(upper["memorySignals"] == 1, "one memory signal counted")

    def refuse(function, label: str) -> None:
        try:
            function()
            ok(False, f"refusal expected: {label}")
        except Refusal:
            ok(True, f"refusal raised: {label}")

    refuse(lambda: classify({"name": "  ", "measures": [], "artifact": "memory-pack", "unit": "unknown"}), "blank name")
    refuse(lambda: classify({"name": "x", "measures": "s", "artifact": "memory-pack", "unit": "unknown"}), "measures not array")
    refuse(lambda: classify({"name": "x", "measures": [1], "artifact": "memory-pack", "unit": "unknown"}), "non-string label")
    refuse(lambda: classify({"name": "x", "measures": [], "artifact": "sql-ddl", "unit": "unknown"}), "unknown artifact")
    refuse(lambda: classify({"name": "x", "measures": [], "artifact": "memory-pack", "unit": "maybe"}), "unknown unit")

    with tempfile.TemporaryDirectory() as directory:
        temp = Path(directory)
        not_object = temp / "not-object.json"
        bad_json = temp / "bad.json"
        wrong_schema = temp / "wrong-schema.json"
        not_object.write_text("[]", encoding="utf-8")
        bad_json.write_text("{", encoding="utf-8")
        wrong_schema.write_text(json.dumps({"schema": "other"}), encoding="utf-8")
        for path, label in ((not_object, "object"), (bad_json, "json"), (wrong_schema, "schema")):
            refuse(lambda p=path, l=label: load_json(p, l), f"loader refusal for {label}")
        refuse(lambda: build({"schema": "other", "cases": []}), "build wrong fixture schema")
        for bad_fixture in (
            {"schema": FIXTURE_SCHEMA, "cases": []},
            {"schema": FIXTURE_SCHEMA, "cases": [{"id": "x"}]},
            {"schema": FIXTURE_SCHEMA, "cases": [{"id": "x", "candidate": 1}, {"id": "x", "candidate": {}}]},
        ):
            refuse(lambda f=bad_fixture: build(f), f"build refuses malformed fixture {bad_fixture!r}")

        tampered = json.loads(json.dumps(built))
        tampered["cases"][0]["expected"]["verdict"] = "memory"
        refuse(lambda: check(tampered), "check refuses verdict drift")
        tampered = json.loads(json.dumps(built))
        tampered["cases"][0]["expected"]["reason"] = "no-signal"
        refuse(lambda: check(tampered), "check refuses reason drift")
        tampered = json.loads(json.dumps(built))
        tampered["cases"][0]["expected"]["amplifierRole"] = "yes"
        refuse(lambda: check(tampered), "check refuses amplifier type drift")
        tampered = json.loads(json.dumps(built))
        tampered["cases"][0]["expected"]["memorySignals"] = -1
        refuse(lambda: check(tampered), "check refuses negative signal count")
        tampered = json.loads(json.dumps(built))
        tampered["cases"][0]["id"] = "renamed"
        refuse(lambda: verify(fixture, tampered), "verify refuses case-order drift")
        tampered = json.loads(json.dumps(built))
        tampered["cases"][0]["expected"]["name"] = "changed"
        refuse(lambda: verify(fixture, tampered), "verify refuses field drift")

    refuse(lambda: check({"schema": "other"}), "check schema")
    refuse(lambda: check({"schema": SCHEMA, "cases": []}), "check empty cases")
    refuse(lambda: check({"schema": SCHEMA, "cases": [{}]}), "check missing id")
    refuse(lambda: check({"schema": SCHEMA, "cases": [{"id": "x", "expected": 1}]}), "check expected not object")
    good = built["cases"][0]["expected"]
    refuse(lambda: check({"schema": SCHEMA, "cases": [{"id": "x", "expected": {**good, "verdict": "bogus"}}]}), "check unknown verdict")
    refuse(lambda: check({"schema": SCHEMA, "cases": [{"id": "x", "expected": {**good, "reason": "bogus"}}]}), "check unknown reason")
    refuse(lambda: check({"schema": SCHEMA, "cases": [{"id": "x", "expected": {**good, "name": 1}}]}), "check name type")
    refuse(lambda: check({"schema": SCHEMA, "cases": [{"id": "x", "expected": {**good, "memorySignals": 0.5}}]}), "check signal type")
    refuse(lambda: verify({"schema": "other", "cases": []}, built), "verify fixture schema drift")
    refuse(lambda: verify({"schema": FIXTURE_SCHEMA, "cases": []}, built), "verify case count drift")
    missing = json.loads(json.dumps(built))
    del missing["cases"][0]["expected"]
    refuse(lambda: verify(fixture, missing), "verify expected missing")
    drift = json.loads(json.dumps(built))
    drift["fixtureSchema"] = "other"
    refuse(lambda: verify(fixture, drift), "verify fixture schema field drift")

    def quiet(argv: list[str]) -> int:
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            return main(argv)

    with tempfile.TemporaryDirectory() as directory:
        temp = Path(directory)
        built_path = temp / "built.json"
        ok(quiet(["--build", "--fixture", str(fixture_path), "--manifest", str(built_path)]) == 0, "main build prints")
        ok(quiet(["--build", "--write", "--fixture", str(fixture_path), "--manifest", str(built_path)]) == 0, "main build writes")
        ok(built_path.exists(), "main build wrote the manifest")
        ok(quiet(["--check", "--manifest", str(manifest_path)]) == 0, "main check")
        ok(quiet(["--verify", "--manifest", str(manifest_path), "--fixture", str(fixture_path)]) == 0, "main verify")
        ok(quiet([]) == 1, "main rejects no action")
        ok(quiet(["--check", "--verify"]) == 1, "main rejects multiple actions")
        ok(quiet(["--check", "--manifest", str(temp / "missing.json")]) == 1, "main check surfaces refusal")

    check(manifest)
    verify(fixture, manifest)
    ok(sha256(fixture_path) == sha256(fixture_path), "digest is stable")
    return assertions


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--build", action="store_true")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--verify", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--manifest", type=Path, default=MANIFEST)
    parser.add_argument("--fixture", type=Path, default=FIXTURE)
    parser.add_argument("--write", action="store_true", help="with --build, write the manifest to disk")
    arguments = parser.parse_args(argv)
    actions = [arguments.build, arguments.check, arguments.verify, arguments.self_test]
    if sum(1 for action in actions if action) != 1:
        print("exactly one of --build/--check/--verify/--self-test is required", file=sys.stderr)
        return 1
    try:
        if arguments.build:
            result = build(load_json(arguments.fixture, "fixture"))
            if arguments.write:
                arguments.manifest.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            else:
                print(json.dumps(result, ensure_ascii=False, indent=2))
        elif arguments.check:
            check(load_json(arguments.manifest, "manifest"))
            print("check: ok")
        elif arguments.verify:
            verify(load_json(arguments.fixture, "fixture"), load_json(arguments.manifest, "manifest"))
            print("verify: ok")
        else:
            count = self_test(arguments.fixture, arguments.manifest)
            print(f"self-test: {count}/{count} ok")
    except Refusal as exc:
        print(f"refused: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
