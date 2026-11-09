#!/usr/bin/env python3
"""R57 readback: what a rule costs when it is not the rule the question needed.

The registration is `prereg/R57-toxicity.md`, amended before any dispatch (see its "Amendment,
2026-11-09" section). The arm plants exactly one authored rule in every pack, at a level fixed in
advance, so the question "what does an irrelevant rule cost" stops being an attribution over a store
the distiller chose and becomes an experiment.

This readback grades the *instrument* before it grades any number, because an arm whose band did not
land is not a weak effect — it is a different treatment:

  the census     did the arm plant one rule per served request, out of the committed file, at the
                 level its name claims?
  the ledger     within each arm, did the distractor break more episodes than it repaired? This is
                 the reading the registration says carries the result, and it is paired inside one
                 dispatch, so it does not carry the between-run noise that makes every mean
                 `UNRESOLVED`.
  the order      far -> near -> adversarial, as a difference of ledger excesses. Graded only where
                 the difference exceeds the drift a control arm has been measured to move on its own
                 (3.51pp, R58 to R59), because four dispatches are not one paired comparison and the
                 record says so (`AUDIT 34.79`).

States, the same four the other verifiers use:

  GRADED          every graded prediction holds and no refutation fired.
  NO_MEASUREMENT  an arm is missing, or an artefact cannot answer the question it is asked.
  DISCARDED       an arm ran a different arm than the directory it is filed under.
  ABANDONED       a refutation fired, or a graded prediction failed.

Usage:
  python3 eval/tools/fetch_evidence.py --repo microglia --run <run-id> --out /tmp/r57-far
  python3 r57_readback.py --arm far=/tmp/r57-far --arm near=/tmp/r57-near \\
      --arm adversarial=/tmp/r57-adversarial
  python3 r57_readback.py --self-test
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

STATES = ("GRADED", "NO_MEASUREMENT", "DISCARDED", "ABANDONED")

ARMS = ("far", "near", "adversarial")
# Quoted from the amendment, which measured them before the dispatch rather than after: `far` shares
# nothing with every request seen, and the near arm reaches its band on 76% of them, the rest recorded
# as drift. The thresholds are below those readings so an arm is refused only when the level moved.
# `far` shares nothing with anything, so its band is a property of the committed rule file and is
# graded. `near`/`adversarial` were graded at 0.60 and that number was calibrated on *task
# instructions* while the census counts *every recall request* — the agent sends the current message
# per turn, 8.6 requests per episode, so only the first carries the task's words. `near` measured
# 35.4% of 1972 against a 60% bar: the arm was graded against a population it never ran on. Amendment
# 2 of the registration replaces that with the equality this contrast exists for — the two polarities
# must sit at the same level — and the per-request share becomes a reported distribution.
PREDICTED_FAR_BAND_SHARE = 0.95
# How far apart the two polarities' measured band shares may sit. Amendment 1's point was that
# polarity must not move the dose; a between-arm equality needs no absolute threshold, which is what
# makes it gradable on a population the registration does not control.
POLARITY_LEVEL_TOLERANCE = 0.10
# The control arm's own movement between two dispatches of one configuration (R58 63.16%, R59
# 66.67%, same 57 tasks, nothing changed). A difference smaller than this is not a difference.
CONTROL_DRIFT_PP = 3.51
REQUIRED_TRIALS = 4
# `near` and `adversarial` are the same words with the action forbidden; `far` shares nothing.
ARMS_THAT_MUST_SHARE = ("near", "adversarial")


class Report:
    def __init__(self) -> None:
        self.predictions: list[tuple[str, bool | None, str]] = []
        self.refutations: list[tuple[str, bool, str]] = []
        self.context: list[str] = []
        # Set when fewer than three arms were supplied. The state stays `GRADED` because every
        # prediction that *was* graded holds, and a reader who saw only the state would take it for a
        # finished round -- so the partial set is stated above the predictions rather than inside them.
        self.partial: list[str] = []

    def predict(self, name: str, ok: bool | None, detail: str = "") -> None:
        self.predictions.append((name, None if ok is None else bool(ok), detail))

    def refute(self, name: str, fired: bool, detail: str = "") -> None:
        self.refutations.append((name, bool(fired), detail))

    def note(self, text: str) -> None:
        self.context.append(text)

    @property
    def predictions_ok(self) -> bool:
        return all(ok is not False for _, ok, _ in self.predictions)

    @property
    def refutation_fired(self) -> bool:
        return any(fired for _, fired, _ in self.refutations)

    def render(self) -> str:
        lines = [] if not self.partial else [f"partial: {', '.join(self.partial)}", "predictions:"]
        if not self.partial:
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


# --------------------------------------------------------------------------- #
# reading one arm
# --------------------------------------------------------------------------- #


def _rate(value: Any) -> float | None:
    return float(value) if isinstance(value, (int, float)) else None


def _share(part: Any, whole: Any) -> float | None:
    if not isinstance(part, (int, float)) or not isinstance(whole, (int, float)) or whole <= 0:
        return None
    return float(part) / float(whole)


class Arm:
    """One dispatch, reduced to what the registration grades.

    `census` is the planted rule's own reading and `comparison` is the paired `pass^4` against the
    reference arm of the same dispatch. The ledger — `lost` and `gained` — is the reading the
    registration says carries the result, and it is the only one whose noise is paired away.
    """

    def __init__(self, name: str, census: dict[str, Any], comparison: dict[str, Any] | None,
                 resolution: dict[str, Any] | None, recall: dict[str, Any] | None,
                 trials: Any) -> None:
        self.name = name
        self.census = census
        self.comparison = comparison or {}
        self.resolution = resolution or {}
        self.recall = recall or {}
        self.trials = trials

    @property
    def planted(self) -> int | None:
        value = self.census.get("planted")
        return int(value) if isinstance(value, int) else None

    @property
    def in_band(self) -> int | None:
        value = self.census.get("inBand")
        return int(value) if isinstance(value, int) else None

    @property
    def band_share(self) -> float | None:
        return _share(self.in_band, self.planted)

    @property
    def digest(self) -> str:
        return str(self.census.get("digest") or "")

    @property
    def broken(self) -> int | None:
        value = self.comparison.get("lost")
        return int(value) if isinstance(value, int) else None

    @property
    def repaired(self) -> int | None:
        value = self.comparison.get("gained")
        return int(value) if isinstance(value, int) else None

    @property
    def paired(self) -> int | None:
        value = self.comparison.get("paired")
        return int(value) if isinstance(value, int) else None

    @property
    def delta_pp(self) -> float | None:
        return _rate(self.comparison.get("deltaPp"))

    @property
    def half_width_pp(self) -> float | None:
        return _rate(self.resolution.get("halfWidthPp"))

    @property
    def excess(self) -> int | None:
        """Episodes broken minus episodes repaired, which is the sign split in one number."""
        if self.broken is None or self.repaired is None:
            return None
        return self.broken - self.repaired

    @property
    def excess_pp(self) -> float | None:
        return _share(self.excess, self.paired)

    def ledger(self) -> str:
        excess_pp = self.excess_pp
        return (
            f"{self.name}: broke {self.broken} repaired {self.repaired} of {self.paired} "
            f"(excess {self.excess:+d}"
            + ("" if excess_pp is None else f", {excess_pp * 100:+.2f}pp") + ")"
            if self.excess is not None
            else f"{self.name}: no ledger"
        )


def read_arm(name: str, directory: Path) -> tuple[Arm | None, str | None]:
    """The arm's readings, or the reason this directory cannot be one."""
    artefacts = sorted(directory.rglob("poc-l4.json"))
    if not artefacts:
        return None, f"no poc-l4.json under {directory}"
    document = json.loads(artefacts[0].read_text())
    tau2 = document.get("tau2") or {}
    census = tau2.get("plant")
    if not isinstance(census, dict):
        return None, f"{directory} carries no plant block: this dispatch planted nothing"
    pairs = sorted(directory.rglob("poc-l4-pair.json"))
    pair = json.loads(pairs[0].read_text()) if pairs else {}
    return (
        Arm(
            name=name,
            census=census,
            comparison=pair.get("comparison"),
            resolution=pair.get("resolution"),
            recall=tau2.get("recall"),
            trials=(document.get("metrics") or {}).get("k"),
        ),
        None,
    )


# --------------------------------------------------------------------------- #
# grading
# --------------------------------------------------------------------------- #


def band_floor(name: str) -> float:
    """The graded band floor, for the arms whose level is a property of the committed file.

    Only `far` has one. `near` and `adversarial` are graded against each other (Amendment 2), because
    an absolute share over per-turn requests is a share over a population the registration does not
    choose.
    """
    return PREDICTED_FAR_BAND_SHARE


def grade(arms: dict[str, Arm]) -> tuple[str, Report]:
    report = Report()

    # A partial set is graded for what it can answer. Three arms are what the *order* needs; one arm
    # is enough for the instrument and the ledger, and refusing to read a single arm made the tool
    # answer nothing about a dispatch that had already measured everything about itself. The order
    # prediction becomes `n/a` rather than a failure, because an arm that has not run is not an arm
    # that failed.
    present = [name for name in ARMS if name in arms]
    missing = [name for name in ARMS if name not in arms]
    if not present:
        report.predict("at least one armed arm was dispatched", False, "none")
        return "NO_MEASUREMENT", report
    if missing:
        report.partial.append(
            f"{len(present)} of {len(ARMS)} arms ({', '.join(present)}); "
            f"missing {', '.join(missing)}, so the order is not graded"
        )

    # 1. The arm is the arm it is filed under. A dispatch that planted the far rule under the near
    #    arm's name is not a weaker treatment, it is a different experiment.
    for name in present:
        declared = str(arms[name].census.get("arm") or "")
        if declared != name:
            report.refute(
                "each directory carries the arm it is named for",
                True,
                f"{name} declares {declared!r}",
            )
            return "DISCARDED", report
    report.predict("each directory carries the arm it is named for", True)

    # 2. One rule in every pack, out of the committed file.
    for name in present:
        arm = arms[name]
        served = arm.recall.get("requests")
        report.predict(
            f"{name}: one rule planted per served request",
            arm.planted is not None and arm.planted == served and (arm.planted or 0) > 0,
            f"planted {arm.planted} of {served} requests",
        )

    digests = {arm.digest for arm in arms.values()}
    report.refute(
        "the committed rules are one file across the arms",
        len(digests) != 1,
        ", ".join(sorted(digests)) if len(digests) > 1 else next(iter(digests)),
    )

    # 3. The level. `far`'s is a property of the committed file and is graded; the two polarities are
    #    reported and then compared with each other. Amendment 2 has the arithmetic: a share over
    #    per-turn requests is not the share Amendment 1 calibrated, and near was already refused by a
    #    bar its own population could not meet.
    for name in present:
        arm = arms[name]
        share = arm.band_share
        if name == "far":
            report.predict(
                f"far: the band landed on at least {band_floor(name) * 100:.0f}% of requests",
                None if share is None else share >= band_floor(name),
                "no census" if share is None else f"{share * 100:.1f}% of {arm.planted}",
            )
        elif share is not None:
            report.note(f"{name}: band share {share * 100:.1f}% of {arm.planted} (reported, not graded)")
    if "near" in arms and "adversarial" in arms:
        near_share = arms["near"].band_share
        adversarial_share = arms["adversarial"].band_share
        gap = None if near_share is None or adversarial_share is None else abs(adversarial_share - near_share)
        report.predict(
            f"the two polarities sit at the same level: |adversarial - near| <= {POLARITY_LEVEL_TOLERANCE * 100:.0f}pp",
            None if gap is None else gap <= POLARITY_LEVEL_TOLERANCE,
            "no census" if gap is None else f"{gap * 100:.1f}pp apart",
        )

    # 4. Four trials, or the deltas are not the registered ones.
    off = {name: arms[name].trials for name in present if arms[name].trials != REQUIRED_TRIALS}
    report.predict(
        "every arm scored the registered trial count",
        not off,
        ", ".join(f"{name} k={value}" for name, value in sorted(off.items())),
    )

    # 5. The ledger, which is the reading. Graded per arm, because it is paired inside a dispatch.
    #    An arm whose pairing did not run leaves the arms incomparable rather than merely ungraded:
    #    the order is a difference of excesses, and a missing one is a measurement, not a zero.
    unpaired = [name for name in present if arms[name].excess is None]
    for name in present:
        if arms[name].excess is not None:
            report.note(arms[name].ledger())
    if unpaired:
        report.predict(
            "every arm carries its own paired ledger",
            None,
            f"no comparison block for {', '.join(unpaired)}",
        )
        return "NO_MEASUREMENT", report

    if "near" in arms and arms["near"].excess is not None:
        report.predict(
            "near broke more episodes than it repaired",
            arms["near"].excess > 0,
            f"excess {arms['near'].excess:+d}",
        )
    if "adversarial" in arms and arms["adversarial"].excess is not None:
        report.predict(
            "adversarial broke more episodes than it repaired",
            arms["adversarial"].excess > 0,
            f"excess {arms['adversarial'].excess:+d}",
        )
    if "far" in arms and arms["far"].excess_pp is not None:
        # "Not free but not harmful": the harmful half of that is gradeable against the drift a
        # control arm moves on its own, and the "not free" half is not gradeable at this sample.
        report.predict(
            "far is not harmful beyond the control arm's own drift",
            arms["far"].excess_pp * 100 >= -CONTROL_DRIFT_PP,
            f"excess {arms['far'].excess_pp * 100:+.2f}pp against a drift of {CONTROL_DRIFT_PP:.2f}pp",
        )
        report.predict("far is not free", None, "not gradeable at 57 pairs")

    # 6. The order, graded only where it exceeds the drift, and only where all three arms exist. The
    #    difference of two excesses needs both of them: a missing arm is not a zero excess.
    if len(present) < len(ARMS):
        report.predict(
            "the order is gradeable",
            None,
            f"needs {', '.join(ARMS)}; has {', '.join(present)}",
        )
        for name in present:
            arm = arms[name]
            if arm.delta_pp is not None:
                half = arm.half_width_pp
                report.note(
                    f"{name}: pass^4 {arm.delta_pp:+.2f}pp"
                    + ("" if half is None else f" against a half-width of {half:.2f}pp")
                )
        if report.refutation_fired or not report.predictions_ok:
            return "ABANDONED", report
        return "GRADED", report

    far_pp = (arms["far"].excess_pp or 0.0) * 100
    near_pp = (arms["near"].excess_pp or 0.0) * 100
    adversarial_pp = (arms["adversarial"].excess_pp or 0.0) * 100
    # Strict, and the strictness is the repair. These two lines read
    # `near_pp - far_pp > -CONTROL_DRIFT_PP`, which is "near is not much *better* than far": it
    # passes when near is worse, when near is equal, and when near is better by up to the drift —
    # a prediction that cannot fail written under the label of one that can. It passed here while
    # the refutation below fired on the same two numbers ("far and near are indistinguishable at
    # -3.51pp, inside a drift of 3.51pp"), so the account said both that the rung existed and that
    # it did not. A predicted *order* needs the gap in the direction the order names.
    report.predict(
        "near is worse than far",
        near_pp - far_pp > CONTROL_DRIFT_PP,
        f"{near_pp:+.2f}pp against {far_pp:+.2f}pp, a gap of {near_pp - far_pp:+.2f}pp "
        f"against a drift of {CONTROL_DRIFT_PP:.2f}pp",
    )
    report.predict(
        "adversarial is worse than near",
        adversarial_pp - near_pp > CONTROL_DRIFT_PP,
        f"{adversarial_pp:+.2f}pp against {near_pp:+.2f}pp, a gap of {adversarial_pp - near_pp:+.2f}pp "
        f"against a drift of {CONTROL_DRIFT_PP:.2f}pp",
    )
    report.refute(
        "far and near are indistinguishable",
        abs(near_pp - far_pp) <= CONTROL_DRIFT_PP,
        f"the two arms differ by {near_pp - far_pp:+.2f}pp, inside a drift of {CONTROL_DRIFT_PP:.2f}pp",
    )
    report.refute(
        "adversarial reads better than near: contradiction as a signal",
        adversarial_pp - near_pp < -CONTROL_DRIFT_PP,
        f"adversarial {adversarial_pp:+.2f}pp against near {near_pp:+.2f}pp",
    )
    report.refute(
        "every armed arm breaks more than it repairs by more than the drift",
        all((arms[name].excess_pp or 0.0) * 100 > CONTROL_DRIFT_PP for name in ARMS),
        ", ".join(f"{name} {(arms[name].excess_pp or 0.0) * 100:+.2f}pp" for name in ARMS),
    )

    for name in ARMS:
        arm = arms[name]
        if arm.delta_pp is not None:
            half = arm.half_width_pp
            report.note(
                f"{name}: pass^4 {arm.delta_pp:+.2f}pp"
                + ("" if half is None else f" against a half-width of {half:.2f}pp")
                + " (reported, not claimed: the mean is unresolved at this sample by construction)"
            )

    if report.refutation_fired or not report.predictions_ok:
        return "ABANDONED", report
    return "GRADED", report


# --------------------------------------------------------------------------- #
# self-test
# --------------------------------------------------------------------------- #


def fixture(name: str, *, census: dict[str, Any] | None = None, comparison: dict[str, Any] | None = None,
            resolution: dict[str, Any] | None = None, recall: dict[str, Any] | None = None,
            trials: Any = 4) -> Arm:
    """One arm, defaulted to a passing one so each case can vary a single field."""
    default_census = {
        "arm": name,
        "declared": True,
        "planted": 200,
        "inBand": 200 if name == "far" else 152,
        "createdBlock": 12,
        "terms": [0] if name == "far" else [2, 5],
        "coverages": [0.0] if name == "far" else [0.05, 0.13],
        "byRule": {f"{name}-address": 120, f"{name}-refund": 80},
        "digest": "abc123abc123abcd",
    }
    default_comparison = {"paired": 57, "lost": 6, "gained": 5, "deltaPp": -1.0, "p": 0.9}
    return Arm(
        name=name,
        census=default_census if census is None else {**default_census, **census},
        comparison=default_comparison if comparison is None else {**default_comparison, **comparison},
        resolution=resolution if resolution is not None else {"halfWidthPp": 15.0},
        recall=recall if recall is not None else {"requests": 200, "served": 190, "empty": 10},
        trials=trials,
    )


def passing_arms() -> dict[str, Arm]:
    """Three arms that satisfy every prediction and fire no refutation."""
    return {
        "far": fixture("far", comparison={"lost": 4, "gained": 4}),
        "near": fixture("near", comparison={"lost": 9, "gained": 4}),
        "adversarial": fixture("adversarial", comparison={"lost": 14, "gained": 3}),
    }


def self_test() -> int:
    cases: list[tuple[str, dict[str, Arm], str, str | None]] = [
        ("three arms with the order the registration predicts", passing_arms(), "GRADED", None),
        (
            "a partial set grades what it has and says the order is not",
            {"far": fixture("far"), "near": fixture("near")},
            "GRADED",
            "2 of 3 arms (far, near); missing adversarial",
        ),
        (
            "a lone arm still grades its own instrument and ledger",
            {"far": fixture("far")},
            "GRADED",
            "the order is gradeable",
        ),
        ("no arm at all is a measurement that did not happen", {}, "NO_MEASUREMENT", "none"),
        (
            "an arm filed under a name it did not run is discarded",
            {**passing_arms(), "near": fixture("near", census={"arm": "far"})},
            "DISCARDED",
            "near declares 'far'",
        ),
        (
            "rules that differ between arms abandon: the arms are not one experiment",
            {**passing_arms(), "far": fixture("far", census={"digest": "ffff"}, comparison={"lost": 4, "gained": 4})},
            "ABANDONED",
            "one file across the arms",
        ),
        (
            "an arm that planted on fewer requests than it served fails its census",
            {**passing_arms(), "near": fixture("near", census={"planted": 150}, comparison={"lost": 9, "gained": 4})},
            "ABANDONED",
            "planted 150 of 200",
        ),
        (
            "a far arm that shares terms with the requests did not run its band",
            {**passing_arms(), "far": fixture("far", census={"inBand": 120}, comparison={"lost": 4, "gained": 4})},
            "ABANDONED",
            "band landed",
        ),
        (
            "the two polarities at different levels are not one treatment",
            {**passing_arms(), "near": fixture("near", census={"inBand": 40}, comparison={"lost": 9, "gained": 4})},
            "ABANDONED",
            "56.0pp apart",
        ),
        (
            "a polarity's share is reported rather than graded, because its population is per-turn",
            {"near": fixture("near", census={"inBand": 40}, comparison={"lost": 9, "gained": 4})},
            "GRADED",
            "band share 20.0% of 200 (reported, not graded)",
        ),
        (
            "far and near inside the drift is the registered refutation",
            {
                "far": fixture("far", comparison={"lost": 6, "gained": 5}),
                "near": fixture("near", comparison={"lost": 7, "gained": 6}),
                "adversarial": fixture("adversarial", comparison={"lost": 14, "gained": 3}),
            },
            "ABANDONED",
            "indistinguishable",
        ),
        (
            "adversarial reading better than near fires the second refutation",
            {
                "far": fixture("far", comparison={"lost": 4, "gained": 4}),
                "near": fixture("near", comparison={"lost": 14, "gained": 3}),
                "adversarial": fixture("adversarial", comparison={"lost": 2, "gained": 9}),
            },
            "ABANDONED",
            "contradiction as a signal",
        ),
        (
            "a near arm that repaired more than it broke fails the sign split",
            {
                "far": fixture("far", comparison={"lost": 4, "gained": 4}),
                "near": fixture("near", comparison={"lost": 3, "gained": 9}),
                "adversarial": fixture("adversarial", comparison={"lost": 14, "gained": 3}),
            },
            "ABANDONED",
            "near broke more episodes than it repaired",
        ),
        (
            "a far arm that hurt beyond the drift fails its prediction",
            {
                "far": fixture("far", comparison={"lost": 20, "gained": 8}),
                "near": fixture("near", comparison={"lost": 24, "gained": 6}),
                "adversarial": fixture("adversarial", comparison={"lost": 30, "gained": 4}),
            },
            "ABANDONED",
            "not harmful beyond",
        ),
        (
            "an arm that did not score four trials cannot be read",
            {**passing_arms(), "far": fixture("far", trials=1, comparison={"lost": 4, "gained": 4})},
            "ABANDONED",
            "registered trial count",
        ),
        (
            "an arm whose pairing did not run is a measurement that did not happen",
            {
                "far": fixture("far"),
                "near": fixture("near"),
                "adversarial": Arm("adversarial", fixture("adversarial").census, {}, {}, {"requests": 200}, 4),
            },
            "NO_MEASUREMENT",
            "no comparison block for adversarial",
        ),
    ]
    failures = 0
    for label, arms, expected, fragment in cases:
        state, report = grade(arms)
        rendered = report.render()
        honoured = fragment is None or fragment in rendered
        mark = "ok  " if state == expected and honoured else "FAIL"
        if state != expected or not honoured:
            failures += 1
        print(f"  {mark} {label} -> {state}")
        if state != expected or not honoured:
            print(rendered)
    print()
    print("SELF-TEST PASSED" if failures == 0 else f"SELF-TEST FAILED ({failures})")
    return 0 if failures == 0 else 1


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--arm", action="append", default=[], metavar="NAME=DIR")
    parser.add_argument("--dir", action="append", default=[], metavar="DIR")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        return self_test()

    arms: dict[str, Arm] = {}
    problems: list[str] = []
    for entry in args.arm:
        if "=" not in entry:
            parser.error(f"--arm wants NAME=DIR, not {entry!r}")
        name, _, directory = entry.partition("=")
        read, problem = read_arm(name, Path(directory))
        if read is None:
            problems.append(problem or name)
            continue
        arms[name] = read
    # A directory given without a name is read as the arm its own census declares, which is the one
    # thing a filed artefact cannot lie about without being discarded below.
    for directory in args.dir:
        read, problem = read_arm("unknown", Path(directory))
        if read is None:
            problems.append(problem or directory)
            continue
        arms[str(read.census.get("arm") or "unknown")] = read

    if problems:
        for problem in problems:
            print(problem, file=sys.stderr)
    if not arms:
        print("no arm could be read", file=sys.stderr)
        return 2

    state, report = grade(arms)
    print(state)
    print(report.render())
    return 0 if state == "GRADED" else 1


if __name__ == "__main__":
    sys.exit(main())
