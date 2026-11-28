#!/usr/bin/env python3
"""The evaluation's independent reading of R246's cross-view consistency gate.

The product's classifier lives in `packages/core/src/apply/view-consistency.ts` and is pinned by vitest. A second
reader that merely transcribed the manifest would agree for the wrong reason — both could share the same mistake.
This tool re-derives every verdict, count and figure from the fixture's bytes with an implementation that shares
no code with TypeScript. The rule comes from SPLICE (arXiv 2610.30790): keep only candidates whose utility gain is
consistent across independent views of the same experience.

    python3 eval/tools/view_consistency.py --build                    # regenerate the manifest from the fixture
    python3 eval/tools/view_consistency.py --check                    # the manifest's own arithmetic is consistent
    python3 eval/tools/view_consistency.py --verify                   # re-derive from the fixture and compare fields
    python3 eval/tools/view_consistency.py --self-test                # boundaries, determinism, tamper detection

`--manifest` and `--fixture` redirect every mode, so the self-test can drive distinct tampers against temporary
files without touching the committed pair.

What this establishes: a sign-flipping candidate is fragile and refused, a uniformly-helpful one is admitted,
and the verdict does not depend on input order. It claims no accuracy gain — no model was called here.
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
FIXTURE = ROOT / "eval" / "fixtures" / "view-consistency.json"
MANIFEST = ROOT / "eval" / "manifests" / "view-consistency.json"

SCHEMA = "microglia/view-consistency@1"
FIXTURE_SCHEMA = "microglia/view-consistency-readings@1"
VERDICTS = ("consistent-help", "consistent-harm", "fragile", "no-signal", "insufficient")
DEFAULT_MIN_VIEWS = 2


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


def is_int(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def consolidate(views: list[dict], min_views: int) -> dict:
    """Re-derive one consensus from a case's view readings. No shared code with the product."""
    if not is_int(min_views) or min_views < 1:
        raise Refusal(f"minViews must be a positive integer: {min_views!r}")

    seen: set[str] = set()
    for reading in views:
        label = reading.get("view")
        if not isinstance(label, str) or label.strip() == "":
            raise Refusal(f"view label must be a non-blank string: {label!r}")
        if label in seen:
            raise Refusal(f"duplicate view label: {label}")
        seen.add(label)
        for field in ("injected", "flippedUp", "flippedDown"):
            value = reading.get(field)
            if not is_int(value) or value < 0:
                raise Refusal(f"view {label}: {field} must be a non-negative integer: {value!r}")
        up = reading["flippedUp"]
        down = reading["flippedDown"]
        if up + down > reading["injected"]:
            raise Refusal(f"view {label}: flips cannot exceed injected")

    positive = negative = zero = net = 0
    gains: list[float] = []
    for reading in views:
        delta = reading["flippedUp"] - reading["flippedDown"]
        net += delta
        injected = reading["injected"]
        gains.append(0.0 if injected == 0 else delta / injected)
        if delta > 0:
            positive += 1
        elif delta < 0:
            negative += 1
        else:
            zero += 1

    spread = 0.0 if len(gains) < 2 else max(gains) - min(gains)

    if len(views) < min_views:
        verdict = "insufficient"
    elif positive > 0 and negative > 0:
        verdict = "fragile"
    elif negative > 0:
        verdict = "consistent-harm"
    elif positive > 0:
        verdict = "consistent-help"
    else:
        verdict = "no-signal"

    return {
        "verdict": verdict,
        "admit": verdict == "consistent-help",
        "views": len(views),
        "positive": positive,
        "negative": negative,
        "zero": zero,
        "net": net,
        "gains": gains,
        "spread": spread,
        "minViews": min_views,
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
        views = case.get("views")
        if not isinstance(views, list):
            raise Refusal(f"case {case_id}: views must be a list")
        min_views = case.get("minViews", DEFAULT_MIN_VIEWS)
        result = consolidate(views, min_views)
        readings.append({"id": case_id, "expected": result})

    return {
        "schema": SCHEMA,
        "fixtureSchema": fixture.get("schema"),
        "cases": readings,
    }


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
        expected = entry.get("expected")
        if not isinstance(expected, dict):
            raise Refusal(f"case {case_id}: expected must be an object")
        verdict = expected.get("verdict")
        if verdict not in VERDICTS:
            raise Refusal(f"case {case_id}: unknown verdict {verdict!r}")
        if expected.get("admit") is not (verdict == "consistent-help"):
            raise Refusal(f"case {case_id}: admit disagrees with verdict")
        pos = expected.get("positive")
        neg = expected.get("negative")
        zero = expected.get("zero")
        views = expected.get("views")
        if not all(is_int(x) and x >= 0 for x in (pos, neg, zero, views)):
            raise Refusal(f"case {case_id}: counts must be non-negative integers")
        if pos + neg + zero != views:
            raise Refusal(f"case {case_id}: counts do not sum to views")
        gains = expected.get("gains")
        if not isinstance(gains, list) or len(gains) != views:
            raise Refusal(f"case {case_id}: gains length disagrees with views")
        if views < 2 and abs(expected.get("spread", -1)) > 1e-12:
            raise Refusal(f"case {case_id}: spread must be zero below two views")
        # The verdict must be the unique function of the counts and the floor.
        min_views = expected.get("minViews")
        if not is_int(min_views) or min_views < 1:
            raise Refusal(f"case {case_id}: minViews invalid")
        if views < min_views:
            derived = "insufficient"
        elif pos > 0 and neg > 0:
            derived = "fragile"
        elif neg > 0:
            derived = "consistent-harm"
        elif pos > 0:
            derived = "consistent-help"
        else:
            derived = "no-signal"
        if derived != verdict:
            raise Refusal(f"case {case_id}: verdict disagrees with the count ladder")


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
            if key == "gains":
                other = expected.get("gains")
                if not isinstance(other, list) or len(other) != len(value):
                    raise Refusal(f"case {right['id']}: gains drift")
                if any(not math.isclose(a, b, rel_tol=0, abs_tol=1e-12) for a, b in zip(value, other)):
                    raise Refusal(f"case {right['id']}: a gain drifted")
            elif key == "spread":
                if not math.isclose(value, expected.get("spread", -1), rel_tol=0, abs_tol=1e-12):
                    raise Refusal(f"case {right['id']}: spread drifted")
            elif expected.get(key) != value:
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

    # The committed pair agrees under all three readings.
    built = build(fixture)
    check(built)
    verify(fixture, built)
    ok(built["schema"] == SCHEMA, "built schema")
    ok(len(built["cases"]) == len(fixture["cases"]), "built case count")

    # Every verdict vocabulary member is reachable from the fixture.
    covered = {entry["expected"]["verdict"] for entry in built["cases"]}
    for verdict in VERDICTS:
        ok(verdict in covered, f"verdict {verdict} reachable")

    # Order independence of the decision (gains are reported in input order, not gated).
    views = [
        {"view": "x", "injected": 8, "flippedUp": 6, "flippedDown": 1},
        {"view": "y", "injected": 8, "flippedUp": 1, "flippedDown": 6},
        {"view": "z", "injected": 8, "flippedUp": 5, "flippedDown": 2},
    ]
    forward = consolidate(views, 2)
    reverse = consolidate(list(reversed(views)), 2)
    for key in ("verdict", "admit", "positive", "negative", "zero", "net", "views"):
        ok(forward[key] == reverse[key], f"order independence of {key}")
    ok(sorted(forward["gains"]) == sorted(reverse["gains"]), "order independence of gains multiset")

    # Sign is decided by the net flip, not the ratio magnitude.
    magnitude = consolidate(
        [
            {"view": "a", "injected": 100, "flippedUp": 10, "flippedDown": 40},
            {"view": "b", "injected": 4, "flippedUp": 0, "flippedDown": 1},
        ],
        2,
    )
    ok(magnitude["verdict"] == "consistent-harm", "net sign over ratio magnitude")

    # Zero-injected views abstain rather than contradict.
    abstain = consolidate(
        [
            {"view": "a", "injected": 10, "flippedUp": 7, "flippedDown": 1},
            {"view": "b", "injected": 0, "flippedUp": 0, "flippedDown": 0},
        ],
        2,
    )
    ok(abstain["verdict"] == "consistent-help", "abstention is not contradiction")
    ok(abstain["gains"][1] == 0.0, "zero-injected gain is zero")

    # A raised floor turns a clear help into insufficient.
    raised = consolidate(
        [
            {"view": "a", "injected": 10, "flippedUp": 7, "flippedDown": 1},
            {"view": "b", "injected": 10, "flippedUp": 6, "flippedDown": 2},
        ],
        3,
    )
    ok(raised["verdict"] == "insufficient", "raised floor")

    # Spread is zero below two views and positive otherwise.
    ok(consolidate([views[0]], 1)["spread"] == 0.0, "single-view spread")
    ok(forward["spread"] > 0.0, "multi-view spread")

    # Refusals, each driven directly.
    refusals = [
        ([{"view": "a", "injected": -1, "flippedUp": 0, "flippedDown": 0}], 2),
        ([{"view": "a", "injected": 1.5, "flippedUp": 0, "flippedDown": 0}], 2),
        ([{"view": "", "injected": 2, "flippedUp": 1, "flippedDown": 0}], 2),
        ([{"view": "a", "injected": 2, "flippedUp": 2, "flippedDown": 1}], 2),
        ([{"view": "a", "injected": 2, "flippedUp": 1, "flippedDown": 0}] * 2, 2),
    ]
    for bad_views, floor in refusals:
        try:
            consolidate(bad_views, floor)
            ok(False, f"refusal expected for {bad_views!r}")
        except Refusal:
            ok(True, f"refusal raised for {bad_views!r}")
    for bad_floor in (0, -1, 1.5, "2"):
        try:
            consolidate([views[0]], bad_floor)
            ok(False, f"refusal expected for floor {bad_floor!r}")
        except Refusal:
            ok(True, f"refusal raised for floor {bad_floor!r}")

    # Refusals from loaders and schema gates.
    with tempfile.TemporaryDirectory() as directory:
        temp = Path(directory)
        not_object = temp / "not-object.json"
        bad_json = temp / "bad.json"
        wrong_schema = temp / "wrong-schema.json"
        not_object.write_text("[]", encoding="utf-8")
        bad_json.write_text("{", encoding="utf-8")
        wrong_schema.write_text(json.dumps({"schema": "other"}), encoding="utf-8")
        for path, label in ((not_object, "object"), (bad_json, "json"), (wrong_schema, "schema")):
            try:
                load_json(path, label)
                ok(False, f"loader refusal for {label}")
            except Refusal:
                ok(True, f"loader refusal for {label}")
        try:
            build({"schema": "other", "cases": []})
            ok(False, "build refuses wrong fixture schema")
        except Refusal:
            ok(True, "build refuses wrong fixture schema")
        for bad_fixture in (
            {"schema": FIXTURE_SCHEMA, "cases": []},
            {"schema": FIXTURE_SCHEMA, "cases": [{"id": "x"}]},
            {"schema": FIXTURE_SCHEMA, "cases": [{"id": "x", "views": []}, {"id": "x", "views": []}]},
        ):
            try:
                build(bad_fixture)
                ok(False, f"build refuses malformed fixture {bad_fixture!r}")
            except Refusal:
                ok(True, f"build refuses malformed fixture {bad_fixture!r}")

        # Tamper the manifest: a changed verdict, a changed count, a drifted gain.
        tampered = json.loads(json.dumps(built))
        tampered["cases"][0]["expected"]["verdict"] = "fragile"
        try:
            check(tampered)
            ok(False, "check refuses verdict drift")
        except Refusal:
            ok(True, "check refuses verdict drift")
        tampered = json.loads(json.dumps(built))
        tampered["cases"][0]["expected"]["positive"] += 1
        try:
            check(tampered)
            ok(False, "check refuses count drift")
        except Refusal:
            ok(True, "check refuses count drift")
        tampered = json.loads(json.dumps(built))
        tampered["cases"][0]["expected"]["gains"][0] += 1.0
        try:
            verify(fixture, tampered)
            ok(False, "verify refuses gain drift")
        except Refusal:
            ok(True, "verify refuses gain drift")
        tampered = json.loads(json.dumps(built))
        tampered["cases"][0]["id"] = "renamed"
        try:
            verify(fixture, tampered)
            ok(False, "verify refuses case-order drift")
        except Refusal:
            ok(True, "verify refuses case-order drift")

    # The committed manifest, as shipped, verifies against the committed fixture.
    check(manifest)
    verify(fixture, manifest)
    ok(sha256(fixture_path) == sha256(fixture_path), "digest is stable")

    # Every refusal guard in build/check/verify, driven directly. These are the branches a tamper on the
    # committed pair must never reach, but a reader whose guards silently passed would still agree on good data.
    def refuse(function, label: str) -> None:
        try:
            function()
            ok(False, f"refusal expected: {label}")
        except Refusal:
            ok(True, f"refusal raised: {label}")

    refuse(lambda: check({"schema": "other"}), "check schema")
    refuse(lambda: check({"schema": SCHEMA, "cases": []}), "check empty cases")
    refuse(lambda: check({"schema": SCHEMA, "cases": [{}]}), "check missing id")
    refuse(
        lambda: check({"schema": SCHEMA, "cases": [{"id": "x", "expected": 1}]}),
        "check expected not object",
    )
    good_expected = built["cases"][0]["expected"]
    refuse(
        lambda: check({"schema": SCHEMA, "cases": [{"id": "x", "expected": {**good_expected, "verdict": "bogus"}}]}),
        "check unknown verdict",
    )
    refuse(
        lambda: check({"schema": SCHEMA, "cases": [{"id": "x", "expected": {**good_expected, "admit": not good_expected["admit"]}}]}),
        "check admit disagrees with verdict",
    )
    refuse(
        lambda: check({"schema": SCHEMA, "cases": [{"id": "x", "expected": {**good_expected, "positive": -1}}]}),
        "check non-integer count",
    )
    refuse(
        lambda: check({"schema": SCHEMA, "cases": [{"id": "x", "expected": {**good_expected, "positive": good_expected["positive"] + 1}}]}),
        "check counts do not sum",
    )
    refuse(
        lambda: check({"schema": SCHEMA, "cases": [{"id": "x", "expected": {**good_expected, "gains": []}}]}),
        "check gains length",
    )
    refuse(
        lambda: check({"schema": SCHEMA, "cases": [{"id": "x", "expected": {**good_expected, "views": 1, "spread": 0.5}}]}),
        "check spread below two views",
    )
    refuse(
        lambda: check({"schema": SCHEMA, "cases": [{"id": "x", "expected": {**good_expected, "minViews": 0}}]}),
        "check minViews invalid",
    )
    refuse(
        lambda: check({"schema": SCHEMA, "cases": [{"id": "x", "expected": {**good_expected, "verdict": "no-signal"}}]}),
        "check verdict against count ladder",
    )

    refuse(lambda: verify({"schema": "other", "cases": []}, built), "verify fixture schema drift")
    refuse(lambda: verify({"schema": FIXTURE_SCHEMA, "cases": []}, built), "verify case count drift")
    missing_expected = json.loads(json.dumps(built))
    del missing_expected["cases"][0]["expected"]
    refuse(lambda: verify(fixture, missing_expected), "verify expected missing")
    schema_drift = json.loads(json.dumps(built))
    schema_drift["fixtureSchema"] = "other"
    refuse(lambda: verify(fixture, schema_drift), "verify fixture schema field drift")
    gains_shape = json.loads(json.dumps(built))
    gains_shape["cases"][0]["expected"]["gains"] = []
    refuse(lambda: verify(fixture, gains_shape), "verify gains shape drift")
    spread_drift = json.loads(json.dumps(built))
    spread_drift["cases"][0]["expected"]["spread"] += 1.0
    refuse(lambda: verify(fixture, spread_drift), "verify spread drift")
    field_drift = json.loads(json.dumps(built))
    field_drift["cases"][0]["expected"]["net"] += 1
    refuse(lambda: verify(fixture, field_drift), "verify scalar field drift")

    refuse(lambda: build({"schema": FIXTURE_SCHEMA, "cases": [{"views": []}]}), "build case without id")
    refuse(
        lambda: build({"schema": FIXTURE_SCHEMA, "cases": [{"id": "x", "views": {}}]}),
        "build views not a list",
    )

    # main's argparse branches, through the real CLI entry with redirected paths. build is written to a temp
    # file so the committed manifest is never touched; no --self-test here to avoid recursion.
    def quiet(argv: list[str]) -> int:
        # main prints its result; the self-test drives these branches for coverage, not for their output.
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            return main(argv)

    with tempfile.TemporaryDirectory() as directory:
        temp = Path(directory)
        built_path = temp / "built.json"
        ok(quiet(["--build", "--fixture", str(fixture_path), "--manifest", str(built_path)]) == 0, "main build prints")
        ok(quiet(["--build", "--write", "--fixture", str(fixture_path), "--manifest", str(built_path)]) == 0, "main build writes")
        ok(built_path.exists(), "main build wrote the manifest")
        ok(quiet(["--check", "--manifest", str(manifest_path)]) == 0, "main check")
        ok(
            quiet(["--verify", "--manifest", str(manifest_path), "--fixture", str(fixture_path)]) == 0,
            "main verify",
        )
        ok(quiet([]) == 1, "main rejects no action")
        ok(quiet(["--check", "--verify"]) == 1, "main rejects multiple actions")
        # main catches Refusal and returns 1 (the CLI contract).
        ok(quiet(["--check", "--manifest", str(temp / "missing.json")]) == 1, "main check surfaces refusal")

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
        # Return 1 rather than raise SystemExit, so self-test can drive this branch through the real entry.
        print(
            "exactly one of --build/--check/--verify/--self-test is required",
            file=sys.stderr,
        )
        return 1

    try:
        if arguments.build:
            result = build(load_json(arguments.fixture, "fixture"))
            if arguments.write:
                arguments.manifest.write_text(
                    json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
                )
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
