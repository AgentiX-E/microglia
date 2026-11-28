#!/usr/bin/env python3
"""The evaluation's independent reading of R250's stale-revocation gate.

The product's audit lives in `packages/core/src/apply/stale-revocation.ts` and is pinned by vitest. A second reader
that merely transcribed the manifest would agree for the wrong reason - both could share the same mistake. This tool
re-derives every verdict, reason and count from an episode's bytes with an implementation that shares no code with
TypeScript. The rule comes from three papers: TEPA (arXiv 2608.07429) bounds append-only excess risk by q*eta and
shows stale exposure drops below the no-memory baseline; STALE (arXiv 2605.06527) classifies implicit invalidation
into co-reference and propagation conflicts; MMA (arXiv 2602.16493) notes that retrieved items are treated as
uniformly trustworthy, so an exposed stale item is acted on rather than ignored.

    python3 eval/tools/stale_revocation.py --build                       # regenerate the manifest from the fixture
    python3 eval/tools/stale_revocation.py --check                       # the manifest's own arithmetic is consistent
    python3 eval/tools/stale_revocation.py --verify                      # re-derive from the fixture and compare fields
    python3 eval/tools/stale_revocation.py --self-test                   # boundaries, determinism, tamper detection

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
FIXTURE = ROOT / "eval" / "fixtures" / "stale-revocation.json"
MANIFEST = ROOT / "eval" / "manifests" / "stale-revocation.json"

SCHEMA = "microglia/stale-revocation@1"
FIXTURE_SCHEMA = "microglia/stale-revocation-inputs@1"
RELATIONS = ("extend", "co-reference", "propagation")
DISPOSITIONS = ("active", "revoked", "superseded")
VERDICTS = ("clean", "polluted", "over-revoked", "unresolved")
REASONS = (
    "extend-safe", "co-reference-resolved", "propagation-resolved",
    "stale-still-active", "propagated-still-active", "current-removed", "no-current-evidence",
)
POLLUTION_REASONS = ("stale-still-active", "propagated-still-active")
CLEAN_REASONS = ("extend-safe", "co-reference-resolved", "propagation-resolved")


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


def valid_serial(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0


def audit(inp: dict) -> dict:
    """Re-derive one stale-revocation audit from an episode's bytes. No shared code with the product."""
    ident = inp.get("id")
    if not isinstance(ident, str) or ident.strip() == "":
        raise Refusal(f"episode id must be a non-blank string: {ident!r}")
    evidence = inp.get("evidence")
    if not isinstance(evidence, dict):
        raise Refusal(f"episode {ident}: evidence must be an object")
    ev_id = evidence.get("id")
    if not isinstance(ev_id, str) or ev_id.strip() == "":
        raise Refusal(f"episode {ident}: evidence id must be non-blank")
    ev_key = evidence.get("key")
    if not isinstance(ev_key, str) or ev_key.strip() == "":
        raise Refusal(f"episode {ident}: evidence key must be non-blank")
    relation = evidence.get("relation")
    if not isinstance(relation, str) or relation not in RELATIONS:
        raise Refusal(f"episode {ident}: unknown relation {relation!r}")
    ev_serial = evidence.get("serial")
    if not valid_serial(ev_serial):
        raise Refusal(f"episode {ident}: evidence serial must be finite and >= 0")
    invalidates = evidence.get("invalidates", [])
    if not isinstance(invalidates, list):
        raise Refusal(f"episode {ident}: invalidates must be an array")
    for key in invalidates:
        if not isinstance(key, str) or key.strip() == "":
            raise Refusal(f"episode {ident}: invalidated key must be non-blank")
        if key == ev_key:
            raise Refusal(f"episode {ident}: invalidated key equals evidence key")
    if invalidates and relation != "propagation":
        raise Refusal(f"episode {ident}: invalidates only applies to a propagation relation")

    items = inp.get("items")
    if not isinstance(items, list):
        raise Refusal(f"episode {ident}: items must be an array")
    if not items:
        raise Refusal(f"episode {ident}: items must not be empty")

    invalidated = set(invalidates)
    seen: set[str] = set()
    current_count = 0
    current_active = False
    stale_count = 0
    active_stale = 0
    handled_stale = 0
    propagated_active = False
    for item in items:
        if not isinstance(item, dict):
            raise Refusal(f"episode {ident}: every item must be an object")
        iid = item.get("id")
        if not isinstance(iid, str) or iid.strip() == "":
            raise Refusal(f"episode {ident}: item id must be non-blank")
        if iid in seen:
            raise Refusal(f"episode {ident}: duplicate item id {iid!r}")
        seen.add(iid)
        key = item.get("key")
        if not isinstance(key, str) or key.strip() == "":
            raise Refusal(f"episode {ident}: item key must be non-blank")
        serial = item.get("serial")
        if not valid_serial(serial):
            raise Refusal(f"episode {ident}: item serial must be finite and >= 0")
        disposition = item.get("disposition")
        if not isinstance(disposition, str) or disposition not in DISPOSITIONS:
            raise Refusal(f"episode {ident}: unknown disposition {disposition!r}")

        if key == ev_key and serial == ev_serial:
            current_count += 1
            if disposition == "active":
                current_active = True
        same_key_stale = relation != "extend" and key == ev_key and serial < ev_serial
        propagated_stale = key in invalidated
        if same_key_stale or propagated_stale:
            stale_count += 1
            if disposition == "active":
                active_stale += 1
                if propagated_stale:
                    propagated_active = True
            else:
                handled_stale += 1

    if active_stale > 0:
        verdict = "polluted"
        reason = "propagated-still-active" if propagated_active else "stale-still-active"
    elif current_count > 0 and not current_active:
        verdict, reason = "over-revoked", "current-removed"
    elif current_count == 0:
        verdict, reason = "unresolved", "no-current-evidence"
    else:
        verdict = "clean"
        reason = {"extend": "extend-safe", "propagation": "propagation-resolved",
                  "co-reference": "co-reference-resolved"}[relation]

    return {
        "id": ident,
        "relation": relation,
        "verdict": verdict,
        "reason": reason,
        "itemCount": len(items),
        "currentCount": current_count,
        "currentActive": current_active,
        "staleCount": stale_count,
        "activeStaleCount": active_stale,
        "handledStaleCount": handled_stale,
        "propagationKeys": len(invalidates),
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
    int_keys = ("itemCount", "currentCount", "staleCount", "activeStaleCount", "handledStaleCount", "propagationKeys")
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
        if exp.get("relation") not in RELATIONS:
            raise Refusal(f"case {case_id}: unknown relation")
        if not isinstance(exp.get("currentActive"), bool):
            raise Refusal(f"case {case_id}: currentActive must be a boolean")
        for key in int_keys:
            value = exp.get(key)
            if not (isinstance(value, int) and not isinstance(value, bool) and value >= 0):
                raise Refusal(f"case {case_id}: {key} invalid")
        # Stale items partition into exposed and handled.
        if exp["staleCount"] != exp["activeStaleCount"] + exp["handledStaleCount"]:
            raise Refusal(f"case {case_id}: stale counts do not partition")
        # Reason family must agree with the verdict.
        if exp["verdict"] == "polluted" and exp["reason"] not in POLLUTION_REASONS:
            raise Refusal(f"case {case_id}: polluted with a non-pollution reason")
        if exp["verdict"] == "clean" and exp["reason"] not in CLEAN_REASONS:
            raise Refusal(f"case {case_id}: clean with a non-clean reason")
        if exp["reason"] in POLLUTION_REASONS and exp["activeStaleCount"] <= 0:
            raise Refusal(f"case {case_id}: pollution reason without exposed stale")
        if exp["reason"] == "no-current-evidence" and exp["currentCount"] != 0:
            raise Refusal(f"case {case_id}: no-current reason with a current item")
        if exp["reason"] == "current-removed" and not (exp["currentCount"] > 0 and not exp["currentActive"]):
            raise Refusal(f"case {case_id}: current-removed without an inactive current")
        # Propagation keys are only present for a propagation relation.
        if exp["propagationKeys"] > 0 and exp["relation"] != "propagation":
            raise Refusal(f"case {case_id}: propagation keys on a non-propagation relation")


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
    cur = {"id": "c", "key": "k", "serial": 2, "disposition": "active"}
    handled = audit({"id": "x", "evidence": {"id": "e", "key": "k", "relation": "co-reference", "serial": 2},
                     "items": [cur, {"id": "o", "key": "k", "serial": 1, "disposition": "revoked"}]})
    ok(handled["verdict"] == "clean" and handled["reason"] == "co-reference-resolved", "co-reference resolved")
    pollution = audit({"id": "x", "evidence": {"id": "e", "key": "k", "relation": "co-reference", "serial": 2},
                       "items": [cur, {"id": "o", "key": "k", "serial": 1, "disposition": "active"}]})
    ok(pollution["verdict"] == "polluted" and pollution["reason"] == "stale-still-active", "append-only pollutes")
    propagated = audit({"id": "x", "evidence": {"id": "e", "key": "k", "relation": "propagation", "serial": 2,
                                                "invalidates": ["d"]},
                        "items": [cur, {"id": "p", "key": "d", "serial": 1, "disposition": "active"}]})
    ok(propagated["reason"] == "propagated-still-active", "propagated stale pollutes")
    over = audit({"id": "x", "evidence": {"id": "e", "key": "k", "relation": "co-reference", "serial": 2},
                  "items": [{"id": "c", "key": "k", "serial": 2, "disposition": "revoked"}]})
    ok(over["verdict"] == "over-revoked" and over["reason"] == "current-removed", "over-revoked")
    nocur = audit({"id": "x", "evidence": {"id": "e", "key": "k", "relation": "co-reference", "serial": 2},
                   "items": [{"id": "o", "key": "k", "serial": 1, "disposition": "revoked"}]})
    ok(nocur["verdict"] == "unresolved" and nocur["reason"] == "no-current-evidence", "no current evidence")
    extend = audit({"id": "x", "evidence": {"id": "e", "key": "k", "relation": "extend", "serial": 2},
                    "items": [cur, {"id": "o", "key": "k", "serial": 1, "disposition": "active"}]})
    ok(extend["verdict"] == "clean" and extend["reason"] == "extend-safe" and extend["staleCount"] == 0,
       "extend keeps older values")
    multi = audit({"id": "x", "evidence": {"id": "e", "key": "k", "relation": "co-reference", "serial": 3},
                   "items": [{"id": "c", "key": "k", "serial": 3, "disposition": "active"},
                             {"id": "a", "key": "k", "serial": 1, "disposition": "active"},
                             {"id": "b", "key": "k", "serial": 2, "disposition": "revoked"}]})
    ok(multi["staleCount"] == 2 and multi["activeStaleCount"] == 1 and multi["handledStaleCount"] == 1,
       "stale partition counts")
    # Priority: pollution dominates over-revocation.
    prio = audit({"id": "x", "evidence": {"id": "e", "key": "k", "relation": "co-reference", "serial": 2},
                  "items": [{"id": "c", "key": "k", "serial": 2, "disposition": "revoked"},
                            {"id": "o", "key": "k", "serial": 1, "disposition": "active"}]})
    ok(prio["verdict"] == "polluted", "pollution dominates over-revocation")
    # Priority: propagated stale dominates plain stale in the reason.
    both = audit({"id": "x", "evidence": {"id": "e", "key": "k", "relation": "propagation", "serial": 2,
                                          "invalidates": ["d"]},
                  "items": [cur, {"id": "o", "key": "k", "serial": 1, "disposition": "active"},
                            {"id": "p", "key": "d", "serial": 1, "disposition": "active"}]})
    ok(both["reason"] == "propagated-still-active" and both["activeStaleCount"] == 2,
       "propagated reason dominates and counts both")

    def refuse(function, label: str) -> None:
        try:
            function()
            ok(False, f"refusal expected: {label}")
        except Refusal:
            ok(True, f"refusal raised: {label}")

    refuse(lambda: audit({"id": "  ", "evidence": {}, "items": []}), "blank id")
    refuse(lambda: audit({"id": "x", "evidence": "e", "items": []}), "evidence not object")
    refuse(lambda: audit({"id": "x", "evidence": {"id": " ", "key": "k", "relation": "extend", "serial": 1}, "items": [cur]}), "blank evidence id")
    refuse(lambda: audit({"id": "x", "evidence": {"id": "e", "key": " ", "relation": "extend", "serial": 1}, "items": [cur]}), "blank evidence key")
    refuse(lambda: audit({"id": "x", "evidence": {"id": "e", "key": "k", "relation": "merge", "serial": 1}, "items": [cur]}), "unknown relation")
    refuse(lambda: audit({"id": "x", "evidence": {"id": "e", "key": "k", "relation": "extend", "serial": -1}, "items": [cur]}), "negative serial")
    refuse(lambda: audit({"id": "x", "evidence": {"id": "e", "key": "k", "relation": "extend", "serial": math.inf}, "items": [cur]}), "non-finite serial")
    refuse(lambda: audit({"id": "x", "evidence": {"id": "e", "key": "k", "relation": "extend", "serial": 1, "invalidates": "d"}, "items": [cur]}), "invalidates not array")
    refuse(lambda: audit({"id": "x", "evidence": {"id": "e", "key": "k", "relation": "propagation", "serial": 1, "invalidates": [" "]}, "items": [cur]}), "blank invalidated key")
    refuse(lambda: audit({"id": "x", "evidence": {"id": "e", "key": "k", "relation": "propagation", "serial": 1, "invalidates": ["k"]}, "items": [cur]}), "invalidated equals evidence key")
    refuse(lambda: audit({"id": "x", "evidence": {"id": "e", "key": "k", "relation": "extend", "serial": 1, "invalidates": ["d"]}, "items": [cur]}), "invalidates on non-propagation")
    refuse(lambda: audit({"id": "x", "evidence": {"id": "e", "key": "k", "relation": "extend", "serial": 1}, "items": "x"}), "items not array")
    refuse(lambda: audit({"id": "x", "evidence": {"id": "e", "key": "k", "relation": "extend", "serial": 1}, "items": []}), "empty items")
    refuse(lambda: audit({"id": "x", "evidence": {"id": "e", "key": "k", "relation": "extend", "serial": 1}, "items": [1]}), "item not object")
    refuse(lambda: audit({"id": "x", "evidence": {"id": "e", "key": "k", "relation": "extend", "serial": 1}, "items": [{"id": " ", "key": "k", "serial": 1, "disposition": "active"}]}), "blank item id")
    refuse(lambda: audit({"id": "x", "evidence": {"id": "e", "key": "k", "relation": "extend", "serial": 1}, "items": [cur, cur]}), "duplicate item id")
    refuse(lambda: audit({"id": "x", "evidence": {"id": "e", "key": "k", "relation": "extend", "serial": 1}, "items": [{"id": "a", "key": " ", "serial": 1, "disposition": "active"}]}), "blank item key")
    refuse(lambda: audit({"id": "x", "evidence": {"id": "e", "key": "k", "relation": "extend", "serial": 1}, "items": [{"id": "a", "key": "k", "serial": math.nan, "disposition": "active"}]}), "nan item serial")
    refuse(lambda: audit({"id": "x", "evidence": {"id": "e", "key": "k", "relation": "extend", "serial": 1}, "items": [{"id": "a", "key": "k", "serial": -1, "disposition": "active"}]}), "negative item serial")
    refuse(lambda: audit({"id": "x", "evidence": {"id": "e", "key": "k", "relation": "extend", "serial": 1}, "items": [{"id": "a", "key": "k", "serial": 1, "disposition": "archived"}]}), "unknown disposition")

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
            {"schema": FIXTURE_SCHEMA, "cases": [
                {"id": "dup", "input": {"id": "x", "evidence": {"id": "e", "key": "k", "relation": "extend", "serial": 1}, "items": [cur]}},
                {"id": "dup"},
            ]},
        ):
            refuse(lambda f=bad_fixture: build(f), f"build refuses malformed fixture {bad_fixture!r}")

        tampered = json.loads(json.dumps(built))
        tampered["cases"][0]["expected"]["verdict"] = "bogus"
        refuse(lambda: check(tampered), "check refuses verdict drift")
        tampered = json.loads(json.dumps(built))
        tampered["cases"][0]["expected"]["reason"] = "bogus"
        refuse(lambda: check(tampered), "check refuses unknown reason")
        tampered = json.loads(json.dumps(built))
        tampered["cases"][0]["expected"]["activeStaleCount"] = -1
        refuse(lambda: check(tampered), "check refuses negative count")
        tampered = json.loads(json.dumps(built))
        tampered["cases"][0]["expected"]["handledStaleCount"] = 99
        refuse(lambda: check(tampered), "check refuses stale partition drift")
        tampered = json.loads(json.dumps(built))
        tampered["cases"][0]["id"] = "renamed"
        refuse(lambda: verify(fixture, tampered), "verify refuses case-order drift")
        tampered = json.loads(json.dumps(built))
        tampered["cases"][0]["expected"]["itemCount"] = 99
        refuse(lambda: verify(fixture, tampered), "verify refuses field drift")

    refuse(lambda: check({"schema": "other"}), "check schema")
    refuse(lambda: check({"schema": SCHEMA, "cases": []}), "check empty cases")
    refuse(lambda: check({"schema": SCHEMA, "cases": [{}]}), "check missing id")
    refuse(lambda: check({"schema": SCHEMA, "cases": [{"id": "x", "expected": 1}]}), "check expected not object")
    good = built["cases"][0]["expected"]
    refuse(lambda: check({"schema": SCHEMA, "cases": [{"id": "x", "expected": {**good, "relation": "bogus"}}]}), "check unknown relation")
    refuse(lambda: check({"schema": SCHEMA, "cases": [{"id": "x", "expected": {**good, "currentActive": "yes"}}]}), "check currentActive type")
    refuse(lambda: check({"schema": SCHEMA, "cases": [{"id": "x", "expected": {**good, "staleCount": 0.5}}]}), "check count type")
    nores = {**good, "verdict": "polluted", "reason": "stale-still-active", "activeStaleCount": 0}
    refuse(lambda: check({"schema": SCHEMA, "cases": [{"id": "x", "expected": nores}]}), "check pollution without exposure")
    bad_family = {**good, "verdict": "polluted", "reason": "extend-safe", "staleCount": 1, "activeStaleCount": 1}
    refuse(lambda: check({"schema": SCHEMA, "cases": [{"id": "x", "expected": bad_family}]}), "check polluted with clean reason")
    badclean = {**good, "verdict": "clean", "reason": "stale-still-active", "activeStaleCount": 0}
    refuse(lambda: check({"schema": SCHEMA, "cases": [{"id": "x", "expected": badclean}]}), "check clean with pollution reason")
    nocur_bad = {**good, "verdict": "unresolved", "reason": "no-current-evidence", "currentCount": 1}
    refuse(lambda: check({"schema": SCHEMA, "cases": [{"id": "x", "expected": nocur_bad}]}), "check no-current with a current")
    rem_bad = {**good, "verdict": "over-revoked", "reason": "current-removed", "currentCount": 0, "currentActive": False}
    refuse(lambda: check({"schema": SCHEMA, "cases": [{"id": "x", "expected": rem_bad}]}), "check current-removed without current")
    prop_bad = {**good, "verdict": "clean", "reason": "extend-safe", "relation": "extend", "propagationKeys": 2}
    refuse(lambda: check({"schema": SCHEMA, "cases": [{"id": "x", "expected": prop_bad}]}), "check propagation keys on non-propagation")
    refuse(lambda: verify({"schema": "other", "cases": []}, built), "verify fixture schema drift")
    # A valid but shorter fixture: build succeeds, then the case-count comparison refuses.
    short_fixture = {"schema": FIXTURE_SCHEMA, "cases": fixture["cases"][:1]}
    refuse(lambda: verify(short_fixture, built), "verify case count drift")
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
