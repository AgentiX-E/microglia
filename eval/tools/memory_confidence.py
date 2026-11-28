#!/usr/bin/env python3
"""The evaluation's independent reading of R252's confidence and abstention gate.

The product's judgement lives in `packages/core/src/apply/memory-confidence.ts` and is pinned by vitest. A second
reader that merely transcribed the manifest would agree for the wrong reason — both could share the same mistake.
This tool re-derives every verdict, reason, deciding id, count and deciding score from an episode's bytes with an
implementation that shares no code with TypeScript. The scoring follows MMA's Confidence Module
(arXiv 2602.16493, github.com/AIGeeksGroup/MMA confidence_module.py, compute_v2 tri mode): source credibility,
half-life temporal decay and conflict-aware signed consensus combine in a self-normalising weighted sum; support
insufficient -> abstain.

    python3 eval/tools/memory_confidence.py --build                        # regenerate the manifest from the fixture
    python3 eval/tools/memory_confidence.py --check                        # the manifest's own arithmetic is consistent
    python3 eval/tools/memory_confidence.py --verify                       # re-derive from the fixture and compare fields
    python3 eval/tools/memory_confidence.py --self-test                    # boundaries, determinism, tamper detection

`--manifest` and `--fixture` redirect every mode, so the self-test can drive distinct tampers against temporary
files without touching the committed pair. No model was called here.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import sys
import tempfile
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "eval" / "fixtures" / "memory-confidence.json"
MANIFEST = ROOT / "eval" / "manifests" / "memory-confidence.json"

SOURCES = ("knowledge", "semantic", "procedural", "resource", "episodic")
CREDIBILITY = {"knowledge": 0.95, "semantic": 0.70, "procedural": 0.60, "resource": 0.60, "episodic": 0.50}
DISPOSITIONS = ("admit", "reweight", "abstain")
REASONS = ("reliable", "marginal", "below-threshold", "conflict-overwhelms")
SEVERITY = {"reliable": 0, "marginal": 1, "below-threshold": 2, "conflict-overwhelms": 3}


class Refusal(Exception):
    pass


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_json(path: Path, label: str) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf8"))
    except (OSError, ValueError) as error:
        raise Refusal(f"{label} is not readable JSON: {error}")
    if not isinstance(data, dict):
        raise Refusal(f"{label} must be a JSON object")
    return data


def nonblank(value) -> bool:
    return isinstance(value, str) and value.strip() != ""


def finite(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def milli(confidence: float) -> int:
    """Match JS Math.round (half up); Python's round is banker's and would disagree at .5."""
    return int(confidence * 1000 + 0.5)


def audit(inp: dict) -> dict:
    """Re-derive one episode's reading from its bytes. Refuses rather than defaults on any defect."""
    if not nonblank(inp.get("id")):
        raise Refusal("episode id must be non-blank")

    weights = inp.get("weights")
    if not isinstance(weights, dict) or isinstance(weights, list):
        raise Refusal("weights must be an object")
    for key in ("source", "time", "consensus"):
        value = weights.get(key)
        if not finite(value) or value < 0:
            raise Refusal(f"weight {key} must be non-negative finite")
    if weights["source"] + weights["time"] + weights["consensus"] <= 0:
        raise Refusal("weights must not all be zero")

    half = inp.get("halfLifeDays")
    if not finite(half) or half <= 0:
        raise Refusal("halfLifeDays must be positive finite")
    abstain = inp.get("abstainBelow")
    if not finite(abstain) or abstain < 0 or abstain > 1:
        raise Refusal("abstainBelow must be within [0, 1]")
    reweight = inp.get("reweightBelow")
    if not finite(reweight) or reweight < abstain or reweight > 1:
        raise Refusal("reweightBelow must be within [abstainBelow, 1]")

    items = inp.get("items")
    if not isinstance(items, list):
        raise Refusal("items must be an array")
    if len(items) == 0:
        raise Refusal("items must not be empty")

    seen: set[str] = set()
    admit = reweight_n = abstain_n = 0
    verdict = "admit"
    reason = "reliable"
    deciding_id = ""
    deciding_milli = -1
    deciding_severity = -1

    for item in items:
        if not isinstance(item, dict):
            raise Refusal("every item must be an object")
        item_id = item.get("id")
        if not nonblank(item_id):
            raise Refusal("item id must be non-blank")
        if item_id in seen:
            raise Refusal(f"duplicate item id {item_id}")
        seen.add(item_id)
        source = item.get("source")
        if not isinstance(source, str) or source not in CREDIBILITY:
            raise Refusal(f"unknown source {source}")
        age = item.get("ageDays")
        if not finite(age) or age < 0:
            raise Refusal("ageDays must be non-negative finite")
        neighbors = item.get("neighbors")
        if not isinstance(neighbors, list):
            raise Refusal("neighbors must be an array")
        for neighbor in neighbors:
            if not isinstance(neighbor, dict):
                raise Refusal("every neighbor must be an object")
            if not finite(neighbor.get("weight")) or neighbor["weight"] <= 0:
                raise Refusal("neighbor weight must be positive finite")
            if not finite(neighbor.get("confidence")) or not 0 <= neighbor["confidence"] <= 1:
                raise Refusal("neighbor confidence must be within [0, 1]")
            if not finite(neighbor.get("support")) or not -1 <= neighbor["support"] <= 1:
                raise Refusal("neighbor support must be within [-1, 1]")

        s = CREDIBILITY[source]
        t = 0.5 ** (age / half)
        if neighbors:
            weighted = sum(n["weight"] * n["confidence"] * n["support"] for n in neighbors)
            total_weight = sum(n["weight"] for n in neighbors)
            signed = weighted / total_weight
        else:
            signed = 0.0
        total = weights["source"] + weights["time"] + weights["consensus"]
        confidence = max(0.0, (weights["source"] * s + weights["time"] * t + weights["consensus"] * signed) / total)

        if confidence < abstain and signed < 0:
            disp, why = "abstain", "conflict-overwhelms"
        elif confidence < abstain:
            disp, why = "abstain", "below-threshold"
        elif confidence < reweight:
            disp, why = "reweight", "marginal"
        else:
            disp, why = "admit", "reliable"

        if disp == "admit":
            admit += 1
        elif disp == "reweight":
            reweight_n += 1
        else:
            abstain_n += 1

        severity = SEVERITY[why]
        if severity > deciding_severity:
            deciding_severity = severity
            deciding_id = item_id
            deciding_milli = milli(confidence)
            reason, verdict = why, disp

    return {
        "id": inp["id"],
        "verdict": verdict,
        "reason": reason,
        "decidingId": deciding_id,
        "decidingScoreMilli": deciding_milli,
        "itemCount": len(items),
        "admitCount": admit,
        "reweightCount": reweight_n,
        "abstainCount": abstain_n,
    }


def build(fixture: dict) -> dict:
    cases = []
    for case in fixture.get("cases", []):
        if not isinstance(case, dict) or not nonblank(case.get("id")):
            raise Refusal("every fixture case needs a non-blank id")
        cases.append({"id": case["id"], "expected": audit(case["input"])})
    return {"schema": "microglia/memory-confidence@1", "fixtureSchema": fixture.get("schema", ""), "cases": cases}


def check(manifest: dict) -> None:
    if manifest.get("schema") != "microglia/memory-confidence@1":
        raise Refusal("manifest schema mismatch")
    cases = manifest.get("cases")
    if not isinstance(cases, list) or not cases:
        raise Refusal("manifest cases must be a non-empty array")
    for case in cases:
        expected = case.get("expected")
        if not isinstance(expected, dict):
            raise Refusal(f"case {case.get('id')}: expected must be an object")
        if expected.get("verdict") not in DISPOSITIONS:
            raise Refusal(f"case {case.get('id')}: verdict out of family")
        if expected.get("reason") not in REASONS:
            raise Refusal(f"case {case.get('id')}: reason out of family")
        for count in ("itemCount", "admitCount", "reweightCount", "abstainCount"):
            value = expected.get(count)
            if not isinstance(value, int) or isinstance(value, bool) or value < 0:
                raise Refusal(f"case {case.get('id')}: {count} must be a non-negative integer")
        counts = expected["admitCount"] + expected["reweightCount"] + expected["abstainCount"]
        if counts != expected["itemCount"]:
            raise Refusal(f"case {case.get('id')}: counts do not partition itemCount")
        verdict, reason = expected["verdict"], expected["reason"]
        if verdict == "abstain" and reason not in ("below-threshold", "conflict-overwhelms"):
            raise Refusal(f"case {case.get('id')}: abstain reason family mismatch")
        if verdict == "reweight" and reason != "marginal":
            raise Refusal(f"case {case.get('id')}: reweight reason family mismatch")
        if verdict == "admit" and reason != "reliable":
            raise Refusal(f"case {case.get('id')}: admit reason family mismatch")
        if not isinstance(expected.get("decidingScoreMilli"), int) or expected["decidingScoreMilli"] < 0:
            raise Refusal(f"case {case.get('id')}: decidingScoreMilli must be a non-negative integer")


def verify(fixture: dict, manifest: dict) -> None:
    if manifest.get("fixtureSchema") != fixture.get("schema"):
        raise Refusal("manifest does not describe this fixture")
    cases = fixture.get("cases", [])
    declared = manifest.get("cases", [])
    if len(cases) != len(declared):
        raise Refusal("case count drift between fixture and manifest")
    for source, pin in zip(cases, declared):
        if source["id"] != pin["id"]:
            raise Refusal("case id order drift")
        derived = audit(source["input"])
        for key, value in pin["expected"].items():
            if derived.get(key) != value:
                raise Refusal(f"case {source['id']}: field {key} drift: derived={derived.get(key)} manifest={value}")


def self_test(fixture_path: Path, manifest_path: Path) -> int:
    failures = []

    def ok(condition: bool, label: str) -> None:
        if not condition:
            failures.append(label)

    fixture = load_json(fixture_path, "fixture")

    ok(len(SOURCES) == 5 and CREDIBILITY["knowledge"] == 0.95, "credibility priors")
    ok(milli(0.8275) == 828 and milli(0.075391) == 75, "half-up rounding")

    def item(**over):
        base = {"id": "m1", "source": "knowledge", "ageDays": 0, "neighbors": []}
        base.update(over)
        return base

    def inp(items, **over):
        base = {
            "id": "ep-1",
            "weights": {"source": 0.45, "time": 0.40, "consensus": 0.15},
            "halfLifeDays": 30,
            "abstainBelow": 0.5,
            "reweightBelow": 0.75,
            "items": items,
        }
        base.update(over)
        return base

    def refuse(value, label):
        try:
            audit(value)
            ok(False, f"refuse {label}")
        except Refusal:
            ok(True, f"refuse {label}")

    good = audit(inp([item()]))
    ok(good["verdict"] == "admit" and good["reason"] == "reliable" and good["decidingScoreMilli"] == 828, "fresh admit")
    ok(good["admitCount"] == 1 and good["abstainCount"] == 0 and good["reweightCount"] == 0, "fresh counts")

    stale = audit(inp([item(source="episodic", ageDays=600)]))
    ok(stale["verdict"] == "abstain" and stale["reason"] == "below-threshold", "stale abstain")

    conflict = audit(inp([item(source="episodic", ageDays=300, neighbors=[{"weight": 2, "confidence": 1, "support": -1}])]))
    ok(conflict["reason"] == "conflict-overwhelms", "conflict abstain")

    marginal = audit(inp([item(source="resource")]))
    ok(marginal["verdict"] == "reweight" and marginal["reason"] == "marginal", "marginal reweight")

    # A consensus-dominant weighting drives the numerator negative; the floor must hold at 0.
    floor = audit(
        inp(
            [item(source="episodic", ageDays=1000000, neighbors=[{"weight": 1, "confidence": 1, "support": -1}])],
            weights={"source": 0.1, "time": 0.1, "consensus": 0.8},
        )
    )
    ok(floor["decidingScoreMilli"] == 0 and floor["verdict"] == "abstain", "lower floor clamp")

    mixed = audit(inp([item(id="good"), item(id="bad", source="episodic", ageDays=300, neighbors=[{"weight": 2, "confidence": 1, "support": -1}]), item(id="mid", source="resource")]))
    ok(mixed["decidingId"] == "bad" and mixed["itemCount"] == 3, "mixed decisive")
    tie = audit(inp([item(id="first"), item(id="second")]))
    ok(tie["decidingId"] == "first", "severity tie first wins")

    refuse(inp([item()], id=" "), "blank episode id")
    refuse(inp([item()], weights={"source": 0, "time": 0, "consensus": 0}), "zero weights")
    refuse(inp([item()], weights={"source": -1, "time": 1, "consensus": 0}), "negative weight")
    refuse(inp([item()], weights={"source": float("nan"), "time": 1, "consensus": 0}), "non-finite weight")
    refuse(inp([item()], halfLifeDays=0), "zero half life")
    refuse(inp([item()], halfLifeDays=float("inf")), "non-finite half life")
    refuse(inp([item()], abstainBelow=1.1), "abstain above one")
    refuse(inp([item()], abstainBelow="x"), "non-numeric abstain")
    refuse(inp([item()], reweightBelow=0.4), "reweight below abstain")
    refuse(inp([]), "empty items")
    refuse(inp("no"), "non-array items")
    refuse(inp([None]), "non-object item")
    refuse(inp([item(id=" ")]), "blank item id")
    refuse(inp([item(id="d"), item(id="d")]), "duplicate item id")
    refuse(inp([item(source="gossip")]), "unknown source")
    refuse(inp([item(source=7)]), "non-string source")
    refuse(inp([item(ageDays=-1)]), "negative age")
    refuse(inp([item(ageDays=float("nan"))]), "non-finite age")
    refuse(inp([item(neighbors="no")]), "non-array neighbors")
    refuse(inp([item(neighbors=[None])]), "non-object neighbor")
    refuse(inp([item(neighbors=[{"weight": 0, "confidence": 1, "support": 1}])]), "zero neighbor weight")
    refuse(inp([item(neighbors=[{"weight": float("nan"), "confidence": 1, "support": 1}])]), "non-finite neighbor weight")
    refuse(inp([item(neighbors=[{"weight": 1, "confidence": -0.1, "support": 1}])]), "low neighbor confidence")
    refuse(inp([item(neighbors=[{"weight": 1, "confidence": 1.1, "support": 1}])]), "high neighbor confidence")
    refuse(inp([item(neighbors=[{"weight": 1, "confidence": 1, "support": -1.1}])]), "low neighbor support")
    refuse(inp([item(neighbors=[{"weight": 1, "confidence": 1, "support": 1.1}])]), "high neighbor support")
    refuse(inp([item(neighbors=[{"weight": 1, "confidence": 1, "support": float("nan")}])]), "non-finite neighbor support")

    built = build(fixture)
    try:
        check(built)
        ok(True, "built manifest passes check")
    except Refusal as error:
        ok(False, f"built manifest passes check: {error}")
    verify(fixture, built)
    ok(True, "built manifest verifies")

    tampered = json.loads(json.dumps(built))
    tampered["cases"][0]["expected"]["decidingScoreMilli"] += 1
    try:
        verify(fixture, tampered)
        ok(False, "verify detects score tamper")
    except Refusal:
        ok(True, "verify detects score tamper")

    tampered = json.loads(json.dumps(built))
    tampered["cases"][0]["expected"]["verdict"] = "reweight"
    try:
        verify(fixture, tampered)
        ok(False, "verify detects verdict tamper")
    except Refusal:
        ok(True, "verify detects verdict tamper")

    tampered = json.loads(json.dumps(built))
    tampered["cases"][0]["expected"]["admitCount"] = 5
    try:
        check(tampered)
        ok(False, "check detects count drift")
    except Refusal:
        ok(True, "check detects count drift")

    tampered = json.loads(json.dumps(built))
    tampered["fixtureSchema"] = "wrong"
    try:
        verify(fixture, tampered)
        ok(False, "verify detects fixture schema drift")
    except Refusal:
        ok(True, "verify detects fixture schema drift")

    tampered = json.loads(json.dumps(built))
    tampered["cases"][0]["expected"]["reason"] = "conflict-overwhelms"
    try:
        check(tampered)
        ok(False, "check detects reason family drift")
    except Refusal:
        ok(True, "check detects reason family drift")

    try:
        check({"schema": "microglia/memory-confidence@1", "cases": []})
        ok(False, "check refuses empty cases")
    except Refusal:
        ok(True, "check refuses empty cases")

    with tempfile.TemporaryDirectory() as tmp:
        temp = Path(tmp)
        bad_fixture = temp / "fixture.json"
        bad_fixture.write_text(json.dumps({"schema": "x", "cases": [{"id": "a", "input": inp([item()])}, {"id": "b", "input": inp([item()])}]}), encoding="utf8")
        built_pair = temp / "built.json"
        quiet(["--build", "--fixture", str(bad_fixture), "--manifest", str(built_pair)])
        drifted = json.loads(json.dumps(built))
        drifted["cases"] = drifted["cases"][:1]
        drift_manifest = temp / "drift.json"
        drift_manifest.write_text(json.dumps(drifted), encoding="utf8")
        try:
            verify(load_json(bad_fixture, "fixture"), load_json(drift_manifest, "manifest"))
            ok(False, "verify detects case-count drift")
        except Refusal:
            ok(True, "verify detects case-count drift")

    quiet(["--check", "--manifest", str(manifest_path)])
    ok(True, "main check")
    quiet(["--verify", "--manifest", str(manifest_path), "--fixture", str(fixture_path)])
    ok(True, "main verify")
    ok(quiet(["--check", "--verify"]) == 1, "main rejects multiple actions")
    ok(quiet(["--check", "--manifest", str(temp / "missing.json")]) == 1, "main check surfaces refusal")

    if failures:
        print(f"SELF-TEST FAIL ({len(failures)}):", file=sys.stderr)
        for label in failures:
            print(f"  - {label}", file=sys.stderr)
        return 1
    print(f"SELF-TEST PASS ({len(fixture['cases'])} fixture cases, all boundaries and tampers)")
    return 0


def quiet(argv: list[str]) -> int:
    stdout, stderr = io.StringIO(), io.StringIO()
    try:
        with redirect_stdout(stdout), redirect_stderr(stderr):
            return main(argv)
    except SystemExit as error:
        return int(error.code or 0)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--build", action="store_true")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--verify", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--manifest", type=Path, default=MANIFEST)
    parser.add_argument("--fixture", type=Path, default=FIXTURE)
    parser.add_argument("--write", action="store_true", help="with --build, write the manifest to disk")
    args = parser.parse_args(argv)
    actions = [args.build, args.check, args.verify, args.self_test]
    if sum(1 for action in actions if action) != 1:
        print("exactly one of --build/--check/--verify/--self-test is required", file=sys.stderr)
        return 1
    try:
        if args.self_test:
            return self_test(args.fixture, args.manifest)
        if args.build:
            manifest = build(load_json(args.fixture, "fixture"))
            if args.write:
                args.manifest.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf8")
            print(json.dumps(manifest, indent=2, ensure_ascii=False))
            return 0
        if args.check:
            check(load_json(args.manifest, "manifest"))
            print("check: ok")
            return 0
        if args.verify:
            verify(load_json(args.fixture, "fixture"), load_json(args.manifest, "manifest"))
            print("verify: ok")
            return 0
    except Refusal as error:
        print(f"refused: {error}", file=sys.stderr)
        return 1
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
