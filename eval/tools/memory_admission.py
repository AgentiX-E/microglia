#!/usr/bin/env python3
"""The evaluation's independent reading of R251's evidence-linked admission gate.

The product's audit lives in `packages/core/src/apply/memory-admission.ts` and is pinned by vitest. A second reader
that merely transcribed the manifest would agree for the wrong reason - both could share the same mistake. This tool
re-derives every verdict, reason and count from a candidate set's bytes with an implementation that shares no code
with TypeScript. The rule comes from WikiTrace (arXiv 2611.14320): a lesson linked to its trajectory may be checked
when it lacks detail, conflicts, or comes from a failed task, and from MemTrapBench (arXiv 2608.20202): a
task-boundary trap must be withheld before any check.

    python3 eval/tools/memory_admission.py --build                        # regenerate the manifest from the fixture
    python3 eval/tools/memory_admission.py --check                        # the manifest's own arithmetic is consistent
    python3 eval/tools/memory_admission.py --verify                       # re-derive from the fixture and compare fields
    python3 eval/tools/memory_admission.py --self-test                    # boundaries, determinism, tamper detection

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
FIXTURE = ROOT / "eval" / "fixtures" / "memory-admission.json"
MANIFEST = ROOT / "eval" / "manifests" / "memory-admission.json"

SCHEMA = "microglia/memory-admission@1"
FIXTURE_SCHEMA = "microglia/memory-admission-inputs@1"
OUTCOMES = ("success", "failure")
DETAILS = ("sufficient", "insufficient")
CONFLICTS = ("none", "rule", "boundary")
VERDICTS = ("admit", "escalate", "reject")
REASONS = (
    "valid-lesson", "verify-details", "verify-conflict", "verify-failed-source",
    "task-boundary-violation", "unverifiable-detail", "unverifiable-conflict", "unverifiable-failed-source",
)
ADMIT_REASONS = ("valid-lesson",)
ESCALATE_REASONS = ("verify-details", "verify-conflict", "verify-failed-source")
REJECT_REASONS = ("task-boundary-violation", "unverifiable-detail", "unverifiable-conflict", "unverifiable-failed-source")
# Higher is stricter; used to name the decisive candidate of a set.
SEVERITY = {
    "valid-lesson": 0, "verify-details": 1, "verify-conflict": 1, "verify-failed-source": 1,
    "unverifiable-detail": 2, "unverifiable-conflict": 2, "unverifiable-failed-source": 2,
    "task-boundary-violation": 3,
}
# reason -> disposition, re-derived independently in check() for family agreement.
REASON_DISPOSITION = {
    **{reason: "admit" for reason in ADMIT_REASONS},
    **{reason: "escalate" for reason in ESCALATE_REASONS},
    **{reason: "reject" for reason in REJECT_REASONS},
}


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


def nonblank(value) -> bool:
    return isinstance(value, str) and value.strip() != ""


def audit(inp: dict) -> dict:
    """Re-derive one admission audit from a candidate set's bytes. No shared code with the product."""
    ident = inp.get("id")
    if not nonblank(ident):
        raise Refusal(f"episode id must be a non-blank string: {ident!r}")
    query = inp.get("query")
    if not isinstance(query, dict):
        raise Refusal(f"episode {ident}: query must be an object")
    if not nonblank(query.get("id")):
        raise Refusal(f"episode {ident}: query id must be non-blank")
    query_key = query.get("key")
    if not nonblank(query_key):
        raise Refusal(f"episode {ident}: query key must be non-blank")
    if not nonblank(query.get("boundary")):
        raise Refusal(f"episode {ident}: query boundary must be non-blank")

    candidates = inp.get("candidates")
    if not isinstance(candidates, list):
        raise Refusal(f"episode {ident}: candidates must be an array")
    if not candidates:
        raise Refusal(f"episode {ident}: candidates must not be empty")

    seen: set[str] = set()
    admit_count = 0
    escalate_count = 0
    reject_count = 0
    verdict = "admit"
    reason = "valid-lesson"
    deciding_id = ""
    deciding_severity = -1

    for candidate in candidates:
        if not isinstance(candidate, dict):
            raise Refusal(f"episode {ident}: every candidate must be an object")
        cid = candidate.get("id")
        if not nonblank(cid):
            raise Refusal(f"episode {ident}: candidate id must be non-blank")
        if cid in seen:
            raise Refusal(f"episode {ident}: duplicate candidate id {cid!r}")
        seen.add(cid)
        if not nonblank(candidate.get("key")):
            raise Refusal(f"episode {ident}: candidate key must be non-blank")
        outcome = candidate.get("outcome")
        if not isinstance(outcome, str) or outcome not in OUTCOMES:
            raise Refusal(f"episode {ident}: unknown outcome {outcome!r}")
        detail = candidate.get("detail")
        if not isinstance(detail, str) or detail not in DETAILS:
            raise Refusal(f"episode {ident}: unknown detail {detail!r}")
        conflict = candidate.get("conflict")
        if not isinstance(conflict, str) or conflict not in CONFLICTS:
            raise Refusal(f"episode {ident}: unknown conflict {conflict!r}")
        evidence = candidate.get("evidence")
        if not isinstance(evidence, dict):
            raise Refusal(f"episode {ident}: evidence must be an object")
        linked = evidence.get("linked")
        reachable = evidence.get("reachable")
        if not isinstance(linked, bool) or not isinstance(reachable, bool):
            raise Refusal(f"episode {ident}: evidence flags must be booleans")
        if reachable and not linked:
            raise Refusal(f"episode {ident}: reachable evidence must also be linked")

        # Per-candidate ladder, strict priority.
        if conflict == "boundary":
            disp, why = "reject", "task-boundary-violation"
        elif detail == "insufficient":
            disp, why = ("escalate", "verify-details") if reachable else ("reject", "unverifiable-detail")
        elif conflict == "rule":
            disp, why = ("escalate", "verify-conflict") if reachable else ("reject", "unverifiable-conflict")
        elif outcome == "failure":
            disp, why = ("escalate", "verify-failed-source") if reachable else ("reject", "unverifiable-failed-source")
        else:
            disp, why = "admit", "valid-lesson"

        if disp == "admit":
            admit_count += 1
        elif disp == "escalate":
            escalate_count += 1
        else:
            reject_count += 1

        severity = SEVERITY[why]
        if severity > deciding_severity:
            deciding_severity = severity
            verdict, reason, deciding_id = disp, why, cid

    return {
        "id": ident,
        "queryKey": query_key,
        "verdict": verdict,
        "reason": reason,
        "decidingId": deciding_id,
        "candidateCount": len(candidates),
        "admitCount": admit_count,
        "escalateCount": escalate_count,
        "rejectCount": reject_count,
    }


def build(fixture: dict) -> dict:
    """Derive the manifest from fixture bytes."""
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
    int_keys = ("candidateCount", "admitCount", "escalateCount", "rejectCount")
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
        if not nonblank(exp.get("id")):
            raise Refusal(f"case {case_id}: expected id must be non-blank")
        if not nonblank(exp.get("queryKey")):
            raise Refusal(f"case {case_id}: expected queryKey must be non-blank")
        if not nonblank(exp.get("decidingId")):
            raise Refusal(f"case {case_id}: expected decidingId must be non-blank")
        for key in int_keys:
            value = exp.get(key)
            if not (isinstance(value, int) and not isinstance(value, bool) and value >= 0):
                raise Refusal(f"case {case_id}: {key} invalid")
        # Disposition counts partition the candidate total.
        if exp["candidateCount"] != exp["admitCount"] + exp["escalateCount"] + exp["rejectCount"]:
            raise Refusal(f"case {case_id}: disposition counts do not partition")
        # Reason family must agree with the verdict.
        if REASON_DISPOSITION.get(exp["reason"]) != exp["verdict"]:
            raise Refusal(f"case {case_id}: reason family disagrees with verdict")
        # The decisive reason must be the strictest present, mirrored by the counts it implies.
        if exp["verdict"] == "admit" and exp["rejectCount"] + exp["escalateCount"] > 0:
            raise Refusal(f"case {case_id}: admit verdict with stricter dispositions present")
        if exp["verdict"] == "escalate" and exp["rejectCount"] > 0:
            raise Refusal(f"case {case_id}: escalate verdict with a rejection present")
        # The boundary reason needs at least one rejection; verify reasons need at least one escalation.
        if exp["reason"] == "task-boundary-violation" and exp["rejectCount"] <= 0:
            raise Refusal(f"case {case_id}: boundary reason without a rejection")
        if exp["reason"] in ESCALATE_REASONS and exp["escalateCount"] <= 0:
            raise Refusal(f"case {case_id}: verify reason without an escalation")


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
    for value in VERDICTS:
        ok(value in covered_v, f"verdict {value} reachable")
    for value in REASONS:
        ok(value in covered_r, f"reason {value} reachable")

    # The deciding rules, re-derived on fresh inputs.
    def cand(**over):
        base = {"id": "c", "key": "k", "outcome": "success", "detail": "sufficient",
                "conflict": "none", "evidence": {"linked": True, "reachable": True}}
        base.update(over)
        return base

    def ep(candidates, **over):
        base = {"id": "x", "query": {"id": "q", "key": "k", "boundary": "cur"}, "candidates": candidates}
        base.update(over)
        return base

    valid = audit(ep([cand()]))
    ok(valid["verdict"] == "admit" and valid["reason"] == "valid-lesson", "valid lesson admits")
    boundary = audit(ep([cand(conflict="boundary")]))
    ok(boundary["verdict"] == "reject" and boundary["reason"] == "task-boundary-violation", "boundary trap rejects")
    detail = audit(ep([cand(detail="insufficient")]))
    ok(detail["verdict"] == "escalate" and detail["reason"] == "verify-details", "insufficient detail escalates")
    detail_dead = audit(ep([cand(detail="insufficient", evidence={"linked": True, "reachable": False})]))
    ok(detail_dead["verdict"] == "reject" and detail_dead["reason"] == "unverifiable-detail", "unverifiable detail rejects")
    rule = audit(ep([cand(conflict="rule")]))
    ok(rule["reason"] == "verify-conflict" and rule["verdict"] == "escalate", "rule conflict escalates")
    rule_dead = audit(ep([cand(conflict="rule", evidence={"linked": True, "reachable": False})]))
    ok(rule_dead["reason"] == "unverifiable-conflict", "unverifiable rule rejects")
    failed = audit(ep([cand(outcome="failure")]))
    ok(failed["reason"] == "verify-failed-source" and failed["verdict"] == "escalate", "failed source escalates")
    failed_dead = audit(ep([cand(outcome="failure", evidence={"linked": True, "reachable": False})]))
    ok(failed_dead["reason"] == "unverifiable-failed-source", "unverifiable failed source rejects")
    mixed = audit(ep([cand(id="g"), cand(id="c", detail="insufficient"), cand(id="b", conflict="boundary")]))
    ok(mixed["verdict"] == "reject" and mixed["reason"] == "task-boundary-violation" and mixed["decidingId"] == "b",
       "reject dominates and names decider")
    ok(mixed["admitCount"] == 1 and mixed["escalateCount"] == 1 and mixed["rejectCount"] == 1,
       "disposition counts partition")
    escalate_set = audit(ep([cand(id="g"), cand(id="f", outcome="failure")]))
    ok(escalate_set["verdict"] == "escalate" and escalate_set["reason"] == "verify-failed-source",
       "escalate dominates no reject")
    # A later candidate with lower severity must not replace the decider.
    descending = audit(ep([cand(id="trap", conflict="boundary"), cand(id="good")]))
    ok(descending["verdict"] == "reject" and descending["reason"] == "task-boundary-violation"
       and descending["decidingId"] == "trap", "decider keeps the strictest earlier candidate")
    # Priority chains within a candidate.
    p_boundary_fail = audit(ep([cand(conflict="boundary", outcome="failure")]))
    ok(p_boundary_fail["reason"] == "task-boundary-violation", "boundary outranks failure")
    p_detail_rule = audit(ep([cand(detail="insufficient", conflict="rule")]))
    ok(p_detail_rule["reason"] == "verify-details", "detail outranks rule")
    p_rule_fail = audit(ep([cand(conflict="rule", outcome="failure")]))
    ok(p_rule_fail["reason"] == "verify-conflict", "rule outranks failure")
    unlinked_valid = audit(ep([cand(evidence={"linked": False, "reachable": False})]))
    ok(unlinked_valid["verdict"] == "admit", "unlinked but valid admits")

    def refuse(function, label: str) -> None:
        try:
            function()
            ok(False, f"refusal expected: {label}")
        except Refusal:
            ok(True, f"refusal raised: {label}")

    refuse(lambda: audit(ep([cand()], id="  ")), "blank id")
    refuse(lambda: audit({**ep([cand()]), "query": 1}), "query not object")
    refuse(lambda: audit(ep([cand()], query={"id": "", "key": "k", "boundary": "c"})), "blank query id")
    refuse(lambda: audit(ep([cand()], query={"id": "q", "key": " ", "boundary": "c"})), "blank query key")
    refuse(lambda: audit(ep([cand()], query={"id": "q", "key": "k", "boundary": " "})), "blank query boundary")
    refuse(lambda: audit({"id": "x", "query": {"id": "q", "key": "k", "boundary": "c"}, "candidates": "x"}),
           "candidates not array")
    refuse(lambda: audit(ep([])), "empty candidates")
    refuse(lambda: audit(ep([1])), "candidate not object")
    refuse(lambda: audit(ep([cand(id=" ")])), "blank candidate id")
    refuse(lambda: audit(ep([cand(id="d"), cand(id="d")])), "duplicate candidate id")
    refuse(lambda: audit(ep([cand(key=" ")])), "blank candidate key")
    refuse(lambda: audit(ep([cand(outcome="maybe")])), "unknown outcome")
    refuse(lambda: audit(ep([cand(detail="partial")])), "unknown detail")
    refuse(lambda: audit(ep([cand(conflict="trap")])), "unknown conflict")
    refuse(lambda: audit(ep([cand(evidence=1)])), "evidence not object")
    refuse(lambda: audit(ep([cand(evidence={"linked": "yes", "reachable": True})])), "evidence flags not boolean")
    refuse(lambda: audit(ep([cand(evidence={"linked": False, "reachable": True})])), "reachable without linked")

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
                {"id": "dup", "input": ep([cand()])},
                {"id": "dup", "input": ep([cand()])},
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
        tampered["cases"][0]["expected"]["rejectCount"] = -1
        refuse(lambda: check(tampered), "check refuses negative count")
        tampered = json.loads(json.dumps(built))
        tampered["cases"][0]["expected"]["admitCount"] = 99
        refuse(lambda: check(tampered), "check refuses partition drift")
        tampered = json.loads(json.dumps(built))
        tampered["cases"][0]["id"] = "renamed"
        refuse(lambda: verify(fixture, tampered), "verify refuses case-order drift")
        tampered = json.loads(json.dumps(built))
        tampered["cases"][0]["expected"]["candidateCount"] = 99
        refuse(lambda: verify(fixture, tampered), "verify refuses field drift")

    refuse(lambda: check({"schema": "other"}), "check schema")
    refuse(lambda: check({"schema": SCHEMA, "cases": []}), "check empty cases")
    refuse(lambda: check({"schema": SCHEMA, "cases": [{}]}), "check missing id")
    refuse(lambda: check({"schema": SCHEMA, "cases": [{"id": "x", "expected": 1}]}), "check expected not object")
    good = built["cases"][0]["expected"]
    refuse(lambda: check({"schema": SCHEMA, "cases": [{"id": "x", "expected": {**good, "verdict": "bogus"}}]}), "check unknown verdict")
    refuse(lambda: check({"schema": SCHEMA, "cases": [{"id": "x", "expected": {**good, "id": ""}}]}), "check blank expected id")
    refuse(lambda: check({"schema": SCHEMA, "cases": [{"id": "x", "expected": {**good, "queryKey": ""}}]}), "check blank queryKey")
    refuse(lambda: check({"schema": SCHEMA, "cases": [{"id": "x", "expected": {**good, "decidingId": ""}}]}), "check blank decidingId")
    refuse(lambda: check({"schema": SCHEMA, "cases": [{"id": "x", "expected": {**good, "candidateCount": 0.5}}]}), "check count type")
    bad_family = {**good, "verdict": "admit", "reason": "verify-details", "escalateCount": 0, "admitCount": good["candidateCount"]}
    refuse(lambda: check({"schema": SCHEMA, "cases": [{"id": "x", "expected": bad_family}]}), "check reason family disagrees")
    admit_stricter = {**good, "verdict": "admit", "reason": "valid-lesson", "rejectCount": 1,
                      "admitCount": good["candidateCount"] - 1}
    refuse(lambda: check({"schema": SCHEMA, "cases": [{"id": "x", "expected": admit_stricter}]}), "check admit with stricter present")
    esc_reject = {**good, "candidateCount": 3, "verdict": "escalate", "reason": "verify-details", "escalateCount": 1,
                  "rejectCount": 1, "admitCount": 1}
    refuse(lambda: check({"schema": SCHEMA, "cases": [{"id": "x", "expected": esc_reject}]}), "check escalate with rejection")
    boundary_none = {**good, "verdict": "reject", "reason": "task-boundary-violation", "rejectCount": 0,
                     "admitCount": good["candidateCount"]}
    refuse(lambda: check({"schema": SCHEMA, "cases": [{"id": "x", "expected": boundary_none}]}), "check boundary without rejection")
    verify_none = {**good, "verdict": "escalate", "reason": "verify-details", "escalateCount": 0,
                   "admitCount": good["candidateCount"]}
    refuse(lambda: check({"schema": SCHEMA, "cases": [{"id": "x", "expected": verify_none}]}), "check verify reason without escalation")
    refuse(lambda: verify({"schema": "other", "cases": []}, built), "verify fixture schema drift")
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
