#!/usr/bin/env python3
"""The evaluation's independent reading of R247's abstraction lifecycle decision.

The product's classifier lives in `packages/core/src/apply/abstraction-lifecycle.ts` and is pinned by vitest. A
second reader that merely transcribed the manifest would agree for the wrong reason — both could share the same
mistake. This tool re-derives every disposition and reason from the fixture's bytes with an implementation that
shares no code with TypeScript. The rule comes from Anti-Persistence (arXiv 2610.27406): accumulate event records,
treat abstractions as temporary guidance unless their own observed outcomes license persisting them.

    python3 eval/tools/abstraction_lifecycle.py --build                    # regenerate the manifest from the fixture
    python3 eval/tools/abstraction_lifecycle.py --check                    # the manifest's own arithmetic is consistent
    python3 eval/tools/abstraction_lifecycle.py --verify                   # re-derive from the fixture and compare fields
    python3 eval/tools/abstraction_lifecycle.py --self-test                # boundaries, determinism, tamper detection

`--manifest` and `--fixture` redirect every mode, so the self-test can drive distinct tampers against temporary
files without touching the committed pair.

What this establishes: an exemplar is always accumulated; a harmful abstraction is discarded even below the
injection floor; a positive abstraction is persisted only at or above the floor. No accuracy gain is claimed —
no model was called here.
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
FIXTURE = ROOT / "eval" / "fixtures" / "abstraction-lifecycle.json"
MANIFEST = ROOT / "eval" / "manifests" / "abstraction-lifecycle.json"

SCHEMA = "microglia/abstraction-lifecycle@1"
FIXTURE_SCHEMA = "microglia/abstraction-lifecycle-readings@1"
DISPOSITIONS = ("retain", "ephemeral", "discard")
REASONS = ("event-record", "stable-help", "harmful-abstraction", "insufficient-outcomes", "no-signal")
CLAIM_KINDS = ("constraint", "negative", "lexicon", "procedure", "abstention")
EVENT_KIND = "exemplar"
DEFAULT_MIN_INJECTIONS = 3


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


def decide(item: dict, options: dict, min_injections: int) -> dict:
    """Re-derive one lifecycle decision from an item's bytes. No shared code with the product."""
    if not is_int(min_injections) or min_injections < 1:
        raise Refusal(f"minInjections must be a positive integer: {min_injections!r}")

    item_id = item.get("id")
    if not isinstance(item_id, str) or item_id.strip() == "":
        raise Refusal(f"item id must be a non-blank string: {item_id!r}")
    kind = item.get("kind")
    if not isinstance(kind, str) or kind not in (*CLAIM_KINDS, EVENT_KIND):
        raise Refusal(f"item {item_id}: unknown kind {kind!r}")

    injected = 0
    delta = 0
    utility = item.get("utility")
    if utility is not None:
        if not isinstance(utility, dict):
            raise Refusal(f"item {item_id}: utility must be an object")
        for field in ("injected", "flippedUp", "flippedDown"):
            value = utility.get(field)
            if not is_int(value) or value < 0:
                raise Refusal(f"item {item_id}: {field} must be a non-negative integer: {value!r}")
        up = utility["flippedUp"]
        down = utility["flippedDown"]
        if up + down > utility["injected"]:
            raise Refusal(f"item {item_id}: flips cannot exceed injected")
        injected = utility["injected"]
        delta = up - down

    if kind == EVENT_KIND:
        disposition, reason = "retain", "event-record"
    elif delta < 0:
        disposition, reason = "discard", "harmful-abstraction"
    elif delta > 0 and injected >= min_injections:
        disposition, reason = "retain", "stable-help"
    elif delta > 0:
        disposition, reason = "ephemeral", "insufficient-outcomes"
    else:
        disposition, reason = "ephemeral", "no-signal"

    return {
        "disposition": disposition,
        "reason": reason,
        "id": item_id,
        "kind": kind,
        "delta": delta,
        "injected": injected,
        "minInjections": min_injections,
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
        item = case.get("item")
        if not isinstance(item, dict):
            raise Refusal(f"case {case_id}: item must be an object")
        options = case.get("options", {})
        if not isinstance(options, dict):
            raise Refusal(f"case {case_id}: options must be an object")
        min_injections = options.get("minInjections", DEFAULT_MIN_INJECTIONS)
        result = decide(item, options, min_injections)
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
        disposition = expected.get("disposition")
        if disposition not in DISPOSITIONS:
            raise Refusal(f"case {case_id}: unknown disposition {disposition!r}")
        reason = expected.get("reason")
        if reason not in REASONS:
            raise Refusal(f"case {case_id}: unknown reason {reason!r}")
        item_id = expected.get("id")
        if not isinstance(item_id, str) or item_id.strip() == "":
            raise Refusal(f"case {case_id}: expected id missing")
        kind = expected.get("kind")
        if not isinstance(kind, str) or kind not in (*CLAIM_KINDS, EVENT_KIND):
            raise Refusal(f"case {case_id}: expected kind unknown")
        delta = expected.get("delta")
        injected = expected.get("injected")
        floor = expected.get("minInjections")
        if not (is_int(delta) and is_int(injected) and injected >= 0):
            raise Refusal(f"case {case_id}: delta/injected invalid")
        if not is_int(floor) or floor < 1:
            raise Refusal(f"case {case_id}: minInjections invalid")
        # The disposition/reason must be the unique function of kind, delta and the floor.
        if kind == EVENT_KIND:
            derived = ("retain", "event-record")
        elif delta < 0:
            derived = ("discard", "harmful-abstraction")
        elif delta > 0 and injected >= floor:
            derived = ("retain", "stable-help")
        elif delta > 0:
            derived = ("ephemeral", "insufficient-outcomes")
        else:
            derived = ("ephemeral", "no-signal")
        if (disposition, reason) != derived:
            raise Refusal(f"case {case_id}: decision disagrees with the ladder")


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

    # Every disposition and every reason is reachable from the fixture.
    covered_dispositions = {entry["expected"]["disposition"] for entry in built["cases"]}
    covered_reasons = {entry["expected"]["reason"] for entry in built["cases"]}
    for disposition in DISPOSITIONS:
        ok(disposition in covered_dispositions, f"disposition {disposition} reachable")
    for reason in REASONS:
        ok(reason in covered_reasons, f"reason {reason} reachable")

    # Harm is checked before the floor: one bad outcome still discards.
    harmful = decide({"id": "x", "kind": "constraint", "utility": {"injected": 1, "flippedUp": 0, "flippedDown": 1}}, {}, 3)
    ok(harmful["disposition"] == "discard", "harm before floor")
    # A raised floor turns a clear help into insufficient outcomes.
    raised = decide({"id": "x", "kind": "procedure", "utility": {"injected": 5, "flippedUp": 5, "flippedDown": 0}}, {}, 6)
    ok(raised["reason"] == "insufficient-outcomes", "raised floor")
    # An exemplar is retained even with a harmful utility reading.
    event = decide({"id": "x", "kind": "exemplar", "utility": {"injected": 9, "flippedUp": 0, "flippedDown": 8}}, {}, 3)
    ok(event["reason"] == "event-record", "event record retained")
    # Reported arithmetic is a readback; floor is echoed.
    ok(event["delta"] == -8 and event["injected"] == 9 and event["minInjections"] == 3, "readback arithmetic")
    no_utility = decide({"id": "x", "kind": "lexicon"}, {}, 3)
    ok(no_utility["delta"] == 0 and no_utility["injected"] == 0, "no-utility arithmetic")

    def refuse(function, label: str) -> None:
        try:
            function()
            ok(False, f"refusal expected: {label}")
        except Refusal:
            ok(True, f"refusal raised: {label}")

    # Every guard in decide, driven directly.
    refuse(lambda: decide({"id": "x", "kind": "constraint"}, {}, 0), "floor zero")
    refuse(lambda: decide({"id": "x", "kind": "constraint"}, {}, -1), "floor negative")
    refuse(lambda: decide({"id": "x", "kind": "constraint"}, {}, 1.5), "floor non-integer")
    refuse(lambda: decide({"id": "", "kind": "constraint"}, {}, 3), "blank id")
    refuse(lambda: decide({"id": "  ", "kind": "constraint"}, {}, 3), "whitespace id")
    refuse(lambda: decide({"id": "x", "kind": "mystery"}, {}, 3), "unknown kind")
    refuse(lambda: decide({"id": "x", "kind": "constraint", "utility": 1}, {}, 3), "utility not object")
    refuse(lambda: decide({"id": "x", "kind": "constraint", "utility": {"injected": -1, "flippedUp": 0, "flippedDown": 0}}, {}, 3), "negative injected")
    refuse(lambda: decide({"id": "x", "kind": "constraint", "utility": {"injected": 3, "flippedUp": 0.5, "flippedDown": 0}}, {}, 3), "non-integer flip")
    refuse(lambda: decide({"id": "x", "kind": "constraint", "utility": {"injected": 2, "flippedUp": 1, "flippedDown": 2}}, {}, 3), "flips exceed injected")

    # Loader and schema gates.
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
            {"schema": FIXTURE_SCHEMA, "cases": [{"id": "x", "item": {}}, {"id": "x", "item": {}}]},
            {"schema": FIXTURE_SCHEMA, "cases": [{"id": "x", "item": 1}]},
            {"schema": FIXTURE_SCHEMA, "cases": [{"id": "x", "item": {}, "options": 1}]},
        ):
            refuse(lambda f=bad_fixture: build(f), f"build refuses malformed fixture {bad_fixture!r}")

        # Tamper the manifest and let check/verify refuse.
        tampered = json.loads(json.dumps(built))
        tampered["cases"][0]["expected"]["disposition"] = "discard"
        refuse(lambda: check(tampered), "check refuses disposition drift")
        tampered = json.loads(json.dumps(built))
        tampered["cases"][0]["expected"]["reason"] = "no-signal"
        refuse(lambda: check(tampered), "check refuses reason drift")
        tampered = json.loads(json.dumps(built))
        tampered["cases"][0]["expected"]["delta"] += 1
        refuse(lambda: check(tampered), "check refuses ladder drift")
        tampered = json.loads(json.dumps(built))
        tampered["cases"][0]["id"] = "renamed"
        refuse(lambda: verify(fixture, tampered), "verify refuses case-order drift")
        tampered = json.loads(json.dumps(built))
        tampered["cases"][0]["expected"]["kind"] = "exemplar"
        refuse(lambda: verify(fixture, tampered), "verify refuses field drift")

    # Every refusal guard in check/verify, driven directly.
    good_expected = built["cases"][0]["expected"]
    refuse(lambda: check({"schema": "other"}), "check schema")
    refuse(lambda: check({"schema": SCHEMA, "cases": []}), "check empty cases")
    refuse(lambda: check({"schema": SCHEMA, "cases": [{}]}), "check missing id")
    refuse(lambda: check({"schema": SCHEMA, "cases": [{"id": "x", "expected": 1}]}), "check expected not object")
    refuse(lambda: check({"schema": SCHEMA, "cases": [{"id": "x", "expected": {**good_expected, "disposition": "bogus"}}]}), "check unknown disposition")
    refuse(lambda: check({"schema": SCHEMA, "cases": [{"id": "x", "expected": {**good_expected, "reason": "bogus"}}]}), "check unknown reason")
    refuse(lambda: check({"schema": SCHEMA, "cases": [{"id": "x", "expected": {**good_expected, "id": ""}}]}), "check expected id missing")
    refuse(lambda: check({"schema": SCHEMA, "cases": [{"id": "x", "expected": {**good_expected, "kind": "bogus"}}]}), "check expected kind unknown")
    refuse(lambda: check({"schema": SCHEMA, "cases": [{"id": "x", "expected": {**good_expected, "delta": 0.5}}]}), "check delta invalid")
    refuse(lambda: check({"schema": SCHEMA, "cases": [{"id": "x", "expected": {**good_expected, "minInjections": 0}}]}), "check floor invalid")
    refuse(lambda: check({"schema": SCHEMA, "cases": [{"id": "x", "expected": {**good_expected, "disposition": "ephemeral", "reason": "stable-help"}}]}), "check ladder drift")
    refuse(lambda: verify({"schema": "other", "cases": []}, built), "verify fixture schema drift")
    refuse(lambda: verify({"schema": FIXTURE_SCHEMA, "cases": []}, built), "verify case count drift")
    missing_expected = json.loads(json.dumps(built))
    del missing_expected["cases"][0]["expected"]
    refuse(lambda: verify(fixture, missing_expected), "verify expected missing")
    schema_drift = json.loads(json.dumps(built))
    schema_drift["fixtureSchema"] = "other"
    refuse(lambda: verify(fixture, schema_drift), "verify fixture schema field drift")

    # main's argparse branches, through the real CLI entry with redirected paths.
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

    # The committed manifest, as shipped, verifies against the committed fixture.
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
