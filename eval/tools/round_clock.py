#!/usr/bin/env python3
"""The clock this project pays against: a registered dispatch that has not been made is a defect, not a plan.

Why this exists. Two dispatches in this lane were armed on a `schedule:` trigger and **neither fired** — R216b's
10:02 UTC cron produced no run at all, and the round before it lost its window the same way (`AUDIT 34.232`,
`AUDIT 34.241`). GitHub's own documentation says scheduled events are best-effort and may be dropped under load, so
the failure is not a misconfiguration to be found and fixed: a funded action must not be handed to a timer that does
not guarantee execution.

Two things follow, and this file is the second one.

1. **A dispatch is a `workflow_dispatch`.** Nothing that spends money fires on a clock.
2. **Overdue is checked by CI, not by memory.** `ci.yml` runs this tool on every push, so a round that was
   registered for a date and never dispatched turns the build red on the next commit instead of being discovered
   when someone next reads the roadmap.

The registry is data rather than prose for the same reason every other manifest here is: a date in a markdown table
is a date nobody can assert on.

    python3 eval/tools/round_clock.py                  # exit 1 if a registered round is past its date
    python3 eval/tools/round_clock.py --self-test      # the suite
    python3 eval/tools/round_clock.py --now 2026-12-01T00:00:00Z   # what the suite cannot wait for
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

#: The registry, next to the other manifests. A single file so a reader can see every round that is owed.
REGISTRY = Path(__file__).resolve().parents[1] / "manifests" / "rounds.json"

#: The states a round may be in. `registered` is the only one that can be overdue: `dispatched` has a run, and
#: `read` has had its numbers taken off the run. `cancelled` is a decision, and a decision is not a debt.
STATES = ("registered", "dispatched", "read", "cancelled")


def tally(results: list[tuple[str, bool]]) -> tuple[int, int, list[str]]:
    """`(checks, failures, failure lines)` for a sheet of `(name, passed)`.

    Split out of the suite rather than written inside it, because the lines a failing suite prints are the only part
    of a suite that never runs when the suite passes — which is exactly how a reporter rots without anyone noticing.
    Here they are three expressions with assertions of their own.
    """
    lines = [f"FAIL {name}" for name, passed in results if not passed]
    return len(results), len(lines), lines


def summary(checks: int, failures: int, lines: list[str]) -> str:
    """The last thing a suite prints, in both of its shapes."""
    text = f"{checks - failures}/{checks} assertions"
    if failures:
        text = f"{text}\n" + "\n".join(lines) + f"\n{failures} failure(s)"
    return text


class Refusal(Exception):
    """A registry this tool will not read, as distinct from a round that is late."""


def moment_of(text: str) -> datetime:
    """A timestamp with a timezone, or a refusal.

    Naive timestamps are refused rather than assumed to be UTC: the difference between `2026-11-25T12:00` read as
    UTC and read as UTC+8 is eight hours of a round that either is or is not late.
    """
    try:
        moment = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        raise Refusal(f"{text!r}: not an ISO 8601 timestamp")
    if moment.tzinfo is None:
        raise Refusal(f"{text!r}: no timezone, so the deadline is a timezone's guess")
    return moment.astimezone(timezone.utc)


def load(path: Path | str = REGISTRY) -> list[dict]:
    """The rounds, checked for the fields the clock reads."""
    try:
        document = json.loads(Path(path).read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise Refusal(f"{path}: no such registry")
    except json.JSONDecodeError as error:
        raise Refusal(f"{path}: {error}")
    rounds = document.get("rounds") if isinstance(document, dict) else None
    if not isinstance(rounds, list):
        raise Refusal(f"{path}: no `rounds` list")
    for index, round in enumerate(rounds):
        if not isinstance(round, dict) or not isinstance(round.get("id"), str):
            raise Refusal(f"{path}: round {index} has no id")
        state = round.get("status")
        if state not in STATES:
            raise Refusal(f"{round['id']}: status {state!r} is not one of {STATES}")
        if state == "registered":
            if "dispatchBy" not in round:
                raise Refusal(f"{round['id']}: registered with no `dispatchBy`")
            moment_of(round["dispatchBy"])
    return rounds


def overdue(rounds: list[dict], now: datetime) -> list[dict]:
    """The registered rounds whose date has passed, in registry order.

    Only `registered` can be late. A round that is `dispatched` but unread is a different question — it has a run
    and a bill — and folding the two together would report a reading that is owed as a dispatch that never happened.
    """
    late = []
    for round in rounds:
        if round.get("status") != "registered":
            continue
        if moment_of(round["dispatchBy"]) < now.astimezone(timezone.utc):
            late.append(round)
    return late


def report(rounds: list[dict], late: list[dict], now: datetime) -> list[str]:
    """The lines a reader gets, which is a status per round rather than a verdict on one."""
    lines = [f"round clock, {now.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%MZ')}"]
    for round in rounds:
        state = round.get("status")
        when = round.get("dispatchBy") or round.get("dispatchedAt") or "-"
        mark = "LATE " if round in late else "     "
        lines.append(f"  {mark}{round['id']:8s} {state:10s} {when}")
    return lines


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Is a registered dispatch past its date?")
    parser.add_argument("--registry", default=str(REGISTRY))
    parser.add_argument("--now", default=None, help="an ISO 8601 moment, for a reader who is not in the present")
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--json", action="store_true")
    arguments = parser.parse_args(argv)

    if arguments.self_test:
        return self_test()

    now = moment_of(arguments.now) if arguments.now else datetime.now(timezone.utc)
    try:
        rounds = load(arguments.registry)
    except Refusal as error:
        print(f"round-clock-refused: {error}", file=sys.stderr)
        return 2

    late = overdue(rounds, now)
    if arguments.json:
        print(json.dumps({"now": now.isoformat(), "late": [round["id"] for round in late]}, indent=2))
    else:
        print("\n".join(report(rounds, late, now)))
    if late:
        print(
            f"round-clock-late: {', '.join(round['id'] for round in late)} — registered, past its date, never "
            "dispatched. Dispatch it or mark it cancelled; a date in a roadmap is not a debt this build can pay.",
            file=sys.stderr,
        )
        return 1
    return 0


def self_test() -> int:
    """The suite: every branch of the clock, on registries it builds rather than on the live one."""
    import tempfile

    results: list[tuple[str, bool]] = []

    def expect(name: str, condition: bool) -> None:
        results.append((name, condition))

    def refuses(name: str, body, fragment: str) -> None:
        """`body()` must raise a `Refusal` whose message carries `fragment`."""
        try:
            body()
        except Refusal as error:
            expect(name, fragment in str(error))
        else:
            expect(name, False)

    def registry(**rounds) -> Path:
        handle = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
        json.dump({"schema": "microglia.rounds/1", "rounds": rounds.get("of", [])}, handle)
        handle.close()
        return Path(handle.name)

    # --- the reporter, which otherwise only runs when something is wrong ------------------------------------------
    expect("a clean sheet counts its checks", tally([("a", True), ("b", True)]) == (2, 0, []))
    expect("a failure is counted and named", tally([("a", True), ("b", False)]) == (2, 1, ["FAIL b"]))
    expect("the summary of a clean sheet is one line", summary(2, 0, []) == "2/2 assertions")
    expect("and of a dirty one names each failure",
           summary(2, 1, ["FAIL b"]) == "1/2 assertions\nFAIL b\n1 failure(s)")

    now = moment_of("2026-11-25T14:00:00Z")

    # --- timestamps ------------------------------------------------------------------------------------------
    expect("a Z timestamp is UTC", moment_of("2026-11-25T14:00:00Z").hour == 14)
    expect("an offset timestamp is converted", moment_of("2026-11-25T22:00:00+08:00").hour == 14)
    refuses("a naive timestamp is refused", lambda: moment_of("2026-11-25T14:00:00"), "no timezone")
    refuses("a word is not a timestamp", lambda: moment_of("tomorrow"), "ISO 8601")

    # --- the registry ----------------------------------------------------------------------------------------
    rounds = load(registry(of=[
        {"id": "R1", "status": "read", "dispatchedAt": "2026-11-24T10:00:00Z"},
        {"id": "R2", "status": "registered", "dispatchBy": "2026-11-26T10:00:00Z"},
    ]))
    expect("the registry reads", [round["id"] for round in rounds] == ["R1", "R2"])
    refuses("a missing registry is refused", lambda: load("/nonexistent/rounds.json"), "no such registry")
    bad = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
    bad.write("{not json")
    bad.close()
    refuses("unreadable json is refused", lambda: load(bad.name), "line")
    refuses("a document with no rounds is refused", lambda: load(registry(of=None)), "no `rounds` list")
    refuses("a round with no id is refused", lambda: load(registry(of=[{"status": "read"}])), "has no id")
    refuses("an unknown state is refused",
            lambda: load(registry(of=[{"id": "R", "status": "someday"}])), "is not one of")
    refuses("a registered round with no date is refused",
            lambda: load(registry(of=[{"id": "R", "status": "registered"}])), "no `dispatchBy`")
    refuses("a registered round with a bad date is refused",
            lambda: load(registry(of=[{"id": "R", "status": "registered", "dispatchBy": "soon"}])), "ISO 8601")

    # --- the clock -------------------------------------------------------------------------------------------
    debt = load(registry(of=[
        {"id": "OWED", "status": "registered", "dispatchBy": "2026-11-25T13:00:00Z"},
        {"id": "SOON", "status": "registered", "dispatchBy": "2026-11-25T15:00:00Z"},
        {"id": "DONE", "status": "read", "dispatchBy": "2026-11-20T13:00:00Z"},
        {"id": "OFF", "status": "cancelled", "dispatchBy": "2026-11-20T13:00:00Z"},
        {"id": "RAN", "status": "dispatched", "dispatchBy": "2026-11-20T13:00:00Z"},
    ]))
    late = overdue(debt, now)
    expect("only the registered round past its date is late", [round["id"] for round in late] == ["OWED"])
    expect("a cancelled round is a decision, not a debt",
           not any(round["id"] == "OFF" for round in late))
    expect("a dispatched round is not late", not any(round["id"] == "RAN" for round in late))
    expect("the boundary is not late", overdue(load(registry(of=[
        {"id": "EDGE", "status": "registered", "dispatchBy": "2026-11-25T14:00:00Z"}])), now) == [])

    # --- the report and the exit code ------------------------------------------------------------------------
    lines = report(rounds, [], now)
    expect("the report names the clock", lines[0].startswith("round clock, 2026-11-25T14:00Z"))
    expect("and carries one line a round", len(lines) == 3)
    expect("a late round is marked", any(line.strip().startswith("LATE") for line in report(debt, late, now)))
    expect("and a paid round is not", not any(
        line.strip().startswith("LATE") for line in report(debt, late, now) if " RAN " in line))

    path = registry(of=[{"id": "OWED", "status": "registered", "dispatchBy": "2026-11-25T13:00:00Z"}])
    expect("an overdue registry exits one", _capture(["--registry", str(path)], 1))
    clear = registry(of=[{"id": "SOON", "status": "registered", "dispatchBy": "2026-11-26T13:00:00Z"}])
    expect("a registry that owes nothing exits zero", _capture(["--registry", str(clear)], 0))
    expect("the json reading names the late round",
           json.loads(_capture(["--registry", str(path), "--json"]))["late"] == ["OWED"])
    expect("a refused registry exits two", _capture(["--registry", "/nonexistent/x.json"], 2))
    expect("--now reads the clock it is given",
           _capture(["--registry", str(path), "--now", "2026-11-25T12:00:00Z"], 0))
    expect("the live registry parses", isinstance(load(), list))

    checks, failures, lines = tally(results)
    print(summary(checks, failures, lines))
    return 1 if failures else 0


def _capture(argv: list[str], expected: int | None = None):
    """`main` with its output held back, so the suite's transcript is its assertions.

    Returns the standard output, or — when `expected` is given — whether the exit code matched, which is what most
    of the suite's command-line assertions actually want.
    """
    import contextlib
    import io

    held = io.StringIO()
    with contextlib.redirect_stdout(held), contextlib.redirect_stderr(io.StringIO()):
        code = main(argv)
    return (code == expected) if expected is not None else held.getvalue()


if __name__ == "__main__":
    sys.exit(main())
