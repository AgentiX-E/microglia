#!/usr/bin/env python3
"""The evaluation's independent reading of R255's self-consistency write-admission gate.

The product's judgement lives in `packages/core/src/apply/consistency-admission.ts` and is pinned by vitest. A second
reader that merely transcribed the manifest would agree for the wrong reason — both could share the same mistake.
This tool re-derives every threshold, support, verdict, reason, deciding candidate, count and ablation from a
candidate set's bytes with an implementation that shares no code with TypeScript. The mechanism follows ConsistencyGate
(ConsistencyGate, arXiv 2607.22962): K-sample soft-support mean with tau=0.7/K=5 recommended, a single-pass yes/no
log-probability softmax, and an occupancy-scaled adaptive threshold tau* = tauMin + (tauMax-tauMin)*|M|/C.

    python3 eval/tools/consistency_admission.py --build
    python3 eval/tools/consistency_admission.py --check
    python3 eval/tools/consistency_admission.py --verify
    python3 eval/tools/consistency_admission.py --self-test

`--manifest` and `--fixture` redirect every mode so the self-test can drive distinct tampers against temporary
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
FIXTURE = ROOT / "eval" / "fixtures" / "consistency-admission.json"
MANIFEST = ROOT / "eval" / "manifests" / "consistency-admission.json"

VERDICTS = ("admit", "reject")
REASONS = ("supported", "insufficient-support", "contradicted")
SEVERITY = {"supported": 0, "insufficient-support": 1, "contradicted": 2}
KINDS = ("samples", "logprob")
MODES = ("fixed", "adaptive")


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


def is_milli(value) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= 1000


def is_count(value) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def finite(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def milli(value: float) -> int:
    """Match JS Math.round (half up); Python's round is banker's and would disagree at .5."""
    return int(value * 1000 + 0.5)


def resolve_threshold(threshold, episode_id: str) -> int:
    if not isinstance(threshold, dict) or isinstance(threshold, list):
        raise Refusal("threshold must be an object")
    mode = threshold.get("mode")
    if mode == "fixed":
        tau = threshold.get("tauMilli")
        if not is_milli(tau):
            raise Refusal("fixed tauMilli must be an integer in [0,1000]")
        return tau
    if mode == "adaptive":
        lo = threshold.get("tauMinMilli")
        hi = threshold.get("tauMaxMilli")
        if not is_milli(lo) or not is_milli(hi):
            raise Refusal("adaptive taus must be integers in [0,1000]")
        if lo > hi:
            raise Refusal("tauMinMilli must not exceed tauMaxMilli")
        size = threshold.get("memorySize")
        capacity = threshold.get("capacity")
        if not is_count(size):
            raise Refusal("memorySize must be a non-negative integer")
        if not isinstance(capacity, int) or isinstance(capacity, bool) or capacity <= 0:
            raise Refusal("capacity must be a positive integer")
        occupancy = min(1.0, size / capacity)
        return lo + int((hi - lo) * occupancy + 0.5)
    raise Refusal(f"unknown threshold mode {mode}")


def support_of(evidence, episode_id: str, candidate_id: str) -> int:
    if not isinstance(evidence, dict) or isinstance(evidence, list):
        raise Refusal("evidence must be an object")
    kind = evidence.get("kind")
    if kind == "samples":
        values = evidence.get("supportsMilli")
        if not isinstance(values, list) or len(values) == 0:
            raise Refusal("samples must be a non-empty array")
        if not all(is_milli(v) for v in values):
            raise Refusal("each sample must be an integer in [0,1000]")
        return int(sum(values) / len(values) + 0.5)
    if kind == "logprob":
        yes = evidence.get("yesLog")
        no = evidence.get("noLog")
        if not finite(yes) or not finite(no):
            raise Refusal("logprobs must be finite numbers")
        largest = max(yes, no)
        yes_weight = math.exp(yes - largest)
        no_weight = math.exp(no - largest)
        return int(1000 * yes_weight / (yes_weight + no_weight) + 0.5)
    raise Refusal(f"unknown evidence kind {kind}")


def compose(candidates: list, support_by_id: dict, threshold: int) -> dict:
    """Strictest reason wins; ties go to the first candidate. An empty set admits."""
    admit = reject = 0
    deciding_severity = -1
    deciding_id = ""
    deciding_reason = "supported"
    deciding_support = 0
    for candidate in candidates:
        support = support_by_id[candidate["id"]]
        if support >= threshold:
            reason = "supported"
        elif support == 0:
            reason = "contradicted"
        else:
            reason = "insufficient-support"
        if reason == "supported":
            admit += 1
        else:
            reject += 1
        severity = SEVERITY[reason]
        if severity > deciding_severity:
            deciding_severity = severity
            deciding_id = candidate["id"]
            deciding_reason = reason
            deciding_support = support
    return {
        "verdict": "reject" if reject > 0 else "admit",
        "reason": deciding_reason,
        "decidingId": deciding_id,
        "decidingReason": deciding_reason,
        "decidingSupportMilli": deciding_support,
        "admitCount": admit,
        "rejectCount": reject,
    }


def audit(inp: dict) -> dict:
    """Re-derive one episode's reading from its bytes. Refuses rather than defaults on any defect."""
    if not nonblank(inp.get("id")):
        raise Refusal("episode id must be non-blank")

    candidates = inp.get("candidates")
    if not isinstance(candidates, list) or len(candidates) == 0:
        raise Refusal("candidates must be a non-empty array")

    threshold = resolve_threshold(inp.get("threshold"), inp["id"])
    support_by_id: dict[str, int] = {}
    for candidate in candidates:
        if not isinstance(candidate, dict) or isinstance(candidate, list):
            raise Refusal("every candidate must be an object")
        candidate_id = candidate.get("id")
        if not nonblank(candidate_id):
            raise Refusal("candidate id must be non-blank")
        if candidate_id in support_by_id:
            raise Refusal(f"duplicate candidate id {candidate_id}")
        evidence = candidate.get("evidence")
        support_by_id[candidate_id] = support_of(evidence, inp["id"], candidate_id)

    main = compose(candidates, support_by_id, threshold)
    ablations = []
    declared_ablations = inp.get("ablations", [])
    if not isinstance(declared_ablations, list):
        raise Refusal("ablations must be an array")
    seen: set[str] = set()
    for ablation in declared_ablations:
        if not isinstance(ablation, dict) or isinstance(ablation, list):
            raise Refusal("every ablation must be an object")
        ablation_id = ablation.get("id")
        if not nonblank(ablation_id):
            raise Refusal("ablation id must be non-blank")
        if ablation_id in seen:
            raise Refusal(f"duplicate ablation id {ablation_id}")
        seen.add(ablation_id)
        removed = ablation.get("removedCandidateId")
        if not nonblank(removed) or removed not in support_by_id:
            raise Refusal(f"ablation {ablation_id} points to a missing candidate")
        remaining = [c for c in candidates if c["id"] != removed]
        after = compose(remaining, support_by_id, threshold)["verdict"]
        ablations.append({
            "id": ablation_id,
            "removedCandidateId": removed,
            "beforeVerdict": main["verdict"],
            "afterVerdict": after,
            "changed": after != main["verdict"],
        })

    return {
        "id": inp["id"],
        "verdict": main["verdict"],
        "reason": main["reason"],
        "decidingId": main["decidingId"],
        "decidingReason": main["decidingReason"],
        "decidingSupportMilli": main["decidingSupportMilli"],
        "thresholdMilli": threshold,
        "candidateCount": len(candidates),
        "admitCount": main["admitCount"],
        "rejectCount": main["rejectCount"],
        "ablations": ablations,
    }


def build(fixture: dict) -> dict:
    cases = []
    for case in fixture.get("cases", []):
        if not isinstance(case, dict) or not nonblank(case.get("id")):
            raise Refusal("every fixture case needs a non-blank id")
        cases.append({"id": case["id"], "expected": audit(case["input"])})
    return {"schema": "microglia/consistency-admission@1", "fixtureSchema": fixture.get("schema", ""), "cases": cases}


def check(manifest: dict) -> None:
    if manifest.get("schema") != "microglia/consistency-admission@1":
        raise Refusal("manifest schema mismatch")
    cases = manifest.get("cases")
    if not isinstance(cases, list) or not cases:
        raise Refusal("manifest cases must be a non-empty array")
    for case in cases:
        expected = case.get("expected")
        if not isinstance(expected, dict):
            raise Refusal(f"case {case.get('id')}: expected must be an object")
        if expected.get("verdict") not in VERDICTS:
            raise Refusal(f"case {case.get('id')}: verdict out of family")
        if expected.get("reason") not in REASONS:
            raise Refusal(f"case {case.get('id')}: reason out of family")
        if expected.get("decidingReason") not in REASONS:
            raise Refusal(f"case {case.get('id')}: decidingReason out of family")
        for count in ("candidateCount", "admitCount", "rejectCount"):
            value = expected.get(count)
            if not isinstance(value, int) or isinstance(value, bool) or value < 0:
                raise Refusal(f"case {case.get('id')}: {count} must be a non-negative integer")
        if expected["admitCount"] + expected["rejectCount"] != expected["candidateCount"]:
            raise Refusal(f"case {case.get('id')}: counts do not partition candidateCount")
        if expected["verdict"] == "reject" and expected["reason"] == "supported":
            raise Refusal(f"case {case.get('id')}: reject cannot be supported")
        if expected["verdict"] == "admit" and expected["reason"] != "supported":
            raise Refusal(f"case {case.get('id')}: admit must be supported")
        if not is_milli(expected.get("decidingSupportMilli")):
            raise Refusal(f"case {case.get('id')}: decidingSupportMilli must be a milli")
        if not is_milli(expected.get("thresholdMilli")):
            raise Refusal(f"case {case.get('id')}: thresholdMilli must be a milli")
        ablations = expected.get("ablations")
        if not isinstance(ablations, list):
            raise Refusal(f"case {case.get('id')}: ablations must be an array")
        for reading in ablations:
            if reading.get("beforeVerdict") not in VERDICTS or reading.get("afterVerdict") not in VERDICTS:
                raise Refusal(f"case {case.get('id')}: ablation verdict out of family")
            if not isinstance(reading.get("changed"), bool):
                raise Refusal(f"case {case.get('id')}: ablation changed must be boolean")


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
    """Drive every refusal, boundary and tamper path with temporary files. Raises Refusal on any failed assertion."""
    assertions = 0

    def ok(condition: bool, label: str) -> None:
        nonlocal assertions
        assertions += 1
        if not condition:
            raise Refusal(f"self-test failed: {label}")

    fixture = load_json(fixture_path, "fixture")
    built = build(fixture)
    check(built)
    verify(fixture, built)

    ok(len(sha256(fixture_path)) == 64, "sha256 digest width")
    ok(milli(0.90025) == 900 and milli(0.0755) == 76, "half-up rounding")
    ok(is_milli(0) and is_milli(1000) and not is_milli(1001) and not is_milli(-1), "milli bounds")
    ok(is_count(0) and not is_count(-1) and not is_count(True), "count bounds")
    ok(finite(1.5) and not finite(float("nan")) and not finite("x"), "finite check")

    def samples(*values):
        return {"kind": "samples", "supportsMilli": list(values)}

    def inp(candidates, **over):
        base = {"id": "ep-1", "threshold": {"mode": "fixed", "tauMilli": 700}, "candidates": candidates}
        base.update(over)
        return base

    def refuses(function, label):
        try:
            function()
        except Refusal:
            ok(True, label)
            return
        ok(False, label)

    def refuse(value, label):
        refuses(lambda: audit(value), f"refuse {label}")

    ok(built["schema"] == "microglia/consistency-admission@1", "built schema")
    ok(len(built["cases"]) == len(fixture["cases"]), "built case count")
    covered_v = {e["expected"]["verdict"] for e in built["cases"]}
    covered_r = {e["expected"]["reason"] for e in built["cases"]}
    for value in VERDICTS:
        ok(value in covered_v, f"verdict reachable {value}")
    for value in REASONS:
        ok(value in covered_r, f"reason reachable {value}")

    good = audit(inp([{"id": "c1", "evidence": samples(1000, 1000, 1000, 1000, 1000)}]))
    ok(good["verdict"] == "admit" and good["reason"] == "supported" and good["decidingSupportMilli"] == 1000, "fresh admit")
    ok(good["admitCount"] == 1 and good["rejectCount"] == 0, "fresh counts")
    contradicted = audit(inp([{"id": "c1", "evidence": samples(0, 0)}]))
    ok(contradicted["reason"] == "contradicted", "contradiction")
    boundary = audit(inp([{"id": "c1", "evidence": samples(700, 700)}]))
    ok(boundary["verdict"] == "admit" and boundary["decidingSupportMilli"] == 700, "greater-or-equal boundary")
    half_up = audit(inp([{"id": "c1", "evidence": samples(0, 1000)}]))
    ok(half_up["decidingSupportMilli"] == 500, "half-up mean")
    mixed = audit(inp([
        {"id": "good", "evidence": samples(1000, 1000)},
        {"id": "bad", "evidence": samples(0, 0)},
        {"id": "mid", "evidence": samples(700, 700)},
    ]))
    ok(mixed["decidingId"] == "bad" and mixed["admitCount"] == 2 and mixed["rejectCount"] == 1, "mixed decisive")
    tie = audit(inp([{"id": "first", "evidence": samples(0)}, {"id": "second", "evidence": samples(0)}]))
    ok(tie["decidingId"] == "first", "severity tie first wins")

    sparse = audit(inp([{"id": "c1", "evidence": samples(500)}], threshold={
        "mode": "adaptive", "tauMinMilli": 400, "tauMaxMilli": 800, "memorySize": 0, "capacity": 500,
    }))
    ok(sparse["thresholdMilli"] == 400 and sparse["verdict"] == "admit", "adaptive sparse")
    full = audit(inp([{"id": "c1", "evidence": samples(500)}], threshold={
        "mode": "adaptive", "tauMinMilli": 400, "tauMaxMilli": 800, "memorySize": 500, "capacity": 500,
    }))
    ok(full["thresholdMilli"] == 800 and full["verdict"] == "reject", "adaptive full")
    clamped = audit(inp([{"id": "c1", "evidence": samples(1000)}], threshold={
        "mode": "adaptive", "tauMinMilli": 400, "tauMaxMilli": 800, "memorySize": 900, "capacity": 500,
    }))
    ok(clamped["thresholdMilli"] == 800, "adaptive occupancy clamp")
    rounded = audit(inp([{"id": "c1", "evidence": samples(500)}], threshold={
        "mode": "adaptive", "tauMinMilli": 400, "tauMaxMilli": 800, "memorySize": 250, "capacity": 500,
    }))
    ok(rounded["thresholdMilli"] == 600, "adaptive rounded threshold")

    log_yes = audit(inp([{"id": "c1", "evidence": {"kind": "logprob", "yesLog": -0.1, "noLog": -2.3}}]))
    ok(log_yes["decidingSupportMilli"] == 900 and log_yes["verdict"] == "admit", "logprob yes")
    log_no = audit(inp([{"id": "c1", "evidence": {"kind": "logprob", "yesLog": -2.3, "noLog": -0.1}}]))
    ok(log_no["decidingSupportMilli"] == 100 and log_no["verdict"] == "reject", "logprob no")

    ablation = audit(inp([
        {"id": "good", "evidence": samples(1000)},
        {"id": "bad", "evidence": samples(0)},
    ], ablations=[{"id": "drop-bad", "removedCandidateId": "bad"}]))
    ok(ablation["ablations"][0]["changed"] is True and ablation["ablations"][0]["afterVerdict"] == "admit", "decisive ablation")
    empty_ablation = audit(inp([{"id": "only", "evidence": samples(0)}], ablations=[
        {"id": "drop-only", "removedCandidateId": "only"},
    ]))
    ok(empty_ablation["ablations"][0]["afterVerdict"] == "admit", "ablating the only candidate")

    # audit() guards
    refuse(inp([{"id": "c1", "evidence": samples(1000)}], id=" "), "blank episode id")
    refuse(inp("no"), "non-array candidates")
    refuse(inp([]), "empty candidates")
    refuse(inp([None]), "non-object candidate")
    refuse(inp([{"id": " ", "evidence": samples(1000)}]), "blank candidate id")
    refuse(inp([{"id": "d", "evidence": samples(1000)}, {"id": "d", "evidence": samples(1000)}]), "duplicate candidate id")
    refuse(inp([{"id": "c1", "evidence": samples(1000)}], threshold="fixed"), "non-object threshold")
    refuses(lambda: audit(inp([{"id": "c1", "evidence": samples(1000)}], threshold={"mode": "dynamic"})), "unknown threshold mode")
    refuse(inp([{"id": "c1", "evidence": samples(1000)}], threshold={"mode": "fixed", "tauMilli": 700.5}), "non-integer tau")
    refuse(inp([{"id": "c1", "evidence": samples(1000)}], threshold={"mode": "fixed", "tauMilli": 1001}), "tau above 1000")
    refuses(lambda: audit(inp([{"id": "c1", "evidence": samples(1000)}], threshold={
        "mode": "adaptive", "tauMinMilli": 800, "tauMaxMilli": 400, "memorySize": 0, "capacity": 5,
    })), "tauMin above tauMax")
    refuses(lambda: audit(inp([{"id": "c1", "evidence": samples(1000)}], threshold={
        "mode": "adaptive", "tauMinMilli": 400, "tauMaxMilli": "bad", "memorySize": 0, "capacity": 5,
    })), "non-milli adaptive tau")
    refuses(lambda: audit(inp([{"id": "c1", "evidence": samples(1000)}], threshold={
        "mode": "adaptive", "tauMinMilli": 400, "tauMaxMilli": 800, "memorySize": -1, "capacity": 5,
    })), "negative memory size")
    refuses(lambda: audit(inp([{"id": "c1", "evidence": samples(1000)}], threshold={
        "mode": "adaptive", "tauMinMilli": 400, "tauMaxMilli": 800, "memorySize": 0, "capacity": 0,
    })), "zero capacity")
    refuses(lambda: audit(inp([{"id": "c1", "evidence": "bad"}])), "non-object evidence")
    refuses(lambda: audit(inp([{"id": "c1", "evidence": {"kind": "gossip"}}])), "unknown evidence kind")
    refuses(lambda: audit(inp([{"id": "c1", "evidence": samples()}])), "empty samples")
    refuses(lambda: audit(inp([{"id": "c1", "evidence": {"kind": "samples", "supportsMilli": "x"}}])), "non-array samples")
    refuses(lambda: audit(inp([{"id": "c1", "evidence": samples(500.5)}])), "non-integer sample")
    refuses(lambda: audit(inp([{"id": "c1", "evidence": samples(1001)}])), "sample above 1000")
    refuses(lambda: audit(inp([{"id": "c1", "evidence": samples(-1)}])), "negative sample")
    refuses(lambda: audit(inp([{"id": "c1", "evidence": {"kind": "logprob", "yesLog": float("nan"), "noLog": 0}}])), "non-finite logprob")
    refuses(lambda: audit(inp([{"id": "c1", "evidence": samples(1000)}], ablations="no")), "non-array ablations")
    refuses(lambda: audit(inp([{"id": "c1", "evidence": samples(1000)}], ablations=[None])), "non-object ablation")
    refuses(lambda: audit(inp([{"id": "c1", "evidence": samples(1000)}], ablations=[{"id": " ", "removedCandidateId": "c1"}])), "blank ablation id")
    refuses(lambda: audit(inp([{"id": "c1", "evidence": samples(1000)}], ablations=[
        {"id": "x", "removedCandidateId": "c1"}, {"id": "x", "removedCandidateId": "c1"},
    ])), "duplicate ablation id")
    refuses(lambda: audit(inp([{"id": "c1", "evidence": samples(1000)}], ablations=[{"id": "x", "removedCandidateId": "missing"}])), "missing ablation candidate")

    # load_json / build guards
    with tempfile.TemporaryDirectory() as tmp:
        temp = Path(tmp)
        list_doc = temp / "list.json"
        list_doc.write_text("[]", encoding="utf8")
        refuses(lambda: load_json(list_doc, "list"), "load_json refuses a non-object")
        bad_fixture = temp / "fixture.json"
        bad_fixture.write_text(json.dumps({"schema": "x", "cases": [{"id": " ", "input": inp([{"id": "c1", "evidence": samples(1000)}])}]}), encoding="utf8")
        refuses(lambda: build(load_json(bad_fixture, "fixture")), "build refuses a blank case id")

        def tampered_check(field, value):
            def run():
                doc = json.loads(json.dumps(built))
                doc["cases"][0]["expected"][field] = value
                check(doc)
            try:
                run()
            except Refusal:
                return True
            return False

        def mutated(mutator, verifier):
            doc = json.loads(json.dumps(built))
            mutator(doc)
            verifier(doc)

        refuses(lambda: mutated(lambda d: d.__setitem__("schema", "wrong"), check), "check refuses schema mismatch")
        ok(tampered_check("verdict", "bogus"), "check refuses verdict out of family")
        ok(tampered_check("reason", "bogus"), "check refuses reason out of family")
        ok(tampered_check("decidingReason", "bogus"), "check refuses decidingReason out of family")
        ok(tampered_check("candidateCount", -1), "check refuses negative count")
        refuses(lambda: mutated(lambda d: d["cases"][0]["expected"].__setitem__("candidateCount", 99), check), "check refuses count partition drift")
        ok(tampered_check("thresholdMilli", 1001), "check refuses threshold out of milli")
        ok(tampered_check("decidingSupportMilli", -1), "check refuses support out of milli")
        def reject_supported():
            reject_with_supported = {
                "schema": "microglia/consistency-admission@1",
                "cases": [{"id": "x", "expected": {
                    "id": "ep", "verdict": "reject", "reason": "supported", "decidingReason": "supported",
                    "decidingSupportMilli": 700, "thresholdMilli": 700, "candidateCount": 1,
                    "admitCount": 1, "rejectCount": 0, "ablations": [],
                }}],
            }
            check(reject_with_supported)

        refuses(reject_supported, "check refuses reject-with-supported")

        def admit_contradicted():
            admit_with_reason = {
                "schema": "microglia/consistency-admission@1",
                "cases": [{"id": "x", "expected": {
                    "id": "ep", "verdict": "admit", "reason": "contradicted", "decidingReason": "contradicted",
                    "decidingSupportMilli": 700, "thresholdMilli": 700, "candidateCount": 1,
                    "admitCount": 1, "rejectCount": 0, "ablations": [],
                }}],
            }
            check(admit_with_reason)

        refuses(admit_contradicted, "check refuses admit-non-supported")
        refuses(lambda: mutated(lambda d: d["cases"][0]["expected"].__setitem__("ablations", "no"), check), "check refuses non-array ablations")
        refuses(lambda: mutated(lambda d: d["cases"][0]["expected"]["ablations"].append({"id": "x", "beforeVerdict": "bogus", "afterVerdict": "admit", "changed": True}) if d["cases"][0]["expected"]["ablations"] else d["cases"][0]["expected"].__setitem__("ablations", [{"id": "x", "beforeVerdict": "bogus", "afterVerdict": "admit", "changed": True}]), check), "check refuses ablation verdict out of family")
        refuses(lambda: mutated(lambda d: d["cases"][0]["expected"].__setitem__("ablations", [{"id": "x", "beforeVerdict": "admit", "afterVerdict": "admit", "changed": "yes"}]), check), "check refuses non-boolean changed")
        refuses(lambda: mutated(lambda d: d["cases"][0].__setitem__("expected", "not-an-object"), check), "check refuses non-object expected")
        refuses(lambda: check({"schema": "microglia/consistency-admission@1", "cases": []}), "check refuses empty cases")

        # verify() guards
        refuses(lambda: mutated(lambda d: d["cases"][0]["expected"].__setitem__("decidingSupportMilli", 999), lambda doc: verify(fixture, doc)), "verify detects support tamper")
        refuses(lambda: mutated(lambda d: d["cases"][0]["expected"].__setitem__("verdict", "reject"), lambda doc: verify(fixture, doc)), "verify detects verdict tamper")
        refuses(lambda: mutated(lambda d: d.__setitem__("fixtureSchema", "wrong"), lambda doc: verify(fixture, doc)), "verify detects fixture schema drift")
        refuses(lambda: mutated(lambda d: d.__setitem__("cases", d["cases"][:1]), lambda doc: verify(fixture, doc)), "verify detects case-count drift")
        refuses(lambda: mutated(lambda d: d["cases"][0].__setitem__("id", "renamed"), lambda doc: verify(fixture, doc)), "verify detects case id drift")

        # main() --build/--write path, exercised under coverage via quiet()
        built_path = temp / "built.json"
        ok(quiet(["--build", "--fixture", str(fixture_path), "--manifest", str(built_path)]) == 0, "main build prints")
        ok(built_path.exists() is False, "main build without --write does not touch disk")
        ok(quiet(["--build", "--write", "--fixture", str(fixture_path), "--manifest", str(built_path)]) == 0, "main build writes")
        ok(built_path.exists(), "main build --write writes the manifest")

    quiet(["--check", "--manifest", str(manifest_path)])
    ok(True, "main check")
    quiet(["--verify", "--manifest", str(manifest_path), "--fixture", str(fixture_path)])
    ok(True, "main verify")
    ok(quiet(["--check", "--verify"]) == 1, "main rejects multiple actions")
    ok(quiet(["--check", "--manifest", str(temp / "missing.json")]) == 1, "main check surfaces refusal")

    print(f"SELF-TEST PASS ({assertions} assertions over {len(fixture['cases'])} fixture cases)")
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
    sys.exit(main())
