#!/usr/bin/env python3
"""The evaluation's independent reading of R245's quota-error taxonomy.

The product's classifier lives in `packages/eval/src/quota-disposition.ts` and is pinned by vitest. A second reader
that merely transcribed the manifest would agree for the wrong reason — both could share the same mistake. This
tool re-derives every family, disposition and hint from the fixture's bytes with an implementation that shares no
code with TypeScript. The taxonomy comes from BigModel's rate-limits page (retrieved 27 Nov 2026):

    python3 eval/tools/quota_disposition.py --build       # regenerate the manifest from the fixture
    python3 eval/tools/quota_disposition.py --check       # the manifest's own arithmetic is consistent
    python3 eval/tools/quota_disposition.py --verify      # re-derive from the fixture bytes and compare fields
    python3 eval/tools/quota_disposition.py --self-test   # boundaries, determinism, tamper detection

`--manifest` and `--fixture` redirect every mode, so the self-test can drive distinct tampers against temporary
files without touching the committed pair.

What this establishes: the classifier is deterministic, balance is a 403 and never a retried 429, NO_RETRY quota
codes stop, spend windows wait, and rate limits retry. It does NOT claim an accuracy gain — no model was called.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "eval" / "fixtures" / "quota-replies.json"
MANIFEST = ROOT / "eval" / "manifests" / "quota-disposition.json"

SCHEMA = "microglia/quota-disposition@1"
FIXTURE_SCHEMA = "microglia/quota-replies@1"
DISPOSITIONS = ("retry", "wait-until", "stop")
FAMILIES = (
    "balance.insufficient", "window.cap", "key.quota", "window.subscription",
    "coding.backoff", "coding.reset", "coding.config", "rate.concurrency",
    "rate.rpm", "rate.upstream", "rate.unclassified", "window.spend",
    "server", "transient.4xx", "refusal",
)

CODING_BACKOFF = {"1302", "1305"}
CODING_RESET = {"1308", "1310", "1316", "1317", "1318", "1319", "1320", "1321"}
CODING_BALANCE = {"1113", "1311", "1309"}
CODING_CONFIG = {"1313", "1314", "1315"}
WINDOW_MARKERS = (
    "spend limit", "5-hour", "daily spend", "7-day", "next_flush_time",
    "usage limit reached", "限额",
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


def first_string(*values: object) -> str | None:
    for value in values:
        if isinstance(value, bool):
            continue
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return str(value)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def parse_reply(case: dict) -> tuple[str | None, str | None]:
    """Return (code, message) from a case's body, reading both provider shapes."""
    body = case.get("body")
    parsed: dict = {}
    if isinstance(body, str):
        try:
            loaded = json.loads(body)
            if isinstance(loaded, dict):
                parsed = loaded
        except ValueError:
            parsed = {}
    elif isinstance(body, dict):
        parsed = body
    error = parsed.get("error")
    nested = error if isinstance(error, dict) else {}
    code = first_string(nested.get("code"), nested.get("type"), parsed.get("code"))
    message = first_string(nested.get("message"), nested.get("msg"), parsed.get("message"), parsed.get("msg"))
    return code, message


def classify(status: int, code: str | None, message: str | None, retry_after_ms: int | None) -> dict:
    """The independent classifier. Order mirrors the product's specificity order exactly."""
    c = (code or "").lower()
    m = (message or "").lower()

    def v(family: str, disposition: str, hint: str) -> dict:
        result = {"family": family, "disposition": disposition, "hint": hint}
        if code is not None:
            result["code"] = code
        return result

    if status == 403:
        return v("balance.insufficient", "stop", "top-up")
    if status == 402:
        return v("window.cap", "wait-until", "wait-for-spend-cap-reset")
    if status >= 500:
        return v("server", "retry", "backoff-retry")
    if status == 429:
        if c == "api_key_quota_exhausted":
            return v("key.quota", "stop", "raise-key-quota")
        if c == "usage_limit_exceeded":
            return v("window.subscription", "wait-until", "wait-for-subscription-reset")
        if c == "insufficient_balance":
            return v("balance.insufficient", "stop", "top-up")
        if c in CODING_BALANCE:
            return v("balance.insufficient", "stop", "top-up")
        if c in CODING_CONFIG:
            return v("coding.config", "stop", "fix-key-or-plan")
        if c in CODING_RESET:
            return v("coding.reset", "wait-until", "wait-for-next-flush")
        if c in CODING_BACKOFF:
            return v("coding.backoff", "retry", "backoff-retry")
        if any(marker in m for marker in WINDOW_MARKERS):
            return v("window.spend", "wait-until", "wait-for-window-reset")
        if c == "rate_limit_error":
            if "concurrency limit exceeded" in m or "too many pending requests" in m:
                return v("rate.concurrency", "retry", "reduce-parallelism-and-backoff")
            return v("rate.upstream", "retry", "backoff-retry")
        if c == "rate_limit_exceeded" and retry_after_ms is not None:
            return v("rate.rpm", "retry", "honor-retry-after")
        return v("rate.unclassified", "retry", "backoff-retry")
    if status in (408, 409, 425):
        return v("transient.4xx", "retry", "backoff-retry")
    return v("refusal", "stop", "fix-request-or-key")


def derive_from_document(document: dict) -> dict:
    """Re-derive the full reading from fixture bytes."""
    if document.get("schema") != FIXTURE_SCHEMA:
        raise Refusal("fixture schema mismatch")
    cases = document.get("cases")
    if not isinstance(cases, list) or not cases:
        raise Refusal("fixture has no cases")
    per_case: list[dict] = []
    seen: set[str] = set()
    for case in cases:
        if not isinstance(case, dict):
            raise Refusal("a case is not an object")
        ident = case.get("id")
        status = case.get("status")
        if not isinstance(ident, str) or not ident:
            raise Refusal("a case has no id")
        if ident in seen:
            raise Refusal(f"duplicate case id: {ident}")
        seen.add(ident)
        if isinstance(status, bool) or not isinstance(status, int) or not 100 <= status <= 599:
            raise Refusal(f"case {ident} has an invalid status")
        ra = case.get("retryAfterMs")
        if ra is not None and (isinstance(ra, bool) or not isinstance(ra, int) or ra < 0):
            raise Refusal(f"case {ident} has an invalid retryAfterMs")
        code, message = parse_reply(case)
        verdict = classify(status, code, message, ra)
        per_case.append({"id": ident, "status": status, **verdict})
    by_disposition = {d: sum(1 for c in per_case if c["disposition"] == d) for d in DISPOSITIONS}
    return {
        "cases": len(per_case),
        "byDisposition": by_disposition,
        "perCase": per_case,
    }


def build(fixture: Path) -> dict:
    document = load_json(fixture, "fixture")
    reading = derive_from_document(document)
    return {
        "schema": SCHEMA,
        "note": (
            "R245. A 429 is a family, not a verdict. BigModel's rate-limit page separates retryable "
            "limits (concurrency / RPM with Retry-After) from spend windows, subscription caps, key "
            "quotas and — at HTTP 403 — insufficient balance. This reading re-derives the family, "
            "disposition and hint of each real-shaped reply from fixture bytes, independent of the "
            "TypeScript product. No model was called; no accuracy is claimed."
        ),
        "sourceSha256": sha256(fixture),
        "reading": reading,
    }


def check(manifest: dict) -> bool:
    """Re-add the manifest's own arithmetic without re-reading the fixture."""
    if manifest.get("schema") != SCHEMA:
        raise Refusal("manifest schema mismatch")
    reading = manifest.get("reading")
    if not isinstance(reading, dict):
        raise Refusal("manifest has no reading")
    per_case = reading.get("perCase")
    if not isinstance(per_case, list) or not per_case:
        raise Refusal("manifest has no perCase")
    tally = reading.get("byDisposition")
    if not isinstance(tally, dict):
        raise Refusal("manifest has no byDisposition")
    expected = {d: 0 for d in DISPOSITIONS}
    for case in per_case:
        family = case.get("family")
        disposition = case.get("disposition")
        hint = case.get("hint")
        if family not in FAMILIES:
            raise Refusal(f"unknown family: {family}")
        if disposition not in DISPOSITIONS:
            raise Refusal(f"unknown disposition: {disposition}")
        if not isinstance(hint, str) or not hint:
            raise Refusal("a case has no hint")
        if disposition in expected:
            expected[disposition] += 1
    if reading.get("cases") != len(per_case):
        raise Refusal("cases count disagrees with perCase length")
    if any(tally.get(d) != expected[d] for d in DISPOSITIONS):
        raise Refusal("byDisposition tally disagrees with perCase")
    return True


def verify(manifest: dict, fixture: Path) -> bool:
    """Re-derive from the fixture bytes and compare every field against the manifest."""
    if manifest.get("sourceSha256") != sha256(fixture):
        raise Refusal("fixture digest changed")
    document = load_json(fixture, "fixture")
    derived = derive_from_document(document)
    reading = manifest.get("reading")
    if not isinstance(reading, dict):
        raise Refusal("manifest has no reading")
    if derived != reading:
        raise Refusal("fixture-derived reading disagrees with the manifest")
    return True


def self_test() -> None:
    """Boundaries, determinism and tamper detection. Prints one line per assertion."""
    passed = 0

    def record(name: str, ok: bool) -> None:
        nonlocal passed
        if not ok:
            raise Refusal(f"self-test failed: {name}")
        passed += 1

    def refused(name: str, fn, *args) -> None:
        try:
            fn(*args)
        except Refusal:
            record(name, True)
        else:
            raise Refusal(f"self-test failed: {name} did not refuse")

    document = json.loads(FIXTURE.read_text(encoding="utf-8"))
    reading = derive_from_document(document)

    # The decisive facts.
    by_id = {c["id"]: c for c in reading["perCase"]}
    record("403 balance is a stop", by_id["balance-403"]["family"] == "balance.insufficient" and by_id["balance-403"]["disposition"] == "stop")
    record("402 cap waits", by_id["spend-cap-402"]["disposition"] == "wait-until")
    record("concurrency retries", by_id["rate-concurrency"]["family"] == "rate.concurrency" and by_id["rate-concurrency"]["disposition"] == "retry")
    record("rpm honours retry-after", by_id["rate-rpm"]["hint"] == "honor-retry-after")
    record("key quota stops", by_id["key-quota"]["disposition"] == "stop")
    record("5h window waits", by_id["window-5h"]["family"] == "window.spend" and by_id["window-5h"]["disposition"] == "wait-until")
    record("coding 1302 retries", by_id["coding-1302"]["family"] == "coding.backoff")
    record("coding 1308 waits", by_id["coding-1308"]["family"] == "coding.reset" and by_id["coding-1308"]["disposition"] == "wait-until")
    record("coding 1113 tops up", by_id["coding-1113"]["family"] == "balance.insufficient" and by_id["coding-1113"]["disposition"] == "stop")
    record("503 retries", by_id["server-503"]["disposition"] == "retry")
    record("400 refuses", by_id["refusal-400"]["disposition"] == "stop")
    record("bare 429 retries", by_id["rate-unclassified"]["family"] == "rate.unclassified")

    # Determinism and order independence of a dict read.
    record("derive is deterministic", derive_from_document(document) == reading)
    record("every disposition is one of three", all(c["disposition"] in DISPOSITIONS for c in reading["perCase"]))

    # Classification boundaries not present in the fixture.
    record("403 wins over any code", classify(403, "rate_limit_error", "x", None)["family"] == "balance.insufficient")
    record("402 wins over any code", classify(402, "API_KEY_QUOTA_EXHAUSTED", "x", None)["family"] == "window.cap")
    record("500 retries", classify(500, None, None, None)["disposition"] == "retry")
    record("408/409/425 transient", all(classify(s, None, None, None)["family"] == "transient.4xx" for s in (408, 409, 425)))
    record("usage limit waits", classify(429, "USAGE_LIMIT_EXCEEDED", None, None)["disposition"] == "wait-until")
    record("insufficient balance code stops", classify(429, "INSUFFICIENT_BALANCE", None, None)["disposition"] == "stop")
    record("coding 1313 config stops", classify(429, "1313", None, None)["hint"] == "fix-key-or-plan")
    record("coding 1305 backoff", classify(429, "1305", None, None)["family"] == "coding.backoff")
    record("coding 1316 reset", classify(429, "1316", None, None)["family"] == "coding.reset")
    record("too many pending concurrency", classify(429, "rate_limit_error", "Too many pending requests", None)["family"] == "rate.concurrency")
    record("upstream rate error retries", classify(429, "rate_limit_error", "provider throttle", None)["family"] == "rate.upstream")
    record("rate exceeded without header unclassified", classify(429, "rate_limit_exceeded", "x", None)["family"] == "rate.unclassified")
    record("window marker in chinese", classify(429, "rate_limit_exceeded", "触发限额", None)["family"] == "window.spend")
    record("case insensitive code", classify(429, "Rate_Limit_Error", "CONCURRENCY LIMIT EXCEEDED", None)["family"] == "rate.concurrency")
    record("case insensitive balance", classify(403, "insufficient_balance", None, None)["family"] == "balance.insufficient")
    record("numeric code becomes string", parse_reply({"body": {"code": 1113, "msg": "x"}})[0] == "1113")
    record("top-level code", parse_reply({"body": {"code": "X"}})[0] == "X")
    record("type alias", parse_reply({"body": {"error": {"type": "rate_limit_error"}}})[0] == "rate_limit_error")
    record("top-level message", parse_reply({"body": {"message": "bad"}})[1] == "bad")
    record("non-json body has no code", parse_reply({"body": "<html>"}) == (None, None))
    record("absent body has no code", parse_reply({}) == (None, None))

    good = build(FIXTURE)
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        manifest_path = tmp / "manifest.json"
        fixture_path = tmp / "fixture.json"
        manifest_path.write_text(json.dumps(good), encoding="utf-8")
        fixture_path.write_text(FIXTURE.read_text(encoding="utf-8"), encoding="utf-8")
        record("check accepts a good manifest", check(good))
        record("verify accepts a good pair", verify(good, fixture_path))

        refused("check refuses wrong schema", check, {**good, "schema": "x"})
        refused("check refuses missing reading", check, {"schema": SCHEMA})
        refused("check refuses empty perCase", check, {"schema": SCHEMA, "reading": {"cases": 0, "perCase": [], "byDisposition": {d: 0 for d in DISPOSITIONS}}})

        tampered = json.loads(json.dumps(good))
        tampered["reading"]["perCase"][0]["disposition"] = "retry"
        refused("check refuses wrong tally", check, tampered)
        refused("verify refuses tampered field", verify, tampered, fixture_path)

        tampered = json.loads(json.dumps(good))
        tampered["reading"]["cases"] += 1
        refused("check refuses count drift", check, tampered)

        tampered = json.loads(json.dumps(good))
        tampered["sourceSha256"] = "0" * 64
        refused("verify refuses digest change", verify, tampered, fixture_path)

        bad_fixture = json.loads(json.dumps(document))
        bad_fixture["schema"] = "wrong"
        fixture_path.write_text(json.dumps(bad_fixture), encoding="utf-8")
        refused("verify refuses wrong fixture schema", verify, good, fixture_path)

        bad_fixture = json.loads(json.dumps(document))
        bad_fixture["cases"][0]["status"] = 99
        fixture_path.write_text(json.dumps(bad_fixture), encoding="utf-8")
        refused("derive refuses invalid status", derive_from_document, bad_fixture)

        bad_fixture = json.loads(json.dumps(document))
        bad_fixture["cases"][0]["id"] = bad_fixture["cases"][1]["id"]
        fixture_path.write_text(json.dumps(bad_fixture), encoding="utf-8")
        refused("derive refuses duplicate id", derive_from_document, bad_fixture)

        bad_fixture = json.loads(json.dumps(document))
        bad_fixture["cases"][0]["retryAfterMs"] = -1
        fixture_path.write_text(json.dumps(bad_fixture), encoding="utf-8")
        refused("derive refuses negative retry-after", derive_from_document, bad_fixture)

        refused("load refuses missing file", load_json, tmp / "missing.json", "fixture")

        not_object = tmp / "not-object.json"
        not_object.write_text("[]", encoding="utf-8")
        refused("load refuses a non-object", load_json, not_object, "fixture")

        # first_string skips a bool (a JSON true is not an error code).
        record("bool is not a code", parse_reply({"body": {"code": True}}) == (None, None))
        record("a json string body has no code", parse_reply({"body": '"just a string"'}) == (None, None))
        record("a dict body is read directly", parse_reply({"body": {"code": "X"}})[0] == "X")

        # derive's structural refusals.
        bad = json.loads(json.dumps(document))
        bad["cases"][0] = "not an object"
        refused("derive refuses a non-object case", derive_from_document, bad)
        bad = json.loads(json.dumps(document))
        bad["cases"][0].pop("id")
        refused("derive refuses a missing id", derive_from_document, bad)
        bad = json.loads(json.dumps(document))
        bad["cases"] = []
        refused("derive refuses empty cases", derive_from_document, bad)

        # check's structural refusals.
        refused("check refuses missing byDisposition", check, {"schema": SCHEMA, "reading": {"cases": 1, "perCase": [{"family": "refusal", "disposition": "stop", "hint": "x"}]}})
        bad = json.loads(json.dumps(good))
        bad["reading"]["perCase"][0]["family"] = "bogus"
        refused("check refuses an unknown family", check, bad)
        bad = json.loads(json.dumps(good))
        bad["reading"]["perCase"][0]["disposition"] = "bogus"
        refused("check refuses an unknown disposition", check, bad)
        bad = json.loads(json.dumps(good))
        bad["reading"]["perCase"][0]["hint"] = ""
        refused("check refuses an empty hint", check, bad)

        # verify's structural refusal: a reading whose shape is wrong.
        refused("verify refuses a missing reading", verify, {"schema": SCHEMA, "sourceSha256": sha256(FIXTURE)}, FIXTURE)

        # main's build/check/verify/no-op paths, through the real CLI entry.
        # Earlier tamper tests rewrote fixture_path; restore it before the CLI checks.
        fixture_path.write_text(FIXTURE.read_text(encoding="utf-8"), encoding="utf-8")
        built_path = tmp / "built.json"
        record("main build writes a manifest", main(["--build", "--fixture", str(FIXTURE), "--manifest", str(built_path)]) == 0 and built_path.exists())
        record("main check returns 0", main(["--check", "--manifest", str(manifest_path)]) == 0)
        record("main verify returns 0", main(["--verify", "--manifest", str(manifest_path), "--fixture", str(fixture_path)]) == 0)
        record("main no flags returns 0", main([]) == 0)
        record("main build check verify combined", main([
            "--build", "--check", "--verify",
            "--fixture", str(FIXTURE), "--manifest", str(built_path),
        ]) == 0)

    print(f"self-test: {passed} assertions passed")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--build", action="store_true", help="regenerate the manifest from the fixture")
    parser.add_argument("--check", action="store_true", help="check the manifest's own arithmetic")
    parser.add_argument("--verify", action="store_true", help="re-derive from the fixture and compare fields")
    parser.add_argument("--self-test", action="store_true", help="run boundary and tamper assertions")
    parser.add_argument("--manifest", type=Path, default=MANIFEST)
    parser.add_argument("--fixture", type=Path, default=FIXTURE)
    args = parser.parse_args(argv)
    try:
        if args.self_test:
            self_test()
        if args.build:
            result = build(args.fixture)
            args.manifest.parent.mkdir(parents=True, exist_ok=True)
            args.manifest.write_text(json.dumps(result, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
            print(f"built {args.manifest}")
        if args.check:
            check(load_json(args.manifest, "manifest"))
            print("check: ok")
        if args.verify:
            verify(load_json(args.manifest, "manifest"), args.fixture)
            print("verify: ok")
    except Refusal as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
