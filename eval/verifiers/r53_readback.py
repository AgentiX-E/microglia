#!/usr/bin/env python3
"""R53 readback: three levels of one sentence, over one store, in one dispatch.

The registration is `prereg/R53-use-time-calibration.md`. The 2026 literature it
rests on moved one step past retrieval: MemTrapBench finds every framework it
tested scoring below no-memory because a *correct* memory anchors the model to a
frame that no longer fits, MemCalib finds over-use rather than under-use
dominates, and RPEval finds humans ignore an irrelevant preference at 0.86 while
GPT-5 does at 0.12. The pack's only hook on that failure is the sentence the
block opens with, and until R53 it had one setting.

The arm was blocked on a capability rather than on a switch. Its first
refutation is an equality between three arms -- *the delivery censuses are
identical to the digit* -- and no arrangement of three dispatches can satisfy it:
the model produces the corrections at run time, so R54 distilled from ten and
R56 from eight on the same learning fold. The capability is `TAU_FACADE_NOTES`:
one dispatch, one store, three recall facades whose only difference is the note,
with the character budget charged to the block's data so the longer sentence
cannot displace the last rule (`RenderOptions.budgetBasis`).

States. GRADED, NO_MEASUREMENT and ABANDONED are the three R49 and R51 use;
DISCARDED is R54's, for a dispatch that ran a different experiment.

  GRADED          every graded prediction holds and no refutation fired.
  NO_MEASUREMENT  the artefact cannot name the three levels or carries no
                  contrast, so the treatment is not recoverable. R53's third
                  refutation spells this state out.
  DISCARDED       the artefact's budget basis is not the one the control
                  requires, so the arms differed in more than the sentence
                  before any number was read.
  ABANDONED       a refutation fired or a prediction failed.

Usage:
  python3 eval/tools/fetch_evidence.py --repo microglia --run <run-id> --out /tmp/r53
  python3 r53_readback.py --dir /tmp/r53
  python3 r53_readback.py --self-test

`--dir` is searched for `poc-l4-facade-notes.json`. No pair file is read: a
three-level arm is not paired against the memory-free reference, and handing its
deltas to the R45 revert rule would grade a different population.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

STATES = ("GRADED", "NO_MEASUREMENT", "DISCARDED", "ABANDONED")

# Quoted from `prereg/R53-use-time-calibration.md`, written before the dispatch.
REGISTERED_LEVELS = ("none", "standard", "hardened")
PRIMARY_NOTE = "standard"
TREATED_NOTE = "hardened"
REQUIRED_BASIS = "note-excluded"
# Prediction 3's own number: the parse rate stays within two points of the
# standard arm.
PARSE_RATE_TOLERANCE = 0.02
# The delivery census is compared to the digit, which is what a pure function of
# (store, query, floor, limit) can be held to.
CENSUS_PLACES = 3


class Report:
    def __init__(self) -> None:
        self.predictions: list[tuple[str, bool | None, str]] = []
        self.refutations: list[tuple[str, bool, str]] = []
        self.context: list[str] = []

    def predict(self, name: str, ok: bool | None, detail: str = "") -> None:
        self.predictions.append((name, None if ok is None else bool(ok), detail))

    def refute(self, name: str, fired: bool, detail: str = "") -> None:
        self.refutations.append((name, bool(fired), detail))

    def note(self, text: str) -> None:
        self.context.append(text)

    @property
    def refutation_fired(self) -> bool:
        return any(fired for _, fired, _ in self.refutations)

    @property
    def prediction_failed(self) -> bool:
        return any(ok is False for _, ok, _ in self.predictions)

    def render(self) -> str:
        lines = ["predictions:"]
        for name, ok, detail in self.predictions:
            mark = "n/a " if ok is None else ("PASS" if ok else "FAIL")
            lines.append(f"  {mark}  {name}{'' if not detail else f'  ({detail})'}")
        lines.append("refutations:")
        for name, fired, detail in self.refutations:
            lines.append(f"  {'FIRED' if fired else 'clear'} {name}{'' if not detail else f'  ({detail})'}")
        if self.context:
            lines.append("context (not graded):")
            for text in self.context:
                lines.append(f"  {text}")
        return "\n".join(lines)


def number(value: Any) -> float | None:
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def arms_of(artefact: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """The arms by note level. A repeated level keeps the first and is reported."""
    found: dict[str, dict[str, Any]] = {}
    for arm in artefact.get("arms") or []:
        if not isinstance(arm, dict):
            continue
        note = arm.get("note")
        if isinstance(note, str) and note not in found:
            found[note] = arm
    return found


def contrast_of(artefact: dict[str, Any], arm: str) -> dict[str, Any] | None:
    for contrast in artefact.get("contrasts") or []:
        if isinstance(contrast, dict) and contrast.get("arm") == arm:
            comparison = contrast.get("comparison")
            if isinstance(comparison, dict):
                return comparison
    return None


def parse_rate_of(arm: dict[str, Any]) -> float | None:
    scored = number(arm.get("scoredTasks"))
    unscored = number(arm.get("unscoredTasks"))
    if scored is None or unscored is None or scored <= 0:
        return None
    return (scored - unscored) / scored


def abstention_rate_of(arm: dict[str, Any]) -> float | None:
    census = arm.get("inaction")
    if not isinstance(census, dict):
        return None
    episodes = number(census.get("episodes"))
    abstained = number(census.get("abstained"))
    if episodes is None or abstained is None or episodes <= 0:
        return None
    return abstained / episodes


def readings(report: Report, artefact: dict[str, Any]) -> dict[str, Any]:
    """Every reading the artefact still supports, taken before any state is decided.

    This is the repair R56's readback needed and this one is born with: a
    `NO_MEASUREMENT` is a statement about one field, so the numbers that did
    survive have to be written down first. R56's record would have been four
    lines of `n/a` about a run whose HARM was measured and reconciled.
    """
    arms = arms_of(artefact)
    identity = artefact.get("packIdentity") or {}
    compared = number(identity.get("compared"))
    mismatched = number(identity.get("mismatched"))
    report.note(
        f"pack identity: {int(compared or 0)} shared request(s), {int(mismatched or 0)} mismatch"
    )
    for note in REGISTERED_LEVELS:
        arm = arms.get(note)
        if arm is None:
            report.note(f"{note}: absent from the artefact")
            continue
        items = number(arm.get("itemsPerRequest"))
        served = number(arm.get("servedPacks"))
        requests = number(arm.get("recallRequests"))
        pass4 = number(arm.get("pass4"))
        rate = parse_rate_of(arm)
        idle = abstention_rate_of(arm)
        report.note(
            f"{note}: pass4 {None if pass4 is None else round(pass4 * 100, 2)}% "
            f"served {None if served is None else int(served)}/{None if requests is None else int(requests)} "
            f"items/req {items} parse {None if rate is None else round(rate, 4)} "
            f"abstained {None if idle is None else round(idle, 4)}"
        )
    for note in (TREATED_NOTE, "none"):
        comparison = contrast_of(artefact, note)
        if comparison is None:
            report.note(f"{note} vs {PRIMARY_NOTE}: no contrast")
            continue
        delta = number(comparison.get("deltaPp"))
        low = number(comparison.get("ciLowPp"))
        high = number(comparison.get("ciHighPp"))
        p = number(comparison.get("p"))
        paired = number(comparison.get("paired"))
        half = None if low is None or high is None else (high - low) / 2
        report.note(
            f"{note} vs {PRIMARY_NOTE}: delta {delta}pp "
            f"[{low}, {high}] p {p} n {None if paired is None else int(paired)} "
            f"resolution {None if half is None else round(half, 2)}pp"
        )
    return {"arms": arms, "compared": compared, "mismatched": mismatched}


def grade(artefact: dict[str, Any]) -> tuple[str, Report]:
    report = Report()
    observed = readings(report, artefact)

    # The control's premise, before any number is read. A three-level arm under
    # the historical accounting varies a sentence AND a pack: at a fixed budget
    # the hardened sentence is longer and buys that room by dropping the last
    # rule, which is exactly what the first refutation exists to catch.
    basis = artefact.get("budgetBasis")
    if basis != REQUIRED_BASIS:
        report.refute(
            "the budget was charged to the block's data, not to the wrapper",
            True,
            f"budgetBasis {basis!r}, expected {REQUIRED_BASIS!r}: the longer note displaces a rule",
        )
        return "DISCARDED", report

    levels = tuple(str(level) for level in artefact.get("levels") or [])
    if sorted(levels) != sorted(REGISTERED_LEVELS):
        # R53's third refutation, first half: two runs of one level would read as
        # three, so an artefact that does not name all three measured nothing.
        report.predict(
            "the artefact names all three levels it ran",
            None,
            f"levels {list(levels)}",
        )
        return "NO_MEASUREMENT", report
    report.predict("the artefact names all three levels it ran", True, ", ".join(levels))

    arms = observed["arms"]
    treated = arms.get(TREATED_NOTE)
    primary = arms.get(PRIMARY_NOTE)
    if treated is None or primary is None:
        report.predict("both graded arms are present", None, "hardened or standard arm absent")
        return "NO_MEASUREMENT", report

    comparison = contrast_of(artefact, TREATED_NOTE)
    if comparison is None:
        report.predict(
            "the hardened arm has a paired contrast against the standard arm",
            None,
            "no contrast: the two arms scored no common task",
        )
        return "NO_MEASUREMENT", report

    delta = number(comparison.get("deltaPp"))
    low = number(comparison.get("ciLowPp"))
    high = number(comparison.get("ciHighPp"))
    if delta is None or low is None or high is None:
        report.predict("the contrast states its delta and interval", None, "delta or interval absent")
        return "NO_MEASUREMENT", report
    resolution = (high - low) / 2

    # Refutation 1: the delivery census is identical to the digit. Under
    # `note-excluded` the item list is a pure function of store, query, floor and
    # limit, so any mismatch means the arms differed in something unnamed.
    mismatched = int(observed["mismatched"] or 0)
    compared = int(observed["compared"] or 0)
    if mismatched > 0:
        report.refute(
            "the three arms served the same items for every shared request",
            True,
            f"{mismatched} of {compared} request(s) differ",
        )
        return "ABANDONED", report
    if compared == 0:
        report.predict(
            "the arms shared a request population to compare",
            None,
            "no request was answered by two arms",
        )
    else:
        report.predict(
            "the three arms served the same items for every shared request",
            True,
            f"{compared} shared request(s), 0 mismatch",
        )

    items = {note: number(arms[note].get("itemsPerRequest")) for note in REGISTERED_LEVELS if note in arms}
    distinct = {round(value, CENSUS_PLACES) for value in items.values() if value is not None}
    report.predict(
        "the delivery census is identical across the three arms",
        None if len(items) < 3 else len(distinct) <= 1,
        ", ".join(f"{note} {value}" for note, value in items.items()),
    )

    # Prediction 1: hardened at or above standard by at least what this sample can
    # resolve. Between zero and the resolution no claim is made either way, which
    # is the registration's own wording.
    if delta >= resolution:
        report.predict(
            "hardened is above standard by at least the pair's resolution",
            True,
            f"+{round(delta, 2)}pp against {round(resolution, 2)}pp",
        )
    elif delta >= 0:
        report.predict(
            "hardened is above standard by at least the pair's resolution",
            None,
            f"+{round(delta, 2)}pp is under the {round(resolution, 2)}pp this sample resolves",
        )
    else:
        report.predict(
            "hardened is above standard by at least the pair's resolution",
            False,
            f"{round(delta, 2)}pp",
        )

    # Refutation 2: a hardened sentence that costs more than the resolution is
    # harmful, and the line closes.
    if delta < -resolution:
        report.refute(
            "the hardened sentence is not below standard by more than the resolution",
            True,
            f"{round(delta, 2)}pp against a {round(resolution, 2)}pp resolution",
        )

    # Prediction 3: the parse rate stays within two points of the standard arm.
    treated_rate = parse_rate_of(treated)
    primary_rate = parse_rate_of(primary)
    if treated_rate is None or primary_rate is None:
        report.predict(
            "the parse rate stays within two points of the standard arm",
            None,
            "a per-arm scored/unscored count is absent",
        )
    else:
        gap = treated_rate - primary_rate
        report.predict(
            "the parse rate stays within two points of the standard arm",
            abs(gap) <= PARSE_RATE_TOLERANCE,
            f"{round(gap * 100, 2)}pp",
        )

    # Prediction 4: a licence to disregard a rule must not become a licence to
    # stop acting.
    treated_idle = abstention_rate_of(treated)
    primary_idle = abstention_rate_of(primary)
    if treated_idle is None or primary_idle is None:
        report.predict(
            "the abstention census does not rise",
            None,
            "a per-arm inaction census is absent",
        )
    else:
        rise = treated_idle - primary_idle
        report.predict(
            "the abstention census does not rise",
            rise <= 0,
            f"{round(rise * 100, 2)}pp",
        )
        # Refutation 4 is a reading rather than a stop: an effect that appears
        # only here is the mechanism making the agent hesitate rather than right.
        if rise > 0 and delta < resolution:
            report.note(
                "the only movement is in the abstention census: the note made the agent "
                "hesitate, and R53's fourth refutation records that rather than a benefit"
            )

    if report.refutation_fired or report.prediction_failed:
        return "ABANDONED", report
    return "GRADED", report


def find_artefact(root: Path) -> Path | None:
    direct = root / "poc-l4-facade-notes.json"
    if direct.is_file():
        return direct
    for path in sorted(root.rglob("poc-l4-facade-notes.json")):
        return path
    return None


def base_artefact(**overrides: Any) -> dict[str, Any]:
    """A minimal MEASURED three-level artefact, for the self-test cases.

    Built from the shape `noteFacadeReading` writes, including the fields the
    grading reads, so a case that flips one value is a case about that value.
    """
    artefact: dict[str, Any] = {
        "id": "poc-l4-facade-notes",
        "levels": ["none", "standard", "hardened"],
        "budgetBasis": "note-excluded",
        "arms": [
            {
                "note": "none",
                "servedPacks": 40,
                "recallRequests": 40,
                "itemsPerRequest": 1.5,
                "scoredTasks": 57,
                "unscoredTasks": 0,
                "pass4": 0.28,
                "inaction": {"episodes": 228, "acted": 228, "abstained": 0},
            },
            {
                "note": "standard",
                "servedPacks": 40,
                "recallRequests": 40,
                "itemsPerRequest": 1.5,
                "scoredTasks": 57,
                "unscoredTasks": 1,
                "pass4": 0.30,
                "inaction": {"episodes": 228, "acted": 226, "abstained": 2},
            },
            {
                "note": "hardened",
                "servedPacks": 40,
                "recallRequests": 40,
                "itemsPerRequest": 1.5,
                "scoredTasks": 57,
                "unscoredTasks": 2,
                "pass4": 0.42,
                "inaction": {"episodes": 228, "acted": 226, "abstained": 2},
            },
        ],
        "contrasts": [
            {
                "kind": "note-contrast",
                "baseline": "standard",
                "arm": "hardened",
                "comparison": {
                    "paired": 57,
                    "deltaPp": 12.0,
                    "ciLowPp": 2.0,
                    "ciHighPp": 22.0,
                    "p": 0.02,
                    "lost": 3,
                    "gained": 10,
                },
            },
            {
                "kind": "note-contrast",
                "baseline": "standard",
                "arm": "none",
                "comparison": {
                    "paired": 57,
                    "deltaPp": -2.0,
                    "ciLowPp": -12.0,
                    "ciHighPp": 8.0,
                    "p": 0.75,
                    "lost": 7,
                    "gained": 6,
                },
            },
        ],
        "packIdentity": {"compared": 40, "mismatched": 0, "examples": []},
    }
    for key, value in overrides.items():
        target = artefact
        parts = key.split(".")
        for part in parts[:-1]:
            target = target[int(part)] if isinstance(target, list) else target[part]
        last = parts[-1]
        if isinstance(target, list):
            target[int(last)] = value
        else:
            target[last] = value
    return artefact


def self_test() -> int:
    cases: list[tuple[str, dict[str, Any], str]] = [
        ("a three-level arm that clears its bar grades", base_artefact(), "GRADED"),
        (
            "the historical accounting discards, because the note then displaces a rule",
            base_artefact(budgetBasis="note-included"),
            "DISCARDED",
        ),
        (
            "an artefact that does not name three levels measured nothing",
            base_artefact(levels=["standard", "hardened"]),
            "NO_MEASUREMENT",
        ),
        (
            "a hardened arm with no paired contrast measured nothing",
            base_artefact(contrasts=[]),
            "NO_MEASUREMENT",
        ),
        (
            "arms that served different items abandon the comparison",
            base_artefact(packIdentity={"compared": 40, "mismatched": 2, "examples": ["q"]}),
            "ABANDONED",
        ),
        (
            "a hardened arm far below standard closes the line",
            base_artefact(
                **{
                    "contrasts.0.comparison.deltaPp": -20.0,
                    "contrasts.0.comparison.ciLowPp": -30.0,
                    "contrasts.0.comparison.ciHighPp": -10.0,
                }
            ),
            "ABANDONED",
        ),
        (
            "a parse rate that falls away abandons the arm",
            base_artefact(**{"arms.2.unscoredTasks": 20}),
            "ABANDONED",
        ),
        (
            "an abstention census that rises abandons the arm",
            base_artefact(**{"arms.2.inaction": {"episodes": 228, "acted": 200, "abstained": 28}}),
            "ABANDONED",
        ),
    ]
    failures = 0
    for name, artefact, expected in cases:
        state, report = grade(artefact)
        ok = state == expected
        print(f"  {'ok  ' if ok else 'FAIL'} {name}: {state} (expected {expected})")
        if not ok:
            failures += 1
            print(report.render())
    # Two readings that must survive a state which cannot carry them.
    state, report = grade(base_artefact(levels=["standard"]))
    notes = "\n".join(report.context)
    for needle in ("standard: pass4", "hardened vs standard: delta", "pack identity"):
        if needle not in notes:
            failures += 1
            print(f"  FAIL a NO_MEASUREMENT still carries '{needle}'")
    # The basis is checked before the levels: a run under the wrong accounting is
    # a different experiment, not an unreadable one.
    state, _ = grade(base_artefact(budgetBasis="note-included", levels=[]))
    if state != "DISCARDED":
        failures += 1
        print(f"  FAIL the control's premise is read before the treatment (got {state})")
    print(f"self-test: {len(cases) + 3} case(s), {failures} failure(s)")
    return 1 if failures else 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dir", help="directory holding the three-level artefact")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        return self_test()
    if not args.dir:
        parser.error("--dir is required unless --self-test is given")
    root = Path(args.dir)
    if not root.is_dir():
        print(f"[r53] no such directory: {root}", file=sys.stderr)
        return 2
    path = find_artefact(root)
    if path is None:
        print("[r53] no poc-l4-facade-notes.json for this arm", file=sys.stderr)
        return 2
    artefact = json.loads(path.read_text())
    state, report = grade(artefact)
    print(f"[r53] state: {state}")
    print(report.render())
    if isinstance(artefact.get("summary"), str):
        print(f"[r53] summary: {artefact['summary']}") 
    return 0


if __name__ == "__main__":
    sys.exit(main())
