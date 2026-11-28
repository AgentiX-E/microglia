#!/usr/bin/env python3
"""The evaluation's independent reading of R249's revision-integrity gate.

The product's audit lives in `packages/core/src/apply/revision-integrity.ts` and is pinned by vitest. A second reader
that merely transcribed the manifest would agree for the wrong reason - both could share the same mistake. This tool
re-derives every verdict, reason and count from the fixture's bytes with an implementation that shares no code with
TypeScript. The rule comes from two papers: Deploy-Time Memory (arXiv 2606.10062) measures a Forgetting Residual Score
- removing only the raw record leaves derived copies recoverable, so an untouched site is a residual; and LongMemEval
(ICLR 2025, arXiv 2410.10813) shows fact-augmented keys that keep the original beat replacing it, so a correction must
augment its source while a retract must not.

    python3 eval/tools/revision_integrity.py --build                     # regenerate the manifest from the fixture
    python3 eval/tools/revision_integrity.py --check                     # the manifest's own arithmetic is consistent
    python3 eval/tools/revision_integrity.py --verify                    # re-derive from the fixture and compare fields
    python3 eval/tools/revision_integrity.py --self-test                 # boundaries, determinism, tamper detection

`--manifest` and `--fixture` redirect every mode, so the self-test can drive distinct tampers against temporary
files without touching the committed pair. No model was called here.
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
FIXTURE = ROOT / "eval" / "fixtures" / "revision-integrity.json"
MANIFEST = ROOT / "eval" / "manifests" / "revision-integrity.json"

SCHEMA = "microglia/revision-integrity@1"
FIXTURE_SCHEMA = "microglia/revision-integrity-inputs@1"
INTENTS = ("retract", "correct")
KINDS = ("source", "summary", "fact-key", "embedding", "citation")
STATES = ("live", "augmented", "tombstoned", "purged")
VERDICTS = ("complete", "residual", "method-violation")
REASONS = (
    "full-purge", "tombstone-coverage", "augmented-and-covered",
    "live-site", "augment-retains-claim", "no-source-to-augment", "replace-drops-provenance",
)


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


def audit(inp: dict) -> dict:
    """Re-derive one revision audit from an input's bytes. No shared code with the product."""
    ident = inp.get("id")
    if not isinstance(ident, str) or ident.strip() == "":
        raise Refusal(f"revision id must be a non-blank string: {ident!r}")
    intent = inp.get("intent")
    if not isinstance(intent, str) or intent not in INTENTS:
        raise Refusal(f"revision {ident}: unknown intent {intent!r}")
    sites = inp.get("sites")
    if not isinstance(sites, list):
        raise Refusal(f"revision {ident}: sites must be an array")
    if not sites:
        raise Refusal(f"revision {ident}: sites must not be empty")

    seen: set[str] = set()
    live = aug = tomb = purged = 0
    has_source = False
    source_augmented = False
    all_purged = True
    for site in sites:
        if not isinstance(site, dict):
            raise Refusal(f"revision {ident}: every site must be an object")
        sid = site.get("id")
        if not isinstance(sid, str) or sid.strip() == "":
            raise Refusal(f"revision {ident}: site id must be non-blank")
        if sid in seen:
            raise Refusal(f"revision {ident}: duplicate site id {sid!r}")
        seen.add(sid)
        kind = site.get("kind")
        if not isinstance(kind, str) or kind not in KINDS:
            raise Refusal(f"revision {ident}: unknown site kind {kind!r}")
        state = site.get("state")
        if not isinstance(state, str) or state not in STATES:
            raise Refusal(f"revision {ident}: unknown site state {state!r}")
        if kind == "source":
            has_source = True
            source_augmented = state == "augmented"
        if state == "live":
            live += 1
        elif state == "augmented":
            aug += 1
        elif state == "tombstoned":
            tomb += 1
        else:
            purged += 1
        if state != "purged":
            all_purged = False

    if intent == "retract" and aug > 0:
        verdict, reason = "residual", "augment-retains-claim"
        residual = live + aug
    elif live > 0:
        verdict, reason = "residual", "live-site"
        residual = live
    elif intent == "correct" and not has_source:
        verdict, reason, residual = "method-violation", "no-source-to-augment", 0
    elif intent == "correct" and not source_augmented:
        verdict, reason, residual = "method-violation", "replace-drops-provenance", 0
    else:
        verdict, residual = "complete", 0
        if all_purged:
            reason = "full-purge"
        elif intent == "correct":
            reason = "augmented-and-covered"
        else:
            reason = "tombstone-coverage"

    return {
        "id": ident,
        "intent": intent,
        "verdict": verdict,
        "reason": reason,
        "siteCount": len(sites),
        "liveSites": live,
        "augmentedSites": aug,
        "tombstonedSites": tomb,
        "purgedSites": purged,
        "residualSites": residual,
        "hasSource": has_source,
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
        inp = case.get("input")
        if not isinstance(inp, dict):
            raise Refusal(f"case {case_id}: input must be an object")
        readings.append({"id": case_id, "expected": audit(inp)})
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
        if exp.get("intent") not in INTENTS:
            raise Refusal(f"case {case_id}: unknown intent")
        if not isinstance(exp.get("hasSource"), bool):
            raise Refusal(f"case {case_id}: hasSource must be a boolean")
        for key in ("siteCount", "liveSites", "augmentedSites", "tombstonedSites", "purgedSites", "residualSites"):
            value = exp.get(key)
            if not (isinstance(value, int) and not isinstance(value, bool) and value >= 0):
                raise Refusal(f"case {case_id}: {key} invalid")
        # The four site-state counts must partition the site count.
        parts = exp["liveSites"] + exp["augmentedSites"] + exp["tombstonedSites"] + exp["purgedSites"]
        if parts != exp["siteCount"]:
            raise Refusal(f"case {case_id}: site counts do not partition")
        # residualSites must agree with the reason's family.
        if exp["reason"] in ("live-site", "augment-retains-claim") and exp["residualSites"] <= 0:
            raise Refusal(f"case {case_id}: residual reason without residual")
        if exp["reason"] not in ("live-site", "augment-retains-claim") and exp["residualSites"] != 0:
            raise Refusal(f"case {case_id}: residual count on a non-residual verdict")
        if exp["verdict"] == "complete" and exp["reason"] not in ("full-purge", "tombstone-coverage", "augmented-and-covered"):
            raise Refusal(f"case {case_id}: complete with a non-complete reason")


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

    # The deciding rules, re-derived on fresh inputs.
    purge = audit({"id": "x", "intent": "retract", "sites": [{"id": "s", "kind": "source", "state": "purged"}]})
    ok(purge["verdict"] == "complete" and purge["reason"] == "full-purge", "full purge is clean")
    live = audit({"id": "x", "intent": "retract",
                  "sites": [{"id": "s", "kind": "source", "state": "purged"}, {"id": "d", "kind": "summary", "state": "live"}]})
    ok(live["verdict"] == "residual" and live["reason"] == "live-site", "live derivative is residual")
    aug_retract = audit({"id": "x", "intent": "retract", "sites": [{"id": "s", "kind": "source", "state": "augmented"}]})
    ok(aug_retract["reason"] == "augment-retains-claim", "augment retains a retracted claim")
    aug_correct = audit({"id": "x", "intent": "correct", "sites": [{"id": "s", "kind": "source", "state": "augmented"}]})
    ok(aug_correct["verdict"] == "complete" and aug_correct["reason"] == "augmented-and-covered", "augment covers a correction")
    no_source = audit({"id": "x", "intent": "correct", "sites": [{"id": "d", "kind": "summary", "state": "tombstoned"}]})
    ok(no_source["reason"] == "no-source-to-augment", "no source to augment")
    replace = audit({"id": "x", "intent": "correct", "sites": [{"id": "s", "kind": "source", "state": "purged"}]})
    ok(replace["reason"] == "replace-drops-provenance", "replacement drops provenance")
    # Double residual: an augmented and a live site both carry the old value.
    double = audit({"id": "x", "intent": "retract",
                    "sites": [{"id": "s", "kind": "source", "state": "augmented"}, {"id": "d", "kind": "summary", "state": "live"}]})
    ok(double["residualSites"] == 2, "two residual sites counted")

    def refuse(function, label: str) -> None:
        try:
            function()
            ok(False, f"refusal expected: {label}")
        except Refusal:
            ok(True, f"refusal raised: {label}")

    refuse(lambda: audit({"id": "  ", "intent": "retract", "sites": []}), "blank id")
    refuse(lambda: audit({"id": "x", "intent": "archive", "sites": []}), "unknown intent")
    refuse(lambda: audit({"id": "x", "intent": "retract", "sites": "s"}), "sites not array")
    refuse(lambda: audit({"id": "x", "intent": "retract", "sites": []}), "empty sites")
    refuse(lambda: audit({"id": "x", "intent": "retract", "sites": [{"id": "  ", "kind": "source", "state": "live"}]}), "blank site id")
    refuse(lambda: audit({"id": "x", "intent": "retract", "sites": [1]}), "site not object")
    refuse(lambda: audit({"id": "x", "intent": "retract", "sites": [{"id": "s", "kind": "vector", "state": "live"}]}), "unknown kind")
    refuse(lambda: audit({"id": "x", "intent": "retract", "sites": [{"id": "s", "kind": "source", "state": "archived"}]}), "unknown state")
    refuse(lambda: audit({"id": "x", "intent": "retract", "sites": [{"id": "s", "kind": "source", "state": "live"}, {"id": "s", "kind": "summary", "state": "purged"}]}), "duplicate site id")

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
            {"schema": FIXTURE_SCHEMA, "cases": [{"id": "x", "input": 1}, {"id": "x", "input": {}}]},
            {"schema": FIXTURE_SCHEMA, "cases": [{"id": ""}]},
            {"schema": FIXTURE_SCHEMA, "cases": [{"id": 1}]},
            {
                "schema": FIXTURE_SCHEMA,
                "cases": [
                    {"id": "dup", "input": {"id": "x", "intent": "retract", "sites": [{"id": "s", "kind": "source", "state": "purged"}]}},
                    {"id": "dup"},
                ],
            },
        ):
            refuse(lambda f=bad_fixture: build(f), f"build refuses malformed fixture {bad_fixture!r}")

        tampered = json.loads(json.dumps(built))
        tampered["cases"][0]["expected"]["verdict"] = "bogus"
        refuse(lambda: check(tampered), "check refuses verdict drift")
        tampered = json.loads(json.dumps(built))
        tampered["cases"][0]["expected"]["reason"] = "bogus"
        refuse(lambda: check(tampered), "check refuses unknown reason")
        tampered = json.loads(json.dumps(built))
        tampered["cases"][0]["expected"]["residualSites"] = -1
        refuse(lambda: check(tampered), "check refuses negative residual")
        tampered = json.loads(json.dumps(built))
        tampered["cases"][0]["expected"]["purgedSites"] = 99
        refuse(lambda: check(tampered), "check refuses partition drift")
        tampered = json.loads(json.dumps(built))
        tampered["cases"][0]["id"] = "renamed"
        refuse(lambda: verify(fixture, tampered), "verify refuses case-order drift")
        tampered = json.loads(json.dumps(built))
        tampered["cases"][0]["expected"]["siteCount"] = 99
        refuse(lambda: verify(fixture, tampered), "verify refuses field drift")

    refuse(lambda: check({"schema": "other"}), "check schema")
    refuse(lambda: check({"schema": SCHEMA, "cases": []}), "check empty cases")
    refuse(lambda: check({"schema": SCHEMA, "cases": [{}]}), "check missing id")
    refuse(lambda: check({"schema": SCHEMA, "cases": [{"id": "x", "expected": 1}]}), "check expected not object")
    good = built["cases"][0]["expected"]
    refuse(lambda: check({"schema": SCHEMA, "cases": [{"id": "x", "expected": {**good, "intent": "bogus"}}]}), "check unknown intent")
    refuse(lambda: check({"schema": SCHEMA, "cases": [{"id": "x", "expected": {**good, "hasSource": "yes"}}]}), "check hasSource type")
    refuse(lambda: check({"schema": SCHEMA, "cases": [{"id": "x", "expected": {**good, "residualSites": 0.5}}]}), "check residual type")
    no_res = {**good, "residualSites": 0, "verdict": "residual", "reason": "live-site"}
    refuse(lambda: check({"schema": SCHEMA, "cases": [{"id": "x", "expected": no_res}]}), "check residual reason without count")
    wrong_complete = {**good, "verdict": "complete", "reason": "replace-drops-provenance", "residualSites": 0}
    refuse(lambda: check({"schema": SCHEMA, "cases": [{"id": "x", "expected": wrong_complete}]}), "check complete with method reason")
    stray_res = {**good, "verdict": "residual", "reason": "tombstone-coverage", "residualSites": 2}
    refuse(lambda: check({"schema": SCHEMA, "cases": [{"id": "x", "expected": stray_res}]}), "check residual count on non-residual reason")
    refuse(lambda: verify({"schema": "other", "cases": []}, built), "verify fixture schema drift")
    refuse(lambda: verify({"schema": FIXTURE_SCHEMA, "cases": []}, built), "verify case count drift")
    short_fixture = {"schema": FIXTURE_SCHEMA, "cases": fixture["cases"][:1]}
    refuse(lambda: verify(short_fixture, built), "verify case count mismatch")
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
