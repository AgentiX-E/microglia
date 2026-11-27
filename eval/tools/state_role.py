#!/usr/bin/env python3
"""The evaluation's independent reading of R244's state roles, re-derived from store bytes.

The product's classifier lives in `packages/core/src/apply/state-role.ts` and is pinned by vitest. A second reader
that merely transcribed the manifest would agree with the product for the wrong reason — both could be wrong in the
same way, and nothing would fail. So this tool re-derives every role from the fixture's bytes with an implementation
that shares no code with TypeScript, and the manifest is checked against it two ways:

    python3 eval/tools/state_role.py --build                    # regenerate the manifest from the fixture
    python3 eval/tools/state_role.py --check                    # the manifest's own arithmetic is consistent
    python3 eval/tools/state_role.py --verify                   # re-derive from the fixture bytes and compare fields
    python3 eval/tools/state_role.py --self-test                # boundaries, determinism, tamper detection

`--manifest` and `--fixture` redirect every one of those modes, which is what lets the self-test drive a dozen
distinct manifest and fixture tampers against temporary files without touching the committed pair.

`null` in the fixture is `Infinity` in memory — the store's own encoding of an open clock — and this reader performs
that translation explicitly rather than treating an absent bound as zero.

What the reading establishes, and what it does not. It establishes that the classifier is deterministic, that a
world-time-expired yet active rule is reported historical (the defect), that a contest survives serial-max, and that
the product's rendered lines agree. It does NOT claim an accuracy gain: no model was called, and Freshness's and
A-TMA's +pp belong to their own benchmarks, not to this corpus.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "eval" / "fixtures" / "state-role-store.json"
MANIFEST = ROOT / "eval" / "manifests" / "state-role.json"

ROLES = ("current", "historical", "transition")
SCHEMA = "microglia/state-role@1"


class Refusal(Exception):
    """A fixture or manifest this reader will not interpret, distinct from a disagreement between them."""


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def scope_key(scope: dict) -> str:
    """Mirror the kernel's scopeKey: task, then every optional field in a fixed order, empty for absent."""
    return "|".join(
        [
            str(scope.get("task", "")),
            str(scope.get("domain") or ""),
            str(scope.get("schemaDigest") or ""),
            str(scope.get("intent") or ""),
            str(scope.get("field") or ""),
            str(scope.get("reasonCode") or ""),
        ]
    )


def subject_key(item: dict) -> str:
    return f"{item['namespace']}|{item['kind']}|{scope_key(item['scope'])}"


def clock(value: object, name: str) -> float:
    """`null` is an open clock (Infinity); a number is that boundary. Anything else is a fixture defect."""
    if value is None:
        return float("inf")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    raise Refusal(f"{name} is {value!r}, neither a clock nor null")


def state_role(item: dict, now: float) -> str:
    """The three roles, transition first. Mirrors stateRoleOf exactly; boundaries are inclusive."""
    if item["contradictions"] > 0 or item["status"] == "conflicted":
        return "transition"
    if (
        now > clock(item["validUntil"], "validUntil")
        or now > clock(item["systemUntil"], "systemUntil")
        or now < clock(item["validFrom"], "validFrom")
        or now < clock(item["systemFrom"], "systemFrom")
    ):
        return "historical"
    return "current"


def serial(item: dict) -> str:
    """Fixed-width decimal + id, so a lexical max is the newest revision with a stable tie-break."""
    return f"{int(item['updatedAt']):016d}|{item['id']}"


def load_json(path: Path | str, label: str) -> dict:
    try:
        document = json.loads(Path(path).read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise Refusal(f"{path}: no such {label}")
    except json.JSONDecodeError as error:
        raise Refusal(f"{path}: {error}")
    if not isinstance(document, dict):
        raise Refusal(f"{path}: {label} is not an object")
    return document


def derive_from_document(document: dict) -> dict:
    """The complete reading over an in-memory document. Shared by `derive` and the self-test."""
    items = document.get("items")
    if not isinstance(items, list) or not items:
        raise Refusal("`items` is empty or absent")
    now = document.get("at")
    if not isinstance(now, (int, float)) or isinstance(now, bool):
        raise Refusal("`at` is not a clock")

    groups: dict[str, list[dict]] = {}
    for item in items:
        groups.setdefault(subject_key(item), []).append(item)

    own: dict[str, str] = {}
    resolved: dict[str, str] = {}
    winners: dict[str, str] = {}
    for key, group in groups.items():
        winner = max(group, key=serial)
        winners[key] = winner["id"]
        for item in group:
            role = state_role(item, now)
            own[item["id"]] = role
            if role == "transition" or item["id"] == winner["id"]:
                resolved[item["id"]] = role
            else:
                resolved[item["id"]] = "historical"

    per_item = []
    for item in sorted(items, key=lambda entry: entry["id"]):
        per_item.append(
            {
                "id": item["id"],
                "own": own[item["id"]],
                "resolved": resolved[item["id"]],
                "serial": serial(item),
                "subject": subject_key(item),
                "winner": winners[subject_key(item)],
            }
        )

    tally = {role: 0 for role in ROLES}
    for item in per_item:
        tally[item["resolved"]] += 1

    # The defect the old renderer hid: a rule still `active`, uncontested, whose world clock has ended.
    visible_bug = sum(
        1
        for item in items
        if item["contradictions"] == 0
        and item["status"] == "active"
        and now > clock(item["validUntil"], "validUntil")
    )

    return {
        "reading": {
            "at": now,
            "claims": len(groups),
            "items": len(items),
            "roles": tally,
            "perItem": per_item,
            "worldExpiredStillActive": visible_bug,
        },
    }


def derive(fixture_path: Path | str = FIXTURE) -> dict:
    """The complete reading from the fixture's bytes. No path other than the fixture is read."""
    reading = derive_from_document(load_json(fixture_path, "fixture"))
    path = Path(fixture_path)
    reading["sources"] = [
        {
            "bytes": len(path.read_bytes()),
            "path": str(path.relative_to(ROOT)) if path.is_relative_to(ROOT) else str(path),
            "role": "bitemporal-store-slice",
            "sha256": sha256(path),
        }
    ]
    return reading


def build(manifest_path: Path | str = MANIFEST, fixture_path: Path | str = FIXTURE) -> int:
    reading = derive(fixture_path)
    manifest = {
        "note": (
            "R244. The store carries four clocks and a contradiction count, but encodeItemLine rendered only six "
            "fields — a world-time-expired yet active rule and a live one reached the model in identical form. "
            "This reading enumerates the state role of every item in a bitemporal slice, re-derived from its bytes. "
            "worldExpiredStillActive is the count the old renderer silently called current. Roles are the closed "
            "three-role vocabulary; perItem.serial and .subject make serial-max auditable; the winner is the max "
            "serial of a claim. No model was called: this is the assembly instrument, not an accuracy claim."
        ),
        "schema": SCHEMA,
        **reading,
    }
    Path(manifest_path).write_text(json.dumps(manifest, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    print(f"wrote {manifest_path}")
    return 0


def check(manifest_path: Path | str = MANIFEST) -> int:
    """Internal consistency of the manifest, without reading the fixture."""
    document = load_json(manifest_path, "manifest")
    if document.get("schema") != SCHEMA:
        raise Refusal(f"schema is {document.get('schema')!r}, expected {SCHEMA!r}")
    reading = document.get("reading")
    if not isinstance(reading, dict):
        raise Refusal("no `reading`")
    per_item = reading.get("perItem")
    if not isinstance(per_item, list) or not per_item:
        raise Refusal("`perItem` is empty or absent")

    failures: list[str] = []
    tally = {role: 0 for role in ROLES}
    ids: set[str] = set()
    for entry in per_item:
        ident = entry.get("id")
        if ident in ids:
            failures.append(f"duplicate id {ident}")
        ids.add(ident)
        if entry.get("resolved") not in ROLES or entry.get("own") not in ROLES:
            failures.append(f"{ident}: role outside {ROLES}")
            continue
        tally[entry["resolved"]] += 1
        if entry["own"] == "transition" and entry["resolved"] != "transition":
            failures.append(f"{ident}: transition was overridden")
        if entry["id"] == entry["winner"] and entry["resolved"] != entry["own"]:
            failures.append(f"{ident}: winner's own role was changed")
        if entry["id"] != entry["winner"] and entry["own"] != "transition" and entry["resolved"] != "historical":
            failures.append(f"{ident}: superseded revision not historical")
    if tally != reading.get("roles"):
        failures.append(f"role tally {tally} != manifest {reading.get('roles')}")
    if len(ids) != reading.get("items"):
        failures.append(f"{len(ids)} items != manifest {reading.get('items')}")
    if len({entry["subject"] for entry in per_item}) != reading.get("claims"):
        failures.append("claim count != distinct subjects")

    total = 7 + len(per_item) * 5
    return report(failures, total)


def verify(manifest_path: Path | str = MANIFEST, fixture_path: Path | str = FIXTURE) -> int:
    """Re-derive the whole reading from the fixture bytes and compare every field."""
    expected = derive(fixture_path)
    document = load_json(manifest_path, "manifest")
    failures: list[str] = []
    for field in ("reading", "sources"):
        if document.get(field) != expected[field]:
            failures.append(f"{field} differs from a fresh derivation")
    if document.get("schema") != SCHEMA:
        failures.append("schema differs")
    return report(failures, 3)


def report(failures: list[str], total: int) -> int:
    """The last thing a mode prints, in both shapes: a reporter that only runs on failure rots unseen."""
    if failures:
        print(f"{total - len(failures)}/{total} assertions")
        for failure in failures:
            print(f"FAIL {failure}")
        return 1
    print(f"{total}/{total} assertions")
    return 0


def self_test() -> int:
    """Boundary cases, determinism, tamper detection, and every refusal path — before a reader is trusted."""
    results: list[tuple[str, bool]] = []

    def record(name: str, passed: bool) -> None:
        results.append((name, passed))

    base = {
        "namespace": "acme", "kind": "constraint", "scope": {"task": "t"},
        "validFrom": 0, "validUntil": None, "systemFrom": 0, "systemUntil": None,
        "contradictions": 0, "status": "active", "updatedAt": 10, "id": "k",
    }
    record("live is current", state_role(base, 5) == "current")
    record("world expiry is historical", state_role({**base, "validUntil": 4}, 5) == "historical")
    record("system expiry is historical", state_role({**base, "systemUntil": 4}, 5) == "historical")
    record("future is historical", state_role({**base, "validFrom": 6}, 5) == "historical")
    record("system future is historical", state_role({**base, "systemFrom": 6}, 5) == "historical")
    record("boundary is inclusive", state_role({**base, "validUntil": 5}, 5) == "current")
    record("contradiction is transition", state_role({**base, "contradictions": 1}, 5) == "transition")
    record("conflicted is transition", state_role({**base, "status": "conflicted"}, 5) == "transition")
    record("transition beats expiry", state_role({**base, "contradictions": 1, "validUntil": 4}, 5) == "transition")
    record("serial orders by clock", serial({**base, "updatedAt": 999}) < serial({**base, "updatedAt": 1000}))
    record("serial tie breaks by id", serial({**base, "id": "a"}) < serial({**base, "id": "b"}))
    record("null clock is infinity", clock(None, "x") == float("inf"))
    record("numeric clock is read", clock(7, "x") == 7.0)
    for bad in ("abc", True, [], {}):
        try:
            clock(bad, "x")
        except Refusal:
            record(f"clock refuses {bad!r}", True)
        else:
            record(f"clock refuses {bad!r}", False)
    record("scope key keeps optional fields distinct", scope_key({"task": "t", "intent": "a"}) != scope_key({"task": "t"}))

    reading = derive()
    record("reading is deterministic", derive() == reading)
    record("defect is enumerated non-zero", reading["reading"]["worldExpiredStillActive"] >= 1)
    record("roles are the closed vocabulary", set(reading["reading"]["roles"]) == set(ROLES))
    record("tally sums to item count", sum(reading["reading"]["roles"].values()) == reading["reading"]["items"])

    with tempfile.TemporaryDirectory() as tmp:
        directory = Path(tmp)
        document = json.loads(FIXTURE.read_text(encoding="utf-8"))
        manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))

        def write(name: str, data: object) -> Path:
            path = directory / name
            path.write_text(json.dumps(data), encoding="utf-8")
            return path

        def refused(label: str, fn: object, *args: object) -> None:
            try:
                fn(*args)  # type: ignore[operator]
            except Refusal:
                record(label, True)
            else:
                record(label, False)

        # Refusal paths.
        refused("derive refuses a missing fixture", derive, directory / "missing.json")
        bad_json = write("bad.json", {})
        bad_json.write_text("{not json", encoding="utf-8")
        refused("load_json refuses malformed json", load_json, bad_json, "fixture")
        refused("load_json refuses a non-object", load_json, write("list.json", []), "fixture")
        refused("derive refuses an empty item list", derive_from_document, {"at": 5, "items": []})
        refused("derive refuses a missing clock", derive_from_document, {**document, "at": None})
        refused("derive refuses a boolean clock", derive_from_document, {**document, "at": True})
        refused("check refuses a missing manifest", check, directory / "missing.json")
        schema_path = write("schema.json", {**manifest, "schema": "wrong"})
        refused("check refuses a wrong schema", check, schema_path)
        refused("check refuses a missing reading", check, write("noread.json", {"schema": SCHEMA}))
        refused("check refuses an empty perItem", check, write("empty.json", {"schema": SCHEMA, "reading": {"perItem": []}}))

        # Tamper detection: each check() failure branch.
        def tamper(label: str, mutate: object) -> None:
            data = json.loads(json.dumps(manifest))
            mutate(data["reading"]["perItem"])
            path = write(f"t_{label}.json", data)
            record(f"check refuses {label}", check(path) == 1)

        tamper("a duplicate id", lambda rows: rows.append(dict(rows[0])))
        tamper("an out-of-vocabulary role", lambda rows: rows[0].update(resolved="currentish"))
        tamper("an overridden transition", lambda rows: next(r.update(resolved="current") for r in rows if r["own"] == "transition"))
        tamper("a changed winner role", lambda rows: next(r.update(resolved="historical") for r in rows if r["id"] == r["winner"] and r["own"] == "current"))
        tamper("a superseded revision kept current", lambda rows: next(r.update(resolved="current") for r in rows if r["id"] != r["winner"] and r["own"] == "current"))
        changed = json.loads(json.dumps(manifest))
        changed["reading"]["roles"]["current"] += 1
        record("check refuses a wrong tally", check(write("tally.json", changed)) == 1)
        changed = json.loads(json.dumps(manifest))
        changed["reading"]["items"] += 1
        record("check refuses a wrong item count", check(write("count.json", changed)) == 1)
        changed = json.loads(json.dumps(manifest))
        changed["reading"]["claims"] += 1
        record("check refuses a wrong claim count", check(write("claims.json", changed)) == 1)

        # verify() failures and success, and build() round-trip.
        record("verify accepts the committed pair", verify() == 0)
        changed = json.loads(json.dumps(manifest))
        changed["reading"]["at"] += 1
        record("verify refuses a changed reading", verify(write("vreading.json", changed)) == 1)
        changed = json.loads(json.dumps(manifest))
        changed["schema"] = "wrong"
        record("verify refuses a changed schema", verify(write("vschema.json", changed)) == 1)
        changed = json.loads(json.dumps(manifest))
        changed["sources"][0]["sha256"] = "0" * 64
        record("verify refuses a changed digest", verify(write("vhash.json", changed)) == 1)
        built = directory / "built.json"
        record("build writes a manifest", build(built) == 0 and built.exists())
        record("the built manifest verifies", verify(built) == 0)
        record("the built manifest checks", check(built) == 0)

        # A changed fixture clock changes the reading (defect enumeration is not fixed text).
        changed_doc = json.loads(json.dumps(document))
        changed_doc["items"][0]["validUntil"] = changed_doc["at"] - 1
        record(
            "a clock change changes the reading",
            derive_from_document(changed_doc)["reading"] != reading["reading"],
        )

    failures = [name for name, passed in results if not passed]
    total = len(results)
    print(f"{total - len(failures)}/{total} assertions")
    for failure in failures:
        print(f"FAIL {failure}")
    return 1 if failures else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--build", action="store_true")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--verify", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--manifest", default=str(MANIFEST))
    parser.add_argument("--fixture", default=str(FIXTURE))
    arguments = parser.parse_args()
    try:
        if arguments.self_test:
            return self_test()
        if arguments.build:
            return build(arguments.manifest, arguments.fixture)
        if arguments.check:
            return check(arguments.manifest)
        if arguments.verify:
            return verify(arguments.manifest, arguments.fixture)
    except Refusal as error:
        print(f"REFUSAL {error}")
        return 2
    parser.print_help()
    return 0


if __name__ == "__main__":
    sys.exit(main())
