#!/usr/bin/env python3
"""The evaluation's independent reading of R254's experience gate.

The product's composition lives in `packages/core/src/apply/experience-gate.ts` and is pinned by vitest. A second
reader that merely transcribed the manifest would agree for the wrong reason - both could share the same mistake.
This tool re-derives every verdict, reason, deciding stage, integer score, count and ablation delta from a stage
set's bytes with an implementation that shares no code with TypeScript. The ladder is the strictest effective
disposition; a declared advisory source downgrades its reject to a reweight.

    python3 eval/tools/experience_gate.py --build                        # regenerate the manifest from the fixture
    python3 eval/tools/experience_gate.py --check                        # the manifest's own arithmetic is consistent
    python3 eval/tools/experience_gate.py --verify                       # re-derive from fixture and compare fields
    python3 eval/tools/experience_gate.py --self-test                    # boundaries, determinism, tamper detection

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
FIXTURE = ROOT / "eval" / "fixtures" / "experience-gate.json"
MANIFEST = ROOT / "eval" / "manifests" / "experience-gate.json"

SCHEMA = "microglia/experience-gate@1"
FIXTURE_SCHEMA = "microglia/experience-gate-inputs@1"
SOURCES = (
    "view-consistency",
    "abstraction-lifecycle",
    "revision-integrity",
    "stale-revocation",
    "memory-admission",
    "memory-confidence",
    "memory-gain-ledger",
    "state-role",
    "competition-domain",
    "cost-429",
)
DISPOSITIONS = ("admit", "reweight", "abstain", "reject")
VERDICTS = ("admit", "reweight", "abstain", "reject")
REASONS = ("all-admitted", "reweight-required", "abstention-required", "hard-gate-rejected")
SEVERITY = {"admit": 0, "reweight": 1, "abstain": 2, "reject": 3}
REASON_OF = {
    "admit": "all-admitted",
    "reweight": "reweight-required",
    "abstain": "abstention-required",
    "reject": "hard-gate-rejected",
}


class Refusal(Exception):
    """Raised on any malformed input or detected drift; never defaults."""


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_json(path: Path, label: str) -> dict:
    try:
        doc = json.loads(path.read_text(encoding="utf8"))
    except (OSError, ValueError) as exc:
        raise Refusal(f"cannot read {label}: {exc}")
    if not isinstance(doc, dict):
        raise Refusal(f"{label} must be a JSON object")
    return doc


def nonblank(value) -> bool:
    return isinstance(value, str) and value.strip() != ""


def is_milli(value) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= 1000


def effective(stage: dict, advisory: set) -> str:
    """A declared advisory source's reject is downgraded to a reweight."""
    disposition = stage["disposition"]
    if disposition == "reject" and stage["source"] in advisory:
        return "reweight"
    return disposition


def compose(stages: list, advisory: set) -> dict:
    """Strictest effective disposition wins; the first stage wins a severity tie.

    An empty list is the ablation boundary: removing the only gate leaves nothing to object, so the verdict is
    `admit` (the identity of "strictest") and there is no deciding stage. Mirrors the TS product implementation.
    """
    if not stages:
        return {"verdict": "admit", "deciding": None}
    deciding = stages[0]
    deciding_severity = SEVERITY[effective(deciding, advisory)]
    for stage in stages[1:]:
        severity = SEVERITY[effective(stage, advisory)]
        if severity > deciding_severity:
            deciding_severity = severity
            deciding = stage
    return {"verdict": effective(deciding, advisory), "deciding": deciding}


def audit(inp: dict) -> dict:
    """Re-derive the full reading from one stage set; refuse rather than default on any guard."""
    if not isinstance(inp, dict):
        raise Refusal("input must be an object")
    if not nonblank(inp.get("id")):
        raise Refusal("experience id must be non-blank")

    stages = inp.get("stages")
    if not isinstance(stages, list):
        raise Refusal("stages must be an array")
    if len(stages) == 0:
        raise Refusal("stages must not be empty")

    advisory_raw = inp.get("advisorySources", [])
    if not isinstance(advisory_raw, list):
        raise Refusal("advisorySources must be an array")
    advisory: set = set()
    for source in advisory_raw:
        if not isinstance(source, str) or source not in SOURCES:
            raise Refusal(f"unknown advisory source {source!r}")
        advisory.add(source)

    seen_stages: set = set()
    counts = {"admit": 0, "reweight": 0, "abstain": 0, "reject": 0}
    for stage in stages:
        if not isinstance(stage, dict):
            raise Refusal("every stage must be an object")
        sid = stage.get("id")
        if not nonblank(sid):
            raise Refusal("stage id must be non-blank")
        if sid in seen_stages:
            raise Refusal(f"duplicate stage id {sid!r}")
        seen_stages.add(sid)
        if stage.get("source") not in SOURCES:
            raise Refusal(f"unknown source {stage.get('source')!r}")
        if stage.get("disposition") not in DISPOSITIONS:
            raise Refusal(f"unknown disposition {stage.get('disposition')!r}")
        if not nonblank(stage.get("reason")):
            raise Refusal("stage reason must be non-blank")
        if not is_milli(stage.get("scoreMilli")):
            raise Refusal("scoreMilli must be an integer in [0, 1000]")
        counts[effective(stage, advisory)] += 1

    ablations_raw = inp.get("ablations", [])
    if not isinstance(ablations_raw, list):
        raise Refusal("ablations must be an array")
    composed = compose(stages, advisory)
    verdict = composed["verdict"]
    deciding = composed["deciding"]

    reading_ablations: list = []
    seen_ablations: set = set()
    for ablation in ablations_raw:
        if not isinstance(ablation, dict):
            raise Refusal("every ablation must be an object")
        aid = ablation.get("id")
        if not nonblank(aid):
            raise Refusal("ablation id must be non-blank")
        if aid in seen_ablations:
            raise Refusal(f"duplicate ablation id {aid!r}")
        seen_ablations.add(aid)
        removed = ablation.get("removedStageId")
        if not isinstance(removed, str) or removed not in seen_stages:
            raise Refusal(f"ablation {aid!r} names a missing stage")
        remaining = [stage for stage in stages if stage["id"] != removed]
        after = compose(remaining, advisory)["verdict"]
        reading_ablations.append({
            "id": aid,
            "removedStageId": removed,
            "beforeVerdict": verdict,
            "afterVerdict": after,
            "changed": after != verdict,
        })

    return {
        "id": inp["id"],
        "verdict": verdict,
        "reason": REASON_OF[verdict],
        "decidingStageId": deciding["id"],
        "decidingReason": deciding["reason"],
        "decidingScoreMilli": deciding["scoreMilli"],
        "stageCount": len(stages),
        "admitCount": counts["admit"],
        "reweightCount": counts["reweight"],
        "abstainCount": counts["abstain"],
        "rejectCount": counts["reject"],
        "ablations": reading_ablations,
    }


def verify(fixture_path: Path, manifest_path: Path) -> None:
    fixture = load_json(fixture_path, "fixture")
    manifest = load_json(manifest_path, "manifest")
    if fixture.get("schema") != FIXTURE_SCHEMA:
        raise Refusal("fixture schema mismatch")
    if manifest.get("schema") != SCHEMA:
        raise Refusal("manifest schema mismatch")
    if manifest.get("fixtureSchema") != fixture.get("schema"):
        raise Refusal("manifest describes a different fixture schema")
    cases = fixture.get("cases")
    entries = manifest.get("cases")
    if not isinstance(cases, list) or not isinstance(entries, list):
        raise Refusal("cases must be arrays")
    if len(cases) != len(entries):
        raise Refusal("case count drift")
    for case, entry in zip(cases, entries):
        if not isinstance(case, dict) or not isinstance(entry, dict):
            raise Refusal("case and entry must be objects")
        if case.get("id") != entry.get("id"):
            raise Refusal(f"case id drift: {case.get('id')} != {entry.get('id')}")
        derived = audit(case["input"])
        expected = entry.get("expected")
        if not isinstance(expected, dict):
            raise Refusal("entry has no expected object")
        for key, value in derived.items():
            if expected.get(key) != value:
                raise Refusal(f"{case['id']}: {key} drift: {expected.get(key)!r} != {value!r}")


def check(manifest_path: Path) -> None:
    """Re-derive the manifest's own arithmetic and reject a self-contradicting manifest."""
    manifest = load_json(manifest_path, "manifest")
    if manifest.get("schema") != SCHEMA:
        raise Refusal("manifest schema mismatch")
    entries = manifest.get("cases")
    if not isinstance(entries, list):
        raise Refusal("cases must be an array")
    seen_ids: set = set()
    for entry in entries:
        if not isinstance(entry, dict):
            raise Refusal("each entry must be an object")
        eid = entry.get("id")
        if not nonblank(eid) or eid in seen_ids:
            raise Refusal(f"duplicate or blank entry id {eid!r}")
        seen_ids.add(eid)
        expected = entry.get("expected")
        if not isinstance(expected, dict):
            raise Refusal(f"{eid}: expected must be an object")
        verdict = expected.get("verdict")
        if verdict not in VERDICTS:
            raise Refusal(f"{eid}: verdict outside vocabulary")
        if expected.get("reason") != REASON_OF[verdict]:
            raise Refusal(f"{eid}: reason disagrees with verdict")
        count_total = sum(expected.get(key, 0) for key in ("admitCount", "reweightCount", "abstainCount", "rejectCount"))
        if count_total != expected.get("stageCount"):
            raise Refusal(f"{eid}: counts do not partition stageCount")
        if not is_milli(expected.get("decidingScoreMilli")):
            raise Refusal(f"{eid}: decidingScoreMilli outside [0, 1000]")
        for reading in expected.get("ablations", []):
            if reading.get("changed") != (reading.get("afterVerdict") != verdict):
                raise Refusal(f"{eid}: ablation changed flag disagrees with before/after")


def build(fixture_path: Path, manifest_path: Path) -> None:
    fixture = load_json(fixture_path, "fixture")
    cases = fixture.get("cases")
    if not isinstance(cases, list):
        raise Refusal("fixture cases must be an array")
    entries = []
    for case in cases:
        if not isinstance(case, dict):
            raise Refusal("each case must be an object")
        entries.append({"id": case["id"], "expected": audit(case["input"])})
    manifest = {
        "schema": SCHEMA,
        "fixtureSchema": fixture.get("schema"),
        "cases": entries,
    }
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf8")


def ok(condition: bool, message: str) -> None:
    if not condition:
        raise Refusal(message)


def self_test(tmp: Path) -> None:
    """Drive every guard, boundary and tamper path; raise Refusal on any failed assertion."""
    fixture = tmp / "fixture.json"
    manifest = tmp / "manifest.json"

    def refuses(function, label: str) -> None:
        """Assert a callable raises Refusal; the ok(False) arm is itself covered by a controlled failure below."""
        try:
            function()
        except Refusal:
            ok(True, label)
            return
        ok(False, label)

    # Determinism: re-deriving the same input twice yields identical bytes.
    sample = {
        "id": "det",
        "stages": [
            {"id": "a", "source": "memory-confidence", "disposition": "admit", "reason": "r", "scoreMilli": 828},
            {"id": "b", "source": "memory-gain-ledger", "disposition": "reject", "reason": "unsafe", "scoreMilli": 120},
        ],
    }
    ok(audit(sample) == audit(sample), "audit is not deterministic")

    # Strictest wins and ties go to the first stage.
    r = audit(sample)
    ok(r["verdict"] == "reject" and r["decidingStageId"] == "b", "strictest disposition did not win")
    ok(r["reason"] == "hard-gate-rejected", "reason not derived from verdict")
    ok(r["stageCount"] == 2 and r["rejectCount"] == 1 and r["admitCount"] == 1, "counts do not partition")

    # Every verdict family and reasoning is reachable.
    ok(audit({"id": "v", "stages": [{"id": "a", "source": "state-role", "disposition": "admit", "reason": "r", "scoreMilli": 1}]})["reason"] == "all-admitted", "admit reason")
    ok(audit({"id": "v", "stages": [{"id": "a", "source": "state-role", "disposition": "reweight", "reason": "r", "scoreMilli": 1}]})["reason"] == "reweight-required", "reweight reason")
    ok(audit({"id": "v", "stages": [{"id": "a", "source": "state-role", "disposition": "abstain", "reason": "r", "scoreMilli": 1}]})["reason"] == "abstention-required", "abstain reason")

    tie = {
        "id": "tie",
        "stages": [
            {"id": "first", "source": "stale-revocation", "disposition": "reject", "reason": "p", "scoreMilli": 200},
            {"id": "second", "source": "view-consistency", "disposition": "reject", "reason": "q", "scoreMilli": 150},
        ],
    }
    ok(audit(tie)["decidingStageId"] == "first", "tie did not go to the first stage")

    # Advisory downgrade; an undeclared advisory source stays hard.
    advisory = dict(sample)
    advisory["advisorySources"] = ["memory-gain-ledger"]
    ra = audit(advisory)
    ok(ra["verdict"] == "reweight" and ra["rejectCount"] == 0 and ra["reweightCount"] == 1, "advisory downgrade failed")
    ok(ra["decidingReason"] == "unsafe", "advisory deciding reason lost")

    # Ablation: removing the decisive gate flips the verdict; removing a dominated one does not.
    with_abl = dict(sample)
    with_abl["ablations"] = [
        {"id": "x", "removedStageId": "b"},
        {"id": "y", "removedStageId": "a"},
    ]
    readings = audit(with_abl)["ablations"]
    ok(readings[0]["changed"] is True and readings[0]["afterVerdict"] == "admit", "decisive ablation not flagged")
    ok(readings[1]["changed"] is False and readings[1]["afterVerdict"] == "reject", "dominated ablation wrongly flagged")

    # Ablation boundary: removing the only gate leaves nothing to object -> after verdict admit.
    single = {"id": "solo", "stages": [{"id": "only", "source": "memory-gain-ledger", "disposition": "reject", "reason": "unsafe", "scoreMilli": 100}],
              "ablations": [{"id": "x", "removedStageId": "only"}]}
    solo = audit(single)["ablations"][0]
    ok(solo["afterVerdict"] == "admit" and solo["changed"] is True, "empty-compose ablation boundary")

    # load_json guards: a missing path and a non-object document both refuse.
    refuses(lambda: load_json(tmp / "does-not-exist.json", "fixture"), "load_json missing file")
    (tmp / "list.json").write_text("[]", encoding="utf8")
    refuses(lambda: load_json(tmp / "list.json", "fixture"), "load_json non-object")
    (tmp / "bad.json").write_text("{not-json", encoding="utf8")
    refuses(lambda: load_json(tmp / "bad.json", "fixture"), "load_json malformed")

    # audit guards all refuse rather than default (including non-object inputs).
    bad_inputs = [
        "not-a-dict",
        {"id": " ", "stages": sample["stages"]},
        {"id": "e", "stages": []},
        {"id": "e", "stages": "no"},
        {"id": "e", "stages": [42]},
        {"id": "e", "stages": [{"id": " ", "source": "state-role", "disposition": "admit", "reason": "r", "scoreMilli": 1}]},
        {"id": "e", "stages": [{"id": "a", "source": "state-role", "disposition": "admit", "reason": "r", "scoreMilli": 1},
                              {"id": "a", "source": "state-role", "disposition": "admit", "reason": "r", "scoreMilli": 1}]},
        {"id": "e", "stages": [{"id": "a", "source": "unknown", "disposition": "admit", "reason": "r", "scoreMilli": 1}]},
        {"id": "e", "stages": [{"id": "a", "source": "state-role", "disposition": "maybe", "reason": "r", "scoreMilli": 1}]},
        {"id": "e", "stages": [{"id": "a", "source": "state-role", "disposition": "admit", "reason": " ", "scoreMilli": 1}]},
        {"id": "e", "stages": [{"id": "a", "source": "state-role", "disposition": "admit", "reason": "r", "scoreMilli": 1001}]},
        {"id": "e", "stages": [{"id": "a", "source": "state-role", "disposition": "admit", "reason": "r", "scoreMilli": -1}]},
        {"id": "e", "stages": [{"id": "a", "source": "state-role", "disposition": "admit", "reason": "r", "scoreMilli": 1.5}]},
        {"id": "e", "stages": [{"id": "a", "source": "state-role", "disposition": "admit", "reason": "r", "scoreMilli": True}]},
        {"id": "e", "stages": sample["stages"], "advisorySources": "no"},
        {"id": "e", "stages": sample["stages"], "advisorySources": ["unknown"]},
        {"id": "e", "stages": sample["stages"], "ablations": "no"},
        {"id": "e", "stages": sample["stages"], "ablations": [42]},
        {"id": "e", "stages": sample["stages"], "ablations": [{"id": " ", "removedStageId": "a"}]},
        {"id": "e", "stages": sample["stages"], "ablations": [{"id": "x", "removedStageId": "missing"}]},
        {"id": "e", "stages": sample["stages"], "ablations": [{"id": "x", "removedStageId": "a"},
                                                                 {"id": "x", "removedStageId": "b"}]},
    ]
    for bad in bad_inputs:
        refuses(lambda bad=bad: audit(bad), f"guard refused {bad!r}")

    # A built pair verifies; --check re-derives its own arithmetic.
    fixture.write_text(json.dumps({"schema": FIXTURE_SCHEMA, "cases": [{"id": "det", "input": sample}]}))
    build(fixture, manifest)
    verify(fixture, manifest)
    check(manifest)
    ok(sha256(fixture) != sha256(manifest), "sha256 distinguishes fixture bytes")

    # build refuses a non-array case list and a non-object case.
    refuses(lambda: build(tmp / "list.json", manifest), "build non-object fixture")
    (tmp / "badcases.json").write_text(json.dumps({"schema": FIXTURE_SCHEMA, "cases": "no"}))
    refuses(lambda: build(tmp / "badcases.json", manifest), "build non-array cases")
    (tmp / "badcase.json").write_text(json.dumps({"schema": FIXTURE_SCHEMA, "cases": [42]}))
    refuses(lambda: build(tmp / "badcase.json", manifest), "build non-object case")

    # verify guards: schema drift, fixtureSchema drift, non-array cases, count drift, id drift, missing expected.
    def verify_with(fdoc, mdoc):
        fp = tmp / "v-fixture.json"
        mp = tmp / "v-manifest.json"
        fp.write_text(json.dumps(fdoc))
        mp.write_text(json.dumps(mdoc))
        verify(fp, mp)

    base_fixture = {"schema": FIXTURE_SCHEMA, "cases": [{"id": "det", "input": sample}]}
    base_manifest = json.loads(manifest.read_text(encoding="utf8"))
    refuses(lambda: verify_with({**base_fixture, "schema": "wrong"}, base_manifest), "verify fixture schema")
    refuses(lambda: verify_with(base_fixture, {**base_manifest, "schema": "wrong"}), "verify manifest schema")
    refuses(lambda: verify_with(base_fixture, {**base_manifest, "fixtureSchema": "wrong"}), "verify fixtureSchema")
    refuses(lambda: verify_with({**base_fixture, "cases": "no"}, base_manifest), "verify cases array")
    refuses(lambda: verify_with({**base_fixture, "cases": []}, base_manifest), "verify count drift")
    refuses(lambda: verify_with({"schema": FIXTURE_SCHEMA, "cases": [{"id": "other", "input": sample}]}, base_manifest), "verify id drift")
    refuses(lambda: verify_with(base_fixture, {"schema": SCHEMA, "fixtureSchema": FIXTURE_SCHEMA, "cases": [{"id": "det"}]}), "verify missing expected")
    refuses(lambda: verify_with({"schema": FIXTURE_SCHEMA, "cases": [42]}, base_manifest), "verify non-object case")
    refuses(lambda: verify_with(base_fixture, {"schema": SCHEMA, "fixtureSchema": FIXTURE_SCHEMA, "cases": [42]}), "verify non-object entry")

    # Tamper: a drifted field is caught by --verify.
    drift_manifest = json.loads(json.dumps(base_manifest))
    drift_manifest["cases"][0]["expected"]["verdict"] = "admit"
    refuses(lambda: verify_with(base_fixture, drift_manifest), "verify drifted field")

    # check guards: schema, cases array, blank/duplicate id, expected object, verdict family, reason mismatch,
    # count partition, decidingScoreMilli range, ablation changed flag.
    def check_with(doc):
        cp = tmp / "c-manifest.json"
        cp.write_text(json.dumps(doc))
        check(cp)

    refuses(lambda: check_with({**base_manifest, "schema": "wrong"}), "check schema")
    refuses(lambda: check_with({**base_manifest, "cases": "no"}), "check cases array")
    refuses(lambda: check_with({"schema": SCHEMA, "cases": [{"id": " ", "expected": {}}]}), "check blank id")
    dup = {"schema": SCHEMA, "cases": [{"id": "x", "expected": base_manifest["cases"][0]["expected"]},
                                         {"id": "x", "expected": base_manifest["cases"][0]["expected"]}]}
    refuses(lambda: check_with(dup), "check duplicate id")
    refuses(lambda: check_with({"schema": SCHEMA, "cases": [{"id": "x"}]}), "check expected object")
    for field, value, label in [
        ("verdict", "wrong", "check verdict family"),
        ("reason", "wrong", "check reason mismatch"),
        ("stageCount", -1, "check count partition"),
        ("decidingScoreMilli", 1001, "check score range"),
    ]:
        doc = {"schema": SCHEMA, "cases": [{"id": "x", "expected": {**base_manifest["cases"][0]["expected"], field: value}}]}
        refuses(lambda doc=doc: check_with(doc), label)

    # check: a non-object entry and a bad ablation changed flag are refused.
    refuses(lambda: check_with({"schema": SCHEMA, "cases": [42]}), "check non-object entry")
    abl_doc = {"schema": SCHEMA, "cases": [{"id": "x", "expected": {
        **base_manifest["cases"][0]["expected"],
        "ablations": [{"id": "z", "removedStageId": "a", "beforeVerdict": "reject", "afterVerdict": "reject", "changed": True}],
    }}]}
    refuses(lambda: check_with(abl_doc), "check ablation changed flag")

    # Cover the ok(False) arm of `refuses` itself: a callable that does NOT refuse triggers it, and the
    # resulting Refusal is the expected controlled failure. Without this, that single assertion stays open.
    controlled_failure = False
    try:
        refuses(lambda: None, "a callable that must refuse")
    except Refusal:
        controlled_failure = True
    ok(controlled_failure, "refuses ok(False) arm not covered")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixture", type=Path, default=FIXTURE)
    parser.add_argument("--manifest", type=Path, default=MANIFEST)
    parser.add_argument("--build", action="store_true")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--verify", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    try:
        if args.build:
            build(args.fixture, args.manifest)
        if args.check:
            check(args.manifest)
        if args.verify:
            verify(args.fixture, args.manifest)
        if args.self_test:
            with tempfile.TemporaryDirectory() as tmp:
                self_test(Path(tmp))
        if not (args.build or args.check or args.verify or args.self_test):
            parser.error("select --build, --check, --verify, or --self-test")
    except Refusal as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        raise SystemExit(1)
    print("OK")


if __name__ == "__main__":
    main()
