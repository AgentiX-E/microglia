#!/usr/bin/env python3
"""The evaluation's independent reading of R256's proposer-value gate.

The product's judgement lives in `packages/core/src/apply/proposer-value.ts` and is pinned by vitest. A second reader
that merely transcribed the manifest would agree for the wrong reason — both could share the same mistake. This tool
re-derives the cost, the over-budget amount, every firing rung, the strictest verdict, the deciding signal and each
ablation from a set's bytes with an implementation that shares no code with TypeScript.

The gate is the machine form of R104b's registered prediction — "no gain unless fragmentation is high" — and exists
to price the paid model arm before spending anything: pay only when the deterministic fold has NOT already reached
the repairs, the witness is strong, the defect is prose rather than a chain, and the call fits the budget.

    python3 eval/tools/proposer_value.py --build --write
    python3 eval/tools/proposer_value.py --check
    python3 eval/tools/proposer_value.py --verify
    python3 eval/tools/proposer_value.py --self-test

`--manifest` and `--fixture` redirect every mode so the self-test can drive distinct tampers against temporary
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
FIXTURE = ROOT / "eval" / "fixtures" / "proposer-value.json"
MANIFEST = ROOT / "eval" / "manifests" / "proposer-value.json"

FRAGMENTATION_FLOOR = 300
WITNESS_FLOOR = 500
CHAINED_CEILING = 300

VERDICTS = ("admit", "reweight", "abstain", "reject")
REASONS = (
    "worth-proposing",
    "grouping-first",
    "weak-witness",
    "prose-not-the-problem",
    "over-budget",
    "no-candidates",
)
SIGNALS = ("none", "chaining", "witness", "fragmentation", "cost", "candidate-count")
ABLATABLE = ("cost", "fragmentation", "witness", "chaining")
SEVERITY = {reason: index for index, reason in enumerate(REASONS)}
VERDICT_OF = {
    "worth-proposing": "admit",
    "grouping-first": "reweight",
    "weak-witness": "abstain",
    "prose-not-the-problem": "reject",
    "over-budget": "reject",
    "no-candidates": "reject",
}
SIGNAL_OF = {
    "worth-proposing": "none",
    "grouping-first": "chaining",
    "weak-witness": "witness",
    "prose-not-the-problem": "fragmentation",
    "over-budget": "cost",
    "no-candidates": "candidate-count",
}


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


def check_input(inp: dict) -> None:
    """Refuse on any malformed signal; a defect must never silently become an admit."""
    if not nonblank(inp.get("id")):
        raise Refusal("id must be non-blank")
    for key in ("fragmentationMilli", "witnessMilli", "chainedShareMilli"):
        if not is_milli(inp.get(key)):
            raise Refusal(f"{key} must be an integer in [0,1000]")
    for key in ("candidateCount", "unitCostMicros", "budgetMicros"):
        if not is_count(inp.get(key)):
            raise Refusal(f"{key} must be a non-negative integer")


def check_ablations(ablations) -> None:
    if ablations is None:
        return
    if not isinstance(ablations, list):
        raise Refusal("ablations must be an array")
    seen: set[str] = set()
    for ablation in ablations:
        if not isinstance(ablation, dict) or isinstance(ablation, list):
            raise Refusal("every ablation must be an object")
        if not nonblank(ablation.get("id")):
            raise Refusal("ablation id must be non-blank")
        removed = ablation.get("removedSignal")
        if not isinstance(removed, str) or removed not in ABLATABLE:
            raise Refusal("unknown removed signal")
        if ablation["id"] in seen:
            raise Refusal("duplicate ablation id")
        seen.add(ablation["id"])


def cost_of(inp: dict) -> int:
    return inp["candidateCount"] * inp["unitCostMicros"]


def firing_reasons(inp: dict, neutral: str | None) -> list:
    """Every firing rung, collected so strictest-wins is decided by SEVERITY, not by check order."""
    fired = []
    if inp["candidateCount"] == 0:
        fired.append("no-candidates")
    if neutral != "cost" and cost_of(inp) > inp["budgetMicros"]:
        fired.append("over-budget")
    if neutral != "fragmentation" and inp["fragmentationMilli"] < FRAGMENTATION_FLOOR:
        fired.append("prose-not-the-problem")
    if neutral != "witness" and inp["witnessMilli"] < WITNESS_FLOOR:
        fired.append("weak-witness")
    if neutral != "chaining" and inp["chainedShareMilli"] > CHAINED_CEILING:
        fired.append("grouping-first")
    return fired


def decide(inp: dict, neutral: str | None) -> dict:
    """Strictest firing rung, plus the integer money fields derived from the same bytes."""
    estimated = cost_of(inp)
    over = max(0, estimated - inp["budgetMicros"])
    reason = "worth-proposing"
    for fired in firing_reasons(inp, neutral):
        if SEVERITY[fired] > SEVERITY[reason]:
            reason = fired
    return {"reason": reason, "estimatedCostMicros": estimated, "overBudgetByMicros": over}


def audit(inp: dict) -> dict:
    """Re-derive one set's reading from its bytes. Refuses rather than defaults on any defect."""
    check_input(inp)
    check_ablations(inp.get("ablations"))

    before = decide(inp, None)
    ablations = []
    for ablation in inp.get("ablations") or []:
        after = decide(inp, ablation["removedSignal"])
        before_verdict = VERDICT_OF[before["reason"]]
        after_verdict = VERDICT_OF[after["reason"]]
        ablations.append({
            "id": ablation["id"],
            "removedSignal": ablation["removedSignal"],
            "beforeVerdict": before_verdict,
            "afterVerdict": after_verdict,
            "changed": after_verdict != before_verdict,
        })

    return {
        "id": inp["id"],
        "verdict": VERDICT_OF[before["reason"]],
        "reason": before["reason"],
        "decidingSignal": SIGNAL_OF[before["reason"]],
        "estimatedCostMicros": before["estimatedCostMicros"],
        "overBudgetByMicros": before["overBudgetByMicros"],
        "candidateCount": inp["candidateCount"],
        "fragmentationFloorMilli": FRAGMENTATION_FLOOR,
        "witnessFloorMilli": WITNESS_FLOOR,
        "chainedCeilingMilli": CHAINED_CEILING,
        "ablations": ablations,
    }


def build(fixture: dict) -> dict:
    cases = []
    for case in fixture.get("cases", []):
        if not isinstance(case, dict) or not nonblank(case.get("id")):
            raise Refusal("every fixture case needs a non-blank id")
        cases.append({"id": case["id"], "expected": audit(case["input"])})
    return {"schema": "microglia/proposer-value@1", "fixtureSchema": fixture.get("schema", ""), "cases": cases}


def check(manifest: dict) -> None:
    if manifest.get("schema") != "microglia/proposer-value@1":
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
        if expected.get("decidingSignal") not in SIGNALS:
            raise Refusal(f"case {case.get('id')}: decidingSignal out of family")
        if VERDICT_OF.get(expected.get("reason")) != expected.get("verdict"):
            raise Refusal(f"case {case.get('id')}: verdict and reason disagree")
        if SIGNAL_OF.get(expected.get("reason")) != expected.get("decidingSignal"):
            raise Refusal(f"case {case.get('id')}: decidingSignal and reason disagree")
        for key in ("estimatedCostMicros", "overBudgetByMicros", "candidateCount"):
            if not is_count(expected.get(key)):
                raise Refusal(f"case {case.get('id')}: {key} must be a non-negative integer")
        if expected["overBudgetByMicros"] > expected["estimatedCostMicros"]:
            raise Refusal(f"case {case.get('id')}: over-budget exceeds cost")
        for key in ("fragmentationFloorMilli", "witnessFloorMilli", "chainedCeilingMilli"):
            if expected.get(key) != {"fragmentationFloorMilli": FRAGMENTATION_FLOOR,
                                     "witnessFloorMilli": WITNESS_FLOOR,
                                     "chainedCeilingMilli": CHAINED_CEILING}[key]:
                raise Refusal(f"case {case.get('id')}: {key} drift")
        ablations = expected.get("ablations")
        if not isinstance(ablations, list):
            raise Refusal(f"case {case.get('id')}: ablations must be an array")
        seen = set()
        for reading in ablations:
            if not isinstance(reading, dict):
                raise Refusal(f"case {case.get('id')}: ablation reading must be an object")
            if reading.get("removedSignal") not in ABLATABLE:
                raise Refusal(f"case {case.get('id')}: ablation signal out of family")
            if reading.get("beforeVerdict") not in VERDICTS or reading.get("afterVerdict") not in VERDICTS:
                raise Refusal(f"case {case.get('id')}: ablation verdict out of family")
            if not isinstance(reading.get("changed"), bool):
                raise Refusal(f"case {case.get('id')}: ablation changed must be boolean")
            if (reading["beforeVerdict"] != reading["afterVerdict"]) != reading["changed"]:
                raise Refusal(f"case {case.get('id')}: ablation changed disagrees with verdicts")
            if reading["id"] in seen:
                raise Refusal(f"case {case.get('id')}: duplicate ablation id")
            seen.add(reading["id"])


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
    ok(is_milli(0) and is_milli(1000) and not is_milli(1001) and not is_milli(-1), "milli bounds")
    ok(is_count(0) and not is_count(-1) and not is_count(True), "count bounds")
    ok(FRAGMENTATION_FLOOR == 300 and WITNESS_FLOOR == 500 and CHAINED_CEILING == 300, "registered floors")

    ok(built["schema"] == "microglia/proposer-value@1", "built schema")
    ok(len(built["cases"]) == len(fixture["cases"]), "built case count")
    covered_v = {e["expected"]["verdict"] for e in built["cases"]}
    covered_r = {e["expected"]["reason"] for e in built["cases"]}
    for value in VERDICTS:
        ok(value in covered_v, f"verdict reachable {value}")
    for value in REASONS:
        ok(value in covered_r, f"reason reachable {value}")

    def inp(**over):
        base = {
            "id": "pv-1", "fragmentationMilli": 600, "witnessMilli": 700, "chainedShareMilli": 100,
            "candidateCount": 15, "unitCostMicros": 10000, "budgetMicros": 200000,
        }
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

    worth = audit(inp())
    ok(worth["verdict"] == "admit" and worth["reason"] == "worth-proposing" and worth["decidingSignal"] == "none", "worth admitting")
    ok(worth["estimatedCostMicros"] == 150000 and worth["overBudgetByMicros"] == 0, "cost arithmetic")
    low_frag = audit(inp(fragmentationMilli=100))
    ok(low_frag["verdict"] == "reject" and low_frag["reason"] == "prose-not-the-problem", "low fragmentation")
    over = audit(inp(candidateCount=30))
    ok(over["reason"] == "over-budget" and over["overBudgetByMicros"] == 100000, "over budget")
    empty = audit(inp(candidateCount=0))
    ok(empty["reason"] == "no-candidates" and empty["estimatedCostMicros"] == 0, "no candidates")
    weak = audit(inp(witnessMilli=300))
    ok(weak["verdict"] == "abstain" and weak["reason"] == "weak-witness", "weak witness")
    chaining = audit(inp(chainedShareMilli=500))
    ok(chaining["verdict"] == "reweight" and chaining["reason"] == "grouping-first", "grouping first")
    ok(audit(inp(fragmentationMilli=300))["reason"] == "worth-proposing", "fragmentation boundary is >=")
    bound_budget = audit(inp(candidateCount=20))
    ok(bound_budget["reason"] == "worth-proposing" and bound_budget["overBudgetByMicros"] == 0, "budget boundary is strict >")
    ok(audit(inp(chainedShareMilli=300))["reason"] == "worth-proposing", "chaining boundary is strict >")
    priority = audit(inp(fragmentationMilli=100, witnessMilli=300, chainedShareMilli=500))
    ok(priority["reason"] == "prose-not-the-problem", "strictest rung wins")

    ablation = audit(inp(fragmentationMilli=100, ablations=[
        {"id": "a-frag", "removedSignal": "fragmentation"},
        {"id": "a-cost", "removedSignal": "cost"},
        {"id": "a-wit", "removedSignal": "witness"},
        {"id": "a-chain", "removedSignal": "chaining"},
    ]))
    readings = {r["id"]: r for r in ablation["ablations"]}
    ok(readings["a-frag"]["changed"] is True and readings["a-frag"]["afterVerdict"] == "admit", "decisive ablation")
    ok(readings["a-cost"]["changed"] is False, "neutral cost leaves reject")
    ok(readings["a-wit"]["changed"] is False, "neutral witness leaves reject")
    ok(readings["a-chain"]["changed"] is False, "neutral chaining leaves reject")

    # audit() guards
    refuse(inp(id=" "), "blank id")
    refuse(inp(fragmentationMilli=600.5), "non-integer fragmentation")
    refuse(inp(fragmentationMilli=1001), "fragmentation above 1000")
    refuse(inp(fragmentationMilli=-1), "negative fragmentation")
    refuse(inp(witnessMilli=700.5), "non-integer witness")
    refuse(inp(chainedShareMilli=1001), "chaining above 1000")
    refuse(inp(candidateCount=-1), "negative candidate count")
    refuse(inp(candidateCount=1.5), "non-integer candidate count")
    refuse(inp(unitCostMicros=-1), "negative unit cost")
    refuse(inp(budgetMicros=-1), "negative budget")
    refuse(inp(ablations="no"), "non-array ablations")
    refuse(inp(ablations=["no"]), "non-object ablation")
    refuse(inp(ablations=[{"id": " ", "removedSignal": "cost"}]), "blank ablation id")
    refuse(inp(ablations=[{"id": "a", "removedSignal": "unknown"}]), "unknown removed signal")
    refuse(inp(ablations=[{"id": "a", "removedSignal": "cost"}, {"id": "a", "removedSignal": "cost"}]), "duplicate ablation id")

    with tempfile.TemporaryDirectory() as tmp:
        temp = Path(tmp)
        list_doc = temp / "list.json"
        list_doc.write_text("[]", encoding="utf8")
        refuses(lambda: load_json(list_doc, "list"), "load_json refuses a non-object")
        bad_fixture = temp / "fixture.json"
        bad_fixture.write_text(json.dumps({"schema": "x", "cases": [{"id": " ", "input": inp()}]}), encoding="utf8")
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
        ok(tampered_check("decidingSignal", "bogus"), "check refuses signal out of family")
        ok(tampered_check("verdict", "reject"), "check refuses verdict-reason disagreement")
        ok(tampered_check("decidingSignal", "cost"), "check refuses signal-reason disagreement")
        ok(tampered_check("estimatedCostMicros", -1), "check refuses negative cost")
        ok(tampered_check("overBudgetByMicros", 999999), "check refuses over-budget above cost")
        ok(tampered_check("fragmentationFloorMilli", 999), "check refuses floor drift")
        refuses(lambda: mutated(lambda d: d["cases"][0].__setitem__("expected", "no"), check), "check refuses non-object expected")
        refuses(lambda: mutated(lambda d: d["cases"][0]["expected"].__setitem__("ablations", "no"), check), "check refuses non-array ablations")
        refuses(lambda: mutated(lambda d: d["cases"][0]["expected"].__setitem__("ablations", ["no"]), check), "check refuses non-object ablation reading")
        refuses(lambda: mutated(lambda d: d["cases"][0]["expected"].__setitem__("ablations", [
            {"id": "x", "removedSignal": "cost", "beforeVerdict": "admit", "afterVerdict": "reject", "changed": False},
        ]), check), "check refuses changed disagreement")
        refuses(lambda: mutated(lambda d: d["cases"][0]["expected"].__setitem__("ablations", [
            {"id": "x", "removedSignal": "bogus", "beforeVerdict": "admit", "afterVerdict": "admit", "changed": False},
        ]), check), "check refuses ablation signal out of family")
        refuses(lambda: mutated(lambda d: d["cases"][0]["expected"].__setitem__("ablations", [
            {"id": "x", "removedSignal": "cost", "beforeVerdict": "bogus", "afterVerdict": "admit", "changed": True},
        ]), check), "check refuses ablation verdict out of family")
        refuses(lambda: mutated(lambda d: d["cases"][0]["expected"].__setitem__("ablations", [
            {"id": "x", "removedSignal": "cost", "beforeVerdict": "admit", "afterVerdict": "admit", "changed": "yes"},
        ]), check), "check refuses non-boolean changed")
        refuses(lambda: mutated(lambda d: d["cases"][0]["expected"].__setitem__("ablations", [
            {"id": "x", "removedSignal": "cost", "beforeVerdict": "admit", "afterVerdict": "admit", "changed": False},
            {"id": "x", "removedSignal": "cost", "beforeVerdict": "admit", "afterVerdict": "admit", "changed": False},
        ]), check), "check refuses duplicate ablation id")
        refuses(lambda: mutated(lambda d: d["cases"][0]["expected"].__setitem__("candidateCount", "no"), check), "check refuses non-integer count")
        refuses(lambda: check({"schema": "microglia/proposer-value@1", "cases": []}), "check refuses empty cases")

        # verify() guards — pick a case whose verdict is admit so the tamper actually changes it.
        refuses(lambda: mutated(lambda d: d["cases"][0]["expected"].__setitem__("verdict", "reject"), lambda doc: verify(fixture, doc)), "verify detects verdict tamper")
        refuses(lambda: mutated(lambda d: d["cases"][0]["expected"].__setitem__("estimatedCostMicros", 999999), lambda doc: verify(fixture, doc)), "verify detects cost tamper")
        refuses(lambda: mutated(lambda d: d.__setitem__("fixtureSchema", "wrong"), lambda doc: verify(fixture, doc)), "verify detects fixture schema drift")
        refuses(lambda: mutated(lambda d: d.__setitem__("cases", d["cases"][:1]), lambda doc: verify(fixture, doc)), "verify detects case-count drift")
        refuses(lambda: mutated(lambda d: d["cases"][0].__setitem__("id", "renamed"), lambda doc: verify(fixture, doc)), "verify detects case id drift")

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
